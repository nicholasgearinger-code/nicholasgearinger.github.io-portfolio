// Compatibility entry point retained because main_game.js already imports this
// module. The live cloud implementation now follows a Nubis-style architecture:
// 2D cloud envelope + true 3D Perlin-Worley mass + 3D detail erosion + adaptive
// raymarch shading + Beer-Lambert / anisotropic multi-scattering lighting.
export {
  createVolumetricClouds,
  updateVolumetricClouds,
  disposeVolumetricClouds,
} from "./volumetricClouds_nubis_v1.js";
