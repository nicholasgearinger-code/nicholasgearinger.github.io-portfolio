import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model34.js";

export * from "./volumetricClouds_r185_model34.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 3.5 — solar forward-scattering coupling.
//
// 3.3 remains the structural renderer and keeps its single reference-atlas lookup
// per view sample. This wrapper only retunes existing lighting uniforms after the
// inherited update: no additional cloud raymarch sample and no new 3D texture
// fetch. Broken clouds near the Sun get hotter gold/silver rims, dense interiors
// stay cool, and the contrast is strongest at sunrise/sunset.
// -----------------------------------------------------------------------------

const WARM_EDGE = new THREE.Color(0xffb56f);
const COOL_SHADOW = new THREE.Color(0x626b83);
const TMP = new THREE.Color();

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function maxChannel(c) {
  if (!c?.isColor) return 1;
  return Math.max(c.r, c.g, c.b, 0.0001);
}

function tuneSolarForwardScattering(handle, sunColor, rainIntensity = 0) {
  const u = handle?.uniforms;
  if (!u) return;

  const celestial = globalThis.__riftCelestialModel35 || globalThis.__riftCelestialModel34 || {};
  const weather = globalThis.__riftProceduralWeatherState || {};
  const altitudeDeg = Number(celestial.altitudeDeg) || -90;
  const storm = clamp01(weather.stormIntensity ?? celestial.storm ?? rainIntensity);
  const clear = 1 - storm;
  const daylight = clamp01(celestial.daylight ?? 1);
  const golden = clamp01(
    celestial.goldenHour
      ?? celestial.sunsetStrength
      ?? (altitudeDeg > -5 && altitudeDeg < 20 ? 1 - Math.abs(altitudeDeg - 5) / 15 : 0),
  ) * clear;
  const cloudT = clamp01(
    globalThis.__riftCloudShadowState?.averageTransmittance
      ?? celestial.cloudTransmittance
      ?? (1 - clamp01(globalThis.__riftProceduralCloudOcclusion || 0)),
  );
  const brokenCloud = clamp01(1 - Math.abs(cloudT * 2 - 1));
  const shaftWindow = golden * THREE.MathUtils.lerp(0.72, 1.0, brokenCloud);

  if (u.sunColor?.value?.isColor) {
    const energy = maxChannel(u.sunColor.value);
    TMP.copy(sunColor?.isColor ? sunColor : celestial.sunColor || WARM_EDGE);
    TMP.lerp(WARM_EDGE, golden * 0.62);
    TMP.multiplyScalar(energy / maxChannel(TMP));
    u.sunColor.value.lerp(TMP, golden * 0.78);
    u.sunColor.value.multiplyScalar(1 + shaftWindow * 0.34 * daylight);
  }

  if (u.ambientColor?.value?.isColor) {
    const energy = maxChannel(u.ambientColor.value);
    TMP.copy(COOL_SHADOW).multiplyScalar(energy / maxChannel(COOL_SHADOW));
    u.ambientColor.value.lerp(TMP, golden * 0.24);
  }

  if (u.m2SilverStrength) {
    const target = THREE.MathUtils.lerp(0.52, 0.92, shaftWindow)
      * THREE.MathUtils.lerp(1.0, 0.42, storm);
    u.m2SilverStrength.value = THREE.MathUtils.lerp(
      Number(u.m2SilverStrength.value) || target,
      target,
      0.76,
    );
  }
  if (u.m31CrownLightBoost) {
    const target = THREE.MathUtils.lerp(1.14, 1.56, shaftWindow)
      * THREE.MathUtils.lerp(1.0, 0.90, storm);
    u.m31CrownLightBoost.value = THREE.MathUtils.lerp(
      Number(u.m31CrownLightBoost.value) || target,
      target,
      0.72,
    );
  }
  if (u.m31SelfShadow) {
    u.m31SelfShadow.value = THREE.MathUtils.lerp(
      Number(u.m31SelfShadow.value) || 0.95,
      THREE.MathUtils.lerp(0.98, 1.14, shaftWindow),
      0.60,
    );
  }
  if (u.m31BaseDarkening) {
    u.m31BaseDarkening.value = THREE.MathUtils.lerp(
      Number(u.m31BaseDarkening.value) || 0.50,
      THREE.MathUtils.lerp(0.52, 0.67, shaftWindow),
      0.60,
    );
  }
  if (u.m2MultiScatter) {
    u.m2MultiScatter.value = THREE.MathUtils.lerp(
      Number(u.m2MultiScatter.value) || 0.24,
      THREE.MathUtils.lerp(0.24, 0.32, shaftWindow),
      0.52,
    );
  }

  globalThis.__riftCloudModel35Debug = {
    active: true,
    version: "3.5-solar-forward-scattering",
    architecture: "Model 3.3 structure + existing Model 3.1 HG/self-shadow shader + uniform-only low-Sun radiance coupling",
    altitudeDeg,
    daylight,
    storm,
    golden,
    cloudTransmittance: cloudT,
    brokenCloud,
    shaftWindow,
    silverStrength: u.m2SilverStrength?.value,
    crownLightBoost: u.m31CrownLightBoost?.value,
    selfShadow: u.m31SelfShadow?.value,
    baseDarkening: u.m31BaseDarkening?.value,
    threeRevision: THREE.REVISION,
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (handle) handle.__riftModel35 = true;
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
    handle,
    dt,
    camera,
    sunDirection,
    sunColor,
    ambientColor,
    lightningFlash,
    lightningColor,
    windX,
    windZ,
    rainIntensity,
    currentBiome,
  );

  if (!handle || !camera) return;
  tuneSolarForwardScattering(handle, sunColor, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  if (handle) handle.__riftModel35 = false;
  delete globalThis.__riftCloudModel35Debug;
  return base.disposeVolumetricClouds(handle);
}
