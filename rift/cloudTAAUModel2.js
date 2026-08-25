import * as THREE from "three";
import {
  clamp,
  float,
  luminance,
  screenUV,
  smoothstep,
} from "three/tsl";
import { taau } from "three/addons/tsl/display/TAAUNode.js";

// Three r185-native temporal upscaling for Rift Cloud Model 2.
// Startup is deliberately staged: the first two cloud frames compile/render the
// ordinary reduced-resolution pass before TAAU allocates history and compiles its
// reconstruction graph. This avoids piling every expensive WebGPU compilation
// into the same Safari frame. If TAAU creation fails synchronously, Rift keeps a
// conservative reduced-resolution cloud pass instead of failing the whole game.

function useSafeReducedPass(handle, scale = 0.36) {
  const temporal = handle?.__riftTemporalCloudState;
  temporal?.cloudPass?.setResolutionScale?.(scale);
  if (temporal) temporal.resolutionScale = scale;
}

export function installRiftCloudTAAU(handle, camera, resolutionScale = 0.33) {
  if (!handle || !camera || handle.__riftModel2TAAUState) {
    return handle?.__riftModel2TAAUState || null;
  }

  if (handle.__riftModel2TAAUDisabled) {
    useSafeReducedPass(handle);
    return null;
  }

  handle.__riftModel2TAAUWarmupFrames = (handle.__riftModel2TAAUWarmupFrames || 0) + 1;
  if (handle.__riftModel2TAAUWarmupFrames < 3) {
    useSafeReducedPass(handle, Math.max(0.34, resolutionScale));
    return null;
  }

  const temporal = handle.__riftTemporalCloudState;
  if (!temporal?.cloudPass || !temporal?.displayMaterial) return null;

  try {
    const cloudPass = temporal.cloudPass;
    cloudPass.setResolutionScale(resolutionScale);
    temporal.resolutionScale = resolutionScale;

    const color = cloudPass.getTextureNode("output");
    const depth = cloudPass.getTextureNode("depth");
    const velocity = cloudPass.getTextureNode("velocity");
    if (!color || !depth || !velocity) return null;

    temporal.temporalNode?.dispose?.();
    temporal.temporalNode = null;

    const cloudCamera = camera.clone();
    cloudCamera.name = "rift-cloud-model2-taau-camera";
    cloudCamera.copy(camera, false);
    cloudCamera.updateMatrixWorld(true);
    cloudPass.camera = cloudCamera;

    const taauNode = taau(color, depth, velocity, cloudCamera);
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
      cloudCamera,
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
      isolatedCamera: true,
      warmupFrames: handle.__riftModel2TAAUWarmupFrames,
      fallback: false,
    };

    console.info(
      `[clouds] Rift Model 2 TAAU active (${Math.round(resolutionScale * 100)}% input -> full resolution)`,
    );

    return handle.__riftModel2TAAUState;
  } catch (error) {
    handle.__riftModel2TAAUDisabled = true;
    useSafeReducedPass(handle, 0.36);
    globalThis.__riftModel2TAAUDebug = {
      active: false,
      threeRevision: THREE.REVISION,
      fallback: true,
      message: error?.message || String(error),
      warmupFrames: handle.__riftModel2TAAUWarmupFrames,
    };
    console.warn("[clouds] TAAU startup failed; using safe reduced cloud pass", error);
    return null;
  }
}

export function syncRiftCloudTAAU(handle, camera, resolutionScale) {
  const state = handle?.__riftModel2TAAUState;
  const temporal = handle?.__riftTemporalCloudState;
  if (!state || !temporal?.cloudPass || !camera) return;

  state.cloudCamera.copy(camera, false);
  state.cloudCamera.clearViewOffset?.();
  state.cloudCamera.updateMatrixWorld(true);
  state.node.camera = state.cloudCamera;
  temporal.cloudPass.camera = state.cloudCamera;

  if (Number.isFinite(resolutionScale) && Math.abs(resolutionScale - state.resolutionScale) > 1e-4) {
    state.resolutionScale = resolutionScale;
    temporal.cloudPass.setResolutionScale(resolutionScale);
    temporal.resolutionScale = resolutionScale;
  }
}

export function disposeRiftCloudTAAU(handle) {
  const state = handle?.__riftModel2TAAUState;
  state?.node?.dispose?.();
  if (handle) {
    handle.__riftModel2TAAUState = null;
    handle.__riftModel2TAAUWarmupFrames = 0;
    handle.__riftModel2TAAUDisabled = false;
  }
  delete globalThis.__riftModel2TAAUDebug;
}
