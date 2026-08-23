import * as THREE from "three";
import {
  createVolumetricClouds as createReferenceClouds,
  updateVolumetricClouds as updateReferenceClouds,
  disposeVolumetricClouds as disposeReferenceClouds,
} from "./volumetricClouds_reference_guided.js";

// -----------------------------------------------------------------------------
// Reference-guided cloud presentation v2.
//
// The first reference-guided pass treated sky_clouds.png too much like an
// alternate weather mask. Most pixels in a real sky photograph are blue sky, so
// blending that luminance directly into the procedural coverage field suppressed
// the genuine 3D weather map and left small repeated smudges near the horizon.
//
// Keep the useful parts of the system — photographic color calibration, physical
// 3D density, temporal accumulation, Sun/Moon phase lighting — but reduce the
// photo's macro influence to a gentle organizational bias and restore a healthy
// fair-weather density/height range. This wrapper intentionally changes uniforms
// only; the photographs are still never rendered as the visible sky.
// -----------------------------------------------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function liftCloudPalette(handle, storm) {
  const u = handle?.uniforms;
  if (!u?.referenceShadow?.value?.isColor || !u?.referenceAmbient?.value?.isColor) return;

  // Real cloud interiors are lit by a huge hemisphere of sky and multiple
  // scattering. Even dense fair-weather cumulus should not collapse to brown or
  // black. Lift shadows toward calibrated ambient; storms retain considerably
  // more contrast.
  const shadowLift = THREE.MathUtils.lerp(0.42, 0.14, storm);
  u.referenceShadow.value.lerp(u.referenceAmbient.value, shadowLift);

  if (u.referenceHighlight?.value?.isColor) {
    const ambientLift = THREE.MathUtils.lerp(0.10, 0.035, storm);
    u.referenceAmbient.value.lerp(u.referenceHighlight.value, ambientLift);
  }

  // Use the photographs as a color reference, not a dominant color grade.
  if (u.referencePaletteStrength) {
    u.referencePaletteStrength.value = THREE.MathUtils.lerp(0.54, 0.66, storm);
  }
}

function rebalanceCloudField(handle, camera, rainIntensity) {
  const u = handle?.uniforms;
  if (!u || !camera) return;

  const state = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(state?.stormIntensity ?? rainIntensity);
  const convection = clamp01(state?.convection ?? u.convection?.value ?? 0.35);

  // The HDRI/photo guide is only a low-frequency nudge. The procedural weather
  // field remains dominant so the cloud masses do not inherit the photograph's
  // large clear-sky regions or visible repetition.
  if (u.referenceGuideStrength) {
    u.referenceGuideStrength.value = Math.min(
      Number(u.referenceGuideStrength.value) || 0,
      THREE.MathUtils.lerp(0.075, 0.11, storm),
    );
  }

  // Restore broad, readable cumulus masses in clear/partly-cloudy weather. The
  // previous reference mask could pull effective coverage far below these values.
  const coverageFloor = THREE.MathUtils.lerp(0.50, 0.78, storm);
  const densityFloor = THREE.MathUtils.lerp(0.47, 0.72, storm);
  const humidityFloor = THREE.MathUtils.lerp(0.56, 0.84, storm);
  const convectionFloor = THREE.MathUtils.lerp(0.40, 0.78, storm);
  const erosionCeiling = THREE.MathUtils.lerp(0.50, 0.30, storm);

  if (u.coverage) u.coverage.value = clamp01(Math.max(Number(u.coverage.value) || 0, coverageFloor));
  if (u.density) u.density.value = clamp01(Math.max(Number(u.density.value) || 0, densityFloor));
  if (u.humidity) u.humidity.value = clamp01(Math.max(Number(u.humidity.value) || 0, humidityFloor));
  if (u.convection) u.convection.value = clamp01(Math.max(Number(u.convection.value) || 0, convectionFloor));
  if (u.erosion) u.erosion.value = Math.min(Number(u.erosion.value) || 0.7, erosionCeiling);

  // Give fair-weather clouds enough vertical body to be visible above the
  // horizon and allow genuine storm towers to grow much higher. This is still
  // one continuous physical slab; no billboard/photo cloud layer is added.
  const baseTarget = THREE.MathUtils.lerp(46, 36, storm);
  const topTarget = THREE.MathUtils.lerp(138, 188, storm);
  if (u.cloudBaseY) u.cloudBaseY.value = Math.min(Number(u.cloudBaseY.value) || 58, baseTarget);
  if (u.cloudTopY) u.cloudTopY.value = Math.max(Number(u.cloudTopY.value) || 108, topTarget);

  liftCloudPalette(handle, storm);

  // Keep the launch/display planes aligned with the revised physical cloud base.
  const cloudBase = Number(u.cloudBaseY?.value) || baseTarget;
  if (handle.mesh) handle.mesh.position.y = cloudBase;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = cloudBase;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = cloudBase;

  // The cheap cirrus layer should complement the volume rather than wash out the
  // sky. It remains subtle in fair weather and almost disappears in storms.
  const cirrus = handle.__riftCirrus;
  if (cirrus?.material) {
    cirrus.material.opacity = THREE.MathUtils.lerp(0.055, 0.018, storm);
  }

  globalThis.__riftReferenceCloudV2Debug = {
    guideStrength: Number(u.referenceGuideStrength?.value) || 0,
    coverage: Number(u.coverage?.value) || 0,
    density: Number(u.density?.value) || 0,
    base: Number(u.cloudBaseY?.value) || 0,
    top: Number(u.cloudTopY?.value) || 0,
    storm,
    convection,
  };
}

export function createVolumetricClouds(scene) {
  return createReferenceClouds(scene);
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
  updateReferenceClouds(
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

  rebalanceCloudField(handle, camera, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  delete globalThis.__riftReferenceCloudV2Debug;
  return disposeReferenceClouds(handle);
}
