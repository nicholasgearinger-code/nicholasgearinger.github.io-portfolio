// Compatibility entry point retained because main_game.js already imports this
// module. The live cloud implementation is Nubis v2: dual evolving 2D cloud
// envelopes, 5-tap macro smoothing, independently advected Perlin-Worley mass
// and detail erosion, 3D domain warping, convective shear, adaptive raymarching,
// Beer-Lambert extinction and anisotropic multi-scattering lighting.
export {
  createVolumetricClouds,
  updateVolumetricClouds,
  disposeVolumetricClouds,
} from "./volumetricClouds_nubis_v2.js";
