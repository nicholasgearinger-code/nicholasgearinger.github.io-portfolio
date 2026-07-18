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
    color: 0xcfe0f0, size: 0.35, transparent: true, opacity: 0,
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

  return {
    scene, biome, profile, lightningLight, rain,
    windAngle: Math.random() * Math.PI * 2,
    lightningTimer: randRange(profile.lightning.intervalMin, profile.lightning.intervalMax),
    lightningFlash: 0,
    rainActive: false,
    rainTimer: profile.rain ? randRange(2, profile.rainCycleMin) : Infinity, // first rain shouldn't take the full cycle to arrive
    rainIntensity: 0,
    elapsed: 0,
  };
}

function updateWeatherSystem(handle, dt) {
  if (!handle) return { windX: 0, windZ: 0, windStrength: 0 };
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

  return { windX, windZ, windStrength };
}

function disposeWeatherSystem(scene, handle) {
  if (!handle) return;
  scene.remove(handle.lightningLight);
  if (handle.rain) {
    scene.remove(handle.rain.points);
    handle.rain.points.geometry.dispose();
    handle.rain.points.material.dispose();
  }
}

export { createWeatherSystem, updateWeatherSystem, disposeWeatherSystem };
