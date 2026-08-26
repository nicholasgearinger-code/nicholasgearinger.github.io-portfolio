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

// Keep this intentionally imperative. A deeply nested ternary here previously
// introduced one extra closing parenthesis and caused Safari to abort the entire
// Rift module graph with `Unexpected token ')'` before the game could start.
let active = model33;
if (params?.has("cloudModel32")) active = model32;
else if (params?.has("cloudModel31")) active = model31;
else if (params?.has("cloudModel30")) active = model30;
else if (params?.has("cloudModel26")) active = model26;
else if (params?.has("cloudModel25")) active = model25;
else if (params?.has("cloudModel24")) active = model24;
else if (params?.has("cloudModel22")) active = model22;
else if (params?.has("cloudFallback")) active = fallback;

export function createVolumetricClouds(scene) {
  return active.createVolumetricClouds(scene);
}

export function updateVolumetricClouds(...args) {
  return active.updateVolumetricClouds(...args);
}

export function disposeVolumetricClouds(handle) {
  return active.disposeVolumetricClouds(handle);
}
