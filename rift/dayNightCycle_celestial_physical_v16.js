import * as THREE from "three";
import * as base from "./dayNightCycle_celestial_physical_v15.js";

export * from "./dayNightCycle_celestial_physical_v15.js";

// -----------------------------------------------------------------------------
// Celestial v16 — cloud-disc occlusion.
//
// Model 2.8 estimates the optical depth along the actual camera->Sun and
// camera->Moon directions. Apply that result AFTER the preserved photographic
// celestial stack has authored its normal opacities, so a real cloud crossing a
// celestial body progressively hides the hard disc/core while leaving a softer
// diffuse halo behind it. No render-time callbacks and no new pass — safe on the
// same iOS/WebGPU path stabilized by v15.
// -----------------------------------------------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function multiplyMaterials(materials, factor) {
  const seen = new Set();
  for (const material of materials) {
    if (!material || seen.has(material)) continue;
    seen.add(material);
    if (Number.isFinite(material.opacity)) material.opacity *= factor;
  }
}

function applyCloudDiscOcclusion(cycle) {
  if (!cycle) return;

  const sunOcclusion = clamp01(globalThis.__riftSunDiskOcclusion || 0);
  const moonOcclusion = clamp01(globalThis.__riftMoonDiskOcclusion || 0);

  // Dense cloud kills the hard solar image quickly. Diffuse glare survives much
  // longer because cloud droplets forward-scatter the hidden source around the
  // cloud edge — exactly the bright/silver rim seen in photographic references.
  const sunDiscTransmission = Math.pow(1 - sunOcclusion, 2.35);
  const sunHaloTransmission = THREE.MathUtils.lerp(
    1.0,
    0.24,
    Math.pow(sunOcclusion, 0.82),
  );

  const visual = cycle.__riftRealSun;
  const photo = cycle.__riftPhotometricSunV7;
  const sunV9 = cycle.__riftSunV9;

  multiplyMaterials([
    visual?.discMaterial,
    photo?.hotCoreMaterial,
    sunV9?.coreMaterial,
    cycle.sunBody?.core?.material,
  ], sunDiscTransmission);

  multiplyMaterials([
    visual?.haloMaterial,
    visual?.aureoleMaterial,
    photo?.bloomMaterial,
    cycle.sunBody?.glow?.material,
  ], sunHaloTransmission);

  // Local direct illumination drops when the player is under the same cloud
  // column that hides the Sun. Ambient sky light stays untouched, so this reads
  // as a passing cloud shadow instead of the entire world fading to black.
  if (cycle.sun) {
    cycle.sun.intensity *= THREE.MathUtils.lerp(1.0, 0.46, sunOcclusion);
  }

  const optics = globalThis.__riftCelestialOpticsV14;
  if (optics) {
    optics.sourceVisibility = clamp01(
      (Number(optics.sourceVisibility) || 0)
      * THREE.MathUtils.lerp(1.0, 0.18, sunOcclusion),
    );
    optics.sunDiskOcclusion = sunOcclusion;
    optics.moonDiskOcclusion = moonOcclusion;
  }

  // Moonlight is much weaker and visually broader. Preserve the existing lunar
  // phase mask; cloud occlusion simply attenuates whatever illuminated fraction
  // that mask currently exposes.
  const moonDiscTransmission = Math.pow(1 - moonOcclusion, 1.65);
  const moonHaloTransmission = THREE.MathUtils.lerp(1.0, 0.32, moonOcclusion);
  multiplyMaterials([
    cycle.moonBody?.core?.material,
  ], moonDiscTransmission);
  multiplyMaterials([
    cycle.moonBody?.glow?.material,
  ], moonHaloTransmission);

  if (cycle.moonLight) {
    cycle.moonLight.intensity *= THREE.MathUtils.lerp(1.0, 0.58, moonOcclusion);
  }

  globalThis.__riftCelestialV16 = {
    version: "16-cloud-disc-occlusion",
    sunOcclusion,
    moonOcclusion,
    sunDiscTransmission,
    sunHaloTransmission,
    moonDiscTransmission,
    moonHaloTransmission,
    mobileFlareGuardStillActive: globalThis.__riftCelestialV15?.touchGuard === true,
  };
}

export function createDayNightCycle(...args) {
  const cycle = base.createDayNightCycle(...args);
  applyCloudDiscOcclusion(cycle);
  return cycle;
}

export function updateDayNightCycle(cycle, dt, ...rest) {
  const result = base.updateDayNightCycle(cycle, dt, ...rest);
  applyCloudDiscOcclusion(cycle);
  return result;
}
