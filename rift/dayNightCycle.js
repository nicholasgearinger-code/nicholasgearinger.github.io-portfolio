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
  sun: 0x22304a, sunIntensity: 0.05, ambient: 0x1a2438, ambientIntensity: 0.13,
  skyZenith: 0x05070f, skyHorizon: 0x141a2c,
};
const DAWN_DUSK = {
  sun: 0xff7a3a, sunIntensity: 0.75, ambient: 0x4a3550, ambientIntensity: 0.45,
  skyZenith: 0x2a2138, skyHorizon: 0xff6a42,
};
const DAY = {
  sun: 0xfff4e0, sunIntensity: 2.0, ambient: 0x8899bb, ambientIntensity: 0.5,
  skyZenith: 0x1c3a5e, skyHorizon: 0x8fb8d6,
};

// The sun's own visual disc/glow color at three stages — zenith (high,
// small, near-white), mid-elevation (golden), and right at the horizon
// (deep orange-red) — per the explicit reference photo showing a real
// sun's progression through the day, not just the ambient lighting
// color shifting. Separate from NIGHT/DAWN_DUSK/DAY above, which govern
// the scene's actual light color; these three govern only how the sun
// itself looks in the sky.
const SUN_BODY_ZENITH = new THREE.Color(0xfff8ec);
const SUN_BODY_MID = new THREE.Color(0xffcf7a);
const SUN_BODY_HORIZON = new THREE.Color(0xff5522);

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
  ember: { zenith: 0x2e2620, horizon: 0xff6a30, amount: 0.5 },
  verdant: { zenith: 0x0a2a34, horizon: 0x6fd0d8, amount: 0.10 },
  crystal: { zenith: 0x0a3a4a, horizon: 0x3ce7d8, amount: 0.16 }, // bright tropical turquoise, replacing the old cool violet resonance-spire tint — amount bumped slightly (was 0.12) since the whole biome is now underwater and should read as consistently blue-green rather than a subtle accent
  abyssal: { zenith: 0x140a1e, horizon: 0x5a2a6a, amount: 0.14 },
  ashen: { zenith: 0x2a2210, horizon: 0xd8b878, amount: 0.10 },
  // Frost gets a high amount for the same reason Ember does — a biome
  // locked in constant blizzard shouldn't read as a normal sky at any
  // time of day either. Pale, desaturated ice-blue/white throughout
  // (zenith/horizon close together in hue) rather than a distinct
  // horizon glow, since the defining atmosphere here is a wall of
  // driving snow, not a light source near the ground the way Ember's
  // lava-glow horizon is.
  frost: { zenith: 0x9fc8dc, horizon: 0xdcf0fa, amount: 0.42 },
};

// A much stronger, Verdant-only sky shift that only kicks in as true
// night falls — layered on top of the subtle all-day BIOME_SKY_TINT
// above, which alone isn't enough to complement the indigo/violet ground
// and pink/blue/purple glowing creatures once night actually crushes down.
// Daytime sky is unaffected (window gates this to the same kind of
// night-only activation curve BIOME_NIGHT_DARKEN already uses).
const VERDANT_NIGHT_SKY = { zenith: 0x2a0a3a, horizon: 0x7a1f7a, maxAmount: 0.55, window: 0.35 };

// How much darker a biome's night gets, on top of the shared NIGHT preset
// above — 1 = no change (the default for any biome not listed). Ember gets
// crushed down hard: a biome lit mainly by its own fire/lava/embers at
// night shouldn't have the same ambient moonlit brightness as anywhere
// else — the only light should genuinely feel like it's coming from the
// glow sources themselves (fires/embers/lava/faint moon), not a
// generically-lit night sky. Only affects true night (see the elevation-
// based fade in updateDayNightCycle below) — dawn/day stay normal.
const BIOME_NIGHT_DARKEN = {
  ember: { factor: 0.35, window: 0.15 },
  verdant: { factor: 0.008, window: 0.4 }, // pushed even further per explicit follow-up request — near-total darkness, engaging over an even wider window before true midnight
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

// A real radiating starburst — long bright spikes fanning out from a
// soft core, not just a plain round glow. Sun-specific (the moon keeps
// the shared createGlowTexture above) — this is what actually reads as
// "sun" the way a lens-flare photo does, rather than "any bright circle
// in the sky," which was the actual complaint: the sun and moon looked
// too similar/close in character, not just position.
function createSunStarburstTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cx = size / 2, cy = size / 2;
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.28);
  coreGrad.addColorStop(0, "rgba(255,255,255,1)");
  coreGrad.addColorStop(0.5, "rgba(255,255,255,0.55)");
  coreGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = coreGrad;
  ctx.fillRect(0, 0, size, size);
  const spikeCount = 12;
  for (let i = 0; i < spikeCount; i++) {
    const angle = (i / spikeCount) * Math.PI * 2;
    const isLong = i % 2 === 0; // alternating long/short spikes, not a uniform starburst
    const length = size * (isLong ? 0.5 : 0.34);
    const halfWidth = size * (isLong ? 0.05 : 0.035);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    const grad = ctx.createLinearGradient(0, 0, length, 0);
    grad.addColorStop(0, "rgba(255,255,255,0.9)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -halfWidth);
    ctx.lineTo(length, 0);
    ctx.lineTo(0, halfWidth);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
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
  return { group, core, glow, baseGlowOpacity: glowOpacity, baseGlowScale: glowRadius * 2, baseGlowColor: new THREE.Color(glowColor) };
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
function updateSkyDome(sky, zenithColor, horizonColor, elapsed, sunDir) {
  const { posAttr, colorAttr } = sky;
  const tmp = new THREE.Color();
  const glowColor = new THREE.Color(0xfff3d6);
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
    const yFrac = y / SKY_DOME_RADIUS; // -1 (bottom) to 1 (top)
    // Concentrates the gradient near the horizon band rather than
    // spreading it evenly top-to-bottom — real skies change fastest right
    // at the horizon (more atmosphere traversed at a grazing angle), not
    // uniformly toward the zenith. Smooth continuous lerp — no discrete
    // stepping — so the sky reads as one real gradient responding to the
    // sun/atmosphere rather than flat color regions with a seam between
    // them.
    const t = THREE.MathUtils.clamp((yFrac + 0.1) / 0.45, 0, 1);
    tmp.copy(horizonColor).lerp(zenithColor, t);

    // Jagged dark streaks cutting across the bands — the reference's
    // cloud/ridge silhouettes. Low frequency around the dome's longitude
    // (broad streaks, not vertical stripes) combined with a higher
    // frequency in latitude for jagged rather than perfectly smooth
    // edges. Slow drift so they creep across the sky like real cloud
    // bands instead of being welded to fixed positions forever.
    //
    // The longitude coordinate is embedded as a point on a circle
    // (cos/sin of the angle) rather than the angle itself — sampling
    // noise directly from atan2(z, x) has a hard discontinuity exactly
    // where atan2 wraps from +PI to -PI (the negative-X meridian), and
    // skyNoise2D isn't periodic across that jump, so a visible seam
    // showed up at that one fixed line in the sky — the single "corner"
    // a sphere's azimuth always has exactly one of. A circle has no such
    // jump: going all the way around returns smoothly to the exact same
    // point, so there's nothing left to show as a seam.
    const angle = Math.atan2(z, x);
    const streakFreq = 2.4; // same density the old angle*2.4 multiplier targeted
    const driftedAngle = angle + elapsed * 0.0025; // drift folded in before the circular embedding — 0.0025*streakFreq reproduces the old elapsed*0.006 drift rate in noise-space
    const circleX = Math.cos(driftedAngle) * streakFreq;
    const circleZ = Math.sin(driftedAngle) * streakFreq;
    const streak = skyNoise2D(circleX, circleZ + yFrac * 7 + 100);
    if (streak > 0.58) {
      const s = Math.min(1, (streak - 0.58) / 0.35);
      tmp.multiplyScalar(1 - s * 0.42);
    }

    // Real sun-centered glow — the sky is genuinely brightest right
    // around the sun's own position and fades outward from there, not
    // just banded by height regardless of where the sun actually is.
    // dot-product closeness to the real sun direction (not a fixed
    // "near the horizon" assumption), so the glow visibly moves with
    // the sun across the whole sky, including up near the zenith at
    // midday.
    if (sunDir) {
      const len = Math.hypot(x, y, z) || 1;
      const closeness = (x / len) * sunDir.x + (y / len) * sunDir.y + (z / len) * sunDir.z; // -1..1
      const glow = Math.pow(Math.max(0, closeness), 5) * 0.85; // sharp falloff — a real glow concentrates near the sun, not a broad wash across the whole sky
      if (glow > 0.001) tmp.lerp(glowColor, Math.min(1, glow));
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
  const sunStarburstTexture = createSunStarburstTexture();
  // Sun bigger, warmer, and noticeably more radiant than the moon (was
  // 14/40/0.6 vs 9/22/0.32 — pushed further apart) — the sun should read
  // as the dominant light source at a glance, not just via the actual
  // DirectionalLight intensity numbers below.
  const sunBody = createBody(scene, sunStarburstTexture, createSunTexture(), 15, 0xffcf80, 62, 0.8);
  const moonBody = createBody(scene, glowTexture, createMoonTexture(), 8, 0xaebedd, 18, 0.22);
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
  let sunColor, ambientColor, skyZenith, skyHorizon, sunIntensity, ambientIntensity;
  if (elevation <= 0) {
    // night -> dawn/dusk as the sun approaches the horizon from below.
    // Widened from 0.35 to 0.4 — sunrise/sunset should read as a real
    // occasion the player can actually watch happen, not a blink-and-
    // miss-it blend.
    const k = Math.max(0, 1 - Math.abs(elevation) / 0.4);
    sunColor = lerpColor(NIGHT.sun, DAWN_DUSK.sun, k);
    ambientColor = lerpColor(NIGHT.ambient, DAWN_DUSK.ambient, k);
    skyZenith = lerpColor(NIGHT.skyZenith, DAWN_DUSK.skyZenith, k);
    skyHorizon = lerpColor(NIGHT.skyHorizon, DAWN_DUSK.skyHorizon, k);
    sunIntensity = THREE.MathUtils.lerp(NIGHT.sunIntensity, DAWN_DUSK.sunIntensity, k);
    ambientIntensity = THREE.MathUtils.lerp(NIGHT.ambientIntensity, DAWN_DUSK.ambientIntensity, k);
  } else {
    // dawn/dusk -> day as the sun climbs, using the same widened window.
    const k = Math.min(1, dayAmount / 0.4);
    sunColor = lerpColor(DAWN_DUSK.sun, DAY.sun, k);
    ambientColor = lerpColor(DAWN_DUSK.ambient, DAY.ambient, k);
    skyZenith = lerpColor(DAWN_DUSK.skyZenith, DAY.skyZenith, k);
    skyHorizon = lerpColor(DAWN_DUSK.skyHorizon, DAY.skyHorizon, k);
    sunIntensity = THREE.MathUtils.lerp(DAWN_DUSK.sunIntensity, DAY.sunIntensity, k);
    ambientIntensity = THREE.MathUtils.lerp(DAWN_DUSK.ambientIntensity, DAY.ambientIntensity, k);
  }

  cycle.sun.color.copy(sunColor);
  cycle.sun.intensity = sunIntensity;
  cycle.ambient.color.copy(ambientColor);
  cycle.ambient.intensity = ambientIntensity;

  // Per-biome night darkening — fades in as dayAmount drops toward true
  // night and back out toward dawn, so only actual nighttime gets crushed
  // down, never dawn/day.
  const nightDarken = BIOME_NIGHT_DARKEN[cycle.biome];
  if (nightDarken !== undefined) {
    const darkenAmount = THREE.MathUtils.clamp(1 - dayAmount / nightDarken.window, 0, 1);
    const factor = THREE.MathUtils.lerp(1, nightDarken.factor, darkenAmount);
    cycle.sun.intensity *= factor;
    cycle.ambient.intensity *= factor;
  }

  // Per-biome push, layered on top of the shared day/night blend above —
  // see BIOME_SKY_TINT's comment for why this is a small lerp rather than
  // an outright color swap.
  const tint = BIOME_SKY_TINT[cycle.biome];
  if (tint) {
    skyZenith = lerpColor(skyZenith, tint.zenith, tint.amount);
    skyHorizon = lerpColor(skyHorizon, tint.horizon, tint.amount);
  }
  if (cycle.biome === "verdant") {
    const nightSkyAmount = THREE.MathUtils.clamp(1 - dayAmount / VERDANT_NIGHT_SKY.window, 0, 1) * VERDANT_NIGHT_SKY.maxAmount;
    skyZenith = lerpColor(skyZenith, VERDANT_NIGHT_SKY.zenith, nightSkyAmount);
    skyHorizon = lerpColor(skyHorizon, VERDANT_NIGHT_SKY.horizon, nightSkyAmount);
  }

  // The fog is now just the sky dome's own final horizon color, not a
  // separately-tuned value — the two used to be tracked independently
  // and could drift apart (DAWN_DUSK's fog was a muted purple while its
  // horizon was a vivid orange), which showed up as a visible seam right
  // where distant terrain fades into fog and meets the sky dome's own
  // bottom edge. Copying skyHorizon directly makes them identical by
  // construction — nothing left to mismatch.
  cycle.scene.fog.color.copy(skyHorizon);
  const sunDirLen = Math.hypot(sunOrbit.x, sunOrbit.y, 80) || 1;
  const sunDirForSky = { x: sunOrbit.x / sunDirLen, y: sunOrbit.y / sunDirLen, z: 80 / sunDirLen };
  updateSkyDome(cycle.sky, skyZenith, skyHorizon, cycle.elapsed, sunDirForSky);

  // Each body fades out once it's below the horizon rather than just
  // disappearing at exactly elevation=0, so setting/rising reads as a
  // smooth fade rather than a pop.
  const sunVisibility = THREE.MathUtils.clamp(0.5 + sunOrbit.elevation / 0.3, 0, 1);
  const moonVisibility = THREE.MathUtils.clamp(0.5 + moonOrbit.elevation / 0.3, 0, 1);
  cycle.sunBody.core.material.opacity = sunVisibility;
  cycle.sunBody.glow.material.opacity = cycle.sunBody.baseGlowOpacity * sunVisibility;
  cycle.moonBody.core.material.opacity = moonVisibility;
  cycle.moonBody.glow.material.opacity = cycle.moonBody.baseGlowOpacity * moonVisibility;

  // The sun's own visual disc and glow — not just the directional
  // light's color — shift through the day too, per the explicit
  // reference photo: high and small and near-white at zenith, swelling
  // into a bigger, hazier, deep orange-red disc near the horizon (real
  // atmospheric reddening/refraction, exaggerated here for a dramatic
  // sunrise/sunset rather than a uniform disc all day). horizonCloseness
  // is 0 by a moderate elevation, ramping to 1 right at the horizon.
  // Two-stage lerp (zenith->gold->horizon-red) for a richer progression
  // than a single flat blend, matching the reference's many visible
  // in-between stages rather than just two extremes.
  const horizonCloseness = THREE.MathUtils.clamp(1 - Math.abs(sunOrbit.elevation) / 0.55, 0, 1);
  const sunBodyTint = horizonCloseness < 0.5
    ? SUN_BODY_ZENITH.clone().lerp(SUN_BODY_MID, horizonCloseness * 2)
    : SUN_BODY_MID.clone().lerp(SUN_BODY_HORIZON, (horizonCloseness - 0.5) * 2);
  cycle.sunBody.core.material.color.copy(sunBodyTint);
  cycle.sunBody.glow.material.color.copy(sunBodyTint);
  const sunSizeBoost = 1 + horizonCloseness * 0.7;
  cycle.sunBody.core.scale.setScalar(sunSizeBoost);
  cycle.sunBody.glow.scale.setScalar(cycle.sunBody.baseGlowScale * sunSizeBoost * (1 + horizonCloseness * 0.5)); // glow spreads out (hazier) a bit more than the core disc itself grows

  // Rays peak just above the horizon (the classic crepuscular-ray moment)
  // and taper off toward both full night and flat overhead noon light,
  // rather than being equally strong all day.
  const beamEmphasis = Math.max(0, 1 - Math.abs(sunOrbit.elevation - 0.25) / 0.5);
  const beamOpacity = sunVisibility * beamEmphasis * 0.42; // was 0.32 — a real sunrise/sunset should have visibly dramatic rays, not a faint hint
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
  // along its length rather than pulsing as one flat sheet. Frost gets a
  // real vividness boost on top of the shared 0.5 cap every other biome
  // uses — real arctic auroras are famously vivid, and this is the one
  // biome where a strong aurora is the actual thing being depicted, not
  // just atmospheric background dressing.
  const auroraVisibility = THREE.MathUtils.clamp(1 - dayAmount / 0.15, 0, 1);
  const auroraBoost = cycle.biome === "frost" ? 1.7 : 1;
  for (const strip of cycle.aurora.strips) {
    const shimmer = 0.4 + 0.6 * Math.max(0, Math.sin(cycle.elapsed * 0.35 + strip.seed));
    strip.sprite.material.opacity = auroraVisibility * shimmer * 0.5 * auroraBoost;
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

  return { t, dayAmount, skyZenith, skyHorizon };
}

export { createDayNightCycle, updateDayNightCycle, CYCLE_SECONDS };
