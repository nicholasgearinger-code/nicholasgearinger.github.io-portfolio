import * as THREE from "three";
import { getGraphicsSettings } from "./graphicsSettings.js";

// -----------------------------------------------------------------------------
// SWAP POINT: clouds. Each cloud is a small cluster of soft circular
// billboards (the same radial-gradient technique used for the sun/moon
// glow in dayNightCycle.js) rather than a single flat sprite — one
// billboard reads as a blob, several overlapping ones at different sizes
// reads as a puffy cloud. Cheap: still just a handful of sprites per
// cloud, additive/alpha blended, no real volumetrics. Swap CLOUD_STYLE for
// a different look/density per biome without touching drift or tinting.
// -----------------------------------------------------------------------------

// Shared/reused Color instance for the realistic cloud dome's storm
// darkening (see updateRealisticCloudDome) — avoids allocating a new
// THREE.Color every frame the way a literal would.
const stormCloudColor = new THREE.Color();

const CLOUD_STYLE = {
  ember: { count: 14, altitude: 88, spread: 175, puffColor: 0x4a3830, opacity: 0.55, scale: 25 },
  verdant: { count: 16, altitude: 95, spread: 165, puffColor: 0xf4f7fb, opacity: 0.85, scale: 30 },
  crystal: { count: 10, altitude: 100, spread: 170, puffColor: 0xeaf3f7, opacity: 0.85, scale: 22 },
  abyssal: { count: 10, altitude: 80, spread: 145, puffColor: 0x2e2a3a, opacity: 0.6, scale: 18 },
  ashen: { count: 5, altitude: 110, spread: 155, puffColor: 0xd6cdb8, opacity: 0.35, scale: 13 },
};

const GROUND_FOG_STYLE = {
  ember: { count: 4, altitude: 2, spread: 90, puffColor: 0x6b5d52, opacity: 0.3, scale: 22 },
  verdant: { count: 5, altitude: 1.5, spread: 100, puffColor: 0xe8eef0, opacity: 0.35, scale: 24 },
  crystal: { count: 3, altitude: 2, spread: 90, puffColor: 0xcfe6ee, opacity: 0.25, scale: 20 },
  abyssal: { count: 7, altitude: 1, spread: 100, puffColor: 0x342f42, opacity: 0.45, scale: 26 },
  ashen: { count: 4, altitude: 1.5, spread: 100, puffColor: 0xb8ab90, opacity: 0.28, scale: 22 },
};

const DAWN_DUSK_ACCENTS = [0xff6a3a, 0xff8c3a, 0xffb84d, 0xf0722a, 0xffa040, 0xe85a1e];
const STORM_GRAY = new THREE.Color(0x3a3f47);
const LIGHTNING_WHITE = new THREE.Color(0xf0f4ff);

let sharedPuffTexture = null;
function getPuffTexture() {
  if (sharedPuffTexture) return sharedPuffTexture;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,0.97)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.78, "rgba(255,255,255,0.5)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  sharedPuffTexture = new THREE.CanvasTexture(canvas);
  return sharedPuffTexture;
}

function createCloud(scene, style, flatten = 1) {
  const group = new THREE.Group();
  const puffCount = 3 + Math.floor(Math.random() * 3);
  const sprites = [];
  const baseColor = new THREE.Color(style.puffColor);
  const accentColor = new THREE.Color(DAWN_DUSK_ACCENTS[Math.floor(Math.random() * DAWN_DUSK_ACCENTS.length)]);
  for (let i = 0; i < puffCount; i++) {
    const mat = new THREE.SpriteMaterial({
      map: getPuffTexture(), color: style.puffColor, transparent: true, opacity: style.opacity,
      depthWrite: false, fog: true,
    });
    const sprite = new THREE.Sprite(mat);
    const sX = style.scale * (0.75 + Math.random() * 0.65);
    const sY = style.scale * (0.6 + Math.random() * 0.7) * flatten;
    sprite.material.rotation = Math.random() * Math.PI * 2;
    const baseLocalX = (Math.random() - 0.5) * style.scale * 0.8;
    const baseLocalZ = (Math.random() - 0.5) * style.scale * 0.8;
    sprite.userData.baseScaleX = sX;
    sprite.userData.baseScaleY = sY;
    sprite.userData.baseLocalX = baseLocalX;
    sprite.userData.baseLocalZ = baseLocalZ;
    sprite.userData.driftPhaseX = Math.random() * Math.PI * 2;
    sprite.userData.driftPhaseZ = Math.random() * Math.PI * 2;
    sprite.userData.driftSpeed = 0.008 + Math.random() * 0.012;
    sprite.userData.driftRange = style.scale * (0.1 + Math.random() * 0.12);
    sprite.userData.stormGrowth = 0.5 + Math.random() * 0.7;
    sprite.scale.set(sX, sY, 1);
    const localYRange = style.scale * 0.175 * flatten;
    const localY = (Math.random() - 0.5) * localYRange * 2;
    sprite.userData.localY = localY;
    sprite.userData.localYRange = localYRange || 1;
    sprite.position.set(baseLocalX, localY, baseLocalZ);
    group.add(sprite);
    sprites.push(sprite);
  }
  const baseY = style.altitude + (Math.random() - 0.5) * 12 * flatten;
  group.position.set((Math.random() - 0.5) * style.spread * 2, baseY, (Math.random() - 0.5) * style.spread * 2);
  scene.add(group);
  return { group, sprites, baseOpacity: style.opacity, baseColor, accentColor, baseY };
}

function createClouds(scene, biome) {
  const style = CLOUD_STYLE[biome] || CLOUD_STYLE.verdant;
  const clouds = [];
  const groundFog = [];
  const fogStyle = GROUND_FOG_STYLE[biome] || GROUND_FOG_STYLE.verdant;
  return { clouds, style, groundFog, fogStyle, biome, windOffsetX: 0, windOffsetZ: 0, elapsed: 0 };
}

const _cloudToSun = new THREE.Vector3();
const _cloudToCam = new THREE.Vector3();

function updateClouds(handle, dt, wind, dayAmount, rainIntensity, skyHorizonColor, sunPos, cameraPos) {
  if (!handle) return;
  const { clouds, style, groundFog, fogStyle, biome } = handle;
  handle.elapsed += dt;
  const lightFactor = 0.55 + dayAmount * 0.45;
  const storm = rainIntensity || 0;
  const stormDarken = 1 - storm * 0.35;
  const warmth = skyHorizonColor ? THREE.MathUtils.clamp((skyHorizonColor.r - skyHorizonColor.b) * 1.8, 0, 1) : 0;
  const nightFade = biome === "verdant" ? Math.max(0, Math.min(1, (dayAmount - 0.05) / 0.25)) : 1;
  for (const cloud of clouds) {
    cloud.group.position.x += (wind?.windX || 0) * dt * 0.6;
    cloud.group.position.z += (wind?.windZ || 0) * dt * 0.6;
    if (Math.abs(cloud.group.position.x) > style.spread) cloud.group.position.x = -Math.sign(cloud.group.position.x) * style.spread;
    if (Math.abs(cloud.group.position.z) > style.spread) cloud.group.position.z = -Math.sign(cloud.group.position.z) * style.spread;
    let sunProximity = 0;
    if (sunPos && cameraPos) {
      _cloudToCam.subVectors(cloud.group.position, cameraPos);
      const distToCam = _cloudToCam.length();
      if (distToCam > 1) {
        _cloudToCam.multiplyScalar(1 / distToCam);
        _cloudToSun.subVectors(sunPos, cameraPos).normalize();
        const alignment = _cloudToCam.dot(_cloudToSun);
        sunProximity = THREE.MathUtils.clamp((alignment - 0.25) / 0.55, 0, 1);
      }
    }
    if (storm > 0.3 && Math.random() < storm * 0.0006) {
      cloud.lightningUntil = handle.elapsed + 0.12;
    }
    const flashing = cloud.lightningUntil && handle.elapsed < cloud.lightningUntil;
    for (const sprite of cloud.sprites) {
      sprite.material.opacity = cloud.baseOpacity * lightFactor * stormDarken * nightFade;
      const u = handle.elapsed * sprite.userData.driftSpeed;
      sprite.position.x = sprite.userData.baseLocalX + Math.sin(u + sprite.userData.driftPhaseX) * sprite.userData.driftRange;
      sprite.position.z = sprite.userData.baseLocalZ + Math.cos(u * 0.8 + sprite.userData.driftPhaseZ) * sprite.userData.driftRange;
      const stormGrow = 1 + storm * sprite.userData.stormGrowth * 0.5;
      sprite.scale.set(sprite.userData.baseScaleX * stormGrow, sprite.userData.baseScaleY * stormGrow, 1);
      sprite.material.color.copy(cloud.baseColor);
      if (skyHorizonColor && warmth > 0) {
        sprite.material.color.lerp(skyHorizonColor, warmth * 0.6);
        sprite.material.color.lerp(cloud.accentColor, warmth * (0.25 + sunProximity * 0.65));
        sprite.material.color.multiplyScalar(1 + sunProximity * warmth * 0.5);
      }
      const heightT = (sprite.userData.localY / sprite.userData.localYRange + 1) / 2;
      sprite.material.color.multiplyScalar(0.8 + heightT * 0.35);
      if (storm > 0) sprite.material.color.lerp(STORM_GRAY, storm * 0.7);
      if (flashing) sprite.material.color.lerp(LIGHTNING_WHITE, 0.85);
      sprite.material.color.r = Math.min(1, sprite.material.color.r);
      sprite.material.color.g = Math.min(1, sprite.material.color.g);
      sprite.material.color.b = Math.min(1, sprite.material.color.b);
    }
  }

  for (const bank of groundFog) {
    bank.group.position.x += (wind?.windX || 0) * dt;
    bank.group.position.z += (wind?.windZ || 0) * dt;
    if (Math.abs(bank.group.position.x) > fogStyle.spread) bank.group.position.x = -Math.sign(bank.group.position.x) * fogStyle.spread;
    if (Math.abs(bank.group.position.z) > fogStyle.spread) bank.group.position.z = -Math.sign(bank.group.position.z) * fogStyle.spread;
    for (const sprite of bank.sprites) {
      sprite.material.opacity = bank.baseOpacity * lightFactor;
    }
  }
}

function disposeClouds(scene, handle) {
  if (!handle) return;
  for (const cloud of handle.clouds) {
    scene.remove(cloud.group);
    for (const sprite of cloud.sprites) sprite.material.dispose();
  }
  for (const bank of handle.groundFog) {
    scene.remove(bank.group);
    for (const sprite of bank.sprites) sprite.material.dispose();
  }
}

const _occToTarget = new THREE.Vector3();
const _occToCloud = new THREE.Vector3();
function getCloudOcclusionFactor(handle, cameraPos, targetPos) {
  if (!handle) return 0;
  _occToTarget.subVectors(targetPos, cameraPos).normalize();
  let occlusion = 0;
  for (const cloud of handle.clouds) {
    _occToCloud.subVectors(cloud.group.position, cameraPos);
    const dist = _occToCloud.length();
    if (dist < 1) continue;
    _occToCloud.multiplyScalar(1 / dist);
    const alignment = _occToCloud.dot(_occToTarget);
    if (alignment > 0.9975) {
      occlusion = Math.max(occlusion, cloud.baseOpacity);
    }
  }
  return Math.min(0.92, occlusion);
}

function createCloudLayerTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  const blobCount = 90;
  for (let i = 0; i < blobCount; i++) {
    const bx = Math.random() * size, by = Math.random() * size;
    const r = 35 + Math.random() * 75;
    const alpha = 0.55 + Math.random() * 0.4;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const x = bx + ox * size, y = by + oy * size;
        if (x < -r || x > size + r || y < -r || y > size + r) continue;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
        grad.addColorStop(0.6, `rgba(255,255,255,${alpha * 0.5})`);
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function createCloudLayer(scene, altitude = 135, repeatCount = 5) {
  return null;
}

function updateCloudLayer(handle, dt, wind, dayAmount, skyHorizonColor) {
  if (!handle) return;
  handle.driftX += (wind?.windX || 0) * dt * 0.004;
  handle.driftZ += (wind?.windZ || 0) * dt * 0.004;
  handle.texture.offset.set(handle.driftX, handle.driftZ);
  const lightFactor = 0.6 + dayAmount * 0.4;
  handle.mat.color.setScalar(lightFactor);
  if (skyHorizonColor) {
    handle.mat.color.lerp(skyHorizonColor, 0.35);
  }
}

function disposeCloudLayer(scene, handle) {
  if (!handle) return;
  scene.remove(handle.mesh);
  handle.mat.dispose();
  handle.texture.dispose();
}

let realisticCloudTexture = null;
function getRealisticCloudTexture() {
  if (realisticCloudTexture) return realisticCloudTexture;
  const url = new URL("textures/sky_clouds.png", import.meta.url).href;
  realisticCloudTexture = new THREE.TextureLoader().load(
    url,
    () => console.log("[clouds] realistic cloud texture loaded:", url),
    undefined,
    (err) => console.error("[clouds] realistic cloud texture FAILED to load:", url, err)
  );
  if (!realisticCloudTexture.image) {
    const placeholderCanvas = document.createElement("canvas");
    placeholderCanvas.width = 1;
    placeholderCanvas.height = 1;
    realisticCloudTexture.image = placeholderCanvas;
  }
  realisticCloudTexture.colorSpace = THREE.SRGBColorSpace;
  realisticCloudTexture.wrapS = THREE.RepeatWrapping;
  return realisticCloudTexture;
}

const moodCloudTextureCache = {};
function getMoodCloudTexture(filename) {
  if (moodCloudTextureCache[filename]) return moodCloudTextureCache[filename];
  const url = new URL(`textures/${filename}`, import.meta.url).href;
  const tex = new THREE.TextureLoader().load(
    url,
    () => console.log("[clouds] mood sky texture loaded:", url),
    undefined,
    (err) => console.error("[clouds] mood sky texture FAILED to load:", url, err)
  );
  if (!tex.image) {
    const placeholderCanvas = document.createElement("canvas");
    placeholderCanvas.width = 1;
    placeholderCanvas.height = 1;
    tex.image = placeholderCanvas;
  }
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  moodCloudTextureCache[filename] = tex;
  return tex;
}

const CLOUD_MOOD_POOLS = {
  midnight: ["sky_night.png", "sky_night_2.png", "sky_starfield.png", "sky_moonlit_sea.png", "sky_nebula.png"],
  night: ["sky_night.png", "sky_night_2.png", "sky_starfield.png", "sky_moonlit_sea.png", "sky_nebula.png"],
  sunrise: ["sky_dusk_1.png", "sky_dusk_5.png"],
  morning: ["sky_dusk_2.png"],
  noon: ["sky_day_1.png", "sky_day_2.png"],
  afternoon: ["sky_day_1.png", "sky_day_2.png"],
  sunset: ["sky_dusk_3.png", "sky_dusk_6.png"],
  twilight: ["sky_dusk_4.png"],
  storm: ["sky_storm.png"],
};

const PHASE_SEQUENCE = ["midnight", "night", "sunrise", "morning", "noon", "afternoon", "sunset", "twilight"];
function pickTimePhase(phaseT) {
  const shifted = (phaseT + 1 / 16 + 1) % 1;
  const idx = Math.floor(shifted * PHASE_SEQUENCE.length) % PHASE_SEQUENCE.length;
  return PHASE_SEQUENCE[idx];
}

function pickCloudMoodBucket(phaseT, stormAmount) {
  if (stormAmount > 0.15) return "storm";
  return pickTimePhase(phaseT);
}

function createRealisticCloudDome(scene) {
  const texture = getRealisticCloudTexture();
  // Start loading the storm panorama as soon as the game level creates its
  // cloud dome. Previously this texture was requested only after rain crossed
  // the storm threshold, so mobile WebGPU could briefly render the 1x1 safety
  // placeholder during the same transition that was also fading the dome out.
  // Preloading it removes that visible brightness pop when a storm is triggered.
  getMoodCloudTexture("sky_storm.png");

  const RADIUS = 860;
  const NORTH_POLE_TRIM = 0.022;
  const geo = new THREE.SphereGeometry(RADIUS, 48, 24, 0, Math.PI * 2, NORTH_POLE_TRIM, Math.PI - NORTH_POLE_TRIM);
  const mat = new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false, side: THREE.BackSide,
    fog: false,
    color: 0xffffff,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -95;
  scene.add(mesh);

  const capRadius = RADIUS * Math.sin(NORTH_POLE_TRIM) * 1.05;
  const capGeo = new THREE.CircleGeometry(capRadius, 24);
  capGeo.rotateX(Math.PI / 2);
  const capMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.y = RADIUS * Math.cos(NORTH_POLE_TRIM);
  cap.renderOrder = -95;
  scene.add(cap);

  return { mesh, mat, cap, capMat };
}

function updateRealisticCloudDome(handle, dt, dayAmount, skyHorizonColor, skyZenithColor, stormAmount = 0, phaseT = 0) {
  if (!handle) return;

  const bucket = pickCloudMoodBucket(phaseT, stormAmount);
  if (bucket !== handle.moodBucket) {
    const previousBucket = handle.moodBucket;
    handle.moodBucket = bucket;
    handle.moodEntryCounts = handle.moodEntryCounts || {};
    handle.moodEntryCounts[bucket] = (handle.moodEntryCounts[bucket] || 0) + 1;
    const pool = CLOUD_MOOD_POOLS[bucket];
    const selected = pool[(handle.moodEntryCounts[bucket] - 1) % pool.length];
    if (selected !== handle.moodTextureName && selected !== handle.moodPendingTexture) {
      const stormBoundary = bucket === "storm" || previousBucket === "storm" || handle.moodTextureName === "sky_storm.png";
      if (stormBoundary) {
        // A storm must never make the whole sky dome disappear. The old
        // transition dipped opacity all the way to zero before swapping maps,
        // exposing the much brighter fallback sky for ~1.6s and then covering it
        // again — exactly the on/off flash seen when the storm debug toggle was
        // pressed. Storm entry/exit now keeps opacity continuous and swaps the
        // already-preloaded map directly. Rain/fog/color still ease normally.
        handle.moodTextureName = selected;
        handle.mat.map = getMoodCloudTexture(selected);
        handle.mat.needsUpdate = true;
        handle.moodPendingTexture = null;
        handle.moodTransitionT = 0;
      } else {
        handle.moodPendingTexture = selected;
        handle.moodTransitionT = 0;
      }
    }
  }

  const TRANSITION_SECONDS = 1.6;
  let transitionOpacityMult = 1;
  if (handle.moodPendingTexture) {
    handle.moodTransitionT += dt / TRANSITION_SECONDS;
    if (handle.moodTransitionT < 1) {
      transitionOpacityMult = 1 - handle.moodTransitionT;
    } else if (handle.moodTransitionT < 2) {
      if (handle.moodTextureName !== handle.moodPendingTexture) {
        handle.moodTextureName = handle.moodPendingTexture;
        handle.mat.map = getMoodCloudTexture(handle.moodPendingTexture);
        handle.mat.needsUpdate = true;
      }
      transitionOpacityMult = handle.moodTransitionT - 1;
    } else {
      handle.moodPendingTexture = null;
      transitionOpacityMult = 1;
    }
  }

  handle.mesh.rotation.y += dt * (0.006 + stormAmount * 0.02);

  if (handle.moodTextureName) {
    const brightness = 0.55 + dayAmount * 0.55;
    handle.mat.color.setScalar(brightness);
  } else if (skyHorizonColor && skyZenithColor) {
    const avgTint = skyHorizonColor.clone().lerp(skyZenithColor, 0.5);
    handle.mat.color.copy(avgTint);
    const brightness = 0.75 + dayAmount * 0.5;
    handle.mat.color.multiplyScalar(brightness);
  } else if (skyHorizonColor) {
    handle.mat.color.copy(skyHorizonColor).multiplyScalar(0.75 + dayAmount * 0.5);
  } else {
    handle.mat.color.setScalar(0.6 + dayAmount * 0.4);
  }

  const stormDarkenAmount = stormAmount * 0.85 * (0.4 + dayAmount * 0.6);
  if (stormAmount > 0) handle.mat.color.lerp(stormCloudColor.setScalar(0.16), stormDarkenAmount);

  // Clear-weather cloud density can retain the very slow ±6% breathing,
  // but storm cover must be visually steady. On a nearly opaque dark dome,
  // even a small opacity modulation reads like the entire sky/lighting is
  // pulsing. Freeze that term once rain is present.
  handle.breathPhase = (handle.breathPhase || 0) + dt * 0.12;
  const breathe = stormAmount > 0.08 ? 1 : 1 + Math.sin(handle.breathPhase) * 0.06;
  handle.mat.opacity = (0.9 + stormAmount * 0.09) * breathe * transitionOpacityMult;

  if (handle.capMat) {
    handle.capMat.color.copy(handle.mat.color);
    handle.capMat.opacity = handle.mat.opacity;
  }

  handle.driftOffset = (handle.driftOffset || 0) + dt * (0.0022 + stormAmount * 0.006);
  handle.mat.map.offset.x = handle.driftOffset;
}

function disposeRealisticCloudDome(scene, handle) {
  if (!handle) return;
  scene.remove(handle.mesh);
  handle.mesh.geometry.dispose();
  handle.mat.dispose();
  if (handle.cap) {
    scene.remove(handle.cap);
    handle.cap.geometry.dispose();
    handle.capMat.dispose();
  }
}

export { createClouds, updateClouds, disposeClouds, getCloudOcclusionFactor, createCloudLayer, updateCloudLayer, disposeCloudLayer, createRealisticCloudDome, updateRealisticCloudDome, disposeRealisticCloudDome };
