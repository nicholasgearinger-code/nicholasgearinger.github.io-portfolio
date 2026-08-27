// Compatibility entry retained because the r185 runtime imports this filename.
// Celestial v14 layers phase-consistent lunar motion and lightweight camera-space
// lens optics over v13's photographic atmosphere. The existing lunar phase mask
// remains owned by the preserved dayNightCycle_lighting_base.js stack.
//
// Rollback on-device:
//   ?atmosphereV12=1    -> previous single-dome v12
//   ?atmosphereLegacy=1 -> proven v10 atmosphere

import * as physical from "./dayNightCycle_celestial_physical_v14.js";
import * as v12 from "./dayNightCycle_celestial_physical_v12.js";
import * as legacy from "./dayNightCycle_celestial_physical_v10.js";
export * from "./dayNightCycle_celestial_physical_v14.js";

const params = typeof location !== "undefined"
  ? new URLSearchParams(location.search)
  : null;
const forceLegacy = params?.has("atmosphereLegacy") === true;
const forceV12 = params?.has("atmosphereV12") === true;
const active = forceLegacy ? legacy : (forceV12 ? v12 : physical);

export function createDayNightCycle(...args) {
  return active.createDayNightCycle(...args);
}

export function updateDayNightCycle(...args) {
  return active.updateDayNightCycle(...args);
}
