import * as THREE from "three";
import * as current from "./dayNightCycle_lighting_base.js";

export * from "./dayNightCycle_lighting_base.js";

const ORBIT_RADIUS = 260;
const SUN_VISUAL_HORIZON_OFFSET = 10;
const HORIZON_SUN_LIGHT = new THREE.Color(0xff9657);
const HORIZON_SKY_FILL = new THREE.Color(0xffc79a);

// The real Sun and Moon both subtend roughly half a degree in our sky. At the
// existing ~260-unit celestial orbit, a 2.5-unit sprite is close to that apparent
// size. The old 18-unit Sun disc was several times too large and made its ocean
// reflection read like a separate object rather than a distant light source.
const SUN_CORE_DIAMETER = 2.55;
const SUN_GLOW_DIAMETER = 13.5;
const MOON_CORE_DIAMETER = 2.45;
const MOON_GLOW_DIAMETER = 7.2;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function smoothstep01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function configureNaturalShadows(cycle) {
  if (!cycle || cycle.__riftNaturalShadowTuningV2) return;

  const sunShadow = cycle.sun?.shadow;
  if (sunShadow) {
    // Keep bias tiny. Large bias/normalBias values visibly detach thin palm
    // shadows from their casters at low solar angles.
    sunShadow.bias = -0.00028;
    sunShadow.normalBias = 0.018;
    sunShadow.radius = 2.0;
    if (sunShadow.camera) {
      // The light remains about one orbit radius from the player-centred target.
      // Tightening the useful depth range improves precision without increasing
      // shadow-map resolution or adding any mobile GPU cost.
      sunShadow.camera.near = 120;
      sunShadow.camera.far = 420;
      sunShadow.camera.updateProjectionMatrix?.();
    }
  }

  const moonShadow = cycle.moonLight?.shadow;
  if (moonShadow) {
    moonShadow.bias = -0.00022;
    moonShadow.normalBias = 0.024;
    moonShadow.radius = 3.0;
    if (moonShadow.camera) {
      moonShadow.camera.near = 120;
      moonShadow.camera.far = 420;
      moonShadow.camera.updateProjectionMatrix?.();
    }
  }

  cycle.__riftNaturalShadowTuningV2 = true;
}

function alignCelestialLighting(cycle) {
  if (!cycle) return;

  const sunBody = cycle.sunBody;
  if (sunBody?.core?.scale && sunBody?.glow?.scale) {
    const elevation = THREE.MathUtils.clamp(
      (sunBody.group.position.y - SUN_VISUAL_HORIZON_OFFSET) / ORBIT_RADIUS,
      -1,
      1,
    );
    const horizon = smoothstep01(
      1 - Math.min(1, Math.abs(elevation) / 0.16),
    );

    // Atmospheric refraction can make the Sun feel a touch larger near the
    // horizon, but the disc itself should remain nearly constant in angular size.
    const coreScale = 1 + horizon * 0.035;
    const glowScale = 1 + horizon * 0.10;
    sunBody.core.scale.set(
      SUN_CORE_DIAMETER * coreScale,
      SUN_CORE_DIAMETER * coreScale,
      1,
    );
    sunBody.glow.scale.set(
      SUN_GLOW_DIAMETER * glowScale,
      SUN_GLOW_DIAMETER * glowScale,
      1,
    );
    if (sunBody.glow.material) sunBody.glow.material.opacity *= 0.36;
  }

  const moonBody = cycle.moonBody;
  if (moonBody?.core?.scale && moonBody?.glow?.scale) {
    moonBody.core.scale.set(MOON_CORE_DIAMETER, MOON_CORE_DIAMETER, 1);
    moonBody.glow.scale.set(MOON_GLOW_DIAMETER, MOON_GLOW_DIAMETER, 1);
    if (moonBody.glow.material) moonBody.glow.material.opacity *= 0.58;
  }

  // One celestial direction now owns the visible disc, the DirectionalLight,
  // its shadows and the direction handed to the ocean. The preserved base used
  // a +10 visual-only Y offset for the Sun, which made sunset reflections and
  // shadows disagree with the object players actually saw in the sky.
  if (cycle.sun?.position && sunBody?.group?.position) {
    cycle.sun.position.copy(sunBody.group.position);
  }
  if (cycle.moonLight?.position && moonBody?.group?.position) {
    cycle.moonLight.position.copy(moonBody.group.position);
  }
}

function applyNaturalLightBalance(cycle) {
  if (!cycle) return;

  const visualY = cycle.sunBody?.group?.position?.y;
  if (Number.isFinite(visualY) && cycle.sun && cycle.ambient) {
    const elevation = THREE.MathUtils.clamp(
      (visualY - SUN_VISUAL_HORIZON_OFFSET) / ORBIT_RADIUS,
      -1,
      1,
    );

    const altitudeT = smoothstep01(Math.max(0, elevation) / 0.30);
    const lowSun = 1 - altitudeT;

    if (elevation > -0.08) {
      cycle.sun.intensity *= THREE.MathUtils.lerp(0.28, 1.0, altitudeT);
      cycle.sun.color.lerp(HORIZON_SUN_LIGHT, lowSun * 0.26);

      cycle.ambient.intensity *= 1 + lowSun * 0.26;
      if (cycle.ambient.color?.isColor) {
        cycle.ambient.color.lerp(HORIZON_SKY_FILL, lowSun * 0.07);
      }
    }
  }

  if (cycle.moonLight) cycle.moonLight.intensity *= 0.32;
}

export function createDayNightCycle(
  scene,
  sun,
  ambient,
  starfield,
  biome,
  moonLight,
) {
  const cycle = current.createDayNightCycle(
    scene,
    sun,
    ambient,
    starfield,
    biome,
    moonLight,
  );
  configureNaturalShadows(cycle);
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = current.updateDayNightCycle(cycle, dt);
  configureNaturalShadows(cycle);
  alignCelestialLighting(cycle);
  applyNaturalLightBalance(cycle);
  return result;
}
