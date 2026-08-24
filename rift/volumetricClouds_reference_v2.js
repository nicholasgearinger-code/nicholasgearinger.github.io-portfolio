// Compatibility entry point retained because main_game.js imports this module.
// Three.js r185.1 migration branch: keep the stable v1.7 persistent cumulus
// presentation on the live iPhone test path while the experimental v1.8
// 4x4 temporal interleaver remains isolated for debugging. The v1.8 resolver
// currently fails to seed/reconstruct visible cloud history reliably on Safari.
export {
  createVolumetricClouds,
  updateVolumetricClouds,
  disposeVolumetricClouds,
} from "./volumetricClouds_r185_v17.js";
