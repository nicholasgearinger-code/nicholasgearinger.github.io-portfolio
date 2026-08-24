import * as THREE from "three";
import {
  createVolumetricClouds as createPWClouds,
  updateVolumetricClouds as updatePWClouds,
  disposeVolumetricClouds as disposePWClouds,
} from "./volumetricClouds_perlinWorley.js";

// -----------------------------------------------------------------------------
// Perlin-Worley presentation v2 — large, fluffy tropical cumulus.
//
// The true PW volume fixed the underlying density model, but the inherited world
// frequency was still high enough to produce many small cloudlets and the fair-
// weather profile retained too much stratiform influence. This layer keeps the
// same GPU raymarch and textures while tuning the physical scale/profile:
//   * larger low-frequency cloud bodies;
//   * taller fair-weather cumulus;
//   * stronger convection / less flat stratus mixing;
//   * fine detail remains high-frequency so edges stay cauliflower-like;
//   * brighter multiple-scattered interiors in clear weather.
// -----------------------------------------------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function tuneFluffyCumulus(handle, rainIntensity) {
  const u = handle?.uniforms;
  if (!u) return;

  const state = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(state?.stormIntensity ?? rainIntensity);

  // Roughly double the horizontal wavelength of the broad PW mass. The detail
  // volume keeps a much higher independent scale, so we get big bodies with fine
  // eroded edges instead of simply zooming the entire texture.
  if (u.pwBaseScale) {
    u.pwBaseScale.value = THREE.MathUtils.lerp(0.50, 0.62, storm);
  }
  if (u.pwDetailScale) {
    u.pwDetailScale.value = THREE.MathUtils.lerp(4.45, 3.85, storm);
  }
  if (u.pwDensityBias) {
    u.pwDensityBias.value = THREE.MathUtils.lerp(-0.055, -0.025, storm);
  }

  // Broad fair-weather masses with enough local moisture to form real towers.
  if (u.coverage) {
    u.coverage.value = clamp01(Math.max(
      Number(u.coverage.value) || 0,
      THREE.MathUtils.lerp(0.52, 0.80, storm),
    ));
  }
  if (u.density) {
    u.density.value = clamp01(Math.max(
      Number(u.density.value) || 0,
      THREE.MathUtils.lerp(0.50, 0.75, storm),
    ));
  }
  if (u.humidity) {
    u.humidity.value = clamp01(Math.max(
      Number(u.humidity.value) || 0,
      THREE.MathUtils.lerp(0.61, 0.88, storm),
    ));
  }
  if (u.convection) {
    u.convection.value = clamp01(Math.max(
      Number(u.convection.value) || 0,
      THREE.MathUtils.lerp(0.70, 0.90, storm),
    ));
  }

  // Large cloud bodies should not be carved apart by erosion. Keep fine Worley
  // breakup visible primarily at the boundary.
  if (u.pwErosion) u.pwErosion.value = THREE.MathUtils.lerp(0.31, 0.26, storm);
  if (u.erosion) {
    u.erosion.value = Math.min(
      Number(u.erosion.value) || 0.7,
      THREE.MathUtils.lerp(0.42, 0.29, storm),
    );
  }

  // A cloud is a very strong multiple-scattering medium. Raising the clear-sky
  // floor keeps sunlit cumulus white/gray instead of muddy while storms retain
  // deeper optical depth and contrast.
  if (u.pwMultipleScatter) {
    u.pwMultipleScatter.value = THREE.MathUtils.lerp(0.38, 0.25, storm);
  }
  if (u.pwLightExtinction) {
    u.pwLightExtinction.value = THREE.MathUtils.lerp(0.50, 0.69, storm);
  }
  if (u.referencePaletteStrength) {
    u.referencePaletteStrength.value = THREE.MathUtils.lerp(0.28, 0.43, storm);
  }
  if (u.referenceGuideStrength) {
    u.referenceGuideStrength.value = Math.min(
      Number(u.referenceGuideStrength.value) || 0,
      THREE.MathUtils.lerp(0.025, 0.045, storm),
    );
  }

  // Taller volume makes the large low-frequency PW lobes read as genuine
  // cauliflower towers instead of low horizontal patches. Storms still get a
  // substantially deeper layer for cumulonimbus development.
  const baseTarget = THREE.MathUtils.lerp(42, 34, storm);
  const topTarget = THREE.MathUtils.lerp(164, 214, storm);
  if (u.cloudBaseY) u.cloudBaseY.value = Math.min(Number(u.cloudBaseY.value) || 58, baseTarget);
  if (u.cloudTopY) u.cloudTopY.value = Math.max(Number(u.cloudTopY.value) || 108, topTarget);

  const baseY = Number(u.cloudBaseY?.value) || baseTarget;
  if (handle.mesh) handle.mesh.position.y = baseY;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;

  // The high cirrus layer should not compete with the newly enlarged cumulus.
  if (handle.__riftCirrus?.material) {
    handle.__riftCirrus.material.opacity = THREE.MathUtils.lerp(0.035, 0.012, storm);
  }

  globalThis.__riftPWCloudV2Debug = {
    baseScale: Number(u.pwBaseScale?.value) || 0,
    detailScale: Number(u.pwDetailScale?.value) || 0,
    coverage: Number(u.coverage?.value) || 0,
    density: Number(u.density?.value) || 0,
    convection: Number(u.convection?.value) || 0,
    base: Number(u.cloudBaseY?.value) || 0,
    top: Number(u.cloudTopY?.value) || 0,
    storm,
  };
}

export function createVolumetricClouds(scene) {
  return createPWClouds(scene);
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
  updatePWClouds(
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

  tuneFluffyCumulus(handle, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  delete globalThis.__riftPWCloudV2Debug;
  return disposePWClouds(handle);
}
