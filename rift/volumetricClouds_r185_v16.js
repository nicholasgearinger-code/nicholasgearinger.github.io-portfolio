import * as THREE from "three";
import {
  createVolumetricClouds as createProgressiveClouds,
  updateVolumetricClouds as updateProgressiveClouds,
  disposeVolumetricClouds as disposeProgressiveClouds,
} from "./volumetricClouds_progressive_v1.js";
import { createR185ScallopedEnvelopePair } from "./cloudEnvelopeR185_v3.js";

// -----------------------------------------------------------------------------
// r185 cloud presentation v1.6 — reference-oriented fair-weather cumulus.
//
// Stability rule: keep the already-proven Nubis/Perlin-Worley TSL shader that
// runs on Safari/WebGPU. Improve only its inputs/tuning so the test remains easy
// to bisect. V1.6 targets Sky-Pro-like scattered cumulus: scalloped families,
// flatter bases, rounded crowns, more blue gaps, darker interiors and almost no
// artificial vertical extrusion/shear.
// -----------------------------------------------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function installScallopedEnvelope(handle) {
  if (!handle || handle.__riftR185V16EnvelopeInstalled) return;
  const quality = handle.__riftProgressiveQuality || handle.__riftNubisV2Quality;
  const size = Math.max(128, Number(quality?.envelopeSize) || 160);

  handle.__riftNubisEnvelopes?.a?.dispose?.();
  handle.__riftNubisEnvelopes?.b?.dispose?.();
  handle.__riftNubisEnvelopes = createR185ScallopedEnvelopePair(size);
  handle.__riftR185V16EnvelopeInstalled = true;
}

function tuneReferenceCumulus(handle, rainIntensity) {
  const u = handle?.uniforms;
  if (!u) return;

  const weather = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(weather?.stormIntensity ?? rainIntensity);
  const requestedCoverage = clamp01(weather?.cloudCoverage ?? 0.28);

  // Reference target: separated cloud families with a lot of clean sky between
  // them. Storm mode is still allowed to close the gaps into a cloud deck.
  if (u.coverage) {
    const fair = THREE.MathUtils.clamp(requestedCoverage, 0.20, 0.32);
    u.coverage.value = THREE.MathUtils.lerp(fair, 0.79, storm);
  }
  if (u.density) u.density.value = THREE.MathUtils.lerp(0.47, 0.80, storm);
  if (u.humidity) u.humidity.value = THREE.MathUtils.lerp(0.64, 0.93, storm);
  if (u.convection) u.convection.value = THREE.MathUtils.lerp(0.76, 0.98, storm);
  if (u.erosion) u.erosion.value = THREE.MathUtils.lerp(0.52, 0.30, storm);

  // Smaller 3D base lobes are the biggest shape improvement available without
  // replacing the shader itself. More lobes fit inside each macro family, giving
  // the characteristic cauliflower crown instead of one smooth box/dome.
  if (u.pwBaseScale) u.pwBaseScale.value = THREE.MathUtils.lerp(0.58, 0.43, storm);
  if (u.pwDetailScale) u.pwDetailScale.value = THREE.MathUtils.lerp(6.6, 4.8, storm);
  if (u.pwDensityBias) u.pwDensityBias.value = THREE.MathUtils.lerp(-0.105, -0.032, storm);

  // Push the stable shader as far as its existing envelope blend allows. The new
  // scalloped map now controls placement while the 3D density controls the edge.
  if (u.nubisEnvelopeStrength) u.nubisEnvelopeStrength.value = THREE.MathUtils.lerp(1.00, 1.00, storm);
  if (u.nubisEdgeErosion) u.nubisEdgeErosion.value = THREE.MathUtils.lerp(0.54, 0.30, storm);
  if (u.nubisDensityScale) u.nubisDensityScale.value = THREE.MathUtils.lerp(0.90, 1.12, storm);
  if (u.nubisDomainWarp) u.nubisDomainWarp.value = THREE.MathUtils.lerp(0.046, 0.050, storm);

  // Near-1 values remove the old artificial Y compression that stretched every
  // Worley lobe into a tower. Storms retain some vertical development.
  if (u.nubisVerticalStretch) u.nubisVerticalStretch.value = THREE.MathUtils.lerp(0.995, 0.80, storm);

  // Sky Pro reference has readable blue-gray self-shadow under the bright crown.
  // Reduce ambient/multiscatter wash while keeping enough fill for mobile HDR.
  if (u.nubisAmbientBoost) u.nubisAmbientBoost.value = THREE.MathUtils.lerp(0.32, 0.42, storm);
  if (u.nubisMultiScatter) u.nubisMultiScatter.value = THREE.MathUtils.lerp(0.19, 0.23, storm);
  if (u.nubisLightExtinction) u.nubisLightExtinction.value = THREE.MathUtils.lerp(0.73, 0.79, storm);
  if (u.referenceGuideStrength) u.referenceGuideStrength.value = 0;
  if (u.referencePaletteStrength) u.referencePaletteStrength.value = 0;

  // A shallower fair-weather slab prevents each surviving cloud from becoming a
  // giant vertical block. Local macro height variation still gives tall cells.
  const baseTarget = THREE.MathUtils.lerp(52, 32, storm);
  const topTarget = THREE.MathUtils.lerp(148, 242, storm);
  if (u.cloudBaseY) u.cloudBaseY.value = baseTarget;
  if (u.cloudTopY) u.cloudTopY.value = topTarget;

  const baseY = Number(u.cloudBaseY?.value) || baseTarget;
  if (handle.mesh) handle.mesh.position.y = baseY;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;

  // No whole-frame jitter; almost no upper shear in fair weather. The latter was
  // visually splitting one cumulus column into several offset horizontal slabs.
  if (u.nubisFrameJitter) u.nubisFrameJitter.value = 0.5;
  if (u.nubisShear?.value) {
    u.nubisShear.value.multiplyScalar(THREE.MathUtils.lerp(0.018, 0.12, storm));
  }

  if (handle.__riftCirrus?.material) {
    handle.__riftCirrus.material.opacity = THREE.MathUtils.lerp(0.010, 0.004, storm);
  }

  globalThis.__riftR185CloudDebug = {
    enabled: true,
    version: "1.6-scalloped-stable",
    threeRevision: THREE.REVISION,
    architecture: "scalloped macro families + proven Nubis/Perlin-Worley density",
    coverage: Number(u.coverage?.value) || 0,
    density: Number(u.density?.value) || 0,
    baseScale: Number(u.pwBaseScale?.value) || 0,
    verticalStretch: Number(u.nubisVerticalStretch?.value) || 0,
    edgeErosion: Number(u.nubisEdgeErosion?.value) || 0,
    cloudBase: Number(u.cloudBaseY?.value) || 0,
    cloudTop: Number(u.cloudTopY?.value) || 0,
    storm,
  };
}

export function createVolumetricClouds(scene) {
  const handle = createProgressiveClouds(scene);
  if (!handle) return handle;
  installScallopedEnvelope(handle);
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
  tuneReferenceCumulus(handle, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  if (handle) handle.__riftR185V16EnvelopeInstalled = false;
  delete globalThis.__riftR185CloudDebug;
  return disposeProgressiveClouds(handle);
}
