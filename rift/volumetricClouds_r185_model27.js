import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model26.js";

export * from "./volumetricClouds_r185_model26.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 2.7 — dual celestial scattering.
//
// Model 2 already performs Beer-Lambert extinction, a directional light march,
// dual-lobe phase scattering and approximate multiple scattering in the cloud
// volume. Until now that entire direct-light path was effectively Sun-only.
// This layer keeps the proven shader/TAAU/quality path unchanged and retargets
// the EXISTING uniforms after Model 2.6 updates them:
//   * Sun remains authoritative through daylight and golden hour.
//   * Once direct solar light fades, the real phase-aware Moon becomes the cloud
//     light direction.
//   * Moon cloud brightness follows lunar phase and horizon altitude.
//   * Full/bright moons produce cool silver rims and softly readable cloud tops;
//     new moons leave clouds mostly silhouette-lit by the night sky.
//   * No new render pass, texture, ray step or shader recompilation.
//
// This is intentionally conservative for iOS/WebGPU after the v14 flare issue.
// -----------------------------------------------------------------------------

const MOON_DIRECT = new THREE.Color(0xb8c9e5);
const MOON_HIGH = new THREE.Color(0xcbd9ef);
const MOON_AMBIENT = new THREE.Color(0x31465f);
const MOON_SHADOW = new THREE.Color(0x1b293b);
const TMP_DIR = new THREE.Vector3();
const TMP_COLOR = new THREE.Color();
const TMP_AMBIENT = new THREE.Color();

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function smoothRange(a, b, x) {
  return smooth01((x - a) / Math.max(1e-6, b - a));
}

function updateDualCelestialLighting(handle) {
  const u = handle?.uniforms;
  const optics = globalThis.__riftCelestialOpticsV14;
  if (!u || !optics) return;

  const solarVisibility = clamp01(optics.sourceVisibility);
  const dayAmount = clamp01(optics.dayAmount);
  const lowSun = clamp01(optics.lowSun);
  const moonElevation = Number(optics.moonElevation) || -1;
  const moonIllumination = clamp01(optics.moonIllumination ?? 1);
  const moonAbove = smoothRange(-0.045, 0.10, moonElevation);
  const moonPhaseEnergy = Math.pow(moonIllumination, 0.78);

  // Solar light is many orders of magnitude stronger in reality, so the Moon is
  // only allowed to take over the direct-scattering path after the Sun has
  // substantially left the scene. The smooth blend avoids a dusk color pop.
  const solarFade = 1 - smoothRange(0.015, 0.11, solarVisibility);
  const nightGate = 1 - smoothRange(0.03, 0.20, dayAmount);
  const moonBlend = clamp01(solarFade * nightGate * moonAbove * moonPhaseEnergy);

  const moonDir = optics.moonDirection;
  if (moonBlend > 0.001 && u.sunDir?.value?.isVector3 && moonDir?.isVector3) {
    TMP_DIR.copy(u.sunDir.value).lerp(moonDir, moonBlend);
    if (TMP_DIR.lengthSq() < 1e-5) TMP_DIR.copy(moonDir);
    u.sunDir.value.copy(TMP_DIR.normalize());
  }

  if (moonBlend > 0.001 && u.sunColor?.value?.isColor) {
    const altitudeGlow = smoothRange(0.05, 0.55, moonElevation);
    TMP_COLOR.copy(MOON_DIRECT).lerp(MOON_HIGH, altitudeGlow);

    // Deliberately restrained: clouds should remain visibly nocturnal even under
    // a full Moon. Phase is the dominant brightness control.
    const moonEnergy = THREE.MathUtils.lerp(0.055, 0.22, moonPhaseEnergy)
      * THREE.MathUtils.lerp(0.58, 1.0, moonAbove);
    TMP_COLOR.multiplyScalar(moonEnergy);
    u.sunColor.value.lerp(TMP_COLOR, moonBlend);
  }

  if (moonBlend > 0.001 && u.ambientColor?.value?.isColor) {
    TMP_AMBIENT.copy(MOON_SHADOW).lerp(MOON_AMBIENT, 0.48 + moonPhaseEnergy * 0.34);
    const ambientEnergy = THREE.MathUtils.lerp(0.34, 0.58, moonPhaseEnergy);
    TMP_AMBIENT.multiplyScalar(ambientEnergy);
    u.ambientColor.value.lerp(TMP_AMBIENT, moonBlend * 0.90);
  }

  // Reuse the shader's existing silver-edge / multiple-scatter controls. No new
  // TSL graph is created, so this remains runtime-uniform-only and mobile-safe.
  if (u.m2SilverStrength) {
    const sunSilver = Number(u.m2SilverStrength.value) || 0.42;
    const moonSilver = THREE.MathUtils.lerp(0.055, 0.24, moonPhaseEnergy)
      * THREE.MathUtils.lerp(0.62, 1.0, moonAbove);
    u.m2SilverStrength.value = THREE.MathUtils.lerp(sunSilver, moonSilver, moonBlend);
  }
  if (u.m2MultiScatter) {
    const sunMulti = Number(u.m2MultiScatter.value) || 0.24;
    const moonMulti = THREE.MathUtils.lerp(0.105, 0.18, moonPhaseEnergy);
    u.m2MultiScatter.value = THREE.MathUtils.lerp(sunMulti, moonMulti, moonBlend);
  }
  if (u.m2LightExtinction) {
    const sunExtinction = Number(u.m2LightExtinction.value) || 0.68;
    const moonExtinction = THREE.MathUtils.lerp(0.76, 0.68, moonPhaseEnergy);
    u.m2LightExtinction.value = THREE.MathUtils.lerp(sunExtinction, moonExtinction, moonBlend);
  }
  if (u.m2AmbientStrength) {
    const sunAmbient = Number(u.m2AmbientStrength.value) || 0.56;
    const moonAmbient = THREE.MathUtils.lerp(0.38, 0.48, moonPhaseEnergy);
    u.m2AmbientStrength.value = THREE.MathUtils.lerp(sunAmbient, moonAmbient, moonBlend);
  }

  // Cirrus can catch moonlight too, but only faintly. Preserve the storm/fair-
  // weather opacity authored by the lower models and just tint it at night.
  const cirrusMaterial = handle.__riftCirrus?.material;
  if (cirrusMaterial?.color?.isColor && moonBlend > 0.001) {
    cirrusMaterial.color.lerp(MOON_HIGH, moonBlend * 0.65);
  }
  if (cirrusMaterial && moonBlend > 0.001) {
    const currentOpacity = Number(cirrusMaterial.opacity) || 0;
    const moonOpacity = THREE.MathUtils.lerp(0.0015, 0.0065, moonPhaseEnergy) * moonAbove;
    cirrusMaterial.opacity = THREE.MathUtils.lerp(currentOpacity, moonOpacity, moonBlend);
  }

  globalThis.__riftCloudModel27 = {
    version: "2.7-dual-celestial-scattering",
    solarVisibility,
    lowSun,
    moonBlend,
    moonElevation,
    moonIllumination,
    moonAbove,
    directSource: moonBlend > 0.5 ? "moon" : "sun",
    silverStrength: Number(u.m2SilverStrength?.value) || 0,
    multiScatter: Number(u.m2MultiScatter?.value) || 0,
    lightExtinction: Number(u.m2LightExtinction?.value) || 0,
    renderScale: handle.__riftModel2Quality?.renderScale || 0,
    threeRevision: THREE.REVISION,
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (handle) handle.__riftModel27 = true;
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
  base.updateVolumetricClouds(
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

  updateDualCelestialLighting(handle);
}

export function disposeVolumetricClouds(handle) {
  delete globalThis.__riftCloudModel27;
  return base.disposeVolumetricClouds(handle);
}
