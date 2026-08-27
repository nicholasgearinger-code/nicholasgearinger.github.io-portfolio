// Compatibility entry point retained because main_game.js imports this module.
// Default production path: Model 3.7 authored reference-volume clouds + the
// lightweight CPU-side Sun/cloud coupling layer.
//
// Model 3.x changes the macro density architecture rather than retuning the old
// noise field. A baked 3D atlas contains distinct towering cumulus, broken
// cumulus, stratiform/storm and distant cloud families; Perlin/Worley remains
// detail/erosion only. The lighting layer adds no render pass or GPU graph change.
//
// On-device rollbacks:
//   ?cloudLightingLegacy=1 -> exact plain Model 3.7 lighting
//   ?cloudModel37=1        -> exact plain Model 3.7 lighting
//   ?cloudModel36=1        -> raw Model 3.6 review renderer
//   ?cloudModel29=1        -> previous production Model 2.9
//   ?cloudModel28=1        -> previous structured Model 2.8
//   ?cloudModel27=1        -> previous dual-celestial Model 2.7
//   ?cloudModel26=1        -> Model 2.6 camera-centered/TAAU path
//   ?cloudFallback=1       -> older known-good v1.7 renderer
//
// ?cloudLightingPreview=1 is retained as a harmless compatibility alias for the
// now-default coupled lighting path.

import * as coupledLighting from "./volumetricClouds_r185_model37_lighting_preview.js";
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
            : (params?.has("cloudModel37") || params?.has("cloudLightingLegacy"))
              ? model37
              : coupledLighting;

export function createVolumetricClouds(scene) {
  return active.createVolumetricClouds(scene);
}

export function updateVolumetricClouds(...args) {
  return active.updateVolumetricClouds(...args);
}

export function disposeVolumetricClouds(handle) {
  return active.disposeVolumetricClouds(handle);
}
