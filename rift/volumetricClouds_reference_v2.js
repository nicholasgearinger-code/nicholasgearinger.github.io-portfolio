// Compatibility entry point retained because main_game.js imports this module.
// Rift Cloud Model 2.8 is the default r185.1 path. It preserves Model 2.6's
// camera-centered TAAU surface, Model 2.7's Sun/Moon scattering, and adds more
// defined cumulus anatomy, celestial-disc occlusion, and a structured projected
// cloud-shadow map for terrain lighting.
//
// Rollbacks remain available on-device:
//   ?cloudModel27=1  -> previous dual-celestial scattering pass
//   ?cloudModel26=1  -> previous Model 2.6 camera-centered path
//   ?cloudModel25=1  -> previous Model 2.5 temporal-stability pass
//   ?cloudModel24=1  -> previous atmosphere-coupled Model 2.4
//   ?cloudModel22=1  -> earlier known-good Model 2.2
//   ?cloudFallback=1 -> older known-good v1.7 renderer

import * as model28 from "./volumetricClouds_r185_model28.js";
import * as model27 from "./volumetricClouds_r185_model27.js";
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
const forceModel27 = params?.has("cloudModel27") === true;

const active = forceFallback
  ? fallback
  : (forceModel22
    ? model22
    : (forceModel24
      ? model24
      : (forceModel25
        ? model25
        : (forceModel26 ? model26 : (forceModel27 ? model27 : model28)))));

export function createVolumetricClouds(scene) {
  return active.createVolumetricClouds(scene);
}

export function updateVolumetricClouds(...args) {
  return active.updateVolumetricClouds(...args);
}

export function disposeVolumetricClouds(handle) {
  return active.disposeVolumetricClouds(handle);
}
