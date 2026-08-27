import * as THREE from "three";
import * as base from "./vegetation.js";

export * from "./vegetation.js";

// Mobile optimization layer for the existing InstancedMesh vegetation.
// The base renderer already batches grass into one InstancedMesh, which is good;
// the expensive part was rewriting/uploading every instance matrix every frame.
// On high-count mobile grass fields we animate once, then keep transforms static
// while preserving the inexpensive day/night material response. Smaller kelp and
// sparse biome grass keep the original sway.

const params = typeof location !== "undefined"
  ? new URLSearchParams(location.search)
  : null;
const PERF_LEGACY = params?.has("perfLegacy") === true;
const IS_TOUCH = typeof window !== "undefined"
  && ("ontouchstart" in window || (navigator?.maxTouchPoints || 0) > 0);
const STATIC_INSTANCE_THRESHOLD = 5000;
const NIGHT_TINT = new THREE.Color(0x7050e8);

function shouldFreeze(handle) {
  return IS_TOUCH
    && !PERF_LEGACY
    && (Number(handle?.count) || 0) >= STATIC_INSTANCE_THRESHOLD;
}

function updateNightMaterial(handle, dayAmount) {
  const material = handle?.material;
  if (!material) return;
  const nightAmount = Math.max(0, Math.min(1, 1 - dayAmount / 0.3));
  material.color.setRGB(1, 1, 1).lerp(NIGHT_TINT, nightAmount * 0.7);
  material.emissive.setHex(0x5a30d0);
  material.emissiveIntensity = nightAmount * 0.9;
}

export function updateGrass(handle, elapsed, windX = 0, windZ = 0, dayAmount = 1) {
  if (!handle) return;

  if (!shouldFreeze(handle)) {
    base.updateGrass(handle, elapsed, windX, windZ, dayAmount);
    return;
  }

  if (!handle.__riftStaticGrassInitialized) {
    // One normal update preserves the natural per-blade lean. After this frame,
    // no more setMatrixAt() loop or instanceMatrix upload is performed on mobile.
    base.updateGrass(handle, elapsed, windX, windZ, dayAmount);
    handle.mesh?.computeBoundingSphere?.();
    handle.__riftStaticGrassInitialized = true;
    globalThis.__riftVegetationPerformance = {
      mode: "static-high-count-instanced-grass",
      frozenInstances: Number(handle.count) || 0,
      threshold: STATIC_INSTANCE_THRESHOLD,
    };
    return;
  }

  updateNightMaterial(handle, dayAmount);
}

export function createGrass(...args) {
  return base.createGrass(...args);
}

export function disposeGrass(...args) {
  return base.disposeGrass(...args);
}

export function createFlowers(...args) {
  return base.createFlowers(...args);
}

export function updateFlowers(...args) {
  return base.updateFlowers(...args);
}

export function disposeFlowers(...args) {
  return base.disposeFlowers(...args);
}

export function createFootstepGlowSystem(...args) {
  return base.createFootstepGlowSystem(...args);
}

export function spawnFootstepGlow(...args) {
  return base.spawnFootstepGlow(...args);
}

export function updateFootstepGlowSystem(...args) {
  return base.updateFootstepGlowSystem(...args);
}

export function disposeFootstepGlowSystem(...args) {
  return base.disposeFootstepGlowSystem(...args);
}
