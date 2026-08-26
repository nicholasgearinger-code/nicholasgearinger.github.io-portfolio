// Compatibility entry point retained because main_game.js imports this module.
// Rift Cloud Model 3.3 is the default on this review branch.
//
// Model 3.2 strengthens lighting on the proven 3.1 authored shapes without an
// additional sample. Model 3.3 then bakes multiple cloud families into a v3 atlas
// so the sky gains hero clouds, satellites, broken groups, horizon banks and storm
// cells while retaining the same single-atlas runtime lookup.
//
// Rollbacks / comparisons:
//   ?cloudModel32=1  -> Model 3.2 lighting on the 3.1 atlas
//   ?cloudModel31=1  -> previous Model 3.1 crown/self-shadow build
//   ?cloudModel30=1  -> previous Model 3.0 reference-shaped build
//   ?cloudModel26=1  -> Model 2.6 camera-centered temporal surface
//   ?cloudModel25=1  -> Model 2.5 temporal-stability pass
//   ?cloudModel24=1  -> Model 2.4 atmosphere-coupled build
//   ?cloudModel22=1  -> Model 2.2
//   ?cloudFallback=1 -> v1.7 fallback

import * as model33 from "./volumetricClouds_r185_model33.js";
import * as model32 from "./volumetricClouds_r185_model32.js";
import * as model31 from "./volumetricClouds_r185_model31.js";
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
const forceModel30 = params?.has("cloudModel30") === true;
const forceModel31 = params?.has("cloudModel31") === true;
const forceModel32 = params?.has("cloudModel32") === true;

const active = forceFallback
  ? fallback
  : (forceModel22
    ? model22
    : (forceModel24
      ? model24
      : (forceModel25
        ? model25
        : (forceModel26
          ? model26
          : (forceModel30
            ? model30
            : (forceModel31
              ? model31
              : (forceModel32 ? model32 : model33))))))));

export function createVolumetricClouds(scene) {
  return active.createVolumetricClouds(scene);
}

export function updateVolumetricClouds(...args) {
  return active.updateVolumetricClouds(...args);
}

export function disposeVolumetricClouds(handle) {
  return active.disposeVolumetricClouds(handle);
}
