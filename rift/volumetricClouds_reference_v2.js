// Compatibility entry point retained because main_game.js imports this module.
// Three.js r185.1 migration branch: use the stability-first v1.7 persistent
// cumulus pass. It keeps the proven Safari-safe Nubis/Perlin-Worley shader, but
// distributes more scalloped cloud families across the tile so fair-weather
// clouds remain visible instead of disappearing after the opening view.
export {
  createVolumetricClouds,
  updateVolumetricClouds,
  disposeVolumetricClouds,
} from "./volumetricClouds_r185_v17.js";
