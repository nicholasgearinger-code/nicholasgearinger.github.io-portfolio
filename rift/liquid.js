import * as legacy from "./liquid_legacy.js";
import {
  createGPUFFTOceanPlane,
  updateGPUFFTOcean,
  updateGPUFFTOceanVisuals,
  updateGPUFFTOceanRipples,
  disposeGPUFFTOcean,
} from "./gpu_fft_ocean_v6.js";

// Preserve the full Rift liquid API from the legacy module. Explicit exports
// below override the Crystal entry points so only Coral Shallows uses FFT.
export * from "./liquid_legacy.js";

export function createLiquidPlane(scene, biome, y, size, sampleHeight, flowDir = { x: 0.6, z: 0.35 }, excludeRegions = []) {
  if (biome === "crystal") {
    return createGPUFFTOceanPlane(scene, y, size, sampleHeight);
  }
  return legacy.createLiquidPlane(scene, biome, y, size, sampleHeight, flowDir, excludeRegions);
}

// The legacy Crystal breaker was a second overlapping water mesh. Keep it off;
// the new local surf system lives inside the FFT ocean wrapper instead.
export function createBreakingWave() {
  return null;
}

export function updateBreakingWave(handle, ...args) {
  if (!handle) return;
  return legacy.updateBreakingWave(handle, ...args);
}

export function disposeBreakingWave(scene, handle) {
  if (!handle) return;
  return legacy.disposeBreakingWave(scene, handle);
}

export function updateLiquidPlane(handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon, reflectionTexture, reflectionMatrix, refractionTexture, resolution, stormAmount = 0, dayAmount = 1) {
  if (handle?.gpuFFT) {
    updateGPUFFTOceanVisuals(
      handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon,
      reflectionTexture, reflectionMatrix, refractionTexture, resolution,
      stormAmount, dayAmount,
    );
    return;
  }
  return legacy.updateLiquidPlane(
    handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon,
    reflectionTexture, reflectionMatrix, refractionTexture, resolution,
    stormAmount, dayAmount,
  );
}

export function updateFluidSimWater(handle, renderer, elapsedTime) {
  if (handle?.gpuFFT) return updateGPUFFTOcean(handle, renderer, elapsedTime);
  return legacy.updateFluidSimWater(handle, renderer, elapsedTime);
}

export function updateRippleLayer(handle, renderer, cameraPos, cameraY, dt) {
  if (handle?.gpuFFT) {
    updateGPUFFTOceanRipples(handle, cameraPos, cameraY, dt);
    return;
  }
  return legacy.updateRippleLayer(handle, renderer, cameraPos, cameraY, dt);
}

export function disposeLiquidPlane(scene, handle) {
  if (handle?.gpuFFT) return disposeGPUFFTOcean(scene, handle);
  return legacy.disposeLiquidPlane(scene, handle);
}
