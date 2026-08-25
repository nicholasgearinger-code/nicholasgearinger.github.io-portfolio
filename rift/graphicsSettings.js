// FFT-safe graphics settings wrapper.
//
// Coral Shallows uses the GPU FFT ocean. That path gets visible reflections from
// its PBR/environment lighting and does not need the legacy planar capture pass.
// This wrapper also promotes the NEW adaptive procedural cloud renderer to Low:
// unlike the old 20+ step volume, proceduralClouds.js has a dedicated 8x1 mobile
// path, so touch devices can actually test/use the unified atmosphere by default.

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

function lowGetsAdaptiveClouds() {
  return base.getGraphicsTier?.() === "low" && !hasExplicitOverride("volumetricCloudsEnabled");
}

function lowGetsMobileSunShadows() {
  return base.getGraphicsTier?.() === "low" && !hasExplicitOverride("shadowsEnabled");
}

export function getGraphicsSettings() {
  let settings = base.getGraphicsSettings();

  // The old Low default disabled volumetric clouds because that renderer used a
  // fixed expensive raymarch. The replacement is explicitly tiered (8 view
  // samples + 1 lighting sample on Low), so make it part of the mobile baseline
  // unless the player has deliberately toggled Volumetric Clouds off.
  if (lowGetsAdaptiveClouds() && settings.volumetricCloudsEnabled === false) {
    settings = { ...settings, volumetricCloudsEnabled: true };
  }

  // Low used to disable the renderer's shadow map entirely. That made the mobile
  // scene read flat and also made storm/light changes much more visually abrupt.
  // Keep one inexpensive directional sun-shadow map in the Low baseline instead.
  // 512² is still only 1/4 the texel count of Medium's 1024-class map and is a
  // much better visual tradeoff than having no grounding/contact shadows at all.
  // An explicit player override still wins.
  if (lowGetsMobileSunShadows() && settings.shadowsEnabled === false) {
    settings = {
      ...settings,
      shadowsEnabled: true,
      shadowMapSize: Math.max(512, Number(settings.shadowMapSize) || 0),
    };
  }

  if (!fftOwnsWaterReflections()) return settings;

  // The user's real reflection preference remains untouched in the base module.
  // Only the obsolete planar capture path sees this forced-off value.
  if (settings.reflectionEnabled === false) return settings;
  return { ...settings, reflectionEnabled: false };
}

export function getEffectiveValue(key) {
  if (key === "volumetricCloudsEnabled" && lowGetsAdaptiveClouds()) return true;
  if (key === "shadowsEnabled" && lowGetsMobileSunShadows()) return true;
  return base.getEffectiveValue(key);
}
