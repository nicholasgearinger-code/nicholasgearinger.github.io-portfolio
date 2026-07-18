import * as THREE from "three";

// -----------------------------------------------------------------------------
// SWAP POINT: the entire day/night cycle — sun position, sun/ambient color
// and intensity, fog/background tint, and starfield opacity are all driven
// from one `t` value (0..1, where 0 = midnight, 0.5 = noon) so everything
// stays in sync automatically. Swap CYCLE_SECONDS for a different pace, or
// the color stops in COLOR_STOPS for a different mood, without touching
// how any of it gets applied.
// -----------------------------------------------------------------------------

const CYCLE_SECONDS = 480; // one full day/night cycle — long enough not to be distracting, short enough to actually see it move in a session
const SUN_ORBIT_RADIUS = 260;

// Color/intensity at each key point in the cycle. Interpolated smoothly
// between neighbors by elevation, not just a hard day/night switch, so
// sunrise/sunset actually reads as its own moment rather than a snap cut.
const NIGHT = { sun: 0x22304a, sunIntensity: 0.12, ambient: 0x1a2438, ambientIntensity: 0.32, fog: 0x0a0e14 };
const DAWN_DUSK = { sun: 0xff9d5c, sunIntensity: 0.75, ambient: 0x4a3550, ambientIntensity: 0.45, fog: 0x2a1f2e };
const DAY = { sun: 0xfff4e0, sunIntensity: 1.15, ambient: 0x8899bb, ambientIntensity: 0.65, fog: 0x1c2436 };

function lerpColor(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}

/**
 * @param {THREE.Scene} scene
 * @param {THREE.DirectionalLight} sun
 * @param {THREE.AmbientLight} ambient
 * @param {THREE.Points} starfield
 */
function createDayNightCycle(scene, sun, ambient, starfield) {
  return { scene, sun, ambient, starfield, elapsed: 0 };
}

function updateDayNightCycle(cycle, dt) {
  cycle.elapsed += dt;
  const t = (cycle.elapsed % CYCLE_SECONDS) / CYCLE_SECONDS;
  const phaseAngle = t * Math.PI * 2;

  // Sun orbits in a fixed vertical arc — elevation is what actually drives
  // every color/intensity below, position is just where it's drawn from.
  const elevation = Math.sin(phaseAngle - Math.PI / 2); // -1 at midnight, 0 at sunrise/sunset, +1 at noon
  const sunY = elevation * SUN_ORBIT_RADIUS;
  const sunX = Math.cos(phaseAngle - Math.PI / 2) * SUN_ORBIT_RADIUS;
  cycle.sun.position.set(sunX, Math.max(sunY, -20), 80); // never actually dips far below the horizon — keeps shadow math sane through the "night" portion instead of pointing straight up from underneath

  // Blend NIGHT -> DAWN_DUSK -> DAY -> DAWN_DUSK -> NIGHT across elevation.
  const dayAmount = Math.max(0, elevation);       // 0 at/below horizon, 1 at noon
  const duskAmount = 1 - Math.abs(elevation);      // peaks right at the horizon crossings, 0 at noon/midnight
  let sunColor, ambientColor, fogColor, sunIntensity, ambientIntensity;
  if (elevation <= 0) {
    // night -> dawn/dusk as the sun approaches the horizon from below
    const k = Math.max(0, 1 - Math.abs(elevation) / 0.35);
    sunColor = lerpColor(NIGHT.sun, DAWN_DUSK.sun, k);
    ambientColor = lerpColor(NIGHT.ambient, DAWN_DUSK.ambient, k);
    fogColor = lerpColor(NIGHT.fog, DAWN_DUSK.fog, k);
    sunIntensity = THREE.MathUtils.lerp(NIGHT.sunIntensity, DAWN_DUSK.sunIntensity, k);
    ambientIntensity = THREE.MathUtils.lerp(NIGHT.ambientIntensity, DAWN_DUSK.ambientIntensity, k);
  } else {
    // dawn/dusk -> day as the sun climbs, using the same duskAmount/dayAmount blend
    const k = Math.min(1, dayAmount / 0.35);
    sunColor = lerpColor(DAWN_DUSK.sun, DAY.sun, k);
    ambientColor = lerpColor(DAWN_DUSK.ambient, DAY.ambient, k);
    fogColor = lerpColor(DAWN_DUSK.fog, DAY.fog, k);
    sunIntensity = THREE.MathUtils.lerp(DAWN_DUSK.sunIntensity, DAY.sunIntensity, k);
    ambientIntensity = THREE.MathUtils.lerp(DAWN_DUSK.ambientIntensity, DAY.ambientIntensity, k);
  }
  void duskAmount; // (kept for future use — e.g. a stronger horizon glow — not currently consumed)

  cycle.sun.color.copy(sunColor);
  cycle.sun.intensity = sunIntensity;
  cycle.ambient.color.copy(ambientColor);
  cycle.ambient.intensity = ambientIntensity;
  cycle.scene.fog.color.copy(fogColor);
  if (cycle.scene.background) cycle.scene.background.copy(fogColor);
  else cycle.scene.background = fogColor.clone();

  // Stars fade in as the sun drops toward/below the horizon, fully hidden
  // by mid-morning.
  if (cycle.starfield) {
    cycle.starfield.material.opacity = THREE.MathUtils.clamp(1 - dayAmount / 0.25, 0, 1);
  }

  return t;
}

export { createDayNightCycle, updateDayNightCycle, CYCLE_SECONDS };
