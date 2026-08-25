import * as THREE from "three";
import * as base from "./dayNightCycle_celestial_physical_v12.js";

export * from "./dayNightCycle_celestial_physical_v12.js";

// -----------------------------------------------------------------------------
// Celestial / atmosphere v13 — photographic single-scattering presentation.
//
// v12 fixed the extra-sky-pass regression, but its humid horizon and broad Mie
// contribution were still too bright/desaturated on iPhone. The result looked
// milky at daylight and mauve across too much of the sky at sunset. v13 keeps
// v12's dynamic Preetham/Sky-style state (turbidity, Rayleigh, Mie, anisotropy)
// and the proven v10 Sun/shadow system, but remaps those physical controls into a
// more photographic angular distribution:
//   * saturated blue remains at the zenith through golden hour;
//   * warm light is concentrated near the horizon and around the solar azimuth;
//   * humidity raises a blue-white horizon veil without bleaching the hemisphere;
//   * storms desaturate/darken the sky smoothly rather than turning it white;
//   * the world ambient color follows the same sky palette.
// -----------------------------------------------------------------------------

const DAY_ZENITH = new THREE.Color(0x347fc1);
const DAY_UPPER = new THREE.Color(0x6fa7cf);
const DAY_HORIZON = new THREE.Color(0xa9cfdf);
const TWILIGHT_ZENITH = new THREE.Color(0x355f96);
const TWILIGHT_UPPER = new THREE.Color(0x617da5);
const TWILIGHT_HORIZON = new THREE.Color(0xe59060);
const DEEP_HORIZON = new THREE.Color(0xe17045);
const HUMID_HAZE = new THREE.Color(0xc1d3dc);
const WARM_HAZE = new THREE.Color(0xe9a170);
const STORM_ZENITH = new THREE.Color(0x526575);
const STORM_UPPER = new THREE.Color(0x6f7e89);
const STORM_HORIZON = new THREE.Color(0x89949b);
const AMBIENT_DAY = new THREE.Color(0x9fb9cc);
const AMBIENT_TWILIGHT = new THREE.Color(0x8b91a3);
const AMBIENT_STORM = new THREE.Color(0x747f89);

const TMP_DIR = new THREE.Vector3();
const TMP_COLOR = new THREE.Color();
const TMP_ZENITH = new THREE.Color();
const TMP_UPPER = new THREE.Color();
const TMP_HORIZON = new THREE.Color();
const TMP_HAZE = new THREE.Color();
const TMP_AMBIENT = new THREE.Color();
const TMP_SUN_GLOW = new THREE.Color();

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

function recolorPhotographicDome(atmosphere, state) {
  const dome = atmosphere?.dome;
  const pos = dome?.position;
  const colorAttr = dome?.color;
  if (!pos || !colorAttr || !state) return;

  const colors = colorAttr.array;
  const sunDir = state.sunDirection;
  const lowSun = clamp01(state.lowSun);
  const storm = clamp01(state.storm);
  const humidity = clamp01(state.humidity);
  const daylight = clamp01(state.daylight);

  for (let i = 0; i < pos.count; i++) {
    TMP_DIR.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const h = clamp01((TMP_DIR.y + 0.035) / 1.035);

    // Three vertical bands preserve a genuinely blue upper hemisphere. This is
    // intentionally not a simple horizon->zenith lerp: real low-Sun warmth is
    // strongly confined to the lowest optical paths.
    if (h < 0.18) {
      TMP_COLOR.copy(state.horizonColor).lerp(state.upperColor, smooth01(h / 0.18));
    } else {
      TMP_COLOR.copy(state.upperColor).lerp(
        state.zenithColor,
        smooth01((h - 0.18) / 0.82),
      );
    }

    // Aerosol/humidity haze is a narrow lower-atmosphere veil. Keep its maximum
    // contribution modest so clear daylight never becomes a gray-white card.
    const hazeWidth = THREE.MathUtils.lerp(7.5, 4.7, humidity * 0.65 + storm * 0.55);
    const haze = Math.pow(1 - h, hazeWidth)
      * (0.025 + humidity * 0.055 + storm * 0.075);
    TMP_COLOR.lerp(state.hazeColor, clamp01(haze));

    // Warm scattering is localized BOTH vertically and around the Sun azimuth.
    // This prevents the previous full-screen pink/mauve sunset wash.
    const sunDot = clamp01(TMP_DIR.dot(sunDir));
    const lowBand = Math.pow(1 - h, 2.6);
    const broadSolar = Math.pow(sunDot, 10) * lowBand * lowSun * (1 - storm * 0.55);
    const tightSolar = Math.pow(sunDot, 42) * daylight * (0.035 + lowSun * 0.11);
    TMP_SUN_GLOW.copy(WARM_HAZE).lerp(state.sunTint, 0.34);
    TMP_COLOR.lerp(TMP_SUN_GLOW, clamp01(broadSolar * 0.20 + tightSolar));

    const j = i * 3;
    colors[j] = TMP_COLOR.r;
    colors[j + 1] = TMP_COLOR.g;
    colors[j + 2] = TMP_COLOR.b;
  }
  colorAttr.needsUpdate = true;
}

function applyPhotographicAtmosphere(cycle, result) {
  const state = globalThis.__riftSkyPhysicalV12;
  const atmosphere = globalThis.__riftReferenceAtmosphere;
  if (!state || !atmosphere) return result;

  const daylight = clamp01(state.daylight);
  const lowSun = clamp01(state.lowSun);
  const storm = clamp01(state.storm);
  const humidity = clamp01(state.humidity);
  const clear = 1 - storm;
  const altitudeDeg = Number(state.altitudeDeg) || -90;
  const highSun = smoothRange(16, 48, altitudeDeg);
  const horizonFire = lowSun * (1 - smoothRange(4, 12, altitudeDeg));

  TMP_ZENITH.copy(TWILIGHT_ZENITH).lerp(DAY_ZENITH, daylight);
  TMP_ZENITH.lerp(STORM_ZENITH, storm * 0.76);

  TMP_UPPER.copy(TWILIGHT_UPPER).lerp(DAY_UPPER, daylight);
  // Only a very small warm contamination reaches the upper band.
  TMP_UPPER.lerp(WARM_HAZE, lowSun * clear * 0.07);
  TMP_UPPER.lerp(STORM_UPPER, storm * 0.72);

  TMP_HORIZON.copy(DAY_HORIZON)
    .lerp(HUMID_HAZE, humidity * 0.22)
    .lerp(TWILIGHT_HORIZON, lowSun * clear * 0.68)
    .lerp(DEEP_HORIZON, horizonFire * clear * 0.24)
    .lerp(STORM_HORIZON, storm * 0.74);

  TMP_HAZE.copy(HUMID_HAZE)
    .lerp(WARM_HAZE, lowSun * clear * 0.58)
    .lerp(STORM_HORIZON, storm * 0.70);

  TMP_AMBIENT.copy(AMBIENT_TWILIGHT).lerp(AMBIENT_DAY, daylight);
  TMP_AMBIENT.lerp(WARM_HAZE, lowSun * clear * 0.08);
  TMP_AMBIENT.lerp(AMBIENT_STORM, storm * 0.72);

  state.zenithColor.copy(TMP_ZENITH);
  state.upperColor = state.upperColor || new THREE.Color();
  state.upperColor.copy(TMP_UPPER);
  state.horizonColor.copy(TMP_HORIZON);
  state.hazeColor.copy(TMP_HAZE);
  state.ambientColor.copy(TMP_AMBIENT);

  atmosphere.zenithColor.copy(state.zenithColor);
  atmosphere.horizonColor.copy(state.horizonColor);
  atmosphere.hazeColor.copy(state.hazeColor);
  atmosphere.ambientColor.copy(state.ambientColor);
  atmosphere.backgroundColor.copy(state.upperColor).lerp(state.zenithColor, 0.58);

  // The sky dome is untone-mapped, so its actual RGB values carry the appearance.
  // Exposure is kept for terrain/water/post effects and deliberately avoids the
  // high values that blew out sand and cloud whites in the previous screenshots.
  const targetExposure = THREE.MathUtils.lerp(0.80, 0.91, highSun)
    * THREE.MathUtils.lerp(1.0, 0.91, storm);
  atmosphere.exposure = THREE.MathUtils.clamp(targetExposure, 0.74, 0.92);

  if (atmosphere.scene?.background?.isColor) {
    atmosphere.scene.background.copy(atmosphere.backgroundColor);
  }
  recolorPhotographicDome(atmosphere, state);

  // Keep diffuse fill consistent with the visual sky without flattening direct
  // sunlight. Golden hour remains directional; overcast receives more cool fill.
  if (cycle?.ambient) {
    cycle.ambient.color?.copy?.(state.ambientColor);
    const targetAmbient = THREE.MathUtils.lerp(0.115, 0.245, daylight)
      * THREE.MathUtils.lerp(1.0, 0.92, lowSun * clear)
      * THREE.MathUtils.lerp(1.0, 1.06, storm);
    cycle.ambient.intensity = Math.max(Number(cycle.ambient.intensity) || 0, targetAmbient);
  }

  if (result) {
    result.skyZenith?.copy?.(state.zenithColor);
    result.skyHorizon?.copy?.(state.horizonColor);
    result.ambientColor?.copy?.(cycle?.ambient?.color || state.ambientColor);
  }

  globalThis.__riftSkyPhysicalV13 = {
    ...state,
    version: "13-photographic-preetham-mapping",
    highSun,
    horizonFire,
    exposure: atmosphere.exposure,
  };
  globalThis.__riftAtmosphereDebug = {
    ...(globalThis.__riftAtmosphereDebug || {}),
    version: "13-photographic-preetham-mapping",
    highSun,
    horizonFire,
    exposure: atmosphere.exposure,
  };

  return result;
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  const cycle = base.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight);
  applyPhotographicAtmosphere(cycle, null);
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = base.updateDayNightCycle(cycle, dt);
  return applyPhotographicAtmosphere(cycle, result);
}
