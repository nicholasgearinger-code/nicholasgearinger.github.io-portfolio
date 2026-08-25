import * as THREE from "three";
import {
  clamp,
  float,
  luminance,
  screenUV,
  smoothstep,
} from "three/tsl";
import { taau } from "three/addons/tsl/display/TAAUNode.js";

// Three r185-native temporal upscaling for Rift Cloud Model 2.0.
//
// Unlike the experimental custom 4x4 history, TAAU owns history seeding,
// camera jitter, motion-vector reprojection and output-resolution reconstruction.
// Rift keeps current-frame alpha in the blend as a transparency safety net so a
// stale/opaque temporal alpha can never cover the physical sky.

export function installRiftCloudTAAU(handle, camera, resolutionScale = 0.33) {
  if (!handle || !camera || handle.__riftModel2TAAUState) return handle?.__riftModel2TAAUState || null;

  const temporal = handle.__riftTemporalCloudState;
  if (!temporal?.cloudPass || !temporal?.displayMaterial) return null;

  const cloudPass = temporal.cloudPass;
  cloudPass.setResolutionScale(resolutionScale);
  temporal.resolutionScale = resolutionScale;

  const color = cloudPass.getTextureNode("output");
  const depth = cloudPass.getTextureNode("depth");
  const velocity = cloudPass.getTextureNode("velocity");
  if (!color || !depth || !velocity) return null;

  // Dispose the old TRAA node if it is still hanging off the preserved cloud
  // infrastructure. The progressive wrapper bypassed it visually, so Model 2 can
  // cleanly replace it with r185's upscaling-aware temporal node.
  temporal.temporalNode?.dispose?.();
  temporal.temporalNode = null;

  const taauNode = taau(color, depth, velocity, camera);
  taauNode.depthThreshold = 0.0014;
  taauNode.edgeDepthDiff = 0.0028;
  taauNode.maxVelocityLength = 68;
  taauNode.currentFrameWeight = 0.055;

  const resolved = taauNode.getTextureNode().sample(screenUV);
  const current = color.sample(screenUV);
  const radianceGate = smoothstep(
    float(0.00035),
    float(0.0065),
    luminance(resolved.rgb.add(current.rgb.mul(0.22))),
  );

  // TAAU's history alpha is useful for antialiasing the silhouette, but the
  // current frame retains 35% authority so a cleared/history pixel cannot turn
  // into an opaque sky blocker.
  const safeAlpha = clamp(
    resolved.a.mul(0.65).add(current.a.mul(0.35)),
    float(0),
    float(1),
  ).mul(radianceGate);

  const material = temporal.displayMaterial;
  material.colorNode = resolved.rgb;
  material.opacityNode = safeAlpha;
  material.transparent = true;
  material.blending = THREE.NormalBlending;
  material.premultipliedAlpha = false;
  material.depthWrite = false;
  material.depthTest = true;
  material.forceSinglePass = true;
  material.toneMapped = false;
  material.needsUpdate = true;

  handle.__riftModel2TAAUState = {
    node: taauNode,
    resolutionScale,
  };

  globalThis.__riftModel2TAAUDebug = {
    active: true,
    threeRevision: THREE.REVISION,
    inputResolutionScale: resolutionScale,
    currentFrameWeight: taauNode.currentFrameWeight,
    depthThreshold: taauNode.depthThreshold,
    edgeDepthDiff: taauNode.edgeDepthDiff,
    maxVelocityLength: taauNode.maxVelocityLength,
    implementation: "Three r185 TAAU",
  };

  console.info(
    `[clouds] Rift Model 2 TAAU active (${Math.round(resolutionScale * 100)}% input -> full resolution)`,
  );

  return handle.__riftModel2TAAUState;
}

export function syncRiftCloudTAAU(handle, camera, resolutionScale) {
  const state = handle?.__riftModel2TAAUState;
  const temporal = handle?.__riftTemporalCloudState;
  if (!state || !temporal?.cloudPass || !camera) return;

  state.node.camera = camera;
  temporal.cloudPass.camera = camera;
  if (Number.isFinite(resolutionScale) && Math.abs(resolutionScale - state.resolutionScale) > 1e-4) {
    state.resolutionScale = resolutionScale;
    temporal.cloudPass.setResolutionScale(resolutionScale);
    temporal.resolutionScale = resolutionScale;
  }
}

export function disposeRiftCloudTAAU(handle) {
  const state = handle?.__riftModel2TAAUState;
  if (!state) return;
  state.node?.dispose?.();
  handle.__riftModel2TAAUState = null;
  delete globalThis.__riftModel2TAAUDebug;
}
