import {
  Fn, instanceIndex, instancedArray, float, uint, uniform, vec4,
  sin, cos,
} from "three/tsl";

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

function buildSpectrumData({ N, domain, seed, windSpeed, windDirection, amplitude, highFrequencyDamping }) {
  const count = N * N;
  const h0 = new Float32Array(count * 4);
  const meta = new Float32Array(count * 4);
  const mirror = new Float32Array(count);
  const bitReverse = new Float32Array(N);
  const rand = mulberry32(seed);
  const wx0 = windDirection?.[0] ?? 1;
  const wz0 = windDirection?.[1] ?? 0.22;
  const wl = Math.max(1e-6, Math.hypot(wx0, wz0));
  const windX = wx0 / wl;
  const windZ = wz0 / wl;
  const L = (windSpeed * windSpeed) / GRAVITY;
  const dampingLength = L * highFrequencyDamping;
  const bits = Math.log2(N);
  for (let i = 0; i < N; i++) bitReverse[i] = reverseBits(i, bits);

  for (let z = 0; z < N; z++) {
    const kzIndex = z <= N / 2 ? z : z - N;
    for (let x = 0; x < N; x++) {
      const kxIndex = x <= N / 2 ? x : x - N;
      const i = z * N + x;
      const kx = TAU * kxIndex / domain;
      const kz = TAU * kzIndex / domain;
      const k2 = kx * kx + kz * kz;
      const k = Math.sqrt(k2);
      let nx = 0, nz = 0, omega = 0, re = 0, im = 0;
      if (k > 1e-7) {
        nx = kx / k;
        nz = kz / k;
        omega = Math.sqrt(GRAVITY * k);
        const kw = nx * windX + nz * windZ;
        const forward = Math.max(0, kw);
        const crossSea = 1 - Math.min(1, Math.abs(kw));
        const directional = 0.055 + 0.865 * forward * forward + 0.080 * crossSea;
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
      meta[i * 4] = nx;
      meta[i * 4 + 1] = nz;
      meta[i * 4 + 2] = k;
      meta[i * 4 + 3] = omega;
      mirror[i] = ((N - z) % N) * N + ((N - x) % N);
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
    const z = i.div(uint(N));
    const axis = horizontal ? x : z;
    const reversed = bitReverseBuffer.element(axis).toUint();
    const sourceIndex = horizontal ? z.mul(uint(N)).add(reversed) : reversed.mul(uint(N)).add(x);
    output.element(i).assign(input.element(sourceIndex));
  })().compute(count);

  const makeButterfly = (input, output, horizontal, stage) => {
    const span = 1 << (stage + 1);
    const half = span >> 1;
    return Fn(() => {
      const i = instanceIndex;
      const x = i.mod(uint(N));
      const z = i.div(uint(N));
      const axis = horizontal ? x : z;
      const fixed = horizontal ? z : x;
      const groupStart = axis.div(uint(span)).mul(uint(span));
      const offset = axis.mod(uint(half));
      const firstAxis = groupStart.add(offset);
      const secondAxis = firstAxis.add(uint(half));
      const firstIndex = horizontal ? fixed.mul(uint(N)).add(firstAxis) : firstAxis.mul(uint(N)).add(fixed);
      const secondIndex = horizontal ? fixed.mul(uint(N)).add(secondAxis) : secondAxis.mul(uint(N)).add(fixed);
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
        A.x.add(b0r.mul(sign)), A.y.add(b0i.mul(sign)),
        A.z.add(b1r.mul(sign)), A.w.add(b1i.mul(sign)),
      ));
    })().compute(count);
  };

  const makeCopy = (input, output, scale) => Fn(() => {
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

export function createOceanFFTCascade(options = {}) {
  const N = options.N ?? 64;
  if ((N & (N - 1)) !== 0) throw new Error("FFT cascade N must be a power of two");
  const domain = options.domain ?? 72;
  const count = N * N;
  const data = buildSpectrumData({
    N, domain,
    seed: options.seed ?? 90210,
    windSpeed: options.windSpeed ?? 11.5,
    windDirection: options.windDirection ?? [1, 0.23],
    amplitude: options.amplitude ?? 0.00016,
    highFrequencyDamping: options.highFrequencyDamping ?? 0.00055,
  });
  const h0Buffer = instancedArray(data.h0, "vec4");
  const metaBuffer = instancedArray(data.meta, "vec4");
  const mirrorBuffer = instancedArray(data.mirror, "float");
  const bitReverseBuffer = instancedArray(data.bitReverse, "float");
  const spectrumA = instancedArray(count, "vec4");
  const spectrumB = instancedArray(count, "vec4");
  const pingA = instancedArray(count, "vec4");
  const pongA = instancedArray(count, "vec4");
  const pingB = instancedArray(count, "vec4");
  const pongB = instancedArray(count, "vec4");
  const spatialA = instancedArray(count, "vec4");
  const spatialB = instancedArray(count, "vec4");
  const waveScale = uniform(options.waveScale ?? 10.5);
  const fftTime = uniform(0.0);
  const choppiness = options.choppiness ?? 1.65;

  const computeSpectrum = Fn(() => {
    const i = instanceIndex;
    const h0k = h0Buffer.element(i);
    const h0m = h0Buffer.element(mirrorBuffer.element(i).toUint());
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
    const dxScale = meta.x.mul(float(choppiness));
    const dzScale = meta.y.mul(float(choppiness));
    spectrumA.element(i).assign(vec4(hR, hI, hI.mul(dxScale), float(0).sub(hR.mul(dxScale))));
    spectrumB.element(i).assign(vec4(hI.mul(dzScale), float(0).sub(hR.mul(dzScale)), 0, 0));
  })().compute(count);

  const fftA = createPackedFFTKernelSet(N, spectrumA, spatialA, pingA, pongA, bitReverseBuffer);
  const fftB = createPackedFFTKernelSet(N, spectrumB, spatialB, pingB, pongB, bitReverseBuffer);
  return {
    gpuFFTStandalone: true, N, domain, count, spatialA, spatialB, waveScale, fftTime,
    computeFrame: [computeSpectrum, ...fftA, ...fftB],
    resources: [h0Buffer, metaBuffer, mirrorBuffer, bitReverseBuffer, spectrumA, spectrumB, pingA, pongA, pingB, pongB, spatialA, spatialB],
  };
}

export function updateOceanFFTCascade(handle, renderer, elapsedTime = 0) {
  if (!handle?.gpuFFTStandalone || !renderer || typeof renderer.compute !== "function") return;
  handle.fftTime.value = Number.isFinite(elapsedTime) ? elapsedTime : 0;
  for (const node of handle.computeFrame) renderer.compute(node);
}

export function disposeOceanFFTCascade(handle) {
  if (!handle?.gpuFFTStandalone) return;
  for (const resource of handle.resources ?? []) {
    try { resource?.dispose?.(); } catch (_) {}
  }
  handle.gpuFFTStandalone = false;
}
