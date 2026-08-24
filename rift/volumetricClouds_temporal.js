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

// Cloud-only temporal reprojection. New progressive cloud renderers may set
// handle.__riftSkyProReconstruction = true to keep the private cloud pass but
// disable the old weather-map subpixel dither; those renderers own sampling and
// reconstruction themselves.

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

  mainScene.remove(rawMesh);

  const cloudScene = new THREE.Scene();
  cloudScene.name = "rift-temporal-cloud-scene";
  cloudScene.backgroundNode = vec4(0, 0, 0, 0);
  cloudScene.add(rawMesh);

  rawMesh.material.depthWrite = true;
  rawMesh.material.depthTest = true;
  rawMesh.material.transparent = true;
  rawMesh.material.needsUpdate = true;

  const cloudPass = pass(cloudScene, camera, {
    samples: 1,
    depthBuffer: true,
    stencilBuffer: false,
  });
  cloudPass.name = "rift-temporal-cloud-pass";
  cloudPass.transparent = true;
  cloudPass.opaque = false;
  cloudPass.setResolutionScale(resolutionScaleFor(handle));
  cloudPass.setMRT(mrt({ output, velocity }));

  const cloudColor = cloudPass.getTextureNode("output");
  const cloudDepth = cloudPass.getTextureNode("depth");
  const cloudVelocity = cloudPass.getTextureNode("velocity");

  const temporalNode = traa(cloudColor, cloudDepth, cloudVelocity, camera);
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
}

function syncTemporalClouds(handle, camera, biome) {
  const state = handle?.__riftTemporalCloudState;
  if (!state || !camera) return;

  const underwater = isUnderwater(camera, biome);
  state.rawMesh.visible = !underwater;
  state.displayMesh.visible = !underwater;

  state.rawMesh.position.x = 0;
  state.rawMesh.position.z = 0;
  state.displayMesh.position.x = 0;
  state.displayMesh.position.z = 0;
  state.displayMesh.position.y = state.rawMesh.position.y;
  state.displayMesh.rotation.copy(state.rawMesh.rotation);
  state.displayMesh.scale.copy(state.rawMesh.scale);

  // Legacy TRAA needed a changing sub-texel weather offset to fill sparse march
  // gaps. Progressive low-resolution reconstruction uses a stable cloud field,
  // so applying this dither there would move the silhouette every frame.
  if (!handle.__riftSkyProReconstruction) {
    const phase = TEMPORAL_PHASES[state.frameIndex % TEMPORAL_PHASES.length];
    state.frameIndex = (state.frameIndex + 1) % TEMPORAL_PHASES.length;
    const weatherOffset = handle.uniforms?.weatherOffset?.value;
    if (weatherOffset) {
      weatherOffset.x += (phase[0] - 0.5) * 0.0018;
      weatherOffset.y += (phase[1] - 0.5) * 0.0018;
    }
  } else {
    state.frameIndex = 0;
  }

  state.wasUnderwater = underwater;
  if (globalThis.__riftTemporalCloudDebug) {
    globalThis.__riftTemporalCloudDebug.frame = state.frameIndex;
    globalThis.__riftTemporalCloudDebug.underwater = underwater;
    globalThis.__riftTemporalCloudDebug.legacyDither = !handle.__riftSkyProReconstruction;
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
