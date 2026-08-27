import * as legacy from "./liquid_legacy.js";
import * as oceanV19 from "./gpu_fft_ocean_r185_v22.js";
import { getEffectiveValue as getBaseGraphicsEffectiveValue } from "./graphicsSettings_fft_base.js";

function setFFTReflectionOwnership(active) {
  if (typeof globalThis !== "undefined") {
    globalThis.__riftFFTUsesEnvironmentReflections = !!active;
  }
}

function applyFFTReflectionPreference(handle) {
  const physical = handle?.fftPhysicalMaterial;
  if (!physical) return;

  // Water Pro v19 owns Crystal reflections through the existing physical
  // environment and aligned facet glitter. Mobile SSR and planar captures stay
  // disabled so Safari keeps the proven render/compute graph.
  const enabled = getBaseGraphicsEffectiveValue("reflectionEnabled") !== false;
  if (!enabled) physical.envMapIntensity = 0;
}

function atmosphereWaterArgs(skyColor, sunDir, skyHorizon) {
  const atmosphere = typeof globalThis !== "undefined"
    ? globalThis.__riftReferenceAtmosphere
    : null;
  return {
    atmosphere,
    skyColor: atmosphere?.zenithColor?.isColor ? atmosphere.zenithColor : skyColor,
    sunDir,
    skyHorizon: atmosphere?.horizonColor?.isColor ? atmosphere.horizonColor : skyHorizon,
  };
}

function tuneAtmosphereWaterMaterial(handle, atmosphere, stormAmount = 0) {
  const physical = handle?.fftPhysicalMaterial;
  if (!physical || !atmosphere) return;
  const storm = Math.max(0, Math.min(1, Number(stormAmount) || 0));

  if (physical.attenuationColor?.isColor && atmosphere.waterMidColor?.isColor) {
    physical.attenuationColor.copy(atmosphere.waterMidColor).lerp(atmosphere.waterDeepColor, 0.18 + storm * 0.16);
  }
  physical.attenuationDistance = 58 - storm * 12;
  physical.clearcoat = 0.40;
  physical.clearcoatRoughness = 0.13 + storm * 0.05;

  // Keep reflections energetic enough to read the blue sky but slightly soften
  // the mirror response; the custom facet glitter provides the solar sparkle.
  const enabled = getBaseGraphicsEffectiveValue("reflectionEnabled") !== false;
  if (enabled) physical.envMapIntensity = Math.max(Number(physical.envMapIntensity) || 0, 1.0 - storm * 0.12);
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
    const handle = oceanV19.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
    if (handle?.gpuFFT) {
      handle.__riftOceanBackend = "v19-water-pro";
      setFFTReflectionOwnership(true);
      applyFFTReflectionPreference(handle);
      console.info(
        `[rift-water] Water Pro v19 selected (${handle.__riftWaterProBackend ?? "FFT"}); persistent breaker-driven shoreline foam`,
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
  const atmospheric = atmosphereWaterArgs(skyColor, sunDir, skyHorizon);

  if (handle?.gpuFFT) {
    setFFTReflectionOwnership(true);
    applyFFTReflectionPreference(handle);
    tuneAtmosphereWaterMaterial(handle, atmospheric.atmosphere, stormAmount);

    oceanV19.updateGPUFFTOceanVisuals(
      handle,
      elapsed,
      atmospheric.skyColor,
      cameraY,
      playerPos,
      atmospheric.sunDir,
      atmospheric.skyHorizon,
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
    atmospheric.skyColor,
    cameraY,
    playerPos,
    atmospheric.sunDir,
    atmospheric.skyHorizon,
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
    return oceanV19.updateGPUFFTOcean(handle, renderer, elapsedTime);
  }
  return legacy.updateFluidSimWater(handle, renderer, elapsedTime);
}

export function updateRippleLayer(handle, renderer, cameraPos, cameraY, dt) {
  if (handle?.gpuFFT) {
    oceanV19.updateGPUFFTOceanRipples(handle, cameraPos, cameraY, dt);
    return;
  }
  return legacy.updateRippleLayer(handle, renderer, cameraPos, cameraY, dt);
}

export function disposeLiquidPlane(scene, handle) {
  if (handle?.gpuFFT) {
    setFFTReflectionOwnership(false);
    return oceanV19.disposeGPUFFTOcean(scene, handle);
  }
  return legacy.disposeLiquidPlane(scene, handle);
}
