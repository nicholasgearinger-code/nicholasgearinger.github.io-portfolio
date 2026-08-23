import * as THREE from "three";
import { getGraphicsTier } from "./graphicsSettings.js";

// -----------------------------------------------------------------------------
// Mobile-first physically-inspired world-lighting pass.
//
// dayNightCycle.js remains the source of truth for the authored sky and the
// baseline sun/ambient values. This pass reshapes those values into a more
// realistic direct-vs-diffuse balance and also drives the EXISTING moon
// DirectionalLight created by main.js.
//
// LOW SHADOW MODE:
// Low now has genuine 512x512 shadows. To keep that affordable on phones, the
// existing SUN DirectionalLight becomes one continuously-moving "celestial key":
// it follows the sun by day, smoothly rotates through twilight, and follows the
// moon direction at night. The separate moon DirectionalLight stays non-shadowing
// on Low, so Low pays for exactly ONE real shadow-map pass rather than sun+moon.
// Its orthographic shadow frustum is tightened around the player as well, making
// 512 pixels useful locally instead of spreading them across a huge area.
// -----------------------------------------------------------------------------

const WHITE_SKY = new THREE.Color(0xcfeaf2);
const NIGHT_SKY = new THREE.Color(0x314765);
const NIGHT_HAZE = new THREE.Color(0x263951);
const NIGHT_GROUND = new THREE.Color(0x1a2029);
const DAY_SUN = new THREE.Color(0xffefd2);
const DAWN_SUN = new THREE.Color(0xffa45f);
const MOON_KEY = new THREE.Color(0xa9bde3);

const DAY_NIGHT_ORBIT_RADIUS = 260;
const DAY_NIGHT_ORBIT_Z = 80;
const LOW_SHADOW_EXTENT = 28;
const STANDARD_SHADOW_EXTENT = 45;

const GROUND_BOUNCE = {
  crystal: new THREE.Color(0x9a7558),
  verdant: new THREE.Color(0x31533b),
  ember: new THREE.Color(0x6a321f),
  abyssal: new THREE.Color(0x291f38),
  ashen: new THREE.Color(0x68563a),
  default: new THREE.Color(0x44504c),
};

function clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function smooth01(v) {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
}

function setShadowExtent(light, extent) {
  const camera = light?.shadow?.camera;
  if (!camera) return;
  if (
    camera.left === -extent && camera.right === extent &&
    camera.top === extent && camera.bottom === -extent
  ) return;
  camera.left = -extent;
  camera.right = extent;
  camera.top = extent;
  camera.bottom = -extent;
  camera.updateProjectionMatrix?.();
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
    sunRelativeTmp: new THREE.Vector3(),
    sunDirectionTmp: new THREE.Vector3(),
    moonDirectionTmp: new THREE.Vector3(),
    lowKeyDirectionTmp: new THREE.Vector3(),
  };

  scene.userData.__realisticWorldLighting = state;
  console.info("[world-lighting] realistic sun/moon/sky lighting + mobile shadows v3 active");
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

  if (Number.isFinite(elapsed) && Math.abs(elapsed - state.lastElapsed) < 1e-6) return;

  if (Number.isFinite(elapsed) && Number.isFinite(state.lastElapsed)) {
    state.frameDt = THREE.MathUtils.clamp(elapsed - state.lastElapsed, 1 / 240, 0.1);
  }
  state.lastElapsed = elapsed;

  const day = smooth01(dayAmount);
  const storm = clamp01(stormAmount);
  const lowShadowMode = getGraphicsTier() === "low";
  const currentWaterY = Number.isFinite(waterY) ? waterY : state.waterY;
  const underwater = Number.isFinite(currentWaterY) && Number.isFinite(cameraY)
    ? cameraY < currentWaterY + 0.08
    : false;

  const authoredSunIntensity = state.sun?.intensity ?? THREE.MathUtils.lerp(0.12, 1.15, day);
  const night = smooth01(clamp01((0.52 - authoredSunIntensity) / 0.40));
  const daylight = 1 - night;

  // ---------------------------------------------------------------------------
  // Real-shadow tier policy
  // ---------------------------------------------------------------------------
  // Low: one real 512 shadow map, reused continuously for sun -> moon.
  // Medium/High: preserve the project's existing independent sun/moon lights.
  if (state.sun) {
    state.sun.castShadow = true;
    setShadowExtent(state.sun, lowShadowMode ? LOW_SHADOW_EXTENT : STANDARD_SHADOW_EXTENT);
  }
  if (state.moon) {
    state.moon.castShadow = !lowShadowMode;
    setShadowExtent(state.moon, lowShadowMode ? LOW_SHADOW_EXTENT : STANDARD_SHADOW_EXTENT);
  }

  // Capture the sun's player-centered orbital direction BEFORE Low repurposes
  // the light. main.js has already moved its target/frustum to the player.
  if (state.sun) {
    state.sunRelativeTmp.copy(state.sun.position).sub(state.sun.target.position);
    state.sunDirectionTmp.copy(state.sunRelativeTmp);
    if (state.sunDirectionTmp.lengthSq() > 1e-8) state.sunDirectionTmp.normalize();
  }

  // Reconstruct the true opposite moon direction from the orbit X coordinate.
  const orbitX = state.sun
    ? THREE.MathUtils.clamp(state.sunRelativeTmp.x, -DAY_NIGHT_ORBIT_RADIUS, DAY_NIGHT_ORBIT_RADIUS)
    : 0;
  const moonY = Math.sqrt(Math.max(
    0,
    DAY_NIGHT_ORBIT_RADIUS * DAY_NIGHT_ORBIT_RADIUS - orbitX * orbitX,
  ));
  state.moonDirectionTmp.set(-orbitX, Math.max(12, moonY), DAY_NIGHT_ORBIT_Z).normalize();

  const keyDistance = Math.sqrt(
    DAY_NIGHT_ORBIT_RADIUS * DAY_NIGHT_ORBIT_RADIUS +
    DAY_NIGHT_ORBIT_Z * DAY_NIGHT_ORBIT_Z,
  );

  // ---------------------------------------------------------------------------
  // Direct sun/moon energy
  // ---------------------------------------------------------------------------
  const sunBoost = THREE.MathUtils.lerp(1.12, 1.38, day);
  const stormDirect = THREE.MathUtils.lerp(1.0, 0.72, storm);
  const solarNightSuppression = THREE.MathUtils.lerp(1.0, 0.08, night);
  const solarIntensity = authoredSunIntensity * sunBoost * stormDirect * solarNightSuppression;

  let moonIntensity = 0.20 * night;
  moonIntensity *= THREE.MathUtils.lerp(1.0, 0.58, storm);
  if (underwater) moonIntensity *= 0.22;

  if (state.sun) {
    if (day > 0.55) {
      state.sunTargetTmp.copy(DAY_SUN);
      state.sun.color.lerp(state.sunTargetTmp, 0.18);
    } else if (night < 0.45) {
      state.sunTargetTmp.copy(DAWN_SUN);
      state.sun.color.lerp(state.sunTargetTmp, 0.14);
    } else {
      state.sunTargetTmp.copy(MOON_KEY);
      state.sun.color.lerp(state.sunTargetTmp, 0.72);
    }

    if (lowShadowMode) {
      // One continuous shadow-casting key. Directly lerping two nearly-opposite
      // horizon vectors can collapse toward zero around twilight, so keep a
      // positive elevation floor during the handoff. That also avoids enormous,
      // unstable grazing-angle shadows exactly at sunset.
      state.lowKeyDirectionTmp.set(
        THREE.MathUtils.lerp(state.sunDirectionTmp.x, state.moonDirectionTmp.x, night),
        Math.max(
          0.18,
          THREE.MathUtils.lerp(Math.max(0.08, state.sunDirectionTmp.y), state.moonDirectionTmp.y, night),
        ),
        THREE.MathUtils.lerp(state.sunDirectionTmp.z, state.moonDirectionTmp.z, night),
      ).normalize();

      state.sun.position.copy(state.sun.target.position).addScaledVector(state.lowKeyDirectionTmp, keyDistance);
      state.sun.intensity = solarIntensity + moonIntensity;
      state.sun.color.lerp(MOON_KEY, night * 0.82);
    } else {
      state.sun.intensity = solarIntensity;
    }
  }

  // Dedicated moon key remains available on Medium/High, but Low disables its
  // light contribution because the sun light already carries moon energy there.
  if (state.moon) {
    state.moon.target.position.copy(state.sun?.target?.position ?? state.moon.target.position);
    state.moon.position.copy(state.moon.target.position).addScaledVector(state.moonDirectionTmp, keyDistance);
    state.moon.target.updateMatrixWorld();
    state.moon.color.copy(MOON_KEY);
    state.moon.intensity = lowShadowMode ? 0 : moonIntensity;
  }

  // ---------------------------------------------------------------------------
  // Flat ambient reduction
  // ---------------------------------------------------------------------------
  if (state.ambient) {
    const ambientScale = THREE.MathUtils.lerp(0.62, 0.40, day);
    state.ambient.intensity *= ambientScale;
  }

  // ---------------------------------------------------------------------------
  // Sky fill + ground bounce
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
  // Night atmospheric perspective
  // ---------------------------------------------------------------------------
  if (state.scene?.fog?.color && night > 0) {
    state.scene.fog.color.lerp(NIGHT_HAZE, night * 0.32);
  }

  // ---------------------------------------------------------------------------
  // Eye adaptation target
  // ---------------------------------------------------------------------------
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

  const dt = THREE.MathUtils.clamp(state.frameDt || 1 / 60, 1 / 240, 0.1);
  const alpha = 1 - Math.exp(-dt * 1.6);
  state.exposureCurrent = THREE.MathUtils.lerp(state.exposureCurrent, state.targetExposure, alpha);
  renderer.toneMappingExposure = state.exposureCurrent;
}

export function setRealisticLightingBiome(state, biome) {
  if (!state || !biome) return;
  state.biome = biome;
}
