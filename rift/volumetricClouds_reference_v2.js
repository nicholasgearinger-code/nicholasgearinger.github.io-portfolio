// Compatibility entry point retained because main_game.js already imports this
// module. The live cloud implementation is now the true 3D Perlin-Worley
// raymarcher in volumetricClouds_perlinWorley.js.
export {
  createVolumetricClouds,
  updateVolumetricClouds,
  disposeVolumetricClouds,
} from "./volumetricClouds_perlinWorley.js";
