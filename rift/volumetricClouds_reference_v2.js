// Compatibility entry point retained because main_game.js imports this module.
// Three.js r185.1 migration branch: use the stability-first v1.6 scalloped cloud
// pass. It stays on the proven Nubis/Perlin-Worley shader that runs on iPhone,
// but replaces the broad boxy macro field with smaller overlapping/scalloped
// cloud families and reference-oriented fair-weather tuning.
export {
  createVolumetricClouds,
  updateVolumetricClouds,
  disposeVolumetricClouds,
} from "./volumetricClouds_r185_v16.js";
