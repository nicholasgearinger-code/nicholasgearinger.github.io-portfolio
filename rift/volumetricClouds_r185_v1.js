import * as THREE from "three";
import {
  createVolumetricClouds as createProgressiveClouds,
  updateVolumetricClouds as updateProgressiveClouds,
  disposeVolumetricClouds as disposeProgressiveClouds,
} from "./volumetricClouds_progressive_v1.js";
import { createR185CumulusEnvelopePair } from "./cloudEnvelopeR185.js";

// -----------------------------------------------------------------------------
// r185 cumulus presentation v1.
//
// The migration to Three r185.1 is now booting correctly on Safari/WebGPU. This
// pass keeps the proven quarter-resolution progressive renderer, but changes the
// cloud organization so it no longer behaves like a 2D coverage mask extruded
// through almost the entire cloud layer. Large smooth cloud-top variation comes
// from cloudEnvelopeR185.js; the 3D Perlin-Worley volume still owns the actual
// billowy silhouette and fine erosion.
// -----------------------------------------------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function installR185Envelope(handle) {
  if (!handle || handle.__riftR185EnvelopeInstalled) return;

  const quality = handle.__riftNubisV2Quality;
  const size = Math.max(128, Number(quality?.envelopeSize) || 160);

  handle.__riftNubisEnvelopes?.a?.dispose?.();
  handle.__riftNubisEnvelopes?.b?.dispose?.();
  handle.__riftNubisEnvelopes = createR185CumulusEnvelopePair(size);
  handle.__riftR185EnvelopeInstalled = true;
}

function tuneR185Cumulus(handle, rainIntensity) {
  const u = handle?.uniforms;
  if (!u) return;

  const weather = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(weather?.stormIntensity ?? rainIntensity);
  const requestedCoverage = clamp01(weather?.cloudCoverage ?? 0.34);

  // Fewer, larger cells with real blue gaps. The old 0.38-0.52 clear-weather
  // clamp was too eager to fill the sky once each cell was vertically deep.
  if (u.coverage) {
    const fair = THREE.MathUtils.clamp(requestedCoverage, 0.28, 0.42);
    u.coverage.value = THREE.MathUtils.lerp(fair, 0.82, storm);
  }
  if (u.density) u.density.value = THREE.MathUtils.lerp(0.54, 0.82, storm);
  if (u.humidity) u.humidity.value = THREE.MathUtils.lerp(0.68, 0.94, storm);
  if (u.convection) u.convection.value = THREE.MathUtils.lerp(0.82, 0.99, storm);
  if (u.erosion) u.erosion.value = THREE.MathUtils.lerp(0.37, 0.28, storm);

  // Slightly smaller broad frequency than the current progressive pass, but not
  // so low that one cloud becomes a featureless wall. Fine detail remains much
  // higher-frequency and therefore only carves the cloud boundary.
  if (u.pwBaseScale) u.pwBaseScale.value = THREE.MathUtils.lerp(0.34, 0.39, storm);
  if (u.pwDetailScale) u.pwDetailScale.value = THREE.MathUtils.lerp(5.8, 4.7, storm);
  if (u.pwDensityBias) u.pwDensityBias.value = THREE.MathUtils.lerp(-0.060, -0.025, storm);

  // The weather envelope provides macro organization and top potential, not the
  // visible edge. Keep enough authority to shape individual cloud heights while
  // allowing the 3D volume to break up every boundary.
  if (u.nubisEnvelopeStrength) u.nubisEnvelopeStrength.value = THREE.MathUtils.lerp(0.82, 0.96, storm);
  if (u.nubisEdgeErosion) u.nubisEdgeErosion.value = THREE.MathUtils.lerp(0.33, 0.26, storm);
  if (u.nubisDensityScale) u.nubisDensityScale.value = THREE.MathUtils.lerp(0.98, 1.17, storm);
  if (u.nubisDomainWarp) u.nubisDomainWarp.value = THREE.MathUtils.lerp(0.052, 0.046, storm);

  // Important: values closer to 1.0 mean less artificial vertical compression
  // in the current Nubis shader. The previous 0.7-0.8 range stretched every
  // density lobe upward and was a direct contributor to the tall stacked-column
  // look visible on the phone. Clear-weather cells should stay much rounder.
  if (u.nubisVerticalStretch) u.nubisVerticalStretch.value = THREE.MathUtils.lerp(0.94, 0.74, storm);

  // Brighter sun-facing crowns with readable blue-gray interiors. Avoid the high
  // ambient floor that turns the entire cloud into one white translucent block.
  if (u.nubisAmbientBoost) u.nubisAmbientBoost.value = THREE.MathUtils.lerp(0.48, 0.42, storm);
  if (u.nubisMultiScatter) u.nubisMultiScatter.value = THREE.MathUtils.lerp(0.27, 0.23, storm);
  if (u.nubisLightExtinction) u.nubisLightExtinction.value = THREE.MathUtils.lerp(0.62, 0.76, storm);
  if (u.referenceGuideStrength) u.referenceGuideStrength.value = 0;
  if (u.referencePaletteStrength) u.referencePaletteStrength.value = THREE.MathUtils.lerp(0.015, 0.10, storm);

  // Keep fair-weather depth moderate. The new envelope itself varies each local
  // cloud top from low cumulus to tall cells, so the global layer no longer has
  // to be extremely deep to produce vertical variety.
  const baseTarget = THREE.MathUtils.lerp(50, 32, storm);
  const topTarget = THREE.MathUtils.lerp(174, 248, storm);
  if (u.cloudBaseY) u.cloudBaseY.value = baseTarget;
  if (u.cloudTopY) u.cloudTopY.value = topTarget;

  const baseY = Number(u.cloudBaseY?.value) || baseTarget;
  if (handle.mesh) handle.mesh.position.y = baseY;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;

  // Real fair-weather cumulus can shear a little, but the old values were large
  // enough to visually separate one tower into several horizontal shelves.
  if (u.nubisShear?.value) {
    u.nubisShear.value.multiplyScalar(0.18 + storm * 0.22);
  }

  if (handle.__riftCirrus?.material) {
    handle.__riftCirrus.material.opacity = THREE.MathUtils.lerp(0.012, 0.005, storm);
  }

  globalThis.__riftR185CloudDebug = {
    enabled: true,
    version: 1,
    threeRevision: THREE.REVISION,
    coverage: Number(u.coverage?.value) || 0,
    density: Number(u.density?.value) || 0,
    baseScale: Number(u.pwBaseScale?.value) || 0,
    verticalStretch: Number(u.nubisVerticalStretch?.value) || 0,
    cloudBase: Number(u.cloudBaseY?.value) || 0,
    cloudTop: Number(u.cloudTopY?.value) || 0,
    reconstruction: globalThis.__riftProgressiveCloudDebug?.reconstruction || "unknown",
    storm,
  };
}

export function createVolumetricClouds(scene) {
  const handle = createProgressiveClouds(scene);
  if (!handle) return handle;
  installR185Envelope(handle);
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
  tuneR185Cumulus(handle, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  if (handle) handle.__riftR185EnvelopeInstalled = false;
  delete globalThis.__riftR185CloudDebug;
  return disposeProgressiveClouds(handle);
}
