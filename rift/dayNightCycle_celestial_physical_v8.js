// Compatibility entry retained because the r185 runtime imports this filename.
// Celestial v12 keeps the proven v10 photographic Sun/shadow budget, but replaces
// the problematic extra SkyMesh render pass with a single-dome analytic atmosphere
// driven by Sky Pro/Preetham-style turbidity, Rayleigh and Mie parameters.
//
// Rollback: ?atmosphereLegacy=1 is no longer needed for normal operation; v11 is
// still preserved in the repository for direct comparison if required.
export * from "./dayNightCycle_celestial_physical_v12.js";
export {
  createDayNightCycle,
  updateDayNightCycle,
} from "./dayNightCycle_celestial_physical_v12.js";
