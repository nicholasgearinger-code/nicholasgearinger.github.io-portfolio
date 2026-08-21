import * as THREE from "three";
import * as current from "./dayNightCycle_lighting_base.js";

export * from "./dayNightCycle_lighting_base.js";

// -----------------------------------------------------------------------------
// Atmospheric light balance
// -----------------------------------------------------------------------------
// The preserved base module owns the full day/night orbit, moon phases, sky,
// sun/moon visuals and shadow direction. This wrapper only corrects the actual
// scene-light intensity balance so dawn/dusk behaves more like real low-angle
// sunlight: weaker direct light, a little more diffuse sky fill, and genuinely
// dim moonlight rather than a second weak sun.

const ORBIT_RADIUS = 260;
const SUN_VISUAL_HORIZON_OFFSET = 10;
const HORIZON_SUN_LIGHT = new THREE.Color(0xff9a57);

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

    // 1 right at the horizon, smoothly reaching 0 by roughly 16 degrees of
    // solar elevation. Real sunlight passes through far more atmosphere at
    // this angle, so direct irradiance drops sharply while diffuse sky light
    // remains comparatively strong.
    const altitudeT = smoothstep01(Math.max(0, elevation) / 0.28);
    const lowSun = 1 - altitudeT;

    // Keep nighttime values owned by the base cycle. This correction only
    // applies through twilight and once the sun is above the horizon.
    if (elevation > -0.08) {
      const directAttenuation = THREE.MathUtils.lerp(0.58, 1.0, altitudeT);
      cycle.sun.intensity *= directAttenuation;

      // The base already warms the sun near the horizon; this small additional
      // physical bias makes sure any remaining highlight energy is amber rather
      // than neutral white without recoloring midday sunlight.
      cycle.sun.color.lerp(HORIZON_SUN_LIGHT, lowSun * 0.12);

      // Soft sky fill prevents the scene from becoming pure black silhouettes
      // once the direct sun is attenuated. This is diffuse illumination, not a
      // second directional source, so it does not recreate hard white patches.
      cycle.ambient.intensity *= 1 + lowSun * 0.14;
    }
  }

  // The previous peak moonlight was 0.4 versus 2.0 for the sun — far too close
  // for realistic night lighting and strong enough to create bright highlights.
  // Preserve the lunar-phase multiplier from the base and simply scale the final
  // result down to a subtle, shadow-readable maximum.
  if (cycle.moonLight) cycle.moonLight.intensity *= 0.45;
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  return current.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight);
}

export function updateDayNightCycle(cycle, dt) {
  const result = current.updateDayNightCycle(cycle, dt);
  applyNaturalLightBalance(cycle);
  return result;
}
