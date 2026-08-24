import * as THREE from "three";
import {
  createVolumetricClouds as createNubisV3,
  updateVolumetricClouds as updateNubisV3,
  disposeVolumetricClouds as disposeNubisV3,
} from "./volumetricClouds_nubis_v3.js";

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function tuneReferenceCumulus(handle, rainIntensity) {
  const u = handle?.uniforms;
  if (!u) return;

  const weather = globalThis.__riftProceduralWeatherState;
  const atmosphere = globalThis.__riftReferenceAtmosphere;
  const storm = clamp01(weather?.stormIntensity ?? rainIntensity);
  const weatherCoverage = clamp01(weather?.cloudCoverage ?? 0.34);

  // Match the reference photos: fewer but much larger fair-weather cumulus
  // systems with clear blue gaps between them. Storms still close the sky.
  if (u.coverage) {
    u.coverage.value = THREE.MathUtils.lerp(
      THREE.MathUtils.clamp(weatherCoverage, 0.28, 0.44),
      0.82,
      storm,
    );
  }
  if (u.density) u.density.value = THREE.MathUtils.lerp(0.54, 0.80, storm);
  if (u.humidity) u.humidity.value = THREE.MathUtils.lerp(0.66, 0.92, storm);
  if (u.convection) u.convection.value = THREE.MathUtils.lerp(0.84, 0.98, storm);
  if (u.erosion) u.erosion.value = THREE.MathUtils.lerp(0.34, 0.27, storm);

  // Lower broad-noise frequency => larger cauliflower bodies. Fine erosion stays
  // high-frequency, so silhouettes keep detail without turning into striping.
  if (u.pwBaseScale) u.pwBaseScale.value = THREE.MathUtils.lerp(0.22, 0.31, storm);
  if (u.pwDetailScale) u.pwDetailScale.value = THREE.MathUtils.lerp(4.95, 4.30, storm);
  if (u.pwDensityBias) u.pwDensityBias.value = THREE.MathUtils.lerp(-0.070, -0.030, storm);

  if (u.nubisEnvelopeStrength) u.nubisEnvelopeStrength.value = THREE.MathUtils.lerp(0.80, 0.96, storm);
  if (u.nubisEdgeErosion) u.nubisEdgeErosion.value = THREE.MathUtils.lerp(0.255, 0.235, storm);
  if (u.nubisDensityScale) u.nubisDensityScale.value = THREE.MathUtils.lerp(1.02, 1.14, storm);
  if (u.nubisDomainWarp) u.nubisDomainWarp.value = THREE.MathUtils.lerp(0.038, 0.044, storm);
  if (u.nubisVerticalStretch) u.nubisVerticalStretch.value = THREE.MathUtils.lerp(0.61, 0.54, storm);

  // Keep sun-facing towers luminous while preserving blue-gray depth inside the
  // cloud. The old high ambient floor was a major source of the washed-out look.
  if (u.nubisAmbientBoost) u.nubisAmbientBoost.value = THREE.MathUtils.lerp(0.61, 0.48, storm);
  if (u.nubisMultiScatter) u.nubisMultiScatter.value = THREE.MathUtils.lerp(0.31, 0.23, storm);
  if (u.nubisLightExtinction) u.nubisLightExtinction.value = THREE.MathUtils.lerp(0.57, 0.72, storm);
  if (u.referenceGuideStrength) u.referenceGuideStrength.value = 0;
  if (u.referencePaletteStrength) u.referencePaletteStrength.value = THREE.MathUtils.lerp(0.08, 0.18, storm);

  if (atmosphere) {
    if (u.sunColor?.value?.isColor) u.sunColor.value.copy(atmosphere.sunColor);
    if (u.ambientColor?.value?.isColor) u.ambientColor.value.copy(atmosphere.ambientColor);
  }

  const baseTarget = THREE.MathUtils.lerp(42, 30, storm);
  const topTarget = THREE.MathUtils.lerp(178, 252, storm);
  if (u.cloudBaseY) u.cloudBaseY.value = Math.min(Number(u.cloudBaseY.value) || 58, baseTarget);
  if (u.cloudTopY) u.cloudTopY.value = Math.max(Number(u.cloudTopY.value) || 108, topTarget);

  const baseY = Number(u.cloudBaseY?.value) || baseTarget;
  if (handle.mesh) handle.mesh.position.y = baseY;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;

  globalThis.__riftReferenceCumulusDebug = {
    coverage: Number(u.coverage?.value) || 0,
    baseScale: Number(u.pwBaseScale?.value) || 0,
    detailScale: Number(u.pwDetailScale?.value) || 0,
    verticalStretch: Number(u.nubisVerticalStretch?.value) || 0,
    storm,
  };
}

export function createVolumetricClouds(scene) {
  return createNubisV3(scene);
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
  updateNubisV3(
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
  tuneReferenceCumulus(handle, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  delete globalThis.__riftReferenceCumulusDebug;
  return disposeNubisV3(handle);
}
