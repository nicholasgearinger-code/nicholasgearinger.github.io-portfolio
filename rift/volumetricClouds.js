import * as THREE from "three";
import {
  createVolumetricClouds as createProceduralClouds,
  updateVolumetricClouds as updateProceduralClouds,
  disposeVolumetricClouds as disposeProceduralClouds,
} from "./proceduralClouds.js";

// Compatibility entry point retained because the stable Rift runtime already
// imports ./volumetricClouds.js. The implementation now lives in the unified
// procedural atmosphere module.
export function createVolumetricClouds(scene) {
  const handle = createProceduralClouds(scene);
  if (handle?.material) {
    // The cloud slab now stays at a real world altitude rather than following
    // the camera vertically. Rift gameplay remains below the cloud base, so the
    // outward-facing BOTTOM of the box is the only surface needed to launch the
    // raymarch. FrontSide keeps it one-pass and also culls the distant side faces
    // that could otherwise produce nearly-horizontal divide-by-zero rays.
    handle.material.side = THREE.FrontSide;
    handle.material.needsUpdate = true;
  }
  return handle;
}

export function updateVolumetricClouds(...args) {
  return updateProceduralClouds(...args);
}

export function disposeVolumetricClouds(handle) {
  return disposeProceduralClouds(handle);
}
