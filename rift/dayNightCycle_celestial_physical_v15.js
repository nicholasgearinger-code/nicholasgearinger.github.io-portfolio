import * as base from "./dayNightCycle_celestial_physical_v14.js";

export * from "./dayNightCycle_celestial_physical_v14.js";

// Celestial v15 — iOS/WebGPU stability hotfix.
//
// v14 added a tiny hidden sprite whose onBeforeRender callback moved the flare
// sprites while WebGPU was already encoding the frame. That is unnecessary and
// is the only new render-pass-time mutation introduced by the celestial upgrade.
// On touch devices, remove that capture sprite entirely. This preserves v14's
// east->west Sun/Moon motion, phase-consistent lunar ephemeris, moon phases,
// atmospheric lighting and god-ray state while taking the risky flare hook out
// of the iOS render path. Desktop keeps the v14 flare path for comparison.

const isTouch = typeof window !== "undefined" && (
  "ontouchstart" in window ||
  (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
);

function applyMobileStabilityGuard(cycle) {
  if (!isTouch || !cycle || cycle.__riftCelestialV15Guarded) return cycle;

  const state = cycle.__riftLensOpticsV14;
  const capture = state?.capture;
  if (capture) {
    capture.onBeforeRender = null;
    if (capture.parent) capture.parent.remove(capture);
    capture.material?.dispose?.();
    state.capture = null;
  }

  // Keep the flare group allocated but fully dormant on mobile. This avoids a
  // shader/resource churn change at startup and gives us a clean A/B test: if
  // the CommandEncoder error disappears, the v14 render-time optical hook was
  // the regression. We can then reintroduce mobile lens flares pre-render.
  if (state?.elements) {
    for (const element of state.elements) {
      if (element?.sprite?.material) element.sprite.material.opacity = 0;
      if (element?.sprite) element.sprite.visible = false;
    }
  }
  if (state?.group) state.group.visible = false;
  if (state?.publicState) {
    state.publicState.flareStrength = 0;
    state.publicState.flareVisible = false;
    state.publicState.mobileGuard = true;
  }

  cycle.__riftCelestialV15Guarded = true;
  globalThis.__riftCelestialV15 = {
    active: true,
    touchGuard: true,
    reason: "disable render-time flare hook on iOS/WebGPU",
  };
  return cycle;
}

export function createDayNightCycle(...args) {
  return applyMobileStabilityGuard(base.createDayNightCycle(...args));
}

export function updateDayNightCycle(cycle, dt, ...rest) {
  const result = base.updateDayNightCycle(cycle, dt, ...rest);
  applyMobileStabilityGuard(cycle);
  return result;
}
