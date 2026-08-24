// Compatibility entry point retained because main_game.js imports this module.
// Three.js r185.1 migration branch: use the stability-first clustered cloud pass.
// The experimental r185 v2 density shader is intentionally kept in the branch
// for isolated debugging, but it is no longer on the live iPhone test path after
// Safari reported an opaque runtime "Script error." while it was active.
export {
  createVolumetricClouds,
  updateVolumetricClouds,
  disposeVolumetricClouds,
} from "./volumetricClouds_r185_v15.js";
