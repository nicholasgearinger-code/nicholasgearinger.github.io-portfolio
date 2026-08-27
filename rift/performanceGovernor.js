// Rift Islands mobile performance governor.
//
// Keeps desktop behavior unchanged. On touch/mobile devices it dynamically
// adjusts renderer pixel ratio with a slow hysteresis loop so expensive render
// targets are not constantly reallocated. Use ?perfLegacy=1 to disable.

const params = typeof location !== "undefined"
  ? new URLSearchParams(location.search)
  : null;

const PERF_LEGACY = params?.has("perfLegacy") === true;
const IS_TOUCH = typeof window !== "undefined"
  && ("ontouchstart" in window || (navigator?.maxTouchPoints || 0) > 0);

const state = {
  enabled: IS_TOUCH && !PERF_LEGACY,
  ratio: null,
  frameMs: 33.3,
  slowSeconds: 0,
  fastSeconds: 0,
  cooldown: 0,
  changes: 0,
  tier: "native",
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(v) || 0));
}

function caps(settings) {
  const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
  const settingsCap = Number(settings?.pixelRatioCap) || dpr;
  const nativeCap = Math.max(0.5, Math.min(dpr, settingsCap));

  if (!state.enabled) return { min: nativeCap, max: nativeCap, initial: nativeCap };

  // At the current 11–20 FPS mobile load, starting below 1.0 immediately cuts
  // fragment/post cost while leaving enough resolution for TAAU/cloud softness.
  const max = Math.min(nativeCap, 1.0);
  const min = Math.min(max, 0.55);
  const initial = clamp(Math.min(max, 0.82), min, max);
  return { min, max, initial };
}

export function getRiftInitialPixelRatio(settings) {
  const c = caps(settings);
  state.ratio = c.initial;
  state.tier = state.enabled ? "adaptive-mobile" : "native";
  publish();
  return state.ratio;
}

function publish() {
  globalThis.__riftPerformanceGovernor = {
    enabled: state.enabled,
    legacy: PERF_LEGACY,
    touch: IS_TOUCH,
    pixelRatio: state.ratio,
    frameMs: state.frameMs,
    estimatedFps: state.frameMs > 0 ? 1000 / state.frameMs : 0,
    changes: state.changes,
    tier: state.tier,
  };
}

export function updateRiftPerformanceGovernor(renderer, dt, viewport, settings) {
  if (!renderer) return;

  const c = caps(settings);
  if (state.ratio == null) state.ratio = c.initial;

  if (!state.enabled) {
    const expected = c.max;
    if (Math.abs((renderer.getPixelRatio?.() || expected) - expected) > 0.001) {
      renderer.setPixelRatio(expected);
    }
    state.ratio = expected;
    publish();
    return;
  }

  const seconds = clamp(dt, 0, 0.1);
  if (seconds <= 0) return;

  const frameMs = seconds * 1000;
  // Ignore one-off tab/resume stalls and smooth the signal heavily enough that
  // changing quality cannot oscillate frame-to-frame.
  if (frameMs < 100) state.frameMs += (frameMs - state.frameMs) * 0.055;

  state.cooldown = Math.max(0, state.cooldown - seconds);

  if (state.frameMs > 39.0) {
    state.slowSeconds += seconds;
    state.fastSeconds = Math.max(0, state.fastSeconds - seconds * 2);
  } else if (state.frameMs < 29.0) {
    state.fastSeconds += seconds;
    state.slowSeconds = Math.max(0, state.slowSeconds - seconds * 2);
  } else {
    state.slowSeconds = Math.max(0, state.slowSeconds - seconds);
    state.fastSeconds = Math.max(0, state.fastSeconds - seconds);
  }

  let next = state.ratio;
  if (state.cooldown <= 0 && state.slowSeconds > 0.85 && state.ratio > c.min + 0.001) {
    next = Math.max(c.min, state.ratio - 0.06);
    state.slowSeconds = 0;
    state.fastSeconds = 0;
    state.cooldown = 1.8;
  } else if (state.cooldown <= 0 && state.fastSeconds > 4.0 && state.ratio < c.max - 0.001) {
    next = Math.min(c.max, state.ratio + 0.03);
    state.slowSeconds = 0;
    state.fastSeconds = 0;
    state.cooldown = 3.0;
  }

  if (Math.abs(next - state.ratio) > 0.001) {
    state.ratio = Number(next.toFixed(3));
    renderer.setPixelRatio(state.ratio);
    state.changes++;
  } else {
    // A browser resize or graphics-setting transition may reset pixel ratio.
    // Re-assert the governor value without changing its state.
    const actual = Number(renderer.getPixelRatio?.());
    if (Number.isFinite(actual) && Math.abs(actual - state.ratio) > 0.001) {
      renderer.setPixelRatio(state.ratio);
    }
  }

  state.tier = state.ratio <= 0.61
    ? "adaptive-mobile-low"
    : state.ratio <= 0.73
      ? "adaptive-mobile-medium"
      : "adaptive-mobile-high";
  publish();
}

export function getRiftPerformanceState() {
  return { ...state };
}
