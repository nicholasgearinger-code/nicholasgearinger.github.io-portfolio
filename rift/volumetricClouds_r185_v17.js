import * as THREE from "three";
import {
  createVolumetricClouds as createProgressiveClouds,
  updateVolumetricClouds as updateProgressiveClouds,
  disposeVolumetricClouds as disposeProgressiveClouds,
} from "./volumetricClouds_progressive_v1.js";
import { createR185PersistentEnvelopePair } from "./cloudEnvelopeR185_v4.js";

// r185 cloud presentation v1.7 — persistent scattered cumulus.
//
// V1.6 made the macro shapes less boxy, but it over-thinned the cloud field: on
// mobile the player could see a few clouds at startup and then spend long periods
// in almost-clear sky. V1.7 keeps the proven Safari-safe shader, increases spatial
// occupancy, and backs off the most aggressive erosion/bias values while keeping
// the rounded/scalloped shape direction.

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function installPersistentEnvelope(handle) {
  if (!handle || handle.__riftR185V17EnvelopeInstalled) return;
  const quality = handle.__riftProgressiveQuality || handle.__riftNubisV2Quality;
  const size = Math.max(128, Number(quality?.envelopeSize) || 160);

  handle.__riftNubisEnvelopes?.a?.dispose?.();
  handle.__riftNubisEnvelopes?.b?.dispose?.();
  handle.__riftNubisEnvelopes = createR185PersistentEnvelopePair(size);
  handle.__riftR185V17EnvelopeInstalled = true;
}

function tunePersistentCumulus(handle, rainIntensity) {
  const u = handle?.uniforms;
  if (!u) return;

  const weather = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(weather?.stormIntensity ?? rainIntensity);
  const requestedCoverage = clamp01(weather?.cloudCoverage ?? 0.34);

  // Maintain visible fair-weather cloud occupancy even when the weather state is
  // temporarily low. The macro map still leaves substantial blue gaps.
  if (u.coverage) {
    const fair = THREE.MathUtils.clamp(requestedCoverage, 0.31, 0.43);
    u.coverage.value = THREE.MathUtils.lerp(fair, 0.80, storm);
  }
  if (u.density) u.density.value = THREE.MathUtils.lerp(0.53, 0.81, storm);
  if (u.humidity) u.humidity.value = THREE.MathUtils.lerp(0.69, 0.93, storm);
  if (u.convection) u.convection.value = THREE.MathUtils.lerp(0.80, 0.98, storm);
  if (u.erosion) u.erosion.value = THREE.MathUtils.lerp(0.43, 0.30, storm);

  // Preserve multiple 3D lobes per cloud family, but restore enough broad mass
  // that the clouds do not dissolve completely between envelope clusters.
  if (u.pwBaseScale) u.pwBaseScale.value = THREE.MathUtils.lerp(0.53, 0.43, storm);
  if (u.pwDetailScale) u.pwDetailScale.value = THREE.MathUtils.lerp(6.1, 4.8, storm);
  if (u.pwDensityBias) u.pwDensityBias.value = THREE.MathUtils.lerp(-0.070, -0.030, storm);

  if (u.nubisEnvelopeStrength) u.nubisEnvelopeStrength.value = THREE.MathUtils.lerp(0.92, 1.00, storm);
  if (u.nubisEdgeErosion) u.nubisEdgeErosion.value = THREE.MathUtils.lerp(0.45, 0.30, storm);
  if (u.nubisDensityScale) u.nubisDensityScale.value = THREE.MathUtils.lerp(0.98, 1.13, storm);
  if (u.nubisDomainWarp) u.nubisDomainWarp.value = THREE.MathUtils.lerp(0.047, 0.050, storm);
  if (u.nubisVerticalStretch) u.nubisVerticalStretch.value = THREE.MathUtils.lerp(0.985, 0.80, storm);

  // Keep some blue-gray interior fill, but avoid the old white-cardboard look.
  if (u.nubisAmbientBoost) u.nubisAmbientBoost.value = THREE.MathUtils.lerp(0.36, 0.42, storm);
  if (u.nubisMultiScatter) u.nubisMultiScatter.value = THREE.MathUtils.lerp(0.20, 0.23, storm);
  if (u.nubisLightExtinction) u.nubisLightExtinction.value = THREE.MathUtils.lerp(0.70, 0.79, storm);
  if (u.referenceGuideStrength) u.referenceGuideStrength.value = 0;
  if (u.referencePaletteStrength) u.referencePaletteStrength.value = 0;

  const baseTarget = THREE.MathUtils.lerp(51, 32, storm);
  const topTarget = THREE.MathUtils.lerp(154, 242, storm);
  if (u.cloudBaseY) u.cloudBaseY.value = baseTarget;
  if (u.cloudTopY) u.cloudTopY.value = topTarget;

  const baseY = Number(u.cloudBaseY?.value) || baseTarget;
  if (handle.mesh) handle.mesh.position.y = baseY;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;

  if (u.nubisFrameJitter) u.nubisFrameJitter.value = 0.5;
  if (u.nubisShear?.value) {
    u.nubisShear.value.multiplyScalar(THREE.MathUtils.lerp(0.020, 0.12, storm));
  }

  if (handle.__riftCirrus?.material) {
    handle.__riftCirrus.material.opacity = THREE.MathUtils.lerp(0.009, 0.004, storm);
  }

  globalThis.__riftR185CloudDebug = {
    enabled: true,
    version: "1.7-persistent-cumulus",
    threeRevision: THREE.REVISION,
    architecture: "persistent scalloped macro field + proven Nubis/Perlin-Worley density",
    coverage: Number(u.coverage?.value) || 0,
    density: Number(u.density?.value) || 0,
    baseScale: Number(u.pwBaseScale?.value) || 0,
    edgeErosion: Number(u.nubisEdgeErosion?.value) || 0,
    cloudBase: Number(u.cloudBaseY?.value) || 0,
    cloudTop: Number(u.cloudTopY?.value) || 0,
    storm,
  };
}

export function createVolumetricClouds(scene) {
  const handle = createProgressiveClouds(scene);
  if (!handle) return handle;
  installPersistentEnvelope(handle);
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

  if (!handle) return;
  tunePersistentCumulus(handle, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  if (handle) handle.__riftR185V17EnvelopeInstalled = false;
  delete globalThis.__riftR185CloudDebug;
  return disposeProgressiveClouds(handle);
}
