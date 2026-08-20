import * as THREE from "three";
import {
  Fn, instanceIndex, uniform, float, uint, vec2, vec4,
  attribute, floor, min, max, abs, mix, clamp, smoothstep, sqrt, sin,
} from "three/tsl";
import {
  createGPUSwashSolver as createBaseSwash,
  updateGPUSwashVisuals as updateBaseVisuals,
  disposeGPUSwashSolver as disposeBaseSwash,
  SWASH_S, SWASH_R, SWASH_OFFSHORE, SWASH_LANDWARD,
} from "./gpu_swash_solver.js";

const GRAVITY = 9.81;
const RUNUP_LIMIT = 2.60;
const CROSS_CELL = (SWASH_OFFSHORE + SWASH_LANDWARD) / (SWASH_R - 1);

function smoothWeight(t) {
  return t.mul(t).mul(float(3).sub(t.mul(2)));
}

function sampleCartesian(buffer, worldX, worldZ, domain, N) {
  const gx = clamp(worldX.div(float(domain)).add(0.5), 0, 1).mul(float(N - 1));
  const gz = clamp(worldZ.div(float(domain)).add(0.5), 0, 1).mul(float(N - 1));
  const x0 = floor(gx), z0 = floor(gz);
  const x1 = min(x0.add(1), float(N - 1));
  const z1 = min(z0.add(1), float(N - 1));
  const tx = smoothWeight(gx.sub(x0)), tz = smoothWeight(gz.sub(z0));
  const row = uint(N);
  const i00 = z0.toUint().mul(row).add(x0.toUint());
  const i10 = z0.toUint().mul(row).add(x1.toUint());
  const i01 = z1.toUint().mul(row).add(x0.toUint());
  const i11 = z1.toUint().mul(row).add(x1.toUint());
  return mix(
    mix(buffer.element(i00), buffer.element(i10), tx),
    mix(buffer.element(i01), buffer.element(i11), tx),
    tz,
  );
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

function computeAlongCell(shoreline) {
  if (!Array.isArray(shoreline) || shoreline.length < 2) return 1.0;
  let sum = 0;
  const count = Math.min(SWASH_S, shoreline.length - 1);
  for (let i = 0; i < count; i++) {
    const a = shoreline[i];
    const b = shoreline[(i + 1) % count];
    if (!a || !b) continue;
    sum += Math.hypot((b.x ?? 0) - (a.x ?? 0), (b.z ?? 0) - (a.z ?? 0));
  }
  return Math.max(0.45, sum / Math.max(1, count));
}

function installRunupSolver(handle, sourceShallow, shoreline) {
  if (!handle?.gpuSwash || !sourceShallow?.gpuShallowWater) return;

  const count = SWASH_S * SWASH_R;
  const stateA = handle.state;
  const stateB = handle.stateScratch;
  const meta = handle.meta;
  const basis = handle.basis;
  const alongCell = computeAlongCell(shoreline);
  const swashTime = uniform(0.0);
  handle.swashTime = swashTime;

  const computeUpdate = Fn(() => {
    const i = instanceIndex;
    const row = uint(SWASH_R);
    const r = i.mod(row);
    const s = i.div(row);
    const rf = r.toFloat();

    const rOff = max(rf.sub(1), float(0)).toUint();
    const rLand = min(rf.add(1), float(SWASH_R - 1)).toUint();
    const sLeft = s.add(uint(SWASH_S - 1)).mod(uint(SWASH_S));
    const sRight = s.add(uint(1)).mod(uint(SWASH_S));

    const iOff = s.mul(row).add(rOff);
    const iLand = s.mul(row).add(rLand);
    const iLeft = sLeft.mul(row).add(r);
    const iRight = sRight.mul(row).add(r);

    const c = stateA.element(i);
    const off = stateA.element(iOff);
    const land = stateA.element(iLand);
    const left = stateA.element(iLeft);
    const right = stateA.element(iRight);

    const mc = meta.element(i);
    const mOff = meta.element(iOff);
    const mLand = meta.element(iLand);
    const mLeft = meta.element(iLeft);
    const mRight = meta.element(iRight);
    const b = basis.element(i);

    const dt = handle.dtUniform;
    const inv2dx = float(1 / (2 * CROSS_CELL));
    const inv2ds = float(1 / (2 * alongCell));
    const invDx = float(1 / CROSS_CELL);
    const invDs = float(1 / alongCell);

    const permit = smoothstep(float(-RUNUP_LIMIT), float(-RUNUP_LIMIT + 0.34), mc.x);

    const hAvg = off.x.add(land.x).add(left.x).add(right.x).mul(0.25);
    const uAvg = off.y.add(land.y).add(left.y).add(right.y).mul(0.25);
    const vAvg = off.z.add(land.z).add(left.z).add(right.z).mul(0.25);

    const fluxLand = land.x.mul(land.y);
    const fluxOff = off.x.mul(off.y);
    const fluxRight = right.x.mul(right.z);
    const fluxLeft = left.x.mul(left.z);
    const divergence = fluxLand.sub(fluxOff).mul(inv2dx)
      .add(fluxRight.sub(fluxLeft).mul(inv2ds));

    const surfLand = land.x.sub(mLand.x);
    const surfOff = off.x.sub(mOff.x);
    const surfRight = right.x.sub(mRight.x);
    const surfLeft = left.x.sub(mLeft.x);
    const dSurfCross = surfLand.sub(surfOff).mul(inv2dx);
    const dSurfAlong = surfRight.sub(surfLeft).mul(inv2ds);

    let h = max(hAvg.sub(divergence.mul(dt)), float(0));
    let uVel = uAvg.sub(dSurfCross.mul(float(GRAVITY)).mul(dt));
    let vVel = vAvg.sub(dSurfAlong.mul(float(GRAVITY)).mul(dt));

    const thin = float(1).sub(smoothstep(float(0.007), float(0.15), h));
    const drag = float(0.28).add(thin.mul(2.10));
    const damping = float(1).div(float(1).add(drag.mul(dt)));
    uVel = uVel.mul(damping);
    vVel = vVel.mul(damping);

    const sourceState = sampleCartesian(
      sourceShallow.state, mc.y, mc.z, sourceShallow.domain, sourceShallow.N,
    );
    const sourceEta = clamp(sourceState.x, -0.90, 0.90);
    const sourceBreak = clamp(sourceState.w, 0, 1);

    const alongPhase = s.toFloat().mul(0.017);
    const wa = sin(swashTime.mul(0.83).add(alongPhase));
    const wb = sin(swashTime.mul(1.17).sub(alongPhase.mul(0.37)).add(1.93));
    const wc = sin(swashTime.mul(0.47).add(alongPhase.mul(0.21)).add(4.11));
    const waveSignal = clamp(wa.mul(0.52).add(wb.mul(0.30)).add(wc.mul(0.18)), -1, 1);
    const crestPulse = smoothstep(float(0.18), float(0.82), waveSignal);
    const troughPulse = smoothstep(float(0.18), float(0.80), waveSignal.negate());

    const sourceH = max(
      mc.x
        .add(sourceEta.mul(1.72))
        .add(crestPulse.mul(0.13))
        .sub(troughPulse.mul(0.035)),
      float(0),
    );
    const baseSourceU = sourceState.y.mul(b.x).add(sourceState.z.mul(b.y)).mul(1.36);
    const sourceU = baseSourceU
      .add(crestPulse.mul(0.70))
      .sub(troughPulse.mul(0.16));
    const sourceV = sourceState.y.mul(b.z).add(sourceState.z.mul(b.w));
    const boundary = float(1).sub(smoothstep(float(0), float(5.2), rf));

    const targetH = min(sourceH.add(sourceBreak.mul(0.065)), float(4.2));
    const targetU = sourceU.add(sourceBreak.mul(0.34));
    h = mix(h, targetH, boundary.mul(0.54));
    uVel = mix(uVel, targetU, boundary.mul(0.46));
    vVel = mix(vVel, sourceV, boundary.mul(0.18));

    const beachHeight = max(mc.x.negate(), float(0));
    const slopeDrain = smoothstep(float(0.05), float(1.75), beachHeight)
      .mul(thin)
      .mul(float(0.56));
    uVel = uVel.sub(slopeDrain.mul(dt));

    h = h.mul(permit);
    const wet = smoothstep(float(0.0009), float(0.010), h).mul(permit);

    const celerity = sqrt(float(GRAVITY).mul(max(h, float(0.010))));
    const maxSpeed = min(float(4.6), celerity.mul(1.10).add(0.56));
    uVel = clamp(uVel, maxSpeed.negate(), maxSpeed).mul(wet);
    vVel = clamp(vVel, maxSpeed.negate(), maxSpeed).mul(wet);

    const speed = vec2(uVel, vVel).length();
    const froude = speed.div(max(celerity, float(0.07)));
    const offshoreWet = smoothstep(float(0.0025), float(0.026), off.x);
    const landDry = float(1).sub(smoothstep(float(0.0012), float(0.011), land.x));
    const wetFront = wet.mul(offshoreWet).mul(landDry);
    const shallowBand = float(1).sub(smoothstep(float(0.52), float(1.45), h));
    const hydraulicBreak = smoothstep(float(0.56), float(0.94), froude)
      .mul(shallowBand)
      .mul(wet);

    const crossSelector = smoothstep(float(-0.022), float(0.022), uVel);
    const alongSelector = smoothstep(float(-0.022), float(0.022), vVel);
    const dFoamCross = mix(
      land.w.sub(c.w),
      c.w.sub(off.w),
      crossSelector,
    ).mul(invDx);
    const dFoamAlong = mix(
      right.w.sub(c.w),
      c.w.sub(left.w),
      alongSelector,
    ).mul(invDs);

    let foam = c.w.sub(
      uVel.mul(dFoamCross).add(vVel.mul(dFoamAlong)).mul(dt),
    );

    const foamAverage = off.w.add(land.w).add(left.w).add(right.w).mul(0.25);
    foam = mix(foam, foamAverage, min(dt.mul(0.28), float(0.035)));
    const foamDecay = max(float(0), float(1).sub(dt.mul(0.30)));
    foam = clamp(foam.mul(foamDecay), 0, 1);

    const advancing = smoothstep(float(0.045), float(0.66), max(uVel, float(0)));
    const frontFoam = wetFront.mul(float(0.52).add(advancing.mul(0.30)));
    const boreFoam = hydraulicBreak.mul(float(0.38).add(clamp(speed.mul(0.12), 0, 0.28)));
    const incomingFoam = sourceBreak.mul(boundary).mul(0.30)
      .add(crestPulse.mul(boundary).mul(0.10));
    foam = max(foam, frontFoam);
    foam = max(foam, boreFoam);
    foam = max(foam, incomingFoam);

    const filmKeep = smoothstep(float(0.0006), float(0.0038), h);
    h = h.mul(filmKeep);
    uVel = uVel.mul(filmKeep);
    vVel = vVel.mul(filmKeep);
    foam = foam.mul(smoothstep(float(0.00045), float(0.0028), h));

    stateB.element(i).assign(vec4(h, uVel, vVel, clamp(foam, 0, 1)));
  })().compute(count);

  const computeCopy = Fn(() => {
    stateA.element(instanceIndex).assign(stateB.element(instanceIndex));
  })().compute(count);

  handle.computeFrame = [computeUpdate, computeCopy];
  handle.swashVersion = 4;
  handle.runupLimit = RUNUP_LIMIT;
}

function installFoamRendering(handle) {
  if (!handle?.gpuSwash) return;

  const material = handle.material;
  const coord = attribute("swashCoord", "vec2");
  const sampled = sampleStrip(handle.state, coord);
  const sampledMeta = sampleStrip(handle.meta, coord);
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
  const speed = abs(sampled.y).add(abs(sampled.z).mul(0.28));
  const moving = smoothstep(float(0.025), float(0.36), speed).mul(film);

  const transported = smoothstep(float(0.035), float(0.56), sampled.w).mul(film);
  const leadingWhite = wetFront.mul(float(0.48).add(runup.mul(0.24)));
  const activeTransport = transported.mul(
    float(0.08)
      .add(moving.mul(0.56))
      .add(runup.mul(0.18))
      .add(backwash.mul(0.22)),
  );
  const faintResidue = transported.mul(float(0.08)).mul(float(1).sub(moving.mul(0.72)));
  const foam = clamp(max(max(leadingWhite, activeTransport), faintResidue), 0, 0.88);

  const aboveMeanSand = smoothstep(
    float(0.02),
    float(RUNUP_LIMIT),
    max(sampledMeta.x.negate(), float(0)),
  );
  const waterOpacity = film.mul(
    float(0.028)
      .add(smoothstep(float(0.009), float(0.13), sampled.x).mul(0.075))
      .add(aboveMeanSand.mul(0.012)),
  );

  material.colorNode = mix(handle.waterColor, handle.foamColor, foam.mul(0.88));
  material.roughnessNode = mix(
    float(0.10).add(handle.storm.mul(0.035)),
    float(0.58),
    foam,
  );
  material.emissiveNode = handle.foamColor.mul(
    foam.mul(float(0.008).add(handle.day.mul(0.012))),
  );
  material.opacityNode = clamp(
    waterOpacity
      .add(foam.mul(float(0.31).add(handle.day.mul(0.18))))
      .mul(float(1).sub(handle.underwater.mul(0.98))),
    0,
    0.68,
  );
  material.needsUpdate = true;
  handle.mesh.renderOrder = 10;
}

export function createGPUSwashSolver(scene, sampleHeight, waterY, sourceShallow, shoreline) {
  const handle = createBaseSwash(scene, sampleHeight, waterY, sourceShallow, shoreline);
  if (!handle?.gpuSwash) return handle;

  installRunupSolver(handle, sourceShallow, shoreline);
  installFoamRendering(handle);

  console.info("[gpu-swash] ACTIVE v4: continuous run-up/backwash + advected translucent foam");
  return handle;
}

export function updateGPUSwashSolver(handle, renderer, elapsedTime = 0) {
  if (!handle?.gpuSwash || !renderer || typeof renderer.compute !== "function") return;

  const time = Number.isFinite(elapsedTime) ? elapsedTime : 0;
  if (handle.swashTime) handle.swashTime.value = time;

  let frameDt = 1 / 60;
  if (Number.isFinite(handle.lastElapsed) && Number.isFinite(elapsedTime)) {
    frameDt = THREE.MathUtils.clamp(elapsedTime - handle.lastElapsed, 1 / 240, 1 / 38);
  }
  handle.lastElapsed = time;

  const substeps = (typeof window !== "undefined" && window.__riftReducedEffects === true) ? 1 : 2;
  handle.dtUniform.value = frameDt / substeps;
  for (let substep = 0; substep < substeps; substep++) {
    for (const node of handle.computeFrame) renderer.compute(node);
  }
}

export function updateGPUSwashVisuals(handle, cameraY, storm = 0, day = 1) {
  updateBaseVisuals(handle, cameraY, storm, day);
}

export function disposeGPUSwashSolver(scene, handle) {
  if (handle) handle.swashTime = null;
  disposeBaseSwash(scene, handle);
}

export { SWASH_S, SWASH_R, SWASH_OFFSHORE, SWASH_LANDWARD };
