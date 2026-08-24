// Compatibility entry point retained because main_game.js imports this module.
// Three.js r185.1 migration branch: route the live game through the r185 cumulus
// presentation layer. It keeps the quarter-resolution progressive renderer but
// replaces the near-constant cloud-top envelope with smooth continuous-height
// cumulus organization so 3D Perlin-Worley density can form rounded cloud masses.
export {
  createVolumetricClouds,
  updateVolumetricClouds,
  disposeVolumetricClouds,
} from "./volumetricClouds_r185_v1.js";
