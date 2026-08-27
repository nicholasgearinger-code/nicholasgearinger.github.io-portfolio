import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model441.js";

export * from "./volumetricClouds_r185_model441.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 4.5 — stronger solar backlighting on the stable mobile path.
//
// Model 4.4.2 proved that disabling Three r185's native GodraysNode on touch
// removes the mobile CommandEncoder failure. 4.5 keeps that stability decision
// and pushes the existing volumetric light-march uniforms harder when the camera
// is looking toward a low Sun. No extra 3D texture lookup or cloud raymarch is
// added here; the existing Model 3.1 HG/self-shadow shader does the actual work.
// -----------------------------------------------------------------------------

const TMP_WARM = new THREE.Color(0xffbd72);
const TMP_CORE = new THREE.Color(0xfff4cf);
const TMP_SHADOW = new THREE.Color(0x68738d);

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
  if (!c?.isColor) return 1;
  return Math.max(c.r, c.g, c.b, 0.0001);
}

function tuneBacklighting(handle, camera, sunDirection, sunColor, rainIntensity = 0) {
  const u = handle?.uniforms;
  if (!u || !camera || !sunDirection) return;

  const celestial = globalThis.__riftCelestialModel35 || globalThis.__riftCelestialModel34 || {};
  const weather = globalThis.__riftProceduralWeatherState || {};
  const sunY = Number(sunDirection.y) || 0;
  const altitudeState = Number(celestial.altitudeDeg);
  const altitudeDeg = Number.isFinite(altitudeState)
    ? altitudeState
    : THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(sunY, -1, 1)));

  const daylight = clamp01(celestial.daylight ?? smoothRange(-0.10, 0.08, sunY));
  const storm = clamp01(weather.stormIntensity ?? celestial.storm ?? rainIntensity);
  const clearWeather = 1 - storm;
  const golden = clamp01(
    celestial.goldenHour
      ?? celestial.sunsetStrength
      ?? (smoothRange(-5.5, 0.5, altitudeDeg) * (1 - smoothRange(13, 24, altitudeDeg)))
  ) * daylight;

  const cloudT = clamp01(
    globalThis.__riftCloudShadowState?.averageTransmittance
      ?? celestial.cloudTransmittance
      ?? (1 - clamp01(globalThis.__riftProceduralCloudOcclusion || 0)),
  );
  const brokenCloud = clamp01(1 - Math.abs(cloudT * 2 - 1));

  const view = new THREE.Vector3();
  camera.getWorldDirection(view);
  const sunView = clamp01((view.dot(sunDirection) - 0.60) / 0.40);
  const lowSun = smoothRange(-3, 2, altitudeDeg) * (1 - smoothRange(18, 30, altitudeDeg));
  const backlight = clamp01(
    daylight
      * clearWeather
      * Math.max(golden, lowSun * 0.72)
      * (0.30 + brokenCloud * 0.70)
      * (0.22 + sunView * 0.78)
  );

  if (u.sunColor?.value?.isColor) {
    const energy = maxChannel(u.sunColor.value);
    TMP_CORE.copy(sunColor?.isColor ? sunColor : TMP_WARM)
      .lerp(TMP_WARM, golden * 0.72)
      .multiplyScalar((1 + backlight * 0.72) * energy / maxChannel(TMP_CORE));
    u.sunColor.value.lerp(TMP_CORE, 0.72);
  }

  if (u.ambientColor?.value?.isColor) {
    const energy = maxChannel(u.ambientColor.value);
    TMP_SHADOW.multiplyScalar(energy / maxChannel(TMP_SHADOW));
    u.ambientColor.value.lerp(TMP_SHADOW, backlight * 0.18);
  }

  if (u.m2SilverStrength) {
    const target = THREE.MathUtils.lerp(0.64, 1.42, backlight)
      * THREE.MathUtils.lerp(1.0, 0.48, storm);
    u.m2SilverStrength.value = THREE.MathUtils.lerp(
      Number(u.m2SilverStrength.value) || target,
      target,
      0.82,
    );
  }

  if (u.m31CrownLightBoost) {
    const target = THREE.MathUtils.lerp(1.18, 1.86, backlight)
      * THREE.MathUtils.lerp(1.0, 0.90, storm);
    u.m31CrownLightBoost.value = THREE.MathUtils.lerp(
      Number(u.m31CrownLightBoost.value) || target,
      target,
      0.78,
    );
  }

  if (u.m31SelfShadow) {
    const target = THREE.MathUtils.lerp(1.00, 1.18, backlight);
    u.m31SelfShadow.value = THREE.MathUtils.lerp(
      Number(u.m31SelfShadow.value) || target,
      target,
      0.66,
    );
  }

  if (u.m31BaseDarkening) {
    const target = THREE.MathUtils.lerp(0.54, 0.72, backlight);
    u.m31BaseDarkening.value = THREE.MathUtils.lerp(
      Number(u.m31BaseDarkening.value) || target,
      target,
      0.66,
    );
  }

  if (u.m2MultiScatter) {
    const target = THREE.MathUtils.lerp(0.24, 0.34, backlight);
    u.m2MultiScatter.value = THREE.MathUtils.lerp(
      Number(u.m2MultiScatter.value) || target,
      target,
      0.56,
    );
  }

  if (u.m2LightExtinction) {
    // Preserve dark cores while allowing thin, backlit crowns to transmit more
    // of the warm solar radiance. The silver-edge term remains the dominant rim.
    const target = THREE.MathUtils.lerp(1.0, 0.84, backlight);
    u.m2LightExtinction.value = THREE.MathUtils.lerp(
      Number(u.m2LightExtinction.value) || target,
      target,
      0.46,
    );
  }

  globalThis.__riftCloudModel45Debug = {
    active: true,
    version: "4.5-backlit-clouds-custom-mobile-rays",
    altitudeDeg,
    daylight,
    storm,
    golden,
    lowSun,
    sunView,
    cloudTransmittance: cloudT,
    brokenCloud,
    backlight,
    silverStrength: u.m2SilverStrength?.value,
    crownLightBoost: u.m31CrownLightBoost?.value,
    selfShadow: u.m31SelfShadow?.value,
    baseDarkening: u.m31BaseDarkening?.value,
    multiScatter: u.m2MultiScatter?.value,
    threeRevision: THREE.REVISION,
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (handle) handle.__riftModel45 = true;
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

  tuneBacklighting(handle, camera, sunDirection, sunColor, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  if (handle) handle.__riftModel45 = false;
  delete globalThis.__riftCloudModel45Debug;
  return base.disposeVolumetricClouds(handle);
}
