import * as THREE from "three";
import {
  createVolumetricClouds as createProgressiveClouds,
  updateVolumetricClouds as updateProgressiveClouds,
  disposeVolumetricClouds as disposeProgressiveClouds,
} from "./volumetricClouds_progressive_v1.js";

// -----------------------------------------------------------------------------
// Photo-reference clouds v1
//
// Target: the user's bright summer-sky reference — a saturated blue sky with a
// broad, broken field of soft white cumulus / stratocumulus, irregular blue gaps,
// feathery eroded edges, gentle blue-gray depth, and a small amount of higher
// wispy cloud. This is intentionally a presentation layer on top of Rift's
// progressive volumetric renderer so mobile performance and the existing storm
// transition remain intact.
// -----------------------------------------------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function tunePhotoReference(handle, rainIntensity = 0) {
  const u = handle?.uniforms;
  if (!u) return;

  const weather = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(weather?.stormIntensity ?? rainIntensity);
  const requestedCoverage = clamp01(weather?.cloudCoverage ?? 0.50);

  // The reference has substantial cloud area, but it is broken into broad cells
  // with strong blue holes rather than becoming a continuous white ceiling.
  // Keep fair-weather coverage near 50–60%, then hand control back to the storm
  // profile as weather closes in.
  const fairCoverage = THREE.MathUtils.clamp(
    0.50 + (requestedCoverage - 0.45) * 0.36,
    0.46,
    0.60,
  );
  if (u.coverage) u.coverage.value = THREE.MathUtils.lerp(fairCoverage, 0.84, storm);

  // Softer body density and a little more humidity produce bright milky cloud
  // bodies with semi-transparent fringes instead of dense cotton-ball cutouts.
  if (u.density) u.density.value = THREE.MathUtils.lerp(0.47, 0.82, storm);
  if (u.humidity) u.humidity.value = THREE.MathUtils.lerp(0.78, 0.94, storm);
  if (u.convection) u.convection.value = THREE.MathUtils.lerp(0.72, 0.99, storm);
  if (u.erosion) u.erosion.value = THREE.MathUtils.lerp(0.46, 0.30, storm);

  // Large low-frequency masses create the broad patches seen in the photo. A
  // stronger high-frequency detail field and edge erosion break those masses into
  // natural wisps and scalloped edges while preserving coherent cloud systems.
  if (u.pwBaseScale) u.pwBaseScale.value = THREE.MathUtils.lerp(0.225, 0.36, storm);
  if (u.pwDetailScale) u.pwDetailScale.value = THREE.MathUtils.lerp(6.45, 4.60, storm);
  if (u.pwDensityBias) u.pwDensityBias.value = THREE.MathUtils.lerp(-0.060, -0.022, storm);

  // Reduce macro-envelope dominance in fair weather. The 3D Perlin-Worley body
  // then owns more of the silhouette, which is what gives the reference its soft,
  // irregular, partly shredded perimeter rather than a clean procedural blob.
  if (u.nubisEnvelopeStrength) u.nubisEnvelopeStrength.value = THREE.MathUtils.lerp(0.58, 0.92, storm);
  if (u.nubisEdgeErosion) u.nubisEdgeErosion.value = THREE.MathUtils.lerp(0.405, 0.26, storm);
  if (u.nubisDensityScale) u.nubisDensityScale.value = THREE.MathUtils.lerp(0.92, 1.16, storm);
  if (u.nubisDomainWarp) u.nubisDomainWarp.value = THREE.MathUtils.lerp(0.070, 0.047, storm);

  // The photographed layer is broad and only moderately vertically developed.
  // Keep fair-weather cells shallower than the previous cauliflower-heavy preset;
  // storms still grow into the existing deeper convective volume.
  if (u.nubisVerticalStretch) u.nubisVerticalStretch.value = THREE.MathUtils.lerp(0.70, 0.70, storm);

  // Bright diffuse daylight is a defining feature of the reference. Increase
  // skylight/multiple scattering and reduce fair-weather extinction so cloud tops
  // stay luminous while interiors retain just enough cool gray volume shading.
  if (u.nubisAmbientBoost) u.nubisAmbientBoost.value = THREE.MathUtils.lerp(0.69, 0.47, storm);
  if (u.nubisMultiScatter) u.nubisMultiScatter.value = THREE.MathUtils.lerp(0.37, 0.22, storm);
  if (u.nubisLightExtinction) u.nubisLightExtinction.value = THREE.MathUtils.lerp(0.44, 0.74, storm);
  if (u.referenceGuideStrength) u.referenceGuideStrength.value = 0;
  if (u.referencePaletteStrength) u.referencePaletteStrength.value = THREE.MathUtils.lerp(0.018, 0.12, storm);

  // Fair-weather layer height/depth: wide stratocumulus/cumulus field rather than
  // towering isolated cells. Storm interpolation preserves the deeper old profile.
  const baseTarget = THREE.MathUtils.lerp(54, 31, storm);
  const topTarget = THREE.MathUtils.lerp(150, 250, storm);
  if (u.cloudBaseY) u.cloudBaseY.value = baseTarget;
  if (u.cloudTopY) u.cloudTopY.value = topTarget;

  const baseY = Number(u.cloudBaseY?.value) || baseTarget;
  if (handle.mesh) handle.mesh.position.y = baseY;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;

  // The photo contains a thin, high wispy component above the main cloud deck.
  // Reuse Rift's lightweight cirrus layer rather than adding another raymarch.
  if (handle.__riftCirrus?.material) {
    handle.__riftCirrus.material.opacity = THREE.MathUtils.lerp(0.052, 0.006, storm);
  }

  globalThis.__riftPhotoCloudDebug = {
    version: 1,
    target: "broken-summer-cumulus-stratocumulus",
    coverage: Number(u.coverage?.value) || 0,
    density: Number(u.density?.value) || 0,
    erosion: Number(u.erosion?.value) || 0,
    baseScale: Number(u.pwBaseScale?.value) || 0,
    detailScale: Number(u.pwDetailScale?.value) || 0,
    edgeErosion: Number(u.nubisEdgeErosion?.value) || 0,
    ambientBoost: Number(u.nubisAmbientBoost?.value) || 0,
    cloudBase: Number(u.cloudBaseY?.value) || 0,
    cloudTop: Number(u.cloudTopY?.value) || 0,
    storm,
  };
}

export function createVolumetricClouds(scene) {
  const handle = createProgressiveClouds(scene);
  if (handle) handle.__riftPhotoReferenceClouds = true;
  return handle;
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
  updateProgressiveClouds(
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

  tunePhotoReference(handle, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  if (handle) handle.__riftPhotoReferenceClouds = false;
  delete globalThis.__riftPhotoCloudDebug;
  return disposeProgressiveClouds(handle);
}
