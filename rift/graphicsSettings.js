// FFT-safe graphics settings wrapper.
//
// Coral Shallows uses the GPU FFT ocean. That path gets visible reflections from
// its PBR/environment lighting and does not need the legacy planar capture pass.
// The r185 build also promotes two effects that now have mobile-specific paths:
// adaptive volumetric clouds and a tightly-budgeted directional Sun shadow.

import * as base from "./graphicsSettings_fft_base.js";
export * from "./graphicsSettings_fft_base.js";

const OVERRIDES_STORAGE_KEY = "riftGraphicsOverrides";

function fftOwnsWaterReflections() {
  return typeof globalThis !== "undefined" &&
    globalThis.__riftFFTUsesEnvironmentReflections === true;
}

function hasExplicitOverride(key) {
  try {
    const raw = localStorage.getItem(OVERRIDES_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed && Object.prototype.hasOwnProperty.call(parsed, key);
  } catch (_) {
    return false;
  }
}

function isLowTier() {
  return base.getGraphicsTier?.() === "low";
}

function lowGetsAdaptiveClouds() {
  return isLowTier() && !hasExplicitOverride("volumetricCloudsEnabled");
}

function lowGetsEfficientShadows() {
  return isLowTier() && !hasExplicitOverride("shadowsEnabled");
}

export function getGraphicsSettings() {
  let settings = base.getGraphicsSettings();

  // Low used to disable both of these outright. Under the r185 migration they
  // each have a dedicated mobile budget, so they are part of the visual baseline
  // unless the player explicitly turns the effect off.
  if (lowGetsAdaptiveClouds() && settings.volumetricCloudsEnabled === false) {
    settings = { ...settings, volumetricCloudsEnabled: true };
  }

  if (lowGetsEfficientShadows() && settings.shadowsEnabled === false) {
    settings = { ...settings, shadowsEnabled: true };
  }

  // A 512² map is still tiny beside Medium/High, but combined with the existing
  // player-following directional shadow camera it is enough for readable tree,
  // rock and terrain contact shadows on a phone screen.
  if (isLowTier() && settings.shadowsEnabled !== false && settings.shadowMapSize < 512) {
    settings = { ...settings, shadowMapSize: 512 };
  }

  if (!fftOwnsWaterReflections()) return settings;

  // The user's real reflection preference remains untouched in the base module.
  // Only the obsolete planar capture path sees this forced-off value.
  if (settings.reflectionEnabled === false) return settings;
  return { ...settings, reflectionEnabled: false };
}

export function getEffectiveValue(key) {
  if (key === "volumetricCloudsEnabled" && lowGetsAdaptiveClouds()) return true;
  if (key === "shadowsEnabled" && lowGetsEfficientShadows()) return true;
  return base.getEffectiveValue(key);
}
