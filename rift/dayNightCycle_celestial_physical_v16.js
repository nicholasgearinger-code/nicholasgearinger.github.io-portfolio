import * as THREE from "three";
import * as base from "./dayNightCycle_celestial_physical_v15.js";

export * from "./dayNightCycle_celestial_physical_v15.js";

// -----------------------------------------------------------------------------
// Celestial v16 — cloud-disc occlusion.
//
// Model 3.7 estimates optical depth along the camera->Sun and camera->Moon
// directions. Apply that result AFTER the preserved photographic celestial stack
// authors its normal opacities. The optional cloudLightingPreview keeps the same
// render graph but uses a more photographic transfer curve: unobscured Sun is
// hotter/brighter, cloud cover kills the hard disc quickly, and a softer halo
// survives just long enough to feed cloud-edge backlighting.
// -----------------------------------------------------------------------------

const PREVIEW_ENABLED = typeof location !== "undefined"
  && new URLSearchParams(location.search).has("cloudLightingPreview");

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

  const previewLocal = Number(globalThis.__riftLocalSunCloudOcclusion);
  const sunOcclusion = PREVIEW_ENABLED && Number.isFinite(previewLocal)
    ? clamp01(previewLocal)
    : clamp01(globalThis.__riftSunDiskOcclusion || 0);
  const moonOcclusion = clamp01(globalThis.__riftMoonDiskOcclusion || 0);

  // Normal production keeps the proven v16 transfer curve. The opt-in preview
  // makes the hard solar image far more decisive: brilliant when clear, rapidly
  // extinguished by a real cloud column. The broader aureole survives longer so
  // cloud edges can glow without the white disc visibly punching through them.
  const sunDiscTransmission = PREVIEW_ENABLED
    ? 1.32 * Math.pow(1 - sunOcclusion, 5.0)
    : Math.pow(1 - sunOcclusion, 2.35);
  const sunHaloTransmission = PREVIEW_ENABLED
    ? THREE.MathUtils.lerp(1.48, 0.10, Math.pow(sunOcclusion, 0.70))
    : THREE.MathUtils.lerp(1.0, 0.24, Math.pow(sunOcclusion, 0.82));

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

  // Local direct illumination falls sharply under the cloud that hides the Sun,
  // while ambient sky light remains intact. Clear preview Sun gets a tiny direct
  // boost so the source and its water/terrain response feel energetically linked.
  if (cycle.sun) {
    cycle.sun.intensity *= PREVIEW_ENABLED
      ? THREE.MathUtils.lerp(1.06, 0.12, Math.pow(sunOcclusion, 0.74))
      : THREE.MathUtils.lerp(1.0, 0.46, sunOcclusion);
  }

  const optics = globalThis.__riftCelestialOpticsV14;
  if (optics) {
    optics.sourceVisibility = clamp01(
      (Number(optics.sourceVisibility) || 0)
      * (PREVIEW_ENABLED
        ? THREE.MathUtils.lerp(1.0, 0.045, Math.pow(sunOcclusion, 0.72))
        : THREE.MathUtils.lerp(1.0, 0.18, sunOcclusion)),
    );
    optics.sunDiskOcclusion = sunOcclusion;
    optics.moonDiskOcclusion = moonOcclusion;
  }

  // Moonlight stays phase-aware and follows the established softer attenuation.
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
    version: PREVIEW_ENABLED
      ? "16-cloud-disc-occlusion-preview-v3"
      : "16-cloud-disc-occlusion",
    preview: PREVIEW_ENABLED,
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
