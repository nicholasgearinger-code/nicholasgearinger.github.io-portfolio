import * as THREE from "three";
import { getGraphicsTier, getGraphicsSettings } from "./graphicsSettings.js";

// -----------------------------------------------------------------------------
// Mobile-first physically-inspired world-lighting pass.
//
// Fix pass v4:
//   - keep Low on ONE real 512 shadow-casting directional key
//   - force the WebGPU renderer onto supported PCFShadowMap filtering
//   - refresh moving light shadows and reduce peter-panning bias
//   - periodically opt real standard-material props (including async GLB palms)
//     into casting/receiving shadows while skipping Low's instanced grass/FX
//   - add camera-relative visible sun/moon discs aligned to the actual lighting
//     directions, so they cannot drift away from the sky lighting as the player
//     walks around the island
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
const CELESTIAL_DISTANCE = 190;
const SHADOW_SYNC_INTERVAL = 0.75;

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
  camera.near = 0.5;
  camera.far = 420;
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

function makeRadialTexture(kind) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.46;

  ctx.clearRect(0, 0, size, size);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  if (kind === "sun") {
    grad.addColorStop(0, "rgba(255,255,245,1)");
    grad.addColorStop(0.58, "rgba(255,237,188,1)");
    grad.addColorStop(0.82, "rgba(255,192,95,0.92)");
    grad.addColorStop(1, "rgba(255,170,70,0)");
  } else {
    grad.addColorStop(0, "rgba(246,250,255,1)");
    grad.addColorStop(0.72, "rgba(210,224,247,0.98)");
    grad.addColorStop(0.94, "rgba(155,178,218,0.88)");
    grad.addColorStop(1, "rgba(120,145,190,0)");
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  if (kind === "moon") {
    const craters = [
      [43, 45, 9, 0.18], [78, 37, 7, 0.14], [72, 78, 11, 0.12],
      [48, 84, 6, 0.13], [89, 62, 5, 0.11],
    ];
    for (const [x, y, rr, a] of craters) {
      const cg = ctx.createRadialGradient(x, y, 0, x, y, rr);
      cg.addColorStop(0, `rgba(88,108,150,${a})`);
      cg.addColorStop(1, "rgba(88,108,150,0)");
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCelestialVisuals(scene) {
  const existingSun = scene.getObjectByName("rift-visible-sun");
  const existingMoon = scene.getObjectByName("rift-visible-moon");
  if (existingSun && existingMoon) {
    return {
      sun: existingSun,
      moon: existingMoon,
      sunGlow: scene.getObjectByName("rift-visible-sun-glow"),
      moonGlow: scene.getObjectByName("rift-visible-moon-glow"),
    };
  }

  const sunTex = makeRadialTexture("sun");
  const moonTex = makeRadialTexture("moon");

  const sunMat = new THREE.SpriteMaterial({
    map: sunTex,
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    fog: false,
  });
  const sun = new THREE.Sprite(sunMat);
  sun.name = "rift-visible-sun";
  sun.scale.set(22, 22, 1);
  sun.renderOrder = -20;

  const sunGlowMat = new THREE.SpriteMaterial({
    map: sunTex,
    color: 0xffc46b,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  });
  const sunGlow = new THREE.Sprite(sunGlowMat);
  sunGlow.name = "rift-visible-sun-glow";
  sunGlow.scale.set(42, 42, 1);
  sunGlow.renderOrder = -21;

  const moonMat = new THREE.SpriteMaterial({
    map: moonTex,
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    fog: false,
  });
  const moon = new THREE.Sprite(moonMat);
  moon.name = "rift-visible-moon";
  moon.scale.set(15, 15, 1);
  moon.renderOrder = -20;

  const moonGlowMat = new THREE.SpriteMaterial({
    map: moonTex,
    color: 0x9fb8e8,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  });
  const moonGlow = new THREE.Sprite(moonGlowMat);
  moonGlow.name = "rift-visible-moon-glow";
  moonGlow.scale.set(27, 27, 1);
  moonGlow.renderOrder = -21;

  scene.add(sunGlow, sun, moonGlow, moon);
  return { sun, moon, sunGlow, moonGlow };
}

function isShadowMaterial(material) {
  if (!material) return false;
  if (material.isMeshBasicMaterial || material.isShaderMaterial || material.isRawShaderMaterial) return false;
  if (material.transparent && (material.opacity ?? 1) < 0.98 && !(material.alphaTest > 0)) return false;
  return !!(
    material.isMeshStandardMaterial || material.isMeshPhysicalMaterial ||
    material.isMeshPhongMaterial || material.isMeshLambertMaterial ||
    material.isMeshToonMaterial || material.isNodeMaterial
  );
}

function syncShadowParticipants(state, lowShadowMode) {
  if (!state?.scene) return;

  state.scene.traverse((obj) => {
    if (!obj?.isMesh) return;
    if (lowShadowMode && obj.isInstancedMesh) return; // grass/large instance fields stay cheap on Low

    const name = (obj.name || "").toLowerCase();
    if (
      name.includes("sky") || name.includes("cloud") || name.includes("particle") ||
      name.includes("shaft") || name.includes("water") || name.includes("ocean")
    ) return;

    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    if (!materials.some(isShadowMaterial)) return;

    obj.castShadow = true;
    obj.receiveShadow = true;
  });
}

function configureLightShadow(light, enabled, lowShadowMode) {
  if (!light?.shadow) return;
  light.castShadow = enabled;
  if (!enabled) return;

  const shadow = light.shadow;
  shadow.autoUpdate = true;
  shadow.needsUpdate = true;
  shadow.bias = -0.00035;
  shadow.normalBias = lowShadowMode ? 0.012 : 0.018;
  shadow.radius = lowShadowMode ? 1.5 : 2.0;
  shadow.camera.near = 0.5;
  shadow.camera.far = 420;

  const wantedSize = lowShadowMode ? 512 : getGraphicsSettings().shadowMapSize;
  if (Number.isFinite(wantedSize) && shadow.mapSize.width !== wantedSize) {
    shadow.mapSize.set(wantedSize, wantedSize);
    if (shadow.map) {
      shadow.map.dispose?.();
      shadow.map = null;
    }
  }
  shadow.camera.updateProjectionMatrix?.();
}

function configureRendererShadows(state, renderer) {
  if (!renderer?.shadowMap) return;
  const settings = getGraphicsSettings();
  const enabled = settings?.shadowsEnabled !== false;
  const lowShadowMode = getGraphicsTier() === "low";

  renderer.shadowMap.enabled = enabled;
  if (enabled && renderer.shadowMap.type !== THREE.PCFShadowMap) {
    // three r182/WebGPU: PCFSoftShadowMap is deprecated. PCFShadowMap is the
    // supported filtered path and is the most portable choice for this renderer.
    renderer.shadowMap.type = THREE.PCFShadowMap;
  }

  configureLightShadow(state.sun, enabled, lowShadowMode);
  configureLightShadow(state.moon, enabled && !lowShadowMode, lowShadowMode);
}

function updateCelestialVisuals(state, playerPos, sunVisibility, moonVisibility, storm, underwater) {
  const visuals = state?.celestialVisuals;
  if (!visuals || !playerPos?.isVector3) return;

  const weatherVisibility = THREE.MathUtils.lerp(1.0, 0.52, storm);
  const submergedVisibility = underwater ? 0.18 : 1.0;
  const sunAlpha = clamp01(sunVisibility) * weatherVisibility * submergedVisibility;
  const moonAlpha = clamp01(moonVisibility) * THREE.MathUtils.lerp(1.0, 0.68, storm) * submergedVisibility;

  visuals.sun.position.copy(playerPos).addScaledVector(state.sunDirectionTmp, CELESTIAL_DISTANCE);
  visuals.sunGlow.position.copy(visuals.sun.position);
  visuals.moon.position.copy(playerPos).addScaledVector(state.moonDirectionTmp, CELESTIAL_DISTANCE);
  visuals.moonGlow.position.copy(visuals.moon.position);

  visuals.sun.material.opacity = sunAlpha;
  visuals.sunGlow.material.opacity = sunAlpha * 0.34;
  visuals.moon.material.opacity = moonAlpha * 0.92;
  visuals.moonGlow.material.opacity = moonAlpha * 0.22;

  visuals.sun.visible = sunAlpha > 0.01;
  visuals.sunGlow.visible = sunAlpha > 0.01;
  visuals.moon.visible = moonAlpha > 0.01;
  visuals.moonGlow.visible = moonAlpha > 0.01;
}

export function ensureRealisticWorldLighting(scene, biome = "default", waterY = null) {
  if (!scene) return null;

  let state = scene.userData.__realisticWorldLighting;
  if (state) {
    state.biome = biome || state.biome;
    if (Number.isFinite(waterY)) state.waterY = waterY;
    if (!state.celestialVisuals) state.celestialVisuals = createCelestialVisuals(scene);
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
    celestialVisuals: createCelestialVisuals(scene),
    biome,
    waterY: Number.isFinite(waterY) ? waterY : null,
    lastElapsed: Number.NaN,
    lastShadowParticipantSync: -Infinity,
    frameDt: 1 / 60,
    targetExposure: 1.0,
    exposureCurrent: Number.NaN,
    skyTmp: new THREE.Color(),
    groundTmp: new THREE.Color(),
    sunTargetTmp: new THREE.Color(),
    sunRelativeTmp: new THREE.Vector3(),
    sunDirectionTmp: new THREE.Vector3(0, 1, 0),
    moonDirectionTmp: new THREE.Vector3(0, 1, 0),
    lowKeyDirectionTmp: new THREE.Vector3(),
  };

  scene.userData.__realisticWorldLighting = state;
  syncShadowParticipants(state, getGraphicsTier() === "low");
  console.info("[world-lighting] celestial visibility + WebGPU shadow fix v4 active");
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
  playerPos = null,
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

  if (state.sun) {
    setShadowExtent(state.sun, lowShadowMode ? LOW_SHADOW_EXTENT : STANDARD_SHADOW_EXTENT);
    state.sunRelativeTmp.copy(state.sun.position).sub(state.sun.target.position);
    state.sunDirectionTmp.copy(state.sunRelativeTmp);
    if (state.sunDirectionTmp.lengthSq() > 1e-8) state.sunDirectionTmp.normalize();
  }

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
      state.sun.castShadow = true;
      if (state.sun.shadow) state.sun.shadow.needsUpdate = true;
    } else {
      state.sun.intensity = solarIntensity;
      state.sun.castShadow = true;
      if (state.sun.shadow) state.sun.shadow.needsUpdate = true;
    }
  }

  if (state.moon) {
    setShadowExtent(state.moon, lowShadowMode ? LOW_SHADOW_EXTENT : STANDARD_SHADOW_EXTENT);
    state.moon.target.position.copy(state.sun?.target?.position ?? state.moon.target.position);
    state.moon.position.copy(state.moon.target.position).addScaledVector(state.moonDirectionTmp, keyDistance);
    state.moon.target.updateMatrixWorld();
    state.moon.color.copy(MOON_KEY);
    state.moon.intensity = lowShadowMode ? 0 : moonIntensity;
    state.moon.castShadow = !lowShadowMode;
    if (state.moon.shadow) state.moon.shadow.needsUpdate = !lowShadowMode;
  }

  const sunVisual = clamp01((authoredSunIntensity - 0.15) / 0.60) * (1 - night * 0.72);
  const moonVisual = night;
  updateCelestialVisuals(state, playerPos, sunVisual, moonVisual, storm, underwater);

  if (lowShadowMode && Number.isFinite(elapsed) && elapsed - state.lastShadowParticipantSync >= SHADOW_SYNC_INTERVAL) {
    syncShadowParticipants(state, true);
    state.lastShadowParticipantSync = elapsed;
  }

  if (state.ambient) {
    const ambientScale = THREE.MathUtils.lerp(0.62, 0.40, day);
    state.ambient.intensity *= ambientScale;
  }

  if (state.skyFill) {
    if (skyColor?.isColor) state.skyTmp.copy(skyColor);
    else state.skyTmp.copy(NIGHT_SKY).lerp(WHITE_SKY, day);

    state.skyTmp.lerp(daylight > 0.05 ? WHITE_SKY : NIGHT_SKY, 0.30 + day * 0.28);
    if (skyHorizon?.isColor) state.skyTmp.lerp(skyHorizon, 0.06 + night * 0.08);
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

  if (state.scene?.fog?.color && night > 0) {
    state.scene.fog.color.lerp(NIGHT_HAZE, night * 0.32);
  }

  let targetExposure = THREE.MathUtils.lerp(1.24, 0.98, day);
  targetExposure *= THREE.MathUtils.lerp(1.0, 0.94, storm);
  if (underwater) targetExposure = THREE.MathUtils.lerp(targetExposure, 1.08, 0.72);
  state.targetExposure = targetExposure;
}

export function updateRealisticLightingExposure(state, renderer) {
  if (!state || !renderer || !Number.isFinite(state.targetExposure)) return;

  configureRendererShadows(state, renderer);

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
