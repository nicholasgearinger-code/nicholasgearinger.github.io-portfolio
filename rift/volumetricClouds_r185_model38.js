import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model37.js";

export * from "./volumetricClouds_r185_model37.js";

const TMP_VIEW = new THREE.Vector3();
const TMP_SUN = new THREE.Vector3();
const TMP_MOON = new THREE.Vector3();
const TMP_COLOR = new THREE.Color();
const DAY_RIM = new THREE.Color(0xfff9e8);
const GOLD_RIM = new THREE.Color(0xffc66e);
const FIRE_RIM = new THREE.Color(0xff7c3f);
const MOON_RIM = new THREE.Color(0xaec9ff);
const COOL_FILL = new THREE.Color(0x52677e);

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

function maxChannel(c) {
  return c?.isColor ? Math.max(c.r, c.g, c.b, 1e-4) : 1;
}

function readLightingState(camera, sunDirection) {
  const optics = globalThis.__riftCelestialOpticsV14 || {};
  const sunset = globalThis.__riftSunsetAtmosphereV9
    || globalThis.__riftSunsetAtmosphereV8
    || globalThis.__riftSkyPhysicalV13
    || {};

  camera.getWorldDirection(TMP_VIEW).normalize();
  TMP_SUN.copy(optics.sunDirection?.isVector3 ? optics.sunDirection : sunDirection || new THREE.Vector3(0, 1, 0)).normalize();
  TMP_MOON.copy(optics.moonDirection?.isVector3 ? optics.moonDirection : new THREE.Vector3(0, -1, 0)).normalize();

  const sunY = THREE.MathUtils.clamp(TMP_SUN.y, -1, 1);
  const moonY = THREE.MathUtils.clamp(TMP_MOON.y, -1, 1);
  let altitudeDeg = Number(sunset.altitudeDeg);
  if (!Number.isFinite(altitudeDeg)) altitudeDeg = THREE.MathUtils.radToDeg(Math.asin(sunY));

  const day = clamp01(optics.dayAmount ?? smoothRange(-0.08, 0.10, sunY));
  const night = 1 - day;
  const sunAbove = smoothRange(-0.035, 0.075, sunY);
  const moonAbove = smoothRange(-0.04, 0.10, moonY);
  const sunFacing = smoothRange(0.18, 0.94, TMP_VIEW.dot(TMP_SUN));
  const moonFacing = smoothRange(0.30, 0.96, TMP_VIEW.dot(TMP_MOON));

  const lowSun = clamp01(
    sunset.sunsetStrength
      ?? (smoothRange(-6, 1.5, altitudeDeg) * (1 - smoothRange(14, 27, altitudeDeg)))
  );
  const golden = clamp01(
    sunset.goldenHour
      ?? (smoothRange(-3, 2, altitudeDeg) * (1 - smoothRange(12, 23, altitudeDeg)))
  );
  const fire = clamp01(
    sunset.horizonFire
      ?? (smoothRange(-4, -0.2, altitudeDeg) * (1 - smoothRange(5, 11, altitudeDeg)))
  );

  const sunOcc = clamp01(globalThis.__riftSunDiskOcclusion || 0);
  const partialOcc = 1 - Math.min(1, Math.abs(sunOcc - 0.48) / 0.48);
  const avgT = clamp01(globalThis.__riftCloudShadowState?.averageTransmittance ?? 0.72);
  const brokenCloud = clamp01(1 - Math.abs(avgT * 2 - 1));
  const weather = globalThis.__riftProceduralWeatherState || {};
  const storm = clamp01(weather.stormIntensity ?? 0);
  const clear = 1 - storm;

  const solarRim = sunAbove
    * day
    * sunFacing
    * clear
    * (0.30 + 0.50 * partialOcc + 0.20 * brokenCloud)
    * (0.62 + 0.78 * lowSun);

  const moonIllumination = clamp01(optics.moonIllumination ?? 1);
  const lunarRim = night
    * moonAbove
    * moonFacing
    * Math.pow(moonIllumination, 0.82)
    * (0.28 + 0.72 * clamp01(globalThis.__riftMoonDiskOcclusion || 0))
    * (1 - storm * 0.65);

  const dramatic = clamp01(Math.max(solarRim, lunarRim * 0.42));
  return {
    altitudeDeg, day, night, lowSun, golden, fire, sunFacing, moonFacing,
    sunOcc, partialOcc, storm,
    solarRim: clamp01(solarRim),
    lunarRim: clamp01(lunarRim),
    dramatic,
  };
}

function applyDramaticLighting(handle, camera, sunDirection) {
  const u = handle?.uniforms;
  if (!u || !camera) return null;
  const s = readLightingState(camera, sunDirection);

  if (u.m2SilverStrength) {
    const target = s.night > 0.58
      ? THREE.MathUtils.lerp(0.42, 1.10, s.lunarRim)
      : THREE.MathUtils.lerp(0.58, 2.15, s.solarRim);
    u.m2SilverStrength.value = THREE.MathUtils.lerp(Number(u.m2SilverStrength.value) || 0.58, target, 0.80);
  }
  if (u.m31CrownLightBoost) {
    const target = THREE.MathUtils.lerp(1.18, 1.95, s.dramatic) * THREE.MathUtils.lerp(1, 0.90, s.storm);
    u.m31CrownLightBoost.value = THREE.MathUtils.lerp(Number(u.m31CrownLightBoost.value) || 1.18, target, 0.72);
  }
  if (u.m31SelfShadow) {
    const target = 1.02 + s.lowSun * 0.22 + s.solarRim * 0.28 + s.storm * 0.12;
    u.m31SelfShadow.value = THREE.MathUtils.lerp(Number(u.m31SelfShadow.value) || 1.02, target, 0.68);
  }
  if (u.m31BaseDarkening) {
    const target = 0.56 + s.lowSun * 0.18 + s.dramatic * 0.15 + s.storm * 0.08;
    u.m31BaseDarkening.value = THREE.MathUtils.lerp(Number(u.m31BaseDarkening.value) || 0.56, target, 0.70);
  }
  if (u.m2LightExtinction) {
    const target = 0.70 + s.lowSun * 0.17 + s.solarRim * 0.22 + s.storm * 0.10;
    u.m2LightExtinction.value = THREE.MathUtils.lerp(Number(u.m2LightExtinction.value) || 0.72, target, 0.64);
  }
  if (u.m2AmbientStrength) {
    const target = THREE.MathUtils.lerp(0.57, 0.31, s.dramatic) * THREE.MathUtils.lerp(1, 0.90, s.storm);
    u.m2AmbientStrength.value = THREE.MathUtils.lerp(Number(u.m2AmbientStrength.value) || 0.56, target, 0.72);
  }
  if (u.m2MultiScatter) {
    const target = s.night > 0.58
      ? THREE.MathUtils.lerp(0.20, 0.27, s.lunarRim)
      : THREE.MathUtils.lerp(0.25, 0.41, s.solarRim * (0.55 + 0.45 * s.partialOcc));
    u.m2MultiScatter.value = THREE.MathUtils.lerp(Number(u.m2MultiScatter.value) || 0.26, target, 0.62);
  }

  if (u.sunColor?.value?.isColor) {
    const energy = maxChannel(u.sunColor.value);
    if (s.night > 0.58 && s.lunarRim > 0.01) {
      TMP_COLOR.copy(MOON_RIM).multiplyScalar(THREE.MathUtils.lerp(0.16, 0.48, s.lunarRim));
      u.sunColor.value.lerp(TMP_COLOR, 0.32 + s.lunarRim * 0.36);
    } else {
      TMP_COLOR.copy(DAY_RIM)
        .lerp(GOLD_RIM, Math.max(s.golden, s.lowSun * 0.58))
        .lerp(FIRE_RIM, s.fire * 0.88);
      const sourceBoost = 1 + s.solarRim * (0.22 + s.lowSun * 0.34);
      TMP_COLOR.multiplyScalar((energy / maxChannel(TMP_COLOR)) * sourceBoost);
      u.sunColor.value.lerp(TMP_COLOR, 0.24 + s.solarRim * 0.52 + s.lowSun * 0.12);
    }
  }

  if (u.ambientColor?.value?.isColor && s.dramatic > 0.01) {
    const energy = maxChannel(u.ambientColor.value);
    TMP_COLOR.copy(COOL_FILL).multiplyScalar(energy / maxChannel(COOL_FILL));
    u.ambientColor.value.lerp(TMP_COLOR, 0.12 + s.dramatic * 0.24);
  }

  globalThis.__riftCloudModel38Lighting = {
    version: "3.8-dramatic-directional-lighting",
    altitudeDeg: s.altitudeDeg,
    sunFacing: s.sunFacing,
    moonFacing: s.moonFacing,
    solarRim: s.solarRim,
    lunarRim: s.lunarRim,
    sunOcclusion: s.sunOcc,
    partialOcclusion: s.partialOcc,
    lowSun: s.lowSun,
    goldenHour: s.golden,
    horizonFire: s.fire,
    ambientStrength: Number(u.m2AmbientStrength?.value) || 0,
    silverStrength: Number(u.m2SilverStrength?.value) || 0,
    crownBoost: Number(u.m31CrownLightBoost?.value) || 0,
    selfShadow: Number(u.m31SelfShadow?.value) || 0,
  };
  return s;
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (handle) handle.__riftModel38 = true;
  return handle;
}

export function updateVolumetricClouds(
  handle,
  dt,
  camera,
  sunDirection,
  sunColor,
  ambientColor,
  lightningFlash,
  lightningColor,
  windX = 0,
  windZ = 0,
  rainIntensity = 0,
  currentBiome = "default",
) {
  base.updateVolumetricClouds(
    handle, dt, camera, sunDirection, sunColor, ambientColor,
    lightningFlash, lightningColor, windX, windZ, rainIntensity, currentBiome,
  );
  if (!handle || !camera) return;
  const lighting = applyDramaticLighting(handle, camera, sunDirection);
  globalThis.__riftCloudModel38 = {
    version: "3.8-reference-volume-dramatic-lighting",
    baseVersion: globalThis.__riftCloudModel37?.version || "3.7",
    solarRim: lighting?.solarRim ?? 0,
    lunarRim: lighting?.lunarRim ?? 0,
    lowSun: lighting?.lowSun ?? 0,
    sunFacing: lighting?.sunFacing ?? 0,
    sunOcclusion: lighting?.sunOcc ?? 0,
    renderScale: handle.__riftModel2Quality?.renderScale || 0,
    viewSteps: handle.__riftModel2Quality?.viewSteps || 0,
    lightSteps: handle.__riftModel2Quality?.lightSteps || 0,
    threeRevision: THREE.REVISION,
  };
}

export function disposeVolumetricClouds(handle) {
  delete globalThis.__riftCloudModel38Lighting;
  delete globalThis.__riftCloudModel38;
  return base.disposeVolumetricClouds(handle);
}
