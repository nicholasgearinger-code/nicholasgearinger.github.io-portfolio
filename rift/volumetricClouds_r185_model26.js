import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model25.js";

export * from "./volumetricClouds_r185_model25.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 2.6 — camera-centered temporal launch surface.
//
// The latest iPhone captures finally exposed the geometry bug underneath the
// remaining horizontal cloud strips. proceduralClouds.js correctly recenters the
// finite cloud launch plane on the camera every frame, but temporalClouds.js then
// reset the raw/display cloud meshes back to world X/Z = 0. Once the player moved
// away from the world origin, the screen-space cloud compositor was therefore
// clipped by the projected edge of a distant 1900-unit plane. That looked exactly
// like thin rectangular/horizontal cloud bands and also made most of the cloud
// field appear to vanish.
//
// Model 2.6 leaves the proven Model 2.5 density, lighting and TAAU path intact,
// but restores the intended camera-relative launch/compositor geometry after the
// preserved temporal updater runs. The low-tier render scale is also returned to
// 33% (from 36%) to recover some of the iPhone frame cost now that clouds can once
// again occupy the full sky.
// -----------------------------------------------------------------------------

const MOBILE_SCALE = 0.33;

function recenterTemporalSurface(handle, camera) {
  if (!handle || !camera) return;

  const x = Number(camera.position?.x) || 0;
  const z = Number(camera.position?.z) || 0;
  const temporal = handle.__riftTemporalCloudState;
  const raw = temporal?.rawMesh || handle.mesh;
  const display = temporal?.displayMesh;

  if (raw) {
    raw.position.x = x;
    raw.position.z = z;
  }

  if (display) {
    display.position.x = x;
    display.position.z = z;
    if (raw) display.position.y = raw.position.y;
  }

  // Model 2.5 moved Mobile Low to 36% while we were treating the strips as a
  // temporal-resolution problem. With the actual plane-clipping bug fixed, 33%
  // gives back ~16% of cloud-pass pixels while retaining the faster 18% current-
  // frame TAAU response introduced in 2.5.
  const q = handle.__riftModel2Quality;
  if (q?.label === "mobile-low") {
    q.renderScale = MOBILE_SCALE;
    temporal?.cloudPass?.setResolutionScale?.(MOBILE_SCALE);
    if (temporal) temporal.resolutionScale = MOBILE_SCALE;

    const taau = handle.__riftModel2TAAUState;
    if (taau) {
      taau.resolutionScale = MOBILE_SCALE;
      if (taau.node) {
        taau.node.currentFrameWeight = 0.18;
        taau.node.depthThreshold = 0.0022;
        taau.node.edgeDepthDiff = 0.0045;
        taau.node.maxVelocityLength = 38;
      }
    }
  }

  if (globalThis.__riftModel2TAAUDebug && q?.label === "mobile-low") {
    Object.assign(globalThis.__riftModel2TAAUDebug, {
      inputResolutionScale: MOBILE_SCALE,
      model26CameraCenteredPlane: true,
    });
  }

  globalThis.__riftCloudModel26 = {
    version: "2.6-camera-centered-temporal-surface",
    cameraX: x,
    cameraZ: z,
    rawX: Number(raw?.position?.x) || 0,
    rawZ: Number(raw?.position?.z) || 0,
    displayX: Number(display?.position?.x) || 0,
    displayZ: Number(display?.position?.z) || 0,
    renderScale: q?.renderScale || 0,
    taauCurrentFrameWeight: handle.__riftModel2TAAUState?.node?.currentFrameWeight || 0,
    threeRevision: THREE.REVISION,
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (!handle) return handle;

  handle.__riftModel26 = true;
  if (handle.__riftModel2Quality?.label === "mobile-low") {
    handle.__riftModel2Quality.renderScale = MOBILE_SCALE;
  }
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
  base.updateVolumetricClouds(
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

  recenterTemporalSurface(handle, camera);
}

export function disposeVolumetricClouds(handle) {
  delete globalThis.__riftCloudModel26;
  return base.disposeVolumetricClouds(handle);
}
