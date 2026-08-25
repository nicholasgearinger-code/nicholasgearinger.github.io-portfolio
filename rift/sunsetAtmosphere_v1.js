import * as THREE from "three";

// Shared photographic sunrise / sunset atmosphere state.
// Clear weather preserves a distinctly blue upper sky while concentrating
// yellow/orange/red energy close to the horizon. Storms progressively collapse
// that separation into a cooler gray atmosphere.

const NIGHT_ZENITH = new THREE.Color(0x071625);
const DAY_ZENITH = new THREE.Color(0x3f91cf);
const SUNSET_ZENITH = new THREE.Color(0x2f70ad);
const DAY_UPPER_MID = new THREE.Color(0x82bce2);
const SUNSET_UPPER_MID = new THREE.Color(0x7797bd);
const DAY_LOWER_MID = new THREE.Color(0xc0ddea);
const SUNSET_LOWER_MID = new THREE.Color(0xffa04c);
const DAY_HORIZON = new THREE.Color(0xd2e8ef);
const SUNSET_HORIZON = new THREE.Color(0xff641d);
const DEEP_SUNSET_HORIZON = new THREE.Color(0xe83b20);
const STORM_ZENITH = new THREE.Color(0x596a79);
const STORM_MID = new THREE.Color(0x7b8288);
const STORM_HORIZON = new THREE.Color(0x8d817d);

const HOT_CORE = new THREE.Color(0xfffff8);
const SUN_DAY = new THREE.Color(0xfffff5);
const SUN_GOLD = new THREE.Color(0xffbc52);
const SUN_ORANGE = new THREE.Color(0xff7d22);
const HALO_GOLD = new THREE.Color(0xff9b34);
const HAZE_DAY = new THREE.Color(0xd6e7ed);
const HAZE_SUNSET = new THREE.Color(0xff8c42);

const AMBIENT_DAY = new THREE.Color(0x9fbfd7);
const AMBIENT_GOLD = new THREE.Color(0xc48772);
const AMBIENT_TWILIGHT = new THREE.Color(0x6c7090);
const AMBIENT_NIGHT = new THREE.Color(0x52637c);
const AMBIENT_STORM = new THREE.Color(0x77848e);

const WATER_SUN_DAY = new THREE.Color(0xfff4da);
const WATER_SUN_GOLD = new THREE.Color(0xffc24d);
const WATER_SUN_ORANGE = new THREE.Color(0xff8a24);
const CLOUD_LIGHT_DAY = new THREE.Color(0xfbfdff);
const CLOUD_LIGHT_GOLD = new THREE.Color(0xffba68);
const CLOUD_LIGHT_ORANGE = new THREE.Color(0xff8240);
const CLOUD_SHADOW_DAY = new THREE.Color(0x92a7bb);
const CLOUD_SHADOW_GOLD = new THREE.Color(0xa56e6b);
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
    highSun: 0,
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

  // Civil twilight begins around -6 degrees. The photographic sunset band is
  // concentrated from just below the horizon to roughly +12 degrees.
  const daylight = smooth01((altitude + 6.0) / 12.0);
  const riseIntoGold = smooth01((altitude + 5.0) / 7.0);
  const leaveGold = smooth01((altitude - 1.5) / 13.5);
  const goldenHour = riseIntoGold * (1 - leaveGold);
  const horizonFire = smooth01((altitude + 3.4) / 4.4)
    * (1 - smooth01((altitude - 0.1) / 7.2));
  const sunset = Math.max(goldenHour * 0.84, horizonFire);
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
  state.highSun = highSun;

  state.zenithColor.copy(NIGHT_ZENITH).lerp(DAY_ZENITH, daylight);
  // Keep the upper hemisphere blue at clear sunset instead of washing the entire
  // sky peach/pink. This is the strongest visual change versus the previous pass.
  state.zenithColor.lerp(SUNSET_ZENITH, sunset * 0.76 * clear);
  state.zenithColor.lerp(STORM_ZENITH, storm * 0.76);

  state.upperMidColor.copy(AMBIENT_TWILIGHT).lerp(DAY_UPPER_MID, daylight);
  state.upperMidColor.lerp(SUNSET_UPPER_MID, sunset * 0.80 * clear);
  state.upperMidColor.lerp(STORM_MID, storm * 0.72);

  state.lowerMidColor.copy(AMBIENT_TWILIGHT).lerp(DAY_LOWER_MID, daylight);
  state.lowerMidColor.lerp(SUNSET_LOWER_MID, sunset * clear);
  state.lowerMidColor.lerp(STORM_MID, storm * 0.66);

  state.horizonColor.copy(AMBIENT_TWILIGHT).lerp(DAY_HORIZON, daylight);
  state.horizonColor.lerp(SUNSET_HORIZON, sunset * clear);
  state.horizonColor.lerp(DEEP_SUNSET_HORIZON, horizonFire * 0.72 * clear);
  state.horizonColor.lerp(STORM_HORIZON, storm * 0.62);

  state.hazeColor.copy(AMBIENT_TWILIGHT).lerp(HAZE_DAY, daylight);
  state.hazeColor.lerp(HAZE_SUNSET, sunset * clear);
  state.hazeColor.lerp(STORM_HORIZON, storm * 0.58);

  // The visible core remains white-hot. The shell and transmitted direct beam
  // become progressively warmer as the optical path through the atmosphere grows.
  state.solarCoreColor.copy(HOT_CORE);
  state.solarDiscColor.copy(SUN_DAY)
    .lerp(SUN_GOLD, goldenHour * 0.84)
    .lerp(SUN_ORANGE, horizonFire * 0.74);
  state.solarHaloColor.copy(HALO_GOLD)
    .lerp(SUN_ORANGE, horizonFire * 0.58);
  state.directLightColor.copy(SUN_DAY)
    .lerp(SUN_GOLD, goldenHour * 0.80)
    .lerp(SUN_ORANGE, horizonFire * 0.58);

  state.ambientColor.copy(AMBIENT_NIGHT).lerp(AMBIENT_DAY, daylight);
  state.ambientColor.lerp(AMBIENT_GOLD, goldenHour * 0.48 * clear);
  state.ambientColor.lerp(AMBIENT_TWILIGHT, twilight * 0.34);
  state.ambientColor.lerp(AMBIENT_STORM, storm * 0.70);

  state.waterSunTint.copy(WATER_SUN_DAY)
    .lerp(WATER_SUN_GOLD, goldenHour * 0.92)
    .lerp(WATER_SUN_ORANGE, horizonFire * 0.52);

  state.cloudLightTint.copy(CLOUD_LIGHT_DAY)
    .lerp(CLOUD_LIGHT_GOLD, goldenHour * 0.88)
    .lerp(CLOUD_LIGHT_ORANGE, horizonFire * 0.44);
  state.cloudShadowTint.copy(CLOUD_SHADOW_DAY)
    .lerp(CLOUD_SHADOW_GOLD, goldenHour * 0.46 * clear)
    .lerp(CLOUD_SHADOW_STORM, storm * 0.76);

  return state;
}
