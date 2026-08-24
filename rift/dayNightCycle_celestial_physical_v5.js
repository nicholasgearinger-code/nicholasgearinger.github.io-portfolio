import * as THREE from "three";
import * as base from "./dayNightCycle_celestial_physical_v4.js";

export * from "./dayNightCycle_celestial_physical_v4.js";

// Higher-contrast clear-sky pass using the public Sky Pro defaults as visual
// guidance: a bright warm-white solar source, deeper blue zenith, softer horizon
// haze, and direct sunlight that clearly dominates ambient fill.

const ORBIT_RADIUS = 260;
const SUN_HORIZON_OFFSET = 10;
const ZENITH_CLEAR = new THREE.Color(0x4f82bd);
const HORIZON_CLEAR = new THREE.Color(0xa9cce4);
const HAZE_CLEAR = new THREE.Color(0xc8deea);
const AMBIENT_CLEAR = new THREE.Color(0x9eb8ca);
const SUN_WHITE = new THREE.Color(0xfffff7);
const SUN_WARM = new THREE.Color(0xffb46d);
const TMP_WARM_HORIZON = new THREE.Color(0xffbd82);

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function tuneSunAndAtmosphere(cycle, result) {
  if (!cycle) return result;

  const pos = cycle.sunBody?.group?.position;
  const elevation = pos?.isVector3
    ? THREE.MathUtils.clamp((pos.y - SUN_HORIZON_OFFSET) / ORBIT_RADIUS, -1, 1)
    : -1;
  const daylight = smooth01((elevation + 0.08) / 0.24);
  const highSun = smooth01(Math.max(0, elevation) / 0.42);
  const lowSun = daylight * (1 - highSun);
  const weather = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(weather?.stormIntensity ?? weather?.rainIntensity ?? 0);

  // Sky Pro's public API uses a peak solar radiance around 6.6. DirectionalLight
  // intensity is not the same unit, but matching that hierarchy visually means
  // the Sun must dominate Rift's ambient fill much more strongly than before.
  if (cycle.sun) {
    const clearTarget = THREE.MathUtils.lerp(2.4, 4.8, highSun);
    const weatheredTarget = clearTarget * THREE.MathUtils.lerp(1.0, 0.48, storm);
    cycle.sun.intensity = Math.max(Number(cycle.sun.intensity) || 0, weatheredTarget * daylight);
    cycle.sun.color.copy(SUN_WARM).lerp(SUN_WHITE, highSun);
  }
  if (cycle.ambient) {
    cycle.ambient.intensity = Math.min(
      Number(cycle.ambient.intensity) || 0.3,
      THREE.MathUtils.lerp(0.34, 0.27, highSun) * THREE.MathUtils.lerp(1, 0.82, storm),
    );
  }

  const visual = cycle.__riftRealSun;
  if (visual) {
    const cloudOcclusion = clamp01(globalThis.__riftProceduralCloudOcclusion || 0);
    const transmission = 1 - cloudOcclusion;
    const horizon = smooth01(1 - Math.min(1, Math.abs(elevation) / 0.16));

    visual.disc?.scale.set(20 + horizon * 2.5, 20 + horizon * 2.5, 1);
    visual.halo?.scale.set(128 + horizon * 34, 128 + horizon * 34, 1);
    visual.aureole?.scale.set(240 + horizon * 70, 240 + horizon * 70, 1);

    if (visual.discMaterial) {
      visual.discMaterial.color.copy(SUN_WARM).lerp(SUN_WHITE, highSun);
      visual.discMaterial.opacity = daylight * (0.96 + transmission * 0.04);
      visual.discMaterial.blending = THREE.AdditiveBlending;
      visual.discMaterial.toneMapped = false;
    }
    if (visual.haloMaterial) {
      visual.haloMaterial.opacity = daylight
        * THREE.MathUtils.lerp(0.50, 0.34, highSun)
        * (0.42 + transmission * 0.58);
    }
    if (visual.aureoleMaterial) {
      visual.aureoleMaterial.opacity = daylight
        * THREE.MathUtils.lerp(0.17, 0.085, highSun)
        * (0.48 + transmission * 0.52);
    }
    if (visual.horizonGlowMaterial) {
      visual.horizonGlowMaterial.opacity = daylight * horizon * 0.20 * (0.50 + transmission * 0.50);
    }
  }

  const atmosphere = globalThis.__riftReferenceAtmosphere;
  if (atmosphere) {
    atmosphere.zenithColor.copy(ZENITH_CLEAR).lerp(new THREE.Color(0x738594), storm * 0.78);
    atmosphere.horizonColor.copy(HORIZON_CLEAR).lerp(new THREE.Color(0xaab3b9), storm * 0.72);
    if (lowSun > 0.001) atmosphere.horizonColor.lerp(TMP_WARM_HORIZON, lowSun * 0.44);
    atmosphere.hazeColor.copy(HAZE_CLEAR).lerp(new THREE.Color(0xb4bbc0), storm * 0.62);
    atmosphere.ambientColor.copy(AMBIENT_CLEAR).lerp(new THREE.Color(0x7c8992), storm * 0.72);
    atmosphere.sunColor.copy(SUN_WARM).lerp(SUN_WHITE, highSun);
    atmosphere.backgroundColor.copy(atmosphere.horizonColor).lerp(atmosphere.zenithColor, 0.66);

    // Slightly lower exposure than v4 keeps the sky blue and cloud shadows
    // readable while the untone-mapped solar sprite supplies the true hot core.
    atmosphere.exposure = THREE.MathUtils.lerp(0.90, 0.995, daylight)
      * THREE.MathUtils.lerp(1.0, 0.88, storm);

    if (atmosphere.scene?.background?.isColor) atmosphere.scene.background.copy(atmosphere.backgroundColor);
    if (result?.skyZenith?.isColor) result.skyZenith.copy(atmosphere.zenithColor);
    if (result?.skyHorizon?.isColor) result.skyHorizon.copy(atmosphere.horizonColor);
    if (result?.sunColor?.isColor) result.sunColor.copy(atmosphere.sunColor);
  }

  globalThis.__riftCelestialPhysicalV5 = {
    daylight,
    highSun,
    lowSun,
    storm,
    directSunIntensity: Number(cycle.sun?.intensity) || 0,
    exposure: Number(atmosphere?.exposure) || 1,
  };

  return result;
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  const cycle = base.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight);
  tuneSunAndAtmosphere(cycle, null);
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = base.updateDayNightCycle(cycle, dt);
  return tuneSunAndAtmosphere(cycle, result);
}
