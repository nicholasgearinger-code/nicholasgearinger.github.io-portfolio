import * as legacy from "./liquid_legacy.js";
import * as oceanV10 from "./gpu_fft_ocean_v10.js";
import { getEffectiveValue as getBaseGraphicsEffectiveValue } from "./graphicsSettings_fft_base.js";

function setFFTReflectionOwnership(active) {
  if (typeof globalThis !== "undefined") {
    globalThis.__riftFFTUsesEnvironmentReflections = !!active;
  }
}

function applyFFTReflectionPreference(handle) {
  const physical = handle?.fftPhysicalMaterial;
  if (!physical) return;

  // Water Pro v10 owns Crystal reflections through the physical environment,
  // aligned facet glitter and tiered WebGPU SSR. The old planar captures remain
  // disabled so the ocean has one reflection owner.
  const enabled = getBaseGraphicsEffectiveValue("reflectionEnabled") !== false;
  if (!enabled) physical.envMapIntensity = 0;
}

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
    const handle = oceanV10.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
    if (handle?.gpuFFT) {
      handle.__riftOceanBackend = "v10-water-pro-plus";
      setFFTReflectionOwnership(true);
      applyFFTReflectionPreference(handle);
      console.info(
        `[rift-water] Water Pro v10 selected (${handle.__riftWaterProBackend ?? "FFT"}); legacy planar captures disabled`,
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

    oceanV10.updateGPUFFTOceanVisuals(
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
    return oceanV10.updateGPUFFTOcean(handle, renderer, elapsedTime);
  }
  return legacy.updateFluidSimWater(handle, renderer, elapsedTime);
}

export function updateRippleLayer(handle, renderer, cameraPos, cameraY, dt) {
  if (handle?.gpuFFT) {
    oceanV10.updateGPUFFTOceanRipples(handle, cameraPos, cameraY, dt);
    return;
  }
  return legacy.updateRippleLayer(handle, renderer, cameraPos, cameraY, dt);
}

export function disposeLiquidPlane(scene, handle) {
  if (handle?.gpuFFT) {
    setFFTReflectionOwnership(false);
    return oceanV10.disposeGPUFFTOcean(scene, handle);
  }
  return legacy.disposeLiquidPlane(scene, handle);
}
