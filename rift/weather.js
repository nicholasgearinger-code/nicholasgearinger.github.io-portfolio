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
    baseFogDensity: 0.003, fogPulseAmp: 0.0015, fogPulseSpeed: 0.08,
    windBaseStrength: 0.5, windVariance: 0.4, windSpeed: 0.04,
    rain: false,
    lightning: { color: 0x8ff0ff, intervalMin: 10, intervalMax: 20, height: 55 }, // sharp crystalline resonance discharge between the spires
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

// Crystal-only — a brief rainbow arc, as if light caught one of the
// spires just right for a moment. A real rainbow texture (hue sweep
// across the strip), not a single tinted glow.
let sharedRainbowTexture = null;
function getRainbowTexture() {
  if (sharedRainbowTexture) return sharedRainbowTexture;
  const w = 256, h = 32;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  const hues = [0, 40, 90, 170, 220, 270, 320];
  hues.forEach((hue, i) => grad.addColorStop(i / (hues.length - 1), `hsla(${hue},85%,65%,0.8)`));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // Fade the strip's own top/bottom edges so it reads as an arc slice,
  // not a hard-edged bar.
  const fade = ctx.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0, "rgba(0,0,0,1)");
  fade.addColorStop(0.5, "rgba(0,0,0,0)");
  fade.addColorStop(1, "rgba(0,0,0,1)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
  sharedRainbowTexture = new THREE.CanvasTexture(canvas);
  return sharedRainbowTexture;
}

function createCrystalRefraction(scene) {
  const mat = new THREE.SpriteMaterial({
    map: getRainbowTexture(), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(26, 4, 1);
  scene.add(sprite);
  return { sprite, flash: 0, timer: randRange(10, 25) };
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
  const ashfall = biome === "ember" ? createAshfall(scene) : null;
  const leaffall = biome === "verdant" ? createLeaffall(scene) : null;

  return {
    scene, biome, profile, lightningLight, rain, distantLightning, dustDevil, crystalRefraction, ashfall, leaffall,
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

function updateWeatherSystem(handle, dt, erupting = false) {
  if (!handle) return { windX: 0, windZ: 0, windStrength: 0, rainIntensity: 0 };
  const { profile } = handle;
  handle.elapsed += dt;

  // Wind: a slowly rotating direction with a wandering strength, not a
  // fixed vector — reads as actual weather moving through rather than a
  // constant breeze.
  handle.windAngle += profile.windSpeed * dt;
  const windStrength = Math.max(0, profile.windBaseStrength + Math.sin(handle.elapsed * 0.13) * profile.windVariance);
  const windX = Math.cos(handle.windAngle) * windStrength;
  const windZ = Math.sin(handle.windAngle) * windStrength;

  // Fog breathes slowly around its base density, with a longer, gentler
  // wave than the visual "chop" elsewhere in the game — weather fronts are
  // slow, not jittery.
  const fogDensity = profile.baseFogDensity + Math.sin(handle.elapsed * profile.fogPulseSpeed) * profile.fogPulseAmp;
  handle.scene.fog.density = Math.max(0.0008, fogDensity);

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

  // Crystal light refraction — Crystal Spire only. A brief rainbow arc
  // near one of the spires, as if the light caught it just right.
  if (handle.crystalRefraction) {
    const cr = handle.crystalRefraction;
    cr.timer -= dt;
    if (cr.timer <= 0) {
      cr.flash = 1;
      const angle = Math.random() * Math.PI * 2, dist = 15 + Math.random() * 30;
      cr.sprite.position.set(Math.cos(angle) * dist, 6 + Math.random() * 8, Math.sin(angle) * dist);
      cr.sprite.material.rotation = Math.random() * Math.PI * 2;
      cr.timer = randRange(10, 25);
    }
    cr.flash = Math.max(0, cr.flash - dt * 0.6); // lingers a couple seconds rather than a sharp lightning-style pop
    cr.sprite.material.opacity = Math.sin(Math.min(1, cr.flash) * Math.PI) * 0.55;
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
}

export { createWeatherSystem, updateWeatherSystem, disposeWeatherSystem };
