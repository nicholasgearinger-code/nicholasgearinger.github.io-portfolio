import {
  screenUV,
} from "three/tsl";
import {
  createVolumetricClouds as createTemporalClouds,
  updateVolumetricClouds as updateTemporalClouds,
  disposeVolumetricClouds as disposeTemporalClouds,
} from "./volumetricClouds_temporal.js";

// -----------------------------------------------------------------------------
// Temporal-cloud compositor repair for Three r182.
//
// The first cloud-only TRAA pass proved the expensive cloud render can be kept
// separate from the rest of Rift, but the resolved history was then assigned
// directly to a perspective MeshBasicNodeMaterial. TRAA outputs a SCREEN-SPACE
// texture; evaluating that node as the color of a world-space plane perspective-
// warps the image, which produced the radial black/white streaks seen on iPhone.
// In addition, colorNode does not automatically turn the texture's alpha into
// material opacity, so transparent black from the cloud pass could cover the sky.
//
// This wrapper fixes both issues without disturbing the cloud simulation:
//   * sample the resolved TRAA texture explicitly with screenUV;
//   * route RGB to colorNode and A to opacityNode;
//   * keep the world cloud plane only as a depth/spatial mask;
//   * run the TRAA source at full drawing-buffer resolution for now because
//     r182 TRAANode only updates previous-depth history when input size exactly
//     matches renderer.getDrawingBufferSize(). A later custom cloud-history node
//     can remove that limitation and restore sub-resolution accumulation safely.
// -----------------------------------------------------------------------------

function repairTemporalResolve(handle) {
  const state = handle?.__riftTemporalCloudState;
  if (!state || state.__riftScreenSpaceResolveFixed) return;

  // Three r182's stock TRAA updateBefore() guards the previous-depth copy with
  // an exact drawing-buffer-size comparison. Running the beauty pass at 72%
  // therefore left the temporal depth history stale/invalid. Correctness first:
  // use 1:1 history until we replace the stock resolver with a scale-aware one.
  state.cloudPass?.setResolutionScale?.(1);
  state.resolutionScale = 1;

  const historyTexture = state.temporalNode?.getTextureNode?.();
  const material = state.displayMaterial;
  if (!historyTexture || !material) return;

  const resolved = historyTexture.sample(screenUV);
  material.colorNode = resolved.rgb;
  material.opacityNode = resolved.a;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.forceSinglePass = true;
  material.toneMapped = false;
  material.needsUpdate = true;

  // Clouds change internally even when their launch plane has little geometric
  // motion, so reject history somewhat faster than the first experiment did.
  // This reduces long radial/ghost trails during camera turns while retaining
  // enough history for sparse ray samples to converge when the view is steady.
  if (state.temporalNode) {
    state.temporalNode.depthThreshold = 0.0012;
    state.temporalNode.edgeDepthDiff = 0.0025;
    state.temporalNode.maxVelocityLength = 52;
    state.temporalNode.useSubpixelCorrection = true;
  }

  state.__riftScreenSpaceResolveFixed = true;

  globalThis.__riftTemporalCloudDebug = {
    ...(globalThis.__riftTemporalCloudDebug || {}),
    enabled: true,
    compositor: "screenUV-rgba",
    resolutionScale: 1,
    depthHistory: "valid-full-resolution",
    perspectiveWarpFixed: true,
  };

  console.info("[clouds] temporal v2: screen-space RGBA resolve + valid full-resolution depth history");
}

export function createVolumetricClouds(scene) {
  return createTemporalClouds(scene);
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
  updateTemporalClouds(
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

  repairTemporalResolve(handle);
}

export function disposeVolumetricClouds(handle) {
  return disposeTemporalClouds(handle);
}
