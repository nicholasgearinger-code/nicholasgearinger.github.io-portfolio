import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model31.js";

export * from "./volumetricClouds_r185_model31.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 3.2 — physically richer lighting on the proven 3.1 shapes.
//
// 3.1 already contains authored self-shadowing, height-aware ambient light,
// underside darkening and silver-edge scattering. 3.2 deliberately reuses those
// stable shader controls instead of introducing another expensive light pass:
//   * stronger warm sun / cool sky separation;
//   * more directional silver lining at clear low sun;
//   * cyan ocean/sky bounce folded into the existing ambient term;
//   * deeper humid interiors and darker condensation bases;
//   * moonlight stays neutral/silver rather than inheriting sunset warmth.
// No extra texture sample or full-screen pass is added.
// -----------------------------------------------------------------------------

const TMP_SUN = new THREE.Color();
const TMP_AMBIENT = new THREE.Color();
const WARM_SUNSET = new THREE.Color(1.0, 0.66, 0.48);
const DAY_WHITE = new THREE.Color(1.0, 0.985, 0.95);
const COOL_SKY = new THREE.Color(0.62, 0.76, 0.96);
const OCEAN_BOUNCE = new THREE.Color(0.42, 0.76, 0.82);
const MOON_SILVER = new THREE.Color(0.72, 0.80, 0.94);

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / Math.max(1e-5, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function tuneModel32Lighting(handle, sunDirection, rainIntensity) {
  const u = handle?.uniforms;
  if (!u) return;

  const weather = globalThis.__riftProceduralWeatherState || {};
  const physical = globalThis.__riftSkyPhysicalV11 || {};
  const sunY = Number(sunDirection?.y) || 0;
  const storm = clamp01(weather.stormIntensity ?? rainIntensity);
  const humidity = clamp01(weather.humidity ?? physical.humidity ?? 0.66);
  const daylight = smoothstep(-0.12, 0.08, sunY);
  const highSun = smoothstep(0.15, 0.66, sunY);
  const lowSun = (1 - smoothstep(0.08, 0.42, Math.abs(sunY))) * daylight;
  const night = 1 - daylight;

  // Base update has already copied the actual celestial colors into these
  // uniforms. Retint them while preserving the current atmospheric exposure.
  if (u.sunColor?.value?.isColor) {
    const energy = Math.max(
      0.001,
      u.sunColor.value.r,
      u.sunColor.value.g,
      u.sunColor.value.b,
    );
    TMP_SUN.copy(DAY_WHITE).lerp(WARM_SUNSET, lowSun * 0.82);
    if (night > 0.01) TMP_SUN.lerp(MOON_SILVER, night);
    TMP_SUN.multiplyScalar(energy / Math.max(TMP_SUN.r, TMP_SUN.g, TMP_SUN.b, 0.001));
    u.sunColor.value.lerp(TMP_SUN, 0.68 + lowSun * 0.18 + night * 0.10);
  }

  if (u.ambientColor?.value?.isColor) {
    const energy = Math.max(
      0.001,
      u.ambientColor.value.r,
      u.ambientColor.value.g,
      u.ambientColor.value.b,
    );
    TMP_AMBIENT.copy(COOL_SKY)
      .lerp(OCEAN_BOUNCE, daylight * (1 - storm) * 0.18)
      .lerp(MOON_SILVER, night * 0.46);
    TMP_AMBIENT.multiplyScalar(
      energy / Math.max(TMP_AMBIENT.r, TMP_AMBIENT.g, TMP_AMBIENT.b, 0.001),
    );
    u.ambientColor.value.lerp(TMP_AMBIENT, 0.40 + humidity * 0.12);
  }

  // Stronger light separation using controls the 3.1 shader already consumes.
  const clear = 1 - storm;
  u.m2SilverStrength.value = THREE.MathUtils.lerp(
    0.42 + highSun * 0.16 + lowSun * 0.28 + night * 0.05,
    0.12,
    storm,
  );
  u.m31CrownLightBoost.value = THREE.MathUtils.lerp(
    1.13 + highSun * 0.14 + lowSun * 0.12,
    0.78,
    storm,
  );
  u.m31SelfShadow.value = THREE.MathUtils.lerp(
    0.98 + humidity * 0.18,
    1.28,
    storm,
  );
  u.m31BaseDarkening.value = THREE.MathUtils.lerp(
    0.48 + humidity * 0.18,
    0.80,
    storm,
  );
  u.m2LightExtinction.value = THREE.MathUtils.lerp(
    0.66 + humidity * 0.10,
    1.02,
    storm,
  );
  u.m2AmbientStrength.value = THREE.MathUtils.lerp(
    0.60 + daylight * 0.05 - humidity * 0.04,
    0.40,
    storm,
  );
  u.m2MultiScatter.value = THREE.MathUtils.lerp(
    0.30 + lowSun * 0.025,
    0.18,
    storm,
  );

  // Keep the enhanced crown breakup from 3.1, but slightly reduce it at night so
  // moonlit silhouettes stay coherent rather than turning noisy.
  u.m31CrownBreakup.value *= THREE.MathUtils.lerp(0.84, 1.04, daylight * clear);

  globalThis.__riftCloudModel32Debug = {
    active: true,
    version: "3.2-light-transport-retune",
    architecture: "3.1 authored self-shadow + warm/cool celestial retint + stronger base/core separation; zero additional samples",
    daylight,
    highSun,
    lowSun,
    night,
    storm,
    humidity,
    silverStrength: u.m2SilverStrength.value,
    crownLightBoost: u.m31CrownLightBoost.value,
    selfShadow: u.m31SelfShadow.value,
    baseDarkening: u.m31BaseDarkening.value,
    extinction: u.m2LightExtinction.value,
    ambientStrength: u.m2AmbientStrength.value,
    multiScatter: u.m2MultiScatter.value,
    threeRevision: THREE.REVISION,
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (handle) handle.__riftModel32 = true;
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
  tuneModel32Lighting(handle, sunDirection, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  if (handle) handle.__riftModel32 = false;
  delete globalThis.__riftCloudModel32Debug;
  return base.disposeVolumetricClouds(handle);
}
