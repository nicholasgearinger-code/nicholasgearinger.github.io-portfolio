import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean_v2.js";
import {
  createGPUShoreBreakers,
  updateGPUShoreBreakers,
  disposeGPUShoreBreakers,
} from "./gpu_shore_breakers.js";

// Thin integration layer: the stable FFT + shallow-water surface remains in v2.
// The breaker ribbon is deliberately separate so overturning geometry can be
// tuned or removed without destabilizing the main ocean mesh again.

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle?.gpuFFT) return handle;

  handle.fftBreakerHandle = createGPUShoreBreakers(
    scene,
    sampleHeight,
    y,
    handle.fftShallowHandle,
  );

  if (handle.fftBreakerHandle) {
    console.info("[gpu-fft-ocean] ACTIVE: FFT + shallow-water + 3D shore breaker ribbon");
  }
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

  if (handle.fftBreakerHandle?.gpuShoreBreakers) {
    updateGPUShoreBreakers(
      handle.fftBreakerHandle,
      elapsed,
      cameraY,
      handle.waterY,
      storm,
      day,
      sunDir,
    );
  }
}

export function disposeGPUFFTOcean(scene, handle) {
  if (handle?.fftBreakerHandle?.gpuShoreBreakers) {
    disposeGPUShoreBreakers(scene, handle.fftBreakerHandle);
  }
  if (handle) handle.fftBreakerHandle = null;
  return disposeBaseOcean(scene, handle);
}
