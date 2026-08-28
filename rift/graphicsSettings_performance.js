// Environment Performance 1.1 graphics wrapper.
// Keeps all effects selected by the user, but reduces the cost of the Low mobile
// shadow path. Use ?perfLegacy=1 to bypass the performance preview entirely.

import * as base from "./graphicsSettings.js";
export * from "./graphicsSettings.js";

const params = typeof location !== "undefined"
  ? new URLSearchParams(location.search)
  : null;
const PERF_LEGACY = params?.has("perfLegacy") === true;
const IS_TOUCH = typeof window !== "undefined"
  && ("ontouchstart" in window || (typeof navigator !== "undefined" && (navigator.maxTouchPoints || 0) > 0));

function activeLowMobile() {
  return IS_TOUCH && !PERF_LEGACY && base.getGraphicsTier?.() === "low";
}

export function getGraphicsSettings() {
  const settings = base.getGraphicsSettings();
  if (!activeLowMobile()) return settings;

  // The production r185 wrapper intentionally promoted Low shadows from 256² to
  // 512². For the 30 FPS mobile target we keep shadows ON but return them to the
  // original Low 256² budget. The player-following shadow camera preserves useful
  // local contact detail despite the smaller map.
  const tuned = {
    ...settings,
    shadowMapSize: settings.shadowsEnabled === false
      ? settings.shadowMapSize
      : Math.min(Number(settings.shadowMapSize) || 256, 256),
  };

  globalThis.__riftPerformanceGraphics = {
    version: "1.1-30fps-preview",
    tier: "low",
    shadowsEnabled: tuned.shadowsEnabled !== false,
    shadowMapSize: tuned.shadowMapSize,
    volumetricCloudsEnabled: tuned.volumetricCloudsEnabled !== false,
    oceanEffectsEnabled: tuned.oceanEffectsEnabled !== false,
  };

  return tuned;
}

export function getEffectiveValue(key) {
  return base.getEffectiveValue(key);
}
