import * as oceanV16 from "./gpu_fft_ocean_v16.js";
import {
  polishMilkyShoreFoam,
  disposeMilkyShoreFoam,
} from "./shore_foam_layers_v3.js";

// Water Pro v17 — milky foam rafts + bubble-cell shoreline skin.
// Keeps the proven FFT/swash compute graph intact. This adds only CPU-generated
// alpha maps and one ordinary mesh sharing the existing foam-body geometry.

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = oceanV16.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
  if (handle?.gpuFFT) {
    polishMilkyShoreFoam(handle.fftSurfSystem, 0, 0, 1);
    handle.__riftWaterProBackend = "v9-two-fft + v17-milky-bubble-foam";
    console.info("[rift-water] Water Pro v17: milky shoreline foam rafts + bubble cells");
  }
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  return oceanV16.updateGPUFFTOcean(handle, renderer, elapsedTime);
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
  oceanV16.updateGPUFFTOceanVisuals(
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
  polishMilkyShoreFoam(handle?.fftSurfSystem, elapsed, storm, day);
}

export function updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt = 1 / 60) {
  return oceanV16.updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt);
}

export function disposeGPUFFTOcean(scene, handle) {
  disposeMilkyShoreFoam(handle?.fftSurfSystem);
  return oceanV16.disposeGPUFFTOcean(scene, handle);
}
