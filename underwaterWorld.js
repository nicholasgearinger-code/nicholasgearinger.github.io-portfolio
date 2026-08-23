import * as THREE from "three";
import { getGraphicsTier } from "./graphicsSettings.js";

// Mobile-first underwater world pass for Crystal.
//
// Deliberately NO second scene render, SSR or raymarching. The existing world
// lights are filtered through the water column and a handful of cheap geometry
// layers provide the missing underwater depth cues:
//   - depth-dependent fog + a camera-following far-water shell
//   - a soft Snell-window/transmission disc immediately beneath the surface
//   - terrain-conforming moving caustics sampled from the REAL seafloor height
//   - stronger surface god rays, suspended motes and small rising bubbles
//
// All expensive ocean displacement remains in gpu_fft_ocean.js.

const SHALLOW_FOG_DAY = new THREE.Color(0x319fb0);
const MID_FOG_DAY = new THREE.Color(0x12677f);
const DEEP_FOG_DAY = new THREE.Color(0x082f47);
const SHALLOW_FOG_NIGHT = new THREE.Color(0x173b58);
const MID_FOG_NIGHT = new THREE.Color(0x0c2c47);
const DEEP_FOG_NIGHT = new THREE.Color(0x06182d);

const SKY_FILL_DAY = new THREE.Color(0xbceff1);
const SKY_FILL_NIGHT = new THREE.Color(0x58789c);
const GROUND_FILL_DAY = new THREE.Color(0x6f826f);
const GROUND_FILL_NIGHT = new THREE.Color(0x182637);
const MOTE_DAY = new THREE.Color(0xc8f7ef);
const MOTE_NIGHT = new THREE.Color(0x7897b2);
const BUBBLE_DAY = new THREE.Color(0xdffcff);
const BUBBLE_NIGHT = new THREE.Color(0x9db8d0);
const CAUSTIC_DAY = new THREE.Color(0xffedb5);
const SNELL_DAY = new THREE.Color(0xcdfbff);
const SNELL_NIGHT = new THREE.Color(0x7699bd);

let sharedShaftTexture = null;
let sharedCausticTexture = null;
let sharedSnellTexture = null;
let sharedBubbleTexture = null;

function clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function smooth01(v) {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
}

function seededRandom(seed = 1337) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function createShaftTexture() {
  if (sharedShaftTexture) return sharedShaftTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0.00, "rgba(235,255,255,0.00)");
  grad.addColorStop(0.06, "rgba(235,255,255,0.52)");
  grad.addColorStop(0.42, "rgba(175,240,245,0.24)");
  grad.addColorStop(0.80, "rgba(130,215,225,0.09)");
  grad.addColorStop(1.00, "rgba(100,190,210,0.00)");

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(27, 0);
  ctx.lineTo(37, 0);
  ctx.lineTo(59, 256);
  ctx.lineTo(5, 256);
  ctx.closePath();
  ctx.fill();

  sharedShaftTexture = new THREE.CanvasTexture(canvas);
  sharedShaftTexture.colorSpace = THREE.SRGBColorSpace;
  return sharedShaftTexture;
}

function createCausticTexture() {
  if (sharedCausticTexture) return sharedCausticTexture;
  const size = 192;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const rand = seededRandom(481516);

  ctx.clearRect(0, 0, size, size);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Curved cell-edge network rather than filled blobs. The texture itself never
  // changes; moving/rotating UVs make it flow, which is far cheaper than updating
  // a canvas or render target every frame on mobile.
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0
      ? "rgba(255,246,198,0.38)"
      : "rgba(255,255,235,0.25)";
    ctx.lineWidth = pass === 0 ? 2.2 : 1.0;
    for (let i = 0; i < 34; i++) {
      const x0 = rand() * size;
      const y0 = rand() * size;
      const len = 24 + rand() * 62;
      const a = rand() * Math.PI * 2;
      const bend = (rand() - 0.5) * 44;
      const x1 = x0 + Math.cos(a) * len;
      const y1 = y0 + Math.sin(a) * len;
      const cx = (x0 + x1) * 0.5 + Math.cos(a + Math.PI / 2) * bend;
      const cy = (y0 + y1) * 0.5 + Math.sin(a + Math.PI / 2) * bend;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cx, cy, x1, y1);
      ctx.stroke();
    }
  }

  sharedCausticTexture = new THREE.CanvasTexture(canvas);
  sharedCausticTexture.colorSpace = THREE.SRGBColorSpace;
  sharedCausticTexture.wrapS = THREE.RepeatWrapping;
  sharedCausticTexture.wrapT = THREE.RepeatWrapping;
  sharedCausticTexture.center.set(0.5, 0.5);
  return sharedCausticTexture;
}

function createSnellTexture() {
  if (sharedSnellTexture) return sharedSnellTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0.00, "rgba(242,255,255,0.70)");
  g.addColorStop(0.38, "rgba(204,250,255,0.42)");
  g.addColorStop(0.72, "rgba(126,218,232,0.15)");
  g.addColorStop(1.00, "rgba(75,160,190,0.00)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  sharedSnellTexture = new THREE.CanvasTexture(canvas);
  sharedSnellTexture.colorSpace = THREE.SRGBColorSpace;
  return sharedSnellTexture;
}

function createBubbleTexture() {
  if (sharedBubbleTexture) return sharedBubbleTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(28, 24, 2, 32, 32, 29);
  g.addColorStop(0.00, "rgba(255,255,255,0.80)");
  g.addColorStop(0.18, "rgba(225,250,255,0.34)");
  g.addColorStop(0.62, "rgba(180,230,245,0.08)");
  g.addColorStop(0.82, "rgba(220,250,255,0.42)");
  g.addColorStop(1.00, "rgba(220,250,255,0.00)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  sharedBubbleTexture = new THREE.CanvasTexture(canvas);
  sharedBubbleTexture.colorSpace = THREE.SRGBColorSpace;
  return sharedBubbleTexture;
}

function shaftCountForTier() {
  const tier = getGraphicsTier();
  if (tier === "high") return 8;
  if (tier === "medium") return 6;
  return 4;
}

function moteCountForTier() {
  const tier = getGraphicsTier();
  if (tier === "high") return 104;
  if (tier === "medium") return 72;
  return 44;
}

function bubbleCountForTier() {
  const tier = getGraphicsTier();
  if (tier === "high") return 34;
  if (tier === "medium") return 24;
  return 16;
}

function makeMotes(count) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = i * 2.399963229728653;
    const r = 2.0 + ((i * 37) % 100) / 100 * 12.0;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = -4.5 + ((i * 53) % 100) / 100 * 9.0;
    positions[i * 3 + 2] = Math.sin(a) * r;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: MOTE_DAY,
    size: 0.065,
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

function makeBubbles(count) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const a = i * 2.177 + 0.35;
    const r = 0.8 + ((i * 29) % 100) / 100 * 4.8;
    seeds[i * 4] = Math.cos(a) * r;
    seeds[i * 4 + 1] = Math.sin(a) * r;
    seeds[i * 4 + 2] = ((i * 41) % 100) / 100;
    seeds[i * 4 + 3] = i * 0.73;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    map: createBubbleTexture(),
    color: BUBBLE_DAY,
    size: 0.13,
    transparent: true,
    opacity: 0,
    alphaTest: 0.015,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  return { points, seeds };
}

function createHorizonShell() {
  const material = new THREE.MeshBasicMaterial({
    color: SHALLOW_FOG_DAY,
    transparent: true,
    opacity: 0,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(82, 16, 10), material);
  mesh.name = "rift-underwater-horizon-shell";
  mesh.renderOrder = -80;
  mesh.visible = false;
  mesh.frustumCulled = false;
  return mesh;
}

function createSnellWindow() {
  const material = new THREE.MeshBasicMaterial({
    map: createSnellTexture(),
    color: SNELL_DAY,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 28), material);
  mesh.geometry.rotateX(-Math.PI / 2);
  mesh.name = "rift-underwater-snell-window";
  mesh.visible = false;
  mesh.renderOrder = 2;
  return mesh;
}

function causticGridSettings() {
  const tier = getGraphicsTier();
  if (tier === "high") return { size: 38, segments: 18, repeat: 6.2 };
  if (tier === "medium") return { size: 32, segments: 14, repeat: 5.3 };
  return { size: 26, segments: 10, repeat: 4.5 };
}

function createCausticSurface(sampleHeight, waterY) {
  const settings = causticGridSettings();
  const geometry = new THREE.PlaneGeometry(
    settings.size,
    settings.size,
    settings.segments,
    settings.segments,
  );
  geometry.rotateX(-Math.PI / 2);

  const map = createCausticTexture().clone();
  map.needsUpdate = true;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(settings.repeat, settings.repeat);
  map.center.set(0.5, 0.5);

  const material = new THREE.MeshBasicMaterial({
    map,
    color: CAUSTIC_DAY,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    fog: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "rift-underwater-caustic-skin";
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;

  return {
    mesh,
    sampleHeight,
    waterY,
    lastX: Infinity,
    lastZ: Infinity,
    sampleInterval: 1.25,
  };
}

function resampleCausticSurface(caustics, x, z, force = false) {
  if (!caustics?.mesh || typeof caustics.sampleHeight !== "function") return;
  const dx = x - caustics.lastX;
  const dz = z - caustics.lastZ;
  if (!force && dx * dx + dz * dz < caustics.sampleInterval * caustics.sampleInterval) {
    caustics.mesh.position.x = x;
    caustics.mesh.position.z = z;
    return;
  }

  const pos = caustics.mesh.geometry.attributes.position;
  caustics.mesh.position.set(x, 0, z);
  for (let i = 0; i < pos.count; i++) {
    const wx = x + pos.getX(i);
    const wz = z + pos.getZ(i);
    const h = caustics.sampleHeight(wx, wz);
    const y = Number.isFinite(h) ? h + 0.035 : caustics.waterY - 12;
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
  caustics.mesh.geometry.computeBoundingSphere();
  caustics.lastX = x;
  caustics.lastZ = z;
}

export function ensureUnderwaterWorld(scene, waterY, sampleHeight = null) {
  if (!scene) return null;

  let state = scene.userData.__riftUnderwaterWorld;
  if (state) {
    state.waterY = waterY;
    state.enabled = true;
    if (typeof sampleHeight === "function") {
      state.sampleHeight = sampleHeight;
      if (state.caustics) state.caustics.sampleHeight = sampleHeight;
    }
    return state;
  }

  const motes = makeMotes(moteCountForTier());
  motes.name = "rift-underwater-motes";
  scene.add(motes);

  const bubbles = makeBubbles(bubbleCountForTier());
  bubbles.points.name = "rift-underwater-bubbles";
  scene.add(bubbles.points);

  const shaftGroup = new THREE.Group();
  shaftGroup.name = "rift-underwater-shafts-v3";
  scene.add(shaftGroup);

  const shafts = [];
  const shaftTexture = createShaftTexture();
  const shaftCount = shaftCountForTier();
  for (let i = 0; i < shaftCount; i++) {
    const material = new THREE.SpriteMaterial({
      map: shaftTexture,
      color: 0xc8f7f4,
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
    const radius = 3.8 + (i % 3) * 3.0;
    shafts.push({
      sprite,
      ox: Math.cos(a) * radius,
      oz: Math.sin(a) * radius,
      phase: i * 1.73,
      width: 1.15 + (i % 2) * 0.55,
    });
  }

  const horizonShell = createHorizonShell();
  scene.add(horizonShell);

  const snellWindow = createSnellWindow();
  scene.add(snellWindow);

  const caustics = createCausticSurface(sampleHeight, waterY);
  scene.add(caustics.mesh);

  state = {
    scene,
    waterY,
    sampleHeight,
    enabled: true,
    motes,
    bubbles,
    shaftGroup,
    shafts,
    horizonShell,
    snellWindow,
    caustics,
    fogColor: new THREE.Color(),
    midFogColor: new THREE.Color(),
    deepFogColor: new THREE.Color(),
    skyColor: new THREE.Color(),
    groundColor: new THREE.Color(),
    moteColor: new THREE.Color(),
    bubbleColor: new THREE.Color(),
  };

  scene.userData.__riftUnderwaterWorld = state;
  console.info("[underwater] depth fog + caustics + Snell window v3 active");
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
  const submerged = smooth01((depth - 0.08) / 0.82);
  const px = playerPos?.isVector3 ? playerPos.x : 0;
  const pz = playerPos?.isVector3 ? playerPos.z : 0;

  if (submerged <= 0.001) {
    state.motes.visible = false;
    state.bubbles.points.visible = false;
    state.horizonShell.visible = false;
    state.snellWindow.visible = false;
    state.caustics.mesh.visible = false;
    for (const s of state.shafts) s.sprite.visible = false;
    return;
  }

  const day = clamp01(dayAmount);
  const storm = clamp01(stormAmount);
  const shallowT = 1 - smooth01(depth / 3.2);
  const midT = smooth01((depth - 1.8) / 5.0);
  const deepT = smooth01(depth / 10.0);
  const daylight = day * (1 - storm * 0.52);

  // -------------------------------------------------------------------------
  // Depth-dependent water column + finite-world seam cover
  // -------------------------------------------------------------------------
  state.fogColor.copy(SHALLOW_FOG_NIGHT).lerp(SHALLOW_FOG_DAY, daylight);
  state.midFogColor.copy(MID_FOG_NIGHT).lerp(MID_FOG_DAY, daylight);
  state.deepFogColor.copy(DEEP_FOG_NIGHT).lerp(DEEP_FOG_DAY, daylight);
  state.fogColor.lerp(state.midFogColor, midT * 0.72);
  state.fogColor.lerp(state.deepFogColor, deepT * 0.78);

  if (state.scene.fog?.isFogExp2) {
    const density = THREE.MathUtils.lerp(0.0048, 0.034, deepT)
      * THREE.MathUtils.lerp(1.0, 1.24, midT)
      * (1 + storm * 0.42);
    state.scene.fog.density = THREE.MathUtils.lerp(
      state.scene.fog.density,
      density,
      submerged * 0.72,
    );
    state.scene.fog.color.lerp(state.fogColor, submerged * 0.80);
  }

  if (state.scene.background?.isColor) {
    state.scene.background.lerp(state.fogColor, submerged * 0.92);
  }

  state.horizonShell.position.set(px, cameraY, pz);
  state.horizonShell.material.color.copy(state.fogColor);
  state.horizonShell.material.opacity = submerged * THREE.MathUtils.lerp(0.72, 0.94, deepT);
  state.horizonShell.visible = true;

  // -------------------------------------------------------------------------
  // Reuse the existing world light rig so fish/coral/terrain all receive the
  // same physically coherent underwater color shift instead of a screen tint.
  // -------------------------------------------------------------------------
  state.skyColor.copy(SKY_FILL_NIGHT).lerp(SKY_FILL_DAY, daylight);
  state.groundColor.copy(GROUND_FILL_NIGHT).lerp(GROUND_FILL_DAY, daylight);

  if (worldLighting?.skyFill) {
    worldLighting.skyFill.color.copy(state.skyColor);
    worldLighting.skyFill.groundColor.copy(state.groundColor);
    worldLighting.skyFill.intensity = submerged
      * THREE.MathUtils.lerp(0.28, 0.76, daylight)
      * (1 - deepT * 0.46);
  }

  if (worldLighting?.ambient) {
    worldLighting.ambient.color.lerp(state.skyColor, submerged * 0.26);
    worldLighting.ambient.intensity *= THREE.MathUtils.lerp(1.0, 0.82, submerged * deepT);
  }

  if (worldLighting?.sun) {
    const key = worldLighting.sun;
    const transmission = THREE.MathUtils.lerp(0.88, 0.30, deepT)
      * (1 - storm * 0.28);
    key.intensity *= THREE.MathUtils.lerp(1, transmission, submerged);
    key.color.lerp(state.skyColor, submerged * (0.08 + deepT * 0.24));
  }

  // -------------------------------------------------------------------------
  // Snell-window approximation: a soft bright disc immediately below the real
  // FFT surface. Radius grows with eye depth just like the real refracted cone.
  // -------------------------------------------------------------------------
  const snellRadius = THREE.MathUtils.clamp(4.0 + depth * 1.15, 4.2, 15.0);
  state.snellWindow.position.set(px, state.waterY - 0.10, pz);
  state.snellWindow.scale.set(snellRadius, snellRadius, 1);
  state.snellWindow.material.color.copy(SNELL_NIGHT).lerp(SNELL_DAY, daylight);
  state.snellWindow.material.opacity = submerged
    * THREE.MathUtils.lerp(0.07, 0.28, daylight)
    * (1 - storm * 0.62)
    * (1 - deepT * 0.45);
  state.snellWindow.visible = state.snellWindow.material.opacity > 0.008;

  // -------------------------------------------------------------------------
  // Terrain-conforming moving caustics. The mesh is resampled only after the
  // player moves ~1.25 units, so the CPU does NOT resample the seafloor every
  // frame. UV motion itself is virtually free.
  // -------------------------------------------------------------------------
  if (state.caustics) {
    resampleCausticSurface(state.caustics, px, pz);
    const c = state.caustics;
    c.mesh.material.map.offset.set(
      (elapsed * 0.032) % 1,
      (-elapsed * 0.024) % 1,
    );
    c.mesh.material.map.rotation = Math.sin(elapsed * 0.11) * 0.10;
    c.mesh.material.color.copy(CAUSTIC_DAY).lerp(state.skyColor, storm * 0.35 + (1 - day) * 0.55);
    const causticStrength = submerged
      * daylight
      * shallowT
      * (1 - storm * 0.82);
    c.mesh.material.opacity = causticStrength * 0.24;
    c.mesh.visible = c.mesh.material.opacity > 0.008;
  }

  // -------------------------------------------------------------------------
  // Suspended particulates. Bigger than v2, but still a single Points draw call.
  // -------------------------------------------------------------------------
  if (playerPos?.isVector3) state.motes.position.copy(playerPos);
  else state.motes.position.y = cameraY;
  state.motes.position.y += Math.sin(elapsed * 0.18) * 0.18;
  state.motes.rotation.y = elapsed * 0.035;
  state.motes.rotation.x = Math.sin(elapsed * 0.11) * 0.08;
  state.moteColor.copy(MOTE_NIGHT).lerp(MOTE_DAY, daylight);
  state.motes.material.color.copy(state.moteColor);
  state.motes.material.opacity = submerged
    * THREE.MathUtils.lerp(0.15, 0.30, daylight)
    * THREE.MathUtils.lerp(1.0, 0.72, deepT);
  state.motes.visible = state.motes.material.opacity > 0.01;

  // Small nearby bubbles — one textured Points draw call, not individual sprites.
  const bubblePos = state.bubbles.points.geometry.attributes.position;
  const bubbleSeeds = state.bubbles.seeds;
  for (let i = 0; i < bubblePos.count; i++) {
    const bx = bubbleSeeds[i * 4];
    const bz = bubbleSeeds[i * 4 + 1];
    const phase = bubbleSeeds[i * 4 + 2];
    const wobble = bubbleSeeds[i * 4 + 3];
    const rise = ((elapsed * 0.16 + phase) % 1) * 5.5 - 2.7;
    bubblePos.setXYZ(
      i,
      bx + Math.sin(elapsed * 0.55 + wobble) * 0.18,
      rise,
      bz + Math.cos(elapsed * 0.43 + wobble) * 0.15,
    );
  }
  bubblePos.needsUpdate = true;
  state.bubbles.points.position.set(px, cameraY, pz);
  state.bubbleColor.copy(BUBBLE_NIGHT).lerp(BUBBLE_DAY, daylight);
  state.bubbles.points.material.color.copy(state.bubbleColor);
  state.bubbles.points.material.opacity = submerged * THREE.MathUtils.lerp(0.22, 0.42, daylight);
  state.bubbles.points.visible = state.bubbles.points.material.opacity > 0.015;

  // -------------------------------------------------------------------------
  // Surface god rays. v2 was too faint to survive the phone's small display and
  // dark water ceiling; these remain only four sprites on Low but are wider and
  // several times brighter, fading naturally with depth/storm/night.
  // -------------------------------------------------------------------------
  const shaftOpacity = submerged
    * daylight
    * (1 - storm * 0.76)
    * THREE.MathUtils.lerp(1.0, 0.58, deepT);
  const visibleLength = THREE.MathUtils.clamp(depth + 7.0, 7.0, 16.0);

  for (let i = 0; i < state.shafts.length; i++) {
    const s = state.shafts[i];
    const drift = Math.sin(elapsed * 0.14 + s.phase) * 1.15;
    s.sprite.position.set(
      px + s.ox + drift,
      state.waterY - 0.06,
      pz + s.oz - drift * 0.42,
    );
    s.sprite.scale.set(s.width * visibleLength * 0.27, visibleLength, 1);
    s.sprite.material.opacity = shaftOpacity * (0.13 + (i % 3) * 0.025);
    s.sprite.visible = s.sprite.material.opacity > 0.006;
  }
}

export function disposeUnderwaterWorld(scene, state) {
  if (!state) return;
  state.enabled = false;

  if (state.motes) {
    scene.remove(state.motes);
    state.motes.geometry?.dispose();
    state.motes.material?.dispose();
  }
  if (state.bubbles?.points) {
    scene.remove(state.bubbles.points);
    state.bubbles.points.geometry?.dispose();
    state.bubbles.points.material?.dispose();
  }
  if (state.shafts) {
    for (const s of state.shafts) s.sprite.material?.dispose();
  }
  if (state.shaftGroup) scene.remove(state.shaftGroup);
  if (state.horizonShell) {
    scene.remove(state.horizonShell);
    state.horizonShell.geometry?.dispose();
    state.horizonShell.material?.dispose();
  }
  if (state.snellWindow) {
    scene.remove(state.snellWindow);
    state.snellWindow.geometry?.dispose();
    state.snellWindow.material?.dispose();
  }
  if (state.caustics?.mesh) {
    scene.remove(state.caustics.mesh);
    state.caustics.mesh.geometry?.dispose();
    state.caustics.mesh.material?.map?.dispose();
    state.caustics.mesh.material?.dispose();
  }

  if (scene?.userData?.__riftUnderwaterWorld === state) {
    delete scene.userData.__riftUnderwaterWorld;
  }
}
