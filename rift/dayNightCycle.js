import * as THREE from "three";
import * as current from "./dayNightCycle_realistic_base.js";

export * from "./dayNightCycle_realistic_base.js";

// Realistic celestial presentation wrapper. The preserved base module keeps
// the orbit, lighting, stars and sky timing; this layer replaces only the
// debug-era visual sun/moon bodies and neutralizes the blue moonlight cast.
const ORBIT_RADIUS = 260;
const SUN_VISUAL_HORIZON_OFFSET = 10;
const WHITE = new THREE.Color(0xffffff);
const SUN_GOLD = new THREE.Color(0xffd28f);
const SUN_HORIZON = new THREE.Color(0xff6a24);
const MOON_SILVER = new THREE.Color(0xf0eee8);
const MOON_GLOW = new THREE.Color(0xdde3e8);
const MOON_LIGHT = new THREE.Color(0xd6dbe2);

function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
function smooth01(value) { const t = clamp01(value); return t * t * (3 - 2 * t); }

function makeCanvasTexture(size, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createSunDiscTexture() {
  return makeCanvasTexture(256, (ctx, size) => {
    const c = size * 0.5, r = size * 0.47;
    const g = ctx.createRadialGradient(c, c, 0, c, c, r);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.72, "rgba(255,255,255,1)");
    g.addColorStop(0.90, "rgba(255,253,244,0.98)");
    g.addColorStop(0.975, "rgba(255,245,220,0.82)");
    g.addColorStop(1, "rgba(255,240,210,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  });
}

function createSunHaloTexture() {
  return makeCanvasTexture(256, (ctx, size) => {
    const c = size * 0.5;
    const radial = ctx.createRadialGradient(c, c, 0, c, c, c);
    radial.addColorStop(0, "rgba(255,255,255,1)");
    radial.addColorStop(0.10, "rgba(255,248,225,0.78)");
    radial.addColorStop(0.32, "rgba(255,220,160,0.24)");
    radial.addColorStop(1, "rgba(255,200,120,0)");
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.translate(c, c);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const length = i % 2 === 0 ? size * 0.47 : size * 0.32;
      const halfWidth = i % 2 === 0 ? 1.15 : 0.75;
      ctx.save();
      ctx.rotate(angle);
      const ray = ctx.createLinearGradient(0, 0, length, 0);
      ray.addColorStop(0, "rgba(255,255,255,0.85)");
      ray.addColorStop(0.12, "rgba(255,244,216,0.45)");
      ray.addColorStop(1, "rgba(255,225,170,0)");
      ctx.fillStyle = ray;
      ctx.beginPath();
      ctx.moveTo(0, -halfWidth);
      ctx.lineTo(length, 0);
      ctx.lineTo(0, halfWidth);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  });
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function createMoonDiscTexture() {
  return makeCanvasTexture(256, (ctx, size) => {
    const c = size * 0.5, r = size * 0.46;
    const base = ctx.createRadialGradient(c - r * 0.22, c - r * 0.18, r * 0.05, c, c, r);
    base.addColorStop(0, "rgba(255,253,246,1)");
    base.addColorStop(0.62, "rgba(239,238,232,1)");
    base.addColorStop(0.92, "rgba(211,211,207,1)");
    base.addColorStop(1, "rgba(190,192,194,0)");
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, r * 0.97, 0, Math.PI * 2);
    ctx.clip();
    const random = seededRandom(0x4d4f4f4e);
    for (let i = 0; i < 20; i++) {
      const angle = random() * Math.PI * 2;
      const radial = Math.sqrt(random()) * r * 0.76;
      const x = c + Math.cos(angle) * radial;
      const y = c + Math.sin(angle) * radial;
      const cr = r * (0.025 + random() * 0.075);
      const crater = ctx.createRadialGradient(x - cr * 0.25, y - cr * 0.2, 0, x, y, cr);
      crater.addColorStop(0, "rgba(150,151,149,0.22)");
      crater.addColorStop(0.68, "rgba(184,184,180,0.14)");
      crater.addColorStop(1, "rgba(230,230,226,0)");
      ctx.fillStyle = crater;
      ctx.beginPath();
      ctx.arc(x, y, cr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
}

function createMoonHaloTexture() {
  return makeCanvasTexture(128, (ctx, size) => {
    const c = size * 0.5;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, "rgba(245,246,244,0.82)");
    g.addColorStop(0.24, "rgba(225,230,234,0.32)");
    g.addColorStop(1, "rgba(210,220,228,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  });
}

function replaceCore(body, texture, diameter, color) {
  const old = body?.core;
  if (!body?.group || !old) return;
  body.group.remove(old);
  if (old.geometry) old.geometry.dispose();
  if (old.material) old.material.dispose();

  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    opacity: 1,
    blending: THREE.NormalBlending,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    alphaTest: 0.01,
  });
  const core = new THREE.Sprite(material);
  core.scale.set(diameter, diameter, 1);
  core.renderOrder = -101;
  body.group.add(core);
  body.core = core;
  body.__riftCoreDiameter = diameter;
}

function replaceGlow(body, texture, diameter, color, opacity) {
  const old = body?.glow;
  if (!body?.group || !old) return;
  body.group.remove(old);
  if (old.material) old.material.dispose();

  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const glow = new THREE.Sprite(material);
  glow.scale.set(diameter, diameter, 1);
  glow.renderOrder = -100.9;
  body.group.add(glow);
  body.glow = glow;
  body.baseGlowOpacity = opacity;
  body.baseGlowScale = diameter;
  body.baseGlowColor = new THREE.Color(color);
}

function installRealisticCelestialBodies(cycle) {
  if (!cycle || cycle.__riftRealisticCelestials) return cycle;
  const textures = {
    sunDisc: createSunDiscTexture(),
    sunHalo: createSunHaloTexture(),
    moonDisc: createMoonDiscTexture(),
    moonHalo: createMoonHaloTexture(),
  };

  replaceCore(cycle.sunBody, textures.sunDisc, 18, WHITE);
  replaceGlow(cycle.sunBody, textures.sunHalo, 86, WHITE, 0.48);
  replaceCore(cycle.moonBody, textures.moonDisc, 15, MOON_SILVER);
  replaceGlow(cycle.moonBody, textures.moonHalo, 34, MOON_GLOW, 0.13);

  cycle.moonBody.group.visible = true;
  if (cycle.moonLight) cycle.moonLight.color.copy(MOON_LIGHT);
  cycle.__riftCelestialTextures = textures;
  cycle.__riftRealisticCelestials = true;
  return cycle;
}

function updateRealisticCelestialAppearance(cycle) {
  if (!cycle?.__riftRealisticCelestials) return;

  const elevation = THREE.MathUtils.clamp(
    (cycle.sunBody.group.position.y - SUN_VISUAL_HORIZON_OFFSET) / ORBIT_RADIUS,
    -1,
    1,
  );
  const horizon = smooth01(1 - Math.abs(elevation) / 0.12);
  const sunTint = horizon < 0.55
    ? WHITE.clone().lerp(SUN_GOLD, horizon / 0.55)
    : SUN_GOLD.clone().lerp(SUN_HORIZON, (horizon - 0.55) / 0.45);

  cycle.sunBody.core.material.color.copy(sunTint);
  cycle.sunBody.glow.material.color.copy(sunTint.clone().lerp(WHITE, 0.28));

  // The preserved updater writes a dimensionless apparent-size boost into
  // core.scale every frame. Re-apply it to the real sprite diameter.
  const sunScaleBoost = Math.max(0.8, Number(cycle.sunBody.core.scale.x) || 1);
  const sunDiameter = cycle.sunBody.__riftCoreDiameter || 18;
  cycle.sunBody.core.scale.set(sunDiameter * sunScaleBoost, sunDiameter * sunScaleBoost, 1);

  // In this simplified opposite-sun orbit the moon is above the horizon at
  // night/twilight, and below it during the day. No permanent debug moon.
  cycle.moonBody.group.visible = elevation < 0.06;
  const moonDiameter = cycle.moonBody.__riftCoreDiameter || 15;
  cycle.moonBody.core.scale.set(moonDiameter, moonDiameter, 1);
  cycle.moonBody.core.material.color.copy(MOON_SILVER);
  cycle.moonBody.glow.material.color.copy(MOON_GLOW);
  if (cycle.moonLight) cycle.moonLight.color.copy(MOON_LIGHT);
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  return installRealisticCelestialBodies(
    current.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight),
  );
}

export function updateDayNightCycle(cycle, dt) {
  const result = current.updateDayNightCycle(cycle, dt);
  updateRealisticCelestialAppearance(cycle);
  return result;
}
