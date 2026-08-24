import * as THREE from "three";
import {
  createVolumetricClouds as createReferenceOceanV4,
  updateVolumetricClouds as updateReferenceOceanV4,
  disposeVolumetricClouds as disposeReferenceOceanV4,
} from "./volumetricClouds_reference_ocean_v4.js";

// -----------------------------------------------------------------------------
// Ocean-reference clouds v5.
//
// The previous reference pass fixed the overall scale/lighting direction, but on
// a phone the low-tier 14-step march still exposed individual depth samples as
// horizontal/stacked shelves. v5 spends more of the mobile budget inside actual
// cloud density, lowers fair-weather coverage, de-emphasizes stratiform envelope
// structure, increases rounded domain warp, and stabilizes the macro weather UV.
// The result is intended to read as separated cottony cumulus rather than layered
// sheets, while preserving Nubis v3's anti-vibration and temporal compositor.
// -----------------------------------------------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smoothFactor(dt, rate) {
  const safeDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
  return 1 - Math.exp(-safeDt * rate);
}

function installQualityUpgrade(handle) {
  const q = handle?.__riftNubisV2Quality;
  if (!q || handle.__riftOceanReferenceV5QualityInstalled) return;

  // This runs immediately after create(), before Nubis installs its TSL/WGSL
  // raymarch on the first update. Therefore these remain compile-time loop counts.
  // Low deliberately stops at 20 rather than 24-32 because the current r182 TRAA
  // cloud history must still run full-resolution on iPhone.
  if (q.viewSteps <= 14) {
    q.viewSteps = 20;
    q.lightSteps = Math.max(3, q.lightSteps || 0);
  } else if (q.viewSteps <= 18) {
    q.viewSteps = 28;
    q.lightSteps = Math.max(3, q.lightSteps || 0);
  } else {
    q.viewSteps = 40;
    q.lightSteps = Math.max(4, q.lightSteps || 0);
  }

  handle.__riftOceanReferenceV5QualityInstalled = true;
  handle.__riftOceanReferenceV5State = {
    weatherOffset: handle.uniforms?.weatherOffset?.value?.clone?.() ?? new THREE.Vector2(),
  };
}

function tunePhotographicCumulus(handle, dt, rainIntensity) {
  const u = handle?.uniforms;
  if (!u) return;

  const weather = globalThis.__riftProceduralWeatherState;
  const atmosphere = globalThis.__riftReferenceAtmosphere;
  const storm = clamp01(weather?.stormIntensity ?? rainIntensity);
  const requestedCoverage = clamp01(weather?.cloudCoverage ?? 0.31);

  // Reference-photo target: isolated broad cumulus with blue gaps. Storms are
  // allowed to close the sky, but fair weather should never become a white slab.
  if (u.coverage) {
    const fairCoverage = THREE.MathUtils.clamp(requestedCoverage, 0.24, 0.36);
    u.coverage.value = THREE.MathUtils.lerp(fairCoverage, 0.82, storm);
  }
  if (u.density) u.density.value = THREE.MathUtils.lerp(0.52, 0.80, storm);
  if (u.humidity) u.humidity.value = THREE.MathUtils.lerp(0.67, 0.92, storm);
  if (u.convection) u.convection.value = THREE.MathUtils.lerp(0.93, 0.99, storm);
  if (u.erosion) u.erosion.value = THREE.MathUtils.lerp(0.34, 0.27, storm);

  // Lower base frequency gives a few large bodies. The separate high-frequency
  // Worley volume then erodes only their edges, producing cauliflower detail
  // instead of creating many similarly-sized stacked cloudlets.
  if (u.pwBaseScale) u.pwBaseScale.value = THREE.MathUtils.lerp(0.18, 0.27, storm);
  if (u.pwDetailScale) u.pwDetailScale.value = THREE.MathUtils.lerp(5.85, 4.55, storm);
  if (u.pwDensityBias) u.pwDensityBias.value = THREE.MathUtils.lerp(-0.050, -0.026, storm);

  // The 2D Nubis envelope is now only organizational guidance in clear weather.
  // The true 3D Perlin-Worley body is dominant, which removes the broad terraced
  // silhouettes that looked like one cloud stacked on another.
  if (u.nubisEnvelopeStrength) u.nubisEnvelopeStrength.value = THREE.MathUtils.lerp(0.62, 0.94, storm);
  if (u.nubisEdgeErosion) u.nubisEdgeErosion.value = THREE.MathUtils.lerp(0.30, 0.24, storm);
  if (u.nubisDensityScale) u.nubisDensityScale.value = THREE.MathUtils.lerp(0.96, 1.14, storm);
  if (u.nubisDomainWarp) u.nubisDomainWarp.value = THREE.MathUtils.lerp(0.064, 0.050, storm);

  // In this shader a larger value means less vertical compression. Keep clear
  // cumulus round instead of stretching every lobe into a tall layer-cake tower;
  // storms may become more vertically developed.
  if (u.nubisVerticalStretch) u.nubisVerticalStretch.value = THREE.MathUtils.lerp(0.78, 0.64, storm);

  // More directional contrast and less flat ambient fill. Bright cloud tops stay
  // white while interiors retain blue-gray depth rather than washing to white.
  if (u.nubisAmbientBoost) u.nubisAmbientBoost.value = THREE.MathUtils.lerp(0.52, 0.46, storm);
  if (u.nubisMultiScatter) u.nubisMultiScatter.value = THREE.MathUtils.lerp(0.25, 0.22, storm);
  if (u.nubisLightExtinction) u.nubisLightExtinction.value = THREE.MathUtils.lerp(0.58, 0.73, storm);
  if (u.referenceGuideStrength) u.referenceGuideStrength.value = 0;
  if (u.referencePaletteStrength) u.referencePaletteStrength.value = THREE.MathUtils.lerp(0.045, 0.15, storm);

  // A shallower fair-weather layer better matches ocean cumulus photography.
  // Convective variation inside the Nubis envelope still gives individual cells
  // tall tops, but the entire sky volume is no longer one enormous vertical slab.
  const baseTarget = THREE.MathUtils.lerp(46, 31, storm);
  const topTarget = THREE.MathUtils.lerp(164, 246, storm);
  if (u.cloudBaseY) u.cloudBaseY.value = baseTarget;
  if (u.cloudTopY) u.cloudTopY.value = topTarget;

  const baseY = Number(u.cloudBaseY?.value) || baseTarget;
  if (handle.mesh) handle.mesh.position.y = baseY;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;

  // The stock temporal cloud pass adds a tiny low-discrepancy weather-map offset
  // every frame. That was useful at eight samples, but with current-frame alpha it
  // can visibly move the silhouette. Low-pass that macro offset while leaving the
  // independently moving 3D base/detail/warp volumes untouched.
  const state = handle.__riftOceanReferenceV5State;
  if (state && u.weatherOffset?.value) {
    state.weatherOffset.lerp(u.weatherOffset.value, smoothFactor(dt, 7.0));
    u.weatherOffset.value.copy(state.weatherOffset);
  }

  // Subtle independent shape evolution. These are presentation offsets layered
  // over Nubis' physical advection, not cumulative state, so they cannot drift to
  // infinity or destabilize temporal reprojection.
  const age = Number(handle.__riftNubisClock) || 0;
  if (u.nubisBaseOffset?.value) {
    u.nubisBaseOffset.value.x += Math.sin(age * 0.031) * 0.0035;
    u.nubisBaseOffset.value.z += Math.cos(age * 0.027) * 0.0035;
  }
  if (u.nubisDetailOffset?.value) {
    u.nubisDetailOffset.value.x += Math.sin(age * 0.091 + 1.2) * 0.0065;
    u.nubisDetailOffset.value.z += Math.cos(age * 0.083 + 0.4) * 0.0065;
  }
  if (u.nubisWarpOffset?.value) {
    u.nubisWarpOffset.value.x += Math.sin(age * 0.019 + 2.1) * 0.0028;
    u.nubisWarpOffset.value.z += Math.cos(age * 0.021 + 0.8) * 0.0028;
  }

  // Huge shear values made upper lobes look like separate horizontal shelves.
  // Keep enough shear for natural wind-sculpted tops but preserve one coherent
  // cumulus body underneath.
  if (u.nubisShear?.value) u.nubisShear.value.multiplyScalar(0.58 + storm * 0.20);

  if (handle.__riftCirrus?.material) {
    handle.__riftCirrus.material.opacity = THREE.MathUtils.lerp(0.010, 0.004, storm);
  }

  // Keep TRAA permissive enough to accumulate internal cloud radiance while
  // rejecting fast camera-motion history. Current-frame alpha remains the source
  // of truth, so the real sky stays transparent and ghost-free.
  if (temporal?.temporalNode) {
    temporal.temporalNode.depthThreshold = 0.0018;
    temporal.temporalNode.edgeDepthDiff = 0.0034;
    temporal.temporalNode.maxVelocityLength = 64;
    temporal.temporalNode.useSubpixelCorrection = true;
  }

  if (atmosphere) {
    if (u.sunColor?.value?.isColor) u.sunColor.value.copy(atmosphere.sunColor);
    if (u.ambientColor?.value?.isColor) u.ambientColor.value.copy(atmosphere.ambientColor);
  }

  globalThis.__riftReferenceCumulusDebug = {
    version: 5,
    coverage: Number(u.coverage?.value) || 0,
    density: Number(u.density?.value) || 0,
    baseScale: Number(u.pwBaseScale?.value) || 0,
    detailScale: Number(u.pwDetailScale?.value) || 0,
    verticalStretch: Number(u.nubisVerticalStretch?.value) || 0,
    domainWarp: Number(u.nubisDomainWarp?.value) || 0,
    viewSteps: Number(handle.__riftNubisV2Quality?.viewSteps) || 0,
    lightSteps: Number(handle.__riftNubisV2Quality?.lightSteps) || 0,
    storm,
  };
}

export function createVolumetricClouds(scene) {
  const handle = createReferenceOceanV4(scene);
  if (!handle) return handle;
  installQualityUpgrade(handle);
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
  updateReferenceOceanV4(
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
  tunePhotographicCumulus(handle, dt, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  if (handle) handle.__riftOceanReferenceV5State = null;
  delete globalThis.__riftReferenceCumulusDebug;
  return disposeReferenceOceanV4(handle);
}
