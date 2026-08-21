import * as THREE from "three";
import {
  Fn, instanceIndex, instancedArray, storage, float, uint,
  uniform, vec2, vec3, vec4, color, positionLocal,
  mix, clamp, min, max, attribute, sin, cos, cross,
} from "three/tsl";

// Mobile-first spectral ocean. The random spectrum is seeded once on the CPU;
// spectral evolution + both 2D inverse FFTs run on the GPU every frame.
const FFT_N = 128;
const GRAVITY = 9.81;
const TAU = Math.PI * 2;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianPair(rand) {
  const u1 = Math.max(1e-7, rand());
  const u2 = rand();
  const r = Math.sqrt(-2 * Math.log(u1));
  const a = TAU * u2;
  return [r * Math.cos(a), r * Math.sin(a)];
}

function reverseBits(value, bits) {
  let out = 0;
  for (let i = 0; i < bits; i++) {
    out = (out << 1) | (value & 1);
    value >>>= 1;
  }
  return out >>> 0;
}

function buildSpectrumData(N, size, seed = 1337) {
  const count = N * N;
  const h0 = new Float32Array(count * 4);
  const meta = new Float32Array(count * 4); // nx, nz, |k|, omega
  const mirror = new Float32Array(count);
  const bitReverse = new Float32Array(N);
  const rand = mulberry32(seed);
  const windX0 = 1.0, windZ0 = 0.32;
  const windLen = Math.hypot(windX0, windZ0);
  const windX = windX0 / windLen, windZ = windZ0 / windLen;
  const windSpeed = 21.0;
  const amplitude = 0.0008;
  const L = (windSpeed * windSpeed) / GRAVITY;
  const dampingLength = L * 0.0012;

  const bits = Math.log2(N);
  for (let i = 0; i < N; i++) bitReverse[i] = reverseBits(i, bits);

  for (let y = 0; y < N; y++) {
    const kyIndex = y <= N / 2 ? y : y - N;
    for (let x = 0; x < N; x++) {
      const kxIndex = x <= N / 2 ? x : x - N;
      const i = y * N + x;
      const kx = TAU * kxIndex / size;
      const kz = TAU * kyIndex / size;
      const k2 = kx * kx + kz * kz;
      const k = Math.sqrt(k2);
      let nx = 0, nz = 0, omega = 0, re = 0, im = 0;

      if (k > 1e-7) {
        nx = kx / k;
        nz = kz / k;
        omega = Math.sqrt(GRAVITY * k);
        const kw = nx * windX + nz * windZ;
        const directional = kw * kw;
        const large = Math.exp(-1 / Math.max(1e-12, k2 * L * L));
        const small = Math.exp(-k2 * dampingLength * dampingLength);
        const phillips = amplitude * large * directional * small / Math.max(1e-12, k2 * k2);
        const [g0, g1] = gaussianPair(rand);
        const s = Math.sqrt(Math.max(0, phillips) * 0.5);
        re = g0 * s;
        im = g1 * s;
      }

      h0[i * 4] = re;
      h0[i * 4 + 1] = im;
      h0[i * 4 + 2] = 0;
      h0[i * 4 + 3] = 0;
      meta[i * 4] = nx;
      meta[i * 4 + 1] = nz;
      meta[i * 4 + 2] = k;
      meta[i * 4 + 3] = omega;

      const mx = (N - x) % N;
      const my = (N - y) % N;
      mirror[i] = my * N + mx;
    }
  }

  return { h0, meta, mirror, bitReverse };
}

function createPackedFFTKernelSet(N, source, destination, ping, pong, bitReverseBuffer) {
  const count = N * N;
  const kernels = [];

  const makeBitReverse = (input, output, horizontal) => Fn(() => {
    const i = instanceIndex;
    const x = i.mod(uint(N));
    const y = i.div(uint(N));
    const axis = horizontal ? x : y;
    const reversed = bitReverseBuffer.element(axis).toUint();
    const sourceIndex = horizontal
      ? y.mul(uint(N)).add(reversed)
      : reversed.mul(uint(N)).add(x);
    output.element(i).assign(input.element(sourceIndex));
  })().compute(count);

  const makeButterfly = (input, output, horizontal, stage) => {
    const span = 1 << (stage + 1);
    const half = span >> 1;
    return Fn(() => {
      const i = instanceIndex;
      const x = i.mod(uint(N));
      const y = i.div(uint(N));
      const axis = horizontal ? x : y;
      const fixed = horizontal ? y : x;
      const groupStart = axis.div(uint(span)).mul(uint(span));
      const offset = axis.mod(uint(half));
      const firstAxis = groupStart.add(offset);
      const secondAxis = firstAxis.add(uint(half));
      const firstIndex = horizontal
        ? fixed.mul(uint(N)).add(firstAxis)
        : firstAxis.mul(uint(N)).add(fixed);
      const secondIndex = horizontal
        ? fixed.mul(uint(N)).add(secondAxis)
        : secondAxis.mul(uint(N)).add(fixed);

      const A = input.element(firstIndex);
      const B = input.element(secondIndex);
      const angle = offset.toFloat().mul(float(TAU / span));
      const wr = cos(angle);
      const wi = sin(angle);

      const b0r = B.x.mul(wr).sub(B.y.mul(wi));
      const b0i = B.x.mul(wi).add(B.y.mul(wr));
      const b1r = B.z.mul(wr).sub(B.w.mul(wi));
      const b1i = B.z.mul(wi).add(B.w.mul(wr));

      const halfFlag = axis.div(uint(half)).mod(uint(2)).toFloat();
      const sign = float(1).sub(halfFlag.mul(2));
      output.element(i).assign(vec4(
        A.x.add(b0r.mul(sign)),
        A.y.add(b0i.mul(sign)),
        A.z.add(b1r.mul(sign)),
        A.w.add(b1i.mul(sign)),
      ));
    })().compute(count);
  };

  const makeCopy = (input, output, scale = 1) => Fn(() => {
    output.element(instanceIndex).assign(input.element(instanceIndex).mul(float(scale)));
  })().compute(count);

  let read = ping;
  let write = pong;
  kernels.push(makeBitReverse(source, read, true));
  for (let stage = 0; stage < Math.log2(N); stage++) {
    kernels.push(makeButterfly(read, write, true, stage));
    [read, write] = [write, read];
  }

  write = read === ping ? pong : ping;
  kernels.push(makeBitReverse(read, write, false));
  read = write;
  write = read === ping ? pong : ping;

  for (let stage = 0; stage < Math.log2(N); stage++) {
    kernels.push(makeButterfly(read, write, false, stage));
    [read, write] = [write, read];
  }

  kernels.push(makeCopy(read, destination, 1 / (N * N)));
  return kernels;
}

function buildShoreAttributes(geometry, waterY, sampleHeight) {
  const count = geometry.attributes.position.count;
  const shore = new Float32Array(count);
  const depth = new Float32Array(count);
  const pos = geometry.attributes.position;
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const groundY = sampleHeight ? sampleHeight(x, z) : null;
    const signedDepth = groundY === null ? 8 : waterY - groundY;
    const realDepth = Math.max(0, signedDepth);
    depth[i] = THREE.MathUtils.clamp(realDepth / 8, 0, 1);
    if (signedDepth <= -0.55) shore[i] = 0;
    else if (signedDepth < 0) {
      const t = (signedDepth + 0.55) / 0.55;
      shore[i] = t * t * (3 - 2 * t) * 0.18;
    } else {
      const t = THREE.MathUtils.clamp(signedDepth / 3.5, 0, 1);
      const e = t * t * (3 - 2 * t);
      shore[i] = 0.18 + e * 0.82;
    }
  }
  geometry.setAttribute("fftShore", new THREE.Float32BufferAttribute(shore, 1));
  geometry.setAttribute("fftDepth", new THREE.Float32BufferAttribute(depth, 1));
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const N = FFT_N;
  const count = N * N;
  const spectrumData = buildSpectrumData(N, size, 1337);

  // three.js r182 has a bug in instancedArray(TypedArray, type): the TypedArray
  // itself is forwarded as StorageBufferNode.bufferCount instead of the logical
  // element count. Some WebGPU backends tolerate it, but Safari/iOS reaches a
  // native TypedArray.set() failure while createStorageAttribute() initializes
  // the compute buffer. Build the four CPU-seeded buffers explicitly with the
  // correct itemSize and bufferCount. Numeric instancedArray(count, type) below
  // remains safe because its count is already scalar.
  const h0Buffer = storage(
    new THREE.StorageInstancedBufferAttribute(spectrumData.h0, 4),
    "vec4",
    count,
  );
  const metaBuffer = storage(
    new THREE.StorageInstancedBufferAttribute(spectrumData.meta, 4),
    "vec4",
    count,
  );
  const mirrorBuffer = storage(
    new THREE.StorageInstancedBufferAttribute(spectrumData.mirror, 1),
    "float",
    count,
  );
  const bitReverseBuffer = storage(
    new THREE.StorageInstancedBufferAttribute(spectrumData.bitReverse, 1),
    "float",
    N,
  );

  const spectrumA = instancedArray(count, "vec4");
  const spectrumB = instancedArray(count, "vec4");
  const fftPing = instancedArray(count, "vec4");
  const fftPong = instancedArray(count, "vec4");
  const spatialA = instancedArray(count, "vec4");
  const spatialB = instancedArray(count, "vec4");

  const waveScale = uniform(1.0);
  const fftTime = uniform(0.0);
  const stormAmount = uniform(0.0);
  const dayAmount = uniform(1.0);
  const deepTint = uniform(new THREE.Color(0x145f91));
  const shallowTint = uniform(new THREE.Color(0x65cbd5));
  const stormTint = uniform(new THREE.Color(0x17373e));
  const foamTint = uniform(new THREE.Color(0xffffff));

  const computeSpectrum = Fn(() => {
    const i = instanceIndex;
    const h0k = h0Buffer.element(i);
    const mirrorIndex = mirrorBuffer.element(i).toUint();
    const h0m = h0Buffer.element(mirrorIndex);
    const meta = metaBuffer.element(i);
    const phase = meta.w.mul(fftTime);
    const c = cos(phase);
    const s = sin(phase);

    const aR = h0k.x.mul(c).sub(h0k.y.mul(s));
    const aI = h0k.x.mul(s).add(h0k.y.mul(c));
    const bR = h0m.x.mul(c).sub(h0m.y.mul(s));
    const bI = float(0).sub(h0m.x.mul(s).add(h0m.y.mul(c)));
    const hR = aR.add(bR).mul(waveScale);
    const hI = aI.add(bI).mul(waveScale);

    const chop = float(1.25);
    const dxScale = meta.x.mul(chop);
    const dzScale = meta.y.mul(chop);
    spectrumA.element(i).assign(vec4(
      hR,
      hI,
      hI.mul(dxScale),
      float(0).sub(hR.mul(dxScale)),
    ));
    spectrumB.element(i).assign(vec4(
      hI.mul(dzScale),
      float(0).sub(hR.mul(dzScale)),
      0,
      0,
    ));
  })().compute(count);

  const fftA = createPackedFFTKernelSet(N, spectrumA, spatialA, fftPing, fftPong, bitReverseBuffer);
  const fftB = createPackedFFTKernelSet(N, spectrumB, spatialB, fftPing, fftPong, bitReverseBuffer);
  const computeFrame = [computeSpectrum, ...fftA, ...fftB];

  const geometry = new THREE.PlaneGeometry(size, size, N - 1, N - 1);
  geometry.rotateX(-Math.PI / 2);
  const indices = new Float32Array(count);
  for (let i = 0; i < count; i++) indices[i] = i;
  geometry.setAttribute("fftIndex", new THREE.Float32BufferAttribute(indices, 1));
  buildShoreAttributes(geometry, y, sampleHeight);

  const material = new THREE.MeshStandardNodeMaterial({
    color: 0x1f7fb0,
    roughness: 0.065,
    metalness: 0.04,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  });

  const idx = attribute("fftIndex", "float").toUint();
  const shore = attribute("fftShore", "float");
  const depthT = attribute("fftDepth", "float");
  const spacing = float(size / (N - 1));
  const twoSpacing = spacing.mul(2);

  const sampleHeightDx = (sampleIndex) => spatialA.element(sampleIndex);
  const sampleDz = (sampleIndex) => spatialB.element(sampleIndex).x;

  material.positionNode = Fn(() => {
    const a = spatialA.element(idx);
    const dz = spatialB.element(idx).x;
    return positionLocal.add(vec3(a.z.mul(shore), a.x.mul(shore), dz.mul(shore)));
  })();

  const normalAndCompression = Fn(() => {
    const cx = idx.mod(uint(N)).toFloat();
    const cy = idx.div(uint(N)).toFloat();
    const xm = max(cx.sub(1), float(0));
    const xp = min(cx.add(1), float(N - 1));
    const ym = max(cy.sub(1), float(0));
    const yp = min(cy.add(1), float(N - 1));
    const iL = cy.mul(N).add(xm).toUint();
    const iR = cy.mul(N).add(xp).toUint();
    const iD = ym.mul(N).add(cx).toUint();
    const iU = yp.mul(N).add(cx).toUint();
    const aL = sampleHeightDx(iL), aR = sampleHeightDx(iR);
    const aD = sampleHeightDx(iD), aU = sampleHeightDx(iU);
    const zL = sampleDz(iL), zR = sampleDz(iR);
    const zD = sampleDz(iD), zU = sampleDz(iU);

    const dDxdx = aR.z.sub(aL.z).div(twoSpacing);
    const dhdx = aR.x.sub(aL.x).div(twoSpacing);
    const dDzdx = zR.sub(zL).div(twoSpacing);
    const dDxdz = aU.z.sub(aD.z).div(twoSpacing);
    const dhdz = aU.x.sub(aD.x).div(twoSpacing);
    const dDzdz = zU.sub(zD).div(twoSpacing);
    const tx = vec3(float(1).add(dDxdx), dhdx, dDzdx);
    const tz = vec3(dDxdz, dhdz, float(1).add(dDzdz));
    const normal = cross(tz, tx).normalize();
    const jacobian = float(1).add(dDxdx).mul(float(1).add(dDzdz)).sub(dDxdz.mul(dDzdx));
    const compression = clamp(float(1).sub(jacobian), 0, 1);
    return vec4(normal.x, normal.y, normal.z, compression);
  });

  const surface = normalAndCompression();
  material.normalNode = surface.xyz;
  material.colorNode = Fn(() => {
    const clearBase = mix(shallowTint, deepTint, depthT);
    const stormBase = mix(clearBase, stormTint, stormAmount);
    const foam = clamp(surface.w.mul(2.2).sub(0.12), 0, 1);
    const daylightFoam = foam.mul(float(0.65).add(dayAmount.mul(0.35)));
    return mix(stormBase, foamTint, daylightFoam);
  })();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = y;
  mesh.renderOrder = -50;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    fluidSim: true,
    gpuFFT: true,
    mesh,
    waterY: y,
    computeFrame,
    waveScale,
    fftTime,
    stormAmount,
    dayAmount,
    deepTint,
    shallowTint,
    resources: [h0Buffer, metaBuffer, mirrorBuffer, bitReverseBuffer, spectrumA, spectrumB, fftPing, fftPong, spatialA, spatialB],
  };
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  if (!handle?.gpuFFT || !renderer || typeof renderer.compute !== "function") return;
  handle.fftTime.value = Number.isFinite(elapsedTime) ? elapsedTime : 0;
  try {
    for (const computeNode of handle.computeFrame) renderer.compute(computeNode);
  } catch (err) {
    console.error("[gpu-fft-ocean] compute dispatch failed:", err);
    handle.fluidSimBroken = true;
    throw err;
  }
}

export function updateGPUFFTOceanVisuals(handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon, reflectionTexture, reflectionMatrix, refractionTexture, resolution, storm = 0, day = 1) {
  if (!handle?.gpuFFT) return;
  handle.stormAmount.value = THREE.MathUtils.clamp(storm, 0, 1);
  handle.dayAmount.value = THREE.MathUtils.clamp(day, 0, 1);
  handle.waveScale.value = 1 + THREE.MathUtils.clamp(storm, 0, 1) * 0.7;
  if (skyColor) {
    handle.deepTint.value.set(0x145f91).lerp(skyColor, 0.18);
    handle.shallowTint.value.set(0x65cbd5).lerp(skyColor, 0.12);
  }
}

export function disposeGPUFFTOcean(scene, handle) {
  if (!handle?.gpuFFT) return;
  scene.remove(handle.mesh);
  const cleanup = () => {
    handle.mesh.geometry.dispose();
    handle.mesh.material.dispose();
    for (const resource of handle.resources ?? []) {
      try {
        if (resource && typeof resource.dispose === "function") resource.dispose();
      } catch (err) {
        console.warn("[gpu-fft-ocean] buffer disposal skipped:", err);
      }
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(cleanup));
}