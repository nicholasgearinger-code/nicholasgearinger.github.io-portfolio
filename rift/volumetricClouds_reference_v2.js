// Compatibility entry point retained because main_game.js already imports this
// module. The live cloud implementation now layers the stable Nubis v3 renderer
// with ocean-reference v5: higher mobile raymarch quality, larger separated
// cumulus, reduced stratiform envelope influence, stronger domain warping, and
// stabilized temporal macro motion.
export {
  createVolumetricClouds,
  updateVolumetricClouds,
  disposeVolumetricClouds,
} from "./volumetricClouds_reference_ocean_v5.js";
