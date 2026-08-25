import * as THREE from "three";
import * as base from "./dayNightCycle_celestial_physical_v5.js";

export * from "./dayNightCycle_celestial_physical_v5.js";

// -----------------------------------------------------------------------------
// Celestial / atmosphere v6 — global solar illumination.
//
// v5 made the visible Sun bright, but its world-light color still moved mostly
// between two artist-picked colors. v6 derives the direct solar color from a
// simple atmospheric optical-path model. As the Sun approaches the horizon the
// blue/green wavelengths are removed progressively, the actual DirectionalLight
// warms and weakens, the ambient sky fill changes with it, and the atmosphere,
// clouds, ocean and any standard lit material all receive the same palette.
// -----------------------------------------------------------------------------

const ORBIT_RADIUS = 260;
const SUN_HORIZON_OFFSET = 10;

const NIGHT_ZENITH = new THREE.Color(0x071626);
const NIGHT_HORIZON = new THREE.Color(0x17263a);
const DAY_ZENITH = new THREE.Color(0x4a82bd);
const DAY_HORIZON = new THREE.Color(0xa8cee6);
const TWILIGHT_ZENITH = new THREE.Color(0x385a91);
const TWILIGHT_HORIZON = new THREE.Color(0xff8a4b);
const TWILIGHT_HAZE = new THREE.Color(0xffb36f);
const DAY_HAZE = new THREE.Color(0xc5dfed);
const NIGHT_HAZE = new THREE.Color(0x17283c);

const NIGHT_AMBIENT = new THREE.Color(0x566984);
const DAY_AMBIENT = new THREE.Color(0x9fbfd5);
const GOLDEN_AMBIENT = new THREE.Color(0xd89469);
const STORM_AMBIENT = new THREE.Color(0x75828d);
const STORM_ZENITH = new THREE.Color(0x667786);
const STORM_HORIZON = new THREE.Color(0x909ba4);

const DEEP_ORANGE = new THREE.Color(0xff7b2e);
const GOLD_HALO = new THREE.Color(0xffa95b);

const TMP_SOLAR = new THREE.Color();
const TMP_AMBIENT = new THREE.Color();
const TMP_ZENITH = new THREE.Color();
const TMP_HORIZON = new THREE.Color();
const TMP_HAZE = new THREE.Color();
const TMP_BG = new THREE.Color();
const TMP_DIR = new THREE.Vector3();
const TMP_DOME_COLOR = new THREE.Color();

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function getSolarAltitudeDegrees(cycle) {
  const y = cycle?.sunBody?.group?.position?.y;
  if (!Number.isFinite(y)) return -90;
  const sinAltitude = THREE.MathUtils.clamp((y - SUN_HORIZON_OFFSET) / ORBIT_RADIUS, -1, 1);
  return THREE.MathUtils.radToDeg(Math.asin(sinAltitude));
}

// Kasten-Young relative optical air mass. Near the horizon the optical path is
// tens of times longer than at zenith, which is why sunset light becomes warm.
function relativeAirMass(altitudeDeg) {
  const h = Math.max(-5.5, altitudeDeg);
  const sinH = Math.sin(THREE.MathUtils.degToRad(Math.max(0, h)));
  const correction = 0.50572 * Math.pow(Math.max(0.15, h + 6.07995), -1.6364);
  return 1 / Math.max(0.026, sinH + correction);
}

function computeSolarColor(altitudeDeg, target) {
  const m = relativeAirMass(altitudeDeg);
  const excess = Math.max(0, m - 1);

  // Approximate broadband extinction. Blue is attenuated most, green next,
  // while red survives the long path. Normalize by red so light intensity is
  // controlled separately from chromaticity.
  const r = Math.exp(-0.008 * excess);
  const g = Math.exp(-0.020 * excess);
  const b = Math.exp(-0.055 * excess);
  const invR = 1 / Math.max(0.001, r);
  target.setRGB(1, clamp01(g * invR), clamp01(b * invR));

  // At the last few degrees the broad-band approximation is conservative;
  // reinforce the familiar deep orange/red solar color without snapping.
  const horizonWarmth = 1 - smooth01((altitudeDeg + 1.0) / 8.0);
  if (horizonWarmth > 0) target.lerp(DEEP_ORANGE, horizonWarmth * 0.58);
  return target;
}

function recolorAtmosphereDome(atmosphere, daylight, goldenHour, storm) {
  const dome = atmosphere?.dome;
  const pos = dome?.position;
  const colorAttr = dome?.color;
  const sunDir = atmosphere?.sunDirection;
  if (!pos || !colorAttr || !sunDir) return;

  const colors = colorAttr.array;
  for (let i = 0; i < pos.count; i++) {
    TMP_DIR.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const altitude = clamp01((TMP_DIR.y + 0.07) / 1.07);
    const vertical = Math.pow(altitude, 0.61);
    TMP_DOME_COLOR.copy(atmosphere.horizonColor).lerp(atmosphere.zenithColor, vertical);

    const horizonHaze = Math.pow(1 - altitude, 5.5) * (0.055 + storm * 0.10);
    TMP_DOME_COLOR.lerp(atmosphere.hazeColor, horizonHaze);

    // Mie-style forward scattering localized around the actual solar direction.
    const sunDot = clamp01(TMP_DIR.dot(sunDir));
    const aureole = Math.pow(sunDot, 24) * daylight * (0.10 + goldenHour * 0.24);
    const core = Math.pow(sunDot, 110) * daylight * (0.15 + goldenHour * 0.17);
    TMP_DOME_COLOR.lerp(atmosphere.sunColor, clamp01(aureole + core));

    const j = i * 3;
    colors[j] = TMP_DOME_COLOR.r;
    colors[j + 1] = TMP_DOME_COLOR.g;
    colors[j + 2] = TMP_DOME_COLOR.b;
  }
  colorAttr.needsUpdate = true;
}

function applyGlobalSolarLighting(cycle, result) {
  if (!cycle) return result;

  const altitudeDeg = getSolarAltitudeDegrees(cycle);
  const sinAltitude = Math.max(0, Math.sin(THREE.MathUtils.degToRad(altitudeDeg)));

  // Civil-twilight sky light starts before the photosphere crosses the horizon.
  const skyDaylight = smooth01((altitudeDeg + 6) / 12);
  // Direct sunlight rises more slowly: at the horizon it should be weak and warm,
  // then become dominant as the Sun clears the lower atmosphere.
  const directGate = smooth01((altitudeDeg + 0.8) / 10.8);
  const highSun = smooth01((altitudeDeg - 8) / 34);
  const goldenHour = smooth01((altitudeDeg + 6) / 8)
    * (1 - smooth01((altitudeDeg - 1) / 14));

  const weather = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(weather?.stormIntensity ?? weather?.rainIntensity ?? 0);
  const weatherTransmission = THREE.MathUtils.lerp(1.0, 0.42, storm);

  computeSolarColor(altitudeDeg, TMP_SOLAR);

  if (cycle.sun) {
    // DirectionalLight is the global source for terrain, props, vegetation,
    // characters and all standard materials. Custom water/cloud paths are fed
    // this same color by main_game, so the whole world now shares one Sun.
    const altitudeEnergy = 0.50 + 0.50 * Math.sqrt(sinAltitude);
    cycle.sun.intensity = 5.0 * directGate * altitudeEnergy * weatherTransmission;
    cycle.sun.color.copy(TMP_SOLAR);
  }

  if (cycle.ambient) {
    TMP_AMBIENT.copy(NIGHT_AMBIENT).lerp(DAY_AMBIENT, skyDaylight);
    TMP_AMBIENT.lerp(GOLDEN_AMBIENT, goldenHour * 0.48);
    TMP_AMBIENT.lerp(STORM_AMBIENT, storm * 0.72);
    cycle.ambient.color?.copy?.(TMP_AMBIENT);

    // Ambient does not stay flat through the day anymore. Golden hour gets less
    // neutral fill so long warm directional shadows remain visible.
    const ambientDay = THREE.MathUtils.lerp(0.075, 0.31, skyDaylight);
    cycle.ambient.intensity = ambientDay
      * THREE.MathUtils.lerp(1.0, 0.72, storm)
      * THREE.MathUtils.lerp(1.0, 0.90, goldenHour);
  }

  const atmosphere = globalThis.__riftReferenceAtmosphere;
  if (atmosphere) {
    TMP_ZENITH.copy(NIGHT_ZENITH).lerp(DAY_ZENITH, skyDaylight);
    TMP_ZENITH.lerp(TWILIGHT_ZENITH, goldenHour * 0.48);
    TMP_ZENITH.lerp(STORM_ZENITH, storm * 0.74);

    TMP_HORIZON.copy(NIGHT_HORIZON).lerp(DAY_HORIZON, skyDaylight);
    TMP_HORIZON.lerp(TWILIGHT_HORIZON, goldenHour * THREE.MathUtils.lerp(0.92, 0.58, storm));
    TMP_HORIZON.lerp(STORM_HORIZON, storm * 0.58);

    TMP_HAZE.copy(NIGHT_HAZE).lerp(DAY_HAZE, skyDaylight);
    TMP_HAZE.lerp(TWILIGHT_HAZE, goldenHour * THREE.MathUtils.lerp(0.90, 0.62, storm));
    TMP_HAZE.lerp(STORM_HORIZON, storm * 0.54);

    atmosphere.daylight = skyDaylight;
    atmosphere.lowSun = goldenHour;
    atmosphere.storm = storm;
    atmosphere.zenithColor.copy(TMP_ZENITH);
    atmosphere.horizonColor.copy(TMP_HORIZON);
    atmosphere.hazeColor.copy(TMP_HAZE);
    atmosphere.ambientColor.copy(TMP_AMBIENT);
    atmosphere.sunColor.copy(TMP_SOLAR);
    TMP_BG.copy(TMP_HORIZON).lerp(TMP_ZENITH, THREE.MathUtils.lerp(0.42, 0.66, highSun));
    atmosphere.backgroundColor.copy(TMP_BG);

    // Exposure follows available sky luminance instead of remaining almost fixed.
    // This makes sunrise/sunset visibly darker than noon while avoiding a sudden
    // brightness jump as the Sun crosses the horizon.
    atmosphere.exposure = THREE.MathUtils.lerp(0.66, 0.99, skyDaylight)
      * THREE.MathUtils.lerp(1.0, 0.86, storm);

    if (atmosphere.scene?.background?.isColor) {
      atmosphere.scene.background.copy(atmosphere.backgroundColor);
    }
    recolorAtmosphereDome(atmosphere, skyDaylight, goldenHour, storm);
  }

  // The visible photosphere and glare now use the exact same atmospheric solar
  // color as the real DirectionalLight instead of a separate artistic gradient.
  const visual = cycle.__riftRealSun;
  if (visual) {
    const cloudOcclusion = clamp01(globalThis.__riftProceduralCloudOcclusion || 0);
    const transmission = 1 - cloudOcclusion;
    const horizon = 1 - smooth01(Math.abs(altitudeDeg) / 12);

    if (visual.discMaterial) {
      visual.discMaterial.color.copy(TMP_SOLAR);
      visual.discMaterial.opacity = skyDaylight * (0.82 + transmission * 0.18);
    }
    if (visual.haloMaterial) {
      visual.haloMaterial.color.copy(GOLD_HALO).lerp(TMP_SOLAR, highSun);
      visual.haloMaterial.opacity = skyDaylight
        * THREE.MathUtils.lerp(0.48, 0.30, highSun)
        * (0.36 + transmission * 0.64);
    }
    if (visual.aureoleMaterial) {
      visual.aureoleMaterial.color.copy(visual.haloMaterial.color);
      visual.aureoleMaterial.opacity = skyDaylight
        * THREE.MathUtils.lerp(0.17, 0.075, highSun)
        * (0.42 + transmission * 0.58);
    }
    if (visual.horizonGlowMaterial) {
      visual.horizonGlowMaterial.color.copy(TWILIGHT_HORIZON);
      visual.horizonGlowMaterial.opacity = goldenHour * horizon * 0.26
        * (0.46 + transmission * 0.54);
    }
  }

  if (result) {
    if (result.sunColor?.isColor) result.sunColor.copy(TMP_SOLAR);
    if (result.skyZenith?.isColor) result.skyZenith.copy(TMP_ZENITH);
    if (result.skyHorizon?.isColor) result.skyHorizon.copy(TMP_HORIZON);
    if (result.ambientColor?.isColor) result.ambientColor.copy(TMP_AMBIENT);
  }

  // Stable shared state for Water Pro, cloud shadows and future atmospheric
  // systems that need exactly the same solar solution without recomputing it.
  const state = globalThis.__riftSolarLightingV6 || {
    sunColor: new THREE.Color(),
    ambientColor: new THREE.Color(),
  };
  state.sunColor.copy(TMP_SOLAR);
  state.ambientColor.copy(TMP_AMBIENT);
  state.altitudeDeg = altitudeDeg;
  state.skyDaylight = skyDaylight;
  state.directGate = directGate;
  state.goldenHour = goldenHour;
  state.highSun = highSun;
  state.storm = storm;
  state.directSunIntensity = Number(cycle.sun?.intensity) || 0;
  state.ambientIntensity = Number(cycle.ambient?.intensity) || 0;
  state.exposure = Number(atmosphere?.exposure) || 1;
  globalThis.__riftSolarLightingV6 = state;

  return result;
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  const cycle = base.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight);
  applyGlobalSolarLighting(cycle, null);
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = base.updateDayNightCycle(cycle, dt);
  return applyGlobalSolarLighting(cycle, result);
}
