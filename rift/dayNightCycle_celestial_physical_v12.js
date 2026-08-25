import * as THREE from "three";
import * as base from "./dayNightCycle_celestial_physical_v10.js";

export * from "./dayNightCycle_celestial_physical_v10.js";

// -----------------------------------------------------------------------------
// Celestial / atmosphere v12 — Sky Pro/Preetham-inspired analytic atmosphere.
//
// v11 rendered Three r185's SkyMesh directly over Rift's existing atmosphere.
// On iOS/WebGPU that extra full-screen node-material pass produced a very dark
// twilight/low-Sun result and made low-resolution volumetric clouds look like
// glowing cards against black. v12 keeps SkyMesh/Preetham as the physical model
// reference (turbidity, Rayleigh, Mie and anisotropy), but applies those controls
// to Rift's proven lightweight vertex-colored atmosphere dome instead of drawing
// a second sky pass.
//
// Result: one sky renderer, one photographic Sun, one volumetric-cloud system,
// and one shared lighting palette for terrain/water/clouds.
// -----------------------------------------------------------------------------

const ORBIT_RADIUS = 260;
const SUN_HORIZON_OFFSET = 10;
const stateByCycle = new WeakMap();

const CLEAR_ZENITH = new THREE.Color(0x3f86c9);
const CLEAR_HORIZON = new THREE.Color(0xb9d7e9);
const HUMID_HORIZON = new THREE.Color(0xd9e1e5);
const GOLD_HORIZON = new THREE.Color(0xf2a06b);
const FIRE_HORIZON = new THREE.Color(0xde643d);
const TWILIGHT_ZENITH = new THREE.Color(0x304c75);
const STORM_ZENITH = new THREE.Color(0x566675);
const STORM_HORIZON = new THREE.Color(0x89949d);
const HAZE_CLEAR = new THREE.Color(0xcbddea);
const HAZE_WARM = new THREE.Color(0xe9a16e);
const HAZE_STORM = new THREE.Color(0x808b95);
const SKY_AMBIENT_CLEAR = new THREE.Color(0xa4bdd0);
const SKY_AMBIENT_STORM = new THREE.Color(0x7d8994);

const TMP_DIR = new THREE.Vector3();
const TMP_COLOR = new THREE.Color();
const TMP_ZENITH = new THREE.Color();
const TMP_HORIZON = new THREE.Color();
const TMP_HAZE = new THREE.Color();
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

function solarAltitudeDeg(cycle) {
  const y = cycle?.sunBody?.group?.position?.y;
  if (!Number.isFinite(y)) return -90;
  const sinAltitude = THREE.MathUtils.clamp((y - SUN_HORIZON_OFFSET) / ORBIT_RADIUS, -1, 1);
  return THREE.MathUtils.radToDeg(Math.asin(sinAltitude));
}

function cloudTransmittance() {
  const coarse = Number(globalThis.__riftCloudShadowState?.averageTransmittance);
  if (Number.isFinite(coarse)) return clamp01(coarse);
  return 1 - clamp01(globalThis.__riftProceduralCloudOcclusion || 0);
}

function updateDome(atmosphere, state) {
  const dome = atmosphere?.dome;
  const pos = dome?.position;
  const colors = dome?.color?.array;
  if (!pos || !colors) return;

  for (let i = 0; i < pos.count; i++) {
    TMP_DIR.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const alt = clamp01((TMP_DIR.y + 0.055) / 1.055);
    const vertical = Math.pow(alt, 0.60 + state.turbidity * 0.008);
    TMP_COLOR.copy(state.horizonColor).lerp(state.zenithColor, vertical);

    // Mie/aerosol haze stays near the horizon rather than whitening the whole sky.
    const hazeBand = Math.pow(1 - alt, THREE.MathUtils.lerp(6.5, 3.9, state.storm))
      * (0.045 + state.humidity * 0.055 + state.storm * 0.11);
    TMP_COLOR.lerp(state.hazeColor, clamp01(hazeBand));

    // Henyey-Greenstein-inspired forward lobe around the actual Sun direction.
    const mu = THREE.MathUtils.clamp(TMP_DIR.dot(state.sunDirection), -1, 1);
    const g = state.mieDirectionalG;
    const denom = Math.pow(Math.max(0.04, 1 + g * g - 2 * g * mu), 1.5);
    const hg = (1 - g * g) / denom;
    const forward = clamp01(hg * 0.018 * state.daylight)
      * (0.35 + state.lowSun * 0.90)
      * (1 - state.storm * 0.38);
    TMP_COLOR.lerp(state.sunTint, clamp01(forward));

    const j = i * 3;
    colors[j] = TMP_COLOR.r;
    colors[j + 1] = TMP_COLOR.g;
    colors[j + 2] = TMP_COLOR.b;
  }
  dome.color.needsUpdate = true;
}

function applyAnalyticAtmosphere(cycle, dt, result = null) {
  if (!cycle) return result;

  let state = stateByCycle.get(cycle);
  if (!state) {
    state = {
      version: "12-preetham-reference-single-dome",
      sunDirection: new THREE.Vector3(0.3, 0.8, 0.2).normalize(),
      sunTint: new THREE.Color(0xfffff5),
      zenithColor: CLEAR_ZENITH.clone(),
      horizonColor: CLEAR_HORIZON.clone(),
      hazeColor: HAZE_CLEAR.clone(),
      ambientColor: SKY_AMBIENT_CLEAR.clone(),
      altitudeDeg: -90,
      daylight: 0,
      lowSun: 0,
      storm: 0,
      humidity: 0.65,
      cloudTransmittance: 1,
      turbidity: 3.0,
      rayleigh: 2.4,
      mieCoefficient: 0.005,
      mieDirectionalG: 0.80,
    };
    stateByCycle.set(cycle, state);
  }

  const atmosphere = globalThis.__riftReferenceAtmosphere;
  if (!atmosphere) return result;

  const weather = globalThis.__riftProceduralWeatherState;
  const sunset = globalThis.__riftSunsetAtmosphereV9 || globalThis.__riftSunsetAtmosphereV8;
  state.altitudeDeg = solarAltitudeDeg(cycle);
  state.daylight = smoothRange(-6.0, 8.0, state.altitudeDeg);
  state.lowSun = clamp01(sunset?.sunsetStrength ?? (
    smoothRange(-5.0, 3.5, state.altitudeDeg) * (1 - smoothRange(9.0, 24.0, state.altitudeDeg))
  ));
  state.storm = clamp01(weather?.stormIntensity ?? weather?.rainIntensity ?? atmosphere.storm ?? 0);
  state.humidity = clamp01(weather?.humidity ?? 0.65);
  state.cloudTransmittance = cloudTransmittance();

  const sunPos = cycle?.sunBody?.group?.position;
  if (sunPos?.isVector3) state.sunDirection.copy(sunPos).normalize();
  if (cycle?.sun?.color?.isColor) state.sunTint.copy(cycle.sun.color);

  // Sky/Preetham-style control values are preserved as real diagnostics and also
  // drive the artistic approximation below. Clear tropical air stays blue; humid
  // or stormy air increases turbidity/Mie and desaturates the horizon.
  state.turbidity = 2.2 + state.humidity * 1.8 + state.lowSun * 1.2 + state.storm * 6.5;
  state.rayleigh = THREE.MathUtils.lerp(2.7, 1.15, state.storm)
    * THREE.MathUtils.lerp(1.0, 0.86, state.lowSun);
  state.mieCoefficient = 0.0028 + state.humidity * 0.0045 + state.lowSun * 0.0038 + state.storm * 0.010;
  state.mieDirectionalG = THREE.MathUtils.lerp(0.79 + state.humidity * 0.035, 0.89, state.storm);

  const highSun = smoothRange(12.0, 42.0, state.altitudeDeg);
  const civilTwilight = 1 - smoothRange(-6.0, 4.0, state.altitudeDeg);
  const clearFactor = 1 - state.storm;

  TMP_ZENITH.copy(TWILIGHT_ZENITH).lerp(CLEAR_ZENITH, state.daylight);
  TMP_ZENITH.lerp(STORM_ZENITH, state.storm * 0.82);
  TMP_ZENITH.multiplyScalar(THREE.MathUtils.lerp(0.90, 1.0, highSun));

  TMP_HORIZON.copy(CLEAR_HORIZON).lerp(HUMID_HORIZON, state.humidity * 0.44);
  TMP_HORIZON.lerp(GOLD_HORIZON, state.lowSun * clearFactor * 0.72);
  TMP_HORIZON.lerp(FIRE_HORIZON, state.lowSun * clearFactor * civilTwilight * 0.34);
  TMP_HORIZON.lerp(STORM_HORIZON, state.storm * 0.76);

  TMP_HAZE.copy(HAZE_CLEAR)
    .lerp(HAZE_WARM, state.lowSun * clearFactor * 0.68)
    .lerp(HAZE_STORM, state.storm * 0.72);

  TMP_AMBIENT.copy(SKY_AMBIENT_CLEAR)
    .lerp(SKY_AMBIENT_STORM, state.storm * 0.70)
    .lerp(GOLD_HORIZON, state.lowSun * clearFactor * 0.12);

  state.zenithColor.copy(TMP_ZENITH);
  state.horizonColor.copy(TMP_HORIZON);
  state.hazeColor.copy(TMP_HAZE);
  state.ambientColor.copy(TMP_AMBIENT);

  atmosphere.zenithColor.copy(state.zenithColor);
  atmosphere.horizonColor.copy(state.horizonColor);
  atmosphere.hazeColor.copy(state.hazeColor);
  atmosphere.ambientColor.copy(state.ambientColor);
  atmosphere.sunColor.copy(state.sunTint);
  atmosphere.daylight = state.daylight;
  atmosphere.lowSun = state.lowSun;
  atmosphere.storm = state.storm;
  atmosphere.backgroundColor.copy(state.horizonColor).lerp(state.zenithColor, 0.62);

  // Keep twilight exposed enough to read silhouettes and cloud interiors. The
  // previous direct SkyMesh pass effectively crushed this range toward black.
  const daylightExposure = THREE.MathUtils.lerp(0.82, 0.99, state.daylight);
  const stormExposure = THREE.MathUtils.lerp(1.0, 0.90, state.storm);
  atmosphere.exposure = Math.max(0.78, daylightExposure * stormExposure);

  if (atmosphere.scene?.background?.isColor) atmosphere.scene.background.copy(atmosphere.backgroundColor);
  updateDome(atmosphere, state);

  // World lighting must follow the same sky. Keep a twilight diffuse floor while
  // the Sun is visible so beaches/trees do not become pitch-black silhouettes.
  if (cycle.ambient) {
    cycle.ambient.color?.copy?.(state.ambientColor);
    const ambientFloor = THREE.MathUtils.lerp(0.10, 0.25, state.daylight)
      * THREE.MathUtils.lerp(1.0, 0.88, state.storm);
    cycle.ambient.intensity = Math.max(Number(cycle.ambient.intensity) || 0, ambientFloor);
  }
  if (cycle.sun && state.altitudeDeg > -2.5) {
    const sunFloor = THREE.MathUtils.lerp(0.36, 1.10, smoothRange(-2.5, 7.0, state.altitudeDeg))
      * THREE.MathUtils.lerp(0.58, 1.0, Math.pow(state.cloudTransmittance, 0.45));
    cycle.sun.intensity = Math.max(Number(cycle.sun.intensity) || 0, sunFloor);
  }

  if (result) {
    result.skyZenith?.copy?.(state.zenithColor);
    result.skyHorizon?.copy?.(state.horizonColor);
    result.ambientColor?.copy?.(cycle.ambient?.color || state.ambientColor);
    result.sunColor?.copy?.(cycle.sun?.color || state.sunTint);
  }

  globalThis.__riftSkyPhysicalV12 = state;
  // Keep the v11 key populated for cloud code written against the first physical
  // atmosphere contract, but mark that no extra SkyMesh render pass is active.
  globalThis.__riftSkyPhysicalV11 = {
    ...state,
    active: true,
    sky: null,
    opacity: 0,
    version: state.version,
    skyDiffuseColor: state.ambientColor,
  };
  globalThis.__riftAtmosphereDebug = {
    version: state.version,
    altitudeDeg: state.altitudeDeg,
    turbidity: state.turbidity,
    rayleigh: state.rayleigh,
    mieCoefficient: state.mieCoefficient,
    mieDirectionalG: state.mieDirectionalG,
    storm: state.storm,
    humidity: state.humidity,
    cloudTransmittance: state.cloudTransmittance,
    exposure: atmosphere.exposure,
    threeRevision: THREE.REVISION,
  };

  return result;
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  const cycle = base.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight);
  applyAnalyticAtmosphere(cycle, 1 / 60, null);
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = base.updateDayNightCycle(cycle, dt);
  return applyAnalyticAtmosphere(cycle, dt, result);
}
