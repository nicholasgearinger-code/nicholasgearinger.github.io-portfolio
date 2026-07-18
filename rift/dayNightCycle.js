import * as THREE from "three";

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
function createSkyDome(scene) {
  const geo = new THREE.SphereGeometry(SKY_DOME_RADIUS, 32, 16);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  return { mesh, posAttr: geo.attributes.position, colorAttr: geo.attributes.color };
}

function updateSkyDome(sky, zenithColor, horizonColor) {
  const { posAttr, colorAttr } = sky;
  const tmp = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    const yFrac = posAttr.getY(i) / SKY_DOME_RADIUS; // -1 (bottom) to 1 (top)
    // Concentrates the gradient near the horizon band rather than
    // spreading it evenly top-to-bottom — real skies change fastest right
    // at the horizon, not uniformly toward the zenith.
    const t = THREE.MathUtils.clamp((yFrac + 0.1) / 0.45, 0, 1);
    tmp.copy(horizonColor).lerp(zenithColor, t);
    tmp.toArray(colorAttr.array, i * 3);
  }
  colorAttr.needsUpdate = true;
}

/**
 * @param {THREE.Scene} scene
 * @param {THREE.DirectionalLight} sun
 * @param {THREE.AmbientLight} ambient
 * @param {THREE.Points} starfield
 */
function createDayNightCycle(scene, sun, ambient, starfield) {
  const glowTexture = createGlowTexture();
  const sunBody = createBody(scene, glowTexture, createSunTexture(), 14, 0xffcf80, 40, 0.6);
  const moonBody = createBody(scene, glowTexture, createMoonTexture(), 9, 0xaebedd, 22, 0.32);
  const sky = createSkyDome(scene);
  return { scene, sun, ambient, starfield, sunBody, moonBody, sky, elapsed: 0 };
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
  cycle.scene.fog.color.copy(fogColor);
  updateSkyDome(cycle.sky, skyZenith, skyHorizon);

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
