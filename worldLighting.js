import * as THREE from "three";

// -----------------------------------------------------------------------------
// Mobile-first physically-inspired world-lighting pass.
//
// dayNightCycle.js remains the source of truth for the authored sky and the
// baseline sun/ambient values. This pass reshapes those values into a more
// realistic direct-vs-diffuse balance and also drives the EXISTING moon
// DirectionalLight created by main.js. No new shadow-casting light is created.
//
// Goals:
//   - strong directional sun by day, almost no residual orange sun at night
//   - cool directional moonlight with real shadows after sunset
//   - lower flat AmbientLight + cheap HemisphereLight sky/ground bounce
//   - cooler atmospheric perspective at night
//   - gentle eye adaptation through renderer.toneMappingExposure
//   - storm/underwater aware behavior without additional render passes
// -----------------------------------------------------------------------------

const WHITE_SKY = new THREE.Color(0xcfeaf2);
const NIGHT_SKY = new THREE.Color(0x314765);
const NIGHT_HAZE = new THREE.Color(0x263951);
const NIGHT_GROUND = new THREE.Color(0x1a2029);
const DAY_SUN = new THREE.Color(0xffefd2);
const DAWN_SUN = new THREE.Color(0xffa45f);
const MOON_KEY = new THREE.Color(0xa9bde3);

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
  let moon = null;
  let ambient = null;
  const directional = [];

  scene.traverse((obj) => {
    if (obj?.isDirectionalLight) {
      directional.push(obj);
      if (obj.target?.name === "sunShadowTarget") sun = obj;
      if (obj.target?.name === "moonShadowTarget") moon = obj;
    }
    if (!ambient && obj?.isAmbientLight) ambient = obj;
  });

  // Fallback to creation order if target names ever change. main.js currently
  // adds the sun first and moon second.
  if (!sun) sun = directional[0] ?? null;
  if (!moon) moon = directional.find((light) => light !== sun) ?? null;

  return { sun, moon, ambient };
}

export function ensureRealisticWorldLighting(scene, biome = "default", waterY = null) {
  if (!scene) return null;

  let state = scene.userData.__realisticWorldLighting;
  if (state) {
    state.biome = biome || state.biome;
    if (Number.isFinite(waterY)) state.waterY = waterY;
    return state;
  }

  const { sun, moon, ambient } = findWorldLights(scene);
  const ground = (GROUND_BOUNCE[biome] || GROUND_BOUNCE.default).clone();

  // One non-shadowed hemisphere light approximates large-area skylight and
  // ground bounce. This is far cheaper than adding another directional/point
  // light and gives normals a directional environment response that a plain
  // AmbientLight cannot provide.
  const skyFill = new THREE.HemisphereLight(0xa8d9ee, ground, 0.20);
  skyFill.name = "rift-realistic-sky-fill";
  skyFill.castShadow = false;
  scene.add(skyFill);

  state = {
    scene,
    sun,
    moon,
    ambient,
    skyFill,
    biome,
    waterY: Number.isFinite(waterY) ? waterY : null,
    lastElapsed: Number.NaN,
    frameDt: 1 / 60,
    targetExposure: 1.0,
    exposureCurrent: Number.NaN,
    skyTmp: new THREE.Color(),
    groundTmp: new THREE.Color(),
    sunTargetTmp: new THREE.Color(),
    moonDirectionTmp: new THREE.Vector3(),
  };

  scene.userData.__realisticWorldLighting = state;
  console.info("[world-lighting] realistic sun/moon/sky lighting v2 active");
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
  // call this more than once in one animation frame; never multiply lights twice.
  if (Number.isFinite(elapsed) && Math.abs(elapsed - state.lastElapsed) < 1e-6) return;

  if (Number.isFinite(elapsed) && Number.isFinite(state.lastElapsed)) {
    state.frameDt = THREE.MathUtils.clamp(elapsed - state.lastElapsed, 1 / 240, 0.1);
  }
  state.lastElapsed = elapsed;

  const day = smooth01(dayAmount);
  const storm = clamp01(stormAmount);
  const currentWaterY = Number.isFinite(waterY) ? waterY : state.waterY;
  const underwater = Number.isFinite(currentWaterY) && Number.isFinite(cameraY)
    ? cameraY < currentWaterY + 0.08
    : false;

  // dayAmount reaches 0 exactly at the horizon and stays there all night, so it
  // cannot distinguish orange twilight from deep night on its own. The baseline
  // sun intensity authored by dayNightCycle DOES: roughly 0.75 at the horizon
  // and 0.12 in full darkness. Use that to produce a smooth moon handoff.
  const authoredSunIntensity = state.sun?.intensity ?? THREE.MathUtils.lerp(0.12, 1.15, day);
  const night = smooth01(clamp01((0.52 - authoredSunIntensity) / 0.40));
  const daylight = 1 - night;

  // ---------------------------------------------------------------------------
  // 1) Direct sun key
  // ---------------------------------------------------------------------------
  if (state.sun) {
    const sunBoost = THREE.MathUtils.lerp(1.12, 1.38, day);
    const stormDirect = THREE.MathUtils.lerp(1.0, 0.72, storm);

    // Kill the leftover warm solar key progressively after twilight. This is
    // what removes the razor-thin orange "laser" reflection from night water.
    const solarNightSuppression = THREE.MathUtils.lerp(1.0, 0.08, night);
    state.sun.intensity = authoredSunIntensity * sunBoost * stormDirect * solarNightSuppression;

    if (day > 0.55) {
      state.sunTargetTmp.copy(DAY_SUN);
      state.sun.color.lerp(state.sunTargetTmp, 0.18);
    } else if (night < 0.45) {
      state.sunTargetTmp.copy(DAWN_SUN);
      state.sun.color.lerp(state.sunTargetTmp, 0.14);
    } else {
      // Residual night sun contribution is almost zero, but making it cool keeps
      // any tiny remaining specular response from being orange.
      state.sunTargetTmp.copy(MOON_KEY);
      state.sun.color.lerp(state.sunTargetTmp, 0.72);
    }
  }

  // ---------------------------------------------------------------------------
  // 2) Real moon key using main.js's existing DirectionalLight
  // ---------------------------------------------------------------------------
  if (state.moon && state.sun) {
    // The visible moon is opposite the sun on the same orbit. main.js already
    // centers the sun shadow target around the player before this call, so using
    // the opposite target-relative direction keeps moon shadows centered too.
    state.moonDirectionTmp.copy(state.sun.position).sub(state.sun.target.position);
    const keyDistance = Math.max(120, state.moonDirectionTmp.length());
    if (state.moonDirectionTmp.lengthSq() < 1e-8) state.moonDirectionTmp.set(0.3, 0.9, 0.2);
    state.moonDirectionTmp.normalize().multiplyScalar(-1);

    state.moon.target.position.copy(state.sun.target.position);
    state.moon.position.copy(state.moon.target.position).addScaledVector(state.moonDirectionTmp, keyDistance);
    state.moon.target.updateMatrixWorld();

    state.moon.color.copy(MOON_KEY);
    let moonIntensity = 0.20 * night;
    moonIntensity *= THREE.MathUtils.lerp(1.0, 0.58, storm);
    if (underwater) moonIntensity *= 0.22;
    state.moon.intensity = moonIntensity;
  }

  // ---------------------------------------------------------------------------
  // 3) Flat ambient reduction
  // ---------------------------------------------------------------------------
  if (state.ambient) {
    // Keep a little more base visibility at night than v1, but still far below
    // the old flat-lighting setup. Most readable fill comes from skyFill below.
    const ambientScale = THREE.MathUtils.lerp(0.62, 0.40, day);
    state.ambient.intensity *= ambientScale;
  }

  // ---------------------------------------------------------------------------
  // 4) Sky fill + ground bounce
  // ---------------------------------------------------------------------------
  if (state.skyFill) {
    if (skyColor?.isColor) {
      state.skyTmp.copy(skyColor);
    } else {
      state.skyTmp.copy(NIGHT_SKY).lerp(WHITE_SKY, day);
    }

    state.skyTmp.lerp(daylight > 0.05 ? WHITE_SKY : NIGHT_SKY, 0.30 + day * 0.28);
    if (skyHorizon?.isColor) {
      state.skyTmp.lerp(skyHorizon, 0.06 + night * 0.08);
    }
    state.skyFill.color.copy(state.skyTmp);

    const bounceBase = GROUND_BOUNCE[state.biome] || GROUND_BOUNCE.default;
    state.groundTmp.copy(bounceBase);
    state.groundTmp.lerp(NIGHT_GROUND, night * 0.72);
    state.skyFill.groundColor.copy(state.groundTmp);

    let fillIntensity = THREE.MathUtils.lerp(0.115, 0.285, day);
    fillIntensity *= THREE.MathUtils.lerp(1.0, 0.82, storm);
    if (underwater) fillIntensity *= 0.16;
    state.skyFill.intensity = fillIntensity;
  }

  // ---------------------------------------------------------------------------
  // 5) Night atmospheric perspective
  // ---------------------------------------------------------------------------
  // Far surfaces should recede into blue-gray night air instead of collapsing
  // into a black silhouette. Change only fog COLOR here; weather.js/main.js keep
  // ownership of density so this does not fight rain/fog strength controls.
  if (state.scene?.fog?.color && night > 0) {
    state.scene.fog.color.lerp(NIGHT_HAZE, night * 0.32);
  }

  // ---------------------------------------------------------------------------
  // 6) Eye adaptation target
  // ---------------------------------------------------------------------------
  // Exposure moves slowly in updateRealisticLightingExposure(), where the actual
  // renderer is available. Storm nights get a little less compensation so rain
  // still reads as genuinely dark weather rather than auto-exposure erasing it.
  let targetExposure = THREE.MathUtils.lerp(1.24, 0.98, day);
  targetExposure *= THREE.MathUtils.lerp(1.0, 0.94, storm);
  if (underwater) targetExposure = THREE.MathUtils.lerp(targetExposure, 1.08, 0.72);
  state.targetExposure = targetExposure;
}

export function updateRealisticLightingExposure(state, renderer) {
  if (!state || !renderer || !Number.isFinite(state.targetExposure)) return;

  if (!Number.isFinite(state.exposureCurrent)) {
    state.exposureCurrent = Number.isFinite(renderer.toneMappingExposure)
      ? renderer.toneMappingExposure
      : 1.0;
  }

  // Exponential adaptation is frame-rate independent: quick enough to follow a
  // sunrise over several seconds, slow enough to avoid visible brightness pops.
  const dt = THREE.MathUtils.clamp(state.frameDt || 1 / 60, 1 / 240, 0.1);
  const alpha = 1 - Math.exp(-dt * 1.6);
  state.exposureCurrent = THREE.MathUtils.lerp(state.exposureCurrent, state.targetExposure, alpha);
  renderer.toneMappingExposure = state.exposureCurrent;
}

export function setRealisticLightingBiome(state, biome) {
  if (!state || !biome) return;
  state.biome = biome;
}
