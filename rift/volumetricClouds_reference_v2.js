// Compatibility entry retained because main_game.js imports this module.
// Rift Cloud Model 4.0 is the default on this review branch.
//
// Model 4.0 reconstructs the macro density atlas directly from the real sky
// references in rift/textures, while retaining Model 3.6's r185 raymarch, TAAU,
// lighting, solar-corridor composition and cloud-aware crepuscular-ray path.
// Rollbacks remain query-selectable for A/B review.

import * as model40 from "./volumetricClouds_r185_model40.js";
import * as model36 from "./volumetricClouds_r185_model36.js";
import * as model35 from "./volumetricClouds_r185_model35.js";
import * as model34 from "./volumetricClouds_r185_model34.js";
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

let active = model40;
if (params?.has("cloudModel36")) active = model36;
else if (params?.has("cloudModel35")) active = model35;
else if (params?.has("cloudModel34")) active = model34;
else if (params?.has("cloudModel33")) active = model33;
else if (params?.has("cloudModel32")) active = model32;
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
