// FFT-safe graphics settings wrapper.
//
// Coral Shallows now uses the GPU FFT ocean. That water path gets its visible
// reflections from MeshPhysicalNodeMaterial + scene.environment and does NOT
// sample the old planar reflection/refraction render targets. The legacy
// render loop still keys those two extra full-scene captures off
// `reflectionEnabled`, though, so when FFT water is active we report that
// legacy capture path as disabled while preserving the user's actual toggle in
// the base settings module. liquid.js reads the base toggle directly and maps
// it to the FFT material's envMapIntensity instead.

import * as base from "./graphicsSettings_fft_base.js";
export * from "./graphicsSettings_fft_base.js";

function fftOwnsWaterReflections() {
  return typeof globalThis !== "undefined" &&
    globalThis.__riftFFTUsesEnvironmentReflections === true;
}

export function getGraphicsSettings() {
  const settings = base.getGraphicsSettings();
  if (!fftOwnsWaterReflections()) return settings;

  // The user's real reflection preference remains untouched in the base
  // module. Only the obsolete planar capture pass sees this forced-off value.
  if (settings.reflectionEnabled === false) return settings;
  return { ...settings, reflectionEnabled: false };
}
