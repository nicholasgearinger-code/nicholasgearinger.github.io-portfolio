import * as THREE from "three";
import * as current from "./dayNightCycle_lighting_base.js";

export * from "./dayNightCycle_lighting_base.js";

const ORBIT_RADIUS = 260;
const SUN_VISUAL_HORIZON_OFFSET = 10;
const HORIZON_SUN_LIGHT = new THREE.Color(0xff9657);
const HORIZON_SKY_FILL = new THREE.Color(0xffc79a);

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function smoothstep01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
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
      // Low-angle sunlight should lose direct energy rapidly as it approaches
      // the horizon, while the sky remains a broad diffuse source.
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

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  return current.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight);
}

export function updateDayNightCycle(cycle, dt) {
  const result = current.updateDayNightCycle(cycle, dt);
  applyNaturalLightBalance(cycle);
  return result;
}
