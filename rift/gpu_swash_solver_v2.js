import {
  Fn, instanceIndex, float, uint, vec2, vec4,
  attribute, floor, min, max, abs, mix, clamp, smoothstep,
} from "three/tsl";
import {
  createGPUSwashSolver as createBaseSwash,
  updateGPUSwashSolver as updateBaseSwash,
  updateGPUSwashVisuals as updateBaseVisuals,
  disposeGPUSwashSolver as disposeBaseSwash,
  SWASH_S, SWASH_R,
} from "./gpu_swash_solver.js";

// -----------------------------------------------------------------------------
// Swash v2: keep the real wetting/drying simulation and transported foam tracer,
// but make whitewater readable at the actual moving wet/dry front. No procedural
// shore mask is introduced here: foam is still stored in and advected with the
// solved swash state. This pass only adds physically motivated foam production at
// the advancing/receding water front and a clearer rendering response.
// -----------------------------------------------------------------------------

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

function installFoamFrontBoost(handle) {
  if (!handle?.gpuSwash || handle.foamFrontBoostInstalled) return;

  const count = SWASH_S * SWASH_R;
  const state = handle.state;

  handle.foamFrontCompute = Fn(() => {
    const i = instanceIndex;
    const row = uint(SWASH_R);
    const r = i.mod(row);
    const s = i.div(row);
    const rf = r.toFloat();

    const rOff = max(rf.sub(1), float(0)).toUint();
    const rLand = min(rf.add(1), float(SWASH_R - 1)).toUint();
    const iOff = s.mul(row).add(rOff);
    const iLand = s.mul(row).add(rLand);

    const c = state.element(i);
    const off = state.element(iOff);
    const land = state.element(iLand);

    const wet = smoothstep(float(0.0025), float(0.030), c.x);
    const landDry = float(1).sub(smoothstep(float(0.003), float(0.024), land.x));
    const offshoreWet = smoothstep(float(0.006), float(0.055), off.x);

    // Positive cross-shore velocity is landward in the swash basis. Generate a
    // strong white leading edge while the film advances, but retain a smaller
    // amount during backwash so the same transported foam visibly returns.
    const runup = smoothstep(float(0.055), float(0.62), max(c.y, float(0)));
    const backwash = smoothstep(float(0.055), float(0.58), max(c.y.negate(), float(0)));
    const speed = abs(c.y).add(abs(c.z).mul(0.32));
    const movingFilm = smoothstep(float(0.045), float(0.52), speed).mul(wet);
    const front = wet.mul(landDry).mul(offshoreWet);

    const advancingFoam = front.mul(float(0.62).add(runup.mul(0.36)));
    const returningFoam = c.w.mul(backwash).mul(0.22);
    const shearFoam = movingFilm.mul(0.13);

    // The base solver already handles physical breaker production + advection.
    // This retention only keeps the tracer readable long enough to travel across
    // exposed sand with the thin film instead of visually disappearing instantly.
    let foam = c.w.mul(0.997);
    foam = max(foam, advancingFoam);
    foam = max(foam, returningFoam);
    foam = max(foam, shearFoam);
    foam = clamp(foam, 0, 1);

    state.element(i).assign(vec4(c.x, c.y, c.z, foam));
  })().compute(count);

  // Rebuild only the visual response on the existing mesh. The geometry and its
  // positionNode remain driven by the solved water depth from the base swash.
  const material = handle.material;
  const coord = attribute("swashCoord", "vec2");
  const sampled = sampleStrip(handle.state, coord);
  const sampledMeta = sampleStrip(handle.meta, coord);
  const landSample = sampleStrip(handle.state, vec2(min(coord.x.add(1), float(SWASH_R - 1)), coord.y));
  const offSample = sampleStrip(handle.state, vec2(max(coord.x.sub(1), float(0)), coord.y));

  const film = smoothstep(float(0.0025), float(0.042), sampled.x);
  const transported = smoothstep(float(0.018), float(0.48), sampled.w).mul(film);
  const nextDry = float(1).sub(smoothstep(float(0.003), float(0.024), landSample.x));
  const front = film
    .mul(nextDry)
    .mul(smoothstep(float(0.006), float(0.050), offSample.x));
  const runup = smoothstep(float(0.055), float(0.58), max(sampled.y, float(0)));
  const backwash = smoothstep(float(0.055), float(0.56), max(sampled.y.negate(), float(0)));
  const motion = smoothstep(
    float(0.040),
    float(0.48),
    abs(sampled.y).add(abs(sampled.z).mul(0.30)),
  ).mul(film);

  const leadingWhite = front.mul(float(0.68).add(runup.mul(0.30)));
  const movingWhite = transported.mul(float(0.78).add(motion.mul(0.22)));
  const returningWhite = transported.mul(backwash).mul(0.18);
  const foam = clamp(max(max(leadingWhite, movingWhite), returningWhite), 0, 1);

  // Keep shallow water transparent enough that the sand remains visible while
  // allowing bright whitewater to sit clearly on top of the moving water film.
  const beachFilm = film.mul(
    float(1).sub(smoothstep(float(1.8), float(4.0), max(sampledMeta.x, float(0)))),
  );
  const waterOpacity = beachFilm.mul(
    float(0.07).add(smoothstep(float(0.018), float(0.18), sampled.x).mul(0.11)),
  );

  material.colorNode = mix(handle.waterColor, handle.foamColor, foam);
  material.roughnessNode = mix(
    float(0.12).add(handle.storm.mul(0.04)),
    float(0.62),
    foam,
  );
  material.emissiveNode = handle.foamColor.mul(foam.mul(float(0.022).add(handle.day.mul(0.018))));
  material.opacityNode = clamp(
    waterOpacity
      .add(foam.mul(float(0.70).add(handle.day.mul(0.24))))
      .mul(float(1).sub(handle.underwater.mul(0.98))),
    0,
    0.96,
  );
  material.needsUpdate = true;

  handle.foamFrontBoostInstalled = true;
}

export function createGPUSwashSolver(scene, sampleHeight, waterY, sourceShallow, shoreline) {
  const handle = createBaseSwash(scene, sampleHeight, waterY, sourceShallow, shoreline);
  if (!handle?.gpuSwash) return handle;
  installFoamFrontBoost(handle);
  return handle;
}

export function updateGPUSwashSolver(handle, renderer, elapsedTime = 0) {
  if (!handle?.gpuSwash) return;
  updateBaseSwash(handle, renderer, elapsedTime);
  if (handle.foamFrontCompute && renderer && typeof renderer.compute === "function") {
    renderer.compute(handle.foamFrontCompute);
  }
}

export function updateGPUSwashVisuals(handle, cameraY, storm = 0, day = 1) {
  updateBaseVisuals(handle, cameraY, storm, day);
}

export function disposeGPUSwashSolver(scene, handle) {
  if (handle) {
    handle.foamFrontCompute = null;
    handle.foamFrontBoostInstalled = false;
  }
  disposeBaseSwash(scene, handle);
}

export { SWASH_S, SWASH_R };
