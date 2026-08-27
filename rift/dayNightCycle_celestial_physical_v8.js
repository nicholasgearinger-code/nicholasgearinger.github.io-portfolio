// Compatibility entry retained because the r185 runtime imports this filename.
// Celestial v16 keeps v14's phase-consistent lunar motion and photographic
// atmosphere, v15's iOS/WebGPU flare stability guard, and adds cloud-disc
// occlusion driven by the live volumetric cloud field. The existing lunar phase
// mask remains owned by dayNightCycle_lighting_base.js.
//
// Rollback on-device:
//   ?celestialV15=1     -> previous mobile-stable celestial v15
//   ?atmosphereV12=1    -> previous single-dome v12
//   ?atmosphereLegacy=1 -> proven v10 atmosphere

import * as physical from "./dayNightCycle_celestial_physical_v16.js";
import * as v15 from "./dayNightCycle_celestial_physical_v15.js";
import * as v12 from "./dayNightCycle_celestial_physical_v12.js";
import * as legacy from "./dayNightCycle_celestial_physical_v10.js";
export * from "./dayNightCycle_celestial_physical_v16.js";

const params = typeof location !== "undefined"
  ? new URLSearchParams(location.search)
  : null;
const forceLegacy = params?.has("atmosphereLegacy") === true;
const forceV12 = params?.has("atmosphereV12") === true;
const forceV15 = params?.has("celestialV15") === true;
const active = forceLegacy ? legacy : (forceV12 ? v12 : (forceV15 ? v15 : physical));

export function createDayNightCycle(...args) {
  return active.createDayNightCycle(...args);
}

export function updateDayNightCycle(...args) {
  return active.updateDayNightCycle(...args);
}
