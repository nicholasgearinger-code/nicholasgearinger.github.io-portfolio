import * as THREE from "three";
import * as base from "./dayNightCycle_celestial_physical_v9.js";
import { getGraphicsTier } from "./graphicsSettings.js";

export * from "./dayNightCycle_celestial_physical_v9.js";

// -----------------------------------------------------------------------------
// Celestial v10 — r185 mobile directional-shadow budget.
//
// Shadow v11 experiment A/B test:
// Keep the known-good v10 camera/frustum/bias path completely unchanged, but
// refresh the single Mobile Low Sun shadow every rendered frame instead of every
// other frame. This isolates whether the visible shadow swimming is caused by
// reusing a stale map while the physical Sun direction continues to move.
// -----------------------------------------------------------------------------

const shadowStateByCycle = new WeakMap();

function configureShadowBudget(cycle, sun, moonLight) {
  if (!cycle || !sun?.shadow) return;

  const tier = getGraphicsTier?.() || "medium";
  const low = tier === "low";

  if (low) {
    // One 512² near-field directional shadow is a much better mobile trade than
    // the old binary choice of no shadows at all. Keep the Moon unshadowed on Low
    // so daytime depth does not double the shadow-pass cost at night.
    sun.castShadow = true;
    if (moonLight) moonLight.castShadow = false;

    sun.shadow.mapSize.set(512, 512);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 320;

    // Preserve the proven r185 v10 bias/filter settings exactly for this test.
    sun.shadow.bias = -0.00028;
    sun.shadow.normalBias = 0.018;
    sun.shadow.radius = 2;

    sun.shadow.autoUpdate = false;
    sun.shadow.needsUpdate = true;
  }

  const state = {
    tier,
    low,
    frame: 0,
    sun,
    moonLight,
    // EXPERIMENT ONLY: refresh every rendered frame on Low. No shadow-camera
    // transforms, map type, bias, radius, or projection settings are changed.
    refreshInterval: 1,
  };
  shadowStateByCycle.set(cycle, state);

  globalThis.__riftShadowSystemV10 = {
    active: true,
    experiment: "full-rate-refresh-only",
    tier,
    lowMobileMode: low,
    sunShadowEnabled: !!sun.castShadow,
    moonShadowEnabled: !!moonLight?.castShadow,
    mapSize: sun.shadow.mapSize.width,
    near: sun.shadow.camera.near,
    far: sun.shadow.camera.far,
    bias: sun.shadow.bias,
    normalBias: sun.shadow.normalBias,
    refreshInterval: state.refreshInterval,
    threeRevision: THREE.REVISION,
  };
}

function updateShadowBudget(cycle) {
  const state = shadowStateByCycle.get(cycle);
  if (!state?.low || !state.sun?.shadow) return;

  state.frame++;

  // Keep the existing night optimization, but while the Sun is active refresh
  // its shadow every rendered frame so the shadow map and changing solar
  // direction cannot become one frame out of phase.
  const sunActive = (Number(state.sun.intensity) || 0) > 0.015;
  const shouldRefresh = sunActive && (
    state.frame <= 2 ||
    (state.frame % state.refreshInterval) === 0
  );
  state.sun.shadow.needsUpdate = shouldRefresh;

  if (globalThis.__riftShadowSystemV10) {
    globalThis.__riftShadowSystemV10.sunIntensity = Number(state.sun.intensity) || 0;
    globalThis.__riftShadowSystemV10.needsUpdate = shouldRefresh;
    globalThis.__riftShadowSystemV10.frame = state.frame;
  }
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  const cycle = base.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight);
  configureShadowBudget(cycle, sun, moonLight);
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = base.updateDayNightCycle(cycle, dt);
  updateShadowBudget(cycle);
  return result;
}
