// Compatibility entry point retained because main_game.js already imports this
// module. The live cloud implementation now layers the stable Nubis v3 renderer
// with an ocean-reference fair-weather tuning pass: larger separated cumulus,
// stronger blue-sky gaps, lower-frequency Perlin-Worley mass and atmosphere-
// matched sun/ambient lighting.
export {
  createVolumetricClouds,
  updateVolumetricClouds,
  disposeVolumetricClouds,
} from "./volumetricClouds_reference_ocean_v4.js";
