import * as THREE from "three";
import {
  createVolumetricClouds as createProceduralClouds,
  updateVolumetricClouds as updateProceduralClouds,
  disposeVolumetricClouds as disposeProceduralClouds,
} from "./proceduralClouds.js";

// Compatibility entry point retained because the stable Rift runtime already
// imports ./volumetricClouds.js. The implementation now lives in the unified
// procedural atmosphere module.
export function createVolumetricClouds(scene) {
  const handle = createProceduralClouds(scene);
  if (handle?.material) {
    // The cloud volume can be viewed from below, from inside the layer while
    // climbing terrain, and from glancing angles near the horizon. DoubleSide
    // avoids an iOS/WebGPU face-culling edge case that can otherwise make the
    // entire volume disappear depending on which box face launches the march.
    // forceSinglePass keeps this at one transparent draw instead of paying the
    // normal two-pass cost of a double-sided transparent material.
    handle.material.side = THREE.DoubleSide;
    handle.material.forceSinglePass = true;
    handle.material.needsUpdate = true;
  }
  return handle;
}

export function updateVolumetricClouds(
  handle,
  dt,
  camera,
  sunDirection,
  sunColor,
  ambientColor,
  lightningFlash,
  lightningColor,
  windX = 0,
  windZ = 0,
  rainIntensity = 0,
  currentBiome = "default",
) {
  updateProceduralClouds(
    handle,
    dt,
    camera,
    sunDirection,
    sunColor,
    ambientColor,
    lightningFlash,
    lightningColor,
    windX,
    windZ,
    rainIntensity,
    currentBiome,
  );

  if (!handle?.mesh?.visible || !handle?.uniforms) return;

  // The first unified-weather pass was mathematically valid but too
  // conservative in fair weather on the Low/mobile path: a sparse large-scale
  // weather mask, high 3D density threshold and strong erosion were multiplied
  // together, so many camera positions wound up with effectively zero alpha
  // across the whole visible sky. Keep the weather simulation fully dynamic,
  // but enforce a scattered-cumulus visibility floor for the renderer. Storms
  // still push all of these values well beyond the floor naturally.
  const u = handle.uniforms;
  u.coverage.value = Math.max(Number(u.coverage.value) || 0, 0.46);
  u.density.value = Math.max(Number(u.density.value) || 0, 0.68);
  u.humidity.value = Math.max(Number(u.humidity.value) || 0, 0.58);
  u.erosion.value = Math.min(Number.isFinite(Number(u.erosion.value)) ? Number(u.erosion.value) : 0.70, 0.50);

  // Exposed only for quick phone verification in case another visibility issue
  // ever appears; it has no rendering cost and does not create UI.
  globalThis.__riftCloudVisibilityState = {
    visible: true,
    coverage: u.coverage.value,
    density: u.density.value,
    humidity: u.humidity.value,
    erosion: u.erosion.value,
    weatherType: handle.currentWeatherType,
  };
}

export function disposeVolumetricClouds(handle) {
  if (globalThis.__riftCloudVisibilityState) delete globalThis.__riftCloudVisibilityState;
  return disposeProceduralClouds(handle);
}
