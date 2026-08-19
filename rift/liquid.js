import * as legacy from "./liquid_legacy.js";
import {
  createGPUFFTOceanPlane,
  updateGPUFFTOcean,
  updateGPUFFTOceanVisuals,
  disposeGPUFFTOcean,
} from "./gpu_fft_ocean_v3.js";

// Preserve the full Rift liquid API from the legacy module. Explicit exports
// below override the Crystal entry points so only Coral Shallows uses FFT.
export * from "./liquid_legacy.js";

export function createLiquidPlane(scene, biome, y, size, sampleHeight, flowDir = { x: 0.6, z: 0.35 }, excludeRegions = []) {
  if (biome === "crystal") {
    return createGPUFFTOceanPlane(scene, y, size, sampleHeight);
  }
  return legacy.createLiquidPlane(scene, biome, y, size, sampleHeight, flowDir, excludeRegions);
}

// main.js still calls the old Crystal-only breaking-wave helper after creating
// the liquid plane. Under the FFT ocean that legacy mesh becomes a second,
// overlapping water surface and can appear as the large cyan/gray slab seen in
// the current build. Crystal breakers now belong to the FFT/shallow-water path,
// so keep this old helper disabled. The call site is Crystal-only; other biome
// liquid systems are untouched.
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
  if (handle?.gpuFFT) return;
  return legacy.updateRippleLayer(handle, renderer, cameraPos, cameraY, dt);
}

export function disposeLiquidPlane(scene, handle) {
  if (handle?.gpuFFT) return disposeGPUFFTOcean(scene, handle);
  return legacy.disposeLiquidPlane(scene, handle);
}
