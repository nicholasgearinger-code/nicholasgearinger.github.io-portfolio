import {
  Fn, instanceIndex, instancedArray, uniform,
  float, uint, vec4, max, min, abs, clamp, smoothstep, mix,
} from "three/tsl";

const TOUCH_DEVICE = typeof window !== "undefined" && (
  "ontouchstart" in window || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
);

export function createPersistentOceanFoam(cascade) {
  // Safari/iPhone WebGPU is much more sensitive to storage-buffer pressure in
  // fragment stages. The v8 water material already reads several spectral and
  // shallow-water storage fields, so binding another compute-written storage
  // buffer into that fragment graph can invalidate the WebGPU command encoder
  // on some devices. Keep the persistent Jacobian foam field on desktop, while
  // touch devices use the existing compression/curvature whitecaps from the
  // base ocean shader. This preserves the third FFT cascade and its motion while
  // removing the risky extra storage binding/compute pass on mobile.
  if (TOUCH_DEVICE || !cascade?.gpuFFTStandalone) return null;

  const N = cascade.N;
  const count = N * N;
  const spacing = cascade.domain / N;
  const inv2dx = 1 / (2 * spacing);
  const foamA = instancedArray(new Float32Array(count * 4), "vec4");
  const foamB = instancedArray(new Float32Array(count * 4), "vec4");
  const dtUniform = uniform(1 / 60);
  const stormUniform = uniform(0.0);

  const computeFoam = Fn(() => {
    const i = instanceIndex;
    const row = uint(N);
    const x = i.mod(row);
    const z = i.div(row);
    const xL = x.add(uint(N - 1)).mod(row);
    const xR = x.add(uint(1)).mod(row);
    const zD = z.add(uint(N - 1)).mod(row);
    const zU = z.add(uint(1)).mod(row);

    const iL = z.mul(row).add(xL);
    const iR = z.mul(row).add(xR);
    const iD = zD.mul(row).add(x);
    const iU = zU.mul(row).add(x);

    const aC = cascade.spatialA.element(i);
    const aL = cascade.spatialA.element(iL);
    const aR = cascade.spatialA.element(iR);
    const aD = cascade.spatialA.element(iD);
    const aU = cascade.spatialA.element(iU);
    const zL = cascade.spatialB.element(iL).x;
    const zR = cascade.spatialB.element(iR).x;
    const zDsp = cascade.spatialB.element(iD).x;
    const zUsp = cascade.spatialB.element(iU).x;

    const dDxdx = aR.z.sub(aL.z).mul(float(inv2dx));
    const dDzdx = zR.sub(zL).mul(float(inv2dx));
    const dDxdz = aU.z.sub(aD.z).mul(float(inv2dx));
    const dDzdz = zUsp.sub(zDsp).mul(float(inv2dx));
    const jacobian = float(1).add(dDxdx)
      .mul(float(1).add(dDzdz))
      .sub(dDxdz.mul(dDzdx));
    const compression = clamp(float(1).sub(jacobian), 0, 1);

    const curvature = abs(aR.x.add(aL.x).sub(aC.x.mul(2)))
      .add(abs(aU.x.add(aD.x).sub(aC.x.mul(2))));
    const breaking = max(
      smoothstep(float(0.055), float(0.34), compression),
      smoothstep(float(0.020), float(0.22), curvature).mul(0.42),
    );

    const previous = foamA.element(i).x;
    const upstream = foamA.element(iL).x.mul(0.66)
      .add(foamA.element(iD).x.mul(0.34));
    const advected = mix(previous, upstream, min(dtUniform.mul(0.82), float(0.11)));
    const decay = max(float(0), float(1).sub(dtUniform.mul(float(0.12).add(stormUniform.mul(0.035)))));
    const injection = breaking
      .mul(dtUniform)
      .mul(float(1.8).add(stormUniform.mul(1.25)));
    const foam = clamp(advected.mul(decay).add(injection), 0, 1);

    foamB.element(i).assign(vec4(foam, compression, curvature, 1));
  })().compute(count);

  const copyFoam = Fn(() => {
    foamA.element(instanceIndex).assign(foamB.element(instanceIndex));
  })().compute(count);

  return {
    gpuOceanFoam: true,
    N,
    domain: cascade.domain,
    foam: foamA,
    scratch: foamB,
    dtUniform,
    stormUniform,
    computeFrame: [computeFoam, copyFoam],
    lastElapsed: null,
    resources: [foamA, foamB],
  };
}

export function updatePersistentOceanFoam(handle, renderer, elapsedTime = 0, storm = 0) {
  if (!handle?.gpuOceanFoam || !renderer || typeof renderer.compute !== "function") return;
  const now = Number.isFinite(elapsedTime) ? elapsedTime : 0;
  let dt = 1 / 60;
  if (Number.isFinite(handle.lastElapsed)) {
    dt = Math.max(1 / 240, Math.min(1 / 24, now - handle.lastElapsed));
  }
  handle.lastElapsed = now;
  handle.dtUniform.value = dt;
  handle.stormUniform.value = Math.max(0, Math.min(1, Number.isFinite(storm) ? storm : 0));
  for (const node of handle.computeFrame) renderer.compute(node);
}

export function disposePersistentOceanFoam(handle) {
  if (!handle?.gpuOceanFoam) return;
  for (const resource of handle.resources ?? []) {
    try { resource?.dispose?.(); } catch (_) {}
  }
  handle.gpuOceanFoam = false;
}
