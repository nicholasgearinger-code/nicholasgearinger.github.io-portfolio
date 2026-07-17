import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { buildPlanetTerrain, TERRAIN_SIZE } from "./terrain.js";
import { LEVELS, generateLevelLayout } from "./levels.js";
import { createCrystalMesh, updateCrystalMesh, disposeCrystalMesh, CRYSTAL_RADIUS } from "./crystals.js";
import { createDecoration, updateDecoration } from "./decorations.js";
import {
  createBolt, updateBolt, disposeBolt,
  createMuzzleFlash, updateMuzzleFlash, disposeMuzzleFlash,
  createImpactBurst, updateImpactBurst, disposeImpactBurst,
} from "./effects.js";
import { initAudio, toggleMuted, playShoot, playShatter, playLoreChime } from "./audio.js";
import { getIslandLore } from "./lore.js";
import { findClosestHit } from "./hitPrediction.js";
import { createTouchControls } from "./touchControls.js";
import { createPlayerPhysicsState, updatePlayerPhysics, sampleGroundHeight, WALK_SPEED, AIR_CONTROL } from "./physics.js";

// ---------------------------------------------------------------------------
// World seed — fixed by default so every visitor explores the same curated
// levels rather than different random layouts each load.
// ---------------------------------------------------------------------------
const WORLD_SEED = "rift-islands-prime";
const PLAYER_EYE_HEIGHT = 1.6;
// Player can't walk past this radius from the terrain's center — keeps
// them off the soft falloff rim (see terrain.js) and away from the finite
// plane's actual edge, where there'd be no ground to sample at all.
const WORLD_BOUND_RADIUS = TERRAIN_SIZE / 2 * 0.93;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const canvas = document.getElementById("rift-scene");
const startOverlay = document.getElementById("rift-start-overlay");
const levelSelectEl = document.getElementById("rift-level-select");
const seedValueEl = document.getElementById("rift-seed-value");
const levelNameEl = document.getElementById("rift-level-name");
const resonanceValueEl = document.getElementById("rift-resonance-value");
const resonanceDot = document.getElementById("rift-resonance-dot");
const loreTicker = document.getElementById("rift-lore-ticker");
const discoveryLogEl = document.getElementById("rift-discovery-log");
const menuBtn = document.getElementById("rift-menu-btn");

// ---------------------------------------------------------------------------
// Input mode detection
// ---------------------------------------------------------------------------
const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
if (isTouchDevice) document.body.classList.add("rift-touch-mode");
let touchGameActive = false;

function isGameActive() {
  return isTouchDevice ? touchGameActive : controls.isLocked;
}

// ---------------------------------------------------------------------------
// Three.js scene — sized off #rift-viewport, see earlier notes in this file
// history; unchanged from the island-chain version.
// ---------------------------------------------------------------------------
const viewport = document.getElementById("rift-viewport");
const fullscreenBtn = document.getElementById("rift-fullscreen-btn");

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0e14, 0.0032);

const camera = new THREE.PerspectiveCamera(70, viewport.clientWidth / viewport.clientHeight, 0.1, 2000);
camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

function resizeToViewport() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (w === 0 || h === 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
new ResizeObserver(resizeToViewport).observe(viewport);

if (fullscreenBtn) {
  fullscreenBtn.addEventListener("click", () => {
    viewport.classList.toggle("rift-fullscreen");
    fullscreenBtn.classList.toggle("gfs-active", viewport.classList.contains("rift-fullscreen"));
    resizeToViewport();
  });
}
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && viewport.classList.contains("rift-fullscreen")) {
    viewport.classList.remove("rift-fullscreen");
    fullscreenBtn?.classList.remove("gfs-active");
    resizeToViewport();
  }
});

scene.add(new THREE.AmbientLight(0x8899bb, 0.65));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(60, 100, 40);
scene.add(sun);

{
  const starGeo = new THREE.BufferGeometry();
  const starCount = 1500;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 1200;
    positions[i * 3 + 1] = 80 + Math.random() * 500; // kept above the terrain, no reason for stars underfoot
    positions[i * 3 + 2] = (Math.random() - 0.5) * 1200;
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, sizeAttenuation: true });
  scene.add(new THREE.Points(starGeo, starMat));
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
const controls = new PointerLockControls(camera, document.body);

function showLevelSelect() {
  startOverlay.style.display = "flex";
  levelSelectEl.hidden = false;
  touchGameActive = false;
}
controls.addEventListener("unlock", showLevelSelect);

if (menuBtn) {
  menuBtn.addEventListener("click", () => {
    if (!isTouchDevice) controls.unlock();
    showLevelSelect();
  });
}

const keys = { forward: false, back: false, left: false, right: false };
let jumpQueued = false;
const MOVE_KEYS = new Set(["KeyW", "KeyS", "KeyA", "KeyD", "Space"]);

window.addEventListener("keydown", (e) => {
  if (isGameActive() && MOVE_KEYS.has(e.code)) e.preventDefault();
  if (e.code === "Space" && !e.repeat) jumpQueued = true;
  setKey(e.code, true);
});
window.addEventListener("keyup", (e) => setKey(e.code, false));

function setKey(code, value) {
  switch (code) {
    case "KeyW": keys.forward = value; break;
    case "KeyS": keys.back = value; break;
    case "KeyA": keys.left = value; break;
    case "KeyD": keys.right = value; break;
  }
}

const velocity = new THREE.Vector3();

function updateMovement(dt, grounded) {
  velocity.set(0, 0, 0);
  if (keys.forward) velocity.z -= 1;
  if (keys.back) velocity.z += 1;
  if (keys.left) velocity.x -= 1;
  if (keys.right) velocity.x += 1;
  if (velocity.lengthSq() > 0) velocity.normalize();

  const speed = WALK_SPEED * (grounded ? 1 : AIR_CONTROL);
  controls.moveRight(velocity.x * speed * dt);
  controls.moveForward(-velocity.z * speed * dt);

  // Soft world bounds — keeps the player off the terrain's falloff rim and
  // away from the finite plane's actual edge (see terrain.js/WORLD_BOUND_RADIUS
  // above), rather than needing to fall off into empty space to find out
  // there's a limit.
  const distFromCenter = Math.hypot(camera.position.x, camera.position.z);
  if (distFromCenter > WORLD_BOUND_RADIUS) {
    const scale = WORLD_BOUND_RADIUS / distFromCenter;
    camera.position.x *= scale;
    camera.position.z *= scale;
  }
}

// ---------------------------------------------------------------------------
// Level building — one continuous terrain per biome. Tearing down the
// previous level's terrain/decorations/crystals on every switch (including
// re-entering the same level, which always regenerates fresh) keeps this
// simple instead of diffing old vs new state.
// ---------------------------------------------------------------------------
let terrainMesh = null;
const crystalHandles = new Map();
let allCrystals = [];
let crystalsTotal = 0;
let crystalsCollected = 0;
const decorationHandles = [];
let loreMarkers = []; // {id, x, z, y, shown}
let currentLevelIdx = -1;
let spawnPosition = { x: 0, y: 5, z: 0 };
const playerPhysics = createPlayerPhysicsState();

function teardownLevel() {
  if (terrainMesh) {
    scene.remove(terrainMesh);
    terrainMesh.geometry.dispose();
    terrainMesh.material.dispose();
    terrainMesh = null;
  }
  for (const [, handle] of crystalHandles) disposeCrystalMesh(scene, handle);
  crystalHandles.clear();
  allCrystals = [];
  for (const handle of decorationHandles) {
    scene.remove(handle.group);
    handle.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  }
  decorationHandles.length = 0;
  loreMarkers = [];
}

function buildLevel(levelIdx) {
  teardownLevel();
  currentLevelIdx = levelIdx;
  const level = LEVELS[levelIdx];

  terrainMesh = new THREE.Mesh(
    buildPlanetTerrain(level, WORLD_SEED),
    new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0.05,
      emissive: level.color, emissiveIntensity: 0.04,
    })
  );
  scene.add(terrainMesh);

  const layout = generateLevelLayout(level.biome, WORLD_SEED);

  seedValueEl.textContent = WORLD_SEED;
  levelNameEl.textContent = level.name;

  layout.crystalSeeds.forEach((seed) => {
    const groundY = sampleGroundHeight(seed.x, seed.z, terrainMesh) ?? 0;
    const crystal = { id: seed.id, position: { x: seed.x, y: groundY + 1.1, z: seed.z }, color: level.color };
    allCrystals.push(crystal);
    crystalHandles.set(crystal.id, createCrystalMesh(scene, crystal));
  });

  layout.decorationSeeds.forEach((seed) => {
    const groundY = sampleGroundHeight(seed.x, seed.z, terrainMesh) ?? 0;
    const handle = createDecoration(level.biome, level.color, seed.rand);
    handle.group.position.set(seed.x, groundY, seed.z);
    handle.group.rotation.y = seed.rand() * Math.PI * 2;
    handle.baseY = groundY;
    scene.add(handle.group);
    decorationHandles.push(handle);
  });

  loreMarkers = layout.loreMarkers.map((m) => ({
    ...m, y: sampleGroundHeight(m.x, m.z, terrainMesh) ?? 0, shown: false,
  }));

  crystalsTotal = allCrystals.length;
  crystalsCollected = 0;
  updateResonanceUI();

  const spawnGroundY = sampleGroundHeight(layout.spawn.x, layout.spawn.z, terrainMesh) ?? 0;
  spawnPosition = { x: layout.spawn.x, y: spawnGroundY + PLAYER_EYE_HEIGHT + 2, z: layout.spawn.z };
  camera.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
  playerPhysics.verticalVelocity = 0;
  playerPhysics.grounded = false;
}

function respawnInLevel() {
  camera.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
  playerPhysics.verticalVelocity = 0;
  playerPhysics.grounded = false;
  logDiscovery("Fell — back to the start.");
}

// ---------------------------------------------------------------------------
// Level select UI
// ---------------------------------------------------------------------------
function enterLevel(levelIdx) {
  buildLevel(levelIdx);
  initAudio();
  if (isTouchDevice) {
    touchGameActive = true;
    startOverlay.style.display = "none";
  } else {
    controls.lock();
  }
}

function buildLevelSelectButtons() {
  if (!levelSelectEl) return;
  levelSelectEl.innerHTML = "";
  LEVELS.forEach((level, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rift-level-btn";
    btn.innerHTML = `<strong>${level.name}</strong><span>${level.tagline}</span>`;
    btn.addEventListener("click", () => enterLevel(idx));
    levelSelectEl.appendChild(btn);
  });
}
buildLevelSelectButtons();

// ---------------------------------------------------------------------------
// Resonance Crystals
// ---------------------------------------------------------------------------
let worldPulseElapsed = null;
const WORLD_PULSE_DURATION = 4;

function updateResonanceUI() {
  resonanceValueEl.textContent = `${crystalsCollected} / ${crystalsTotal}`;
  resonanceDot.classList.toggle("complete", crystalsTotal > 0 && crystalsCollected >= crystalsTotal);
}

function shatterCrystal(id) {
  const handle = crystalHandles.get(id);
  if (!handle) return;
  const crystal = allCrystals.find((c) => c.id === id);

  disposeCrystalMesh(scene, handle);
  crystalHandles.delete(id);
  allCrystals = allCrystals.filter((c) => c.id !== id);
  crystalsCollected++;
  updateResonanceUI();

  if (crystal) {
    spawnImpact(crystal.position, crystal.color, { count: 14, speedMin: 2.5, speedMax: 5, particleSize: 0.09, duration: 0.5 });
  }
  playShatter();
  logDiscovery(`Resonance Crystal shattered — ${crystalsCollected} / ${crystalsTotal}`);

  if (crystalsCollected >= crystalsTotal && crystalsTotal > 0) {
    worldPulseElapsed = 0;
    logDiscovery("Every crystal on this landmass has been shattered.");
    setTimeout(() => playShatter(), 150);
  }
}

function updateWorldPulse(dt) {
  if (worldPulseElapsed === null || !terrainMesh) return;
  worldPulseElapsed += dt;
  const t = Math.min(1, worldPulseElapsed / WORLD_PULSE_DURATION);
  terrainMesh.material.emissiveIntensity = 0.04 + Math.sin(t * Math.PI) * 0.55;
  if (worldPulseElapsed >= WORLD_PULSE_DURATION) worldPulseElapsed = null;
}

function logDiscovery(text) {
  if (!discoveryLogEl) return;
  const line = document.createElement("div");
  line.textContent = text;
  discoveryLogEl.prepend(line);
  setTimeout(() => line.remove(), 5000);
  while (discoveryLogEl.children.length > 5) discoveryLogEl.removeChild(discoveryLogEl.lastChild);
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------
const MAX_SHOT_RANGE = 400;
const PROJECTILE_SPEED = 140;
const PROJECTILE_LIFETIME = 2.5;
const bolts = [];
const muzzleFlashes = [];
const impactBursts = [];

function spawnProjectile(origin, direction, colorHex = 0x4fd1c5) {
  bolts.push(createBolt(scene, origin, direction, colorHex, PROJECTILE_SPEED));
}
function spawnImpact(position, colorHex = 0xff6b4a, options = {}) {
  impactBursts.push(createImpactBurst(scene, position, colorHex, options));
}

function updateProjectiles(dt) {
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i]; updateBolt(b, dt);
    if (b.life > PROJECTILE_LIFETIME) { disposeBolt(scene, b); bolts.splice(i, 1); }
  }
  for (let i = muzzleFlashes.length - 1; i >= 0; i--) {
    const f = muzzleFlashes[i]; updateMuzzleFlash(f, dt);
    if (f.life > f.duration) { disposeMuzzleFlash(scene, f); muzzleFlashes.splice(i, 1); }
  }
  for (let i = impactBursts.length - 1; i >= 0; i--) {
    const b = impactBursts[i]; updateImpactBurst(b, dt);
    if (b.life > b.duration) { disposeImpactBurst(scene, b); impactBursts.splice(i, 1); }
  }
}

function fireShot() {
  if (!isGameActive()) return;
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  const dir = { x: direction.x, y: direction.y, z: direction.z };
  const origin = { x: camera.position.x, y: camera.position.y, z: camera.position.z };

  const muzzleOffset = direction.clone().multiplyScalar(0.8);
  const muzzlePos = camera.position.clone().add(muzzleOffset);
  muzzlePos.y -= 0.15;
  muzzleFlashes.push(createMuzzleFlash(scene, muzzlePos, 0xe8ecf1));

  spawnProjectile(origin, dir, 0xe8ecf1);
  playShoot();

  const hit = findClosestHit(origin, dir, allCrystals, CRYSTAL_RADIUS, MAX_SHOT_RANGE);
  if (hit) {
    const travelMs = (hit.distance / PROJECTILE_SPEED) * 1000;
    setTimeout(() => shatterCrystal(hit.id), Math.max(0, travelMs));
  }
}

document.addEventListener("mousedown", (e) => {
  if (e.button === 0 && controls.isLocked) fireShot();
});

createTouchControls({
  camera, keys, onFire: fireShot, viewport, isActive: isGameActive,
  onJump: () => { jumpQueued = true; },
});

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyM") {
    const isMuted = toggleMuted();
    logDiscovery(isMuted ? "Sound muted" : "Sound on");
  }
});

// ---------------------------------------------------------------------------
// Lore proximity trigger — a handful of fixed points scattered across the
// landmass now, rather than one trigger per island.
// ---------------------------------------------------------------------------
let loreTickerTimeout = null;
const LORE_TRIGGER_RADIUS = 14;

function checkLoreProximity() {
  for (const marker of loreMarkers) {
    const dx = camera.position.x - marker.x, dz = camera.position.z - marker.z;
    const dist = Math.hypot(dx, dz);
    if (dist < LORE_TRIGGER_RADIUS && !marker.shown) {
      marker.shown = true;
      showLore(getIslandLore({ id: marker.id, biome: LEVELS[currentLevelIdx].biome }));
    } else if (dist > LORE_TRIGGER_RADIUS * 1.6 && marker.shown) {
      marker.shown = false;
    }
  }
}

function showLore(text) {
  if (!text) return;
  loreTicker.textContent = text;
  loreTicker.classList.add("visible");
  clearTimeout(loreTickerTimeout);
  loreTickerTimeout = setTimeout(() => loreTicker.classList.remove("visible"), 6000);
  playLoreChime();
}

// ---------------------------------------------------------------------------
// Boot — show the level-select screen. No level is built until the player
// actually picks one.
// ---------------------------------------------------------------------------
showLevelSelect();

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let elapsedTime = 0;
const FALL_RESPAWN_OFFSET = 80; // generous — the world-bounds clamp above should make this a rare last-resort safety net, not the primary way players learn there's an edge

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  elapsedTime += dt;

  if (isGameActive() && currentLevelIdx >= 0) {
    updateMovement(dt, playerPhysics.grounded);
    updatePlayerPhysics(camera, terrainMesh, playerPhysics, dt, PLAYER_EYE_HEIGHT, jumpQueued);
    jumpQueued = false;
    if (camera.position.y < spawnPosition.y - FALL_RESPAWN_OFFSET) respawnInLevel();
    checkLoreProximity();
  }

  for (const [, handle] of crystalHandles) updateCrystalMesh(handle, elapsedTime);
  for (const handle of decorationHandles) updateDecoration(handle, elapsedTime);
  updateWorldPulse(dt);
  updateProjectiles(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
