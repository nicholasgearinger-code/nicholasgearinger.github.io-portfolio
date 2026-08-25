import * as THREE from "three";
import * as base from "./dayNightCycle_celestial_physical_v9.js";
import { getGraphicsTier } from "./graphicsSettings.js";

export * from "./dayNightCycle_celestial_physical_v9.js";

// -----------------------------------------------------------------------------
// Celestial v10 — r185 mobile directional-shadow budget.
//
// Low no longer disables shadows. Instead it keeps a single player-following Sun
// shadow map, disables the second Moon shadow pass, uses r185-friendly small bias
// values, and refreshes the map every other rendered frame. The preserved game
// already recenters/snaps the directional-light shadow camera around the player;
// this layer makes that existing architecture affordable enough for Mobile Low.
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

    // r185 improved WebGPU shadow precision. The old r182-era -0.0015 / 0.05
    // offsets were large enough to detach thin tree/rock shadows. Use values in
    // the much smaller range recommended for the newer renderer.
    sun.shadow.bias = -0.00028;
    sun.shadow.normalBias = 0.018;
    sun.shadow.radius = 2;

    // Reuse a shadow map for one frame between refreshes. The game's existing
    // texel-snapped, player-following shadow camera makes this far less visible
    // than updating an unsnapped map at half rate.
    sun.shadow.autoUpdate = false;
    sun.shadow.needsUpdate = true;
  }

  const state = {
    tier,
    low,
    frame: 0,
    sun,
    moonLight,
    refreshInterval: low ? 2 : 1,
  };
  shadowStateByCycle.set(cycle, state);

  globalThis.__riftShadowSystemV10 = {
    active: true,
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

  // Don't burn a shadow pass after sunset when this tier intentionally has no
  // Moon shadow map. When the Sun becomes visible again, force an immediate
  // refresh, then settle back to the every-other-frame cadence.
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
