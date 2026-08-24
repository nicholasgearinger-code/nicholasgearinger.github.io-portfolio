import * as THREE from "three";
import {
  screenUV,
  smoothstep,
  float,
  luminance,
} from "three/tsl";
import {
  createVolumetricClouds as createReferenceClouds,
  updateVolumetricClouds as updateReferenceClouds,
  disposeVolumetricClouds as disposeReferenceClouds,
} from "./volumetricClouds_reference_ocean_v5.js";
import { createProgressiveEnvelopePair } from "./cloudEnvelopeProgressive.js";

// -----------------------------------------------------------------------------
// Progressive cloud v1 — Rift's low-resolution volumetric-cloud renderer.
//
// r185 migration note:
// The expensive raymarch stays at quarter-screen resolution on Mobile Low. The
// saved pixel budget is spent on more samples inside the volume, then the result
// is reconstructed with linear filtering. The r185 cumulus wrapper replaces the
// macro envelope after create(), so this file now concentrates on performance,
// stable sampling and the low-resolution presentation pass.
// -----------------------------------------------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function qualityFor(handle) {
  const inherited = Number(handle?.quality?.raySteps) || 8;
  if (inherited <= 8) {
    return { resolutionScale: 0.25, viewSteps: 32, lightSteps: 3, envelopeSize: 128, label: "mobile-low" };
  }
  if (inherited <= 12) {
    return { resolutionScale: 0.40, viewSteps: 40, lightSteps: 4, envelopeSize: 160, label: "medium" };
  }
  return { resolutionScale: 0.50, viewSteps: 48, lightSteps: 4, envelopeSize: 192, label: "high" };
}

function installProgressiveEnvelope(handle, config) {
  if (!handle || handle.__riftProgressiveEnvelopeInstalled) return;

  // Nubis creates its default pair during create(). Replace it before the first
  // update compiles the TSL cloud shader. The r185 wrapper may replace this pair
  // one final time with its continuous-height cumulus envelope.
  handle.__riftNubisEnvelopes?.a?.dispose?.();
  handle.__riftNubisEnvelopes?.b?.dispose?.();
  handle.__riftNubisEnvelopes = createProgressiveEnvelopePair(config.envelopeSize);

  const q = handle.__riftNubisV2Quality;
  if (q) {
    q.viewSteps = config.viewSteps;
    q.lightSteps = config.lightSteps;
    q.envelopeSize = config.envelopeSize;
  }

  handle.__riftSkyProReconstruction = true;
  handle.__riftProgressiveEnvelopeInstalled = true;
}

function installLowResolutionCloudPass(handle, config) {
  const state = handle?.__riftTemporalCloudState;
  if (!state || state.__riftProgressiveLowResInstalled) return;

  // Three's stock TRAA depth history still expects full drawing-buffer depth in
  // r185. For the mobile cloud layer we therefore keep the cloud pass private at
  // reduced resolution and display the current low-res result directly. A later
  // dedicated cloud-history node can add scale-aware reprojection without tying
  // it to the main scene depth buffer.
  state.cloudPass?.setResolutionScale?.(config.resolutionScale);

  const cloudTextureNode = state.cloudPass?.getTextureNode?.("output");
  const displayMaterial = state.displayMaterial;
  if (!cloudTextureNode || !displayMaterial) return;

  const current = cloudTextureNode.sample(screenUV);
  const hasRadiance = smoothstep(
    float(0.0005),
    float(0.008),
    luminance(current.rgb),
  );

  displayMaterial.colorNode = current.rgb;
  displayMaterial.opacityNode = current.a.mul(hasRadiance);
  displayMaterial.transparent = true;
  displayMaterial.blending = THREE.NormalBlending;
  displayMaterial.premultipliedAlpha = false;
  displayMaterial.depthWrite = false;
  displayMaterial.depthTest = true;
  displayMaterial.forceSinglePass = true;
  displayMaterial.toneMapped = false;
  displayMaterial.needsUpdate = true;

  const rtTexture = state.cloudPass?.getTexture?.("output");
  if (rtTexture) {
    rtTexture.minFilter = THREE.LinearFilter;
    rtTexture.magFilter = THREE.LinearFilter;
    rtTexture.generateMipmaps = false;
    rtTexture.needsUpdate = true;
  }

  state.resolutionScale = config.resolutionScale;
  state.__riftProgressiveLowResInstalled = true;

  globalThis.__riftProgressiveCloudDebug = {
    enabled: true,
    threeRevision: THREE.REVISION,
    quality: config.label,
    reconstruction: `${Math.round(config.resolutionScale * 100)}%-screen bilinear`,
    viewSteps: config.viewSteps,
    lightSteps: config.lightSteps,
    legacyTRAABypassed: true,
  };

  console.info(
    `[clouds] r${THREE.REVISION} progressive low-res path active (${Math.round(config.resolutionScale * 100)}% screen, ${config.viewSteps} view / ${config.lightSteps} light samples)`,
  );
}

function tuneProgressiveCumulus(handle, rainIntensity) {
  const u = handle?.uniforms;
  if (!u) return;

  const weather = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(weather?.stormIntensity ?? rainIntensity);
  const requestedCoverage = clamp01(weather?.cloudCoverage ?? 0.44);

  // Baseline only. The r185 presentation wrapper performs the final fair-weather
  // tuning after this update, so keep this conservative and stable.
  if (u.coverage) {
    const fair = THREE.MathUtils.clamp(requestedCoverage, 0.34, 0.48);
    u.coverage.value = THREE.MathUtils.lerp(fair, 0.84, storm);
  }
  if (u.density) u.density.value = THREE.MathUtils.lerp(0.55, 0.82, storm);
  if (u.humidity) u.humidity.value = THREE.MathUtils.lerp(0.70, 0.94, storm);
  if (u.convection) u.convection.value = THREE.MathUtils.lerp(0.88, 0.99, storm);
  if (u.erosion) u.erosion.value = THREE.MathUtils.lerp(0.38, 0.30, storm);

  if (u.pwBaseScale) u.pwBaseScale.value = THREE.MathUtils.lerp(0.30, 0.36, storm);
  if (u.pwDetailScale) u.pwDetailScale.value = THREE.MathUtils.lerp(5.25, 4.60, storm);
  if (u.pwDensityBias) u.pwDensityBias.value = THREE.MathUtils.lerp(-0.045, -0.022, storm);

  if (u.nubisEnvelopeStrength) u.nubisEnvelopeStrength.value = THREE.MathUtils.lerp(0.74, 0.92, storm);
  if (u.nubisEdgeErosion) u.nubisEdgeErosion.value = THREE.MathUtils.lerp(0.31, 0.26, storm);
  if (u.nubisDensityScale) u.nubisDensityScale.value = THREE.MathUtils.lerp(1.02, 1.16, storm);
  if (u.nubisDomainWarp) u.nubisDomainWarp.value = THREE.MathUtils.lerp(0.055, 0.047, storm);
  if (u.nubisVerticalStretch) u.nubisVerticalStretch.value = THREE.MathUtils.lerp(0.82, 0.70, storm);

  if (u.nubisAmbientBoost) u.nubisAmbientBoost.value = THREE.MathUtils.lerp(0.58, 0.47, storm);
  if (u.nubisMultiScatter) u.nubisMultiScatter.value = THREE.MathUtils.lerp(0.28, 0.22, storm);
  if (u.nubisLightExtinction) u.nubisLightExtinction.value = THREE.MathUtils.lerp(0.56, 0.74, storm);
  if (u.referenceGuideStrength) u.referenceGuideStrength.value = 0;
  if (u.referencePaletteStrength) u.referencePaletteStrength.value = THREE.MathUtils.lerp(0.025, 0.12, storm);

  const baseTarget = THREE.MathUtils.lerp(48, 31, storm);
  const topTarget = THREE.MathUtils.lerp(176, 250, storm);
  if (u.cloudBaseY) u.cloudBaseY.value = baseTarget;
  if (u.cloudTopY) u.cloudTopY.value = topTarget;

  const baseY = Number(u.cloudBaseY?.value) || baseTarget;
  if (handle.mesh) handle.mesh.position.y = baseY;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;

  // Rebuild presentation offsets from Nubis' authoritative integrated state so
  // cloud evolution stays bounded and stable over long sessions.
  const age = Number(handle.__riftNubisClock) || 0;
  if (u.nubisBaseOffset?.value) {
    u.nubisBaseOffset.value.set(
      (Number(handle.__riftNubisBaseX) || 0) + Math.sin(age * 0.028) * 0.010,
      Number(handle.__riftNubisBaseY) || 0,
      (Number(handle.__riftNubisBaseZ) || 0) + Math.cos(age * 0.024) * 0.010,
    );
  }
  if (u.nubisDetailOffset?.value) {
    u.nubisDetailOffset.value.set(
      (Number(handle.__riftNubisDetailX) || 0) + Math.sin(age * 0.082 + 1.2) * 0.018,
      Number(handle.__riftNubisDetailY) || 0,
      (Number(handle.__riftNubisDetailZ) || 0) + Math.cos(age * 0.074 + 0.4) * 0.018,
    );
  }
  if (u.nubisWarpOffset?.value) {
    u.nubisWarpOffset.value.set(
      (Number(handle.__riftNubisWarpX) || 0) + Math.sin(age * 0.018 + 2.1) * 0.008,
      Number(handle.__riftNubisWarpY) || 0,
      (Number(handle.__riftNubisWarpZ) || 0) + Math.cos(age * 0.020 + 0.8) * 0.008,
    );
  }

  if (u.nubisShear?.value) {
    u.nubisShear.value.multiplyScalar(0.42 + storm * 0.18);
  }

  if (handle.__riftCirrus?.material) {
    handle.__riftCirrus.material.opacity = THREE.MathUtils.lerp(0.016, 0.006, storm);
  }

  globalThis.__riftProgressiveCloudDebug = {
    ...(globalThis.__riftProgressiveCloudDebug || {}),
    coverage: Number(u.coverage?.value) || 0,
    density: Number(u.density?.value) || 0,
    baseScale: Number(u.pwBaseScale?.value) || 0,
    domainWarp: Number(u.nubisDomainWarp?.value) || 0,
    cloudBase: Number(u.cloudBaseY?.value) || 0,
    cloudTop: Number(u.cloudTopY?.value) || 0,
    storm,
  };
}

export function createVolumetricClouds(scene) {
  const handle = createReferenceClouds(scene);
  if (!handle) return handle;

  const config = qualityFor(handle);
  handle.__riftProgressiveQuality = config;
  installProgressiveEnvelope(handle, config);
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

  if (!handle) return;
  const config = handle.__riftProgressiveQuality || qualityFor(handle);
  installLowResolutionCloudPass(handle, config);
  tuneProgressiveCumulus(handle, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  if (handle) {
    handle.__riftProgressiveQuality = null;
    handle.__riftProgressiveEnvelopeInstalled = false;
  }
  delete globalThis.__riftProgressiveCloudDebug;
  return disposeReferenceClouds(handle);
}
