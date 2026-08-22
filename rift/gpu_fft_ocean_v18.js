import * as oceanV17 from "./gpu_fft_ocean_v17.js";
import { updateReferenceSwashSheet } from "./shore_foam_layers_v4.js";

// Water Pro v18 — coherent beach swash sheet.
// v18 changes only CPU-side shoreline ribbon geometry/material presentation.
// FFT, shallow-water compute, storage buffers, and node graphs remain untouched.

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = oceanV17.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
  if (handle?.gpuFFT) {
    updateReferenceSwashSheet(handle.fftSurfSystem, 0, 0, 1);
    handle.__riftWaterProBackend = "v9-two-fft + v18-coherent-swash-sheet";
    console.info("[rift-water] Water Pro v18: coherent run-up/retreat shoreline foam sheet");
  }
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  return oceanV17.updateGPUFFTOcean(handle, renderer, elapsedTime);
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
  oceanV17.updateGPUFFTOceanVisuals(
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
  updateReferenceSwashSheet(handle?.fftSurfSystem, elapsed, storm, day);
}

export function updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt = 1 / 60) {
  return oceanV17.updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt);
}

export function disposeGPUFFTOcean(scene, handle) {
  return oceanV17.disposeGPUFFTOcean(scene, handle);
}
