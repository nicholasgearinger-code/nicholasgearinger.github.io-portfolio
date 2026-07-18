import * as THREE from "three";

// -----------------------------------------------------------------------------
// SWAP POINT: clouds. Each cloud is a small cluster of soft circular
// billboards (the same radial-gradient technique used for the sun/moon
// glow in dayNightCycle.js) rather than a single flat sprite — one
// billboard reads as a blob, several overlapping ones at different sizes
// reads as a puffy cloud. Cheap: still just a handful of sprites per
// cloud, additive/alpha blended, no real volumetrics. Swap CLOUD_STYLE for
// a different look/density per biome without touching drift or tinting.
// -----------------------------------------------------------------------------

const CLOUD_STYLE = {
  ember: { count: 5, altitude: 85, spread: 140, puffColor: 0x4a3830, opacity: 0.5, scale: 12 },   // low, ashy, smoke-dark rather than fluffy-white
  verdant: { count: 9, altitude: 95, spread: 160, puffColor: 0xf4f7fb, opacity: 0.7, scale: 15 },  // classic fluffy white, the most cloud-heavy sky
  crystal: { count: 4, altitude: 100, spread: 150, puffColor: 0xdcecf5, opacity: 0.45, scale: 11 }, // sparse, thin, icy-pale
  abyssal: { count: 7, altitude: 80, spread: 140, puffColor: 0x2e2a3a, opacity: 0.6, scale: 14 },   // heavy, dark, low — presses down on the chasms
  ashen: { count: 3, altitude: 110, spread: 150, puffColor: 0xd6cdb8, opacity: 0.35, scale: 10 },   // thin, wispy, dust-pale — barely enough moisture in the air to call these clouds
};

// Same cluster-of-billboards technique as sky clouds, just low, wide, and
// flattened (small vertical spread, big horizontal spread) instead of
// puffy — a visible drifting mist layer at ground level, distinct from
// the ambient fog density that already breathes in weather.js.
const GROUND_FOG_STYLE = {
  ember: { count: 4, altitude: 2, spread: 90, puffColor: 0x6b5d52, opacity: 0.3, scale: 22 },
  verdant: { count: 5, altitude: 1.5, spread: 100, puffColor: 0xe8eef0, opacity: 0.35, scale: 24 },
  crystal: { count: 3, altitude: 2, spread: 90, puffColor: 0xcfe6ee, opacity: 0.25, scale: 20 },
  abyssal: { count: 7, altitude: 1, spread: 100, puffColor: 0x342f42, opacity: 0.45, scale: 26 }, // the thickest, heaviest ground fog — rolls right through the chasms
  ashen: { count: 4, altitude: 1.5, spread: 100, puffColor: 0xb8ab90, opacity: 0.28, scale: 22 },
};

let sharedPuffTexture = null;
function getPuffTexture() {
  if (sharedPuffTexture) return sharedPuffTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.4)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  sharedPuffTexture = new THREE.CanvasTexture(canvas);
  return sharedPuffTexture;
}

function createCloud(scene, style, flatten = 1) {
  const group = new THREE.Group();
  const puffCount = 4 + Math.floor(Math.random() * 4);
  const sprites = [];
  for (let i = 0; i < puffCount; i++) {
    const mat = new THREE.SpriteMaterial({
      map: getPuffTexture(), color: style.puffColor, transparent: true, opacity: style.opacity,
      depthWrite: false, fog: true,
    });
    const sprite = new THREE.Sprite(mat);
    const s = style.scale * (0.6 + Math.random() * 0.7);
    sprite.scale.set(s, s * flatten, 1); // flatten<1 spreads wide and low instead of puffy — this is what turns the same technique into a ground fog bank
    sprite.position.set((Math.random() - 0.5) * style.scale * 1.4, (Math.random() - 0.5) * style.scale * 0.35 * flatten, (Math.random() - 0.5) * style.scale * 1.4);
    group.add(sprite);
    sprites.push(sprite);
  }
  group.position.set((Math.random() - 0.5) * style.spread * 2, style.altitude + (Math.random() - 0.5) * 12 * flatten, (Math.random() - 0.5) * style.spread * 2);
  scene.add(group);
  return { group, sprites, baseOpacity: style.opacity };
}

/**
 * @param {THREE.Scene} scene
 * @param {string} biome
 */
function createClouds(scene, biome) {
  const style = CLOUD_STYLE[biome] || CLOUD_STYLE.verdant;
  const clouds = [];
  for (let i = 0; i < style.count; i++) clouds.push(createCloud(scene, style));

  const fogStyle = GROUND_FOG_STYLE[biome] || GROUND_FOG_STYLE.verdant;
  const groundFog = [];
  for (let i = 0; i < fogStyle.count; i++) groundFog.push(createCloud(scene, fogStyle, 0.18));

  return { clouds, style, groundFog, fogStyle, windOffsetX: 0, windOffsetZ: 0 };
}

/**
 * @param {{windX:number, windZ:number}} wind
 * @param {number} dayAmount  0..1, from the day/night cycle — clouds read
 *   noticeably warmer/darker at dawn/dusk than at flat noon light
 * @param {number} rainIntensity  0..1 — storm clouds darken while it's
 *   actually raining, not just sit there looking identical to a clear day
 */
function updateClouds(handle, dt, wind, dayAmount, rainIntensity) {
  if (!handle) return;
  const { clouds, style, groundFog, fogStyle } = handle;
  const lightFactor = 0.55 + dayAmount * 0.45; // dimmer/moodier at dawn/dusk/night, brightest at noon
  const stormDarken = 1 - (rainIntensity || 0) * 0.4;
  for (const cloud of clouds) {
    cloud.group.position.x += (wind?.windX || 0) * dt * 0.6;
    cloud.group.position.z += (wind?.windZ || 0) * dt * 0.6;
    // Wrap back around once a cloud drifts past the scattering radius —
    // clouds drift slower than ground-level particles since they're much
    // further away, so the same wind speed reads as more sluggish motion.
    if (Math.abs(cloud.group.position.x) > style.spread) cloud.group.position.x = -Math.sign(cloud.group.position.x) * style.spread;
    if (Math.abs(cloud.group.position.z) > style.spread) cloud.group.position.z = -Math.sign(cloud.group.position.z) * style.spread;
    for (const sprite of cloud.sprites) {
      sprite.material.opacity = cloud.baseOpacity * lightFactor * stormDarken;
    }
  }

  // Ground fog drifts at full wind speed (it's right there at head height,
  // not far off like sky clouds) and isn't storm-darkened — it's mist,
  // not a rain cloud, so it stays the same regardless of whether it's
  // raining.
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

export { createClouds, updateClouds, disposeClouds };
