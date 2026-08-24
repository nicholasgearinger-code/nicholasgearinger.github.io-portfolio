// Compatibility entry point retained because main_game.js imports this module.
// The live implementation now routes through the progressive low-resolution
// cloud renderer: shell-like macro envelopes, higher ray quality, stable shape
// evolution, and a quarter-resolution mobile cloud pass upscaled in screen space.
export {
  createVolumetricClouds,
  updateVolumetricClouds,
  disposeVolumetricClouds,
} from "./volumetricClouds_progressive_v1.js";
