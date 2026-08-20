import * as THREE from "three";
import {
  Fn, instanceIndex, instancedArray, uniform, color,
  float, uint, vec2, vec4,
  attribute, floor, min, max, abs, mix, clamp, smoothstep, sin,
  positionWorld,
} from "three/tsl";
import {
  createGPUSwashSolver as createBaseSwash,
  updateGPUSwashSolver as updateBaseSwash,
  updateGPUSwashVisuals as updateBaseVisuals,
  disposeGPUSwashSolver as disposeBaseSwash,
  SWASH_S, SWASH_R, SWASH_OFFSHORE, SWASH_LANDWARD,
} from "./gpu_swash_solver_v4.js";

// -----------------------------------------------------------------------------
// Swash v5 — foam lifetime + wet-sand memory on top of the physical v4 solver.
//
// v4 already transports water and foam with the solved shallow-water velocity.
// This layer keeps that physics intact and adds two inexpensive 192x48 passes:
//   1) velocity-aware foam aging (stagnant foam disappears faster),
//   2) a persistent wetness tracer that records where the real swash has been.
//
// The wetness tracer drives a dark, low-opacity sand sheen after the water film
// retreats. No procedural shoreline mask controls run-up, backwash or foam flow.
// -----------------------------------------------------------------------------

const COUNT = SWASH_S * SWASH_R;

function smoothWeight(t) {
  return t.mul(t).mul(float(3).sub(t.mul(2)));
}

function sampleStrip(buffer, coord) {
  const rf = clamp(coord.x, 0, SWASH_R - 1);
  const sf = coord.y;
  const r0 = floor(rf);
  const r1 = min(r0.add(1), float(SWASH_R - 1));
  const s0Raw = floor(sf);
  const s0 = s0Raw.toUint().mod(uint(SWASH_S));
  const s1 = s0.add(uint(1)).mod(uint(SWASH_S));
  const tr = smoothWeight(rf.sub(r0));
  const ts = smoothWeight(sf.sub(s0Raw));
  const row = uint(SWASH_R);
  const i00 = s0.mul(row).add(r0.toUint());
  const i10 = s0.mul(row).add(r1.toUint());
  const i01 = s1.mul(row).add(r0.toUint());
  const i11 = s1.mul(row).add(r1.toUint());
  return mix(
    mix(buffer.element(i00), buffer.element(i10), tr),
    mix(buffer.element(i01), buffer.element(i11), tr),
    ts,
  );
}

function installFoamAgingAndWetness(handle) {
  if (!handle?.gpuSwash || handle.swashWetnessInstalled) return;

  const state = handle.state;
  const scratch = handle.stateScratch;
  const wetA = instancedArray(new Float32Array(COUNT), "float");
  const wetB = instancedArray(new Float32Array(COUNT), "float");
  const dtUniform = uniform(1 / 60);

  const refineFoam = Fn(() => {
    const i = instanceIndex;
    const c = state.element(i);
    const speed = abs(c.y).add(abs(c.z).mul(0.32));
    const moving = smoothstep(float(0.025), float(0.42), speed);
    const thinFilm = float(1).sub(smoothstep(float(0.010), float(0.16), c.x));

    const decayRate = mix(float(0.52), float(0.085), moving)
      .add(thinFilm.mul(0.10));
    const keep = max(float(0), float(1).sub(dtUniform.mul(decayRate)));
    const foam = clamp(c.w.mul(keep), 0, 1);
    scratch.element(i).assign(vec4(c.x, c.y, c.z, foam));
  })().compute(COUNT);

  const copyFoam = Fn(() => {
    state.element(instanceIndex).assign(scratch.element(instanceIndex));
  })().compute(COUNT);

  const updateWetness = Fn(() => {
    const i = instanceIndex;
    const c = state.element(i);
    const oldWet = wetA.element(i);
    const waterWet = smoothstep(float(0.0012), float(0.016), c.x);
    const foamWet = smoothstep(float(0.055), float(0.42), c.w).mul(0.34);
    const target = max(waterWet, foamWet);
    const retained = oldWet.mul(max(float(0), float(1).sub(dtUniform.mul(0.038))));
    wetB.element(i).assign(clamp(max(target, retained), 0, 1));
  })().compute(COUNT);

  const copyWetness = Fn(() => {
    wetA.element(instanceIndex).assign(wetB.element(instanceIndex));
  })().compute(COUNT);

  handle.fftFoamRefineFrame = [refineFoam, copyFoam];
  handle.fftWetnessFrame = [updateWetness, copyWetness];
  handle.fftWetness = wetA;
  handle.fftWetnessScratch = wetB;
  handle.fftWetDt = dtUniform;
  handle.wetSandColor = uniform(color(0x5a4033));
  handle.resources?.push?.(wetA, wetB);
  handle.swashWetnessInstalled = true;
}

function installRealisticSwashMaterial(handle) {
  if (!handle?.gpuSwash || !handle.fftWetness || handle.swashMaterialV5Installed) return;

  const material = handle.material;
  const coord = attribute("swashCoord", "vec2");
  const sampled = sampleStrip(handle.state, coord);
  const wetness = sampleStrip(handle.fftWetness, coord);
  const landSample = sampleStrip(
    handle.state,
    vec2(min(coord.x.add(1), float(SWASH_R - 1)), coord.y),
  );
  const offSample = sampleStrip(
    handle.state,
    vec2(max(coord.x.sub(1), float(0)), coord.y),
  );

  const film = smoothstep(float(0.0007), float(0.018), sampled.x);
  const landDry = float(1).sub(smoothstep(float(0.0010), float(0.010), landSample.x));
  const offshoreWet = smoothstep(float(0.0020), float(0.020), offSample.x);
  const wetFront = film.mul(landDry).mul(offshoreWet);

  const runup = smoothstep(float(0.040), float(0.52), max(sampled.y, float(0)));
  const backwash = smoothstep(float(0.035), float(0.46), max(sampled.y.negate(), float(0)));
  const speed = abs(sampled.y).add(abs(sampled.z).mul(0.30));
  const moving = smoothstep(float(0.025), float(0.36), speed).mul(film);
  const transported = smoothstep(float(0.040), float(0.56), sampled.w).mul(film);

  const leadingWhite = wetFront.mul(float(0.44).add(runup.mul(0.24)));
  const carriedWhite = transported.mul(
    float(0.045)
      .add(moving.mul(0.52))
      .add(runup.mul(0.16))
      .add(backwash.mul(0.24)),
  );
  const residue = transported.mul(float(0.055)).mul(float(1).sub(moving.mul(0.80)));
  let foam = clamp(max(max(leadingWhite, carriedWhite), residue), 0, 0.78);

  const laceA = abs(sin(positionWorld.x.mul(1.57).add(positionWorld.z.mul(1.03)).add(handle.swashTime.mul(0.31))));
  const laceB = abs(sin(positionWorld.x.mul(0.83).sub(positionWorld.z.mul(1.91)).sub(handle.swashTime.mul(0.23))));
  const lace = smoothstep(float(0.18), float(0.92), laceA.mul(0.54).add(laceB.mul(0.46)));
  foam = foam.mul(float(0.72).add(lace.mul(0.28)));

  const wetDry = smoothstep(float(0.035), float(0.92), wetness)
    .mul(float(1).sub(film.mul(0.92)));

  const waterOpacity = film.mul(
    float(0.022)
      .add(smoothstep(float(0.009), float(0.14), sampled.x).mul(0.070)),
  );
  const wetOpacity = wetDry.mul(float(0.15).add(handle.day.mul(0.035)));
  const foamOpacity = foam.mul(float(0.23).add(handle.day.mul(0.11)));

  const wetBase = mix(handle.wetSandColor, handle.waterColor, film);
  material.colorNode = mix(wetBase, handle.foamColor, foam.mul(0.90));
  const baseRoughness = mix(float(0.25), float(0.085).add(handle.storm.mul(0.035)), film);
  material.roughnessNode = mix(baseRoughness, float(0.52), foam);
  material.emissiveNode = handle.foamColor.mul(
    foam.mul(float(0.004).add(handle.day.mul(0.008))),
  );
  material.opacityNode = clamp(
    waterOpacity
      .add(wetOpacity)
      .add(foamOpacity)
      .mul(float(1).sub(handle.underwater.mul(0.98))),
    0,
    0.56,
  );
  material.needsUpdate = true;
  handle.mesh.renderOrder = 10;
  handle.swashMaterialV5Installed = true;
}

export function createGPUSwashSolver(scene, sampleHeight, waterY, sourceShallow, shoreline) {
  const handle = createBaseSwash(scene, sampleHeight, waterY, sourceShallow, shoreline);
  if (!handle?.gpuSwash) return handle;

  installFoamAgingAndWetness(handle);
  installRealisticSwashMaterial(handle);
  handle.swashVersion = 5;
  console.info("[gpu-swash] ACTIVE v5: advected foam aging + physical wet-sand memory");
  return handle;
}

export function updateGPUSwashSolver(handle, renderer, elapsedTime = 0) {
  if (!handle?.gpuSwash || !renderer || typeof renderer.compute !== "function") return;

  const now = Number.isFinite(elapsedTime) ? elapsedTime : 0;
  let dt = 1 / 60;
  if (Number.isFinite(handle.fftWetLastElapsed)) {
    dt = THREE.MathUtils.clamp(now - handle.fftWetLastElapsed, 1 / 240, 1 / 30);
  }
  handle.fftWetLastElapsed = now;

  updateBaseSwash(handle, renderer, now);

  if (handle.fftWetDt) handle.fftWetDt.value = dt;
  for (const node of handle.fftFoamRefineFrame ?? []) renderer.compute(node);
  for (const node of handle.fftWetnessFrame ?? []) renderer.compute(node);
}

export function updateGPUSwashVisuals(handle, cameraY, storm = 0, day = 1) {
  updateBaseVisuals(handle, cameraY, storm, day);
  if (!handle?.gpuSwash) return;
  const dayT = THREE.MathUtils.clamp(day, 0, 1);
  if (handle.wetSandColor?.value) {
    handle.wetSandColor.value.set(0x241f1c).lerp(new THREE.Color(0x6b4c3a), dayT);
  }
}

export function disposeGPUSwashSolver(scene, handle) {
  disposeBaseSwash(scene, handle);
}

export { SWASH_S, SWASH_R, SWASH_OFFSHORE, SWASH_LANDWARD };
