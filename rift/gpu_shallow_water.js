import * as THREE from "three";
import {
  Fn, instanceIndex, instancedArray, uniform,
  float, uint, vec2, vec4,
  min, max, abs, floor, mix, clamp, smoothstep, sqrt,
} from "three/tsl";

// -----------------------------------------------------------------------------
// GPU shallow-water solver for Coral Shallows' surf zone.
//
// This is deliberately a separate physical regime from the deep-water FFT:
// the FFT remains the correct model offshore, while finite-depth bathymetry,
// horizontal transport, wet/dry damping and breaking are solved here. The
// outer edge is weakly forced from the *actual current FFT displacement* so the
// two simulations are coupled instead of running as unrelated animations.
// -----------------------------------------------------------------------------

export const SHALLOW_N = 128;
export const SHALLOW_DOMAIN = 360;
const GRAVITY = 9.81;

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

  const dtUniform = uniform(1 / 60);
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

    const wet = smoothstep(float(0.025), float(0.22), bc.x);
    const hL = max(bL.add(l.x), float(0.04));
    const hR = max(bR.add(r.x), float(0.04));
    const hD = max(bD.add(d.x), float(0.04));
    const hU = max(bU.add(u.x), float(0.04));

    const inv2dx = float(1 / (2 * cellSize));
    const dt = dtUniform;

    // Conservative height update from the divergence of horizontal volume flux.
    const fluxXR = hR.mul(r.y);
    const fluxXL = hL.mul(l.y);
    const fluxZU = hU.mul(u.z);
    const fluxZD = hD.mul(d.z);
    const dEtaDt = fluxXR.sub(fluxXL).add(fluxZU.sub(fluxZD)).mul(inv2dx).negate();

    // Hydrostatic pressure gradient. Bottom topography enters through h/depth
    // in continuity and through the wet/dry/friction terms below.
    const dEtaDx = r.x.sub(l.x).mul(inv2dx);
    const dEtaDz = u.x.sub(d.x).mul(inv2dx);

    let eta = c.x.add(dEtaDt.mul(dt));
    let velX = c.y.sub(dEtaDx.mul(float(GRAVITY)).mul(dt));
    let velZ = c.z.sub(dEtaDz.mul(float(GRAVITY)).mul(dt));

    // Manning-like shallow friction: weak in deeper water, strong in the swash
    // zone so the beach calms naturally rather than carrying offshore chop onto land.
    const shallowDrag = float(1).sub(smoothstep(float(0.45), float(3.2), bc.x));
    const drag = float(0.16).add(shallowDrag.mul(1.65));
    const damp = float(1).div(float(1).add(drag.mul(dt)));
    velX = velX.mul(damp);
    velZ = velZ.mul(damp);

    // Couple only the outer cells to the current long-wave FFT. Interior cells
    // evolve by the shallow-water equations and bathymetry after the waves enter.
    const edgeX = min(xf, float(N - 1).sub(xf));
    const edgeZ = min(zf, float(N - 1).sub(zf));
    const edgeDist = min(edgeX, edgeZ);
    const boundary = float(1).sub(smoothstep(float(1), float(9), edgeDist));

    const fgx = clamp(bc.y.div(float(fftDomain)).add(0.5), 0, 1).mul(float(127));
    const fgz = clamp(bc.z.div(float(fftDomain)).add(0.5), 0, 1).mul(float(127));
    const fx0f = floor(fgx);
    const fz0f = floor(fgz);
    const fx1f = min(fx0f.add(1), float(127));
    const fz1f = min(fz0f.add(1), float(127));
    const ftx = fgx.sub(fx0f);
    const ftz = fgz.sub(fz0f);
    const frow = uint(128);
    const fi00 = fz0f.toUint().mul(frow).add(fx0f.toUint());
    const fi10 = fz0f.toUint().mul(frow).add(fx1f.toUint());
    const fi01 = fz1f.toUint().mul(frow).add(fx0f.toUint());
    const fi11 = fz1f.toUint().mul(frow).add(fx1f.toUint());
    const fh0 = mix(fftSpatialA.element(fi00).x, fftSpatialA.element(fi10).x, ftx);
    const fh1 = mix(fftSpatialA.element(fi01).x, fftSpatialA.element(fi11).x, ftx);
    const fftEta = mix(fh0, fh1, ftz);
    const coupling = boundary.mul(forcingStrength).mul(smoothstep(float(1.0), float(4.0), bc.x));
    eta = mix(eta, fftEta.mul(0.82), coupling.mul(0.38));

    // Physically motivated breaking indicator. Large relative wave height and
    // supercritical/Froude-like flow in finite depth produce breaking energy.
    const localDepth = max(bc.x.add(eta), float(0.08));
    const speed = vec2(velX, velZ).length();
    const celerity = sqrt(float(GRAVITY).mul(localDepth));
    const froude = speed.div(max(celerity, float(0.05)));
    const relativeHeight = abs(eta).div(max(bc.x, float(0.22)));
    const depthBand = smoothstep(float(0.22), float(0.75), bc.x)
      .mul(float(1).sub(smoothstep(float(4.5), float(7.5), bc.x)));
    const breaker = max(
      smoothstep(float(0.50), float(0.82), relativeHeight),
      smoothstep(float(0.78), float(1.08), froude),
    ).mul(depthBand).mul(wet);

    // Foam is a transported breaking-energy proxy for now. The 3D breaker sheet
    // will consume this same field, so foam and curl originate from one event.
    const foamDecay = max(float(0), float(1).sub(dt.mul(0.62)));
    const foam = max(c.w.mul(foamDecay), breaker);

    // Wet/dry stabilization and a conservative eta clamp keep the mobile solver
    // robust when cells alternately flood and expose during run-up.
    eta = clamp(eta, float(-1.6), float(1.6)).mul(wet);
    velX = clamp(velX, float(-8), float(8)).mul(wet);
    velZ = clamp(velZ, float(-8), float(8)).mul(wet);

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
  let dt = 1 / 60;
  if (Number.isFinite(handle.lastElapsed) && Number.isFinite(elapsedTime)) {
    dt = THREE.MathUtils.clamp(elapsedTime - handle.lastElapsed, 1 / 240, 1 / 50);
  }
  handle.lastElapsed = Number.isFinite(elapsedTime) ? elapsedTime : 0;
  handle.dtUniform.value = dt;

  for (const node of handle.computeFrame) renderer.compute(node);
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
