import * as THREE from "three";
import * as current from "./dayNightCycle_phase_base.js";

export * from "./dayNightCycle_phase_base.js";

// Lunar phases layer. The preserved base module still owns the realistic
// sun/moon textures, orbit, sky timing and scene lighting. This wrapper only
// masks the existing cratered moon surface and scales its halo/moonlight.
const LUNAR_CYCLE_DAYS = 8;
const LUNAR_CYCLE_SECONDS = current.CYCLE_SECONDS * LUNAR_CYCLE_DAYS;
const PHASE_TEX_SIZE = 128;
const PHASE_STEPS = 180;

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function createPhaseMask() {
  const canvas = document.createElement("canvas");
  canvas.width = PHASE_TEX_SIZE;
  canvas.height = PHASE_TEX_SIZE;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(PHASE_TEX_SIZE, PHASE_TEX_SIZE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return { canvas, ctx, image, texture, lastStep: -1, illumination: 1 };
}

function updatePhaseMask(mask, phase01) {
  const phase = ((phase01 % 1) + 1) % 1;
  const step = Math.round(phase * PHASE_STEPS) % PHASE_STEPS;
  if (step === mask.lastStep) return mask.illumination;

  // Full moon at 0, new moon at 0.5, full again at 1. The illuminated
  // hemisphere is projected onto the visible lunar sphere, so quarter and
  // crescent shapes have a real curved terminator rather than a flat wipe.
  const angle = phase * Math.PI * 2;
  const lightX = Math.sin(angle);
  const lightZ = Math.cos(angle);
  const illumination = (1 + Math.cos(angle)) * 0.5;

  const size = PHASE_TEX_SIZE;
  const c = (size - 1) * 0.5;
  const r = size * 0.46;
  const data = mask.image.data;

  for (let y = 0; y < size; y++) {
    const ny = (c - y) / r;
    for (let x = 0; x < size; x++) {
      const nx = (x - c) / r;
      const rr = nx * nx + ny * ny;
      const i = (y * size + x) * 4;
      let lit = 0;

      if (rr <= 1) {
        const nz = Math.sqrt(Math.max(0, 1 - rr));
        const incidence = nx * lightX + nz * lightZ;
        lit = smooth01((incidence + 0.018) / 0.036);
      }

      // SpriteMaterial alphaMap reads the green channel. Keep RGB equal so the
      // mask is unambiguous and leave alpha fully opaque.
      const value = Math.round(lit * 255);
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }

  mask.ctx.putImageData(mask.image, 0, 0);
  mask.texture.needsUpdate = true;
  mask.lastStep = step;
  mask.illumination = illumination;
  return illumination;
}

function installMoonPhases(cycle) {
  if (!cycle || cycle.__riftMoonPhasesInstalled) return cycle;
  const mask = createPhaseMask();
  updatePhaseMask(mask, 0);

  if (cycle.moonBody?.core?.material) {
    cycle.moonBody.core.material.alphaMap = mask.texture;
    cycle.moonBody.core.material.alphaTest = 0.01;
    cycle.moonBody.core.material.needsUpdate = true;
  }

  cycle.__riftMoonPhaseMask = mask;
  cycle.__riftMoonPhasesInstalled = true;
  cycle.moonPhase = 0;
  cycle.moonIllumination = 1;
  return cycle;
}

function updateMoonPhases(cycle) {
  if (!cycle?.__riftMoonPhasesInstalled) return;

  const elapsed = Math.max(0, Number(cycle.elapsed) || 0);
  const phase = (elapsed % LUNAR_CYCLE_SECONDS) / LUNAR_CYCLE_SECONDS;
  const illumination = updatePhaseMask(cycle.__riftMoonPhaseMask, phase);

  // The base updater refreshes glow opacity and moonlight each frame, so these
  // multipliers never accumulate. A crescent has a faint halo and weak shadows;
  // a new moon contributes essentially no visible moon or moonlight.
  if (cycle.moonBody?.glow?.material) {
    cycle.moonBody.glow.material.opacity *= Math.pow(illumination, 0.72);
  }

  if (cycle.moonLight) {
    cycle.moonLight.intensity *= Math.pow(illumination, 0.85);
  }

  if (cycle.moonBody?.group && illumination < 0.002) {
    cycle.moonBody.group.visible = false;
  }

  cycle.moonPhase = phase;
  cycle.moonIllumination = illumination;
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  return installMoonPhases(
    current.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight),
  );
}

export function updateDayNightCycle(cycle, dt) {
  const result = current.updateDayNightCycle(cycle, dt);
  updateMoonPhases(cycle);
  return result;
}
