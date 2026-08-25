// Compatibility entry retained because the r185 runtime imports this filename.
// Celestial v11 layers Three r185 SkyMesh/Preetham scattering over the proven
// v10 photographic Sun and Mobile Low shadow budget. Add ?atmosphereLegacy=1 to
// bypass SkyMesh instantly and return to the v10 atmosphere presentation.
export * from "./dayNightCycle_celestial_physical_v11.js";
export {
  createDayNightCycle,
  updateDayNightCycle,
} from "./dayNightCycle_celestial_physical_v11.js";
