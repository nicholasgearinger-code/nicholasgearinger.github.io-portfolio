import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model33.js";

export * from "./volumetricClouds_r185_model33.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 3.4 — celestial-coupled sunset and moon lighting.
// Extracted from the review entry so Model 3.5 can inherit it cleanly and 3.4
// remains an exact query-selectable rollback point.
// -----------------------------------------------------------------------------

const SUNSET_EDGE = new THREE.Color(0xffb27d);
const SUNSET_CORE = new THREE.Color(0x6d718a);
const MOON_EDGE = new THREE.Color(0xc5d2e3);
const MOON_CORE = new THREE.Color(0x3f4d65);
const TMP = new THREE.Color();

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function apply34(handle) {
  const u = handle?.uniforms;
  const c = globalThis.__riftCelestialModel34;
  if (!u || !c) return;

  const sunset = clamp01(c.sunsetStrength);
  const fire = clamp01(c.horizonFire);
  const night = clamp01(c.night);
  const moon = clamp01(c.moonIllumination) * night;
  const storm = clamp01(c.storm);
  const clear = 1 - storm;

  if (u.sunColor?.value?.isColor) {
    if (night > 0.55) {
      TMP.copy(MOON_EDGE).multiplyScalar(0.72 + moon * 0.42);
      u.sunColor.value.lerp(TMP, moon * 0.46);
    } else {
      TMP.copy(c.sunColor || SUNSET_EDGE).lerp(SUNSET_EDGE, sunset * 0.58);
      u.sunColor.value.lerp(TMP, sunset * clear * 0.52);
    }
  }
  if (u.ambientColor?.value?.isColor) {
    u.ambientColor.value.lerp(
      night > 0.45 ? MOON_CORE : SUNSET_CORE,
      night > 0.45 ? moon * 0.34 : sunset * clear * 0.20,
    );
  }
  if (u.m2SilverStrength) {
    u.m2SilverStrength.value = THREE.MathUtils.clamp(
      u.m2SilverStrength.value + sunset * clear * 0.17 + moon * 0.055,
      0.08,
      0.82,
    );
  }
  if (u.m31CrownLightBoost) {
    u.m31CrownLightBoost.value = THREE.MathUtils.clamp(
      u.m31CrownLightBoost.value + sunset * clear * 0.12 + fire * 0.08 + moon * 0.045,
      0.68,
      1.55,
    );
  }
  if (u.m31SelfShadow) {
    u.m31SelfShadow.value = THREE.MathUtils.clamp(
      u.m31SelfShadow.value + sunset * 0.08 + night * 0.04,
      0.72,
      1.45,
    );
  }
  if (u.m31BaseDarkening) {
    u.m31BaseDarkening.value = THREE.MathUtils.clamp(
      u.m31BaseDarkening.value + sunset * 0.09 + night * 0.055,
      0.30,
      0.92,
    );
  }
  if (u.m2MultiScatter) {
    u.m2MultiScatter.value = THREE.MathUtils.clamp(
      u.m2MultiScatter.value + sunset * clear * 0.028 + moon * 0.012,
      0.12,
      0.38,
    );
  }

  globalThis.__riftCloudModel34Debug = {
    active: true,
    version: "3.4-celestial-coupled-lighting",
    sunset,
    horizonFire: fire,
    night,
    moonIllumination: moon,
    storm,
    silverStrength: u.m2SilverStrength?.value,
    crownLightBoost: u.m31CrownLightBoost?.value,
    selfShadow: u.m31SelfShadow?.value,
    baseDarkening: u.m31BaseDarkening?.value,
    threeRevision: THREE.REVISION,
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (handle) handle.__riftModel34 = true;
  return handle;
}

export function updateVolumetricClouds(...args) {
  const result = base.updateVolumetricClouds(...args);
  apply34(args[0]);
  return result;
}

export function disposeVolumetricClouds(handle) {
  if (handle) handle.__riftModel34 = false;
  delete globalThis.__riftCloudModel34Debug;
  return base.disposeVolumetricClouds(handle);
}
