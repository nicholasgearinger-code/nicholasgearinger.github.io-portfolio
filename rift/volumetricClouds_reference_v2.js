// Compatibility entry point retained because main_game.js imports this module.
// Default production path: Model 3.8 authored reference-volume clouds with
// dramatic Sun/Moon directional lighting.
//
// Model 3.x changes the macro density architecture rather than retuning the old
// noise field. A baked 3D atlas contains distinct towering cumulus, broken
// cumulus, stratiform/storm and distant cloud families; Perlin/Worley remains
// detail/erosion only. Model 3.8 keeps Model 3.7's production celestial coupling,
// local Sun/Moon occlusion and terrain cloud shadows, then strengthens true
// view-dependent rim/back lighting without adding ray steps or render passes.
//
// On-device rollbacks:
//   ?cloudModel37=1 -> previous Model 3.7 production lighting
//   ?cloudModel36=1 -> raw Model 3.6 review renderer
//   ?cloudModel29=1 -> previous production Model 2.9
//   ?cloudModel28=1 -> previous structured Model 2.8
//   ?cloudModel27=1 -> previous dual-celestial Model 2.7
//   ?cloudModel26=1 -> Model 2.6 camera-centered/TAAU path
//   ?cloudFallback=1 -> older known-good v1.7 renderer

import * as model38 from "./volumetricClouds_r185_model38.js";
import * as model37 from "./volumetricClouds_r185_model37.js";
import * as model36 from "./volumetricClouds_r185_model36.js";
import * as model29 from "./volumetricClouds_r185_model29.js";
import * as model28 from "./volumetricClouds_r185_model28.js";
import * as model27 from "./volumetricClouds_r185_model27.js";
import * as model26 from "./volumetricClouds_r185_model26.js";
import * as fallback from "./volumetricClouds_r185_v17.js";

const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
const active = params?.has("cloudFallback")
  ? fallback
  : params?.has("cloudModel26")
    ? model26
    : params?.has("cloudModel27")
      ? model27
      : params?.has("cloudModel28")
        ? model28
        : params?.has("cloudModel29")
          ? model29
          : params?.has("cloudModel36")
            ? model36
            : params?.has("cloudModel37")
              ? model37
              : model38;

export function createVolumetricClouds(scene) {
  return active.createVolumetricClouds(scene);
}

export function updateVolumetricClouds(...args) {
  return active.updateVolumetricClouds(...args);
}

export function disposeVolumetricClouds(handle) {
  return active.disposeVolumetricClouds(handle);
}
