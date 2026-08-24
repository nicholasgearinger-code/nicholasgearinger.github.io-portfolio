// Compatibility entry point retained because main_game.js already imports this
// module. The live cloud implementation is now the true 3D Perlin-Worley
// raymarcher with the v2 large-cumulus presentation tuning.
export {
  createVolumetricClouds,
  updateVolumetricClouds,
  disposeVolumetricClouds,
} from "./volumetricClouds_perlinWorley_v2.js";
