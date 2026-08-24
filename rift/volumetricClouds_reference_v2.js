// Compatibility entry point retained because main_game.js already imports this
// module. The live cloud implementation is Nubis v3: Nubis v2's dual evolving
// envelopes, smoothed macro field, independently advected Perlin-Worley mass,
// detail erosion, domain warp and convective shear, plus a mobile stability pass
// that removes frame-wide ray-jitter shimmer while preserving real cloud motion.
export {
  createVolumetricClouds,
  updateVolumetricClouds,
  disposeVolumetricClouds,
} from "./volumetricClouds_nubis_v3.js";
