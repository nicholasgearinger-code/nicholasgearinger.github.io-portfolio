import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean_v3.js";
import { setGPUShallowWaterInteraction } from "./gpu_shallow_water.js";
import {
  createGPUUnderwaterLighting,
  updateGPUUnderwaterLighting,
  disposeGPUUnderwaterLighting,
} from "./gpu_underwater_lighting.js";

// Interaction + underwater-lighting bridge layered over the stabilized
// FFT + shallow-water ocean. The water simulation remains unchanged here;
// this wrapper adds physical interaction impulses plus wave-reactive caustics
// and volumetric light shafts without introducing another water surface mesh.

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle?.gpuFFT) return handle;

  handle.fftInteractionPrev = null;
  handle.fftInteractionPrevY = null;
  handle.fftInteractionWasSubmerged = false;
  handle.fftUnderwaterLighting = createGPUUnderwaterLighting(
    scene,
    sampleHeight,
    y,
    handle.fftShallowHandle,
  );
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

  if (handle?.fftUnderwaterLighting?.gpuUnderwaterLighting) {
    updateGPUUnderwaterLighting(
      handle.fftUnderwaterLighting,
      elapsed,
      cameraY,
      day,
      storm,
      sunDir,
    );
  }
}

export function updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt = 1 / 60) {
  const shallow = handle?.fftShallowHandle;
  if (!handle?.gpuFFT || !shallow?.gpuShallowWater || !playerPos) return;

  const safeDt = Math.max(1 / 240, Math.min(0.05, Number.isFinite(dt) ? dt : 1 / 60));
  const waterY = handle.waterY ?? 0;
  const submerged = Number.isFinite(cameraY) && cameraY < waterY;
  const nearSurface = Number.isFinite(cameraY) && Math.abs(cameraY - waterY) < 2.6;

  let horizontalSpeed = 0;
  if (handle.fftInteractionPrev) {
    const dx = playerPos.x - handle.fftInteractionPrev.x;
    const dz = playerPos.z - handle.fftInteractionPrev.z;
    horizontalSpeed = Math.hypot(dx, dz) / safeDt;
  }

  const crossedSurface = handle.fftInteractionPrevY !== null && Number.isFinite(cameraY)
    ? ((handle.fftInteractionPrevY >= waterY && cameraY < waterY) ||
       (handle.fftInteractionPrevY < waterY && cameraY >= waterY))
    : false;

  const wake = nearSurface ? Math.min(1.35, horizontalSpeed * 0.065) : 0;
  const swimWake = submerged && cameraY > waterY - 5.0 ? Math.min(0.55, horizontalSpeed * 0.025) : 0;
  const splash = crossedSurface
    ? Math.min(3.0, 1.65 + Math.abs((cameraY - (handle.fftInteractionPrevY ?? cameraY)) / safeDt) * 0.035)
    : 0;
  const strength = Math.min(3.4, Math.max(wake, swimWake) + splash);
  const radius = Math.min(6.5, 2.2 + horizontalSpeed * 0.045 + (crossedSurface ? 1.6 : 0));

  if (strength > 0.025) {
    setGPUShallowWaterInteraction(shallow, playerPos.x, playerPos.z, strength, radius);
  }

  if (!handle.fftInteractionPrev) handle.fftInteractionPrev = { x: playerPos.x, z: playerPos.z };
  else {
    handle.fftInteractionPrev.x = playerPos.x;
    handle.fftInteractionPrev.z = playerPos.z;
  }
  handle.fftInteractionPrevY = Number.isFinite(cameraY) ? cameraY : waterY;
  handle.fftInteractionWasSubmerged = submerged;
}

export function disposeGPUFFTOcean(scene, handle) {
  if (handle?.fftUnderwaterLighting?.gpuUnderwaterLighting) {
    disposeGPUUnderwaterLighting(scene, handle.fftUnderwaterLighting);
  }
  if (handle) {
    handle.fftUnderwaterLighting = null;
    handle.fftInteractionPrev = null;
    handle.fftInteractionPrevY = null;
  }
  return disposeBaseOcean(scene, handle);
}
