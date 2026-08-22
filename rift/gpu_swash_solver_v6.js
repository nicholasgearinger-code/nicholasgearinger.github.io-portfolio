import * as THREE from "three";
import {
  float, uint, vec2,
  attribute, floor, min, max, abs, mix, clamp, smoothstep, sin,
  positionWorld,
} from "three/tsl";
import {
  createGPUSwashSolver as createBaseSwash,
  updateGPUSwashSolver as updateBaseSwash,
  updateGPUSwashVisuals as updateBaseVisuals,
  disposeGPUSwashSolver as disposeBaseSwash,
  SWASH_S, SWASH_R, SWASH_OFFSHORE, SWASH_LANDWARD,
} from "./gpu_swash_solver_v5.js";

// -----------------------------------------------------------------------------
// Swash v6 — visible beach wash foam, no extra simulation pass.
//
// v5 already owns the physical run-up, transported foam and wet-sand memory.
// This layer only reuses those existing GPU fields to make the shoreline read
// like real aerated swash on pale sand:
//   - a brighter, broader leading foam front,
//   - broken lace carried by run-up/backwash,
//   - a thin receding foam edge on recently wetted sand,
//   - no extra storage buffers or compute dispatches (mobile-safe).
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

export function upgradeSwashFoamV6(handle) {
  if (
    !handle?.gpuSwash ||
    !handle.fftWetness ||
    !handle.material ||
    handle.swashMaterialV6Installed
  ) return handle;

  const material = handle.material;
  const coord = attribute("swashCoord", "vec2");
  const sampled = sampleStrip(handle.state, coord);
  const wetness = sampleStrip(handle.fftWetness, coord);

  const land1 = sampleStrip(
    handle.state,
    vec2(min(coord.x.add(float(1)), float(SWASH_R - 1)), coord.y),
  );
  const land2 = sampleStrip(
    handle.state,
    vec2(min(coord.x.add(float(2)), float(SWASH_R - 1)), coord.y),
  );
  const off1 = sampleStrip(
    handle.state,
    vec2(max(coord.x.sub(float(1)), float(0)), coord.y),
  );
  const off2 = sampleStrip(
    handle.state,
    vec2(max(coord.x.sub(float(2)), float(0)), coord.y),
  );

  const film = smoothstep(float(0.00055), float(0.016), sampled.x);
  const thinFilm = smoothstep(float(0.00045), float(0.0045), sampled.x)
    .mul(float(1).sub(smoothstep(float(0.032), float(0.105), sampled.x)));

  const land1Dry = float(1).sub(smoothstep(float(0.0010), float(0.011), land1.x));
  const land2Dry = float(1).sub(smoothstep(float(0.0010), float(0.012), land2.x));
  const off1Wet = smoothstep(float(0.0017), float(0.019), off1.x);
  const off2Wet = smoothstep(float(0.0017), float(0.020), off2.x);

  const front1 = film.mul(land1Dry).mul(off1Wet);
  const front2 = film.mul(land2Dry).mul(max(off1Wet, off2Wet.mul(0.82))).mul(0.64);
  const wetFront = max(front1, front2);

  const runup = smoothstep(float(0.030), float(0.44), max(sampled.y, float(0)));
  const backwash = smoothstep(float(0.028), float(0.40), max(sampled.y.negate(), float(0)));
  const speed = abs(sampled.y).add(abs(sampled.z).mul(0.30));
  const moving = smoothstep(float(0.018), float(0.30), speed).mul(film);
  const transported = smoothstep(float(0.028), float(0.48), sampled.w).mul(film);

  // Put a little foam on the sand-side of the waterline as the sheet retreats.
  // This uses the existing persistent wetness field, so it follows where the
  // solved swash actually went instead of drawing a fixed shoreline stripe.
  const mostlyDry = float(1).sub(film.mul(0.94));
  const wetMemory = smoothstep(float(0.08), float(0.84), wetness);
  const recedingEdge = wetMemory
    .mul(mostlyDry)
    .mul(max(off1Wet, off2Wet.mul(0.62)))
    .mul(float(0.30).add(backwash.mul(0.42)));

  const leadingWhite = wetFront.mul(float(0.70).add(runup.mul(0.25)));
  const carriedWhite = transported.mul(
    float(0.10)
      .add(moving.mul(0.67))
      .add(runup.mul(0.20))
      .add(backwash.mul(0.26)),
  );
  const thinWash = thinFilm
    .mul(max(transported, wetFront.mul(0.78)))
    .mul(float(0.18).add(runup.mul(0.46)).add(backwash.mul(0.24)));

  const t = handle.swashTime;
  const laceA = abs(sin(
    positionWorld.x.mul(1.61)
      .add(positionWorld.z.mul(0.93))
      .add(t.mul(0.39)),
  ));
  const laceB = abs(sin(
    positionWorld.x.mul(0.79)
      .sub(positionWorld.z.mul(1.73))
      .sub(t.mul(0.27))
      .add(1.7),
  ));
  const laceC = abs(sin(
    positionWorld.x.mul(2.23)
      .add(positionWorld.z.mul(0.47))
      .add(t.mul(0.19))
      .add(3.1),
  ));
  const lace = smoothstep(
    float(0.25),
    float(0.84),
    laceA.mul(0.46).add(laceB.mul(0.34)).add(laceC.mul(0.20)),
  );

  let foam = clamp(
    max(max(leadingWhite, carriedWhite), max(thinWash, recedingEdge)),
    0,
    0.96,
  );
  foam = foam.mul(float(0.62).add(lace.mul(0.38)));

  // A faint, broken residue remains on wet sand just behind the retreating line.
  const residue = wetMemory
    .mul(mostlyDry)
    .mul(float(1).sub(off1Wet.mul(0.82)))
    .mul(lace)
    .mul(0.11);
  foam = clamp(max(foam, residue), 0, 0.96);

  const wetDry = smoothstep(float(0.035), float(0.92), wetness)
    .mul(float(1).sub(film.mul(0.92)));

  const waterOpacity = film.mul(
    float(0.020)
      .add(smoothstep(float(0.008), float(0.14), sampled.x).mul(0.065)),
  );
  const wetOpacity = wetDry.mul(float(0.12).add(handle.day.mul(0.030)));
  const foamOpacity = foam.mul(float(0.46).add(handle.day.mul(0.20)));

  const wetBase = mix(handle.wetSandColor, handle.waterColor, film);
  material.colorNode = mix(wetBase, handle.foamColor, foam.mul(0.985));
  const baseRoughness = mix(
    float(0.24),
    float(0.090).add(handle.storm.mul(0.040)),
    film,
  );
  material.roughnessNode = mix(baseRoughness, float(0.66), foam.mul(0.96));
  material.emissiveNode = handle.foamColor.mul(
    foam.mul(float(0.0025).add(handle.day.mul(0.0055))),
  );
  material.opacityNode = clamp(
    waterOpacity
      .add(wetOpacity)
      .add(foamOpacity)
      .mul(float(1).sub(handle.underwater.mul(0.98))),
    0,
    0.82,
  );
  material.needsUpdate = true;

  handle.mesh.renderOrder = 12;
  handle.swashMaterialV6Installed = true;
  handle.swashVersion = 6;
  return handle;
}

export function createGPUSwashSolver(scene, sampleHeight, waterY, sourceShallow, shoreline) {
  const handle = createBaseSwash(scene, sampleHeight, waterY, sourceShallow, shoreline);
  upgradeSwashFoamV6(handle);
  if (handle?.gpuSwash) {
    console.info("[gpu-swash] ACTIVE v6: bright advected beach wash + receding lace foam");
  }
  return handle;
}

export function updateGPUSwashSolver(handle, renderer, elapsedTime = 0) {
  const result = updateBaseSwash(handle, renderer, elapsedTime);
  upgradeSwashFoamV6(handle);
  return result;
}

export function updateGPUSwashVisuals(handle, cameraY, storm = 0, day = 1) {
  const result = updateBaseVisuals(handle, cameraY, storm, day);
  if (!handle?.gpuSwash) return result;
  upgradeSwashFoamV6(handle);

  // Slightly warmer foam in daylight so it reads as sunlit sea foam rather
  // than a pure white UI-like stripe against the sand.
  if (handle.foamColor?.value) {
    const dayT = THREE.MathUtils.clamp(day, 0, 1);
    handle.foamColor.value.set(0xaebbc1).lerp(new THREE.Color(0xfffbef), dayT);
  }
  return result;
}

export function disposeGPUSwashSolver(scene, handle) {
  return disposeBaseSwash(scene, handle);
}

export { SWASH_S, SWASH_R, SWASH_OFFSHORE, SWASH_LANDWARD };
