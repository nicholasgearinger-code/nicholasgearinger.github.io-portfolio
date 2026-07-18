import * as THREE from "three";

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
  ember: { flyers: 0, flyerColor: 0x000000, motes: 5, moteColor: 0xff8a4a, moteHeight: 3 },      // too hostile for birds — a few drifting embers-with-intent instead
  verdant: { flyers: 6, flyerColor: 0x1a1a1a, motes: 8, moteColor: 0xbdf27a, moteHeight: 1.5 },   // birds circling + fireflies low in the grass
  crystal: { flyers: 3, flyerColor: 0x2a3a44, motes: 10, moteColor: 0x9fe8ff, moteHeight: 4 },    // sparse crystal-moths drifting near the spires
  abyssal: { flyers: 2, flyerColor: 0x14101c, motes: 4, moteColor: 0x8a86ff, moteHeight: 1 },     // a couple of large slow shapes circling high, and eerie low lure-lights
  ashen: { flyers: 4, flyerColor: 0x1c1712, motes: 0, moteColor: 0x000000, moteHeight: 0 },       // scavengers circling over a dead lakebed, nothing bioluminescent down in the dust
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

function createGlowmote(scene, color, baseHeight) {
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
  };
}

/**
 * @param {THREE.Scene} scene
 * @param {string} biome
 */
function createWildlife(scene, biome) {
  const profile = WILDLIFE_PROFILE[biome] || WILDLIFE_PROFILE.verdant;
  const flyers = [];
  for (let i = 0; i < profile.flyers; i++) flyers.push(createFlyer(scene, profile.flyerColor));
  const motes = [];
  for (let i = 0; i < profile.motes; i++) motes.push(createGlowmote(scene, profile.moteColor, profile.moteHeight));
  return { flyers, motes };
}

function updateWildlife(handle, elapsed, dt) {
  if (!handle) return;
  for (const f of handle.flyers) {
    f.orbitAngle += f.orbitSpeed * dt;
    f.sprite.position.set(
      f.orbitCenterX + Math.cos(f.orbitAngle) * f.orbitRadius,
      f.height + Math.sin(elapsed * 0.3 + f.flapSeed) * 2, // gentle altitude bob, not a flat circular track
      f.orbitCenterZ + Math.sin(f.orbitAngle) * f.orbitRadius
    );
    // Wing-flap via scale pulse rather than an actual animated wing mesh —
    // cheap, and at circling-bird distance it reads fine.
    const flap = 1 + Math.sin(elapsed * 8 + f.flapSeed) * 0.35;
    f.sprite.scale.set(2.2, 1.3 * flap, 1);
  }
  for (const m of handle.motes) {
    m.wanderAngle += (Math.random() - 0.5) * dt * 2;
    m.x += Math.cos(m.wanderAngle) * dt * 1.5;
    m.z += Math.sin(m.wanderAngle) * dt * 1.5;
    // Keep wandering within a bounded area rather than drifting off
    // forever — gently steer back toward center once far out.
    if (Math.hypot(m.x, m.z) > 100) m.wanderAngle = Math.atan2(-m.z, -m.x);
    const y = m.baseY + Math.sin(elapsed * 1.2 + m.seed) * 0.6;
    m.sprite.position.set(m.x, y, m.z);
    m.sprite.material.opacity = 0.55 + 0.35 * Math.sin(elapsed * 2 + m.seed);
  }
}

function disposeWildlife(scene, handle) {
  if (!handle) return;
  for (const f of handle.flyers) { scene.remove(f.sprite); f.sprite.material.dispose(); }
  for (const m of handle.motes) { scene.remove(m.sprite); m.sprite.material.dispose(); }
}

export { createWildlife, updateWildlife, disposeWildlife };
