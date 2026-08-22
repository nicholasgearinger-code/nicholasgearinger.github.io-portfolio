import * as oceanV15 from "./gpu_fft_ocean_v15.js";
import { polishShoreFoamLayers } from "./shore_foam_layers_v2.js";

// Water Pro v16 — denser white aerated shoreline foam.
// This pass changes only the existing shoreline ribbon material values.
// No FFT, compute, storage-buffer, MRT, SSR, or node-graph changes.

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = oceanV15.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
  if (handle?.gpuFFT) {
    polishShoreFoamLayers(handle.fftSurfSystem, 0, 1);
    handle.__riftWaterProBackend = "v9-two-fft + v16-dense-white-shore-foam";
    console.info("[rift-water] Water Pro v16: denser white aerated shoreline foam");
  }
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  return oceanV15.updateGPUFFTOcean(handle, renderer, elapsedTime);
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
  oceanV15.updateGPUFFTOceanVisuals(
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
  polishShoreFoamLayers(handle?.fftSurfSystem, storm, day);
}

export function updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt = 1 / 60) {
  return oceanV15.updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt);
}

export function disposeGPUFFTOcean(scene, handle) {
  return oceanV15.disposeGPUFFTOcean(scene, handle);
}
