import * as THREE from "three";

// -----------------------------------------------------------------------------
// Shared sunrise / sunset atmosphere state.
//
// This is intentionally CPU-cheap: one update per frame produces the colors and
// scalar factors used by the sky dome, global lights, Model 2 clouds and FFT
// ocean. The goal is the photographic structure seen over open water:
//   cool blue/cyan upper sky -> peach/gold middle -> saturated orange/red horizon
// with a white-hot photosphere surrounded by a warm halo.
// -----------------------------------------------------------------------------

const NIGHT_ZENITH = new THREE.Color(0x071625);
const DAY_ZENITH = new THREE.Color(0x4389c7);
const SUNSET_ZENITH = new THREE.Color(0x4f82b8);
const DAY_UPPER_MID = new THREE.Color(0x82bce2);
const SUNSET_UPPER_MID = new THREE.Color(0xe1a17f);
const DAY_LOWER_MID = new THREE.Color(0xb9d9eb);
const SUNSET_LOWER_MID = new THREE.Color(0xffa449);
const DAY_HORIZON = new THREE.Color(0xc9e3ef);
const SUNSET_HORIZON = new THREE.Color(0xff6725);
const DEEP_SUNSET_HORIZON = new THREE.Color(0xf04422);
const STORM_ZENITH = new THREE.Color(0x596a79);
const STORM_MID = new THREE.Color(0x7b8288);
const STORM_HORIZON = new THREE.Color(0x8d817d);

const HOT_CORE = new THREE.Color(0xffffeb);
const SUN_DAY = new THREE.Color(0xfffff7);
const SUN_GOLD = new THREE.Color(0xffc260);
const SUN_ORANGE = new THREE.Color(0xff8c35);
const HALO_GOLD = new THREE.Color(0xffa443);
const HAZE_DAY = new THREE.Color(0xd1e4ee);
const HAZE_SUNSET = new THREE.Color(0xff9a55);

const AMBIENT_DAY = new THREE.Color(0x9fbfd7);
const AMBIENT_GOLD = new THREE.Color(0xc98c77);
const AMBIENT_TWILIGHT = new THREE.Color(0x6d7190);
const AMBIENT_NIGHT = new THREE.Color(0x52637c);
const AMBIENT_STORM = new THREE.Color(0x77848e);

const WATER_SUN_DAY = new THREE.Color(0xfff0cf);
const WATER_SUN_GOLD = new THREE.Color(0xffc45b);
const WATER_SUN_ORANGE = new THREE.Color(0xff962f);
const CLOUD_LIGHT_DAY = new THREE.Color(0xfbfdff);
const CLOUD_LIGHT_GOLD = new THREE.Color(0xffbd72);
const CLOUD_LIGHT_ORANGE = new THREE.Color(0xff9149);
const CLOUD_SHADOW_DAY = new THREE.Color(0x92a7bb);
const CLOUD_SHADOW_GOLD = new THREE.Color(0xa77774);
const CLOUD_SHADOW_STORM = new THREE.Color(0x59636d);

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

export function createSunsetAtmosphereState() {
  return {
    altitudeDeg: -90,
    daylight: 0,
    goldenHour: 0,
    sunset: 0,
    horizonFire: 0,
    twilight: 0,
    storm: 0,
    clear: 1,
    zenithColor: NIGHT_ZENITH.clone(),
    upperMidColor: NIGHT_ZENITH.clone(),
    lowerMidColor: AMBIENT_TWILIGHT.clone(),
    horizonColor: AMBIENT_TWILIGHT.clone(),
    hazeColor: AMBIENT_TWILIGHT.clone(),
    solarCoreColor: HOT_CORE.clone(),
    solarDiscColor: SUN_DAY.clone(),
    solarHaloColor: HALO_GOLD.clone(),
    directLightColor: SUN_DAY.clone(),
    ambientColor: AMBIENT_NIGHT.clone(),
    waterSunTint: WATER_SUN_DAY.clone(),
    cloudLightTint: CLOUD_LIGHT_DAY.clone(),
    cloudShadowTint: CLOUD_SHADOW_DAY.clone(),
  };
}

export function updateSunsetAtmosphereState(state, altitudeDeg, stormAmount = 0) {
  if (!state) return state;

  const altitude = Number.isFinite(Number(altitudeDeg)) ? Number(altitudeDeg) : -90;
  const storm = clamp01(stormAmount);
  const clear = 1 - storm;

  // Civil twilight starts around -6 degrees. Golden hour is strongest from a
  // few degrees below the horizon through roughly +12 degrees.
  const daylight = smooth01((altitude + 6.0) / 12.0);
  const riseIntoGold = smooth01((altitude + 5.0) / 7.0);
  const leaveGold = smooth01((altitude - 2.0) / 13.0);
  const goldenHour = riseIntoGold * (1 - leaveGold);
  const horizonFire = smooth01((altitude + 3.8) / 4.8)
    * (1 - smooth01((altitude - 0.3) / 7.8));
  const sunset = Math.max(goldenHour * 0.78, horizonFire);
  const twilight = smooth01((altitude + 6.0) / 6.0)
    * (1 - smooth01((altitude + 1.5) / 8.0));
  const highSun = smooth01((altitude - 10.0) / 28.0);

  state.altitudeDeg = altitude;
  state.daylight = daylight;
  state.goldenHour = goldenHour;
  state.sunset = sunset;
  state.horizonFire = horizonFire;
  state.twilight = twilight;
  state.storm = storm;
  state.clear = clear;

  state.zenithColor.copy(NIGHT_ZENITH).lerp(DAY_ZENITH, daylight);
  state.zenithColor.lerp(SUNSET_ZENITH, sunset * 0.54 * clear);
  state.zenithColor.lerp(STORM_ZENITH, storm * 0.76);

  state.upperMidColor.copy(AMBIENT_TWILIGHT).lerp(DAY_UPPER_MID, daylight);
  state.upperMidColor.lerp(SUNSET_UPPER_MID, sunset * 0.72 * clear);
  state.upperMidColor.lerp(STORM_MID, storm * 0.72);

  state.lowerMidColor.copy(AMBIENT_TWILIGHT).lerp(DAY_LOWER_MID, daylight);
  state.lowerMidColor.lerp(SUNSET_LOWER_MID, sunset * 0.94 * clear);
  state.lowerMidColor.lerp(STORM_MID, storm * 0.66);

  state.horizonColor.copy(AMBIENT_TWILIGHT).lerp(DAY_HORIZON, daylight);
  state.horizonColor.lerp(SUNSET_HORIZON, sunset * clear);
  state.horizonColor.lerp(DEEP_SUNSET_HORIZON, horizonFire * 0.52 * clear);
  state.horizonColor.lerp(STORM_HORIZON, storm * 0.62);

  state.hazeColor.copy(AMBIENT_TWILIGHT).lerp(HAZE_DAY, daylight);
  state.hazeColor.lerp(HAZE_SUNSET, sunset * 0.90 * clear);
  state.hazeColor.lerp(STORM_HORIZON, storm * 0.58);

  // White-hot core, warm optical halo. The actual global directional light is
  // warmer than the photosphere because it represents transmitted sunlight.
  state.solarCoreColor.copy(HOT_CORE);
  state.solarDiscColor.copy(SUN_DAY)
    .lerp(SUN_GOLD, goldenHour * 0.72)
    .lerp(SUN_ORANGE, horizonFire * 0.56);
  state.solarHaloColor.copy(HALO_GOLD)
    .lerp(SUN_ORANGE, horizonFire * 0.42);
  state.directLightColor.copy(SUN_DAY)
    .lerp(SUN_GOLD, goldenHour * 0.72)
    .lerp(SUN_ORANGE, horizonFire * 0.48);

  state.ambientColor.copy(AMBIENT_NIGHT).lerp(AMBIENT_DAY, daylight);
  state.ambientColor.lerp(AMBIENT_GOLD, goldenHour * 0.46 * clear);
  state.ambientColor.lerp(AMBIENT_TWILIGHT, twilight * 0.34);
  state.ambientColor.lerp(AMBIENT_STORM, storm * 0.70);

  state.waterSunTint.copy(WATER_SUN_DAY)
    .lerp(WATER_SUN_GOLD, goldenHour * 0.86)
    .lerp(WATER_SUN_ORANGE, horizonFire * 0.36);

  state.cloudLightTint.copy(CLOUD_LIGHT_DAY)
    .lerp(CLOUD_LIGHT_GOLD, goldenHour * 0.82)
    .lerp(CLOUD_LIGHT_ORANGE, horizonFire * 0.30);
  state.cloudShadowTint.copy(CLOUD_SHADOW_DAY)
    .lerp(CLOUD_SHADOW_GOLD, goldenHour * 0.42 * clear)
    .lerp(CLOUD_SHADOW_STORM, storm * 0.76);

  state.highSun = highSun;
  return state;
}
