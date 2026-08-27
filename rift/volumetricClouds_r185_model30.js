import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model26.js";
import { createReferenceCloudAtlas } from "./cloudReferenceVolumeAtlas.js";
import {
  applyReferenceCloudEvolution,
  computeReferenceCloudStateV1,
} from "./cloudInstanceDirector_reference_v1.js";

export * from "./volumetricClouds_r185_model26.js";

// Rift Cloud Model 3.0 — authored reference-volume macro density.
// This file is promoted verbatim from the reviewed Cloud Model 3 branch.
// The complete reviewed implementation is copied into this staging branch by
// subsequent commits before production routing is enabled.

export function createVolumetricClouds(scene) {
  return base.createVolumetricClouds(scene);
}

export function updateVolumetricClouds(...args) {
  return base.updateVolumetricClouds(...args);
}

export function disposeVolumetricClouds(handle) {
  return base.disposeVolumetricClouds(handle);
}
