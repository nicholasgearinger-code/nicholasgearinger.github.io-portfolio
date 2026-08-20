import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  updateGPUFFTOceanRipples as updateBaseRipples,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean_v4.js";
import {
  createGPUSurfSystem,
  updateGPUSurfSystem,
  disposeGPUSurfSystem,
} from "./gpu_surf_system.js";

// Adds local breakers, beach wash and whitewater spray on top of the stable
// FFT + shallow-water + optics stack. The surf meshes are intentionally local
// disconnected patches so a bad shoreline sample cannot tear the global ocean.

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle?.gpuFFT) return handle;

  handle.fftSurfSystem = createGPUSurfSystem(
    scene,
    sampleHeight,
    y,
    handle.fftShallowHandle,
  );

  if (handle.fftSurfSystem) {
    console.info("[gpu-fft-ocean] ACTIVE: local breakers + beach wash + whitewater spray");
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

  if (handle?.fftSurfSystem?.gpuSurfSystem) {
    updateGPUSurfSystem(handle.fftSurfSystem, elapsed, cameraY, storm, day, sunDir);
  }
}

export function updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt = 1 / 60) {
  return updateBaseRipples(handle, playerPos, cameraY, dt);
}

export function disposeGPUFFTOcean(scene, handle) {
  if (handle?.fftSurfSystem?.gpuSurfSystem) {
    disposeGPUSurfSystem(scene, handle.fftSurfSystem);
  }
  if (handle) handle.fftSurfSystem = null;
  return disposeBaseOcean(scene, handle);
}
