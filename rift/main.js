import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { buildIslandGeometry } from "./terrain.js";
import { generateWorld } from "./worldgen.js";
import { generateCrystalsForIsland, createCrystalMesh, updateCrystalMesh, disposeCrystalMesh, CRYSTAL_RADIUS } from "./crystals.js";
import {
  createBolt, updateBolt, disposeBolt,
  createMuzzleFlash, updateMuzzleFlash, disposeMuzzleFlash,
  createImpactBurst, updateImpactBurst, disposeImpactBurst,
} from "./effects.js";
import { initAudio, toggleMuted, playShoot, playShatter, playLoreChime } from "./audio.js";
import { getIslandLore } from "./lore.js";
import { findClosestHit } from "./hitPrediction.js";
import { createTouchControls } from "./touchControls.js";

// ---------------------------------------------------------------------------
// World seed — fixed by default so every visitor explores the same curated
// layout (and the same deterministic crystal placements) rather than a
// different random world each load. Change WORLD_SEED to grow a different
// world; nothing else needs to change since generation is a pure function
// of this string.
// ---------------------------------------------------------------------------
const WORLD_SEED = "rift-islands-prime";

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const canvas = document.getElementById("rift-scene");
const startOverlay = document.getElementById("rift-start-overlay");
const startButton = document.getElementById("rift-start-button");
const seedValueEl = document.getElementById("rift-seed-value");
const resonanceValueEl = document.getElementById("rift-resonance-value");
const resonanceDot = document.getElementById("rift-resonance-dot");
const loreTicker = document.getElementById("rift-lore-ticker");
const discoveryLogEl = document.getElementById("rift-discovery-log");

// ---------------------------------------------------------------------------
// Input mode detection — desktop (Pointer Lock + keyboard/mouse) vs. touch
// (virtual joystick + drag-look + tap-fire, see touchControls.js). Pointer
// Lock isn't supported on iOS Safari at all and is unreliable on mobile
// Chrome, so touch devices get a completely separate control scheme rather
// than a degraded version of the desktop one.
// ---------------------------------------------------------------------------
const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
if (isTouchDevice) document.body.classList.add("rift-touch-mode");
let touchGameActive = false; // set true once a touch player taps "ENTER THE RIFT"

function isGameActive() {
  return isTouchDevice ? touchGameActive : controls.isLocked;
}

// ---------------------------------------------------------------------------
// Three.js scene
//
// Sized off #rift-viewport rather than window.innerWidth/innerHeight — this
// used to be a standalone full-page app, but now lives inside a bounded
// section of the portfolio page (full window size only when the fullscreen
// toggle below is active, which is exactly when the viewport element itself
// expands to cover the window).
// ---------------------------------------------------------------------------
const viewport = document.getElementById("rift-viewport");
const fullscreenBtn = document.getElementById("rift-fullscreen-btn");

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0e14, 0.0035);

const camera = new THREE.PerspectiveCamera(
  70,
  viewport.clientWidth / viewport.clientHeight,
  0.1,
  2000
);
camera.position.set(0, 5, 40);
// YXZ order keeps rotation.y a clean, pitch-independent yaw value no matter
// how the camera's orientation is driven (PointerLockControls' internal
// quaternion math on desktop, or direct rotation.x/y assignment for touch
// look-drag).
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
// Covers both real window resizes and the viewport element's own size
// changing (e.g. the fullscreen toggle below) — a plain window "resize"
// listener alone would miss the latter.
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

// Lighting
scene.add(new THREE.AmbientLight(0x8899bb, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(60, 100, 40);
scene.add(sun);

// Starfield
{
  const starGeo = new THREE.BufferGeometry();
  const starCount = 1500;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 1200;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 1200;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 1200;
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, sizeAttenuation: true });
  scene.add(new THREE.Points(starGeo, starMat));
}

// ---------------------------------------------------------------------------
// Flight controls (pointer lock + WASD + space/shift)
// ---------------------------------------------------------------------------
const controls = new PointerLockControls(camera, document.body);

startButton.addEventListener("click", () => {
  initAudio();
  if (isTouchDevice) {
    touchGameActive = true;
    startOverlay.style.display = "none";
  } else {
    controls.lock();
  }
});
controls.addEventListener("lock", () => (startOverlay.style.display = "none"));
controls.addEventListener("unlock", () => (startOverlay.style.display = "flex"));

const keys = { forward: false, back: false, left: false, right: false, up: false, down: false };
window.addEventListener("keydown", (e) => setKey(e.code, true));
window.addEventListener("keyup", (e) => setKey(e.code, false));

function setKey(code, value) {
  switch (code) {
    case "KeyW": keys.forward = value; break;
    case "KeyS": keys.back = value; break;
    case "KeyA": keys.left = value; break;
    case "KeyD": keys.right = value; break;
    case "Space": keys.up = value; break;
    case "ShiftLeft":
    case "ShiftRight": keys.down = value; break;
  }
}

const FLIGHT_SPEED = 22; // units per second
const velocity = new THREE.Vector3();

function updateMovement(dt) {
  velocity.set(0, 0, 0);
  if (keys.forward) velocity.z -= 1;
  if (keys.back) velocity.z += 1;
  if (keys.left) velocity.x -= 1;
  if (keys.right) velocity.x += 1;
  if (velocity.lengthSq() > 0) velocity.normalize();

  controls.moveRight(velocity.x * FLIGHT_SPEED * dt);
  controls.moveForward(-velocity.z * FLIGHT_SPEED * dt);

  if (keys.up) camera.position.y += FLIGHT_SPEED * dt;
  if (keys.down) camera.position.y -= FLIGHT_SPEED * dt;
}

// ---------------------------------------------------------------------------
// Collision (cosmetic — just stops the camera from clipping through what it
// sees; there's no server here at all now, so this is simply the whole
// story rather than a client-side echo of server-side physics.
// Each island is an ellipsoid: radius on X/Z, height/1.6 on Y — matching the
// squash applied to the geometry in buildWorld().)
// ---------------------------------------------------------------------------
const PLAYER_RADIUS = 1.2;
// Terrain displacement (terrain.js: ROUGHNESS) can push the surface up to
// ~32% beyond the base ellipsoid — pad collision bounds to match so players
// don't clip into jagged outcroppings.
const TERRAIN_BULGE = 1.32;

function pushOutOfIslands(pos) {
  let result = { x: pos.x, y: pos.y, z: pos.z };
  for (const [, entry] of islandMeshes) {
    const island = entry.data;
    const rx = island.radius * TERRAIN_BULGE + PLAYER_RADIUS;
    const rz = island.radius * TERRAIN_BULGE + PLAYER_RADIUS;
    const ry = (island.height / 1.6) * TERRAIN_BULGE + PLAYER_RADIUS;

    const dx = result.x - island.position.x;
    const dy = result.y - island.position.y;
    const dz = result.z - island.position.z;

    const nx = dx / rx;
    const ny = dy / ry;
    const nz = dz / rz;
    const normDistSq = nx * nx + ny * ny + nz * nz;

    if (normDistSq < 1 && normDistSq > 1e-6) {
      const normDist = Math.sqrt(normDistSq);
      const pushScale = 1 / normDist;
      result = {
        x: island.position.x + nx * pushScale * rx,
        y: island.position.y + ny * pushScale * ry,
        z: island.position.z + nz * pushScale * rz,
      };
    }
  }
  return result;
}

function resolveIslandCollisions() {
  const pushed = pushOutOfIslands({ x: camera.position.x, y: camera.position.y, z: camera.position.z });
  camera.position.set(pushed.x, pushed.y, pushed.z);
}

// ---------------------------------------------------------------------------
// World building — generated locally now (see worldgen.js) instead of
// received from a server, since there's no other player to keep in sync
// with. Also spawns each island's Resonance Crystals.
// ---------------------------------------------------------------------------
const islandMeshes = new Map(); // islandId -> { mesh, data }
const crystalHandles = new Map(); // crystalId -> mesh handle (from crystals.js)
let allCrystals = []; // flat list of { id, islandId, position, color } — still-uncollected only
let crystalsTotal = 0;
let crystalsCollected = 0;

function buildWorld(world) {
  seedValueEl.textContent = world.seed;

  world.islands.forEach((island) => {
    const geo = buildIslandGeometry(island);

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.85,
      metalness: 0.05,
      emissive: island.color,
      emissiveIntensity: 0.05,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(island.position.x, island.position.y, island.position.z);
    scene.add(mesh);

    // Soft glow ring beneath each island
    const ringGeo = new THREE.RingGeometry(island.radius * 0.9, island.radius * 1.4, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: island.color,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(island.position.x, island.position.y - island.height * 0.5, island.position.z);
    scene.add(ring);

    islandMeshes.set(island.id, { mesh, data: island, loreShown: false });

    generateCrystalsForIsland(island).forEach((crystal) => {
      allCrystals.push(crystal);
      crystalHandles.set(crystal.id, createCrystalMesh(scene, crystal));
    });
  });

  crystalsTotal = allCrystals.length;
  updateResonanceUI();
}

// ---------------------------------------------------------------------------
// Resonance Crystals — the repurposed target for what used to be
// player-vs-player combat. Shooting one shatters it: an impact burst in the
// crystal's own color, a chime, a log line, and a tick toward the world
// total. Once every crystal in the world is gone, the islands themselves
// pulse brighter for a few seconds as a completion beat.
// ---------------------------------------------------------------------------
let worldPulseElapsed = null; // null when inactive, else seconds since triggered
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
    logDiscovery("Every crystal in the Rift has been shattered.");
    setTimeout(() => playShatter(), 150);
  }
}

function updateWorldPulse(dt) {
  if (worldPulseElapsed === null) return;
  worldPulseElapsed += dt;
  const t = Math.min(1, worldPulseElapsed / WORLD_PULSE_DURATION);
  const intensity = 0.05 + Math.sin(t * Math.PI) * 0.7; // rises then falls back to baseline
  for (const [, entry] of islandMeshes) {
    entry.mesh.material.emissiveIntensity = intensity;
  }
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
// Shooting — resolves instantly and locally against Resonance Crystals.
// There's no server here, so unlike the old multiplayer version, this hit
// test IS the authoritative result the moment it runs.
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
    const b = bolts[i];
    updateBolt(b, dt);
    if (b.life > PROJECTILE_LIFETIME) {
      disposeBolt(scene, b);
      bolts.splice(i, 1);
    }
  }

  for (let i = muzzleFlashes.length - 1; i >= 0; i--) {
    const f = muzzleFlashes[i];
    updateMuzzleFlash(f, dt);
    if (f.life > f.duration) {
      disposeMuzzleFlash(scene, f);
      muzzleFlashes.splice(i, 1);
    }
  }

  for (let i = impactBursts.length - 1; i >= 0; i--) {
    const b = impactBursts[i];
    updateImpactBurst(b, dt);
    if (b.life > b.duration) {
      disposeImpactBurst(scene, b);
      impactBursts.splice(i, 1);
    }
  }
}

function fireShot() {
  if (!isGameActive()) return;
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  const dir = { x: direction.x, y: direction.y, z: direction.z };
  const origin = { x: camera.position.x, y: camera.position.y, z: camera.position.z };

  // Muzzle flash offset slightly forward and down from the camera, roughly
  // where a held weapon would be.
  const muzzleOffset = direction.clone().multiplyScalar(0.8);
  const muzzlePos = camera.position.clone().add(muzzleOffset);
  muzzlePos.y -= 0.15;
  muzzleFlashes.push(createMuzzleFlash(scene, muzzlePos, 0xe8ecf1));

  spawnProjectile(origin, dir, 0xe8ecf1);
  playShoot();

  const hit = findClosestHit(origin, dir, allCrystals, CRYSTAL_RADIUS, MAX_SHOT_RANGE);
  if (hit) {
    // Timed to land the moment the visible bolt actually reaches the
    // crystal, same as the old prediction system did for player hits —
    // just no longer needing a fallback path for a server disagreeing.
    const travelMs = (hit.distance / PROJECTILE_SPEED) * 1000;
    setTimeout(() => shatterCrystal(hit.id), Math.max(0, travelMs));
  }
}

document.addEventListener("mousedown", (e) => {
  if (e.button === 0 && controls.isLocked) fireShot();
});

createTouchControls({ camera, keys, onFire: fireShot });

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyM") {
    const isMuted = toggleMuted();
    logDiscovery(isMuted ? "Sound muted" : "Sound on");
  }
});

// ---------------------------------------------------------------------------
// Lore proximity trigger — reads from the static local pool (lore.js)
// instead of an API call, so this is fully synchronous now.
// ---------------------------------------------------------------------------
let loreTickerTimeout = null;

function checkIslandProximity() {
  for (const [id, entry] of islandMeshes) {
    const dist = camera.position.distanceTo(entry.mesh.position);
    const triggerRadius = entry.data.radius * 2.2;

    if (dist < triggerRadius && !entry.loreShown) {
      entry.loreShown = true;
      showLore(getIslandLore(entry.data));
    } else if (dist > triggerRadius * 1.5 && entry.loreShown) {
      entry.loreShown = false; // allow re-trigger on a later pass
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
// Boot — generate the world locally and start immediately. Runs directly on
// the page now (not iframe-embedded), so no loading-overlay handshake is
// needed here.
// ---------------------------------------------------------------------------
buildWorld(generateWorld(WORLD_SEED));

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let elapsedTime = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  elapsedTime += dt;

  if (isGameActive()) {
    updateMovement(dt);
    resolveIslandCollisions();
    checkIslandProximity();
  }

  for (const [, handle] of crystalHandles) updateCrystalMesh(handle, elapsedTime);
  updateWorldPulse(dt);
  updateProjectiles(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
