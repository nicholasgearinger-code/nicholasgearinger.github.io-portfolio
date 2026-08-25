import * as THREE from "three";
import {
  createVolumetricClouds as createProgressiveClouds,
  updateVolumetricClouds as updateProgressiveClouds,
  disposeVolumetricClouds as disposeProgressiveClouds,
} from "./volumetricClouds_progressive_v1.js";
import { createR185ClusteredEnvelopePair } from "./cloudEnvelopeR185_v2.js";

// -----------------------------------------------------------------------------
// r185 cloud presentation v1.5 — stability-first clustered cumulus.
//
// The experimental v2 density shader introduced a Safari/WebGPU runtime failure.
// Keep the r185.1 migration moving by retaining the proven Nubis/Perlin-Worley
// shader and replacing only its macro weather envelope + tuning. This gives us
// separated cloud families and much rounder cells without adding a new TSL
// compile path while we isolate the v2 failure.
// -----------------------------------------------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function installClusteredEnvelope(handle) {
  if (!handle || handle.__riftR185V15EnvelopeInstalled) return;
  const quality = handle.__riftProgressiveQuality || handle.__riftNubisV2Quality;
  const size = Math.max(128, Number(quality?.envelopeSize) || 160);

  handle.__riftNubisEnvelopes?.a?.dispose?.();
  handle.__riftNubisEnvelopes?.b?.dispose?.();
  handle.__riftNubisEnvelopes = createR185ClusteredEnvelopePair(size);
  handle.__riftR185V15EnvelopeInstalled = true;
}

function tuneStableClusteredCumulus(handle, rainIntensity) {
  const u = handle?.uniforms;
  if (!u) return;

  const weather = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(weather?.stormIntensity ?? rainIntensity);
  const requestedCoverage = clamp01(weather?.cloudCoverage ?? 0.30);

  // Keep generous blue gaps in fair weather; storms may still connect into a deck.
  if (u.coverage) {
    const fair = THREE.MathUtils.clamp(requestedCoverage, 0.23, 0.37);
    u.coverage.value = THREE.MathUtils.lerp(fair, 0.80, storm);
  }
  if (u.density) u.density.value = THREE.MathUtils.lerp(0.50, 0.81, storm);
  if (u.humidity) u.humidity.value = THREE.MathUtils.lerp(0.66, 0.93, storm);
  if (u.convection) u.convection.value = THREE.MathUtils.lerp(0.79, 0.98, storm);
  if (u.erosion) u.erosion.value = THREE.MathUtils.lerp(0.44, 0.29, storm);

  // Higher broad-noise frequency than v1 so each macro family contains several
  // distinct rounded lobes rather than one smooth vertical mass.
  if (u.pwBaseScale) u.pwBaseScale.value = THREE.MathUtils.lerp(0.46, 0.41, storm);
  if (u.pwDetailScale) u.pwDetailScale.value = THREE.MathUtils.lerp(5.9, 4.7, storm);
  if (u.pwDensityBias) u.pwDensityBias.value = THREE.MathUtils.lerp(-0.078, -0.030, storm);

  // The clustered envelope should place/grow cloud systems, but the 3D volume
  // remains responsible for visible edges and cauliflower detail.
  if (u.nubisEnvelopeStrength) u.nubisEnvelopeStrength.value = THREE.MathUtils.lerp(0.60, 0.90, storm);
  if (u.nubisEdgeErosion) u.nubisEdgeErosion.value = THREE.MathUtils.lerp(0.40, 0.28, storm);
  if (u.nubisDensityScale) u.nubisDensityScale.value = THREE.MathUtils.lerp(0.94, 1.14, storm);
  if (u.nubisDomainWarp) u.nubisDomainWarp.value = THREE.MathUtils.lerp(0.043, 0.049, storm);

  // Values near 1 mean very little vertical compression in the existing Nubis
  // shader. This is the main stability-safe way to avoid tall stacked columns.
  if (u.nubisVerticalStretch) u.nubisVerticalStretch.value = THREE.MathUtils.lerp(0.97, 0.78, storm);

  // Increase directional contrast and remove the white ambient wash that made
  // every shape look like an opaque cutout.
  if (u.nubisAmbientBoost) u.nubisAmbientBoost.value = THREE.MathUtils.lerp(0.40, 0.43, storm);
  if (u.nubisMultiScatter) u.nubisMultiScatter.value = THREE.MathUtils.lerp(0.23, 0.24, storm);
  if (u.nubisLightExtinction) u.nubisLightExtinction.value = THREE.MathUtils.lerp(0.68, 0.78, storm);
  if (u.referenceGuideStrength) u.referenceGuideStrength.value = 0;
  if (u.referencePaletteStrength) u.referencePaletteStrength.value = 0;

  const baseTarget = THREE.MathUtils.lerp(50, 32, storm);
  const topTarget = THREE.MathUtils.lerp(162, 244, storm);
  if (u.cloudBaseY) u.cloudBaseY.value = baseTarget;
  if (u.cloudTopY) u.cloudTopY.value = topTarget;

  const baseY = Number(u.cloudBaseY?.value) || baseTarget;
  if (handle.mesh) handle.mesh.position.y = baseY;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;

  // Freeze frame-wide ray jitter and almost eliminate upper-level shear. Both
  // previously exposed the march depth as visible horizontal shelves.
  if (u.nubisFrameJitter) u.nubisFrameJitter.value = 0.5;
  if (u.nubisShear?.value) {
    u.nubisShear.value.multiplyScalar(THREE.MathUtils.lerp(0.045, 0.14, storm));
  }

  if (handle.__riftCirrus?.material) {
    handle.__riftCirrus.material.opacity = THREE.MathUtils.lerp(0.008, 0.004, storm);
  }

  globalThis.__riftR185CloudDebug = {
    enabled: true,
    version: "1.5-stable",
    threeRevision: THREE.REVISION,
    architecture: "clustered macro envelope + proven Nubis/Perlin-Worley density",
    coverage: Number(u.coverage?.value) || 0,
    density: Number(u.density?.value) || 0,
    baseScale: Number(u.pwBaseScale?.value) || 0,
    verticalStretch: Number(u.nubisVerticalStretch?.value) || 0,
    cloudBase: Number(u.cloudBaseY?.value) || 0,
    cloudTop: Number(u.cloudTopY?.value) || 0,
    storm,
  };
}

export function createVolumetricClouds(scene) {
  const handle = createProgressiveClouds(scene);
  if (!handle) return handle;
  installClusteredEnvelope(handle);
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
  tuneStableClusteredCumulus(handle, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  if (handle) handle.__riftR185V15EnvelopeInstalled = false;
  delete globalThis.__riftR185CloudDebug;
  return disposeProgressiveClouds(handle);
}
