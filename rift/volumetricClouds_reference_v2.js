// Compatibility entry point retained because main_game.js imports this module.
// Rift Cloud Model 2.4 is the default r185.1 path: Model 2.3's atmosphere/weather
// coupling remains, but fair-weather occupancy and low-Sun radiance are rebalanced
// so mobile twilight clouds read as volumetric forms instead of bright horizontal
// cards against a dark sky.
//
// Rollbacks remain available on-device:
//   ?cloudModel22=1  -> previous known-good Model 2.2
//   ?cloudFallback=1 -> older known-good v1.7 renderer

import * as model24 from "./volumetricClouds_r185_model24.js";
import * as model22 from "./volumetricClouds_r185_model22.js";
import * as fallback from "./volumetricClouds_r185_v17.js";

const params = typeof location !== "undefined"
  ? new URLSearchParams(location.search)
  : null;
const forceFallback = params?.has("cloudFallback") === true;
const forceModel22 = params?.has("cloudModel22") === true;

const active = forceFallback ? fallback : (forceModel22 ? model22 : model24);

export function createVolumetricClouds(scene) {
  return active.createVolumetricClouds(scene);
}

export function updateVolumetricClouds(...args) {
  return active.updateVolumetricClouds(...args);
}

export function disposeVolumetricClouds(handle) {
  return active.disposeVolumetricClouds(handle);
}
