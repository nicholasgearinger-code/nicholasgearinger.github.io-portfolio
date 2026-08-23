import * as THREE from "three";
import * as base from "./dayNightCycle.js";

export * from "./dayNightCycle.js";

// -----------------------------------------------------------------------------
// Celestial apparent-size correction.
//
// dayNightCycle.js intentionally replaced the original debug bodies with layered
// realistic sprites, but its later mobile tuning reduced the actual visible Sun
// to 5.8 world units and the Moon to 2.45. At the ~260-unit orbit used by Rift
// those values read as tiny points on a phone. The preserved realistic base had
// already proven that substantially larger apparent discs work better in this
// stylized world, so this wrapper restores that readability while keeping the
// physically-inspired textures, lunar phase mask, cloud occlusion and halos.
// -----------------------------------------------------------------------------

const SUN_DISC = 18.0;
const SUN_HALO = 92.0;
const SUN_AUREOLE = 190.0;
const SUN_HORIZON_WIDTH = 270.0;
const SUN_HORIZON_HEIGHT = 102.0;
const MOON_DISC = 15.0;
const MOON_GLOW = 40.0;

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function applyCelestialScale(cycle) {
  if (!cycle) return;

  const sunVisual = cycle.__riftRealSun;
  const sunPos = cycle.sunBody?.group?.position;
  if (sunVisual && sunPos) {
    const elevation = THREE.MathUtils.clamp((sunPos.y - 10) / 260, -1, 1);
    const horizon = 1 - clamp01(Math.abs(elevation) / 0.18);
    const horizonEase = horizon * horizon * (3 - 2 * horizon);

    const discScale = SUN_DISC * (1 + horizonEase * 0.14);
    const haloScale = SUN_HALO * (1 + horizonEase * 0.24);
    const aureoleScale = SUN_AUREOLE * (1 + horizonEase * 0.34);

    sunVisual.disc?.scale.set(discScale, discScale, 1);
    sunVisual.halo?.scale.set(haloScale, haloScale, 1);
    sunVisual.aureole?.scale.set(aureoleScale, aureoleScale, 1);
    sunVisual.horizonGlow?.scale.set(
      SUN_HORIZON_WIDTH * (1 + horizonEase * 0.20),
      SUN_HORIZON_HEIGHT * (1 + horizonEase * 0.10),
      1,
    );

    // The disc should carry the visual identity of the Sun, not disappear into
    // its glare. Leave the cloud-occlusion logic from dayNightCycle.js intact and
    // only ensure a readable peak opacity when it is visible.
    if (sunVisual.discMaterial && sunVisual.disc.visible) {
      sunVisual.discMaterial.opacity = Math.min(
        1,
        Math.max(0.78, Number(sunVisual.discMaterial.opacity) || 0),
      );
    }
  }

  const moon = cycle.moonBody;
  if (moon?.core?.scale) {
    moon.core.scale.set(MOON_DISC, MOON_DISC, 1);
  }
  if (moon?.glow?.scale) {
    moon.glow.scale.set(MOON_GLOW, MOON_GLOW, 1);
  }

  // Keep the phase system authoritative for visibility/opacity. This wrapper
  // changes apparent size only, so crescents/new moon still work normally.
  globalThis.__riftCelestialScaleDebug = {
    sunDisc: SUN_DISC,
    moonDisc: MOON_DISC,
    largeCelestials: true,
  };
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  const cycle = base.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight);
  applyCelestialScale(cycle);
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = base.updateDayNightCycle(cycle, dt);
  applyCelestialScale(cycle);
  return result;
}
