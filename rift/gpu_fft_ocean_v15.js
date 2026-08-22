import * as oceanV14 from "./gpu_fft_ocean_v14.js";
import {
  installShoreFoamLayers,
  updateShoreFoamLayers,
  disposeShoreFoamLayers,
} from "./shore_foam_layers_v1.js";

// Water Pro v15 — continuous 3D shoreline wash/foam presentation.
// The FFT and existing surf compute graph remain untouched. v15 replaces only
// the visible grid-like swash presentation with three CPU-updated shoreline
// ribbon meshes, so Safari sees no new compute/storage/node work.

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = oceanV14.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
  if (handle?.gpuFFT) {
    installShoreFoamLayers(scene, handle.fftSurfSystem, sampleHeight, y);
    handle.__riftWaterProBackend = "v9-two-fft + v15-3d-shore-foam";
    console.info("[rift-water] Water Pro v15: continuous 3D shoreline wash + foam ribbons");
  }
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  return oceanV14.updateGPUFFTOcean(handle, renderer, elapsedTime);
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
  oceanV14.updateGPUFFTOceanVisuals(
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
  updateShoreFoamLayers(handle?.fftSurfSystem, elapsed, cameraY, storm, day);
}

export function updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt = 1 / 60) {
  return oceanV14.updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt);
}

export function disposeGPUFFTOcean(scene, handle) {
  disposeShoreFoamLayers(scene, handle?.fftSurfSystem);
  return oceanV14.disposeGPUFFTOcean(scene, handle);
}
