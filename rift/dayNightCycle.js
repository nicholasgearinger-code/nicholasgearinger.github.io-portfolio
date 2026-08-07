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

const CYCLE_SECONDS = 900; // was 480 — slowed per explicit "slow down the day/night cycle" request (8min -> 15min per full cycle)
const ORBIT_RADIUS = 260;
const SKY_DOME_RADIUS = 900;
// Per explicit "dynamic shadows that change direction with the sun"
// request: the sun's real orbit (see orbitPosition below) previously only
// moved in a fixed vertical plane (X/Y varied, Z was hard-pinned to a
// single constant 80 everywhere it was used) — a real DirectionalLight,
// real shadow map, genuinely tied to elevation... but rising and setting
// along the exact same fixed compass line every cycle, so a shadow's
// LENGTH changed through the day while its DIRECTION barely did. This
// swings Z together with elevation (0 at sunrise/sunset, peaking at solar
// noon) so the sun traces a genuinely tilted daily arc instead of a flat
// line — like a real sun's path away from the equator — and shadows
// actually rotate through the day, not just stretch and shrink.
const AZIMUTH_SWING = 140;

// Color/intensity at each key point in the cycle, now including the sky's
// own zenith/horizon colors (previously the "sky" was just scene.fog's
// flat color reused as scene.background — a real gradient dome needs two
// colors, not one). Interpolated smoothly between neighbors by elevation,
// not a hard switch, so sunrise/sunset reads as its own moment.
const NIGHT = {
  sun: 0x22304a, sunIntensity: 0.05, ambient: 0x1a2438, ambientIntensity: 0.13,
  skyZenith: 0x05070f, skyMid: 0x0e1526, skyHorizon: 0x141a2c,
};
const DAWN_DUSK = {
  sun: 0xff7a3a, sunIntensity: 1.3, ambient: 0x4a3550, ambientIntensity: 0.4, // sunIntensity was 0.75, ambientIntensity 0.45 — the directional light was actually weaker than the flat ambient fill here, which works against surfaces (water, sand, everything) reading as strongly bathed in the warm directional color rather than just uniformly washed
  // A direct zenith->horizon lerp (dark purple -> vivid orange) lands on
  // a dull brick-red in the middle, mathematically, not the vivid pink
  // the real sky shows there — real skies aren't a 2-color blend, the
  // middle band genuinely is its own more saturated hue (light
  // scattering more at that particular angle), not just an average of
  // the two ends.
  skyZenith: 0x342420, skyMid: 0xe8823a, skyHorizon: 0xff4a1e, // was skyZenith:0x2a2138 (dark purple), skyMid:0xd6558a (vivid pink) — shifted to warm amber-brown/orange so the overall sunrise/sunset reads as orange, not pink/purple
};
const DAY = {
  // ambientIntensity reduced 0.5 -> 0.38 per explicit "shadows don't look
  // good enough" — a shadow is just "this point gets no contribution from
  // the sun," ambient light still fully illuminates it, so a strong flat
  // ambient fill directly washes out shadow contrast regardless of how
  // correctly the shadow itself is being cast/rendered. sunIntensity
  // (direct light) left untouched — this only widens the gap between lit
  // and shadowed areas, not brighten the whole scene further.
  sun: 0xfff4e0, sunIntensity: 2.0, ambient: 0x8899bb, ambientIntensity: 0.38,
  // Was a muted, fairly desaturated blue (0x1c3a5e/0x4f79a8/0x8fb8d6) —
  // deliberately soft/flat per an earlier "no dramatic noon" tuning pass.
  // Per explicit reference photo (a vivid deep-blue sky with a blazing
  // sun), pushed to a genuinely saturated azure across the whole
  // gradient instead — real clear-day skies away from any haze are this
  // vivid, not grayish.
  skyZenith: 0x1560c4, skyMid: 0x2f8fe0, skyHorizon: 0x6fc0f0,
};

// The GENERAL sky (scene.background's flat fallback color + the cloud
// dome's own uniform tint — see updateRealisticCloudDome in clouds.js)
// has no way to vary by direction, so blending it all the way to
// DAWN_DUSK's full saturated colors reads as "the entire sky changes
// color" during sunrise/sunset — per explicit "the whole sky doesn't
// need to change, mostly from where the sun is located" report. The
// sun's own disc/glow/beams ALREADY carry that full dramatic color
// locally (see sunBodyTint/horizonCloseness further down, unaffected by
// this) — real sunrises work the same way: dramatic color concentrated
// near the sun, the rest of the sky only mildly warmed. These muted
// constants replace DAWN_DUSK's sky-only fields (NOT sun/ambient/
// intensity, which still drive actual scene lighting and keep their
// full transition) wherever skyZenith/skyMid/skyHorizon get computed
// below. Zenith stays coolest (lowest damp — real zenith sky barely
// warms even at sunset), horizon keeps the most (a muted color band is
// still real), mid is in between.
const SKY_DAWN_DUSK_ZENITH = lerpColor(DAY.skyZenith, DAWN_DUSK.skyZenith, 0.22);
const SKY_DAWN_DUSK_MID = lerpColor(DAY.skyMid, DAWN_DUSK.skyMid, 0.32);
const SKY_DAWN_DUSK_HORIZON = lerpColor(DAY.skyHorizon, DAWN_DUSK.skyHorizon, 0.45);

// The sun's own visual disc/glow color at three stages — zenith (high,
// small, near-white), mid-elevation (golden), and right at the horizon
// (deep orange-red) — per the explicit reference photo showing a real
// sun's progression through the day, not just the ambient lighting
// color shifting. Separate from NIGHT/DAWN_DUSK/DAY above, which govern
// the scene's actual light color; these three govern only how the sun
// itself looks in the sky.
const SUN_BODY_ZENITH = new THREE.Color(0xffffff); // was 0xfff8ec — a pale cream still read as warm-tinted rather than genuinely bright white once past sunrise
const SUN_BODY_MID = new THREE.Color(0xffcf7a);
const SUN_BODY_HORIZON = new THREE.Color(0xff4415); // was 0xff5522 — pushed more toward a saturated bright reddish-orange per explicit request

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
    z: 80 + elevation * AZIMUTH_SWING, // was a hardcoded 80 everywhere this orbit gets used — see AZIMUTH_SWING's own comment above
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
  // Tight bright core — the small solid-looking center of the flare.
  // Tighter than the old version now that real linear spikes (below),
  // not scattered dust, carry the outward spread.
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.16);
  coreGrad.addColorStop(0, "rgba(255,255,255,1)");
  coreGrad.addColorStop(0.55, "rgba(255,255,255,0.55)");
  coreGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = coreGrad;
  ctx.fillRect(0, 0, size, size);

  // Real linear rays — a genuine photographic lens-flare star, not the
  // old scattered-dot corona (which read as sparkly dust rather than
  // spikes). Per an explicit reference photo: a small number of long,
  // thin, sharp rays radiating from a compact core. 8 spikes alternating
  // long/short (4 longer "primary" rays roughly cardinal, 4 shorter
  // ones between them) — the classic pattern real camera aperture
  // blades produce, rather than a perfectly uniform mechanical asterisk.
  const spikeCount = 8;
  for (let i = 0; i < spikeCount; i++) {
    const isPrimary = i % 2 === 0;
    const angle = (i / spikeCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.08;
    const length = (isPrimary ? size * 0.5 : size * 0.3) * (0.85 + Math.random() * 0.3);
    const halfWidth = (isPrimary ? 3.4 : 1.8) * (0.8 + Math.random() * 0.4);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    const grad = ctx.createLinearGradient(0, 0, length, 0);
    grad.addColorStop(0, "rgba(255,255,255,0.95)");
    grad.addColorStop(0.15, "rgba(255,255,255,0.7)");
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

  // Soften the spikes' hard vector-triangle edges into something that
  // reads as real light rather than flat shapes — same self-draw-back
  // blur trick already used elsewhere in this file (see
  // createDistantPlanetTexture).
  ctx.filter = "blur(1.5px)";
  ctx.drawImage(canvas, 0, 0);

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
  const cx = size / 2, cy = size / 2;
  // Pure overexposed disc — no surface granulation at all. Real direct
  // sunlight is far too bright to make out any surface detail; the old
  // mottled-patch texture read as an examinable surface, which is
  // exactly the opposite of "too bright to look at."
  // Neutral white, not warm-tinted — this texture's own baked color used
  // to carry cream/gold tones (#fff2cc, #ffe9a8) that showed through even
  // at zenith when the elevation-based tint above multiplies in pure
  // white, which is exactly why the sun still read orange high in the
  // sky. The time-of-day warmth now comes ONLY from sunBodyTint
  // multiplying this texture, not from this texture's own bake.
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.7, "#ffffff");
  grad.addColorStop(1, "#fffdf7");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// Pale, cratered surface for the moon — visibly different from the sun's
// warm turbulence rather than just a smaller, dimmer copy of it.
function createMoonTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fbfcff"; // was #dbe4f4 — a pale gray-blue read as a realistic rocky surface rather than a bright white moon
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 16; i++) { // was 45 — far too busy/noisy at the small size the moon actually renders at on screen
    const x = Math.random() * size, y = Math.random() * size, r = 4 + Math.random() * 10;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(140,150,175,0.22)"); // was 0.35 — softer still, so subtle craters don't undercut the brighter white base with too much gray contrast
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
  // Per explicit "stars and planet and moon are showing in front of the
  // background clouds" report — this (and the starfield/distant planet
  // below) had NO explicit renderOrder at all, defaulting to 0, while the
  // cloud dome explicitly uses -95/-100 (see clouds.js). Since these are
  // all meant to be the FARTHEST background layer — further out than the
  // clouds, not painted on top of them — -101 puts them behind every
  // cloud layer. This is consistent with (not a replacement for) the
  // existing cloud-occlusion opacity fade elsewhere in this file — that
  // still handles the "moon dims when clouds pass in front of it" look;
  // this fixes the separate, more basic problem of it drawing on top of
  // an opaque cloud bank entirely.
  core.renderOrder = -101;
  group.add(core);

  const glowMat = new THREE.SpriteMaterial({
    map: glowTexture, color: glowColor, transparent: true, opacity: glowOpacity, fog: false,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(glowRadius * 2);
  glow.renderOrder = -101;
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
  core.renderOrder = -101; // see createBody's own comment above — same "showing in front of clouds" fix
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xd9b48a, transparent: true, opacity: 0.35, side: THREE.DoubleSide, fog: true, depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(34, 46, 48), ringMat);
  ring.rotation.x = Math.PI / 2.4;
  ring.renderOrder = -101;
  core.add(ring);
  scene.add(core);
  return { core, driftSeed: Math.random() * Math.PI * 2 };
}

// Aurora removed entirely per explicit "remove the aurora" request — kept
// as a no-op returning null (rather than deleted) so the call site and the
// update loop's null-guard below don't need restructuring if it's ever
// wanted back. Skips building the texture/sprites/group altogether, not
// just hiding them, since there's no reason to pay for geometry nobody
// will see.
function createAurora(scene) {
  return null;
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
  // DISABLED — per explicit request: this vertex-colored gradient sphere
  // was conflicting with the newer photo-textured cloud dome
  // (clouds.js's createRealisticCloudDome) layered just inside it,
  // rather than the two reading as one coherent sky. Returns null;
  // updateSkyDome (called every frame from updateDayNightCycle) is now
  // null-guarded, same established pattern already used project-wide
  // for disabling a system without touching every call site (see
  // clouds.js's own createClouds/createCloudLayer). scene.background is
  // now set directly in main.js each frame instead, using the same
  // zenith/horizon colors this file already computes — a plain solid
  // color rather than this dome's rich per-vertex banding, but real
  // background coverage rather than the black voids that would show
  // through the cloud dome's partial-alpha gaps with nothing behind it
  // at all.
  return null;
}

// A handful of bold, discrete bands instead of one smooth continuous
// gradient — the reference's sky is 3-4 confident stripes (deep red ->
// orange -> cream), not a soft blend. Same posterize-with-a-seam-line
// technique terrain.js's HEIGHT_PALETTE already uses, applied here to the
// horizon->zenith gradient instead of a height gradient.
function updateSkyDome(sky, zenithColor, midColor, horizonColor, elapsed, sunDir) {
  if (!sky) return; // disabled — see createSkyDome
  const { posAttr, colorAttr } = sky;
  const tmp = new THREE.Color();
  const localHorizon = new THREE.Color();
  const localMid = new THREE.Color();
  // Was a fixed pale cream (0xfff3d6) at up to 85% blend strength right
  // near the sun — that washed the rich sunset gradient out to near-white
  // exactly where it should be most vivid. Now a brightened version of
  // the ACTUAL current horizon color (mostly toward white, but keeping
  // real hue), so the glow near the sun reads as a bright, saturated
  // version of the real sunset color instead of overpowering it with an
  // unrelated pale tone.
  const glowColor = horizonColor.clone().lerp(new THREE.Color(0xffffff), 0.12); // was 0.3 toward white — diluted the vivid orange too much right where it should be most intense
  // Genuinely desaturated (luminance-based grayscale, not "toward
  // zenithColor") versions of horizon/mid, computed once per frame
  // rather than per-vertex. Blending "muted, away from the sun" sky
  // toward zenithColor didn't actually read as neutral, because
  // zenithColor is itself a saturated dusk purple — so the "muted" sky
  // was still purple, just a different shade, which is exactly why the
  // colorful sunset looked like it was everywhere instead of concentrated
  // around the sun. A real luminance-only gray has no hue to leak.
  const horizonLum = horizonColor.r * 0.299 + horizonColor.g * 0.587 + horizonColor.b * 0.114;
  const mutedHorizon = new THREE.Color(horizonLum, horizonLum, horizonLum).lerp(horizonColor, 0.15);
  const midLum = midColor.r * 0.299 + midColor.g * 0.587 + midColor.b * 0.114;
  const mutedMid = new THREE.Color(midLum, midLum, midLum).lerp(midColor, 0.15);
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
    const yFrac = y / SKY_DOME_RADIUS; // -1 (bottom) to 1 (top)
    // Real sunset/sunrise color concentrates near the sun's own position
    // around the horizon — the far side of the sky reads much more
    // muted. Horizontal-only alignment (ignores height, that's handled
    // by yFrac/t below) between this vertex's direction and the sun's,
    // fairly wide so a real arc of sky around the sun lights up, not a
    // pinpoint, fading to fully muted well before the opposite horizon.
    let azimuthCloseness = 1;
    if (sunDir) {
      const vLen = Math.hypot(x, z) || 1;
      const sunLen = Math.hypot(sunDir.x, sunDir.z) || 1;
      const azAlign = (x / vLen) * (sunDir.x / sunLen) + (z / vLen) * (sunDir.z / sunLen); // -1..1 — reverted last round's negation; that was very likely the wrong diagnosis (the real bug was the zenith-muting issue fixed above, which alone was enough to make this look broken without the alignment itself being inverted)
      azimuthCloseness = THREE.MathUtils.clamp((azAlign + 0.3) / 1.3, 0, 1);
    }
    localHorizon.copy(mutedHorizon).lerp(horizonColor, azimuthCloseness);
    localMid.copy(mutedMid).lerp(midColor, azimuthCloseness);
    // Concentrates the gradient near the horizon band rather than
    // spreading it evenly top-to-bottom — real skies change fastest right
    // at the horizon (more atmosphere traversed at a grazing angle), not
    // uniformly toward the zenith. Smooth continuous lerp — no discrete
    // stepping — so the sky reads as one real gradient responding to the
    // sun/atmosphere rather than flat color regions with a seam between
    // them.
    const tLinear = THREE.MathUtils.clamp((yFrac + 0.1) / 0.45, 0, 1);
    // Non-linear ease (not just the linear tLinear) — the horizon color
    // should genuinely hold its full intensity longer right near the
    // actual edge and only then give way to mid/zenith, rather than
    // fading away at a constant rate the moment you look up even
    // slightly. pow > 1 shrinks small values further, so the eased t
    // stays closer to 0 (full horizon color) for longer before rising.
    const t = Math.pow(tLinear, 1.6);
    // Real 3-stop gradient (horizon -> mid -> zenith) instead of a direct
    // 2-color lerp — a straight lerp between DAWN_DUSK's dark purple
    // zenith and vivid orange horizon mathematically lands on a dull
    // brick-red in the middle; real skies (and this effect's own
    // reference photo) show a genuinely more saturated pink/magenta band
    // partway up, not just the midpoint average of the two ends.
    if (t < 0.5) {
      tmp.copy(localHorizon).lerp(localMid, t * 2);
    } else {
      tmp.copy(localMid).lerp(zenithColor, (t - 0.5) * 2);
    }

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
      const glow = Math.pow(Math.max(0, closeness), 2.2) * 0.75; // was 0.55 — a more intense, vibrant push right around the sun per explicit request
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
function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  const glowTexture = createGlowTexture();
  const sunStarburstTexture = createSunStarburstTexture();
  // Sun bigger, warmer, and noticeably more radiant than the moon (was
  // 14/40/0.6 vs 9/22/0.32 — pushed further apart) — the sun should read
  // as the dominant light source at a glance, not just via the actual
  // DirectionalLight intensity numbers below.
  const sunBody = createBody(scene, sunStarburstTexture, createSunTexture(), 9, 0xffcf80, 46, 0.6); // glow radius was 34/opacity 0.5 — enlarged for the bigger, softer halo the reference shows now that the texture itself is a smooth gradual falloff instead of a tight bright core with spikes
  const moonBody = createBody(scene, glowTexture, createMoonTexture(), 8, 0xaebedd, 18, 0.22);
  const sunBeams = createSunBeams(scene, createBeamTexture());
  const sky = createSkyDome(scene);
  const distantPlanet = createDistantPlanet(scene);
  const aurora = createAurora(scene);
  const shootingStars = createShootingStars(scene);
  return {
    scene, sun, ambient, starfield, sunBody, moonBody, sunBeams, sky, moonLight,
    distantPlanet, aurora, shootingStars, elapsed: 0, biome,
  };
}

function updateDayNightCycle(cycle, dt) {
  cycle.elapsed += dt;
  const t = (cycle.elapsed % CYCLE_SECONDS) / CYCLE_SECONDS;
  cycle.phaseT = t; // raw 0-1 position in the cycle — exposed for anything downstream that needs real time-of-day (e.g. clouds.js's mood-texture phase sequence), since dayAmount alone can't tell sunrise from sunset (both sit near dayAmount=0)
  const phaseAngle = t * Math.PI * 2;

  const sunOrbit = orbitPosition(phaseAngle);
  const moonOrbit = orbitPosition(phaseAngle + Math.PI);
  const elevation = sunOrbit.elevation;

  // The light itself never dips far below the horizon — keeps shadow math
  // sane through the "night" portion instead of pointing straight up from
  // underneath — but the visible sun disc follows its true position so it
  // actually sets/rises instead of hovering at the horizon all night.
  cycle.sun.position.set(sunOrbit.x, Math.max(sunOrbit.y, -20), sunOrbit.z);
  // SUN_VISUAL_HORIZON_OFFSET raises only the DRAWN disc/beams, not the
  // actual light (cycle.sun.position, just above — that stays tied to
  // the true elevation/orbit math so shadow angle and dayAmount/color
  // blending are unaffected). Without this, elevation=0 (true sunrise/
  // sunset) placed the visible disc at world Y=0 — below Coral Shallows'
  // own water level (LIQUID_LEVEL.crystal=8), which reads as the sun
  // rising up out of the ocean rather than appearing at the horizon line
  // itself, especially obvious now that a real flat horizon (the ocean
  // skirt, liquid.js) exists to compare it against. A modest constant
  // offset (not scaled per-biome) keeps this simple and reads correctly
  // across every biome's own roughly-ground-level horizon too.
  const SUN_VISUAL_HORIZON_OFFSET = 10;
  cycle.sunBody.group.position.set(sunOrbit.x, sunOrbit.y + SUN_VISUAL_HORIZON_OFFSET, sunOrbit.z);
  cycle.moonBody.group.position.set(moonOrbit.x, Math.max(moonOrbit.y, 55), moonOrbit.z); // floored well above the horizon — the moon fades via opacity below, it shouldn't also visually approach/set at the horizon like the sun does
  // The REAL moonlight (a genuine shadow-casting DirectionalLight, not the
  // decorative sprite above) — per explicit "shadows... during night"
  // request. Previously there was no light source at all once the sun set
  // (ambient light doesn't cast shadows), so night had no shadows by
  // construction, not as a bug in the shadow system itself. Uses the
  // moon's TRUE orbit position (same -20 floor style the real sun light
  // uses below, not the sprite's higher +55 floor — a shadow-casting
  // light doesn't need the same "never visually touches the horizon"
  // treatment the drawn sprite does) so its shadow angle genuinely tracks
  // where the moon actually is, same principle as the sun.
  if (cycle.moonLight) cycle.moonLight.position.set(moonOrbit.x, Math.max(moonOrbit.y, -20), moonOrbit.z);
  cycle.sunBeams.group.position.set(sunOrbit.x, sunOrbit.y + SUN_VISUAL_HORIZON_OFFSET, sunOrbit.z);

  // Blend NIGHT -> DAWN_DUSK -> DAY -> DAWN_DUSK -> NIGHT across elevation.
  const dayAmount = Math.max(0, elevation);       // 0 at/below horizon, 1 at noon
  let sunColor, ambientColor, skyZenith, skyMid, skyHorizon, sunIntensity, ambientIntensity;
  if (elevation <= 0) {
    // night -> dawn/dusk as the sun approaches the horizon from below.
    // Widened from 0.35 to 0.4 — sunrise/sunset should read as a real
    // occasion the player can actually watch happen, not a blink-and-
    // miss-it blend.
    const k = Math.max(0, 1 - Math.abs(elevation) / 0.4);
    sunColor = lerpColor(NIGHT.sun, DAWN_DUSK.sun, k);
    ambientColor = lerpColor(NIGHT.ambient, DAWN_DUSK.ambient, k);
    skyZenith = lerpColor(NIGHT.skyZenith, SKY_DAWN_DUSK_ZENITH, k);
    skyMid = lerpColor(NIGHT.skyMid, SKY_DAWN_DUSK_MID, k);
    skyHorizon = lerpColor(NIGHT.skyHorizon, SKY_DAWN_DUSK_HORIZON, k);
    sunIntensity = THREE.MathUtils.lerp(NIGHT.sunIntensity, DAWN_DUSK.sunIntensity, k);
    ambientIntensity = THREE.MathUtils.lerp(NIGHT.ambientIntensity, DAWN_DUSK.ambientIntensity, k);
  } else {
    // dawn/dusk -> day as the sun climbs, using the same widened window.
    const k = Math.min(1, dayAmount / 0.4);
    sunColor = lerpColor(DAWN_DUSK.sun, DAY.sun, k);
    ambientColor = lerpColor(DAWN_DUSK.ambient, DAY.ambient, k);
    skyZenith = lerpColor(SKY_DAWN_DUSK_ZENITH, DAY.skyZenith, k);
    skyMid = lerpColor(SKY_DAWN_DUSK_MID, DAY.skyMid, k);
    skyHorizon = lerpColor(SKY_DAWN_DUSK_HORIZON, DAY.skyHorizon, k);
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
    // Was a flat amount applied at all times, including full night —
    // that's exactly why the horizon kept a bright, persistent glow band
    // instead of the sky actually going dark. Faded down substantially
    // (not to zero — a faint hint of the biome's identity is fine) as
    // dayAmount drops toward night.
    const effectiveTintAmount = tint.amount * (0.12 + dayAmount * 0.88);
    skyZenith = lerpColor(skyZenith, tint.zenith, effectiveTintAmount);
    skyHorizon = lerpColor(skyHorizon, tint.horizon, effectiveTintAmount);
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
  const sunDirLen = Math.hypot(sunOrbit.x, sunOrbit.y, sunOrbit.z) || 1;
  const sunDirForSky = { x: sunOrbit.x / sunDirLen, y: sunOrbit.y / sunDirLen, z: sunOrbit.z / sunDirLen };
  updateSkyDome(cycle.sky, skyZenith, skyMid, skyHorizon, cycle.elapsed, sunDirForSky);

  // Each body fades out once it's below the horizon rather than just
  // disappearing at exactly elevation=0, so setting/rising reads as a
  // smooth fade rather than a pop.
  const sunVisibility = THREE.MathUtils.clamp(0.5 + sunOrbit.elevation / 0.3, 0, 1);
  // Was tied to the moon's OWN orbital elevation, the same way the sun
  // is — meaning the moon had to complete its own downward arc and
  // "set" below the horizon before disappearing, just like a second sun.
  // Real moons don't do that: they just fade into the brightening sky as
  // the sun comes up, regardless of where the moon itself currently sits.
  // BUG FIX: was keyed off dayAmount (= Math.max(0, elevation)), which
  // sits at exactly 0 through the entire dawn twilight — the sky was
  // already visibly brightening/coloring while elevation was still
  // negative, but the moon stayed at full 1.0 visibility that whole time
  // and only started fading once the sun had literally cleared the
  // horizon — reading as "bright moon still up at sunrise," exactly the
  // reported bug. Now keyed off raw elevation directly, so the fade
  // starts during dawn twilight (elevation still negative, well before
  // the sun crosses the horizon) and is nearly complete by the time the
  // sun actually rises, not just beginning then.
  const moonFadeT = THREE.MathUtils.clamp((elevation - (-0.2)) / 0.25, 0, 1); // 0 at elevation=-0.2 (dawn twilight starts), 1 at elevation=0.05 (just after sunrise)
  const moonVisibility = (1 - moonFadeT) * 0.92 + 0.08; // floored at a faint 0.08 rather than fading all the way to invisible — "fade until a very faint blue-gray" once the sun is up, not disappear entirely

  cycle.sunBody.core.material.opacity = sunVisibility;
  cycle.sunBody.glow.material.opacity = cycle.sunBody.baseGlowOpacity * sunVisibility;
  cycle.moonBody.core.material.opacity = moonVisibility;
  cycle.moonBody.glow.material.opacity = cycle.moonBody.baseGlowOpacity * moonVisibility; // reverted — no longer scaled by phase illumination, see the phase-system removal above
  // Real moonlight intensity — dim (peak 0.22 vs the sun's own much
  // higher peak below) so this reads as a subtle real light source, not
  // a second sun. Gated on the MOON's own elevation (moonOrbit.elevation,
  // not the sun's) so it's genuinely 0 whenever the moon itself is below
  // the horizon — most of the day, when the moon sits on the opposite
  // side of the same orbit — and additionally scaled by the same
  // moonVisibility fade the sprite already uses, so the light can never
  // disagree with how visible the moon currently looks (both faded ==
  // both dim, never one bright while the other's invisible).
  if (cycle.moonLight) {
    const moonAboveHorizon = Math.max(0, moonOrbit.elevation);
    // Boosted 0.22 -> 0.4 per explicit "we should see shadows even at
    // night too" — the previous peak was tuned as "a subtle real light,
    // not a second sun," but subtle enough that its shadow likely wasn't
    // reading as clearly present at all. Still well under the sun's own
    // peak (2.0), so night stays visually distinct from day — just a
    // shadow that's actually legible now, not merely technically present.
    cycle.moonLight.intensity = moonAboveHorizon * moonVisibility * 0.4;
  }

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
  const horizonCloseness = THREE.MathUtils.clamp(1 - Math.abs(sunOrbit.elevation) / 0.05, 0, 1); // was /0.16 — still visibly warm-tinted well above the horizon per screenshot; per explicit request the sun should read white almost as soon as it clears the horizon line, not fade gradually over a wide band
  // How close the sun is to true zenith (straight overhead) — 0 through
  // the lower/mid sky, ramping to 1 only in roughly the top quarter of
  // its arc. Per an explicit reference photo (a small, blazing,
  // hard-edged sun with sharp lens-flare spikes against a deep saturated
  // sky), noon should be ITS OWN dramatic moment, not the flattest part
  // of the day — this is a separate boost from horizonCloseness (which
  // only fires right at sunrise/sunset) so the two don't fight each
  // other.
  const zenithBlaze = THREE.MathUtils.clamp((sunOrbit.elevation - 0.55) / 0.4, 0, 1);
  const sunBodyTint = horizonCloseness < 0.5
    ? SUN_BODY_ZENITH.clone().lerp(SUN_BODY_MID, horizonCloseness * 2)
    : SUN_BODY_MID.clone().lerp(SUN_BODY_HORIZON, (horizonCloseness - 0.5) * 2);
  cycle.sunBody.core.material.color.copy(sunBodyTint);
  cycle.sunBody.glow.material.color.copy(sunBodyTint);
  const sunSizeBoost = 1 + horizonCloseness * 0.3 + zenithBlaze * 0.25; // was *0.7 — with a smaller base size now, color is the primary sunset signal, not the sun ballooning in size
  cycle.sunBody.core.scale.setScalar(sunSizeBoost);
  cycle.sunBody.glow.scale.setScalar(cycle.sunBody.baseGlowScale * sunSizeBoost * (1 + horizonCloseness * 0.15 + zenithBlaze * 0.35));
  // Glow OPACITY also gets a genuine noon boost, not just scale — a
  // bigger sprite at the same opacity just looks like a soft blur, not
  // an overexposed blazing point-source the way the reference reads.
  // Multiplied in on top of the existing sunVisibility opacity set just
  // above.
  cycle.sunBody.glow.material.opacity = Math.min(1, cycle.sunBody.glow.material.opacity * (1 + zenithBlaze * 0.55));

  // Rays peak just above the horizon (the classic crepuscular-ray moment)
  // and taper off toward both full night and flat overhead noon light,
  // rather than being equally strong all day.
  const beamEmphasis = Math.max(0, 1 - Math.abs(sunOrbit.elevation - 0.25) / 0.5);
  const beamOpacity = sunVisibility * beamEmphasis * 0.015; // was 0.06 — still clearly visible after three rounds of reduction; the reference this is matching shows zero ray shafts, going much closer to fully off
  for (const sprite of cycle.sunBeams.sprites) {
    sprite.material.opacity = beamOpacity;
    // Was a fixed pale yellow (0xffdfa0) at all times — beams never
    // actually reflected the real sunset/sunrise color, which is a real
    // part of why the light read as flat yellow-white instead of the
    // rich orange/red the sky itself shows. Same tint the sun's own
    // body uses, so the rays genuinely match the light source they're
    // supposed to be coming from.
    sprite.material.color.copy(sunBodyTint);
  }

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
  if (cycle.aurora) {
    for (const strip of cycle.aurora.strips) {
      const shimmer = 0.4 + 0.6 * Math.max(0, Math.sin(cycle.elapsed * 0.35 + strip.seed));
      strip.sprite.material.opacity = auroraVisibility * shimmer * 0.5 * auroraBoost;
      strip.sprite.position.x += Math.sin(cycle.elapsed * 0.15 + strip.seed) * dt * 0.4;
    }
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
