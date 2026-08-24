// Compatibility entry point retained because main_game.js imports this module.
// Three.js r185.1 migration branch: route the live game through the second r185
// cloud pass. V2 replaces the old visible Nubis density equation with clustered
// macro placement, normalized local-height shaping, 3D Worley-carved cloud tops,
// edge-only erosion, stable ray-step dithering, and five-tap low-res recovery.
export {
  createVolumetricClouds,
  updateVolumetricClouds,
  disposeVolumetricClouds,
} from "./volumetricClouds_r185_v2.js";
