import * as THREE from "three";

// Keep any less-common historical exports available to archived/tuned runtime
// snapshots, but explicitly replace the live cloud-layer API below. The stable
// game loop still calls createClouds/createCloudLayer/createRealisticCloudDome;
// returning inert compatibility handles lets us remove all three visual stacks
// without rewriting the giant preserved runtime source. Visible clouds now come
// exclusively from proceduralClouds.js via volumetricClouds.js.
import { getGraphicsTier } from "./graphicsSettings.js";
import {
  createRealisticCloudDome as createLiteDome,
  updateRealisticCloudDome as updateLiteDome,
  disposeRealisticCloudDome as disposeLiteDome,
} from "./clouds_storm_base.js";
export * from "./clouds_storm_base.js";

const useMobileLowCloudDome = () =>
  typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod/i.test(navigator.userAgent || "") &&
  getGraphicsTier() === "low";

function makePlaceholder(kind) {
  const mesh = new THREE.Object3D();
  mesh.name = `rift-${kind}-procedural-placeholder`;
  mesh.visible = false;
  return {
    kind,
    mesh,
    group: mesh,
    __riftProceduralPlaceholder: true,
  };
}

export function createClouds(_scene, _biome) {
  return makePlaceholder("clouds");
}

export function updateClouds(_handle, _dt, _wind, _dayAmount, _stormAmount, _skyHorizon, _sunPos, _cameraPos) {
  // Intentionally empty. Wind/weather are consumed by proceduralClouds.js.
}

export function disposeClouds(_scene, _handle) {
  // Placeholder owns no GPU resources.
}

export function createCloudLayer(_scene) {
  return makePlaceholder("cloud-layer");
}

export function updateCloudLayer(_handle, _dt, _wind, _dayAmount, _skyHorizon) {
  // Intentionally empty. The former 2D sheet is replaced by real volume density.
}

export function disposeCloudLayer(_scene, _handle) {
  // Placeholder owns no GPU resources.
}

export function createRealisticCloudDome(_scene) {
  if (useMobileLowCloudDome()) return createLiteDome(_scene);
  // main_game_rain_base.js toggles `.mesh.visible` while submerged, so preserve
  // that shape even though the old panorama dome is no longer drawn.
  return makePlaceholder("cloud-dome");
}

export function updateRealisticCloudDome(
  _handle,
  _dt,
  _dayAmount,
  _skyHorizonColor,
  _skyZenithColor,
  _stormAmount = 0,
  _phaseT = 0,
) {
  if (_handle && !_handle.__riftProceduralPlaceholder) {
    // Throttle cosmetic cloud updates to 15 Hz on iOS Low. The dome
    // remains rendered normally between updates; only UV drift/color
    // adjustments are reduced. Pass accumulated dt to keep wind speed.
    _handle.__riftCloudUpdateAccum = (_handle.__riftCloudUpdateAccum || 0) + Math.max(0, _dt);
    if (_handle.__riftCloudUpdateAccum < 1 / 15) return;
    const cloudDt = Math.min(_handle.__riftCloudUpdateAccum, 0.25);
    _handle.__riftCloudUpdateAccum = 0;
    updateLiteDome(_handle, cloudDt, _dayAmount, _skyHorizonColor, _skyZenithColor, _stormAmount, _phaseT);
  }
}

export function disposeRealisticCloudDome(_scene, _handle) {
  if (_handle && !_handle.__riftProceduralPlaceholder) disposeLiteDome(_scene, _handle);
}

export function getCloudOcclusionFactor(_handle, _cameraPosition, _lightPosition) {
  // The existing world loop expects this function to return BLOCKED light
  // (0=clear, 1=fully blocked), then computes `1 - result` for transmission.
  // proceduralClouds.js updates the same value from its large-scale weather map,
  // so sun/moon visibility, world sunlight, water glint and underwater caustics
  // all react to the exact weather field driving visible cloud coverage.
  const value = Number(globalThis.__riftProceduralCloudOcclusion);
  return Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 0.92) : 0;
}
