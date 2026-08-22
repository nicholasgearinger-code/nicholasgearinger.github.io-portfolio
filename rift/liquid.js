import * as legacy from "./liquid_legacy.js";
import * as oceanV9 from "./gpu_fft_ocean_v9.js";
import { getEffectiveValue as getBaseGraphicsEffectiveValue } from "./graphicsSettings_fft_base.js";

function setFFTReflectionOwnership(active) {
  if (typeof globalThis !== "undefined") {
    globalThis.__riftFFTUsesEnvironmentReflections = !!active;
  }
}

function applyFFTReflectionPreference(handle) {
  const physical = handle?.fftPhysicalMaterial;
  if (!physical) return;

  // Water Pro v9 owns Crystal reflections through the physical environment,
  // aligned facet glitter and (on desktop quality tiers) the scene's WebGPU
  // screen-space reflection pass. The old planar captures remain disabled.
  const enabled = getBaseGraphicsEffectiveValue("reflectionEnabled") !== false;
  if (!enabled) physical.envMapIntensity = 0;
}

// Preserve the full Rift liquid API from the legacy module. Explicit exports
// below override the Crystal entry points so only Coral Shallows uses FFT.
export * from "./liquid_legacy.js";

export function createLiquidPlane(
  scene,
  biome,
  y,
  size,
  sampleHeight,
  flowDir = { x: 0.6, z: 0.35 },
  excludeRegions = [],
) {
  if (biome === "crystal") {
    const handle = oceanV9.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
    if (handle?.gpuFFT) {
      handle.__riftOceanBackend = "v9-water-pro";
      setFFTReflectionOwnership(true);
      applyFFTReflectionPreference(handle);
      console.info(
        `[rift-water] Water Pro v9 selected (${handle.__riftWaterProBackend ?? "FFT"}); legacy planar captures disabled`,
      );
    }
    return handle;
  }

  setFFTReflectionOwnership(false);
  return legacy.createLiquidPlane(
    scene,
    biome,
    y,
    size,
    sampleHeight,
    flowDir,
    excludeRegions,
  );
}

// The legacy Crystal breaker was a second overlapping water mesh. Keep it off;
// the local surf/swash system is integrated into the FFT ocean stack.
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

export function updateLiquidPlane(
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
  stormAmount = 0,
  dayAmount = 1,
) {
  if (handle?.gpuFFT) {
    setFFTReflectionOwnership(true);
    applyFFTReflectionPreference(handle);

    oceanV9.updateGPUFFTOceanVisuals(
      handle,
      elapsed,
      skyColor,
      cameraY,
      playerPos,
      sunDir,
      skyHorizon,
      null,
      null,
      null,
      resolution,
      stormAmount,
      dayAmount,
    );
    return;
  }

  return legacy.updateLiquidPlane(
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
    stormAmount,
    dayAmount,
  );
}

export function updateFluidSimWater(handle, renderer, elapsedTime) {
  if (handle?.gpuFFT) {
    return oceanV9.updateGPUFFTOcean(handle, renderer, elapsedTime);
  }
  return legacy.updateFluidSimWater(handle, renderer, elapsedTime);
}

export function updateRippleLayer(handle, renderer, cameraPos, cameraY, dt) {
  if (handle?.gpuFFT) {
    oceanV9.updateGPUFFTOceanRipples(handle, cameraPos, cameraY, dt);
    return;
  }
  return legacy.updateRippleLayer(handle, renderer, cameraPos, cameraY, dt);
}

export function disposeLiquidPlane(scene, handle) {
  if (handle?.gpuFFT) {
    setFFTReflectionOwnership(false);
    return oceanV9.disposeGPUFFTOcean(scene, handle);
  }
  return legacy.disposeLiquidPlane(scene, handle);
}
