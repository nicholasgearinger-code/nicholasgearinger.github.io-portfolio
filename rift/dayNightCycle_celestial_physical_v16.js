import * as THREE from "three";
import * as base from "./dayNightCycle_celestial_physical_v15.js";

export * from "./dayNightCycle_celestial_physical_v15.js";

// -----------------------------------------------------------------------------
// Celestial v16.1 — production cloud/Sun coupling.
//
// Model 3.7 supplies a local cloud optical-depth signal for the solar column.
// This layer applies it after the preserved photographic celestial stack authors
// the normal Sun materials. The enhanced transfer is now the default; use
// ?cloudLightingLegacy=1 for the previous conservative v16 behavior.
// -----------------------------------------------------------------------------

const params = typeof location !== "undefined"
  ? new URLSearchParams(location.search)
  : null;
const ENHANCED_LIGHTING = params?.has("cloudLightingLegacy") !== true;

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

function multiplyMaterialColors(materials, factor) {
  const seen = new Set();
  for (const material of materials) {
    if (!material?.color || seen.has(material)) continue;
    seen.add(material);
    material.color.multiplyScalar(factor);
  }
}

function applyCloudDiscOcclusion(cycle) {
  if (!cycle) return;

  const local = Number(globalThis.__riftLocalSunCloudOcclusion);
  const sunOcclusion = ENHANCED_LIGHTING && Number.isFinite(local)
    ? clamp01(local)
    : clamp01(globalThis.__riftSunDiskOcclusion || 0);
  const moonOcclusion = clamp01(globalThis.__riftMoonDiskOcclusion || 0);

  const clearSun = 1 - sunOcclusion;
  const sunDiscTransmission = ENHANCED_LIGHTING
    ? Math.pow(clearSun, 5.8)
    : Math.pow(clearSun, 2.35);
  const sunHaloTransmission = ENHANCED_LIGHTING
    ? THREE.MathUtils.lerp(1.0, 0.055, Math.pow(sunOcclusion, 0.66))
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

  if (ENHANCED_LIGHTING) {
    // Brightness must come from HDR color energy, not alpha > 1. The underlying
    // v9 updater rewrites these colors/scales every frame, so these multipliers
    // do not accumulate.
    const hotBoost = THREE.MathUtils.lerp(1.0, 1.72, Math.pow(clearSun, 1.35));
    const haloBoost = THREE.MathUtils.lerp(1.0, 1.22, Math.pow(clearSun, 1.15));

    multiplyMaterialColors([
      photo?.hotCoreMaterial,
      sunV9?.coreMaterial,
    ], hotBoost);

    multiplyMaterialColors([
      visual?.haloMaterial,
      visual?.aureoleMaterial,
      photo?.bloomMaterial,
    ], haloBoost);

    // A slightly smaller hard disc with a broader soft halo reads as a hotter
    // photographic source instead of a white circular sticker on mobile.
    visual?.disc?.scale?.multiplyScalar?.(0.90);
    photo?.hotCore?.scale?.multiplyScalar?.(0.96);
    sunV9?.core?.scale?.multiplyScalar?.(0.92);
    visual?.halo?.scale?.multiplyScalar?.(1.08);
    visual?.aureole?.scale?.multiplyScalar?.(1.05);
    photo?.bloom?.scale?.multiplyScalar?.(1.08);

    // Once dense cloud wins the local solar column, remove the hard sprites
    // entirely. The diffuse halo can remain faintly visible as forward scatter.
    const hardVisible = sunDiscTransmission > 0.0035;
    if (visual?.disc) visual.disc.visible = visual.disc.visible && hardVisible;
    if (photo?.hotCore) photo.hotCore.visible = photo.hotCore.visible && hardVisible;
    if (sunV9?.core) sunV9.core.visible = sunV9.core.visible && hardVisible;
  }

  // Direct illumination tracks the same local cloud column. The ambient/sky
  // system remains separate, so a passing cloud removes hard sunlight without
  // blacking out the whole frame.
  if (cycle.sun) {
    cycle.sun.intensity *= ENHANCED_LIGHTING
      ? THREE.MathUtils.lerp(1.14, 0.075, Math.pow(sunOcclusion, 0.72))
      : THREE.MathUtils.lerp(1.0, 0.46, sunOcclusion);
  }

  const optics = globalThis.__riftCelestialOpticsV14;
  if (optics) {
    optics.sourceVisibility = clamp01(
      (Number(optics.sourceVisibility) || 0)
      * (ENHANCED_LIGHTING
        ? THREE.MathUtils.lerp(1.0, 0.025, Math.pow(sunOcclusion, 0.70))
        : THREE.MathUtils.lerp(1.0, 0.18, sunOcclusion)),
    );
    optics.sunDiskOcclusion = sunOcclusion;
    optics.moonDiskOcclusion = moonOcclusion;
  }

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
    version: ENHANCED_LIGHTING
      ? "16.1-production-cloud-sun-coupling"
      : "16-cloud-disc-occlusion-legacy",
    enhanced: ENHANCED_LIGHTING,
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
