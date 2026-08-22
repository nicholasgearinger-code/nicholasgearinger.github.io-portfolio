import * as legacy from "./liquid_legacy.js";
import * as oceanV17 from "./gpu_fft_ocean_v17.js";
import { getEffectiveValue as getBaseGraphicsEffectiveValue } from "./graphicsSettings_fft_base.js";

function setFFTReflectionOwnership(active) {
  if (typeof globalThis !== "undefined") {
    globalThis.__riftFFTUsesEnvironmentReflections = !!active;
  }
}

function applyFFTReflectionPreference(handle) {
  const physical = handle?.fftPhysicalMaterial;
  if (!physical) return;

  // Water Pro v17 owns Crystal reflections through the existing physical
  // environment and aligned facet glitter. Mobile SSR and planar captures stay
  // disabled so Safari keeps the proven render/compute graph.
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
    const handle = oceanV17.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
    if (handle?.gpuFFT) {
      handle.__riftOceanBackend = "v17-water-pro";
      setFFTReflectionOwnership(true);
      applyFFTReflectionPreference(handle);
      console.info(
        `[rift-water] Water Pro v17 selected (${handle.__riftWaterProBackend ?? "FFT"}); milky bubble shoreline foam`,
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

    oceanV17.updateGPUFFTOceanVisuals(
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
    return oceanV17.updateGPUFFTOcean(handle, renderer, elapsedTime);
  }
  return legacy.updateFluidSimWater(handle, renderer, elapsedTime);
}

export function updateRippleLayer(handle, renderer, cameraPos, cameraY, dt) {
  if (handle?.gpuFFT) {
    oceanV17.updateGPUFFTOceanRipples(handle, cameraPos, cameraY, dt);
    return;
  }
  return legacy.updateRippleLayer(handle, renderer, cameraPos, cameraY, dt);
}

export function disposeLiquidPlane(scene, handle) {
  if (handle?.gpuFFT) {
    setFFTReflectionOwnership(false);
    return oceanV17.disposeGPUFFTOcean(scene, handle);
  }
  return legacy.disposeLiquidPlane(scene, handle);
}
