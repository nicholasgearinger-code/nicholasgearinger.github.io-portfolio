// Compatibility entry point retained because main_game.js imports this module.
// Rift Cloud Model 2.2 is the default r185.1 test path. Add ?cloudFallback=1 to
// the URL to instantly return to the last known-good v1.7 renderer if Safari or
// a specific WebGPU backend exposes a regression while Model 2 is being tuned.

import * as model2 from "./volumetricClouds_r185_model22.js";
import * as fallback from "./volumetricClouds_r185_v17.js";

const forceFallback = typeof location !== "undefined"
  && new URLSearchParams(location.search).has("cloudFallback");

const active = forceFallback ? fallback : model2;

export function createVolumetricClouds(scene) {
  return active.createVolumetricClouds(scene);
}

export function updateVolumetricClouds(...args) {
  return active.updateVolumetricClouds(...args);
}

export function disposeVolumetricClouds(handle) {
  return active.disposeVolumetricClouds(handle);
}
