import * as THREE from "three";
import { getGraphicsSettings } from "./graphicsSettings.js";
import { LANDMARK_POSITION } from "./landmarks.js";

// -----------------------------------------------------------------------------
// SWAP POINT: ambient wildlife — small non-interactive creatures that just
// exist and move, which is one of the strongest "someone/something lives
// here" signals a scene can have. Two archetypes: flyers (circle at
// altitude in a loose flock, simple wing-flap via scale pulse) and
// glowmotes (small bright lights wandering near the ground). Both are
// camera-facing sprites, not real geometry — cheap, and at this distance
// a billboard silhouette reads fine. Swap WILDLIFE_PROFILE for different
// counts/colors/behavior per biome.
// -----------------------------------------------------------------------------

const WILDLIFE_PROFILE = {
  ember: { flyers: 0, flyerColor: 0x000000, motes: 7, moteColor: 0xff8a4a, moteHeight: 3, moteBlink: true, salamanders: 4, salamanderColor: 0xff7a28, glowcrawlers: 0, glowcrawlerColor: 0x000000 }, // too hostile for birds — fireflies-with-intent, plus fire salamanders scurrying near the lava
  verdant: { flyers: 6, flyerColor: 0x1a1a1a, motes: 8, moteColor: 0xbdf27a, moteHeight: 1.5, moteBlink: true, salamanders: 0, salamanderColor: 0x000000, glowcrawlers: 5, glowcrawlerColor: 0x8fe3ff }, // birds circling + real fireflies low in the grass + a second glowing ground creature, distinct from the motes — slower, always-lit, closer to the ground
  crystal: { flyers: 3, flyerColor: 0x2a3a44, motes: 10, moteColor: 0x9fe8ff, moteHeight: 4, moteBlink: false, salamanders: 0, salamanderColor: 0x000000, glowcrawlers: 0, glowcrawlerColor: 0x000000 }, // sparse crystal-moths drifting near the spires
  abyssal: { flyers: 2, flyerColor: 0x14101c, motes: 4, moteColor: 0x8a86ff, moteHeight: 1, moteBlink: false, salamanders: 0, salamanderColor: 0x000000, glowcrawlers: 0, glowcrawlerColor: 0x000000 }, // a couple of large slow shapes circling high, and eerie low lure-lights
  ashen: { flyers: 4, flyerColor: 0x1c1712, motes: 0, moteColor: 0x000000, moteHeight: 0, moteBlink: false, salamanders: 0, salamanderColor: 0x000000, glowcrawlers: 0, glowcrawlerColor: 0x000000 },   // scavengers circling over a dead lakebed, nothing bioluminescent down in the dust
};

let sharedWingTexture = null;
function getWingTexture() {
  if (sharedWingTexture) return sharedWingTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.35);
  ctx.lineTo(size * 0.05, size * 0.55);
  ctx.lineTo(size * 0.5, size * 0.65);
  ctx.lineTo(size * 0.95, size * 0.55);
  ctx.closePath();
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}

let sharedMoteTexture = null;
function getMoteTexture() {
  if (sharedMoteTexture) return sharedMoteTexture;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  sharedMoteTexture = new THREE.CanvasTexture(canvas);
  return sharedMoteTexture;
}

// Simple flat side-profile silhouette — squat body, short legs, a curled
// tail — painted once and reused for every salamander via material.color
// tinting, the same white-silhouette-plus-color-tint approach as the wing
// and mote textures above. Always seen small and in motion, so there's no
// value in more detail than a clean recognizable outline.
let sharedSalamanderTexture = null;
function getSalamanderTexture() {
  if (sharedSalamanderTexture) return sharedSalamanderTexture;
  const w = 64, h = 32;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(w * 0.62, h * 0.42); // body
  ctx.bezierCurveTo(w * 0.7, h * 0.28, w * 0.42, h * 0.22, w * 0.28, h * 0.4);
  ctx.bezierCurveTo(w * 0.18, h * 0.52, w * 0.22, h * 0.66, w * 0.38, h * 0.68);
  ctx.bezierCurveTo(w * 0.5, h * 0.7, w * 0.66, h * 0.62, w * 0.62, h * 0.42);
  ctx.closePath();
  ctx.fill();
  // Tail, curling back from the body.
  ctx.beginPath();
  ctx.moveTo(w * 0.6, h * 0.45);
  ctx.quadraticCurveTo(w * 0.85, h * 0.3, w * 0.98, h * 0.5);
  ctx.quadraticCurveTo(w * 0.85, h * 0.42, w * 0.65, h * 0.55);
  ctx.closePath();
  ctx.fill();
  // Four short legs.
  ctx.lineWidth = h * 0.06;
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(w * 0.32, h * 0.6); ctx.lineTo(w * 0.28, h * 0.82);
  ctx.moveTo(w * 0.46, h * 0.62); ctx.lineTo(w * 0.42, h * 0.85);
  ctx.moveTo(w * 0.3, h * 0.42); ctx.lineTo(w * 0.24, h * 0.22);
  ctx.moveTo(w * 0.46, h * 0.4); ctx.lineTo(w * 0.42, h * 0.2);
  ctx.stroke();
  sharedSalamanderTexture = new THREE.CanvasTexture(canvas);
  return sharedSalamanderTexture;
}

// A small rounded snail/grub silhouette — genuinely additive-blended
// (not just a tinted normal sprite like the salamander) so it actually
// reads as glowing rather than merely colored, distinct from the
// firefly motes' soft dot glow.
let sharedGlowcrawlerTexture = null;
function getGlowcrawlerTexture() {
  if (sharedGlowcrawlerTexture) return sharedGlowcrawlerTexture;
  const w = 48, h = 32;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  // Rounded body/shell.
  ctx.beginPath();
  ctx.ellipse(w * 0.42, h * 0.5, w * 0.32, h * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  // A small head/foot trailing off one side.
  ctx.beginPath();
  ctx.ellipse(w * 0.82, h * 0.58, w * 0.14, h * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  sharedGlowcrawlerTexture = new THREE.CanvasTexture(canvas);
  return sharedGlowcrawlerTexture;
}

function createFlyer(scene, color) {
  const mat = new THREE.SpriteMaterial({ map: getWingTexture(), color, fog: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.2, 1.3, 1);
  scene.add(sprite);
  return {
    sprite,
    orbitRadius: 25 + Math.random() * 60,
    orbitSpeed: 0.15 + Math.random() * 0.15,
    orbitAngle: Math.random() * Math.PI * 2,
    orbitCenterX: (Math.random() - 0.5) * 60,
    orbitCenterZ: (Math.random() - 0.5) * 60,
    height: 20 + Math.random() * 30,
    flapSeed: Math.random() * Math.PI * 2,
  };
}

function createGlowmote(scene, color, baseHeight, blink) {
  const mat = new THREE.SpriteMaterial({
    map: getMoteTexture(), color, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(0.5 + Math.random() * 0.4);
  scene.add(sprite);
  return {
    sprite,
    x: (Math.random() - 0.5) * 140,
    z: (Math.random() - 0.5) * 140,
    baseY: baseHeight + Math.random() * 1.5,
    seed: Math.random() * Math.PI * 2,
    wanderAngle: Math.random() * Math.PI * 2,
    blink,
  };
}

// Ground-hugging creature, unlike flyers/motes — needs a heightSampler to
// actually sit on the terrain rather than float at a fixed altitude.
// Wanders in short scurry-then-pause bursts (real small-animal movement)
// rather than continuous drifting, and flees the volcano specifically
// during an eruption rather than just the player.
function createSalamander(scene, color, heightSampler) {
  const mat = new THREE.SpriteMaterial({ map: getSalamanderTexture(), color, fog: true });
  const sprite = new THREE.Sprite(mat);
  const scale = 1.1 + Math.random() * 0.5;
  sprite.scale.set(scale, scale * 0.5, 1);
  scene.add(sprite);
  return {
    sprite,
    heightSampler,
    x: (Math.random() - 0.5) * 140,
    z: (Math.random() - 0.5) * 140,
    wanderAngle: Math.random() * Math.PI * 2,
    seed: Math.random() * Math.PI * 2,
    speed: 1.6 + Math.random() * 1.2,
    paused: false,
    pauseTimer: Math.random() * 2,
  };
}

// A slow, always-glowing ground creature — distinct from both the
// firefly motes (which drift at a fixed hover height, no ground contact)
// and the salamander (which is a normal-blended, eruption-fleeing
// creature) — this one crawls along the actual terrain and uses additive
// blending so it reads as a genuine small light source, dimmer and
// steadier than a firefly's blink.
function createGlowcrawler(scene, color, heightSampler) {
  const mat = new THREE.SpriteMaterial({ map: getGlowcrawlerTexture(), color, fog: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  const scale = 0.75 + Math.random() * 0.35;
  sprite.scale.set(scale, scale * 0.65, 1);
  scene.add(sprite);
  return {
    sprite,
    heightSampler,
    x: (Math.random() - 0.5) * 140,
    z: (Math.random() - 0.5) * 140,
    wanderAngle: Math.random() * Math.PI * 2,
    seed: Math.random() * Math.PI * 2,
    speed: 0.35 + Math.random() * 0.3, // noticeably slower than a salamander's scurry — a crawl, not a scurry
    paused: false,
    pauseTimer: Math.random() * 3,
  };
}

/**
 * @param {THREE.Scene} scene
 * @param {string} biome
 * @param {(x: number, z: number) => number} [heightSampler] optional — only used by salamanders, which need to sit on the actual terrain rather than float at a fixed altitude like flyers/motes do
 */
function createWildlife(scene, biome, heightSampler) {
  const profile = WILDLIFE_PROFILE[biome] || WILDLIFE_PROFILE.verdant;
  const mult = getGraphicsSettings().wildlifeMultiplier;
  const flyerCount = Math.round(profile.flyers * mult);
  const moteCount = Math.round(profile.motes * mult);
  const salamanderCount = Math.round((profile.salamanders || 0) * mult);
  const flyers = [];
  for (let i = 0; i < flyerCount; i++) flyers.push(createFlyer(scene, profile.flyerColor));
  const motes = [];
  for (let i = 0; i < moteCount; i++) motes.push(createGlowmote(scene, profile.moteColor, profile.moteHeight, !!profile.moteBlink));
  const salamanders = [];
  for (let i = 0; i < salamanderCount; i++) salamanders.push(createSalamander(scene, profile.salamanderColor, heightSampler));
  const glowcrawlerCount = Math.round((profile.glowcrawlers || 0) * mult);
  const glowcrawlers = [];
  for (let i = 0; i < glowcrawlerCount; i++) glowcrawlers.push(createGlowcrawler(scene, profile.glowcrawlerColor, heightSampler));
  return { flyers, motes, salamanders, glowcrawlers };
}

function updateWildlife(handle, elapsed, dt, playerX = 0, playerZ = 0, erupting = false) {
  if (!handle) return;
  const FLEE_RADIUS = 9; // motes/salamanders start reacting once the player is this close
  const STARTLE_RADIUS = 14; // flyers notice from a bit further out — they're airborne, more visible range
  for (const f of handle.flyers) {
    f.orbitAngle += f.orbitSpeed * dt;
    const fx = f.orbitCenterX + Math.cos(f.orbitAngle) * f.orbitRadius;
    const fz = f.orbitCenterZ + Math.sin(f.orbitAngle) * f.orbitRadius;
    f.sprite.position.set(
      fx,
      f.height + Math.sin(elapsed * 0.3 + f.flapSeed) * 2, // gentle altitude bob, not a flat circular track
      fz
    );
    // Wing-flap via scale pulse rather than an actual animated wing mesh —
    // cheap, and at circling-bird distance it reads fine. Startled birds
    // flap faster, not just "notice" invisibly — an eruption startles
    // them the same way the player walking up close does.
    const startled = erupting || Math.hypot(fx - playerX, fz - playerZ) < STARTLE_RADIUS;
    const flapRate = startled ? 16 : 8;
    const flap = 1 + Math.sin(elapsed * flapRate + f.flapSeed) * 0.35;
    f.sprite.scale.set(2.2, 1.3 * flap, 1);
  }
  for (const m of handle.motes) {
    const distToPlayer = Math.hypot(m.x - playerX, m.z - playerZ);
    if (distToPlayer < FLEE_RADIUS) {
      // Flee directly away from the player rather than continuing its own
      // wander — this is what actually reads as "noticed you," not just
      // brightening in place.
      m.wanderAngle = Math.atan2(m.z - playerZ, m.x - playerX);
      m.x += Math.cos(m.wanderAngle) * dt * 5;
      m.z += Math.sin(m.wanderAngle) * dt * 5;
    } else {
      m.wanderAngle += (Math.random() - 0.5) * dt * 2;
      m.x += Math.cos(m.wanderAngle) * dt * 1.5;
      m.z += Math.sin(m.wanderAngle) * dt * 1.5;
    }
    // Keep wandering within a bounded area rather than drifting off
    // forever — gently steer back toward center once far out.
    if (Math.hypot(m.x, m.z) > 100) m.wanderAngle = Math.atan2(-m.z, -m.x);
    const y = m.baseY + Math.sin(elapsed * 1.2 + m.seed) * 0.6;
    m.sprite.position.set(m.x, y, m.z);
    const fleeGlow = distToPlayer < FLEE_RADIUS ? (1 - distToPlayer / FLEE_RADIUS) * 0.4 : 0;
    const eruptionGlow = erupting ? 0.2 : 0; // agitated, brighter, during an eruption
    if (m.blink) {
      // Long dark stretch, quick bright flash — real firefly blink
      // character, distinct from the smooth continuous glow the
      // non-blinking motes (crystal moths, abyssal lure-lights) still use.
      const flash = Math.pow(Math.max(0, Math.sin(elapsed * 2.2 + m.seed)), 5);
      m.sprite.material.opacity = 0.1 + 0.75 * flash + fleeGlow + eruptionGlow;
    } else {
      m.sprite.material.opacity = 0.55 + 0.35 * Math.sin(elapsed * 2 + m.seed) + fleeGlow + eruptionGlow;
    }
  }
  for (const s of handle.salamanders) {
    const distToPlayer = Math.hypot(s.x - playerX, s.z - playerZ);
    const fleeingPlayer = distToPlayer < FLEE_RADIUS;
    if (fleeingPlayer || erupting) {
      // During an eruption, flee the volcano itself rather than the
      // player — a fire salamander bolting from lava reads very
      // differently (and more truthfully) than one bolting from you.
      s.wanderAngle = fleeingPlayer
        ? Math.atan2(s.z - playerZ, s.x - playerX)
        : Math.atan2(s.z - LANDMARK_POSITION.z, s.x - LANDMARK_POSITION.x);
      s.x += Math.cos(s.wanderAngle) * dt * s.speed * 2.5;
      s.z += Math.sin(s.wanderAngle) * dt * s.speed * 2.5;
      s.paused = false;
    } else {
      s.pauseTimer -= dt;
      if (s.pauseTimer <= 0) {
        s.paused = !s.paused;
        s.pauseTimer = s.paused ? 0.6 + Math.random() * 1.4 : 1.2 + Math.random() * 2.2;
        if (!s.paused) s.wanderAngle += (Math.random() - 0.5) * Math.PI;
      }
      if (!s.paused) {
        s.x += Math.cos(s.wanderAngle) * dt * s.speed;
        s.z += Math.sin(s.wanderAngle) * dt * s.speed;
      }
    }
    if (Math.hypot(s.x, s.z) > 100) s.wanderAngle = Math.atan2(-s.z, -s.x);
    const groundY = s.heightSampler ? (s.heightSampler(s.x, s.z) ?? 0) : 0;
    // A quick little up-down scurry bob while moving, still while paused
    // — motion is what actually reads as "alive," not a smooth glide.
    const scurryBob = s.paused ? 0 : Math.abs(Math.sin(elapsed * 10 + s.seed)) * 0.06;
    s.sprite.position.set(s.x, groundY + 0.12 + scurryBob, s.z);
  }
  for (const g of handle.glowcrawlers) {
    const distToPlayer = Math.hypot(g.x - playerX, g.z - playerZ);
    if (distToPlayer < FLEE_RADIUS) {
      g.wanderAngle = Math.atan2(g.z - playerZ, g.x - playerX);
      g.x += Math.cos(g.wanderAngle) * dt * g.speed * 2; // still slow even fleeing — this is a crawler, not something that can bolt
      g.z += Math.sin(g.wanderAngle) * dt * g.speed * 2;
      g.paused = false;
    } else {
      g.pauseTimer -= dt;
      if (g.pauseTimer <= 0) {
        g.paused = !g.paused;
        g.pauseTimer = g.paused ? 1.5 + Math.random() * 2.5 : 2 + Math.random() * 3;
        if (!g.paused) g.wanderAngle += (Math.random() - 0.5) * Math.PI;
      }
      if (!g.paused) {
        g.x += Math.cos(g.wanderAngle) * dt * g.speed;
        g.z += Math.sin(g.wanderAngle) * dt * g.speed;
      }
    }
    if (Math.hypot(g.x, g.z) > 100) g.wanderAngle = Math.atan2(-g.z, -g.x);
    const groundY2 = g.heightSampler ? (g.heightSampler(g.x, g.z) ?? 0) : 0;
    g.sprite.position.set(g.x, groundY2 + 0.06, g.z);
    // Slow steady pulse, not a firefly-style blink — a different,
    // calmer glow character from the motes above.
    g.sprite.material.opacity = 0.5 + 0.3 * Math.sin(elapsed * 0.8 + g.seed);
  }
}

function disposeWildlife(scene, handle) {
  if (!handle) return;
  for (const f of handle.flyers) { scene.remove(f.sprite); f.sprite.material.dispose(); }
  for (const m of handle.motes) { scene.remove(m.sprite); m.sprite.material.dispose(); }
  for (const s of handle.salamanders || []) { scene.remove(s.sprite); s.sprite.material.dispose(); }
  for (const g of handle.glowcrawlers || []) { scene.remove(g.sprite); g.sprite.material.dispose(); }
}

export { createWildlife, updateWildlife, disposeWildlife };
