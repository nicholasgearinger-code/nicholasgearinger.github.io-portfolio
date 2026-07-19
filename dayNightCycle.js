import * as THREE from "three";
import { getGraphicsSettings } from "./graphicsSettings.js";

// -----------------------------------------------------------------------------
// SWAP POINT: the entire day/night cycle — sun/moon position, sun/ambient
// color and intensity, sky gradient, and starfield opacity are all driven
// from one `t` value (0..1, where 0 = midnight, 0.5 = noon) so everything
// stays in sync automatically. Swap CYCLE_SECONDS for a different pace, or
// the color stops below for a different mood, without touching how any of
// it gets applied. The moon is just the sun's orbit formula run 180° out
// of phase — same math, not a separate system.
// -----------------------------------------------------------------------------

const CYCLE_SECONDS = 480; // one full day/night cycle — long enough not to be distracting, short enough to actually see it move in a session
const ORBIT_RADIUS = 260;
const SKY_DOME_RADIUS = 900;

// Color/intensity at each key point in the cycle, now including the sky's
// own zenith/horizon colors (previously the "sky" was just scene.fog's
// flat color reused as scene.background — a real gradient dome needs two
// colors, not one). Interpolated smoothly between neighbors by elevation,
// not a hard switch, so sunrise/sunset reads as its own moment.
const NIGHT = {
  sun: 0x22304a, sunIntensity: 0.12, ambient: 0x1a2438, ambientIntensity: 0.32,
  fog: 0x0a0e14, skyZenith: 0x05070f, skyHorizon: 0x141a2c,
};
const DAWN_DUSK = {
  sun: 0xff9d5c, sunIntensity: 0.75, ambient: 0x4a3550, ambientIntensity: 0.45,
  fog: 0x2a1f2e, skyZenith: 0x2a2138, skyHorizon: 0xff8f5c,
};
const DAY = {
  sun: 0xfff4e0, sunIntensity: 1.15, ambient: 0x8899bb, ambientIntensity: 0.65,
  fog: 0x1c2436, skyZenith: 0x1c3a5e, skyHorizon: 0x8fb8d6,
};

// A subtle per-biome push on top of the shared day/night colors above —
// this file was previously entirely biome-unaware (every biome saw the
// identical sky), which meant biomes only differed up close, not from a
// distance or from orbit. `amount` is deliberately small (0.10-0.14): the
// day/night mood (warm dawn, blue noon, deep night) still has to read
// correctly everywhere, this just leans each biome's sky toward its own
// accent color rather than replacing the mood outright.
const BIOME_SKY_TINT = {
  // Ember's amount is much higher than the others (0.5 vs ~0.1-0.14) —
  // a biome choked with volcanic ash/smoke and lit by its own fire
  // shouldn't read as a normal blue sky at any time of day, even subtly.
  // zenith/fog both pulled toward a desaturated ash-brown-gray (not the
  // earlier reddish-violet, which leaned too close to the volcano cone's
  // own accent rather than actual smoke) while horizon stays the vivid
  // lava-glow orange — the "fire glowing through haze near the ground"
  // read, fading up into smoke rather than sky blue overhead.
  ember: { zenith: 0x2e2620, horizon: 0xff6a30, fog: 0x241e18, amount: 0.5 },
  verdant: { zenith: 0x0a2a34, horizon: 0x6fd0d8, fog: 0x0f2a28, amount: 0.10 },
  crystal: { zenith: 0x1a1a3e, horizon: 0x9a8fff, fog: 0x181832, amount: 0.12 },
  abyssal: { zenith: 0x140a1e, horizon: 0x5a2a6a, fog: 0x120a1a, amount: 0.14 },
  ashen: { zenith: 0x2a2210, horizon: 0xd8b878, fog: 0x261e10, amount: 0.10 },
};

function lerpColor(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}

// Small self-contained value-noise, same technique terrain.js/landmarks.js
// already use — each module owns its own rather than cross-importing.
function hashSky(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}
function skyNoise2D(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hashSky(xi, yi), b = hashSky(xi + 1, yi), c = hashSky(xi, yi + 1), d = hashSky(xi + 1, yi + 1);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, u), THREE.MathUtils.lerp(c, d, u), v);
}

// Position + elevation for anything on the shared day/night arc — the sun
// uses phaseAngle directly, the moon uses phaseAngle + PI (opposite side
// of the same circle), everything else about them is identical.
function orbitPosition(phaseAngle) {
  const elevation = Math.sin(phaseAngle - Math.PI / 2);
  return {
    x: Math.cos(phaseAngle - Math.PI / 2) * ORBIT_RADIUS,
    y: elevation * ORBIT_RADIUS,
    elevation,
  };
}

// A soft radial gradient, white at center fading to fully transparent —
// this is what a glow sprite actually needs as its `map`. A SpriteMaterial
// with no texture just renders as a flat colored square (no falloff),
// which is what was reading as a plain gray box.
function createGlowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.7)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// Turbulent bright surface for the sun — mottled patches of a slightly
// different warm tone over a bright base, loosely evoking granulation
// rather than a flat disc.
function createSunTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff2cc";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 4 + Math.random() * 12;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,180,70,0.55)");
    grad.addColorStop(1, "rgba(255,180,70,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return new THREE.CanvasTexture(canvas);
}

// Pale, cratered surface for the moon — visibly different from the sun's
// warm turbulence rather than just a smaller, dimmer copy of it.
function createMoonTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#dbe4f4";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 45; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 3 + Math.random() * 16;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(120,132,165,0.55)");
    grad.addColorStop(1, "rgba(120,132,165,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return new THREE.CanvasTexture(canvas);
}

// A linear gradient — bright/opaque at one end fading to fully transparent
// at the other — for sun-beam sprites, versus the radial gradient the
// glow bodies use.
// The old version was a plain gradient fillRect — a rectangle with a
// top-to-bottom fade but hard, straight left/right edges the whole way
// down, which is exactly why it read as a flat gray slab instead of
// light. Real light shafts taper (narrow near the source, widening as
// they travel) and have soft edges on every side, not just top/bottom.
// This draws a tapered wedge shape and then blurs it, rather than filling
// a uniform-width rectangle.
function createBeamTexture() {
  const w = 128, h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  const cx = w / 2;
  const narrowHalf = w * 0.06;  // near the sun (top of texture) — a thin core, not a fat rectangle
  const wideHalf = w * 0.42;    // near the ground (bottom) — spread wide, like a real ray fanning out

  ctx.filter = "blur(10px)"; // this is what actually makes the edges read as soft light instead of a cut shape
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.4)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(cx - narrowHalf, 0);
  ctx.lineTo(cx + narrowHalf, 0);
  ctx.lineTo(cx + wideHalf, h);
  ctx.lineTo(cx - wideHalf, h);
  ctx.closePath();
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}

// A fan of long, thin, camera-facing sprites anchored to the sun —
// SpriteMaterial's own `rotation` (independent of the sprite's 3D
// transform) is what lets several of these fan out at different angles
// while every one of them still always faces the camera, the same way
// the sprite itself always does. This is the actual reason to use
// sprites here instead of fixed-orientation planes: a plane-based fan
// would go edge-on and vanish from most viewing angles.
// Anchored at the sun and extending downward toward the ground — the
// previous version centered small fixed-size sprites ON the sun, which
// read as a halo pattern rather than beams reaching anywhere. Sprite's
// own `center` property (not the usual 0.5,0.5 middle-anchor) is what
// makes a sprite extend away from its position instead of surrounding it:
// center.y=1 pins the sprite's top edge at `position`, so scaling it
// taller stretches it downward from the sun rather than growing evenly in
// both directions.
function createSunBeams(scene, beamTexture) {
  const group = new THREE.Group();
  const count = getGraphicsSettings().sunBeams;
  const sprites = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({
      map: beamTexture, color: 0xffdfa0, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true, // fog ON this time — these need to fade into the haze as they reach toward the ground, not stay artificially crisp at any distance
      rotation: (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.center.set(0.5, 1);
    const length = 260 + Math.random() * 120;
    sprite.scale.set(length * 0.32, length, 1); // texture is already tapered narrow->wide, so scale just sets overall size/length, not the taper itself
    group.add(sprite);
    sprites.push(sprite);
  }
  scene.add(group);
  return { group, sprites };
}

// A distant "gas giant" — soft horizontal banding, unlike the sun's
// turbulent granulation or the moon's scattered craters. Reads as a
// planet, not a star or moon.
function createDistantPlanetTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const bands = ["#c98a5a", "#d9a06e", "#b9754a", "#e0ac7d", "#c17a4e"];
  const bandHeight = size / bands.length;
  bands.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, i * bandHeight, size, bandHeight + 1);
  });
  // Soft horizontal blur to blend the hard band edges into gradients.
  ctx.filter = "blur(6px)";
  ctx.drawImage(canvas, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

// A tall vertical strip with a soft multi-color gradient (the classic
// green/cyan/violet aurora palette) — stretched thin and tiled sideways
// to build the curtain, rather than one huge texture.
function createAuroraTexture() {
  const w = 64, h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(120,255,180,0)");
  grad.addColorStop(0.25, "rgba(120,255,180,0.55)");
  grad.addColorStop(0.55, "rgba(140,220,255,0.4)");
  grad.addColorStop(0.8, "rgba(190,140,255,0.25)");
  grad.addColorStop(1, "rgba(190,140,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  return new THREE.CanvasTexture(canvas);
}

// A short bright streak fading to nothing at one end — a shooting star's
// whole visible lifetime is just this drawn once and moved fast.
function createStreakTexture() {
  const w = 256, h = 16;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.85, "rgba(255,255,255,0.85)");
  grad.addColorStop(1, "rgba(255,255,255,1)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, h * 0.3, w, h * 0.4);
  return new THREE.CanvasTexture(canvas);
}

function createBody(scene, glowTexture, map, coreRadius, glowColor, glowRadius, glowOpacity) {
  const group = new THREE.Group();

  const coreMat = new THREE.MeshBasicMaterial({ map, fog: false, transparent: true });
  const core = new THREE.Mesh(new THREE.SphereGeometry(coreRadius, 20, 20), coreMat);
  group.add(core);

  const glowMat = new THREE.SpriteMaterial({
    map: glowTexture, color: glowColor, transparent: true, opacity: glowOpacity, fog: false,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(glowRadius * 2);
  group.add(glow);

  scene.add(group);
  return { group, core, glow, baseGlowOpacity: glowOpacity };
}

// A large inverted sphere with a vertical vertex-color gradient — replaces
// the old flat scene.background color. Recomputed every frame (cheap:
// ~500 vertices) since the gradient's two colors shift with the cycle.
// A permanent fixture of the sky — unlike the sun/moon it doesn't cycle
// with day/night, it's just always out there (fading only with fog/haze
// like anything distant would), which is what actually sells "this is a
// different sky" rather than "Earth's moon reskinned."
function createDistantPlanet(scene) {
  const mat = new THREE.MeshBasicMaterial({ map: createDistantPlanetTexture(), fog: true, transparent: true, opacity: 0.85 });
  const core = new THREE.Mesh(new THREE.SphereGeometry(26, 20, 20), mat);
  core.position.set(-420, 180, -520);
  core.rotation.z = 0.4;
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xd9b48a, transparent: true, opacity: 0.35, side: THREE.DoubleSide, fog: true, depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(34, 46, 48), ringMat);
  ring.rotation.x = Math.PI / 2.4;
  core.add(ring);
  scene.add(core);
  return { core, driftSeed: Math.random() * Math.PI * 2 };
}

// A handful of tall vertical strips clustered together and given a slow
// horizontal wave, rather than one flat plane — real auroras ripple
// unevenly along their length, a single static strip would read as a
// green banner, not a curtain of light.
function createAurora(scene) {
  const texture = createAuroraTexture();
  const group = new THREE.Group();
  const stripCount = getGraphicsSettings().auroraStrips;
  const strips = [];
  for (let i = 0; i < stripCount; i++) {
    const mat = new THREE.SpriteMaterial({
      map: texture, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(30, 160, 1);
    sprite.position.set((i - stripCount / 2) * 22, 260, -400);
    group.add(sprite);
    strips.push({ sprite, seed: Math.random() * Math.PI * 2 });
  }
  scene.add(group);
  return { group, strips };
}

// Shooting stars are a small pool of reusable streaks rather than
// spawning/destroying objects — one is "inactive" (parked, invisible)
// until its turn, then animates across a chord of sky and goes back to
// waiting. Avoids any create/dispose churn for something this frequent.
function createShootingStars(scene) {
  const texture = createStreakTexture();
  const pool = [];
  const poolSize = getGraphicsSettings().shootingStarPoolSize;
  for (let i = 0; i < poolSize; i++) {
    const mat = new THREE.SpriteMaterial({
      map: texture, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false, rotation: 0,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(40, 3, 1);
    scene.add(sprite);
    pool.push({ sprite, active: false, life: 0, duration: 0, start: new THREE.Vector3(), end: new THREE.Vector3() });
  }
  return { pool, timer: randRangeLocal(4, 12) };
}
function randRangeLocal(min, max) { return min + Math.random() * (max - min); }

function createSkyDome(scene) {
  const [widthSeg, heightSeg] = getGraphicsSettings().skyDomeSegments;
  const geo = new THREE.SphereGeometry(SKY_DOME_RADIUS, widthSeg, heightSeg);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  return { mesh, posAttr: geo.attributes.position, colorAttr: geo.attributes.color };
}

// A handful of bold, discrete bands instead of one smooth continuous
// gradient — the reference's sky is 3-4 confident stripes (deep red ->
// orange -> cream), not a soft blend. Same posterize-with-a-seam-line
// technique terrain.js's HEIGHT_PALETTE already uses, applied here to the
// horizon->zenith gradient instead of a height gradient.
const SKY_BANDS = 4;
function bandedSkyColor(t, horizonColor, zenithColor, out) {
  const scaled = THREE.MathUtils.clamp(t, 0, 1) * SKY_BANDS;
  const idx = Math.min(SKY_BANDS - 1, Math.floor(scaled));
  const bandT = SKY_BANDS > 1 ? idx / (SKY_BANDS - 1) : 0; // evenly-spaced representative t for this band, not the raw continuous t
  out.copy(horizonColor).lerp(zenithColor, bandT);
  const localT = scaled - idx;
  const nearLowerSeam = localT < 0.06 && idx > 0;
  const nearUpperSeam = localT > 0.94 && idx < SKY_BANDS - 1;
  if (nearLowerSeam || nearUpperSeam) out.multiplyScalar(0.82); // subtler than terrain's rock-strata seams — this is sky, not stone
  return out;
}

function updateSkyDome(sky, zenithColor, horizonColor, elapsed) {
  const { posAttr, colorAttr } = sky;
  const tmp = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
    const yFrac = y / SKY_DOME_RADIUS; // -1 (bottom) to 1 (top)
    // Concentrates the gradient near the horizon band rather than
    // spreading it evenly top-to-bottom — real skies change fastest right
    // at the horizon, not uniformly toward the zenith.
    const t = THREE.MathUtils.clamp((yFrac + 0.1) / 0.45, 0, 1);
    bandedSkyColor(t, horizonColor, zenithColor, tmp);

    // Jagged dark streaks cutting across the bands — the reference's
    // cloud/ridge silhouettes. Low frequency around the dome's longitude
    // (broad streaks, not vertical stripes) combined with a higher
    // frequency in latitude for jagged rather than perfectly smooth
    // edges. Slow elapsed-based drift in the longitude coordinate so they
    // creep across the sky like real cloud bands instead of being welded
    // to fixed positions forever.
    const angle = Math.atan2(z, x);
    const streak = skyNoise2D(angle * 2.4 + elapsed * 0.006, yFrac * 7 + 100);
    if (streak > 0.58) {
      const s = Math.min(1, (streak - 0.58) / 0.35);
      tmp.multiplyScalar(1 - s * 0.42);
    }

    tmp.toArray(colorAttr.array, i * 3);
  }
  colorAttr.needsUpdate = true;
}

/**
 * @param {THREE.Scene} scene
 * @param {THREE.DirectionalLight} sun
 * @param {THREE.AmbientLight} ambient
 * @param {THREE.Points} starfield
 * @param {string} [biome]  optional — enables the per-biome sky tint (BIOME_SKY_TINT above). Falls back to the plain shared sky if omitted, so this stays a non-breaking addition for any existing call site not yet passing it.
 */
function createDayNightCycle(scene, sun, ambient, starfield, biome) {
  const glowTexture = createGlowTexture();
  const sunBody = createBody(scene, glowTexture, createSunTexture(), 14, 0xffcf80, 40, 0.6);
  const moonBody = createBody(scene, glowTexture, createMoonTexture(), 9, 0xaebedd, 22, 0.32);
  const sunBeams = createSunBeams(scene, createBeamTexture());
  const sky = createSkyDome(scene);
  const distantPlanet = createDistantPlanet(scene);
  const aurora = createAurora(scene);
  const shootingStars = createShootingStars(scene);
  return {
    scene, sun, ambient, starfield, sunBody, moonBody, sunBeams, sky,
    distantPlanet, aurora, shootingStars, elapsed: 0, biome,
  };
}

function updateDayNightCycle(cycle, dt) {
  cycle.elapsed += dt;
  const t = (cycle.elapsed % CYCLE_SECONDS) / CYCLE_SECONDS;
  const phaseAngle = t * Math.PI * 2;

  const sunOrbit = orbitPosition(phaseAngle);
  const moonOrbit = orbitPosition(phaseAngle + Math.PI);
  const elevation = sunOrbit.elevation;

  // The light itself never dips far below the horizon — keeps shadow math
  // sane through the "night" portion instead of pointing straight up from
  // underneath — but the visible sun disc follows its true position so it
  // actually sets/rises instead of hovering at the horizon all night.
  cycle.sun.position.set(sunOrbit.x, Math.max(sunOrbit.y, -20), 80);
  cycle.sunBody.group.position.set(sunOrbit.x, sunOrbit.y, 80);
  cycle.moonBody.group.position.set(moonOrbit.x, moonOrbit.y, 80);
  cycle.sunBeams.group.position.set(sunOrbit.x, sunOrbit.y, 80);

  // Blend NIGHT -> DAWN_DUSK -> DAY -> DAWN_DUSK -> NIGHT across elevation.
  const dayAmount = Math.max(0, elevation);       // 0 at/below horizon, 1 at noon
  let sunColor, ambientColor, fogColor, skyZenith, skyHorizon, sunIntensity, ambientIntensity;
  if (elevation <= 0) {
    // night -> dawn/dusk as the sun approaches the horizon from below
    const k = Math.max(0, 1 - Math.abs(elevation) / 0.35);
    sunColor = lerpColor(NIGHT.sun, DAWN_DUSK.sun, k);
    ambientColor = lerpColor(NIGHT.ambient, DAWN_DUSK.ambient, k);
    fogColor = lerpColor(NIGHT.fog, DAWN_DUSK.fog, k);
    skyZenith = lerpColor(NIGHT.skyZenith, DAWN_DUSK.skyZenith, k);
    skyHorizon = lerpColor(NIGHT.skyHorizon, DAWN_DUSK.skyHorizon, k);
    sunIntensity = THREE.MathUtils.lerp(NIGHT.sunIntensity, DAWN_DUSK.sunIntensity, k);
    ambientIntensity = THREE.MathUtils.lerp(NIGHT.ambientIntensity, DAWN_DUSK.ambientIntensity, k);
  } else {
    // dawn/dusk -> day as the sun climbs, using the same dayAmount blend
    const k = Math.min(1, dayAmount / 0.35);
    sunColor = lerpColor(DAWN_DUSK.sun, DAY.sun, k);
    ambientColor = lerpColor(DAWN_DUSK.ambient, DAY.ambient, k);
    fogColor = lerpColor(DAWN_DUSK.fog, DAY.fog, k);
    skyZenith = lerpColor(DAWN_DUSK.skyZenith, DAY.skyZenith, k);
    skyHorizon = lerpColor(DAWN_DUSK.skyHorizon, DAY.skyHorizon, k);
    sunIntensity = THREE.MathUtils.lerp(DAWN_DUSK.sunIntensity, DAY.sunIntensity, k);
    ambientIntensity = THREE.MathUtils.lerp(DAWN_DUSK.ambientIntensity, DAY.ambientIntensity, k);
  }

  cycle.sun.color.copy(sunColor);
  cycle.sun.intensity = sunIntensity;
  cycle.ambient.color.copy(ambientColor);
  cycle.ambient.intensity = ambientIntensity;

  // Per-biome push, layered on top of the shared day/night blend above —
  // see BIOME_SKY_TINT's comment for why this is a small lerp rather than
  // an outright color swap.
  const tint = BIOME_SKY_TINT[cycle.biome];
  if (tint) {
    skyZenith = lerpColor(skyZenith, tint.zenith, tint.amount);
    skyHorizon = lerpColor(skyHorizon, tint.horizon, tint.amount);
    fogColor = lerpColor(fogColor, tint.fog, tint.amount);
  }

  cycle.scene.fog.color.copy(fogColor);
  updateSkyDome(cycle.sky, skyZenith, skyHorizon, cycle.elapsed);

  // Each body fades out once it's below the horizon rather than just
  // disappearing at exactly elevation=0, so setting/rising reads as a
  // smooth fade rather than a pop.
  const sunVisibility = THREE.MathUtils.clamp(0.5 + sunOrbit.elevation / 0.3, 0, 1);
  const moonVisibility = THREE.MathUtils.clamp(0.5 + moonOrbit.elevation / 0.3, 0, 1);
  cycle.sunBody.core.material.opacity = sunVisibility;
  cycle.sunBody.glow.material.opacity = cycle.sunBody.baseGlowOpacity * sunVisibility;
  cycle.moonBody.core.material.opacity = moonVisibility;
  cycle.moonBody.glow.material.opacity = cycle.moonBody.baseGlowOpacity * moonVisibility;

  // Rays peak just above the horizon (the classic crepuscular-ray moment)
  // and taper off toward both full night and flat overhead noon light,
  // rather than being equally strong all day.
  const beamEmphasis = Math.max(0, 1 - Math.abs(sunOrbit.elevation - 0.25) / 0.5);
  const beamOpacity = sunVisibility * beamEmphasis * 0.32;
  for (const sprite of cycle.sunBeams.sprites) sprite.material.opacity = beamOpacity;

  // Stars fade in as the sun drops toward/below the horizon, fully hidden
  // by mid-morning.
  if (cycle.starfield) {
    cycle.starfield.material.opacity = THREE.MathUtils.clamp(1 - dayAmount / 0.25, 0, 1);
  }

  // The distant planet barely moves — a slow, tiny drift and spin is
  // enough to read as "real" without it visibly crossing the sky the way
  // the sun/moon do. It's a fixture, not a light source.
  cycle.distantPlanet.core.rotation.y += dt * 0.01;
  cycle.distantPlanet.core.position.x += Math.sin(cycle.elapsed * 0.01 + cycle.distantPlanet.driftSeed) * dt * 0.03;

  // Aurora only shows at night, brightening as full darkness sets in, and
  // each strip ripples on its own offset so the curtain shimmers unevenly
  // along its length rather than pulsing as one flat sheet.
  const auroraVisibility = THREE.MathUtils.clamp(1 - dayAmount / 0.15, 0, 1);
  for (const strip of cycle.aurora.strips) {
    const shimmer = 0.4 + 0.6 * Math.max(0, Math.sin(cycle.elapsed * 0.35 + strip.seed));
    strip.sprite.material.opacity = auroraVisibility * shimmer * 0.5;
    strip.sprite.position.x += Math.sin(cycle.elapsed * 0.15 + strip.seed) * dt * 0.4;
  }

  // Shooting stars: a pool of reusable streaks, one spawned at a time on a
  // random timer, only during actual night — arcs across a random chord
  // of sky and fades out over its short lifetime.
  cycle.shootingStars.timer -= dt;
  if (dayAmount < 0.05 && cycle.shootingStars.timer <= 0) {
    const idle = cycle.shootingStars.pool.find((s) => !s.active);
    if (idle) {
      idle.active = true;
      idle.life = 0;
      idle.duration = 0.5 + Math.random() * 0.4;
      const startX = (Math.random() - 0.5) * 500, startY = 200 + Math.random() * 200;
      idle.start.set(startX, startY, -300 - Math.random() * 200);
      idle.end.set(startX + 200 + Math.random() * 150, startY - 150 - Math.random() * 100, idle.start.z);
      const dx = idle.end.x - idle.start.x, dy = idle.end.y - idle.start.y;
      idle.sprite.material.rotation = Math.atan2(dy, dx);
    }
    cycle.shootingStars.timer = randRangeLocal(5, 18);
  }
  for (const s of cycle.shootingStars.pool) {
    if (!s.active) continue;
    s.life += dt;
    const k = s.life / s.duration;
    if (k >= 1) { s.active = false; s.sprite.material.opacity = 0; continue; }
    s.sprite.position.lerpVectors(s.start, s.end, k);
    s.sprite.material.opacity = Math.sin(k * Math.PI); // fades in, peaks mid-flight, fades out — not a hard cut at either end
  }

  return { t, dayAmount, skyZenith };
}

export { createDayNightCycle, updateDayNightCycle, CYCLE_SECONDS };
