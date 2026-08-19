import * as THREE from "three";
import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean.js";
import {
  createGPUShallowWater,
  updateGPUShallowWater,
  disposeGPUShallowWater,
  SHALLOW_N,
  SHALLOW_DOMAIN,
} from "./gpu_shallow_water.js";
import {
  Fn, uniform, color, float, uint, vec3,
  positionLocal, positionView, positionWorld, positionViewDirection, cameraPosition,
  attribute, floor, min, max, dFdx, dFdy, cross, dot, abs, pow, mix, clamp,
  smoothstep,
} from "three/tsl";

const FFT_N = 128;
// Bicubic reconstruction provides much more curvature per simulation cell than
// the previous 640^2 four-corner interpolation. 512^2 keeps the mobile vertex
// cost under control while the 4x4 reconstruction removes broad planar facets.
const RENDER_N = 512;
const DETAIL_DOMAIN = 420;

const DAY_SURFACE = new THREE.Color(0x0b3c49);
const NIGHT_SURFACE = new THREE.Color(0x06151f);
const STORM_SURFACE = new THREE.Color(0x06191d);
const DAY_CREST = new THREE.Color(0xdceceb);
const NIGHT_CREST = new THREE.Color(0x6f8fa0);
const DAY_FOAM = new THREE.Color(0xf1f6f3);
const NIGHT_FOAM = new THREE.Color(0x8ca1aa);
const DAY_UNDERWATER = new THREE.Color(0x168da0);
const NIGHT_UNDERWATER = new THREE.Color(0x082e48);

function positiveFract(v) {
  return ((v % 1) + 1) % 1;
}

function smooth01(t) {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

function smoothWeight(t) {
  return t.mul(t).mul(float(3).sub(t.mul(2)));
}

// Uniform Catmull-Rom spline. Unlike smoothstep-bilinear interpolation this
// preserves a continuous-looking tangent through cell boundaries by using the
// two neighboring samples on either side of the active interval.
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t.mul(t);
  const t3 = t2.mul(t);
  return p1.mul(2)
    .add(p2.sub(p0).mul(t))
    .add(p0.mul(2).sub(p1.mul(5)).add(p2.mul(4)).sub(p3).mul(t2))
    .add(p0.negate().add(p1.mul(3)).sub(p2.mul(3)).add(p3).mul(t3))
    .mul(0.5);
}

function buildDenseRenderGeometry(size, waterY, sampleHeight) {
  const geometry = new THREE.PlaneGeometry(size, size, RENDER_N - 1, RENDER_N - 1);
  geometry.rotateX(-Math.PI / 2);

  const count = geometry.attributes.position.count;
  const longCoords = new Float32Array(count * 2);
  const detailCoords = new Float32Array(count * 2);
  const shallowCoords = new Float32Array(count * 2);
  const shallowCoverage = new Float32Array(count);
  const shore = new Float32Array(count);
  const depthWorld = new Float32Array(count);
  const pos = geometry.attributes.position;

  for (let ry = 0; ry < RENDER_N; ry++) {
    const fy = ry * (FFT_N - 1) / (RENDER_N - 1);
    for (let rx = 0; rx < RENDER_N; rx++) {
      const fx = rx * (FFT_N - 1) / (RENDER_N - 1);
      const i = ry * RENDER_N + rx;
      longCoords[i * 2] = fx;
      longCoords[i * 2 + 1] = fy;

      const x = pos.getX(i);
      const z = pos.getZ(i);
      detailCoords[i * 2] = positiveFract(x / DETAIL_DOMAIN + 0.5) * FFT_N;
      detailCoords[i * 2 + 1] = positiveFract(z / DETAIL_DOMAIN + 0.5) * FFT_N;

      const sgx = (x / SHALLOW_DOMAIN + 0.5) * (SHALLOW_N - 1);
      const sgz = (z / SHALLOW_DOMAIN + 0.5) * (SHALLOW_N - 1);
      shallowCoords[i * 2] = THREE.MathUtils.clamp(sgx, 0, SHALLOW_N - 1);
      shallowCoords[i * 2 + 1] = THREE.MathUtils.clamp(sgz, 0, SHALLOW_N - 1);

      const squareRadius = Math.max(Math.abs(x), Math.abs(z)) / (SHALLOW_DOMAIN * 0.5);
      shallowCoverage[i] = 1 - smooth01((squareRadius - 0.80) / 0.18);

      const groundY = sampleHeight ? sampleHeight(x, z) : null;
      const signedDepth = groundY === null ? 12 : waterY - groundY;
      const depth = Math.max(0, signedDepth);
      depthWorld[i] = Math.min(depth, 24);

      if (signedDepth <= -0.35) shore[i] = 0;
      else if (signedDepth < 0) {
        const t = (signedDepth + 0.35) / 0.35;
        shore[i] = smooth01(t) * 0.08;
      } else {
        shore[i] = 0.08 + smooth01(signedDepth / 2.5) * 0.92;
      }
    }
  }

  geometry.setAttribute("fftCoordLong", new THREE.Float32BufferAttribute(longCoords, 2));
  geometry.setAttribute("fftCoordDetail", new THREE.Float32BufferAttribute(detailCoords, 2));
  geometry.setAttribute("shallowCoord", new THREE.Float32BufferAttribute(shallowCoords, 2));
  geometry.setAttribute("shallowCoverage", new THREE.Float32BufferAttribute(shallowCoverage, 1));
  geometry.setAttribute("fftShoreDense", new THREE.Float32BufferAttribute(shore, 1));
  geometry.setAttribute("fftDepthWorld", new THREE.Float32BufferAttribute(depthWorld, 1));
  return geometry;
}

function sampleSmoothVec4(buffer, coord, N) {
  const x0f = floor(coord.x);
  const z0f = floor(coord.y);
  const x1f = min(x0f.add(1), float(N - 1));
  const z1f = min(z0f.add(1), float(N - 1));
  const tx = smoothWeight(coord.x.sub(x0f));
  const tz = smoothWeight(coord.y.sub(z0f));
  const row = uint(N);
  const i00 = z0f.toUint().mul(row).add(x0f.toUint());
  const i10 = z0f.toUint().mul(row).add(x1f.toUint());
  const i01 = z1f.toUint().mul(row).add(x0f.toUint());
  const i11 = z1f.toUint().mul(row).add(x1f.toUint());
  const a0 = mix(buffer.element(i00), buffer.element(i10), tx);
  const a1 = mix(buffer.element(i01), buffer.element(i11), tx);
  return mix(a0, a1, tz);
}

function sampleSmoothScalar(buffer, coord, N, component = "x", wrap = false) {
  const x0f = floor(coord.x);
  const z0f = floor(coord.y);
  const x1f = wrap ? x0f.add(1).mod(float(N)) : min(x0f.add(1), float(N - 1));
  const z1f = wrap ? z0f.add(1).mod(float(N)) : min(z0f.add(1), float(N - 1));
  const tx = smoothWeight(coord.x.sub(x0f));
  const tz = smoothWeight(coord.y.sub(z0f));
  const row = uint(N);
  const i00 = z0f.toUint().mul(row).add(x0f.toUint());
  const i10 = z0f.toUint().mul(row).add(x1f.toUint());
  const i01 = z1f.toUint().mul(row).add(x0f.toUint());
  const i11 = z1f.toUint().mul(row).add(x1f.toUint());
  const v00 = buffer.element(i00)[component];
  const v10 = buffer.element(i10)[component];
  const v01 = buffer.element(i01)[component];
  const v11 = buffer.element(i11)[component];
  return mix(mix(v00, v10, tx), mix(v01, v11, tx), tz);
}

function sampleCubicVec4(buffer, coord, N) {
  const bx = floor(coord.x);
  const bz = floor(coord.y);
  const tx = coord.x.sub(bx);
  const tz = coord.y.sub(bz);
  const row = uint(N);

  const x0 = max(bx.sub(1), float(0)).toUint();
  const x1 = clamp(bx, 0, N - 1).toUint();
  const x2 = min(bx.add(1), float(N - 1)).toUint();
  const x3 = min(bx.add(2), float(N - 1)).toUint();
  const z0 = max(bz.sub(1), float(0)).toUint();
  const z1 = clamp(bz, 0, N - 1).toUint();
  const z2 = min(bz.add(1), float(N - 1)).toUint();
  const z3 = min(bz.add(2), float(N - 1)).toUint();

  const r0 = catmullRom(
    buffer.element(z0.mul(row).add(x0)), buffer.element(z0.mul(row).add(x1)),
    buffer.element(z0.mul(row).add(x2)), buffer.element(z0.mul(row).add(x3)), tx,
  );
  const r1 = catmullRom(
    buffer.element(z1.mul(row).add(x0)), buffer.element(z1.mul(row).add(x1)),
    buffer.element(z1.mul(row).add(x2)), buffer.element(z1.mul(row).add(x3)), tx,
  );
  const r2 = catmullRom(
    buffer.element(z2.mul(row).add(x0)), buffer.element(z2.mul(row).add(x1)),
    buffer.element(z2.mul(row).add(x2)), buffer.element(z2.mul(row).add(x3)), tx,
  );
  const r3 = catmullRom(
    buffer.element(z3.mul(row).add(x0)), buffer.element(z3.mul(row).add(x1)),
    buffer.element(z3.mul(row).add(x2)), buffer.element(z3.mul(row).add(x3)), tx,
  );
  return catmullRom(r0, r1, r2, r3, tz);
}

function installCoupledGeometry(handle, detailHandle, shallowHandle, size, sampleHeight) {
  if (!handle?.gpuFFT || !detailHandle?.gpuFFT || !shallowHandle?.gpuShallowWater || handle.fftDenseGeometryApplied) return;
  const longA = handle.resources?.[8];
  const longB = handle.resources?.[9];
  const detailA = detailHandle.resources?.[8];
  const detailB = detailHandle.resources?.[9];
  const shallowState = shallowHandle.state;
  if (!longA || !longB || !detailA || !detailB || !shallowState) return;

  const geometry = buildDenseRenderGeometry(size, handle.waterY ?? 0, sampleHeight);
  const longCoord = attribute("fftCoordLong", "vec2");
  const detailCoord = attribute("fftCoordDetail", "vec2");
  const shallowCoord = attribute("shallowCoord", "vec2");
  const coverage = attribute("shallowCoverage", "float");
  const shore = attribute("fftShoreDense", "float");
  const depth = attribute("fftDepthWorld", "float");

  handle.mesh.material.positionNode = Fn(() => {
    // The large swell and shallow-water elevation get true 4x4 reconstruction;
    // these are the fields that dominate the visible silhouette. Horizontal
    // choppy channels remain four-sample to keep the mobile vertex cost sane.
    const la = sampleCubicVec4(longA, longCoord, FFT_N);
    const ldz = sampleSmoothScalar(longB, longCoord, FFT_N, "x", false);

    const dx0f = floor(detailCoord.x);
    const dz0f = floor(detailCoord.y);
    const dx1f = dx0f.add(1).mod(float(FFT_N));
    const dz1f = dz0f.add(1).mod(float(FFT_N));
    const dtx = smoothWeight(detailCoord.x.sub(dx0f));
    const dtz = smoothWeight(detailCoord.y.sub(dz0f));
    const row = uint(FFT_N);
    const di00 = dz0f.toUint().mul(row).add(dx0f.toUint());
    const di10 = dz0f.toUint().mul(row).add(dx1f.toUint());
    const di01 = dz1f.toUint().mul(row).add(dx0f.toUint());
    const di11 = dz1f.toUint().mul(row).add(dx1f.toUint());
    const da0 = mix(detailA.element(di00), detailA.element(di10), dtx);
    const da1 = mix(detailA.element(di01), detailA.element(di11), dtx);
    const da = mix(da0, da1, dtz);
    const ddz = mix(
      mix(detailB.element(di00).x, detailB.element(di10).x, dtx),
      mix(detailB.element(di01).x, detailB.element(di11).x, dtx),
      dtz,
    );

    const shallow = sampleCubicVec4(shallowState, shallowCoord, SHALLOW_N);

    const longAmp = smoothstep(float(3.0), float(12.0), depth);
    const detailAmp = smoothstep(float(9.0), float(21.0), depth);
    const shallowDepthBlend = float(1).sub(smoothstep(float(7.0), float(16.0), depth));
    const shallowBlend = shallowDepthBlend.mul(coverage);

    const fftX = la.z.mul(longAmp).mul(0.68).add(da.z.mul(0.24).mul(detailAmp));
    const fftY = la.x.mul(longAmp).add(da.x.mul(0.44).mul(detailAmp));
    const fftZ = ldz.mul(longAmp).mul(0.68).add(ddz.mul(0.24).mul(detailAmp));

    const horizontalFade = float(1).sub(shallowBlend.mul(0.96));
    const yDisp = mix(fftY, shallow.x, shallowBlend);

    return positionLocal.add(vec3(
      fftX.mul(shore).mul(horizontalFade),
      yDisp.mul(shore),
      fftZ.mul(shore).mul(horizontalFade),
    ));
  })();

  const oldGeometry = handle.mesh.geometry;
  handle.mesh.geometry = geometry;
  oldGeometry.dispose();
  handle.mesh.material.needsUpdate = true;
  handle.fftDenseGeometryApplied = true;
}

function setupSmoothFFTLighting(handle) {
  const material = handle?.mesh?.material;
  const shallowHandle = handle?.fftShallowHandle;
  if (!material || !shallowHandle?.gpuShallowWater || handle.fftSmoothLightingApplied) return;

  const surfaceColor = uniform(color(0x0b3138));
  const underwaterColor = uniform(color(0x168da0));
  const crestColor = uniform(color(0xdceceb));
  const foamColor = uniform(color(0xf1f6f3));
  const sunGlintColor = uniform(color(0xfff0d4));
  const moonGlintColor = uniform(color(0xa8cbea));
  const lightDirection = uniform(new THREE.Vector3(0.35, 0.8, 0.3));
  const daylight = uniform(1.0);
  const underwaterMix = uniform(0.0);
  const waterLevel = uniform(handle.waterY ?? 0);
  const foamStrength = uniform(1.0);

  const shallowCoord = attribute("shallowCoord", "vec2");
  const coverage = attribute("shallowCoverage", "float");
  const shallowState = shallowHandle.state;

  const geometricNormal = Fn(() => {
    const dx = dFdx(positionView);
    const dy = dFdy(positionView);
    return cross(dx, dy).normalize();
  })();
  const worldNormal = Fn(() => {
    const dx = dFdx(positionWorld);
    const dy = dFdy(positionWorld);
    return cross(dx, dy).normalize();
  })();
  material.normalNode = geometricNormal;

  const fresnel = Fn(() => {
    const facing = clamp(abs(dot(geometricNormal, positionViewDirection)), 0, 1);
    return pow(float(1).sub(facing), float(4.0));
  })();

  const crest = smoothstep(waterLevel.add(0.55), waterLevel.add(2.9), positionWorld.y);
  const slope = clamp(float(1).sub(abs(worldNormal.y)), 0, 1);
  const steepCrest = smoothstep(float(0.15), float(0.44), slope)
    .mul(smoothstep(float(0.30), float(0.86), crest));
  const offshoreWhitecap = clamp(
    steepCrest.mul(foamStrength).mul(float(1).sub(underwaterMix.mul(0.86))),
    0, 1,
  );

  const shallow = sampleSmoothVec4(shallowState, shallowCoord, SHALLOW_N);
  const surfFoam = clamp(shallow.w.mul(coverage).mul(1.02), 0, 1);
  const whitecap = clamp(max(offshoreWhitecap, surfFoam), 0, 1)
    .mul(float(1).sub(underwaterMix.mul(0.88)));

  const viewDirWorld = cameraPosition.sub(positionWorld).normalize();
  const halfDir = lightDirection.normalize().add(viewDirWorld).normalize();
  const directFacing = clamp(dot(worldNormal, lightDirection.normalize()), 0, 1);
  const glint = pow(clamp(dot(worldNormal, halfDir), 0, 1), float(58))
    .mul(float(0.12).add(daylight.mul(0.88)))
    .mul(float(1).sub(underwaterMix.mul(0.72)));
  const glintColor = mix(moonGlintColor, sunGlintColor, daylight);

  material.colorNode = Fn(() => {
    const base = mix(surfaceColor, underwaterColor, underwaterMix);
    const grazingLight = mix(base, crestColor, fresnel.mul(0.24));
    const crestLight = crest.mul(float(1).sub(underwaterMix)).mul(0.07);
    const directionalLift = directFacing.mul(daylight.mul(0.07).add(0.022));
    const litWater = mix(grazingLight, crestColor, crestLight.add(directionalLift));
    const foamed = mix(litWater, foamColor, whitecap.mul(0.84));
    return mix(foamed, glintColor, clamp(glint.mul(0.72), 0, 0.68));
  })();

  const baseRoughness = mix(float(0.19), float(0.05), fresnel.mul(0.80).add(glint.mul(0.20)));
  material.roughnessNode = mix(baseRoughness, float(0.44), whitecap.mul(0.92));
  material.emissiveNode = underwaterColor
    .mul(underwaterMix.mul(float(0.035).add(daylight.mul(0.085))))
    .add(foamColor.mul(whitecap.mul(0.010)));
  material.needsUpdate = true;

  handle.fftSurfaceColor = surfaceColor;
  handle.fftUnderwaterColor = underwaterColor;
  handle.fftCrestColor = crestColor;
  handle.fftFoamColor = foamColor;
  handle.fftLightDirection = lightDirection;
  handle.fftDaylight = daylight;
  handle.fftUnderwaterMix = underwaterMix;
  handle.fftFoamStrength = foamStrength;
  handle.fftSmoothLightingApplied = true;
}

function applyPhotographicOceanLook(handle, underwater = false, day = 1, storm = 0, sunDir = null) {
  if (!handle?.gpuFFT) return;
  const dayT = Math.max(0, Math.min(1, day));
  const stormT = Math.max(0, Math.min(1, storm));
  if (handle.fftDaylight) handle.fftDaylight.value = dayT;
  if (handle.fftUnderwaterMix) handle.fftUnderwaterMix.value = underwater ? 1 : 0;
  if (handle.fftFoamStrength) handle.fftFoamStrength.value = 0.58 + stormT * 0.72;
  if (sunDir && handle.fftLightDirection?.value) handle.fftLightDirection.value.copy(sunDir).normalize();

  if (handle.fftSurfaceColor?.value) {
    handle.fftSurfaceColor.value.copy(NIGHT_SURFACE).lerp(DAY_SURFACE, dayT).lerp(STORM_SURFACE, stormT * 0.72);
  }
  if (handle.fftCrestColor?.value) handle.fftCrestColor.value.copy(NIGHT_CREST).lerp(DAY_CREST, dayT);
  if (handle.fftFoamColor?.value) handle.fftFoamColor.value.copy(NIGHT_FOAM).lerp(DAY_FOAM, dayT);
  if (handle.fftUnderwaterColor?.value) handle.fftUnderwaterColor.value.copy(NIGHT_UNDERWATER).lerp(DAY_UNDERWATER, dayT);

  if (underwater) {
    if (handle.deepTint?.value) handle.deepTint.value.set(0x0b5e70);
    if (handle.shallowTint?.value) handle.shallowTint.value.set(0x4fd7df);
    if (handle.mesh?.material) { handle.mesh.material.opacity = 0.72; handle.mesh.material.metalness = 0.0; }
  } else {
    if (handle.deepTint?.value) handle.deepTint.value.set(stormT > 0.45 ? 0x07191d : 0x082a31);
    if (handle.shallowTint?.value) handle.shallowTint.value.set(stormT > 0.45 ? 0x183b40 : 0x14535c);
    if (handle.mesh?.material) { handle.mesh.material.opacity = 0.965; handle.mesh.material.metalness = 0.012; }
  }
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle) return handle;

  const detailHandle = createBaseOcean(scene, y, DETAIL_DOMAIN, null);
  if (detailHandle?.mesh) {
    scene.remove(detailHandle.mesh);
    detailHandle.mesh.visible = false;
  }
  handle.fftDetailHandle = detailHandle;

  const shallowHandle = createGPUShallowWater(sampleHeight, y, handle.resources?.[8], size, SHALLOW_DOMAIN);
  handle.fftShallowHandle = shallowHandle;

  handle.waveScale.value = 38.5;
  if (detailHandle?.waveScale) detailHandle.waveScale.value = 27.0;
  handle.mesh.scale.y = 1.03;
  handle.fftVisualBoost = true;
  handle.fftUnderwater = false;

  installCoupledGeometry(handle, detailHandle, shallowHandle, size, sampleHeight);
  handle.mesh.material.normalNode = null;
  handle.mesh.material.colorNode = null;
  setupSmoothFFTLighting(handle);
  applyPhotographicOceanLook(handle, false, 1, 0, null);

  console.info("[gpu-fft-ocean] ACTIVE: bicubic FFT/shallow reconstruction + 512 render grid");
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  if (!handle?.gpuFFT) return;
  updateBaseOcean(handle, renderer, elapsedTime);
  if (handle.fftDetailHandle?.gpuFFT) updateBaseOcean(handle.fftDetailHandle, renderer, elapsedTime);
  if (handle.fftShallowHandle?.gpuShallowWater) updateGPUShallowWater(handle.fftShallowHandle, renderer, elapsedTime);
}

export function updateGPUFFTOceanVisuals(
  handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon,
  reflectionTexture, reflectionMatrix, refractionTexture, resolution,
  storm = 0, day = 1,
) {
  if (!handle?.gpuFFT) return;

  updateBaseVisuals(
    handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon,
    reflectionTexture, reflectionMatrix, refractionTexture, resolution, storm, day,
  );
  setupSmoothFFTLighting(handle);

  const stormT = Math.max(0, Math.min(1, storm));
  const underwater = Number.isFinite(cameraY) && cameraY < handle.waterY - 0.12;
  const longSet = Math.sin(elapsed * 0.071 + 0.4) * 1.4;
  const detailSet = Math.sin(elapsed * 0.173 + 1.9) * 1.2;

  handle.waveScale.value = 38.5 + longSet + stormT * 9.0;
  if (handle.fftDetailHandle?.waveScale) {
    handle.fftDetailHandle.waveScale.value = 27.0 + detailSet + stormT * 9.5;
  }
  if (handle.fftShallowHandle?.forcingStrength) {
    handle.fftShallowHandle.forcingStrength.value = 0.80 + stormT * 0.26;
  }
  handle.mesh.scale.y = 1.03 + stormT * 0.07;

  if (handle.fftUnderwater !== underwater) handle.fftUnderwater = underwater;
  applyPhotographicOceanLook(handle, underwater, day, storm, sunDir);
}

export function disposeGPUFFTOcean(scene, handle) {
  const detail = handle?.fftDetailHandle;
  const shallow = handle?.fftShallowHandle;
  if (handle) {
    handle.fftDetailHandle = null;
    handle.fftShallowHandle = null;
  }
  if (shallow?.gpuShallowWater) disposeGPUShallowWater(shallow);
  if (detail?.gpuFFT) disposeBaseOcean(scene, detail);
  return disposeBaseOcean(scene, handle);
}
