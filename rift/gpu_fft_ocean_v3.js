import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean_v2.js";

// Validation integration layer.
//
// The previous 3D breaker ribbon is intentionally disabled while the rebuilt
// shallow-water solver is validated. Keeping only FFT + the stable finite-depth
// surface gives us a clean baseline: if any spike remains, it is in the base
// simulation/render path rather than a second overlapping breaker mesh.

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle?.gpuFFT) return handle;
  handle.fftBreakerHandle = null;
  console.info("[gpu-fft-ocean] ACTIVE: stable FFT + shallow-water validation build (breaker ribbon disabled)");
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  return updateBaseOcean(handle, renderer, elapsedTime);
}

export function updateGPUFFTOceanVisuals(
  handle,
  elapsed,
  skyColor,
  cameraY,
  playerPos,
  sunDir,
  skyHorizon,
  reflectionTexture,
  reflectionMatrix,
  refractionTexture,
  resolution,
  storm = 0,
  day = 1,
) {
  if (!handle?.gpuFFT) return;
  updateBaseVisuals(
    handle,
    elapsed,
    skyColor,
    cameraY,
    playerPos,
    sunDir,
    skyHorizon,
    reflectionTexture,
    reflectionMatrix,
    refractionTexture,
    resolution,
    storm,
    day,
  );
}

export function disposeGPUFFTOcean(scene, handle) {
  if (handle) handle.fftBreakerHandle = null;
  return disposeBaseOcean(scene, handle);
}
