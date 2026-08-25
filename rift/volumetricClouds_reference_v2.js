// Compatibility entry point retained because main_game.js imports this module.
// The live implementation routes through the progressive low-resolution cloud
// renderer plus the user's photographic summer-sky profile: broad broken
// cumulus/stratocumulus fields, soft eroded edges, blue gaps, bright diffuse
// lighting, and a lightweight wispy high-cloud component.
export {
  createVolumetricClouds,
  updateVolumetricClouds,
  disposeVolumetricClouds,
} from "./volumetricClouds_photo_reference_v1.js";
