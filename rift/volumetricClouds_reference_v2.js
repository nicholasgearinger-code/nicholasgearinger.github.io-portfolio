// Compatibility entry point retained because main_game.js imports this module.
// Three.js r185.1 migration branch: use the stability-first clustered cloud pass.
// The experimental v2 density shader is kept in the branch for debugging, but it
// is no longer on the live test path after causing a Safari/WebGPU runtime error.
export {
  createVolumetricClouds,
  updateVolumetricClouds,
  disposeVolumetricClouds,
} from "./volumetricClouds_r185_v15.js";
