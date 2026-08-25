// Compatibility entry retained because the r185 runtime imports this filename.
// Celestial v13 keeps the proven v10 photographic Sun/shadow budget and v12's
// single-dome Preetham/Sky-style physical controls, but maps them into a more
// photographic sky: blue zenith, localized warm horizon, narrow aerosol haze.
//
// Rollback on-device:
//   ?atmosphereV12=1    -> previous single-dome v12
//   ?atmosphereLegacy=1 -> proven v10 atmosphere

import * as physical from "./dayNightCycle_celestial_physical_v13.js";
import * as v12 from "./dayNightCycle_celestial_physical_v12.js";
import * as legacy from "./dayNightCycle_celestial_physical_v10.js";
export * from "./dayNightCycle_celestial_physical_v13.js";

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
