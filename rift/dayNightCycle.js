import * as THREE from "three";
import * as current from "./dayNightCycle_moonphase_base.js";

export * from "./dayNightCycle_moonphase_base.js";

// -----------------------------------------------------------------------------
// Lunar phases
// -----------------------------------------------------------------------------
// One in-game day/night cycle is 30 minutes. Eight of those cycles make one
// lunar month here (~4 real hours), long enough for consecutive nights to feel
// different while still being easy to preview with the existing time-scale
// debug control.
//
// phaseT:
//   0.000 = full
//   0.125 = waning gibbous
//   0.250 = last quarter
//   0.375 = waning crescent
//   0.500 = new moon
//   0.625 = waxing crescent
//   0.750 = first quarter
//   0.875 = waxing gibbous
//   1.000 = full again
const LUNAR_MONTH_DAYS = 8;
const LUNAR_MONTH_SECONDS = current.CYCLE_SECONDS * LUNAR_MONTH_DAYS;
const MOON_MASK_SIZE = 192;
const PHASE_UPDATE_EPSILON = 0.00045;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function createMoonPhaseMask() {
  const canvas = document.createElement("canvas");
  canvas.width = MOON_MASK_SIZE;
  canvas.height = MOON_MASK_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  const image = ctx.createImageData(MOON_MASK_SIZE, MOON_MASK_SIZE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return { canvas, ctx, image, texture, lastPhaseT: Number.NaN };
}

function phaseName(phaseT) {
  const p = ((phaseT % 1) + 1) % 1;
  if (p < 0.0625 || p >= 0.9375) return "Full Moon";
  if (p < 0.1875) return "Waning Gibbous";
  if (p < 0.3125) return "Last Quarter";
  if (p < 0.4375) return "Waning Crescent";
  if (p < 0.5625) return "New Moon";
  if (p < 0.6875) return "Waxing Crescent";
  if (p < 0.8125) return "First Quarter";
  return "Waxing Gibbous";
}

function illuminationForPhase(phaseT) {
  // Full at phase 0, new at 0.5, full again at 1.
  return 0.5 * (1 + Math.cos(phaseT * Math.PI * 2));
}

function renderMoonPhaseMask(mask, phaseT) {
  if (!mask) return;

  const wrapped = ((phaseT % 1) + 1) % 1;
  const last = mask.lastPhaseT;
  let delta = Number.isFinite(last) ? Math.abs(wrapped - last) : Infinity;
  // Handle the 1 -> 0 wrap as a tiny change rather than almost a full cycle.
  if (delta > 0.5) delta = 1 - delta;
  if (delta < PHASE_UPDATE_EPSILON) return;
  mask.lastPhaseT = wrapped;

  const size = MOON_MASK_SIZE;
  const data = mask.image.data;
  const center = (size - 1) * 0.5;
  const radius = size * 0.465;
  const invRadius = 1 / radius;
  const angle = wrapped * Math.PI * 2;

  // The sun direction rotates around the moon. After full moon the LEFT side
  // remains illuminated (waning); after new moon the RIGHT side returns
  // (waxing), matching the familiar Northern-Hemisphere visual progression.
  const lightX = -Math.sin(angle);
  const lightZ = Math.cos(angle);

  let offset = 0;
  for (let y = 0; y < size; y++) {
    const ny = (y - center) * invRadius;
    for (let x = 0; x < size; x++, offset += 4) {
      const nx = (x - center) * invRadius;
      const r2 = nx * nx + ny * ny;

      if (r2 >= 1) {
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
        data[offset + 3] = 0;
        continue;
      }

      // Visible hemisphere normal. Dotting it with the rotating sun direction
      // gives a true curved terminator rather than an arbitrary 2D overlay.
      const nz = Math.sqrt(Math.max(0, 1 - r2));
      const sunDot = nx * lightX + nz * lightZ;

      // Slight feather at the terminator + the moon's outer limb keeps the mask
      // antialiased on phone screens while still reaching genuinely invisible
      // at new moon.
      const lit = smoothstep(-0.018, 0.018, sunDot);
      const limb = 1 - smoothstep(0.965, 1.0, Math.sqrt(r2));
      const alpha = Math.round(255 * lit * limb);

      // THREE alphaMap reads grayscale; writing all RGB channels keeps this
      // robust regardless of backend/channel handling.
      data[offset] = alpha;
      data[offset + 1] = alpha;
      data[offset + 2] = alpha;
      data[offset + 3] = 255;
    }
  }

  mask.ctx.putImageData(mask.image, 0, 0);
  mask.texture.needsUpdate = true;
}

function installMoonPhases(cycle) {
  if (!cycle || cycle.__riftMoonPhases) return cycle;
  const moonMaterial = cycle.moonBody?.core?.material;
  if (!moonMaterial) return cycle;

  const mask = createMoonPhaseMask();
  moonMaterial.alphaMap = mask.texture;
  moonMaterial.alphaTest = 0.005;
  moonMaterial.needsUpdate = true;

  cycle.__riftMoonPhaseMask = mask;
  cycle.__riftMoonPhases = true;

  // Start at a full moon so the first night makes the new system obvious.
  cycle.__riftMoonPhaseOffset = 0;
  renderMoonPhaseMask(mask, 0);
  return cycle;
}

function updateMoonPhases(cycle, result) {
  if (!cycle?.__riftMoonPhases) return result;

  const elapsed = Math.max(0, Number(cycle.elapsed) || 0);
  const phaseT =
    ((elapsed / LUNAR_MONTH_SECONDS + (cycle.__riftMoonPhaseOffset || 0)) % 1 + 1) % 1;
  const illumination = clamp01(illuminationForPhase(phaseT));

  renderMoonPhaseMask(cycle.__riftMoonPhaseMask, phaseT);

  // The base day/night updater has already written this frame's moon visibility,
  // halo and moonlight. Scale those fresh values by the illuminated fraction so
  // crescent nights are genuinely dimmer and new moon produces essentially no
  // lunar glow or moon-cast shadows.
  const moonCore = cycle.moonBody?.core?.material;
  const moonGlow = cycle.moonBody?.glow?.material;
  if (moonCore) {
    const baseOpacity = clamp01(moonCore.opacity);
    moonCore.opacity = baseOpacity * (0.04 + illumination * 0.96);
  }
  if (moonGlow) {
    moonGlow.opacity *= Math.pow(illumination, 0.72);
  }
  if (cycle.moonLight) {
    cycle.moonLight.intensity *= Math.pow(illumination, 1.25);
  }

  cycle.moonPhaseT = phaseT;
  cycle.moonIllumination = illumination;
  cycle.moonPhaseName = phaseName(phaseT);

  if (result && typeof result === "object") {
    result.moonPhaseT = phaseT;
    result.moonIllumination = illumination;
    result.moonPhaseName = cycle.moonPhaseName;
  }

  return result;
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  return installMoonPhases(
    current.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight),
  );
}

export function updateDayNightCycle(cycle, dt) {
  const result = current.updateDayNightCycle(cycle, dt);
  return updateMoonPhases(cycle, result);
}
