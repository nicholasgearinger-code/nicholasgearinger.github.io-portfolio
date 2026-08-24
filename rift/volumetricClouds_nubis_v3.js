import * as THREE from "three";
import {
  createVolumetricClouds as createNubisV2,
  updateVolumetricClouds as updateNubisV2,
  disposeVolumetricClouds as disposeNubisV2,
} from "./volumetricClouds_nubis_v2.js";

// -----------------------------------------------------------------------------
// Nubis v3 stability pass.
//
// Nubis v2 intentionally changed the ray-start jitter every rendered frame so
// temporal accumulation would receive new sub-samples. On the mobile path the
// final cloud alpha is intentionally taken from the current frame (rather than
// accumulated history) to keep the sky transparent. At ~14-20 fps that means a
// large fraction of a ray step moves every frame and the cloud silhouette appears
// to vibrate/shimmer.
//
// v3 keeps the useful *spatial* jitter already present in the shader, but freezes
// the extra frame-wide jitter. The cloud field still moves and changes shape via
// independent envelope/base/detail/warp advection; only the sampling lattice is
// stabilized. A light low-pass is also applied to the two macro-envelope offsets
// and morph blend so evolving cloud cells remain continuous on low frame rates.
// -----------------------------------------------------------------------------

function clampDt(dt) {
  return Math.min(Math.max(Number(dt) || 0, 0), 0.1);
}

function smoothFactor(dt, rate) {
  return 1 - Math.exp(-clampDt(dt) * rate);
}

function ensureStableState(handle) {
  if (!handle?.uniforms || handle.__riftNubisV3Stable) return;
  const u = handle.uniforms;
  handle.__riftNubisV3Stable = {
    envA: u.nubisEnvelopeOffsetA?.value?.clone?.() ?? new THREE.Vector2(),
    envB: u.nubisEnvelopeOffsetB?.value?.clone?.() ?? new THREE.Vector2(),
    base: u.nubisBaseOffset?.value?.clone?.() ?? new THREE.Vector3(),
    detail: u.nubisDetailOffset?.value?.clone?.() ?? new THREE.Vector3(),
    warp: u.nubisWarpOffset?.value?.clone?.() ?? new THREE.Vector3(),
    shear: u.nubisShear?.value?.clone?.() ?? new THREE.Vector2(),
    morph: Number(u.nubisMorphBlend?.value) || 0,
  };
}

function stabilizeCloudSampling(handle, dt) {
  const u = handle?.uniforms;
  if (!u) return;
  ensureStableState(handle);
  const s = handle.__riftNubisV3Stable;
  if (!s) return;

  // Critical anti-vibration fix: keep the global temporal offset fixed. The
  // shader still has per-pixel weather-map jitter, so ray steps are de-correlated
  // spatially without making the entire silhouette jump every rendered frame.
  if (u.nubisFrameJitter) u.nubisFrameJitter.value = 0.5;

  // Smooth only the presentation uniforms. Their underlying physical state in
  // Nubis v2 keeps advancing normally, so no weather/cloud evolution is lost.
  const macroK = smoothFactor(dt, 5.0);
  const volumeK = smoothFactor(dt, 7.0);
  const detailK = smoothFactor(dt, 9.0);
  const shearK = smoothFactor(dt, 2.8);
  const morphK = smoothFactor(dt, 2.0);

  if (u.nubisEnvelopeOffsetA?.value) {
    s.envA.lerp(u.nubisEnvelopeOffsetA.value, macroK);
    u.nubisEnvelopeOffsetA.value.copy(s.envA);
  }
  if (u.nubisEnvelopeOffsetB?.value) {
    s.envB.lerp(u.nubisEnvelopeOffsetB.value, macroK);
    u.nubisEnvelopeOffsetB.value.copy(s.envB);
  }
  if (u.nubisBaseOffset?.value) {
    s.base.lerp(u.nubisBaseOffset.value, volumeK);
    u.nubisBaseOffset.value.copy(s.base);
  }
  if (u.nubisDetailOffset?.value) {
    s.detail.lerp(u.nubisDetailOffset.value, detailK);
    u.nubisDetailOffset.value.copy(s.detail);
  }
  if (u.nubisWarpOffset?.value) {
    s.warp.lerp(u.nubisWarpOffset.value, volumeK);
    u.nubisWarpOffset.value.copy(s.warp);
  }
  if (u.nubisShear?.value) {
    s.shear.lerp(u.nubisShear.value, shearK);
    u.nubisShear.value.copy(s.shear);
  }
  if (u.nubisMorphBlend) {
    const target = Number(u.nubisMorphBlend.value) || 0;
    s.morph = THREE.MathUtils.lerp(s.morph, target, morphK);
    u.nubisMorphBlend.value = s.morph;
  }

  // Slightly reduce the two highest-frequency presentation terms on Low/mobile.
  // This does not remove edge detail; it prevents sub-pixel erosion/warp changes
  // from aliasing into a visible shimmer at 14-20 fps.
  const low = (Number(handle?.__riftNubisV2Quality?.viewSteps) || 14) <= 14;
  if (low) {
    if (u.nubisDomainWarp) u.nubisDomainWarp.value = Math.min(Number(u.nubisDomainWarp.value) || 0.055, 0.045);
    if (u.nubisEdgeErosion) u.nubisEdgeErosion.value = Math.min(Number(u.nubisEdgeErosion.value) || 0.32, 0.285);
  }

  globalThis.__riftNubisV3Debug = {
    stableJitter: Number(u.nubisFrameJitter?.value) || 0.5,
    morph: Number(u.nubisMorphBlend?.value) || 0,
    low,
    antiVibration: true,
  };
}

export function createVolumetricClouds(scene) {
  return createNubisV2(scene);
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
  updateNubisV2(
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

  stabilizeCloudSampling(handle, dt);
}

export function disposeVolumetricClouds(handle) {
  if (handle) handle.__riftNubisV3Stable = null;
  delete globalThis.__riftNubisV3Debug;
  return disposeNubisV2(handle);
}
