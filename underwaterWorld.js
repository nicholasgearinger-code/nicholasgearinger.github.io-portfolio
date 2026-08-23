import * as THREE from "three";
import { getGraphicsTier } from "./graphicsSettings.js";

// Lightweight underwater atmosphere for the Crystal ocean.
// This deliberately avoids another fullscreen render pass: mobile already spends
// most of its budget on the GPU FFT ocean + shadows. The effect is built from
// scene fog, one non-shadowed hemisphere fill, a handful of translucent shafts,
// and a tiny suspended-particle field around the camera.

const SHALLOW_FOG_DAY = new THREE.Color(0x2a9caf);
const DEEP_FOG_DAY = new THREE.Color(0x0b425b);
const SHALLOW_FOG_NIGHT = new THREE.Color(0x183c58);
const DEEP_FOG_NIGHT = new THREE.Color(0x081d33);
const SKY_FILL_DAY = new THREE.Color(0xa9e9ee);
const SKY_FILL_NIGHT = new THREE.Color(0x4c6f95);
const GROUND_FILL_DAY = new THREE.Color(0x4d766f);
const GROUND_FILL_NIGHT = new THREE.Color(0x172536);
const MOTE_DAY = new THREE.Color(0xb8f4ee);
const MOTE_NIGHT = new THREE.Color(0x6e94b3);

let sharedShaftTexture = null;

function clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function smooth01(v) {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
}

function createShaftTexture() {
  if (sharedShaftTexture) return sharedShaftTexture;

  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 192;
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0.00, "rgba(225,255,255,0.00)");
  grad.addColorStop(0.08, "rgba(225,255,255,0.34)");
  grad.addColorStop(0.52, "rgba(165,235,240,0.16)");
  grad.addColorStop(1.00, "rgba(120,210,225,0.00)");

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.lineTo(28, 0);
  ctx.lineTo(43, 192);
  ctx.lineTo(5, 192);
  ctx.closePath();
  ctx.fill();

  sharedShaftTexture = new THREE.CanvasTexture(canvas);
  sharedShaftTexture.colorSpace = THREE.SRGBColorSpace;
  sharedShaftTexture.needsUpdate = true;
  return sharedShaftTexture;
}

function makeMotes(count) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = i * 2.399963229728653;
    const r = 2.5 + ((i * 37) % 100) / 100 * 11.0;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = -4.0 + ((i * 53) % 100) / 100 * 8.0;
    positions[i * 3 + 2] = Math.sin(a) * r;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: MOTE_DAY,
    size: 0.045,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  return points;
}

function shaftCountForTier() {
  const tier = getGraphicsTier();
  if (tier === "high") return 8;
  if (tier === "medium") return 6;
  return 4;
}

function moteCountForTier() {
  const tier = getGraphicsTier();
  if (tier === "high") return 96;
  if (tier === "medium") return 64;
  return 40;
}

export function ensureUnderwaterWorld(scene, waterY) {
  if (!scene) return null;

  let state = scene.userData.__riftUnderwaterWorld;
  if (state) {
    state.waterY = waterY;
    state.enabled = true;
    return state;
  }

  const fill = new THREE.HemisphereLight(SKY_FILL_DAY, GROUND_FILL_DAY, 0);
  fill.name = "rift-underwater-fill";
  fill.castShadow = false;
  scene.add(fill);

  const motes = makeMotes(moteCountForTier());
  motes.name = "rift-underwater-motes";
  scene.add(motes);

  const shaftGroup = new THREE.Group();
  shaftGroup.name = "rift-underwater-shafts-v2";
  scene.add(shaftGroup);

  const shafts = [];
  const shaftTexture = createShaftTexture();
  const shaftCount = shaftCountForTier();
  for (let i = 0; i < shaftCount; i++) {
    const material = new THREE.SpriteMaterial({
      map: shaftTexture,
      color: 0xbceff2,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.center.set(0.5, 1.0);
    sprite.visible = false;
    shaftGroup.add(sprite);

    const a = i * 2.399963229728653 + 0.7;
    const radius = 5.5 + (i % 3) * 3.2;
    shafts.push({
      sprite,
      ox: Math.cos(a) * radius,
      oz: Math.sin(a) * radius,
      phase: i * 1.73,
      width: 0.85 + (i % 2) * 0.45,
    });
  }

  state = {
    scene,
    waterY,
    enabled: true,
    fill,
    motes,
    shafts,
    fogColor: new THREE.Color(),
    skyColor: new THREE.Color(),
    groundColor: new THREE.Color(),
    moteColor: new THREE.Color(),
  };

  scene.userData.__riftUnderwaterWorld = state;
  console.info("[underwater] mobile atmospheric lighting v1 active");
  return state;
}

export function updateUnderwaterWorld(
  state,
  elapsed,
  cameraY,
  playerPos,
  dayAmount = 1,
  stormAmount = 0,
  worldLighting = null,
) {
  if (!state?.enabled || !Number.isFinite(state.waterY)) return;

  const depth = Number.isFinite(cameraY) ? Math.max(0, state.waterY - cameraY) : 0;
  // Start the transition soon after the eyes cross the surface, then be fully
  // active by about one metre down. This is deliberately smoother than main.js's
  // gameplay hysteresis; visual atmosphere can fade without affecting swim state.
  const submerged = smooth01((depth - 0.12) / 0.88);

  if (submerged <= 0.001) {
    state.fill.intensity = 0;
    state.motes.visible = false;
    for (const s of state.shafts) s.sprite.visible = false;
    return;
  }

  const day = clamp01(dayAmount);
  const storm = clamp01(stormAmount);
  const deepT = smooth01(depth / 8.5);
  const daylight = day * (1 - storm * 0.48);

  // -------------------------------------------------------------------------
  // Water-column fog / background
  // -------------------------------------------------------------------------
  const shallowFog = state.fogColor.copy(SHALLOW_FOG_NIGHT).lerp(SHALLOW_FOG_DAY, daylight);
  const deepFog = state.skyColor.copy(DEEP_FOG_NIGHT).lerp(DEEP_FOG_DAY, daylight);
  state.fogColor.copy(shallowFog).lerp(deepFog, deepT * 0.82);

  if (state.scene.fog?.isFogExp2) {
    // Clear reef water close to the surface, progressively denser with depth.
    const density = THREE.MathUtils.lerp(0.0065, 0.030, deepT) * (1 + storm * 0.38);
    state.scene.fog.density = THREE.MathUtils.lerp(state.scene.fog.density, density, submerged * 0.62);
    state.scene.fog.color.lerp(state.fogColor, submerged * 0.72);
  }

  // scene.background is not affected by fog. Tint it to the water-column color
  // while submerged so gaps beyond the finite water/terrain geometry cannot show
  // up as the bright cyan horizon strip seen in testing.
  if (state.scene.background?.isColor) {
    state.scene.background.lerp(state.fogColor, submerged * 0.88);
  }

  // -------------------------------------------------------------------------
  // Diffuse underwater fill
  // -------------------------------------------------------------------------
  state.skyColor.copy(SKY_FILL_NIGHT).lerp(SKY_FILL_DAY, daylight);
  state.groundColor.copy(GROUND_FILL_NIGHT).lerp(GROUND_FILL_DAY, daylight);
  state.fill.color.copy(state.skyColor);
  state.fill.groundColor.copy(state.groundColor);
  state.fill.intensity = submerged * THREE.MathUtils.lerp(0.18, 0.62, daylight) * (1 - deepT * 0.38);

  // Keep the real directional key for shape/shadows, but filter it through the
  // water column instead of letting the above-water sun blast the reef unchanged.
  if (worldLighting?.sun) {
    const key = worldLighting.sun;
    const transmission = THREE.MathUtils.lerp(0.78, 0.34, deepT) * (1 - storm * 0.24);
    key.intensity *= THREE.MathUtils.lerp(1, transmission, submerged);
    const waterSun = state.skyColor;
    key.color.lerp(waterSun, submerged * (0.10 + deepT * 0.18));
  }

  // -------------------------------------------------------------------------
  // Suspended particulates
  // -------------------------------------------------------------------------
  if (playerPos?.isVector3) {
    state.motes.position.copy(playerPos);
  } else {
    state.motes.position.y = cameraY;
  }
  state.motes.rotation.y = elapsed * 0.025;
  state.motes.rotation.x = Math.sin(elapsed * 0.11) * 0.06;
  state.moteColor.copy(MOTE_NIGHT).lerp(MOTE_DAY, daylight);
  state.motes.material.color.copy(state.moteColor);
  state.motes.material.opacity = submerged * THREE.MathUtils.lerp(0.10, 0.22, daylight) * (1 - deepT * 0.25);
  state.motes.visible = state.motes.material.opacity > 0.01;

  // -------------------------------------------------------------------------
  // Soft god rays from the surface
  // -------------------------------------------------------------------------
  const shaftOpacity = submerged * daylight * (1 - storm * 0.72) * (1 - deepT * 0.38);
  const px = playerPos?.isVector3 ? playerPos.x : 0;
  const pz = playerPos?.isVector3 ? playerPos.z : 0;
  const visibleLength = THREE.MathUtils.clamp(depth + 5.5, 5.5, 13.0);

  for (let i = 0; i < state.shafts.length; i++) {
    const s = state.shafts[i];
    const drift = Math.sin(elapsed * 0.13 + s.phase) * 0.9;
    s.sprite.position.set(px + s.ox + drift, state.waterY - 0.05, pz + s.oz - drift * 0.45);
    s.sprite.scale.set(s.width * visibleLength * 0.18, visibleLength, 1);
    s.sprite.material.opacity = shaftOpacity * (0.055 + (i % 3) * 0.014);
    s.sprite.visible = s.sprite.material.opacity > 0.004;
  }
}

export function disposeUnderwaterWorld(scene, state) {
  if (!state) return;
  state.enabled = false;
  if (state.fill) scene.remove(state.fill);
  if (state.motes) {
    scene.remove(state.motes);
    state.motes.geometry?.dispose();
    state.motes.material?.dispose();
  }
  if (state.shafts) {
    for (const s of state.shafts) s.sprite.material?.dispose();
  }
  if (state.shaftGroup) scene.remove(state.shaftGroup);
  const group = state.scene?.getObjectByName?.("rift-underwater-shafts-v2");
  if (group) state.scene.remove(group);
  if (scene?.userData?.__riftUnderwaterWorld === state) delete scene.userData.__riftUnderwaterWorld;
}
