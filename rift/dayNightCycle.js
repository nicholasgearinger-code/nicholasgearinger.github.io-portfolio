import * as THREE from "three";

// -----------------------------------------------------------------------------
// SWAP POINT: the entire day/night cycle — sun/moon position, sun/ambient
// color and intensity, fog/background tint, and starfield opacity are all
// driven from one `t` value (0..1, where 0 = midnight, 0.5 = noon) so
// everything stays in sync automatically. Swap CYCLE_SECONDS for a
// different pace, or the color stops below for a different mood, without
// touching how any of it gets applied. The moon is just the sun's orbit
// formula run 180° out of phase — same math, not a separate system.
// -----------------------------------------------------------------------------

const CYCLE_SECONDS = 480; // one full day/night cycle — long enough not to be distracting, short enough to actually see it move in a session
const ORBIT_RADIUS = 260;

// Color/intensity at each key point in the cycle. Interpolated smoothly
// between neighbors by elevation, not just a hard day/night switch, so
// sunrise/sunset actually reads as its own moment rather than a snap cut.
const NIGHT = { sun: 0x22304a, sunIntensity: 0.12, ambient: 0x1a2438, ambientIntensity: 0.32, fog: 0x0a0e14 };
const DAWN_DUSK = { sun: 0xff9d5c, sunIntensity: 0.75, ambient: 0x4a3550, ambientIntensity: 0.45, fog: 0x2a1f2e };
const DAY = { sun: 0xfff4e0, sunIntensity: 1.15, ambient: 0x8899bb, ambientIntensity: 0.65, fog: 0x1c2436 };

function lerpColor(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
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

// A bright core disc plus a larger soft halo sprite behind it — the halo
// is what actually reads as "glowing" at a distance, the disc alone just
// looks like a flat circle.
function createBody(scene, coreColor, coreRadius, glowColor, glowRadius, glowOpacity) {
  const group = new THREE.Group();

  const coreMat = new THREE.MeshBasicMaterial({ color: coreColor, fog: false, transparent: true });
  const core = new THREE.Mesh(new THREE.SphereGeometry(coreRadius, 16, 16), coreMat);
  group.add(core);

  const glowMat = new THREE.SpriteMaterial({
    color: glowColor, transparent: true, opacity: glowOpacity, fog: false,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(glowRadius * 2);
  group.add(glow);

  scene.add(group);
  return { group, core, glow, baseGlowOpacity: glowOpacity };
}

/**
 * @param {THREE.Scene} scene
 * @param {THREE.DirectionalLight} sun
 * @param {THREE.AmbientLight} ambient
 * @param {THREE.Points} starfield
 */
function createDayNightCycle(scene, sun, ambient, starfield) {
  const sunBody = createBody(scene, 0xfff6d8, 14, 0xffe6a8, 34, 0.55);
  const moonBody = createBody(scene, 0xd8e2f2, 9, 0xaebedd, 20, 0.35);
  return { scene, sun, ambient, starfield, sunBody, moonBody, elapsed: 0 };
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

  // Blend NIGHT -> DAWN_DUSK -> DAY -> DAWN_DUSK -> NIGHT across elevation.
  const dayAmount = Math.max(0, elevation);       // 0 at/below horizon, 1 at noon
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
    // dawn/dusk -> day as the sun climbs, using the same dayAmount blend
    const k = Math.min(1, dayAmount / 0.35);
    sunColor = lerpColor(DAWN_DUSK.sun, DAY.sun, k);
    ambientColor = lerpColor(DAWN_DUSK.ambient, DAY.ambient, k);
    fogColor = lerpColor(DAWN_DUSK.fog, DAY.fog, k);
    sunIntensity = THREE.MathUtils.lerp(DAWN_DUSK.sunIntensity, DAY.sunIntensity, k);
    ambientIntensity = THREE.MathUtils.lerp(DAWN_DUSK.ambientIntensity, DAY.ambientIntensity, k);
  }

  cycle.sun.color.copy(sunColor);
  cycle.sun.intensity = sunIntensity;
  cycle.ambient.color.copy(ambientColor);
  cycle.ambient.intensity = ambientIntensity;
  cycle.scene.fog.color.copy(fogColor);
  if (cycle.scene.background) cycle.scene.background.copy(fogColor);
  else cycle.scene.background = fogColor.clone();

  // Each body fades out once it's below the horizon rather than just
  // disappearing at exactly elevation=0, so setting/rising reads as a
  // smooth fade rather than a pop.
  const sunVisibility = THREE.MathUtils.clamp(0.5 + sunOrbit.elevation / 0.3, 0, 1);
  const moonVisibility = THREE.MathUtils.clamp(0.5 + moonOrbit.elevation / 0.3, 0, 1);
  cycle.sunBody.core.material.opacity = sunVisibility;
  cycle.sunBody.glow.material.opacity = cycle.sunBody.baseGlowOpacity * sunVisibility;
  cycle.moonBody.core.material.opacity = moonVisibility;
  cycle.moonBody.glow.material.opacity = cycle.moonBody.baseGlowOpacity * moonVisibility;

  // Stars fade in as the sun drops toward/below the horizon, fully hidden
  // by mid-morning.
  if (cycle.starfield) {
    cycle.starfield.material.opacity = THREE.MathUtils.clamp(1 - dayAmount / 0.25, 0, 1);
  }

  return t;
}

export { createDayNightCycle, updateDayNightCycle, CYCLE_SECONDS };
