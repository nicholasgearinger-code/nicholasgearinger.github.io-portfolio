import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean.js";

// Visual/animation tuning layered over the real 128x128 GPU FFT simulation.
// The base FFT currently normalizes each inverse transform by N^2, so the
// physically generated Phillips amplitudes land at only centimeter-scale in
// this game's world units. This wrapper calibrates that resolved FFT field to
// visible open-ocean scale without changing the butterfly implementation.

function applyRoughOceanLook(handle) {
  if (!handle?.gpuFFT) return;

  if (handle.deepTint?.value) handle.deepTint.value.set(0x0a2930);
  if (handle.shallowTint?.value) handle.shallowTint.value.set(0x1b5962);

  if (handle.mesh?.material) {
    handle.mesh.material.color?.set?.(0x10383f);
    handle.mesh.material.roughness = 0.14;
    handle.mesh.material.metalness = 0.015;
    handle.mesh.material.opacity = 0.96;
  }
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle) return handle;

  // Calibrated from the current spectrum: 2.7 was effectively flat after the
  // inverse-FFT 1/(128^2) normalization. ~45 brings the same genuine FFT field
  // into meter-scale motion rather than inventing a separate procedural wave.
  handle.waveScale.value = 45.0;
  handle.mesh.scale.y = 1.08;
  handle.fftVisualBoost = true;
  applyRoughOceanLook(handle);

  console.info("[gpu-fft-ocean] ACTIVE: calibrated rough open-ocean FFT");
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

  const stormT = Math.max(0, Math.min(1, storm));

  // Wave-group envelope changes the energy of the same spectral field slowly,
  // so the sea arrives in larger and smaller sets while every crest is still
  // produced by the FFT spectrum itself.
  const setEnvelope =
    Math.sin(elapsed * 0.105) * 4.0 +
    Math.sin(elapsed * 0.247 + 1.7) * 2.2;

  handle.waveScale.value = 45.0 + setEnvelope + stormT * 14.0;
  handle.mesh.scale.y = 1.08 + stormT * 0.10;

  applyRoughOceanLook(handle);
}

export function disposeGPUFFTOcean(scene, handle) {
  return disposeBaseOcean(scene, handle);
}
