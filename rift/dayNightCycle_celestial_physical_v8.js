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

// Rift Islands bright-day presentation. Keep a query override for testing the
// full celestial cycle (?naturalCycle=1). At default the sun, sky dome, clouds'
// lighting and day/night material uniforms all agree on daytime illumination.
const BRIGHT_DAY = params?.has("naturalCycle") !== true;
const CYCLE_DAY_SECONDS = 1800 * 0.48; // sun high and slightly off zenith

export function createDayNightCycle(...args) {
  const cycle = active.createDayNightCycle(...args);
  if (BRIGHT_DAY && cycle) cycle.elapsed = CYCLE_DAY_SECONDS;
  return cycle;
}

export function updateDayNightCycle(cycle, dt, ...rest) {
  if (BRIGHT_DAY && cycle) cycle.elapsed = CYCLE_DAY_SECONDS - Math.max(0, dt || 0);
  return active.updateDayNightCycle(cycle, dt, ...rest);
}
