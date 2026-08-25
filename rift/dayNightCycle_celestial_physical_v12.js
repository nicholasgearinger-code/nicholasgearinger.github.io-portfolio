import * as THREE from "three";
import * as base from "./dayNightCycle_celestial_physical_v9.js";
import { getGraphicsTier } from "./graphicsSettings.js";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";

export * from "./dayNightCycle_celestial_physical_v9.js";

// Rift Lighting 2.0 — official r185 WebGPU cascaded Sun shadows.
//
// This deliberately avoids the custom light-space shadow-camera manipulation that
// produced Invalid CommandEncoder errors on iPhone. CSMShadowNode owns cascade
// fitting/stabilization internally and is the same implementation used by the
// official Three.js WebGPU CSM example.

const stateByCycle = new WeakMap();

function profileForTier(tier) {
  if (tier === "low") {
    return {
      cascades: 2,
      maxFar: 82,
      lightMargin: 42,
      mapSize: 512,
      near: 0.5,
      far: 230,
      bias: -0.00018,
      normalBias: 0.014,
      radius: 1.35,
      fade: false,
    };
  }
  if (tier === "medium") {
    return {
      cascades: 3,
      maxFar: 145,
      lightMargin: 62,
      mapSize: 768,
      near: 0.5,
      far: 310,
      bias: -0.00015,
      normalBias: 0.012,
      radius: 1.5,
      fade: true,
    };
  }
  return {
    cascades: 3,
    maxFar: 230,
    lightMargin: 88,
    mapSize: 1024,
    near: 0.35,
    far: 430,
    bias: -0.00012,
    normalBias: 0.010,
    radius: 1.75,
    fade: true,
  };
}

function configureLighting2(cycle, sun, ambient, moonLight) {
  if (!cycle || !sun?.shadow) return;

  const tier = getGraphicsTier?.() || "medium";
  const profile = profileForTier(tier);

  sun.castShadow = true;
  // Keep the expensive second celestial shadow pass out of the experimental
  // mobile stack. The Moon still supplies normal directional illumination.
  if (moonLight) moonLight.castShadow = tier === "high";

  sun.shadow.mapSize.set(profile.mapSize, profile.mapSize);
  sun.shadow.camera.near = profile.near;
  sun.shadow.camera.far = profile.far;
  sun.shadow.bias = profile.bias;
  sun.shadow.normalBias = profile.normalBias;
  sun.shadow.radius = profile.radius;
  sun.shadow.autoUpdate = true;
  sun.shadow.needsUpdate = true;

  const csm = new CSMShadowNode(sun, {
    cascades: profile.cascades,
    maxFar: profile.maxFar,
    mode: "practical",
    lightMargin: profile.lightMargin,
  });
  csm.fade = profile.fade;
  sun.shadow.shadowNode = csm;

  const state = { tier, profile, csm, sun, ambient, moonLight };
  stateByCycle.set(cycle, state);

  globalThis.__riftLighting2CSM = {
    active: true,
    tier,
    cascades: profile.cascades,
    maxFar: profile.maxFar,
    mapSize: profile.mapSize,
    fade: profile.fade,
    threeRevision: THREE.REVISION,
  };
}

function updateCloudDaylightBridge(cycle) {
  const state = stateByCycle.get(cycle);
  if (!state) return;

  const shadowState = globalThis.__riftCloudShadowState;
  const cloudT = THREE.MathUtils.clamp(
    Number(shadowState?.averageTransmittance ?? 1),
    0,
    1,
  );

  // Broad cloud cover should reduce direct sunlight but preserve diffuse sky fill.
  // The spatial 128x128 cloud texture remains exposed for terrain/ocean consumers;
  // this bridge only handles the globally averaged energy balance.
  if (state.sun && Number.isFinite(state.sun.intensity)) {
    state.sun.intensity *= THREE.MathUtils.lerp(0.74, 1.0, Math.sqrt(cloudT));
  }
  if (state.ambient && Number.isFinite(state.ambient.intensity)) {
    state.ambient.intensity *= THREE.MathUtils.lerp(1.07, 1.0, cloudT);
  }

  if (globalThis.__riftLighting2CSM) {
    globalThis.__riftLighting2CSM.cloudTransmittance = cloudT;
    globalThis.__riftLighting2CSM.cloudShadowTexture = shadowState?.texture ?? null;
  }
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  const cycle = base.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight);
  configureLighting2(cycle, sun, ambient, moonLight);
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = base.updateDayNightCycle(cycle, dt);
  updateCloudDaylightBridge(cycle);
  return result;
}
