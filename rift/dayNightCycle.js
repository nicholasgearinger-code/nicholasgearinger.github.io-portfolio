import * as THREE from "three";
import * as current from "./dayNightCycle_moon_base.js";

export * from "./dayNightCycle_moon_base.js";

// -----------------------------------------------------------------------------
// Lunar phase layer
// -----------------------------------------------------------------------------
// The preserved dayNightCycle_moon_base.js keeps the existing 30-minute
// day/night orbit, realistic sun/moon presentation, shadows and sky timing.
// This wrapper adds a slower independent lunar month so the moon's illuminated
// face evolves across multiple in-game days instead of resetting every night.

const LUNAR_MONTH_DAYS = 8;
const LUNAR_MONTH_SECONDS = current.CYCLE_SECONDS * LUNAR_MONTH_DAYS;
const PHASE_REDRAW_STEP = 0.0005;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function smooth01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function wrappedDistance01(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
}

function phaseName(phase) {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.0625 || p >= 0.9375) return "Full Moon";
  if (p < 0.1875) return "Waning Gibbous";
  if (p < 0.3125) return "Last Quarter";
  if (p < 0.4375) return "Waning Crescent";
  if (p < 0.5625) return "New Moon";
  if (p < 0.6875) return "Waxing Crescent";
  if (p < 0.8125) return "First Quarter";
  return "Waxing Gibbous";
}

function installMoonPhaseRenderer(cycle) {
  if (!cycle || cycle.__riftMoonPhaseRenderer) return;

  const material = cycle.moonBody?.core?.material;
  const sourceTexture = material?.map;
  const sourceCanvas = sourceTexture?.image;
  if (!material || !sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) return;

  const width = sourceCanvas.width;
  const height = sourceCanvas.height;

  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  sourceCtx.drawImage(sourceCanvas, 0, 0, width, height);
  const sourcePixels = sourceCtx.getImageData(0, 0, width, height);

  const phaseCanvas = document.createElement("canvas");
  phaseCanvas.width = width;
  phaseCanvas.height = height;
  const phaseCtx = phaseCanvas.getContext("2d");
  const phaseTexture = new THREE.CanvasTexture(phaseCanvas);
  phaseTexture.colorSpace = THREE.SRGBColorSpace;

  material.map = phaseTexture;
  material.needsUpdate = true;

  cycle.__riftMoonPhaseRenderer = {
    sourcePixels,
    phaseCanvas,
    phaseCtx,
    phaseTexture,
    lastPhase: Number.NaN,
  };

  cycle.moonPhaseT = 0;
  cycle.moonIllumination = 1;
  cycle.moonPhaseName = "Full Moon";
}

function redrawMoonPhase(cycle, phase) {
  const renderer = cycle?.__riftMoonPhaseRenderer;
  if (!renderer) return;

  const { sourcePixels, phaseCtx, phaseTexture } = renderer;
  const width = sourcePixels.width;
  const height = sourcePixels.height;
  const output = new ImageData(new Uint8ClampedArray(sourcePixels.data), width, height);

  // Full moon begins at phase 0, new moon at phase 0.5. Moving from full
  // toward new lights the LEFT side (waning); moving from new toward full
  // lights the RIGHT side (waxing), matching the familiar northern-sky read.
  const angle = phase * Math.PI * 2;
  const lightX = -Math.sin(angle);
  const lightZ = Math.cos(angle);
  const cx = (width - 1) * 0.5;
  const cy = (height - 1) * 0.5;
  const radius = Math.min(width, height) * 0.46;
  const data = output.data;
  const src = sourcePixels.data;

  for (let y = 0; y < height; y++) {
    const ny = (cy - y) / radius;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (src[i + 3] === 0) continue;

      const nx = (x - cx) / radius;
      const r2 = nx * nx + ny * ny;
      if (r2 >= 1) {
        data[i + 3] = 0;
        continue;
      }

      const nz = Math.sqrt(Math.max(0, 1 - r2));
      const incidence = nx * lightX + nz * lightZ;
      const terminator = smooth01((incidence + 0.025) / 0.05);

      if (terminator <= 0.001) {
        data[i + 3] = 0;
        continue;
      }

      // Keep the illuminated side photographic rather than flat: the center
      // is brightest while the limb/terminator gently darken.
      const brightness = 0.66 + 0.34 * Math.sqrt(clamp01(incidence));
      data[i] = Math.round(src[i] * brightness);
      data[i + 1] = Math.round(src[i + 1] * brightness);
      data[i + 2] = Math.round(src[i + 2] * brightness);
      data[i + 3] = Math.round(src[i + 3] * terminator);
    }
  }

  phaseCtx.putImageData(output, 0, 0);
  phaseTexture.needsUpdate = true;
  renderer.lastPhase = phase;
}

function updateMoonPhase(cycle) {
  if (!cycle?.__riftMoonPhaseRenderer) installMoonPhaseRenderer(cycle);
  const renderer = cycle?.__riftMoonPhaseRenderer;
  if (!renderer) return;

  const elapsed = Math.max(0, Number(cycle.elapsed) || 0);
  const phase = (elapsed % LUNAR_MONTH_SECONDS) / LUNAR_MONTH_SECONDS;
  const illumination = 0.5 * (1 + Math.cos(phase * Math.PI * 2));

  cycle.moonPhaseT = phase;
  cycle.moonIllumination = illumination;
  cycle.moonPhaseName = phaseName(phase);

  if (!Number.isFinite(renderer.lastPhase) || wrappedDistance01(phase, renderer.lastPhase) >= PHASE_REDRAW_STEP) {
    redrawMoonPhase(cycle, phase);
  }

  const body = cycle.moonBody;
  if (body?.glow?.material) {
    // A crescent gets only a restrained halo; a new moon gets none.
    body.glow.material.opacity *= Math.pow(illumination, 1.35);
  }

  if (cycle.moonLight) {
    // Moonlit shadows and terrain brightness now follow the visible phase too.
    cycle.moonLight.intensity *= Math.pow(illumination, 0.85);
  }

  // At true new moon, remove the barely-there residual sprite entirely.
  if (body?.group && illumination < 0.004) {
    body.group.visible = false;
  }
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  const cycle = current.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight);
  installMoonPhaseRenderer(cycle);
  redrawMoonPhase(cycle, 0);
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = current.updateDayNightCycle(cycle, dt);
  updateMoonPhase(cycle);
  return {
    ...result,
    moonPhaseT: cycle?.moonPhaseT ?? 0,
    moonIllumination: cycle?.moonIllumination ?? 1,
    moonPhaseName: cycle?.moonPhaseName ?? "Full Moon",
  };
}
