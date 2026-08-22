import * as oceanV18 from "./gpu_fft_ocean_v18.js";
import {
  installPersistentShoreFoam,
  updatePersistentShoreFoam,
  disposePersistentShoreFoam,
} from "./shore_persistent_foam_v1.js";

// Water Pro v19 — WaveWorks-inspired Stage 1 persistent foam field.
// Breaker energy deposits foam near shore, then a tiny CPU field advects,
// diffuses, and decays it through run-up/backwash. No new GPU compute work.

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = oceanV18.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
  if (handle?.gpuFFT) {
    installPersistentShoreFoam(handle.fftSurfSystem);
    handle.__riftWaterProBackend = "v9-two-fft + v19-persistent-foam-field";
    console.info("[rift-water] Water Pro v19: persistent breaker-driven shoreline foam field");
  }
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  return oceanV18.updateGPUFFTOcean(handle, renderer, elapsedTime);
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
  oceanV18.updateGPUFFTOceanVisuals(
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
  updatePersistentShoreFoam(handle?.fftSurfSystem, elapsed, cameraY, storm, day, handle);
}

export function updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt = 1 / 60) {
  return oceanV18.updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt);
}

export function disposeGPUFFTOcean(scene, handle) {
  disposePersistentShoreFoam(handle?.fftSurfSystem);
  return oceanV18.disposeGPUFFTOcean(scene, handle);
}
