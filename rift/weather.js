import * as THREE from "three";

// -----------------------------------------------------------------------------
// SWAP POINT: dynamic weather, one profile per biome. Wind is computed here
// and handed back to the caller each frame — vegetation.js and
// atmosphericParticles.js both read it to bias their own motion, rather
// than each having a separate, uncoordinated idea of "windy." Fog density
// and lightning are applied directly to the scene/lights here since
// nothing else needs to read those. Swap WEATHER_PROFILE for a different
// mood/pacing per biome without touching how any of it gets driven.
// -----------------------------------------------------------------------------

const WEATHER_PROFILE = {
  ember: {
    baseFogDensity: 0.0032, fogPulseAmp: 0.0012, fogPulseSpeed: 0.15,
    windBaseStrength: 1.2, windVariance: 0.8, windSpeed: 0.06,
    rain: false,
    lightning: { color: 0xff7a2a, intervalMin: 8, intervalMax: 16, height: 70 }, // volcanic "dirty thunderstorm" static discharge through the ash
  },
  verdant: {
    baseFogDensity: 0.0026, fogPulseAmp: 0.0018, fogPulseSpeed: 0.1,
    windBaseStrength: 0.8, windVariance: 0.6, windSpeed: 0.05,
    rain: true, rainCycleMin: 30, rainCycleMax: 55, rainDurationMin: 15, rainDurationMax: 28,
    lightning: { color: 0xcfe0ff, intervalMin: 6, intervalMax: 14, height: 90, onlyDuringRain: true }, // an ordinary thunderstorm — the one biome where lightning actually means rain
  },
  crystal: {
    baseFogDensity: 0.0016, fogPulseAmp: 0.001, fogPulseSpeed: 0.08, // lowered again (was 0.0022) — the reference photo has near-total visibility straight to the sand, the lowest of any biome by a clear margin
    windBaseStrength: 0.35, windVariance: 0.3, windSpeed: 0.03, // repurposed as gentle current strength, driving kelp sway rather than air movement
    rain: false,
    lightning: { color: 0x3ce7ff, intervalMin: 14, intervalMax: 26, height: 20, dim: true }, // no real lightning underwater — a soft, muted pulse of bioluminescent light from deep in the reef, kept dim and lower to the ground than every other biome's actual storm discharge
  },
  abyssal: {
    baseFogDensity: 0.0038, fogPulseAmp: 0.0022, fogPulseSpeed: 0.06,
    windBaseStrength: 0.3, windVariance: 0.3, windSpeed: 0.03,
    rain: false,
    lightning: { color: 0x7a5fd0, intervalMin: 9, intervalMax: 18, height: 30, dim: true }, // an eerie flicker, not a dramatic strike — something down in the chasms, never explained
  },
  ashen: {
    baseFogDensity: 0.0034, fogPulseAmp: 0.002, fogPulseSpeed: 0.2,
    windBaseStrength: 1.6, windVariance: 1.0, windSpeed: 0.08,
    rain: false,
    lightning: { color: 0xd9a15c, intervalMin: 12, intervalMax: 24, height: 60 }, // dry lightning — the real meteorological phenomenon, storms with no rain reaching a parched ground
  },
  frost: {
    baseFogDensity: 0.0052, fogPulseAmp: 0.0016, fogPulseSpeed: 0.22, // highest base density of any biome — a blizzard means genuinely poor visibility, not just atmosphere
    windBaseStrength: 3.6, windVariance: 2.2, windSpeed: 0.16, // pushed further per explicit "harsh winds" request — already the strongest of any biome, now more so
    rain: false, // precipitation here is the always-on blizzardSnow system (see createBlizzardSnow), not the cycling rain system every other precipitation biome uses
    lightning: { color: 0xdcf4ff, intervalMin: 14, intervalMax: 26, height: 50, dim: true }, // thundersnow — a real, if rare, phenomenon; pale ice-white and muted rather than a dramatic strike
  },
};

function randRange(min, max) { return min + Math.random() * (max - min); }

let sharedFlashTexture = null;
function getFlashTexture() {
  if (sharedFlashTexture) return sharedFlashTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.5)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  sharedFlashTexture = new THREE.CanvasTexture(canvas);
  return sharedFlashTexture;
}

let sharedDustTexture = null;
function getDustTexture() {
  if (sharedDustTexture) return sharedDustTexture;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(216,199,166,0.9)");
  grad.addColorStop(1, "rgba(216,199,166,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  sharedDustTexture = new THREE.CanvasTexture(canvas);
  return sharedDustTexture;
}

// Neutral white-alpha (not pre-colored like getDustTexture above) so
// material.color actually tints it — same convention wildlife.js's
// getMoteTexture uses, for the same reason.
let sharedAshTexture = null;
function getAshTexture() {
  if (sharedAshTexture) return sharedAshTexture;
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,0.85)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  sharedAshTexture = new THREE.CanvasTexture(canvas);
  return sharedAshTexture;
}

let sharedSnowTexture = null;
function getSnowTexture() {
  if (sharedSnowTexture) return sharedSnowTexture;
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  sharedSnowTexture = new THREE.CanvasTexture(canvas);
  return sharedSnowTexture;
}

// Frost-only blizzard snow — always present at full density (this biome
// is defined by CONSTANT snow, not a cycling weather event the way
// Verdant's rain is), falling much slower than rain/ash so individual
// flakes are readable, with strong wind-driven horizontal drift added in
// the update loop below — a blizzard is defined by snow being driven
// sideways, not falling straight down.
function createBlizzardSnow(scene) {
  const count = 900;
  const positions = new Float32Array(count * 3);
  const fallSpeeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 220;
    positions[i * 3 + 1] = Math.random() * 60;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 220;
    fallSpeeds[i] = 6 + Math.random() * 4; // was 1.5-3.5 — much faster per explicit request, driving snow rather than gentle drift
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    map: getSnowTexture(), color: 0xffffff, size: 0.65, transparent: true, opacity: 0.85,
    depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  return { points, fallSpeeds };
}

// Ember-only ambient ash, always lightly present (not cyclic like rain —
// a biome full of smoke/fire should never read as clear-aired) and
// thickening further during an eruption (see the eruptBoost param on
// updateWeatherSystem). Falls much slower than rain — light drifting
// flecks, not droplets — and drifts sideways with the wind more than
// rain does since it's so light.
function createAshfall(scene) {
  const count = 260;
  const positions = new Float32Array(count * 3);
  const fallSpeeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 220;
    positions[i * 3 + 1] = Math.random() * 50;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 220;
    fallSpeeds[i] = 1.2 + Math.random() * 1.6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    map: getAshTexture(), color: 0x8a7a6a, size: 0.5, transparent: true, opacity: 0.28,
    depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  return { points, fallSpeeds };
}

// A painted leaf silhouette (not a round dot) — a simple pointed oval
// with a thin center vein, neutral white-alpha so material.color tints
// it the same way getAshTexture/getDustTexture do.
let sharedLeafTexture = null;
function getLeafTexture() {
  if (sharedLeafTexture) return sharedLeafTexture;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.ellipse(size / 2, size / 2, size * 0.42, size * 0.22, Math.PI / 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(size * 0.2, size * 0.8);
  ctx.lineTo(size * 0.8, size * 0.2);
  ctx.stroke();
  sharedLeafTexture = new THREE.CanvasTexture(canvas);
  return sharedLeafTexture;
}

// Verdant-only — a slow drift of falling leaves under the canopy, always
// lightly present (not cyclic like rain — a living forest constantly
// sheds a little, this isn't a weather event). Stays low (drifts down
// through/under the canopy rather than falling from high sky the way
// rain does) and flutters side-to-side per-particle as it falls, rather
// than just drifting straight with the wind the way ash does — leaves
// tumble, ash doesn't.
function createLeaffall(scene) {
  const count = 180;
  const positions = new Float32Array(count * 3);
  const fallSpeeds = new Float32Array(count);
  const driftSeeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 200;
    positions[i * 3 + 1] = Math.random() * 22;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
    fallSpeeds[i] = 0.5 + Math.random() * 0.7;
    driftSeeds[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    map: getLeafTexture(), color: 0x8fbf4a, size: 0.6, transparent: true, opacity: 0.75,
    depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  return { points, fallSpeeds, driftSeeds, elapsed: 0 };
}

// Verdant-only — a low scatter of soft glowing motes hovering just above
// the ground/undergrowth. Distinct from wildlife.js's firefly motes
// (those are creatures; this is ambient bioluminescence from the plants
// themselves) and from the leaffall particles above. Brightness is tied
// to how dark it actually is — near-invisible in daylight, glowing
// properly once night crushes the scene lighting down, so walking
// through the forest after dark reads as genuinely lit by the
// vegetation, not just by the moon.
let sharedGroundGlowTexture = null;
function getGroundGlowTexture() {
  if (sharedGroundGlowTexture) return sharedGroundGlowTexture;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  sharedGroundGlowTexture = new THREE.CanvasTexture(canvas);
  return sharedGroundGlowTexture;
}

function createGroundGlow(scene) {
  const count = 220;
  const basePositions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    basePositions[i * 3] = (Math.random() - 0.5) * 200;
    basePositions[i * 3 + 1] = 0.2 + Math.random() * 1.4; // low, close to the ground/undergrowth
    basePositions[i * 3 + 2] = (Math.random() - 0.5) * 200;
    seeds[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(basePositions.slice(), 3));
  const mat = new THREE.PointsMaterial({
    map: getGroundGlowTexture(), color: 0xd68fff, size: 1.0, transparent: true, opacity: 0, // was mint-green 0xa8ffcf
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  return { points, basePositions, seeds };
}

// Crystal-only — a brief shaft of sunlight piercing down through the
// water, as if a gap in the surface chop let a beam through for a
// moment. A real vertical light-shaft texture (bright warm-white core,
// fading to transparent at both ends along its length and softly toward
// its sides), not the old horizontal rainbow-hue sweep — this is a
// downward beam, not an arc.
let sharedSunbeamTexture = null;
function getSunbeamTexture() {
  if (sharedSunbeamTexture) return sharedSunbeamTexture;
  const w = 32, h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  const lengthGrad = ctx.createLinearGradient(0, 0, 0, h);
  lengthGrad.addColorStop(0, "rgba(255,255,255,0.9)");
  lengthGrad.addColorStop(0.55, "rgba(210,255,248,0.55)");
  lengthGrad.addColorStop(1, "rgba(180,255,240,0)");
  ctx.fillStyle = lengthGrad;
  ctx.fillRect(0, 0, w, h);
  // Fade the beam's own left/right edges so it reads as a soft shaft,
  // not a hard-edged bar.
  const edgeFade = ctx.createLinearGradient(0, 0, w, 0);
  edgeFade.addColorStop(0, "rgba(0,0,0,1)");
  edgeFade.addColorStop(0.5, "rgba(0,0,0,0)");
  edgeFade.addColorStop(1, "rgba(0,0,0,1)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = edgeFade;
  ctx.fillRect(0, 0, w, h);
  sharedSunbeamTexture = new THREE.CanvasTexture(canvas);
  return sharedSunbeamTexture;
}

function createCrystalRefraction(scene) {
  const mat = new THREE.SpriteMaterial({
    map: getSunbeamTexture(), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(5, 34, 1); // tall and narrow — a downward shaft, not the old wide horizontal arc
  scene.add(sprite);
  return { sprite, flash: 0, timer: randRange(8, 18) }; // fires more often than the old rainbow — a passing sunbeam should feel like a recurring reef mood, not a rare event
}

// Crystal-only — a persistent field of many thin light shafts, always at
// least faintly visible and each independently flickering, rather than
// the single occasional stronger flash above. This is what actually
// reads as "dappled sunlight" (the reference image's constant mosaic of
// moving light rays), distinct from crystalRefraction's rarer, brighter
// single passing beam layered on top of it. Reuses the same sunbeam
// texture — cheap, and keeps the whole light-shaft family visually
// consistent — just many more of them, fainter, always running.
function createCrystalDapple(scene) {
  const count = 12;
  const rays = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({
      map: getSunbeamTexture(), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const sprite = new THREE.Sprite(mat);
    const width = 3 + Math.random() * 4;
    const length = 22 + Math.random() * 16;
    sprite.scale.set(width, length, 1);
    const angle = Math.random() * Math.PI * 2, dist = Math.random() * 55;
    const baseX = Math.cos(angle) * dist, baseZ = Math.sin(angle) * dist;
    sprite.position.set(baseX, 4, baseZ);
    sprite.material.rotation = (Math.random() - 0.5) * 0.25;
    scene.add(sprite);
    rays.push({
      sprite, baseX, baseZ,
      baseOpacity: 0.12 + Math.random() * 0.16, // faint individually — it's the many overlapping rays that read as "dappled," not one bright shaft
      seed: Math.random() * Math.PI * 2,
      flickerSpeed: 0.4 + Math.random() * 0.7, // independent speeds so they don't pulse in unison
      swaySpeed: 0.15 + Math.random() * 0.15,
    });
  }
  return { rays };
}
function createDustDevil(scene) {
  const count = 40;
  const positions = new Float32Array(count * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    map: getDustTexture(), size: 1.1, transparent: true, opacity: 0,
    depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  return { points, count, active: false, life: 0, duration: 0, x: 0, z: 0, spin: 0 };
}

// A storm happening somewhere else entirely — a silent glow low on the
// horizon rather than another point light (something 300+ units away
// wouldn't meaningfully light the scene regardless), present in every
// biome as a shared sense of "the world is bigger than just here."
function createDistantLightning(scene) {
  const mat = new THREE.SpriteMaterial({
    map: getFlashTexture(), color: 0xdfe8ff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(90, 55, 1);
  scene.add(sprite);
  return { sprite, flash: 0, timer: randRange(15, 40) };
}

// A thin vertical streak, not a round dot — painted within a square
// canvas (points always render as camera-facing squares) so most of the
// square stays transparent except a narrow fading strip down the middle.
// This is the actual fix for rain reading as snow: a round point sprite
// falling through the air looks exactly like a snowflake regardless of
// fall speed, since points don't stretch with motion on their own.
let sharedRainStreakTexture = null;
function getRainStreakTexture() {
  if (sharedRainStreakTexture) return sharedRainStreakTexture;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.15, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.85, "rgba(255,255,255,0.85)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(size * 0.42, 0, size * 0.16, size);
  sharedRainStreakTexture = new THREE.CanvasTexture(canvas);
  return sharedRainStreakTexture;
}

function createRain(scene) {
  const count = 1400;
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 220;
    positions[i * 3 + 1] = Math.random() * 60;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 220;
    speeds[i] = 30 + Math.random() * 15;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    map: getRainStreakTexture(), color: 0xcfe0f0, size: 1.2, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  return { points, speeds };
}

/**
 * @param {THREE.Scene} scene
 * @param {string} biome
 */
function createWeatherSystem(scene, biome) {
  const profile = WEATHER_PROFILE[biome] || WEATHER_PROFILE.ember;

  const lightningLight = new THREE.PointLight(profile.lightning.color, 0, 400);
  lightningLight.position.set(0, profile.lightning.height, 0);
  scene.add(lightningLight);

  const rain = profile.rain ? createRain(scene) : null;
  const distantLightning = createDistantLightning(scene);
  const dustDevil = biome === "ashen" ? createDustDevil(scene) : null;
  const crystalRefraction = biome === "crystal" ? createCrystalRefraction(scene) : null;
  const crystalDapple = biome === "crystal" ? createCrystalDapple(scene) : null;
  const ashfall = biome === "ember" ? createAshfall(scene) : null;
  const leaffall = biome === "verdant" ? createLeaffall(scene) : null;
  const groundGlow = biome === "verdant" ? createGroundGlow(scene) : null;
  const blizzardSnow = biome === "frost" ? createBlizzardSnow(scene) : null;
  // Periodic whiteout — Frost only. A temporary event where visibility
  // drops to near-zero, distinct from (and much more extreme than) the
  // constant blizzard baseline already always running. Same timer-cycle
  // shape as crystalRefraction's periodic flash elsewhere in this file:
  // count down while inactive, trigger and run for a duration once the
  // timer hits zero, then reset the timer for the next one.
  const whiteout = biome === "frost" ? { timer: 20 + Math.random() * 25, active: false, remaining: 0 } : null;

  return {
    scene, biome, profile, lightningLight, rain, distantLightning, dustDevil, crystalRefraction, crystalDapple, ashfall, leaffall, groundGlow, blizzardSnow, whiteout,
    windAngle: Math.random() * Math.PI * 2,
    lightningTimer: randRange(profile.lightning.intervalMin, profile.lightning.intervalMax),
    lightningFlash: 0,
    rainActive: false,
    rainTimer: profile.rain ? randRange(2, profile.rainCycleMin) : Infinity, // first rain shouldn't take the full cycle to arrive
    rainIntensity: 0,
    dustDevilTimer: randRange(8, 20),
    elapsed: 0,
  };
}

function updateWeatherSystem(handle, dt, erupting = false, dayAmount = 0) {
  if (!handle) return { windX: 0, windZ: 0, windStrength: 0, rainIntensity: 0 };
  const { profile } = handle;
  handle.elapsed += dt;

  // Wind: a slowly rotating direction with a wandering strength, not a
  // fixed vector — reads as actual weather moving through rather than a
  // constant breeze.
  handle.windAngle += profile.windSpeed * dt;
  const windStrength = Math.max(0, profile.windBaseStrength + Math.sin(handle.elapsed * 0.13) * profile.windVariance);
  let windX = Math.cos(handle.windAngle) * windStrength;
  let windZ = Math.sin(handle.windAngle) * windStrength;

  // Fog breathes slowly around its base density, with a longer, gentler
  // wave than the visual "chop" elsewhere in the game — weather fronts are
  // slow, not jittery.
  const fogDensity = profile.baseFogDensity + Math.sin(handle.elapsed * profile.fogPulseSpeed) * profile.fogPulseAmp;

  // Periodic whiteout — Frost only. Cycles the timer/active/remaining
  // state set up in createWeatherSystem, then feeds a genuine visibility
  // collapse into the SAME fogDensity variable everything else here
  // already uses — reusing the existing mechanism rather than a separate
  // one, since fog density is already how this game controls how far
  // you can see. A smooth ease in/out (not an instant on/off) over the
  // first/last second of the event, so it builds and fades like a real
  // gust rather than snapping like a light switch.
  let whiteoutFogBoost = 0, whiteoutWindBoost = 0, whiteoutSnowBoost = 0;
  if (handle.whiteout) {
    const wo = handle.whiteout;
    if (!wo.active) {
      wo.timer -= dt;
      if (wo.timer <= 0) {
        wo.active = true;
        wo.remaining = 6 + Math.random() * 6; // whiteout lasts 6-12s
        wo.duration = wo.remaining;
      }
    } else {
      wo.remaining -= dt;
      const easeIn = Math.min(1, (wo.duration - wo.remaining) / 1); // ramps up over the first second
      const easeOut = Math.min(1, wo.remaining / 1); // ramps down over the last second
      const strength = Math.min(easeIn, easeOut);
      whiteoutFogBoost = strength;
      whiteoutWindBoost = strength;
      whiteoutSnowBoost = strength;
      if (wo.remaining <= 0) {
        wo.active = false;
        wo.timer = 25 + Math.random() * 30; // next whiteout in 25-55s
      }
    }
  }
  windX *= 1 + whiteoutWindBoost * 0.8;
  windZ *= 1 + whiteoutWindBoost * 0.8;
  handle.scene.fog.density = Math.max(0.0008, fogDensity + whiteoutFogBoost * 0.09); // +0.09 at full strength on top of frost's already-dense 0.0052 baseline is a genuine visibility collapse, not a subtle thickening

  // Rain: cycles on and off rather than raining constantly — dry stretches
  // make the wet ones register as weather instead of ambient background.
  if (profile.rain && handle.rain) {
    handle.rainTimer -= dt;
    if (!handle.rainActive && handle.rainTimer <= 0) {
      handle.rainActive = true;
      handle.rainTimer = randRange(profile.rainDurationMin, profile.rainDurationMax);
    } else if (handle.rainActive && handle.rainTimer <= 0) {
      handle.rainActive = false;
      handle.rainTimer = randRange(profile.rainCycleMin, profile.rainCycleMax);
    }
    const targetIntensity = handle.rainActive ? 1 : 0;
    handle.rainIntensity += (targetIntensity - handle.rainIntensity) * Math.min(1, dt * 0.6); // fades in/out over a few seconds rather than snapping
    handle.rain.points.material.opacity = handle.rainIntensity * 0.55;

    const posAttr = handle.rain.points.geometry.attributes.position;
    for (let i = 0; i < handle.rain.speeds.length; i++) {
      let y = posAttr.getY(i) - handle.rain.speeds[i] * dt * Math.max(0.15, handle.rainIntensity);
      if (y < 0) y = 60;
      posAttr.setY(i, y);
      // Rain drifts sideways with the wind instead of falling perfectly
      // straight down.
      posAttr.setX(i, posAttr.getX(i) + windX * dt * 0.4);
      posAttr.setZ(i, posAttr.getZ(i) + windZ * dt * 0.4);
    }
    posAttr.needsUpdate = true;
  }

  // Lightning: a biome-unique colored flash from a light positioned where
  // "the storm" is happening for that biome — quick spike, short decay.
  const lp = profile.lightning;
  const lightningEligible = !lp.onlyDuringRain || handle.rainActive;
  if (lightningEligible) {
    handle.lightningTimer -= dt;
    if (handle.lightningTimer <= 0) {
      handle.lightningFlash = 1;
      handle.lightningTimer = randRange(lp.intervalMin, lp.intervalMax);
    }
  }
  handle.lightningFlash = Math.max(0, handle.lightningFlash - dt * 2.5);
  const flashPeak = lp.dim ? 3 : 9;
  handle.lightningLight.intensity = handle.lightningFlash * handle.lightningFlash * flashPeak; // squared falloff — a sharp pop rather than a linear fade

  // Distant horizon lightning — its own independent timer, unrelated to
  // this biome's own weather, just something visible far off.
  const dl = handle.distantLightning;
  dl.timer -= dt;
  if (dl.timer <= 0) {
    dl.flash = 1;
    const angle = Math.random() * Math.PI * 2;
    dl.sprite.position.set(Math.cos(angle) * 480, 25 + Math.random() * 20, Math.sin(angle) * 480);
    dl.timer = randRange(15, 40);
  }
  dl.flash = Math.max(0, dl.flash - dt * 3);
  dl.sprite.material.opacity = dl.flash * dl.flash * 0.6;

  // Dust devils — Ashen only. Spawns at a random ground spot, spins up
  // dust in a rising spiral, drifts a little with the wind, then
  // dissipates.
  if (handle.dustDevil) {
    const dd = handle.dustDevil;
    handle.dustDevilTimer -= dt;
    if (!dd.active && handle.dustDevilTimer <= 0) {
      dd.active = true;
      dd.life = 0;
      dd.duration = 6 + Math.random() * 8;
      dd.x = (Math.random() - 0.5) * 140;
      dd.z = (Math.random() - 0.5) * 140;
      handle.dustDevilTimer = randRange(15, 35);
    }
    if (dd.active) {
      dd.life += dt;
      const k = dd.life / dd.duration;
      if (k >= 1) {
        dd.active = false;
        dd.points.material.opacity = 0;
      } else {
        dd.x += windX * dt * 0.5;
        dd.z += windZ * dt * 0.5;
        const posAttr = dd.points.geometry.attributes.position;
        for (let i = 0; i < dd.count; i++) {
          const t = i / dd.count;
          const spinAngle = handle.elapsed * 4 + t * Math.PI * 8;
          const radius = 0.5 + t * 2.5;
          posAttr.setX(i, dd.x + Math.cos(spinAngle) * radius);
          posAttr.setY(i, t * 9);
          posAttr.setZ(i, dd.z + Math.sin(spinAngle) * radius);
        }
        posAttr.needsUpdate = true;
        dd.points.material.opacity = Math.sin(k * Math.PI) * 0.5; // fades in, peaks mid-life, fades out
      }
    }
  }

  // Ambient ash — Ember only. Always lightly present, thickens further
  // during an eruption (erupting param, driven from main.js reading the
  // volcano's own eruption state).
  if (handle.ashfall) {
    const af = handle.ashfall;
    const posAttr = af.points.geometry.attributes.position;
    for (let i = 0; i < af.fallSpeeds.length; i++) {
      let y = posAttr.getY(i) - af.fallSpeeds[i] * dt;
      if (y < 0) y = 50;
      posAttr.setY(i, y);
      // Ash is light — it drifts sideways with the wind noticeably more
      // than rain does.
      posAttr.setX(i, posAttr.getX(i) + windX * dt * 0.6);
      posAttr.setZ(i, posAttr.getZ(i) + windZ * dt * 0.6);
    }
    posAttr.needsUpdate = true;
    const targetOpacity = erupting ? 0.68 : 0.28;
    af.points.material.opacity += (targetOpacity - af.points.material.opacity) * Math.min(1, dt * 0.8); // eases toward the new density rather than snapping when an eruption starts/ends
  }

  // Blizzard snow — Frost only, always active at full density (this
  // biome is defined by CONSTANT snow, not something that cycles on and
  // off). Falls much slower than rain/ash so individual flakes stay
  // readable, but drifts sideways with the wind FAR more aggressively
  // than ash's gentle 0.6 multiplier — a blizzard is fundamentally about
  // snow being driven horizontally, not falling straight down.
  if (handle.blizzardSnow) {
    const sf = handle.blizzardSnow;
    const posAttr = sf.points.geometry.attributes.position;
    for (let i = 0; i < sf.fallSpeeds.length; i++) {
      let y = posAttr.getY(i) - sf.fallSpeeds[i] * dt;
      if (y < 0) y = 60;
      posAttr.setY(i, y);
      posAttr.setX(i, posAttr.getX(i) + windX * dt * 2.2); // windX/windZ already include the whiteout wind boost applied earlier in this function
      posAttr.setZ(i, posAttr.getZ(i) + windZ * dt * 2.2);
    }
    posAttr.needsUpdate = true;
    // Larger, more opaque flakes during a whiteout — visually sells "so
    // much snow it's overwhelming" on top of the fog doing the actual
    // work of limiting visibility.
    sf.points.material.opacity = 0.85 + whiteoutSnowBoost * 0.15;
    sf.points.material.size = 0.65 + whiteoutSnowBoost * 0.55;
  }

  // Falling leaves — Verdant only. Flutters side-to-side per-particle as
  // it falls (not just wind-drift like ash) and stays low, drifting down
  // through/under the canopy rather than from high sky.
  if (handle.leaffall) {
    const lf = handle.leaffall;
    lf.elapsed += dt;
    const posAttr = lf.points.geometry.attributes.position;
    for (let i = 0; i < lf.fallSpeeds.length; i++) {
      let y = posAttr.getY(i) - lf.fallSpeeds[i] * dt;
      if (y < 0) y = 22;
      posAttr.setY(i, y);
      const flutter = Math.sin(lf.elapsed * 1.4 + lf.driftSeeds[i]) * 0.35;
      posAttr.setX(i, posAttr.getX(i) + (windX * 0.3 + flutter) * dt);
      posAttr.setZ(i, posAttr.getZ(i) + (windZ * 0.3 + flutter) * dt);
    }
    posAttr.needsUpdate = true;
  }

  if (handle.groundGlow) {
    const gg = handle.groundGlow;
    // 0 in full daylight, ramping up as it gets dark — near-invisible
    // until the scene's own lighting actually crushes down, then reads
    // as real ambient light coming from the forest floor itself.
    const nightAmount = Math.max(0, Math.min(1, 1 - dayAmount / 0.35));
    gg.points.material.opacity = nightAmount * (0.6 + 0.25 * (0.5 + 0.5 * Math.sin(handle.elapsed * 0.7)));
    const posAttr = gg.points.geometry.attributes.position;
    for (let i = 0; i < gg.seeds.length; i++) {
      const bx = gg.basePositions[i * 3], by = gg.basePositions[i * 3 + 1], bz = gg.basePositions[i * 3 + 2];
      const t = handle.elapsed * 0.6 + gg.seeds[i];
      posAttr.setXYZ(i, bx + Math.sin(t) * 0.4, by + Math.sin(t * 1.7) * 0.18, bz + Math.cos(t) * 0.4);
    }
    posAttr.needsUpdate = true;
  }

  // Crystal sunbeam — a shaft of light piercing down through the reef's
  // water column, as if a gap in the surface chop let it through for a
  // moment. Positioned to hang from near the water surface (LIQUID_LEVEL
  // is 8) down through the column, unlike the old rainbow's scattered
  // near-spire placement — and kept close to vertical (only a small
  // random tilt) rather than randomly rotated in-plane, since a real
  // sunbeam doesn't lie sideways.
  if (handle.crystalRefraction) {
    const cr = handle.crystalRefraction;
    cr.timer -= dt;
    if (cr.timer <= 0) {
      cr.flash = 1;
      const angle = Math.random() * Math.PI * 2, dist = 10 + Math.random() * 35;
      cr.sprite.position.set(Math.cos(angle) * dist, 5, Math.sin(angle) * dist);
      cr.sprite.material.rotation = (Math.random() - 0.5) * 0.3; // near-vertical, just a slight natural tilt
      cr.timer = randRange(8, 18);
    }
    cr.flash = Math.max(0, cr.flash - dt * 0.5); // lingers a couple seconds rather than a sharp lightning-style pop
    cr.sprite.material.opacity = Math.sin(Math.min(1, cr.flash) * Math.PI) * 0.5;
  }

  // Crystal dapple field — always-on light shafts, each independently
  // flickering and gently swaying, layered underneath the rarer stronger
  // sunbeam flash above. This is the constant "dappled sunlight" quality
  // the reef should have at all times, not an occasional event.
  if (handle.crystalDapple) {
    for (const ray of handle.crystalDapple.rays) {
      const flicker = 0.5 + 0.5 * Math.sin(handle.elapsed * ray.flickerSpeed + ray.seed);
      ray.sprite.material.opacity = ray.baseOpacity * (0.4 + 0.6 * flicker);
      const sway = Math.sin(handle.elapsed * ray.swaySpeed + ray.seed) * 2.5;
      ray.sprite.position.x = ray.baseX + sway;
      ray.sprite.position.z = ray.baseZ + Math.cos(handle.elapsed * ray.swaySpeed * 0.8 + ray.seed) * 2.5;
    }
  }

  return { windX, windZ, windStrength, rainIntensity: handle.rainIntensity };
}

function disposeWeatherSystem(scene, handle) {
  if (!handle) return;
  scene.remove(handle.lightningLight);
  if (handle.rain) {
    scene.remove(handle.rain.points);
    handle.rain.points.geometry.dispose();
    handle.rain.points.material.dispose();
  }
  if (handle.distantLightning) {
    scene.remove(handle.distantLightning.sprite);
    handle.distantLightning.sprite.material.dispose();
  }
  if (handle.dustDevil) {
    scene.remove(handle.dustDevil.points);
    handle.dustDevil.points.geometry.dispose();
    handle.dustDevil.points.material.dispose();
  }
  if (handle.crystalRefraction) {
    scene.remove(handle.crystalRefraction.sprite);
    handle.crystalRefraction.sprite.material.dispose();
  }
  if (handle.crystalDapple) {
    for (const ray of handle.crystalDapple.rays) {
      scene.remove(ray.sprite);
      ray.sprite.material.dispose();
    }
  }
  if (handle.ashfall) {
    scene.remove(handle.ashfall.points);
    handle.ashfall.points.geometry.dispose();
    handle.ashfall.points.material.dispose();
  }
  if (handle.leaffall) {
    scene.remove(handle.leaffall.points);
    handle.leaffall.points.geometry.dispose();
    handle.leaffall.points.material.dispose();
  }
  if (handle.groundGlow) {
    scene.remove(handle.groundGlow.points);
    handle.groundGlow.points.geometry.dispose();
    handle.groundGlow.points.material.dispose();
  }
  if (handle.blizzardSnow) {
    scene.remove(handle.blizzardSnow.points);
    handle.blizzardSnow.points.geometry.dispose();
    handle.blizzardSnow.points.material.dispose();
  }
}

export { createWeatherSystem, updateWeatherSystem, disposeWeatherSystem };
