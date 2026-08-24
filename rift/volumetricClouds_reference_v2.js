// Compatibility entry point retained because main_game.js imports this module.
// Three.js r185.1 migration branch: route Mobile Low through the v1.8 4x4
// interleaved temporal cloud renderer. The expensive raymarch now runs at 1/16
// screen width/height and populates a quarter-resolution reprojected history over
// 16 phases; other quality tiers keep the stable v1.7 presentation path.
export {
  createVolumetricClouds,
  updateVolumetricClouds,
  disposeVolumetricClouds,
} from "./volumetricClouds_r185_v18.js";
