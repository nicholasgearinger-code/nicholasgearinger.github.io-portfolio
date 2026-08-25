// Compatibility entry point retained because main_game.js imports this module.
// Rift Cloud Model 3.0 is the default on this review branch: authored reference
// shapes define the macro cloud silhouette, while Perlin-Worley detail is limited
// to interior modulation and edge erosion. The proven Model 2.6 camera-centered
// temporal path remains available for immediate A/B comparison and rollback.
//
// Rollbacks / comparisons:
//   ?cloudModel26=1  -> previous Model 2.6 camera-centered temporal surface
//   ?cloudModel25=1  -> previous Model 2.5 temporal-stability pass
//   ?cloudModel24=1  -> previous atmosphere-coupled Model 2.4
//   ?cloudModel22=1  -> earlier known-good Model 2.2
//   ?cloudFallback=1 -> older known-good v1.7 renderer

import * as model30 from "./volumetricClouds_r185_model30.js";
import * as model26 from "./volumetricClouds_r185_model26.js";
import * as model25 from "./volumetricClouds_r185_model25.js";
import * as model24 from "./volumetricClouds_r185_model24.js";
import * as model22 from "./volumetricClouds_r185_model22.js";
import * as fallback from "./volumetricClouds_r185_v17.js";

const params = typeof location !== "undefined"
  ? new URLSearchParams(location.search)
  : null;
const forceFallback = params?.has("cloudFallback") === true;
const forceModel22 = params?.has("cloudModel22") === true;
const forceModel24 = params?.has("cloudModel24") === true;
const forceModel25 = params?.has("cloudModel25") === true;
const forceModel26 = params?.has("cloudModel26") === true;

const active = forceFallback
  ? fallback
  : (forceModel22
    ? model22
    : (forceModel24
      ? model24
      : (forceModel25
        ? model25
        : (forceModel26 ? model26 : model30))));

export function createVolumetricClouds(scene) {
  return active.createVolumetricClouds(scene);
}

export function updateVolumetricClouds(...args) {
  return active.updateVolumetricClouds(...args);
}

export function disposeVolumetricClouds(handle) {
  return active.disposeVolumetricClouds(handle);
}
