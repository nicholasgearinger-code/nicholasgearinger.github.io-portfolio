// FFT-safe graphics settings wrapper.
//
// Coral Shallows uses the GPU FFT ocean. That path gets visible reflections from
// its PBR/environment lighting and does not need the legacy planar capture pass.
// The r185 build also promotes two effects that now have mobile-specific paths:
// adaptive volumetric clouds and a tightly-budgeted directional Sun shadow.

import * as base from "./graphicsSettings_fft_base.js";
export * from "./graphicsSettings_fft_base.js";

const OVERRIDES_STORAGE_KEY = "riftGraphicsOverrides";

// iPhone/WebKit performance budget for the standalone r185 game.
// Medium retains the same water renderer and shading features, but avoids
// desktop-sized raster, shadow, terrain and particle workloads on older GPUs.
// Apply only to iOS-class devices and only to Medium; desktop and Low/High
// keep their existing user-selected presets.
const RIFT_IOS = typeof navigator !== "undefined" && (
  /iPhone|iPad|iPod/i.test(navigator.userAgent || "") ||
  ((navigator.platform || "") === "MacIntel" && navigator.maxTouchPoints > 1)
);
const IOS_MEDIUM_BUDGET = Object.freeze({
  pixelRatioCap: 0.75,
  terrainSegments: 140,
  shadowMapSize: 384,
  grassMultiplier: 0.35,
  particleMultiplier: 0.3,
  cloudMultiplier: 0.65, // Lightweight existing cloud layers; heavy volumetrics remain off on iOS Medium.
  wildlifeMultiplier: 0.4,
  seaLifeMultiplier: 0.45,
  silhouetteMultiplier: 0.5,
});
function applyMobileMediumBudget(settings) {
  if (!RIFT_IOS || base.getGraphicsTier() !== "medium") return settings;
  const limited = { ...settings };
  for (const [key, ceiling] of Object.entries(IOS_MEDIUM_BUDGET)) {
    // Respect a lower user setting, but keep a safe ceiling for Medium.
    if (Number.isFinite(limited[key])) limited[key] = Math.min(limited[key], ceiling);
  }
  // Preserve ocean, terrain and local shadows, but avoid expensive
  // full-screen post effects on older iPhones. These features are
  // particularly costly at the current 10 FPS baseline.
  limited.ssaoEnabled = false;
  limited.bloomLevel = "off";
  limited.aaMethod = "off";
  limited.volumetricCloudsEnabled = false;
  return limited;
}

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
  return !RIFT_IOS && isLowTier() && !hasExplicitOverride("volumetricCloudsEnabled");
}

function lowGetsEfficientShadows() {
  return !RIFT_IOS && isLowTier() && !hasExplicitOverride("shadowsEnabled");
}

export function getGraphicsSettings() {
  let settings = applyMobileMediumBudget(base.getGraphicsSettings());

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
  if (RIFT_IOS && base.getGraphicsTier() === "medium") {
    if (key === "volumetricCloudsEnabled" || key === "ssaoEnabled") return false;
    if (key === "bloomLevel" || key === "aaMethod") return "off";
  }
  if (key === "volumetricCloudsEnabled" && lowGetsAdaptiveClouds()) return true;
  if (key === "shadowsEnabled" && lowGetsEfficientShadows()) return true;
  if (RIFT_IOS && base.getGraphicsTier() === "medium" && Object.hasOwn(IOS_MEDIUM_BUDGET, key)) {
    const value = base.getEffectiveValue(key);
    return Number.isFinite(value) ? Math.min(value, IOS_MEDIUM_BUDGET[key]) : value;
  }
  return base.getEffectiveValue(key);
}
