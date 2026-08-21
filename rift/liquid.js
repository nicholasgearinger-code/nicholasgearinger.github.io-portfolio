import * as legacy from "./liquid_legacy.js";
import * as oceanV7 from "./gpu_fft_ocean_v7.js";
import * as oceanV8 from "./gpu_fft_ocean_v8.js";
import { getEffectiveValue as getBaseGraphicsEffectiveValue } from "./graphicsSettings_fft_base.js";

// The new standalone third FFT cascade in v8 is currently unstable on iOS
// WebGPU (GPUValidationError: encoder state is not valid). Keep the v8 path
// available for desktop while routing touch devices through the proven v7
// stack. This still preserves the current surf v8 / swash v5 shoreline work;
// it only removes the extra standalone micro-FFT/whitecap command stream from
// mobile until that pass is rebuilt around Safari's WebGPU limits.
const TOUCH_DEVICE = typeof window !== "undefined" && (
  "ontouchstart" in window ||
  (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
);

function oceanBackendForHandle(handle) {
  return handle?.__riftOceanBackend === "v8-desktop" ? oceanV8 : oceanV7;
}

function setFFTReflectionOwnership(active) {
  if (typeof globalThis !== "undefined") {
    globalThis.__riftFFTUsesEnvironmentReflections = !!active;
  }
}

function applyFFTReflectionPreference(handle) {
  const physical = handle?.fftPhysicalMaterial;
  if (!physical) return;

  // The FFT water does not sample main_game.js's legacy planar reflection or
  // refraction render targets. Its real reflections come from the physical
  // material + scene.environment, so keep the existing Reflections toggle
  // meaningful by applying it to the environment contribution instead.
  const enabled = getBaseGraphicsEffectiveValue("reflectionEnabled") !== false;
  physical.envMapIntensity = enabled ? 1.0 : 0.0;
}

// Preserve the full Rift liquid API from the legacy module. Explicit exports
// below override the Crystal entry points so only Coral Shallows uses FFT.
export * from "./liquid_legacy.js";

export function createLiquidPlane(scene, biome, y, size, sampleHeight, flowDir = { x: 0.6, z: 0.35 }, excludeRegions = []) {
  if (biome === "crystal") {
    const backend = TOUCH_DEVICE ? oceanV7 : oceanV8;
    const handle = backend.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
    if (handle?.gpuFFT) {
      handle.__riftOceanBackend = TOUCH_DEVICE ? "v7-mobile" : "v8-desktop";
      setFFTReflectionOwnership(true);
      applyFFTReflectionPreference(handle);
      console.info(`[rift-water] ${handle.__riftOceanBackend} selected; legacy planar captures disabled`);
    }
    return handle;
  }

  // Non-FFT liquids still use the legacy rendering path and may consume the
  // old reflection/refraction textures normally.
  setFFTReflectionOwnership(false);
  return legacy.createLiquidPlane(scene, biome, y, size, sampleHeight, flowDir, excludeRegions);
}

// The legacy Crystal breaker was a second overlapping water mesh. Keep it off;
// the local surf system lives inside the FFT ocean wrapper instead.
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
    setFFTReflectionOwnership(true);
    applyFFTReflectionPreference(handle);

    // These planar textures belong to the old Gerstner/legacy shader. The FFT
    // material has no sampling nodes/uniforms for them, so passing them onward
    // only obscures the fact that the expensive capture passes are dead work.
    oceanBackendForHandle(handle).updateGPUFFTOceanVisuals(
      handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon,
      null, null, null, resolution,
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
  if (handle?.gpuFFT) return oceanBackendForHandle(handle).updateGPUFFTOcean(handle, renderer, elapsedTime);
  return legacy.updateFluidSimWater(handle, renderer, elapsedTime);
}

export function updateRippleLayer(handle, renderer, cameraPos, cameraY, dt) {
  if (handle?.gpuFFT) {
    oceanBackendForHandle(handle).updateGPUFFTOceanRipples(handle, cameraPos, cameraY, dt);
    return;
  }
  return legacy.updateRippleLayer(handle, renderer, cameraPos, cameraY, dt);
}

export function disposeLiquidPlane(scene, handle) {
  if (handle?.gpuFFT) {
    setFFTReflectionOwnership(false);
    return oceanBackendForHandle(handle).disposeGPUFFTOcean(scene, handle);
  }
  return legacy.disposeLiquidPlane(scene, handle);
}
