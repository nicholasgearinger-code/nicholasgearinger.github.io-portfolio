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
    // The new cloud band is fixed in world altitude, so the player normally
    // views its bottom face from OUTSIDE the cloud box. The historical renderer
    // used BackSide because its box followed the camera vertically and always
    // enclosed it. DoubleSide is required now for both below-cloud and
    // inside-cloud viewpoints; forceSinglePass avoids the usual transparent
    // double-sided two-pass cost on mobile.
    handle.material.side = THREE.DoubleSide;
    handle.material.forceSinglePass = true;
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
