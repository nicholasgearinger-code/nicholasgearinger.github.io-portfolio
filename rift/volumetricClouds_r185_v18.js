import * as THREE from "three";
import {
  clamp,
  float,
  mrt,
  output,
  pass,
  screenUV,
  uniform,
  vec3,
  vec4,
  velocity,
} from "three/tsl";
import {
  createVolumetricClouds as createPersistentClouds,
  updateVolumetricClouds as updatePersistentClouds,
  disposeVolumetricClouds as disposePersistentClouds,
} from "./volumetricClouds_r185_v17.js";
import { createRiftInterleavedCloudHistory } from "./cloudTemporalInterleaveR185.js";

// -----------------------------------------------------------------------------
// r185 cloud presentation v1.8 — 4x4 interleaved temporal reconstruction.
//
// Mobile Low previously raymarched a complete quarter-width/quarter-height cloud
// image every frame (1/16 of full-screen pixels). V1.8 raymarches at 1/16 width
// and 1/16 height (1/256 of full-screen pixels), then distributes those samples
// into a persistent quarter-resolution history over 16 phases.
//
// A cheap quarter-resolution proxy pass supplies velocity for reprojection. This
// keeps camera turns responsive without making the expensive cloud shader render
// at quarter resolution. The final quarter-resolution history is linearly
// reconstructed to the screen by the display mesh.
// -----------------------------------------------------------------------------

const HISTORY_SCALE = 0.25;
const SAMPLE_SCALE = 1 / 16;

// Spatially dispersed ordering avoids sweeping a visible line through the image.
const INTERLEAVE_PHASES = [
  [1, 1], [3, 3], [1, 3], [3, 1],
  [0, 0], [2, 2], [0, 2], [2, 0],
  [1, 0], [3, 2], [1, 2], [3, 0],
  [0, 1], [2, 3], [0, 3], [2, 1],
];

function isMobileLow(handle) {
  return handle?.__riftProgressiveQuality?.label === "mobile-low";
}

function prepareMobileInterleaveBudget(handle) {
  if (!handle || !isMobileLow(handle)) return;

  // Temporal reconstruction lets us reduce per-sample work while still building
  // a much denser image over time. This is applied before Nubis compiles on the
  // first update, so the loop counts become compile-time constants in WGSL.
  const progressive = handle.__riftProgressiveQuality;
  if (progressive) {
    progressive.viewSteps = 24;
    progressive.lightSteps = 2;
  }
  const nubis = handle.__riftNubisV2Quality;
  if (nubis) {
    nubis.viewSteps = 24;
    nubis.lightSteps = 2;
  }
}

function createMotionProxy(state, camera) {
  const motionScene = new THREE.Scene();
  motionScene.name = "rift-cloud-motion-proxy-scene";
  motionScene.backgroundNode = vec4(0, 0, 0, 0);

  const motionMaterial = new THREE.MeshBasicNodeMaterial();
  motionMaterial.name = "rift-cloud-motion-proxy-material";
  motionMaterial.colorNode = vec3(0);
  motionMaterial.transparent = false;
  motionMaterial.depthWrite = false;
  motionMaterial.depthTest = false;
  motionMaterial.side = THREE.DoubleSide;
  motionMaterial.toneMapped = false;

  const motionMesh = new THREE.Mesh(state.rawMesh.geometry, motionMaterial);
  motionMesh.name = "rift-cloud-motion-proxy";
  motionMesh.frustumCulled = false;
  motionMesh.position.copy(state.rawMesh.position);
  motionMesh.rotation.copy(state.rawMesh.rotation);
  motionMesh.scale.copy(state.rawMesh.scale);
  motionScene.add(motionMesh);

  const motionPass = pass(motionScene, camera, {
    samples: 1,
    depthBuffer: false,
    stencilBuffer: false,
  });
  motionPass.name = "rift-cloud-motion-proxy-pass";
  motionPass.transparent = true;
  motionPass.opaque = false;
  motionPass.setResolutionScale(HISTORY_SCALE);
  motionPass.setMRT(mrt({ output, velocity }));

  return { motionScene, motionMaterial, motionMesh, motionPass };
}

function installInterleavedHistory(handle, camera) {
  if (!handle || !camera || !isMobileLow(handle) || handle.__riftR185InterleaveState) return;

  const temporal = handle.__riftTemporalCloudState;
  if (!temporal?.cloudPass || !temporal?.rawMesh || !temporal?.displayMaterial) return;

  // The old TRAA resolver is no longer referenced once the progressive renderer
  // replaces the display material. Dispose it now so only the dedicated cloud
  // history owns temporal resources.
  temporal.temporalNode?.dispose?.();
  temporal.temporalNode = null;

  // Expensive raymarch: 1/16 width x 1/16 height. Over 16 jitter phases, these
  // samples populate every texel of the quarter-resolution history image.
  temporal.cloudPass.setResolutionScale(SAMPLE_SCALE);
  temporal.resolutionScale = SAMPLE_SCALE;

  const sampleTexture = temporal.cloudPass.getTextureNode("output");
  const sampleRTTexture = temporal.cloudPass.getTexture("output");
  if (sampleRTTexture) {
    sampleRTTexture.minFilter = THREE.LinearFilter;
    sampleRTTexture.magFilter = THREE.LinearFilter;
    sampleRTTexture.generateMipmaps = false;
    sampleRTTexture.needsUpdate = true;
  }

  // A private camera can be jittered without touching the gameplay/main camera.
  const sampleCamera = camera.clone();
  sampleCamera.name = "rift-cloud-interleave-sample-camera";
  temporal.cloudPass.camera = sampleCamera;

  const phase = uniform(new THREE.Vector2(INTERLEAVE_PHASES[0][0], INTERLEAVE_PHASES[0][1]));
  const motion = createMotionProxy(temporal, camera);
  const velocityTexture = motion.motionPass.getTextureNode("velocity");

  const historyNode = createRiftInterleavedCloudHistory(
    sampleTexture,
    velocityTexture,
    phase,
    HISTORY_SCALE,
  );
  const historyTexture = historyNode.getTextureNode();
  const resolved = historyTexture.sample(screenUV);

  temporal.displayMaterial.colorNode = resolved.rgb;
  temporal.displayMaterial.opacityNode = clamp(resolved.a, float(0), float(1));
  temporal.displayMaterial.transparent = true;
  temporal.displayMaterial.blending = THREE.NormalBlending;
  temporal.displayMaterial.premultipliedAlpha = false;
  temporal.displayMaterial.depthWrite = false;
  temporal.displayMaterial.depthTest = true;
  temporal.displayMaterial.forceSinglePass = true;
  temporal.displayMaterial.toneMapped = false;
  temporal.displayMaterial.needsUpdate = true;

  handle.__riftR185InterleaveState = {
    phase,
    phaseIndex: 0,
    sampleCamera,
    historyNode,
    ...motion,
  };

  globalThis.__riftR185InterleaveDebug = {
    enabled: true,
    threeRevision: THREE.REVISION,
    mode: "4x4 interleaved quarter-res temporal reconstruction",
    sampleScale: SAMPLE_SCALE,
    historyScale: HISTORY_SCALE,
    phases: 16,
    viewSteps: handle.__riftNubisV2Quality?.viewSteps || 0,
    lightSteps: handle.__riftNubisV2Quality?.lightSteps || 0,
  };

  console.info(
    `[clouds] r${THREE.REVISION} 4x4 temporal interleave active: ` +
    `${Math.round(SAMPLE_SCALE * 100)}%-width raymarch -> ${Math.round(HISTORY_SCALE * 100)}%-width history`,
  );
}

function syncSampleCamera(sampleCamera, sourceCamera, cloudPass, phaseX, phaseY) {
  // Camera.copy() also restores the unjittered projection/view settings from the
  // gameplay camera before this frame's cloud-only subpixel offset is applied.
  sampleCamera.copy(sourceCamera, false);
  sampleCamera.clearViewOffset?.();

  const tinyWidth = Math.max(1, Number(cloudPass?.renderTarget?.width) || 1);
  const tinyHeight = Math.max(1, Number(cloudPass?.renderTarget?.height) || 1);

  // Once the tiny render target has rendered at least once, its dimensions are
  // the exact 1/16-width sample grid. Offsetting by +/- 0.375 tiny pixels lands
  // the ray at one of the 16 quarter-history subpixel positions.
  if (tinyWidth > 4 && tinyHeight > 4 && sampleCamera.setViewOffset) {
    const jitterX = (phaseX - 1.5) / 4;
    const jitterY = (phaseY - 1.5) / 4;
    sampleCamera.setViewOffset(
      tinyWidth,
      tinyHeight,
      jitterX,
      jitterY,
      tinyWidth,
      tinyHeight,
    );
  }

  sampleCamera.updateMatrixWorld(true);
}

function syncInterleave(handle, camera) {
  const interleave = handle?.__riftR185InterleaveState;
  const temporal = handle?.__riftTemporalCloudState;
  if (!interleave || !temporal || !camera) return;

  const phase = INTERLEAVE_PHASES[interleave.phaseIndex % INTERLEAVE_PHASES.length];
  interleave.phase.value.set(phase[0], phase[1]);

  syncSampleCamera(
    interleave.sampleCamera,
    camera,
    temporal.cloudPass,
    phase[0],
    phase[1],
  );
  temporal.cloudPass.camera = interleave.sampleCamera;
  temporal.cloudPass.setResolutionScale(SAMPLE_SCALE);
  temporal.resolutionScale = SAMPLE_SCALE;

  // The motion proxy follows the launch geometry but deliberately uses the real,
  // unjittered camera at quarter resolution.
  interleave.motionMesh.position.copy(temporal.rawMesh.position);
  interleave.motionMesh.rotation.copy(temporal.rawMesh.rotation);
  interleave.motionMesh.scale.copy(temporal.rawMesh.scale);
  interleave.motionPass.camera = camera;
  interleave.motionPass.setResolutionScale(HISTORY_SCALE);

  if (temporal.displayMesh?.visible !== false) {
    interleave.phaseIndex = (interleave.phaseIndex + 1) % INTERLEAVE_PHASES.length;
  }

  if (globalThis.__riftR185InterleaveDebug) {
    globalThis.__riftR185InterleaveDebug.phase = `${phase[0]},${phase[1]}`;
    globalThis.__riftR185InterleaveDebug.phaseIndex = interleave.phaseIndex;
    globalThis.__riftR185InterleaveDebug.sampleWidth = temporal.cloudPass.renderTarget?.width || 0;
    globalThis.__riftR185InterleaveDebug.sampleHeight = temporal.cloudPass.renderTarget?.height || 0;
  }
}

function disposeInterleave(handle) {
  const interleave = handle?.__riftR185InterleaveState;
  if (!interleave) return;

  interleave.historyNode?.dispose?.();
  interleave.motionPass?.dispose?.();
  interleave.motionScene?.remove?.(interleave.motionMesh);
  interleave.motionMaterial?.dispose?.();
  handle.__riftR185InterleaveState = null;
  delete globalThis.__riftR185InterleaveDebug;
}

export function createVolumetricClouds(scene) {
  const handle = createPersistentClouds(scene);
  if (!handle) return handle;
  prepareMobileInterleaveBudget(handle);
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
  updatePersistentClouds(
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

  if (!handle || !camera || !isMobileLow(handle)) return;
  installInterleavedHistory(handle, camera);
  syncInterleave(handle, camera);
}

export function disposeVolumetricClouds(handle) {
  disposeInterleave(handle);
  return disposePersistentClouds(handle);
}
