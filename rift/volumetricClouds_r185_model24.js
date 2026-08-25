import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model23.js";

export * from "./volumetricClouds_r185_model23.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 2.4 — balanced Sky Pro atmosphere coupling.
//
// Model 2.3 proved the atmosphere/weather coupling, but the first physical-sky
// pass made twilight too dark while cloud radiance stayed comparatively bright.
// That contrast produced white/gray horizontal cloud cards against a black sky.
// 2.4 keeps the same proven r185 raymarch and weather dynamics, then rebalance
// cloud occupancy and low-Sun radiance for the new single-dome atmosphere.
// -----------------------------------------------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (handle) handle.__riftModel24 = true;
  return handle;
}

function rebalanceClouds(handle, rainIntensity = 0) {
  const u = handle?.uniforms;
  if (!u) return;

  const sky = globalThis.__riftSkyPhysicalV12 || globalThis.__riftSkyPhysicalV11;
  const weather = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(weather?.stormIntensity ?? rainIntensity);
  const humidity = clamp01(weather?.humidity ?? sky?.humidity ?? 0.65);
  const coverage = clamp01(weather?.cloudCoverage ?? 0.46);
  const convection = clamp01(weather?.convection ?? 0.72);
  const lowSun = clamp01(sky?.lowSun ?? 0);
  const daylight = clamp01(sky?.daylight ?? 1);
  const cloudT = clamp01(sky?.cloudTransmittance ?? 1);

  // More photographic broken-cumulus spacing in fair weather. Leave generous
  // blue gaps instead of filling half the frame with low-resolution cloud slabs.
  const fairCoverage = THREE.MathUtils.clamp(
    0.36 + coverage * 0.18 + humidity * 0.09,
    0.43,
    0.57,
  );
  if (u.coverage) u.coverage.value = THREE.MathUtils.lerp(fairCoverage, 0.90, storm);

  const fairDensity = THREE.MathUtils.clamp(0.54 + humidity * 0.075, 0.57, 0.62);
  if (u.density) u.density.value = THREE.MathUtils.lerp(fairDensity, 0.84, storm);

  // Keep fair-weather bases relatively flat and modest in depth. Storms can still
  // grow vertically, but clear/mobile clouds should read as separate families,
  // not one deep wall along the horizon.
  const baseTarget = THREE.MathUtils.lerp(61, 46, humidity);
  const stormBase = THREE.MathUtils.lerp(baseTarget, 31, storm);
  const fairThickness = 86 + convection * 56 + humidity * 15;
  const topTarget = stormBase + THREE.MathUtils.lerp(fairThickness, 218, storm);
  if (u.cloudBaseY) u.cloudBaseY.value = stormBase;
  if (u.cloudTopY) u.cloudTopY.value = topTarget;

  if (handle.mesh) handle.mesh.position.y = stormBase;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = stormBase;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = stormBase;

  // Low-Sun clouds must dim with the environment rather than remaining bright
  // enough to look emissive. Preserve warm rims, but cap the direct/ambient
  // energy so twilight retains detail instead of clipping to white/black bands.
  const lowSunDim = THREE.MathUtils.lerp(1.0, 0.70, lowSun);
  const twilightDim = THREE.MathUtils.lerp(0.76, 1.0, daylight);
  if (u.sunColor?.value?.isColor) {
    u.sunColor.value.multiplyScalar(lowSunDim * twilightDim);
  }
  if (u.ambientColor?.value?.isColor) {
    u.ambientColor.value.multiplyScalar(
      THREE.MathUtils.lerp(0.80, 1.0, daylight) * THREE.MathUtils.lerp(1.0, 0.86, lowSun),
    );
  }

  if (u.m2SilverStrength) {
    const clearSilver = THREE.MathUtils.lerp(0.43, 0.57, lowSun)
      * THREE.MathUtils.lerp(0.45, 1.0, cloudT);
    u.m2SilverStrength.value = THREE.MathUtils.lerp(clearSilver, 0.13, storm);
  }
  if (u.m2MultiScatter) {
    u.m2MultiScatter.value = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(0.22, 0.28, lowSun),
      0.29,
      storm,
    );
  }
  if (u.m2LightExtinction) {
    const clearExtinction = THREE.MathUtils.lerp(0.61, 0.74, humidity);
    u.m2LightExtinction.value = THREE.MathUtils.lerp(clearExtinction, 0.92, storm);
  }
  if (u.m2AmbientStrength) {
    const overcast = 1 - cloudT;
    const target = THREE.MathUtils.lerp(0.52, 0.59, overcast);
    u.m2AmbientStrength.value = THREE.MathUtils.lerp(target, 0.57, storm);
  }

  // Slightly stronger clear-weather erosion helps break remaining horizontal
  // reconstructed masses into softer individual lobes without adding ray steps.
  if (u.m2EdgeErosion) {
    const fairEdge = THREE.MathUtils.lerp(0.51, 0.43, humidity);
    u.m2EdgeErosion.value = THREE.MathUtils.lerp(fairEdge, 0.30, storm);
  }
  if (u.m2DomainWarp) {
    const fairWarp = THREE.MathUtils.lerp(0.072, 0.088, convection);
    u.m2DomainWarp.value = THREE.MathUtils.lerp(fairWarp, 0.061, storm);
  }

  if (handle.__riftCirrus?.material) {
    handle.__riftCirrus.material.opacity = THREE.MathUtils.lerp(
      0.008 * THREE.MathUtils.lerp(1.0, 0.70, humidity),
      0.002,
      storm,
    ) * THREE.MathUtils.lerp(0.55, 1.0, daylight);
  }

  globalThis.__riftCloudModel24 = {
    version: "2.4-balanced-atmosphere",
    coverage: Number(u.coverage?.value) || 0,
    density: Number(u.density?.value) || 0,
    baseY: Number(u.cloudBaseY?.value) || stormBase,
    topY: Number(u.cloudTopY?.value) || topTarget,
    lowSun,
    daylight,
    humidity,
    storm,
    cloudTransmittance: cloudT,
    threeRevision: THREE.REVISION,
  };
}

export function updateVolumetricClouds(
  handle,
  dt,
  camera,
  sunDirection,
  sunColor,
  ambientColor,
  lightningFlash,
  lightningColor,
  windX = 0,
  windZ = 0,
  rainIntensity = 0,
  currentBiome = "default",
) {
  base.updateVolumetricClouds(
    handle,
    dt,
    camera,
    sunDirection,
    sunColor,
    ambientColor,
    lightningFlash,
    lightningColor,
    windX,
    windZ,
    rainIntensity,
    currentBiome,
  );
  rebalanceClouds(handle, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  delete globalThis.__riftCloudModel24;
  return base.disposeVolumetricClouds(handle);
}
