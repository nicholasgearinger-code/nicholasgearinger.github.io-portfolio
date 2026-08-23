import * as THREE from "three";
import {
  mrt,
  output,
  pass,
  velocity,
  vec4,
} from "three/tsl";
import { traa } from "three/addons/tsl/display/TRAANode.js";
import {
  createVolumetricClouds as createBaseClouds,
  updateVolumetricClouds as updateBaseClouds,
  disposeVolumetricClouds as disposeBaseClouds,
} from "./volumetricClouds.js";
import { LIQUID_LEVEL } from "./terrain.js";

// -----------------------------------------------------------------------------
// Cloud-only temporal reprojection.
//
// The normal Rift renderer is created with MSAA enabled. Three r182 TRAA cannot
// safely consume an MSAA depth history, so this module deliberately does NOT run
// TRAA over the whole game. Instead it moves only the expensive raymarched cloud
// plane into its own single-sample PassNode, accumulates that pass temporally,
// then composites the resolved texture back into the normal scene on a cheap
// display plane. Terrain, water, UI and the rest of the world keep their current
// antialiasing/render path.
//
// This is also the right performance shape for mobile volumetrics: the expensive
// cloud march runs below native resolution while history reconstructs a smoother
// result over several frames. Cirrus remains in the main scene because it is one
// inexpensive textured draw and does not need temporal reconstruction.
// -----------------------------------------------------------------------------

const TEMPORAL_PHASES = [
  [0.50, 0.333333],
  [0.25, 0.666667],
  [0.75, 0.111111],
  [0.125, 0.444444],
  [0.625, 0.777778],
  [0.375, 0.222222],
  [0.875, 0.555556],
  [0.0625, 0.888889],
];

function resolutionScaleFor(handle) {
  const steps = Number(handle?.quality?.raySteps) || 8;
  if (steps <= 8) return 0.72;
  if (steps <= 12) return 0.80;
  return 0.90;
}

function isUnderwater(camera, biome) {
  const waterY = LIQUID_LEVEL?.[biome];
  return Number.isFinite(waterY) && camera.position.y < waterY - 0.15;
}

function createDisplayMaterial(temporalNode) {
  const material = new THREE.MeshBasicNodeMaterial();
  material.name = "rift-temporal-cloud-display-material";

  // TRAANode is itself a vec4 output node. Using it directly preserves the
  // temporally-resolved alpha instead of re-sampling it with the display plane's
  // perspective UVs.
  material.colorNode = temporalNode;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;
  material.forceSinglePass = true;
  material.fog = false;
  material.toneMapped = false;
  material.blending = THREE.NormalBlending;
  return material;
}

function installTemporalClouds(handle, camera) {
  if (!handle || !camera || handle.__riftTemporalCloudState) return;

  const rawMesh = handle.mesh;
  const mainScene = handle.scene;
  if (!rawMesh || !mainScene) return;

  // The base cloud wrapper already gives us the correct raymarch launch plane,
  // weather state and material. Render that exact plane in a private scene.
  mainScene.remove(rawMesh);

  const cloudScene = new THREE.Scene();
  cloudScene.name = "rift-temporal-cloud-scene";
  // Explicit transparent black is important: only cloud radiance/alpha should
  // be accumulated. The real sky, Sun and stars remain in the main scene.
  cloudScene.backgroundNode = vec4(0, 0, 0, 0);
  cloudScene.add(rawMesh);

  // A representative cloud-layer depth is useful to TRAA even though the cloud
  // density itself is transparent. This private pass contains no other geometry,
  // so enabling depth writes here cannot occlude world objects.
  rawMesh.material.depthWrite = true;
  rawMesh.material.depthTest = true;
  rawMesh.material.transparent = true;
  rawMesh.material.needsUpdate = true;

  // IMPORTANT for three r182: samples: 1 keeps the cloud pass depth single-
  // sampled even though the main WebGPURenderer uses MSAA. This avoids the r182
  // TRAA MSAA-history mismatch while leaving the rest of Rift untouched.
  const cloudPass = pass(cloudScene, camera, {
    samples: 1,
    depthBuffer: true,
    stencilBuffer: false,
  });
  cloudPass.name = "rift-temporal-cloud-pass";
  cloudPass.transparent = true;
  cloudPass.opaque = false;
  cloudPass.setResolutionScale(resolutionScaleFor(handle));
  cloudPass.setMRT(mrt({
    output,
    velocity,
  }));

  const cloudColor = cloudPass.getTextureNode("output");
  const cloudDepth = cloudPass.getTextureNode("depth");
  const cloudVelocity = cloudPass.getTextureNode("velocity");

  const temporalNode = traa(cloudColor, cloudDepth, cloudVelocity, camera);
  // Clouds are a soft volume, so a slightly more permissive depth threshold is
  // preferable to hard history rejection on tiny cloud-base depth changes.
  temporalNode.depthThreshold = 0.0025;
  temporalNode.edgeDepthDiff = 0.0045;
  temporalNode.maxVelocityLength = 84;
  temporalNode.useSubpixelCorrection = true;

  const displayMaterial = createDisplayMaterial(temporalNode);
  const displayMesh = new THREE.Mesh(rawMesh.geometry, displayMaterial);
  displayMesh.name = "rift-temporal-cloud-display";
  displayMesh.renderOrder = rawMesh.renderOrder;
  displayMesh.frustumCulled = false;
  displayMesh.position.copy(rawMesh.position);
  displayMesh.rotation.copy(rawMesh.rotation);
  displayMesh.scale.copy(rawMesh.scale);
  mainScene.add(displayMesh);

  handle.__riftTemporalCloudState = {
    mainScene,
    cloudScene,
    rawMesh,
    cloudPass,
    temporalNode,
    displayMesh,
    displayMaterial,
    frameIndex: 0,
    wasUnderwater: false,
    resolutionScale: cloudPass.getResolutionScale(),
  };

  globalThis.__riftTemporalCloudDebug = {
    enabled: true,
    resolutionScale: cloudPass.getResolutionScale(),
    samples: 1,
    history: "TRAA",
  };

  console.info(
    `[clouds] temporal reprojection active (${Math.round(cloudPass.getResolutionScale() * 100)}% cloud pass, single-sample history)`,
  );
}

function syncTemporalClouds(handle, camera, biome) {
  const state = handle?.__riftTemporalCloudState;
  if (!state || !camera) return;

  const underwater = isUnderwater(camera, biome);
  state.rawMesh.visible = !underwater;
  state.displayMesh.visible = !underwater;

  // The large cloud launch plane is kept world-anchored instead of parented to
  // the camera. Motion vectors can therefore represent camera translation as
  // well as rotation, which is required for real reprojection instead of a
  // simple frame blend. Rift islands are centered well inside this ~1900-unit
  // plane, so it does not need to chase the player horizontally.
  state.rawMesh.position.x = 0;
  state.rawMesh.position.z = 0;
  state.displayMesh.position.x = 0;
  state.displayMesh.position.z = 0;

  state.displayMesh.position.y = state.rawMesh.position.y;
  state.displayMesh.rotation.copy(state.rawMesh.rotation);
  state.displayMesh.scale.copy(state.rawMesh.scale);

  // Vary the ray start every frame with a low-discrepancy sequence. The base
  // updater rewrites weatherOffset on every frame, so this tiny sub-texel dither
  // never accumulates into weather drift. Across history frames it fills gaps
  // between the sparse Low-tier raymarch samples instead of preserving the same
  // horizontal shelves forever.
  const phase = TEMPORAL_PHASES[state.frameIndex % TEMPORAL_PHASES.length];
  state.frameIndex = (state.frameIndex + 1) % TEMPORAL_PHASES.length;
  const weatherOffset = handle.uniforms?.weatherOffset?.value;
  if (weatherOffset) {
    weatherOffset.x += (phase[0] - 0.5) * 0.0018;
    weatherOffset.y += (phase[1] - 0.5) * 0.0018;
  }

  state.wasUnderwater = underwater;
  if (globalThis.__riftTemporalCloudDebug) {
    globalThis.__riftTemporalCloudDebug.frame = state.frameIndex;
    globalThis.__riftTemporalCloudDebug.underwater = underwater;
  }
}

function disposeTemporalClouds(handle) {
  const state = handle?.__riftTemporalCloudState;
  if (!state) return;

  state.mainScene?.remove(state.displayMesh);
  state.displayMaterial?.dispose();
  state.temporalNode?.dispose?.();
  state.cloudPass?.dispose?.();
  state.cloudScene?.remove(state.rawMesh);

  // Put the original mesh back temporarily so the preserved base disposer can
  // remove and dispose it through its normal ownership path.
  if (state.rawMesh && state.mainScene) state.mainScene.add(state.rawMesh);

  handle.__riftTemporalCloudState = null;
  delete globalThis.__riftTemporalCloudDebug;
}

export function createVolumetricClouds(scene) {
  const handle = createBaseClouds(scene);
  if (!handle) return handle;
  handle.__riftTemporalCloudState = null;
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
  updateBaseClouds(
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

  if (!handle || !camera) return;
  installTemporalClouds(handle, camera);
  syncTemporalClouds(handle, camera, currentBiome);
}

export function disposeVolumetricClouds(handle) {
  disposeTemporalClouds(handle);
  return disposeBaseClouds(handle);
}
