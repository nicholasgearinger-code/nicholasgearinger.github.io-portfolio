// Compatibility entry retained because the r185 runtime imports this filename.
// Celestial v12 keeps the proven v10 photographic Sun/shadow budget, but replaces
// the problematic extra SkyMesh render pass with a single-dome analytic atmosphere
// driven by Sky Pro/Preetham-style turbidity, Rayleigh and Mie parameters.
//
// Rollback on-device:
//   ?atmosphereLegacy=1 -> return immediately to the proven v10 atmosphere.

import * as physical from "./dayNightCycle_celestial_physical_v12.js";
import * as legacy from "./dayNightCycle_celestial_physical_v10.js";
export * from "./dayNightCycle_celestial_physical_v12.js";

const forceLegacy = typeof location !== "undefined"
  && new URLSearchParams(location.search).has("atmosphereLegacy");
const active = forceLegacy ? legacy : physical;

export function createDayNightCycle(...args) {
  return active.createDayNightCycle(...args);
}

export function updateDayNightCycle(...args) {
  return active.updateDayNightCycle(...args);
}
