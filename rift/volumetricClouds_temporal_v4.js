import * as THREE from "three";
import {
  createVolumetricClouds as createTemporalCloudsV3,
  updateVolumetricClouds as updateTemporalCloudsV3,
  disposeVolumetricClouds as disposeTemporalCloudsV3,
} from "./volumetricClouds_temporal_v3.js";

// -----------------------------------------------------------------------------
// Temporal cloud v4 — straight-alpha cloud history.
//
// v3 restored the real sky by taking opacity from the current cloud frame, but
// the private cloud pass was still rendered with NormalBlending over transparent
// black. That stores RGB approximately as cloudColor * cloudAlpha. The display
// material then applies current cloud alpha again, effectively squaring opacity
// in the visible radiance and turning soft / medium-density clouds brown-black.
//
// The private temporal scene contains only one cloud launch surface, so it does
// not need source-over blending at all. Write straight RGBA directly into the
// render target, let TRAA accumulate straight cloud radiance, and apply opacity
// exactly once when the history is composited back over Rift's real sky.
// -----------------------------------------------------------------------------

function installStraightAlphaSource(handle) {
  const state = handle?.__riftTemporalCloudState;
  if (!state || state.__riftStraightAlphaSourceInstalled) return;

  const sourceMaterial = state.rawMesh?.material;
  const displayMaterial = state.displayMaterial;
  if (!sourceMaterial || !displayMaterial) return;

  // Private pass: one volumetric surface, transparent clear background. With
  // NoBlending the render target receives the shader's actual vec4(scattered,
  // alpha) instead of source-over premultiplying RGB against black first.
  sourceMaterial.transparent = true;
  sourceMaterial.blending = THREE.NoBlending;
  sourceMaterial.premultipliedAlpha = false;
  sourceMaterial.depthWrite = true;
  sourceMaterial.depthTest = true;
  sourceMaterial.needsUpdate = true;

  // Main-scene compositor remains conventional straight-alpha source-over.
  displayMaterial.transparent = true;
  displayMaterial.blending = THREE.NormalBlending;
  displayMaterial.premultipliedAlpha = false;
  displayMaterial.depthWrite = false;
  displayMaterial.needsUpdate = true;

  state.__riftStraightAlphaSourceInstalled = true;

  globalThis.__riftTemporalCloudDebug = {
    ...(globalThis.__riftTemporalCloudDebug || {}),
    sourceEncoding: "straight-rgba-no-blend",
    compositorEncoding: "straight-alpha-normal-blend",
    doublePremultiplyFixed: true,
  };

  console.info("[clouds] temporal v4: straight RGBA history; cloud alpha applied once");
}

export function createVolumetricClouds(scene) {
  return createTemporalCloudsV3(scene);
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
  updateTemporalCloudsV3(
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

  installStraightAlphaSource(handle);
}

export function disposeVolumetricClouds(handle) {
  return disposeTemporalCloudsV3(handle);
}
