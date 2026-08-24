import * as THREE from "three";
import * as base from "./dayNightCycle_celestial_physical_v3.js";

export * from "./dayNightCycle_celestial_physical_v3.js";

// -----------------------------------------------------------------------------
// Celestial/atmosphere v4 — bright tropical daylight reference pass.
//
// v3 integrated the sky, clouds and water palette, but the white atmospheric
// haze could become brighter than the visible photosphere. This layer restores
// the hierarchy seen in real ocean photography: a saturated blue zenith, a soft
// cyan horizon, a localized solar aureole, and a Sun that is unmistakably the
// brightest object in a clear sky. The actual DirectionalLight is boosted too,
// so cloud/water/terrain illumination agrees with the visible solar disc.
// -----------------------------------------------------------------------------

const ORBIT_RADIUS = 260;
const SUN_HORIZON_OFFSET = 10;
const CLEAR_ZENITH = new THREE.Color(0x2f8fd7);
const CLEAR_HORIZON = new THREE.Color(0xbfe5f4);
const CLEAR_HAZE = new THREE.Color(0xd8eef6);
const CLEAR_AMBIENT = new THREE.Color(0xa8c9df);
const SUN_WHITE = new THREE.Color(0xfffff4);
const SUN_WARM = new THREE.Color(0xffa65c);
const STORM_ZENITH = new THREE.Color(0x718696);
const STORM_HORIZON = new THREE.Color(0xa6b1b8);
const STORM_AMBIENT = new THREE.Color(0x7d8993);
const TMP_DIR = new THREE.Vector3();
const TMP_COLOR = new THREE.Color();

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function recolorAtmosphereDome(atmosphere) {
  const dome = atmosphere?.dome;
  const pos = dome?.position;
  const colorAttr = dome?.color;
  if (!pos || !colorAttr) return;

  const colors = colorAttr.array;
  const sunDir = atmosphere.sunDirection;
  const day = clamp01(atmosphere.daylight);
  const lowSun = clamp01(atmosphere.lowSun);
  const storm = clamp01(atmosphere.storm);

  for (let i = 0; i < pos.count; i++) {
    TMP_DIR.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const altitude = clamp01((TMP_DIR.y + 0.08) / 1.08);
    const vertical = Math.pow(altitude, 0.62);
    TMP_COLOR.copy(atmosphere.horizonColor).lerp(atmosphere.zenithColor, vertical);

    // Clear weather haze is intentionally narrow and close to the horizon.
    const horizonHaze = Math.pow(1 - altitude, 6.0) * (0.035 + storm * 0.10);
    TMP_COLOR.lerp(atmosphere.hazeColor, horizonHaze);

    // Localized Mie-like aureole around the real Sun instead of whitening the
    // entire upper hemisphere. Near sunset the aureole becomes wider/warmer.
    const sunDot = clamp01(TMP_DIR.dot(sunDir));
    const aureole = Math.pow(sunDot, 22) * day * (0.12 + lowSun * 0.18);
    const coreHaze = Math.pow(sunDot, 90) * day * (0.16 + lowSun * 0.12);
    TMP_COLOR.lerp(atmosphere.sunColor, clamp01(aureole + coreHaze));

    const j = i * 3;
    colors[j] = TMP_COLOR.r;
    colors[j + 1] = TMP_COLOR.g;
    colors[j + 2] = TMP_COLOR.b;
  }
  colorAttr.needsUpdate = true;
}

function applyReferenceDaylight(cycle, result) {
  if (!cycle) return result;

  const sunPos = cycle.sunBody?.group?.position;
  const elevation = sunPos?.isVector3
    ? THREE.MathUtils.clamp((sunPos.y - SUN_HORIZON_OFFSET) / ORBIT_RADIUS, -1, 1)
    : -1;
  const daylight = smooth01((elevation + 0.10) / 0.26);
  const highSun = smooth01(Math.max(0, elevation) / 0.46);
  const lowSun = daylight * (1 - highSun);
  const atmosphere = globalThis.__riftReferenceAtmosphere;
  const weather = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(weather?.stormIntensity ?? weather?.rainIntensity ?? atmosphere?.storm ?? 0);

  // Actual scene illumination: keep low Sun warm but make clear daytime direct
  // light substantially stronger than ambient fill. The base updater rewrites
  // intensity every frame, so this multiplier does not accumulate.
  if (cycle.sun) {
    const boost = THREE.MathUtils.lerp(1.18, 1.52, highSun) * THREE.MathUtils.lerp(1, 0.82, storm);
    cycle.sun.intensity *= boost;
    cycle.sun.color.copy(SUN_WARM).lerp(SUN_WHITE, highSun);
  }
  if (cycle.ambient) {
    cycle.ambient.intensity *= THREE.MathUtils.lerp(0.94, 0.86, highSun);
  }

  const visual = cycle.__riftRealSun;
  if (visual) {
    const cloudOcclusion = clamp01(globalThis.__riftProceduralCloudOcclusion || 0);
    const transmission = 1 - cloudOcclusion;
    const horizon = smooth01(1 - Math.min(1, Math.abs(elevation) / 0.18));
    const discSize = THREE.MathUtils.lerp(22.0, 25.0, horizon);
    const haloSize = THREE.MathUtils.lerp(112.0, 144.0, horizon);
    const aureoleSize = THREE.MathUtils.lerp(220.0, 285.0, horizon);

    visual.disc?.scale.set(discSize, discSize, 1);
    visual.halo?.scale.set(haloSize, haloSize, 1);
    visual.aureole?.scale.set(aureoleSize, aureoleSize, 1);

    if (visual.discMaterial) {
      visual.discMaterial.blending = THREE.AdditiveBlending;
      visual.discMaterial.premultipliedAlpha = false;
      visual.discMaterial.color.copy(SUN_WARM).lerp(SUN_WHITE, highSun);
      visual.discMaterial.opacity = daylight * (0.88 + transmission * 0.12);
      visual.discMaterial.needsUpdate = true;
    }
    if (visual.haloMaterial) {
      visual.haloMaterial.opacity = daylight
        * THREE.MathUtils.lerp(0.40, 0.28, highSun)
        * (0.40 + transmission * 0.60);
    }
    if (visual.aureoleMaterial) {
      visual.aureoleMaterial.opacity = daylight
        * THREE.MathUtils.lerp(0.14, 0.075, highSun)
        * (0.45 + transmission * 0.55);
    }
    if (visual.horizonGlowMaterial) {
      visual.horizonGlowMaterial.opacity = daylight * horizon * 0.17 * (0.45 + transmission * 0.55);
    }
  }

  if (atmosphere) {
    atmosphere.daylight = daylight;
    atmosphere.lowSun = lowSun;
    atmosphere.storm = storm;
    atmosphere.zenithColor.copy(CLEAR_ZENITH).lerp(STORM_ZENITH, storm * 0.78);
    atmosphere.horizonColor.copy(CLEAR_HORIZON).lerp(STORM_HORIZON, storm * 0.72);
    if (lowSun > 0.001) {
      atmosphere.horizonColor.lerp(new THREE.Color(0xffbd7b), lowSun * 0.42);
    }
    atmosphere.hazeColor.copy(CLEAR_HAZE)
      .lerp(new THREE.Color(0xffc58d), lowSun * 0.62)
      .lerp(STORM_HORIZON, storm * 0.58);
    atmosphere.sunColor.copy(SUN_WARM).lerp(SUN_WHITE, highSun);
    atmosphere.ambientColor.copy(CLEAR_AMBIENT).lerp(STORM_AMBIENT, storm * 0.72);
    atmosphere.backgroundColor.copy(atmosphere.horizonColor).lerp(atmosphere.zenithColor, 0.60);

    // Bright tropical daylight similar to the photographic references, without
    // blowing cloud whites into featureless slabs. main_game.js consumes this.
    atmosphere.exposure = THREE.MathUtils.lerp(0.90, 1.075, daylight)
      * THREE.MathUtils.lerp(1, 0.88, storm);

    if (atmosphere.scene?.background?.isColor) {
      atmosphere.scene.background.copy(atmosphere.backgroundColor);
    }
    if (result?.skyZenith?.isColor) result.skyZenith.copy(atmosphere.zenithColor);
    if (result?.skyHorizon?.isColor) result.skyHorizon.copy(atmosphere.horizonColor);
    if (result?.sunColor?.isColor) result.sunColor.copy(atmosphere.sunColor);
    recolorAtmosphereDome(atmosphere);
  }

  globalThis.__riftCelestialPhysicalV4 = {
    directSunIntensity: Number(cycle.sun?.intensity) || 0,
    daylight,
    highSun,
    lowSun,
    storm,
    brightPhotosphere: true,
  };
  return result;
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  const cycle = base.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight);
  applyReferenceDaylight(cycle, null);
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = base.updateDayNightCycle(cycle, dt);
  return applyReferenceDaylight(cycle, result);
}
