import * as THREE from "three";

// -----------------------------------------------------------------------------
// Mobile-first physically-inspired world-lighting pass.
//
// The existing dayNightCycle remains the source of truth for sun position,
// sun/ambient color, and day/night timing. This module runs immediately after
// that update through liquid.js and reshapes the result into a more natural
// direct-vs-diffuse lighting balance:
//   - stronger directional sun / moon key light
//   - substantially less flat global AmbientLight
//   - one cheap HemisphereLight for blue sky fill + biome ground bounce
//   - storm and underwater-aware diffuse fill
//
// No extra shadow-casting light is introduced. HemisphereLight is intentionally
// used because it is dramatically cheaper than a second directional/point light
// with shadows and is a good approximation of large-scale skylight on mobile.
// -----------------------------------------------------------------------------

const WHITE_SKY = new THREE.Color(0xcfeaf2);
const NIGHT_SKY = new THREE.Color(0x314466);
const DAY_SUN = new THREE.Color(0xffefd2);
const DAWN_SUN = new THREE.Color(0xffa45f);
const NIGHT_KEY = new THREE.Color(0x8296c6);

const GROUND_BOUNCE = {
  crystal: new THREE.Color(0x9a7558), // warm sand / coral bounce
  verdant: new THREE.Color(0x31533b), // vegetation / moss bounce
  ember: new THREE.Color(0x6a321f),   // lava / ash warmth
  abyssal: new THREE.Color(0x291f38), // violet-black rock
  ashen: new THREE.Color(0x68563a),   // dry stone / dust
  default: new THREE.Color(0x44504c),
};

function clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function smooth01(v) {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
}

function findWorldLights(scene) {
  let sun = null;
  let ambient = null;
  scene.traverse((obj) => {
    if (!sun && obj?.isDirectionalLight) sun = obj;
    if (!ambient && obj?.isAmbientLight) ambient = obj;
  });
  return { sun, ambient };
}

export function ensureRealisticWorldLighting(scene, biome = "default", waterY = null) {
  if (!scene) return null;

  let state = scene.userData.__realisticWorldLighting;
  if (state) {
    state.biome = biome || state.biome;
    if (Number.isFinite(waterY)) state.waterY = waterY;
    return state;
  }

  const { sun, ambient } = findWorldLights(scene);

  const ground = (GROUND_BOUNCE[biome] || GROUND_BOUNCE.default).clone();
  const skyFill = new THREE.HemisphereLight(0xa8d9ee, ground, 0.20);
  skyFill.name = "rift-realistic-sky-fill";
  skyFill.castShadow = false;
  scene.add(skyFill);

  state = {
    sun,
    ambient,
    skyFill,
    biome,
    waterY: Number.isFinite(waterY) ? waterY : null,
    lastElapsed: Number.NaN,
    skyTmp: new THREE.Color(),
    groundTmp: new THREE.Color(),
    sunTargetTmp: new THREE.Color(),
  };

  scene.userData.__realisticWorldLighting = state;
  console.info("[world-lighting] realistic mobile sky/direct/bounce lighting active");
  return state;
}

export function updateRealisticWorldLighting(
  state,
  elapsed,
  skyColor,
  skyHorizon,
  cameraY,
  dayAmount = 1,
  stormAmount = 0,
  waterY = null,
) {
  if (!state) return;

  // A scene can theoretically own more than one liquid handle. liquid.js may
  // therefore call this more than once in the same animation frame; never apply
  // direct/ambient multipliers twice to lights that were already reshaped.
  if (Number.isFinite(elapsed) && Math.abs(elapsed - state.lastElapsed) < 1e-6) return;
  state.lastElapsed = elapsed;

  const day = smooth01(dayAmount);
  const storm = clamp01(stormAmount);
  const currentWaterY = Number.isFinite(waterY) ? waterY : state.waterY;
  const underwater = Number.isFinite(currentWaterY) && Number.isFinite(cameraY)
    ? cameraY < currentWaterY + 0.08
    : false;

  // ---------------------------------------------------------------------------
  // 1) Direct key light
  // ---------------------------------------------------------------------------
  // The old world had a relatively bright AmbientLight sitting underneath a
  // modest directional sun. Reversing that relationship creates the strongest
  // realism gain: sun-facing slopes become bright while shadow-facing slopes
  // retain readable, cooler fill rather than being almost equally illuminated.
  if (state.sun) {
    const sunBoost = THREE.MathUtils.lerp(0.96, 1.38, day);
    const stormDirect = THREE.MathUtils.lerp(1.0, 0.88, storm);
    state.sun.intensity *= sunBoost * stormDirect;

    // Keep the day/night system's authored colors, only nudging their physical
    // temperature: warm-white at noon, orange near sunrise/sunset, cool at night.
    if (day > 0.55) {
      state.sunTargetTmp.copy(DAY_SUN);
      state.sun.color.lerp(state.sunTargetTmp, 0.16);
    } else if (day > 0.04) {
      state.sunTargetTmp.copy(DAWN_SUN);
      state.sun.color.lerp(state.sunTargetTmp, 0.10);
    } else {
      state.sunTargetTmp.copy(NIGHT_KEY);
      state.sun.color.lerp(state.sunTargetTmp, 0.12);
    }
  }

  // ---------------------------------------------------------------------------
  // 2) Global ambient reduction
  // ---------------------------------------------------------------------------
  // AmbientLight has no direction at all, so too much of it erases form. Keep
  // enough to prevent crushed blacks, then let HemisphereLight provide the
  // directional diffuse environment instead.
  if (state.ambient) {
    const ambientScale = THREE.MathUtils.lerp(0.56, 0.40, day);
    state.ambient.intensity *= ambientScale;
  }

  // ---------------------------------------------------------------------------
  // 3) Sky fill + ground bounce
  // ---------------------------------------------------------------------------
  if (state.skyFill) {
    if (skyColor?.isColor) {
      state.skyTmp.copy(skyColor);
    } else {
      state.skyTmp.copy(NIGHT_SKY).lerp(WHITE_SKY, day);
    }

    // Real daylight is much brighter/desaturated than the raw stylized sky
    // zenith color. Pull toward a pale atmospheric blue as the sun rises while
    // preserving the biome/day-night hue authored by dayNightCycle.js.
    state.skyTmp.lerp(day > 0.05 ? WHITE_SKY : NIGHT_SKY, 0.28 + day * 0.30);
    if (skyHorizon?.isColor && day > 0.08) {
      state.skyTmp.lerp(skyHorizon, 0.08);
    }
    state.skyFill.color.copy(state.skyTmp);

    const bounceBase = GROUND_BOUNCE[state.biome] || GROUND_BOUNCE.default;
    state.groundTmp.copy(bounceBase);
    if (day < 0.12) state.groundTmp.multiplyScalar(0.45);
    state.skyFill.groundColor.copy(state.groundTmp);

    // Clouds/rain reduce direct sun much more than diffuse skylight. We only
    // trim the hemisphere modestly in storms, which naturally makes cloudy
    // conditions softer/flatter without requiring another expensive system.
    let fillIntensity = THREE.MathUtils.lerp(0.075, 0.285, day);
    fillIntensity *= THREE.MathUtils.lerp(1.0, 0.76, storm);

    // main.js has a dedicated underwater lighting model. Keep this fill from
    // fighting that model when the camera crosses below the surface.
    if (underwater) fillIntensity *= 0.16;

    state.skyFill.intensity = fillIntensity;
  }
}

export function setRealisticLightingBiome(state, biome) {
  if (!state || !biome) return;
  state.biome = biome;
}
