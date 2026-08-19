import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean.js";

// Visual/animation tuning layered over the real 128x128 GPU FFT simulation.
// This keeps the FFT kernel stable while pushing Coral Shallows toward a
// rough, photographic open-ocean look: darker water, rolling wave sets,
// stronger crest/trough separation, and less glassy highlights.

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

  handle.waveScale.value = 2.7;
  handle.mesh.scale.y = 1.46;
  handle.fftVisualBoost = true;
  applyRoughOceanLook(handle);

  console.info("[gpu-fft-ocean] ACTIVE: rough open-ocean tuning");
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
  const setEnvelope =
    Math.sin(elapsed * 0.105) * 0.18 +
    Math.sin(elapsed * 0.247 + 1.7) * 0.10;

  handle.waveScale.value = 2.70 + setEnvelope + stormT * 1.05;
  handle.mesh.scale.y =
    1.46 +
    Math.sin(elapsed * 0.083 + 0.4) * 0.045 +
    stormT * 0.12;

  applyRoughOceanLook(handle);
}

export function disposeGPUFFTOcean(scene, handle) {
  return disposeBaseOcean(scene, handle);
}
