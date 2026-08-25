// Compatibility entry point retained because main_game.js imports this module.
// Rift Cloud Model 2.5 is the default r185.1 mobile path. It keeps Model 2's
// meteorological Perlin-Worley raymarch but fixes the low-FPS TAAU history smear
// that appeared as rectangular/horizontal cloud bands in the latest iPhone tests.
//
// Rollbacks remain available on-device:
//   ?cloudModel24=1  -> previous atmosphere-coupled Model 2.4
//   ?cloudModel22=1  -> earlier known-good Model 2.2
//   ?cloudFallback=1 -> older known-good v1.7 renderer

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

const active = forceFallback
  ? fallback
  : (forceModel22 ? model22 : (forceModel24 ? model24 : model25));

export function createVolumetricClouds(scene) {
  return active.createVolumetricClouds(scene);
}

export function updateVolumetricClouds(...args) {
  return active.updateVolumetricClouds(...args);
}

export function disposeVolumetricClouds(handle) {
  return active.disposeVolumetricClouds(handle);
}
