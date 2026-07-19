import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { buildPlanetTerrain, terrainHeightAt, TERRAIN_SIZE, LIQUID_LEVEL } from "./terrain.js";
import { LEVELS, generateLevelLayout } from "./levels.js";
import { createCrystalMesh, updateCrystalMesh, disposeCrystalMesh, CRYSTAL_RADIUS } from "./crystals.js";
import { createDecoration, updateDecoration } from "./decorations.js";
import { createLiquidPlane, updateLiquidPlane, disposeLiquidPlane } from "./liquid.js";
import { createDayNightCycle, updateDayNightCycle } from "./dayNightCycle.js";
import { createAtmosphericParticles, updateAtmosphericParticles, disposeAtmosphericParticles } from "./atmosphericParticles.js";
import { createGrass, updateGrass, disposeGrass, createFlowers, disposeFlowers } from "./vegetation.js";
import { createHorizonSilhouettes, disposeHorizonSilhouettes } from "./horizonSilhouettes.js";
import { createWildlife, updateWildlife, disposeWildlife } from "./wildlife.js";
import { createLandmark, updateLandmark, disposeLandmark } from "./landmarks.js";
import { getGraphicsSettings, getGraphicsTier, setGraphicsTier, listGraphicsTiers } from "./graphicsSettings.js";
import { createWeatherSystem, updateWeatherSystem, disposeWeatherSystem } from "./weather.js";
import { createClouds, updateClouds, disposeClouds } from "./clouds.js";
import {
  createBolt, updateBolt, disposeBolt,
  createMuzzleFlash, updateMuzzleFlash, disposeMuzzleFlash,
  createImpactBurst, updateImpactBurst, disposeImpactBurst,
} from "./effects.js";
import { initAudio, toggleMuted, playShoot, playShatter, playLoreChime, startAmbient, playFootstep } from "./audio.js";
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
const graphicsBtn = document.getElementById("rift-graphics-btn");
const graphicsPanel = document.getElementById("rift-graphics-panel");
const arrivalOverlay = document.getElementById("rift-arrival");
const arrivalNameEl = document.getElementById("rift-arrival-name");

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0e14, 0.0032);

const camera = new THREE.PerspectiveCamera(70, viewport.clientWidth / viewport.clientHeight, 0.1, 2000);
camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, getGraphicsSettings().pixelRatioCap));
renderer.shadowMap.enabled = getGraphicsSettings().shadowsEnabled;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

function resizeToViewport() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (w === 0 || h === 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
new ResizeObserver(resizeToViewport).observe(viewport);

// #rift-viewport's ancestor `.panel` uses a `transform` for its scroll-reveal
// animation — and CSS position:fixed resolves relative to the nearest
// transformed ancestor, not the real browser viewport, if one exists in the
// chain. Left alone, "fullscreen" would size itself against the .panel's
// own box instead of the screen (the canvas still fills 100% of whatever
// box it's given so it can look fine at a glance, but small
// absolutely-positioned UI like the menu/fullscreen buttons end up
// positioned against the wrong box entirely and can land off-screen).
// Reparenting to <body> while fullscreen sidesteps the whole problem —
// same fix already proven for Ghostwire's identical bug.
const viewportHome = { parent: viewport.parentNode, nextSibling: viewport.nextSibling };
let lockedScrollY = 0;

function enterFullscreen() {
  lockedScrollY = window.scrollY;
  document.body.appendChild(viewport);
  document.documentElement.style.overflow = "hidden";
  document.body.style.position = "fixed";
  document.body.style.top = `-${lockedScrollY}px`;
  document.body.style.left = "0";
  document.body.style.width = "100%";
  document.body.style.height = "100%";
  document.body.style.overflow = "hidden";
  viewport.classList.add("rift-fullscreen");
  fullscreenBtn?.classList.add("gfs-active");
  resizeToViewport();
}

function exitFullscreen() {
  viewport.classList.remove("rift-fullscreen");
  fullscreenBtn?.classList.remove("gfs-active");
  if (viewportHome.nextSibling) {
    viewportHome.parent.insertBefore(viewport, viewportHome.nextSibling);
  } else {
    viewportHome.parent.appendChild(viewport);
  }
  document.documentElement.style.overflow = "";
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.width = "";
  document.body.style.height = "";
  document.body.style.overflow = "";
  window.scrollTo(0, lockedScrollY);
  resizeToViewport();
}

if (fullscreenBtn) {
  fullscreenBtn.addEventListener("click", () => {
    if (viewport.classList.contains("rift-fullscreen")) exitFullscreen();
    else enterFullscreen();
  });
}
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && viewport.classList.contains("rift-fullscreen")) exitFullscreen();
});

const ambientLight = new THREE.AmbientLight(0x8899bb, 0.65);
scene.add(ambientLight);
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(60, 100, 40);
sun.castShadow = true;
// Shadow frustum sized to the terrain's own extent (see terrain.js's
// TERRAIN_SIZE) rather than Three.js's small default — otherwise most of
// the level would fall outside the shadow camera entirely. Resolution
// kept moderate; this is a single directional light so the cost is one
// shadow pass regardless, but a bigger map is still real GPU/memory cost
// on lower-end devices.
const SHADOW_EXTENT = 140;
sun.shadow.camera.left = -SHADOW_EXTENT;
sun.shadow.camera.right = SHADOW_EXTENT;
sun.shadow.camera.top = SHADOW_EXTENT;
sun.shadow.camera.bottom = -SHADOW_EXTENT;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 500;
sun.shadow.mapSize.set(getGraphicsSettings().shadowMapSize, getGraphicsSettings().shadowMapSize);
sun.shadow.bias = -0.0015;
scene.add(sun);

let starfieldPoints = null;
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
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, sizeAttenuation: true, transparent: true, opacity: 1 });
  starfieldPoints = new THREE.Points(starGeo, starMat);
  scene.add(starfieldPoints);
}

const dayNightCycle = createDayNightCycle(scene, sun, ambientLight, starfieldPoints);

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
let footstepDistance = 0;
const FOOTSTEP_STRIDE = 2.4; // world units between footstep sounds — tied to distance actually covered, not a fixed timer, so sprinting/slow movement both sound right

function updateMovement(dt, grounded) {
  velocity.set(0, 0, 0);
  if (keys.forward) velocity.z -= 1;
  if (keys.back) velocity.z += 1;
  if (keys.left) velocity.x -= 1;
  if (keys.right) velocity.x += 1;
  const moving = velocity.lengthSq() > 0;
  if (moving) velocity.normalize();

  const speed = WALK_SPEED * (grounded ? 1 : AIR_CONTROL);
  controls.moveRight(velocity.x * speed * dt);
  controls.moveForward(-velocity.z * speed * dt);

  if (moving && grounded) {
    footstepDistance += speed * dt;
    if (footstepDistance >= FOOTSTEP_STRIDE) {
      footstepDistance = 0;
      playFootstep(currentLevelIdx >= 0 ? LEVELS[currentLevelIdx].biome : "ember");
    }
  } else {
    footstepDistance = 0; // reset mid-stride rather than carrying a partial step into the next movement burst
  }

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
let liquidHandle = null;
let atmosphereHandle = null;
let grassHandle = null;
let flowersHandle = null;
let weatherHandle = null;
let cloudsHandle = null;
let horizonHandle = null;
let wildlifeHandle = null;
let landmarkHandle = null;
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
  disposeLiquidPlane(scene, liquidHandle);
  liquidHandle = null;
  disposeAtmosphericParticles(scene, atmosphereHandle);
  atmosphereHandle = null;
  disposeGrass(scene, grassHandle);
  grassHandle = null;
  disposeFlowers(scene, flowersHandle);
  flowersHandle = null;
  disposeWeatherSystem(scene, weatherHandle);
  weatherHandle = null;
  disposeClouds(scene, cloudsHandle);
  cloudsHandle = null;
  disposeHorizonSilhouettes(scene, horizonHandle);
  horizonHandle = null;
  disposeWildlife(scene, wildlifeHandle);
  wildlifeHandle = null;
  disposeLandmark(scene, landmarkHandle);
  landmarkHandle = null;
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
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true; // the terrain's own elevation (spires, ridges) can shadow other parts of itself
  scene.add(terrainMesh);

  if (LIQUID_LEVEL[level.biome] !== undefined) {
    liquidHandle = createLiquidPlane(scene, level.biome, LIQUID_LEVEL[level.biome], TERRAIN_SIZE);
  }

  atmosphereHandle = createAtmosphericParticles(scene, level.biome);
  grassHandle = createGrass(scene, level.biome, (x, z) => terrainHeightAt(level, x, z, WORLD_SEED), TERRAIN_SIZE * 0.46);
  flowersHandle = createFlowers(scene, level.biome, (x, z) => terrainHeightAt(level, x, z, WORLD_SEED), TERRAIN_SIZE * 0.46);
  weatherHandle = createWeatherSystem(scene, level.biome);
  cloudsHandle = createClouds(scene, level.biome);
  horizonHandle = createHorizonSilhouettes(scene, level.biome);
  wildlifeHandle = createWildlife(scene, level.biome);
  landmarkHandle = createLandmark(scene, level.biome, level.color, (x, z) => terrainHeightAt(level, x, z, WORLD_SEED));

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
    handle.group.traverse((obj) => {
      if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
    });
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
// ---------------------------------------------------------------------------
// Graphics settings — applying a tier change updates the renderer/shadow
// state immediately, then rebuilds the current level (if one is active) so
// tier-dependent counts baked in at build time (terrain resolution, grass,
// particles, decoration detail, cloud/wildlife counts) actually take
// effect right away instead of only on the next level entry.
// ---------------------------------------------------------------------------
function applyGraphicsSettings() {
  const s = getGraphicsSettings();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, s.pixelRatioCap));
  renderer.shadowMap.enabled = s.shadowsEnabled;
  if (sun.shadow.mapSize.width !== s.shadowMapSize) {
    sun.shadow.mapSize.set(s.shadowMapSize, s.shadowMapSize);
    // Three.js only regenerates the shadow map texture at the new
    // resolution once the old one is disposed — changing mapSize alone
    // has no effect on an already-rendered light.
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  resizeToViewport();
  if (currentLevelIdx >= 0) buildLevel(currentLevelIdx);
}

function changeGraphicsTier(tier) {
  if (!setGraphicsTier(tier)) return;
  applyGraphicsSettings();
  syncGraphicsUI();
}

function syncGraphicsUI() {
  const active = getGraphicsTier();
  graphicsPanel?.querySelectorAll(".rift-graphics-opt").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tier === active);
  });
}

if (graphicsBtn && graphicsPanel) {
  graphicsBtn.addEventListener("click", () => {
    const open = graphicsPanel.hidden;
    graphicsPanel.hidden = !open;
    graphicsBtn.classList.toggle("gfx-open", open);
  });
  graphicsPanel.querySelectorAll(".rift-graphics-opt").forEach((btn) => {
    btn.addEventListener("click", () => changeGraphicsTier(btn.dataset.tier));
  });
  syncGraphicsUI();
}

// ---------------------------------------------------------------------------
// Level select UI
// ---------------------------------------------------------------------------
// A brief "you've just landed" beat on entering any level — fades from
// black, holds on the biome name, then fades into gameplay, instead of
// snapping straight from the level-select menu into full control.
function playArrivalSequence(levelName) {
  if (!arrivalOverlay || !arrivalNameEl) return;
  arrivalOverlay.classList.remove("rift-arrival-fade", "rift-arrival-name-in");
  // Suppress the transition just long enough to snap fully opaque again —
  // otherwise, re-entering a level while a previous arrival's fade-out was
  // still mid-flight would smoothly transition back to opaque instead of
  // resetting instantly, and worse, leaving an inline opacity value set
  // here would permanently override the CSS class-based fade on every
  // arrival after this one.
  arrivalOverlay.style.transition = "none";
  arrivalOverlay.style.opacity = "1";
  arrivalOverlay.offsetHeight; // force a reflow so the transition:none + opacity reset above actually apply before it's cleared below
  arrivalOverlay.style.transition = "";
  arrivalNameEl.textContent = levelName;
  requestAnimationFrame(() => {
    arrivalOverlay.classList.add("rift-arrival-name-in");
  });
  setTimeout(() => arrivalOverlay.classList.add("rift-arrival-fade"), 1900);
}

function enterLevel(levelIdx) {
  buildLevel(levelIdx);
  initAudio();
  startAmbient(LEVELS[levelIdx].biome);
  playArrivalSequence(LEVELS[levelIdx].name);
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

  const dayNight = updateDayNightCycle(dayNightCycle, dt);

  if (isGameActive() && currentLevelIdx >= 0) {
    updateMovement(dt, playerPhysics.grounded);
    updatePlayerPhysics(camera, terrainMesh, playerPhysics, dt, PLAYER_EYE_HEIGHT, jumpQueued);
    jumpQueued = false;
    if (camera.position.y < spawnPosition.y - FALL_RESPAWN_OFFSET) respawnInLevel();
    checkLoreProximity();
  }

  for (const [, handle] of crystalHandles) updateCrystalMesh(handle, elapsedTime);
  for (const handle of decorationHandles) updateDecoration(handle, elapsedTime);
  updateLiquidPlane(liquidHandle, elapsedTime, dayNight.skyZenith, camera.position.y);
  const wind = updateWeatherSystem(weatherHandle, dt);
  updateAtmosphericParticles(atmosphereHandle, elapsedTime, dt, wind.windX, wind.windZ);
  updateGrass(grassHandle, elapsedTime, wind.windX, wind.windZ);
  updateWildlife(wildlifeHandle, elapsedTime, dt, camera.position.x, camera.position.z);
  updateLandmark(landmarkHandle, elapsedTime);
  updateClouds(cloudsHandle, dt, wind, dayNight.dayAmount, wind.rainIntensity);
  updateWorldPulse(dt);
  updateProjectiles(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
