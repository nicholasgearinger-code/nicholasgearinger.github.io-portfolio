// Rift Islands mobile performance governor — Environment Performance 1.1.
//
// Target: keep the complete Low visual feature set present while aggressively
// protecting a ~30 FPS frame budget on touch/mobile devices. The two largest safe
// levers here are pixel count and shadow refresh frequency: neither removes an
// effect, and both can be changed without touching the fragile WebGPU render graph.
// Every DPR change is routed through Rift's existing resize function so composer,
// underwater, FXAA and other targets stay synchronized. Use ?perfLegacy=1 to
// bypass this preview behavior.

const params = typeof location !== "undefined"
  ? new URLSearchParams(location.search)
  : null;

const PERF_LEGACY = params?.has("perfLegacy") === true;
const IS_TOUCH = typeof window !== "undefined"
  && ("ontouchstart" in window || (typeof navigator !== "undefined" && (navigator.maxTouchPoints || 0) > 0));

let resizeHandler = null;

const state = {
  enabled: IS_TOUCH && !PERF_LEGACY,
  ratio: null,
  frameMs: 33.3,
  slowSeconds: 0,
  fastSeconds: 0,
  cooldown: 0,
  changes: 0,
  tier: "native",
  fixedResolution: false,
  targetFps: 30,
};

const shadowState = {
  installed: false,
  frame: 0,
  sunUpdates: 0,
  moonUpdates: 0,
  sunWasActive: false,
  moonWasActive: false,
  sunInterval: 1,
  moonInterval: 1,
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(v) || 0));
}

function caps(settings) {
  const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
  const settingsCap = Number(settings?.pixelRatioCap) || dpr;
  const nativeCap = Math.max(0.4, Math.min(dpr, settingsCap));

  if (!state.enabled) return { min: nativeCap, max: nativeCap, initial: nativeCap };

  // v1.0 bottomed out at 0.55 and the test phone still sat near 15 FPS. Low is
  // explicitly the performance tier, so v1.1 starts closer to the target and can
  // fall to 0.42. At 0.42 versus 0.55 the full-screen pixel workload is only
  // ~58%, while temporal clouds / browser scaling hide much of the sharpness loss.
  const max = Math.min(nativeCap, 0.82);
  const min = Math.min(max, 0.42);
  const initial = clamp(Math.min(max, 0.62), min, max);
  return { min, max, initial };
}

function publish() {
  globalThis.__riftPerformanceGovernor = {
    enabled: state.enabled,
    legacy: PERF_LEGACY,
    touch: IS_TOUCH,
    pixelRatio: state.ratio,
    frameMs: state.frameMs,
    estimatedFps: state.frameMs > 0 ? 1000 / state.frameMs : 0,
    targetFps: state.targetFps,
    changes: state.changes,
    tier: state.tier,
    fixedResolution: state.fixedResolution,
    shadows: {
      installed: shadowState.installed,
      sunInterval: shadowState.sunInterval,
      moonInterval: shadowState.moonInterval,
      sunUpdates: shadowState.sunUpdates,
      moonUpdates: shadowState.moonUpdates,
    },
  };
}

function applyRatio(renderer) {
  publish();
  if (typeof resizeHandler === "function") {
    resizeHandler();
  } else if (renderer?.setPixelRatio) {
    renderer.setPixelRatio(state.ratio);
  }
}

export function setRiftPerformanceResizeHandler(handler) {
  resizeHandler = typeof handler === "function" ? handler : null;
}

export function getRiftInitialPixelRatio(settings) {
  const c = caps(settings);
  state.ratio = c.initial;
  state.tier = state.enabled ? "adaptive-mobile-medium" : "native";
  publish();
  return state.ratio;
}

export function updateRiftPerformanceGovernor(renderer, dt, viewport, settings, fixedResolution = null) {
  if (!renderer) return;

  const c = caps(settings);
  if (state.ratio == null) state.ratio = c.initial;

  // Respect an explicit resolution override. Adaptive DPR resumes automatically
  // when that fixed mode is cleared.
  state.fixedResolution = !!fixedResolution;
  if (state.fixedResolution) {
    state.tier = "fixed-resolution";
    state.slowSeconds = 0;
    state.fastSeconds = 0;
    publish();
    return;
  }

  if (!state.enabled) {
    const expected = c.max;
    state.ratio = expected;
    state.tier = "native";
    const actual = Number(renderer.getPixelRatio?.());
    if (Number.isFinite(actual) && Math.abs(actual - expected) > 0.001) applyRatio(renderer);
    else publish();
    return;
  }

  const seconds = clamp(dt, 0, 0.1);
  if (seconds <= 0) return;

  const frameMs = seconds * 1000;
  if (frameMs < 100) state.frameMs += (frameMs - state.frameMs) * 0.07;

  state.cooldown = Math.max(0, state.cooldown - seconds);

  // 30 FPS = 33.3 ms. Drop quality quickly once the smoothed frame budget is
  // clearly missed, but require sustained headroom before restoring resolution.
  if (state.frameMs > 35.0) {
    state.slowSeconds += seconds;
    state.fastSeconds = Math.max(0, state.fastSeconds - seconds * 2.5);
  } else if (state.frameMs < 29.5) {
    state.fastSeconds += seconds;
    state.slowSeconds = Math.max(0, state.slowSeconds - seconds * 2);
  } else {
    state.slowSeconds = Math.max(0, state.slowSeconds - seconds);
    state.fastSeconds = Math.max(0, state.fastSeconds - seconds);
  }

  let next = state.ratio;
  if (state.cooldown <= 0 && state.slowSeconds > 0.55 && state.ratio > c.min + 0.001) {
    next = Math.max(c.min, state.ratio - 0.07);
    state.slowSeconds = 0;
    state.fastSeconds = 0;
    state.cooldown = 1.15;
  } else if (state.cooldown <= 0 && state.fastSeconds > 6.0 && state.ratio < c.max - 0.001) {
    next = Math.min(c.max, state.ratio + 0.025);
    state.slowSeconds = 0;
    state.fastSeconds = 0;
    state.cooldown = 4.0;
  }

  let needsResize = false;
  if (Math.abs(next - state.ratio) > 0.001) {
    state.ratio = Number(next.toFixed(3));
    state.changes++;
    needsResize = true;
  } else {
    const actual = Number(renderer.getPixelRatio?.());
    needsResize = Number.isFinite(actual) && Math.abs(actual - state.ratio) > 0.001;
  }

  state.tier = state.ratio <= 0.50
    ? "adaptive-mobile-low"
    : state.ratio <= 0.66
      ? "adaptive-mobile-medium"
      : "adaptive-mobile-high";

  if (needsResize) applyRatio(renderer);
  else publish();
}

function configureShadow(shadow) {
  if (!shadow) return;
  shadow.autoUpdate = false;
  shadow.needsUpdate = true;
}

export function updateRiftShadowPerformance(sun, moonLight) {
  if (!state.enabled) return;

  if (!shadowState.installed) {
    configureShadow(sun?.shadow);
    configureShadow(moonLight?.shadow);
    shadowState.installed = true;
  }

  shadowState.frame++;

  // Keep both shadow effects enabled but amortize their map renders. At 30 FPS,
  // 3-frame Sun updates are ~10 Hz and are visually acceptable with the existing
  // soft PCF shadow radius; moon shadows can update even less often because the
  // source is much dimmer and moves slowly.
  const low = state.tier === "adaptive-mobile-low";
  const medium = state.tier === "adaptive-mobile-medium";
  shadowState.sunInterval = low ? 3 : medium ? 2 : 2;
  shadowState.moonInterval = low ? 6 : medium ? 5 : 4;

  const sunActive = Number(sun?.intensity) > 0.01 && sun?.castShadow !== false;
  const moonActive = Number(moonLight?.intensity) > 0.004 && moonLight?.castShadow !== false;

  if (sun?.shadow && sunActive && (!shadowState.sunWasActive || shadowState.frame % shadowState.sunInterval === 0)) {
    sun.shadow.needsUpdate = true;
    shadowState.sunUpdates++;
  }

  if (moonLight?.shadow && moonActive && (!shadowState.moonWasActive || shadowState.frame % shadowState.moonInterval === 0)) {
    moonLight.shadow.needsUpdate = true;
    shadowState.moonUpdates++;
  }

  shadowState.sunWasActive = sunActive;
  shadowState.moonWasActive = moonActive;
  publish();
}

export function getRiftPerformanceState() {
  return { ...state, shadows: { ...shadowState } };
}
