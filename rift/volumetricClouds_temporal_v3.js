import {
  screenUV,
  smoothstep,
  float,
  luminance,
} from "three/tsl";
import {
  createVolumetricClouds as createTemporalCloudsV2,
  updateVolumetricClouds as updateTemporalCloudsV2,
  disposeVolumetricClouds as disposeTemporalCloudsV2,
} from "./volumetricClouds_temporal_v2.js";

// -----------------------------------------------------------------------------
// Temporal cloud v3 — preserve the real sky.
//
// v2 fixed the perspective-warp bug by sampling the TRAA history with screenUV,
// but stock r182 TRAA is intended primarily for opaque scene color. Its resolved
// alpha can become effectively opaque even when the cloud pass background is
// transparent. That makes transparent-black history cover the real sky, which
// is exactly the black upper hemisphere seen on iPhone.
//
// Keep TRAA for RGB detail/history, but use the CURRENT cloud pass for opacity.
// This is also desirable for moving density: the cloud silhouette responds this
// frame while only the expensive internal radiance is temporally accumulated.
// A tiny radiance gate is an extra safety net so a cleared black pixel can never
// become an opaque black sky even if a backend reports an unexpected alpha.
// -----------------------------------------------------------------------------

function repairTemporalAlpha(handle) {
  const state = handle?.__riftTemporalCloudState;
  if (!state || state.__riftCurrentFrameAlphaFixed) return;

  const material = state.displayMaterial;
  const historyTexture = state.temporalNode?.getTextureNode?.();
  const currentTexture = state.cloudPass?.getTextureNode?.("output");
  if (!material || !historyTexture || !currentTexture) return;

  const history = historyTexture.sample(screenUV);
  const current = currentTexture.sample(screenUV);

  // Do not trust TRAA's accumulated alpha for a transparent volumetric layer.
  // The raw pass alpha is the authoritative cloud coverage for this frame.
  // luminance() prevents transparent-black/cleared pixels from covering the sky
  // even if a WebGPU backend unexpectedly returns alpha=1 for the clear color.
  const hasCloudRadiance = smoothstep(
    float(0.0008),
    float(0.012),
    luminance(current.rgb),
  );

  material.colorNode = history.rgb;
  material.opacityNode = current.a.mul(hasCloudRadiance);
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.forceSinglePass = true;
  material.toneMapped = false;
  material.needsUpdate = true;

  state.__riftCurrentFrameAlphaFixed = true;

  globalThis.__riftTemporalCloudDebug = {
    ...(globalThis.__riftTemporalCloudDebug || {}),
    compositor: "temporal-rgb-current-alpha",
    skyTransparencyGuard: true,
    currentFrameSilhouette: true,
  };

  console.info("[clouds] temporal v3: TRAA RGB + current-frame cloud alpha; real sky preserved");
}

export function createVolumetricClouds(scene) {
  return createTemporalCloudsV2(scene);
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
  updateTemporalCloudsV2(
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

  repairTemporalAlpha(handle);
}

export function disposeVolumetricClouds(handle) {
  return disposeTemporalCloudsV2(handle);
}
