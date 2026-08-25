// Rift Lighting 2.0 experimental celestial entry.
//
// Keep the proven photographic Sun / atmosphere from Celestial v9, but bypass
// Celestial v10's single-map Low shadow scheduler. Lighting 2.0 owns the Sun
// shadow implementation through Three r185's WebGPU CSMShadowNode instead.
export * from "./dayNightCycle_celestial_physical_v9.js";
export {
  createDayNightCycle,
  updateDayNightCycle,
} from "./dayNightCycle_celestial_physical_v9.js";
