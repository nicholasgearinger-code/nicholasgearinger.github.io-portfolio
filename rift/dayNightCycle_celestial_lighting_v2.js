import * as THREE from "three";
import * as base from "./dayNightCycle_celestial_physical_v9.js";
import { getGraphicsTier } from "./graphicsSettings.js";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";

export * from "./dayNightCycle_celestial_physical_v9.js";

// Rift Lighting 2.0 — native WebGPU CSM sun shadows.
//
// Important: this deliberately stops using the hand-rolled player-following
// orthographic shadow projection on the experimental branch. CSMShadowNode owns
// the cascade projection and performs its own light-space texel stabilization.
// The known-good migration branch remains untouched while this is validated.

const stateByCycle = new WeakMap();

function configureCSM(cycle, sun, moonLight) {
  if (!cycle || !sun?.shadow) return;

  const tier = getGraphicsTier?.() || "medium";
  const low = tier === "low";
  const medium = tier === "medium";

  sun.castShadow = true;
  if (moonLight) moonLight.castShadow = !low && !medium;

  const mapSize = low ? 512 : medium ? 768 : 1024;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = low ? 180 : medium ? 260 : 360;
  sun.shadow.bias = low ? -0.00020 : -0.00014;
  sun.shadow.normalBias = low ? 0.014 : 0.010;
  sun.shadow.radius = low ? 1.35 : medium ? 1.6 : 1.9;
  sun.shadow.autoUpdate = true;
  sun.shadow.needsUpdate = true;

  const cascades = low ? 2 : medium ? 3 : 3;
  const maxFar = low ? 85 : medium ? 150 : 240;
  const lightMargin = low ? 45 : medium ? 70 : 100;
  const csm = new CSMShadowNode(sun, {
    cascades,
    maxFar,
    mode: "practical",
    lightMargin,
  });
  csm.fade = true;

  // WebGPURenderer's AnalyticLightNode checks this property and uses the custom
  // shadow node instead of constructing the regular single ShadowNode.
  sun.shadow.shadowNode = csm;

  const state = { tier, low, medium, sun, moonLight, csm, mapSize, cascades, maxFar };
  stateByCycle.set(cycle, state);

  globalThis.__riftLighting2Shadows = {
    active: true,
    implementation: "CSMShadowNode",
    tier,
    cascades,
    mapSize,
    maxFar,
    fade: true,
    moonShadowEnabled: !!moonLight?.castShadow,
    revision: THREE.REVISION,
  };
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  const cycle = base.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight);
  configureCSM(cycle, sun, moonLight);
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = base.updateDayNightCycle(cycle, dt);
  const state = stateByCycle.get(cycle);
  if (state && globalThis.__riftLighting2Shadows) {
    globalThis.__riftLighting2Shadows.sunIntensity = Number(state.sun?.intensity) || 0;
    globalThis.__riftLighting2Shadows.sunDirection = state.sun?.position
      ? [state.sun.position.x, state.sun.position.y, state.sun.position.z]
      : null;
  }
  return result;
}
