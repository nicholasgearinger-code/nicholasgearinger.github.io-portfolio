import * as THREE from "three";
import {
  Fn, instanceIndex, instancedArray, uniform,
  float, uint, vec2, vec4,
  min, max, abs, floor, mix, clamp, smoothstep, sqrt,
} from "three/tsl";

// -----------------------------------------------------------------------------
// Stable GPU shallow-water solver for Coral Shallows' surf zone.
//
// The previous centered FTCS-like update was prone to odd/even numerical modes:
// neighboring cells could grow with opposite signs and the render mesh exposed
// those modes as giant folded triangles. This version uses a Lax-Friedrichs
// predictor (neighbor averaging + conservative flux gradients), which adds the
// numerical diffusion required by a mobile real-time shallow-water solver.
// Two small substeps are dispatched per rendered frame for a safer CFL margin.
// -----------------------------------------------------------------------------

export const SHALLOW_N = 256;
export const SHALLOW_DOMAIN = 360;
const GRAVITY = 9.81;
const FFT_SOURCE_N = 128;
const SUBSTEPS = 2;

function buildBathymetry(sampleHeight, waterY, domain, N) {
  const data = new Float32Array(N * N * 4);
  for (let z = 0; z < N; z++) {
    const wz = (z / (N - 1) - 0.5) * domain;
    for (let x = 0; x < N; x++) {
      const wx = (x / (N - 1) - 0.5) * domain;
      const i = z * N + x;
      const ground = sampleHeight ? sampleHeight(wx, wz) : waterY - 8;
      const depth = Number.isFinite(ground) ? Math.max(0, waterY - ground) : 0;
      data[i * 4] = Math.min(depth, 24);
      data[i * 4 + 1] = wx;
      data[i * 4 + 2] = wz;
      data[i * 4 + 3] = depth > 0.02 ? 1 : 0;
    }
  }
  return data;
}

export function createGPUShallowWater(sampleHeight, waterY, fftSpatialA, fftDomain, domain = SHALLOW_DOMAIN) {
  if (!fftSpatialA) return null;

  const N = SHALLOW_N;
  const count = N * N;
  const cellSize = domain / (N - 1);
  const bathymetryData = buildBathymetry(sampleHeight, waterY, domain, N);
  const zeroState = new Float32Array(count * 4);

  // state = eta, velocityX, velocityZ, breakingFoam
  const stateA = instancedArray(zeroState, "vec4");
  const stateB = instancedArray(new Float32Array(count * 4), "vec4");
  const bathymetry = instancedArray(bathymetryData, "vec4");

  const dtUniform = uniform(1 / 120);
  const forcingStrength = uniform(1.0);

  const computeUpdate = Fn(() => {
    const i = instanceIndex;
    const x = i.mod(uint(N));
    const z = i.div(uint(N));
    const xf = x.toFloat();
    const zf = z.toFloat();

    const xL = max(xf.sub(1), float(0)).toUint();
    const xR = min(xf.add(1), float(N - 1)).toUint();
    const zD = max(zf.sub(1), float(0)).toUint();
    const zU = min(zf.add(1), float(N - 1)).toUint();
    const row = uint(N);

    const iL = z.mul(row).add(xL);
    const iR = z.mul(row).add(xR);
    const iD = zD.mul(row).add(x);
    const iU = zU.mul(row).add(x);

    const c = stateA.element(i);
    const l = stateA.element(iL);
    const r = stateA.element(iR);
    const d = stateA.element(iD);
    const u = stateA.element(iU);

    const bc = bathymetry.element(i);
    const bL = bathymetry.element(iL).x;
    const bR = bathymetry.element(iR).x;
    const bD = bathymetry.element(iD).x;
    const bU = bathymetry.element(iU).x;

    const wet = smoothstep(float(0.05), float(0.34), bc.x);
    const hL = max(bL.add(l.x), float(0.05));
    const hR = max(bR.add(r.x), float(0.05));
    const hD = max(bD.add(d.x), float(0.05));
    const hU = max(bU.add(u.x), float(0.05));

    const inv2dx = float(1 / (2 * cellSize));
    const dt = dtUniform;

    // Lax-Friedrichs predictor: average opposite neighbors before applying the
    // conservative flux gradient. This deliberately damps the grid-scale mode
    // that caused alternating spikes in the old centered update.
    const etaAverage = l.x.add(r.x).add(d.x).add(u.x).mul(0.25);
    const velXAverage = l.y.add(r.y).add(d.y).add(u.y).mul(0.25);
    const velZAverage = l.z.add(r.z).add(d.z).add(u.z).mul(0.25);

    const fluxXR = hR.mul(r.y);
    const fluxXL = hL.mul(l.y);
    const fluxZU = hU.mul(u.z);
    const fluxZD = hD.mul(d.z);
    const divergence = fluxXR.sub(fluxXL).add(fluxZU.sub(fluxZD)).mul(inv2dx);

    const surfaceL = bL.add(l.x);
    const surfaceR = bR.add(r.x);
    const surfaceD = bD.add(d.x);
    const surfaceU = bU.add(u.x);
    // Because b stores still-water depth rather than bed elevation, free-surface
    // pressure is driven by eta. Keep bathymetry out of this gradient to avoid
    // accelerating water down a fictitious depth slope at rest.
    const dEtaDx = r.x.sub(l.x).mul(inv2dx);
    const dEtaDz = u.x.sub(d.x).mul(inv2dx);

    let eta = etaAverage.sub(divergence.mul(dt));
    let velX = velXAverage.sub(dEtaDx.mul(float(GRAVITY)).mul(dt));
    let velZ = velZAverage.sub(dEtaDz.mul(float(GRAVITY)).mul(dt));

    // Depth-dependent bottom drag. Dry and very shallow cells are heavily
    // damped so they cannot accumulate fast velocities that later explode when
    // a wet front reaches them.
    const shallowDrag = float(1).sub(smoothstep(float(0.55), float(3.8), bc.x));
    const drag = float(0.34).add(shallowDrag.mul(2.6));
    const damp = float(1).div(float(1).add(drag.mul(dt)));
    velX = velX.mul(damp);
    velZ = velZ.mul(damp);

    // Weak boundary coupling to the current FFT elevation. The forcing is kept
    // gentle because the Lax-Friedrichs solver then transports that energy into
    // the surf zone instead of stamping the FFT field directly onto the beach.
    const edgeX = min(xf, float(N - 1).sub(xf));
    const edgeZ = min(zf, float(N - 1).sub(zf));
    const edgeDist = min(edgeX, edgeZ);
    const boundary = float(1).sub(smoothstep(float(3), float(22), edgeDist));

    const fgx = clamp(bc.y.div(float(fftDomain)).add(0.5), 0, 1).mul(float(FFT_SOURCE_N - 1));
    const fgz = clamp(bc.z.div(float(fftDomain)).add(0.5), 0, 1).mul(float(FFT_SOURCE_N - 1));
    const fx0f = floor(fgx);
    const fz0f = floor(fgz);
    const fx1f = min(fx0f.add(1), float(FFT_SOURCE_N - 1));
    const fz1f = min(fz0f.add(1), float(FFT_SOURCE_N - 1));
    const ftx = fgx.sub(fx0f);
    const ftz = fgz.sub(fz0f);
    const frow = uint(FFT_SOURCE_N);
    const fi00 = fz0f.toUint().mul(frow).add(fx0f.toUint());
    const fi10 = fz0f.toUint().mul(frow).add(fx1f.toUint());
    const fi01 = fz1f.toUint().mul(frow).add(fx0f.toUint());
    const fi11 = fz1f.toUint().mul(frow).add(fx1f.toUint());
    const fh0 = mix(fftSpatialA.element(fi00).x, fftSpatialA.element(fi10).x, ftx);
    const fh1 = mix(fftSpatialA.element(fi01).x, fftSpatialA.element(fi11).x, ftx);
    const fftEta = mix(fh0, fh1, ftz);
    const coupling = boundary.mul(forcingStrength).mul(smoothstep(float(1.4), float(5.0), bc.x));
    eta = mix(eta, fftEta.mul(0.46), coupling.mul(0.16));

    // Physically plausible local safety envelope. A shallow cell should never
    // receive a metre-scale elevation jump in one update. The depth-relative
    // bound removes catastrophic folds while still allowing real shoaling.
    const etaLimit = min(float(0.95), bc.x.mul(0.34).add(0.10));
    eta = clamp(eta, etaLimit.negate(), etaLimit);

    const localDepth = max(bc.x.add(eta), float(0.08));
    const celerity = sqrt(float(GRAVITY).mul(localDepth));
    const maxSpeed = min(float(4.8), celerity.mul(0.78).add(0.45));
    velX = clamp(velX, maxSpeed.negate(), maxSpeed);
    velZ = clamp(velZ, maxSpeed.negate(), maxSpeed);

    const speed = vec2(velX, velZ).length();
    const froude = speed.div(max(celerity, float(0.08)));
    const relativeHeight = abs(eta).div(max(bc.x, float(0.30)));
    const depthBand = smoothstep(float(0.28), float(0.95), bc.x)
      .mul(float(1).sub(smoothstep(float(4.0), float(7.0), bc.x)));
    const breaker = max(
      smoothstep(float(0.38), float(0.68), relativeHeight),
      smoothstep(float(0.62), float(0.90), froude),
    ).mul(depthBand).mul(wet);

    const foamDecay = max(float(0), float(1).sub(dt.mul(0.48)));
    const foam = max(c.w.mul(foamDecay), breaker);

    eta = eta.mul(wet);
    velX = velX.mul(wet);
    velZ = velZ.mul(wet);
    stateB.element(i).assign(vec4(eta, velX, velZ, foam));
  })().compute(count);

  const computeCopy = Fn(() => {
    stateA.element(instanceIndex).assign(stateB.element(instanceIndex));
  })().compute(count);

  return {
    gpuShallowWater: true,
    N,
    domain,
    waterY,
    cellSize,
    state: stateA,
    stateScratch: stateB,
    bathymetry,
    dtUniform,
    forcingStrength,
    computeFrame: [computeUpdate, computeCopy],
    lastElapsed: null,
    resources: [stateA, stateB, bathymetry],
  };
}

export function updateGPUShallowWater(handle, renderer, elapsedTime = 0) {
  if (!handle?.gpuShallowWater || !renderer || typeof renderer.compute !== "function") return;
  let frameDt = 1 / 60;
  if (Number.isFinite(handle.lastElapsed) && Number.isFinite(elapsedTime)) {
    frameDt = THREE.MathUtils.clamp(elapsedTime - handle.lastElapsed, 1 / 240, 1 / 45);
  }
  handle.lastElapsed = Number.isFinite(elapsedTime) ? elapsedTime : 0;
  handle.dtUniform.value = frameDt / SUBSTEPS;

  for (let substep = 0; substep < SUBSTEPS; substep++) {
    for (const node of handle.computeFrame) renderer.compute(node);
  }
}

export function disposeGPUShallowWater(handle) {
  if (!handle?.gpuShallowWater) return;
  for (const resource of handle.resources ?? []) {
    try {
      if (resource && typeof resource.dispose === "function") resource.dispose();
    } catch (err) {
      console.warn("[gpu-shallow-water] buffer disposal skipped:", err);
    }
  }
}
