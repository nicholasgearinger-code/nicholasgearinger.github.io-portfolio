import * as THREE from "three";
import {
  Fn, instanceIndex, instancedArray, uniform, color,
  float, uint, vec2, vec3, vec4,
  positionLocal, positionView, positionWorld,
  attribute, floor, min, max, abs, mix, clamp, smoothstep, sqrt,
  dFdx, dFdy, cross,
} from "three/tsl";

// -----------------------------------------------------------------------------
// Near-shore swash / foam transport solver.
//
// This is intentionally a separate, small finite-depth simulation layered on
// top of the main 256^2 shallow-water field. The offshore edge is relaxed toward
// the real shallow-water solution, then this strip solves run-up / backwash on
// the actual sampled beach slope. Foam is a transported tracer (state.w): it is
// generated only where the flow actually breaks, advected by the solved water
// velocity, and decays while it rides up the beach and returns to the sea.
// -----------------------------------------------------------------------------

const SWASH_S = 192;          // along-shore cells (periodic)
const SWASH_R = 48;           // cross-shore cells (offshore -> landward)
const SWASH_OFFSHORE = 10.0;
const SWASH_LANDWARD = 9.0;
const MAX_RUNUP_HEIGHT = 1.45; // metres/world-units above mean water level
const GRAVITY = 9.81;

function smooth01(t) {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

function interpolateShore(shoreline, u) {
  const count = Math.max(1, shoreline.length - 1);
  const f = ((u % 1) + 1) % 1 * count;
  const i0 = Math.floor(f) % count;
  const i1 = (i0 + 1) % count;
  const t = f - Math.floor(f);
  const a = shoreline[i0], b = shoreline[i1];
  const x = THREE.MathUtils.lerp(a.x, b.x, t);
  const z = THREE.MathUtils.lerp(a.z, b.z, t);
  let outwardX = THREE.MathUtils.lerp(a.outwardX, b.outwardX, t);
  let outwardZ = THREE.MathUtils.lerp(a.outwardZ, b.outwardZ, t);
  const len = Math.hypot(outwardX, outwardZ) || 1;
  outwardX /= len;
  outwardZ /= len;
  return {
    x, z,
    outwardX, outwardZ,
    inwardX: -outwardX,
    inwardZ: -outwardZ,
  };
}

function buildStripData(shoreline, sampleHeight, waterY) {
  const count = SWASH_S * SWASH_R;
  const initial = new Float32Array(count * 4);
  const meta = new Float32Array(count * 4);   // signedDepth, worldX, worldZ, runupPermit
  const basis = new Float32Array(count * 4);  // inwardX, inwardZ, tangentX, tangentZ
  const ground = new Float32Array(count);

  let alongSum = 0;
  for (let s = 0; s < SWASH_S; s++) {
    const a = interpolateShore(shoreline, s / SWASH_S);
    const b = interpolateShore(shoreline, (s + 1) / SWASH_S);
    alongSum += Math.hypot(b.x - a.x, b.z - a.z);
  }
  const alongCell = Math.max(0.45, alongSum / SWASH_S);
  const crossCell = (SWASH_OFFSHORE + SWASH_LANDWARD) / (SWASH_R - 1);

  for (let s = 0; s < SWASH_S; s++) {
    const shore = interpolateShore(shoreline, s / SWASH_S);
    const prev = interpolateShore(shoreline, (s - 1 + SWASH_S) / SWASH_S);
    const next = interpolateShore(shoreline, (s + 1) / SWASH_S);
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;

    for (let r = 0; r < SWASH_R; r++) {
      const t = r / (SWASH_R - 1);
      const radial = THREE.MathUtils.lerp(SWASH_OFFSHORE, -SWASH_LANDWARD, smooth01(t));
      const x = shore.x + shore.outwardX * radial;
      const z = shore.z + shore.outwardZ * radial;
      const g = sampleHeight ? sampleHeight(x, z) : waterY - 2;
      const groundY = Number.isFinite(g) ? g : waterY + MAX_RUNUP_HEIGHT + 1;
      const signedDepth = THREE.MathUtils.clamp(waterY - groundY, -3.0, 12.0);
      const permit = signedDepth > -MAX_RUNUP_HEIGHT ? 1 : 0;
      const h0 = Math.max(0, signedDepth);
      const i = s * SWASH_R + r;

      initial[i * 4] = h0;
      initial[i * 4 + 1] = 0;
      initial[i * 4 + 2] = 0;
      initial[i * 4 + 3] = 0;

      meta[i * 4] = signedDepth;
      meta[i * 4 + 1] = x;
      meta[i * 4 + 2] = z;
      meta[i * 4 + 3] = permit;

      basis[i * 4] = shore.inwardX;
      basis[i * 4 + 1] = shore.inwardZ;
      basis[i * 4 + 2] = tx;
      basis[i * 4 + 3] = tz;
      ground[i] = groundY;
    }
  }

  return { initial, meta, basis, ground, alongCell, crossCell };
}

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
  const r0 = floor(rf), r1 = min(r0.add(1), float(SWASH_R - 1));
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

function buildRenderGeometry(shoreline, sampleHeight, waterY, groundData) {
  const rows = SWASH_S + 1;
  const cols = SWASH_R;
  const vertexCount = rows * cols;
  const positions = new Float32Array(vertexCount * 3);
  const indicesAttr = new Float32Array(vertexCount);
  const coords = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(SWASH_S * (SWASH_R - 1) * 6);

  let v = 0;
  for (let s = 0; s <= SWASH_S; s++) {
    const sw = s % SWASH_S;
    const shore = interpolateShore(shoreline, sw / SWASH_S);
    for (let r = 0; r < SWASH_R; r++) {
      const t = r / (SWASH_R - 1);
      const radial = THREE.MathUtils.lerp(SWASH_OFFSHORE, -SWASH_LANDWARD, smooth01(t));
      const x = shore.x + shore.outwardX * radial;
      const z = shore.z + shore.outwardZ * radial;
      const i = sw * SWASH_R + r;
      const groundY = Number.isFinite(groundData[i])
        ? groundData[i]
        : (sampleHeight ? sampleHeight(x, z) : waterY);

      positions[v * 3] = x;
      positions[v * 3 + 1] = Number.isFinite(groundY) ? groundY : waterY;
      positions[v * 3 + 2] = z;
      indicesAttr[v] = i;
      coords[v * 2] = r;
      coords[v * 2 + 1] = s;
      v++;
    }
  }

  let q = 0;
  for (let s = 0; s < SWASH_S; s++) {
    for (let r = 0; r < SWASH_R - 1; r++) {
      const i0 = s * cols + r;
      const i1 = i0 + 1;
      const i2 = (s + 1) * cols + r;
      const i3 = i2 + 1;
      indices[q++] = i0; indices[q++] = i2; indices[q++] = i1;
      indices[q++] = i1; indices[q++] = i2; indices[q++] = i3;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("swashIndex", new THREE.BufferAttribute(indicesAttr, 1));
  geometry.setAttribute("swashCoord", new THREE.BufferAttribute(coords, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createGPUSwashSolver(scene, sampleHeight, waterY, sourceShallow, shoreline) {
  if (!scene || !sourceShallow?.gpuShallowWater || !shoreline?.length) return null;

  const strip = buildStripData(shoreline, sampleHeight, waterY);
  const count = SWASH_S * SWASH_R;
  const stateA = instancedArray(strip.initial, "vec4");
  const stateB = instancedArray(new Float32Array(count * 4), "vec4");
  const meta = instancedArray(strip.meta, "vec4");
  const basis = instancedArray(strip.basis, "vec4");
  const dtUniform = uniform(1 / 60);

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
    const dt = dtUniform;

    const inv2dx = float(1 / (2 * strip.crossCell));
    const inv2ds = float(1 / (2 * strip.alongCell));
    const invDx = float(1 / strip.crossCell);
    const invDs = float(1 / strip.alongCell);

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

    const thin = float(1).sub(smoothstep(float(0.035), float(0.28), h));
    const drag = float(0.42).add(thin.mul(6.4));
    const damping = float(1).div(float(1).add(drag.mul(dt)));
    uVel = uVel.mul(damping);
    vVel = vVel.mul(damping);

    const sourceState = sampleCartesian(
      sourceShallow.state, mc.y, mc.z, sourceShallow.domain, sourceShallow.N,
    );
    const sourceEta = clamp(sourceState.x, -0.85, 0.85);
    const sourceH = max(mc.x.add(sourceEta.mul(1.55)), float(0));
    const sourceU = sourceState.y.mul(b.x).add(sourceState.z.mul(b.y)).mul(1.22);
    const sourceV = sourceState.y.mul(b.z).add(sourceState.z.mul(b.w));
    const boundary = float(1).sub(smoothstep(float(0), float(3.5), rf));
    h = mix(h, min(sourceH, float(4.0)), boundary.mul(0.34));
    uVel = mix(uVel, sourceU, boundary.mul(0.26));
    vVel = mix(vVel, sourceV, boundary.mul(0.18));

    h = h.mul(mc.w);
    const wet = smoothstep(float(0.006), float(0.055), h).mul(mc.w);

    const celerity = sqrt(float(GRAVITY).mul(max(h, float(0.025))));
    const maxSpeed = min(float(4.2), celerity.mul(0.92).add(0.35));
    uVel = clamp(uVel, maxSpeed.negate(), maxSpeed).mul(wet);
    vVel = clamp(vVel, maxSpeed.negate(), maxSpeed).mul(wet);

    const speed = vec2(uVel, vVel).length();
    const froude = speed.div(max(celerity, float(0.08)));
    const neighborWet = smoothstep(float(0.018), float(0.085), land.x)
      .mul(smoothstep(float(0.018), float(0.085), off.x));
    const surfaceSlope = abs(surfLand.sub(surfOff)).mul(inv2dx).mul(neighborWet);
    const submergedBed = smoothstep(float(0.02), float(0.24), mc.x);
    const breakerDepthBand = smoothstep(float(0.07), float(0.22), h)
      .mul(float(1).sub(smoothstep(float(1.8), float(3.4), h)))
      .mul(submergedBed);
    const breaker = max(
      smoothstep(float(0.52), float(0.88), froude),
      smoothstep(float(0.10), float(0.28), surfaceSlope),
    ).mul(breakerDepthBand);

    const crossSelector = smoothstep(float(-0.035), float(0.035), uVel);
    const alongSelector = smoothstep(float(-0.035), float(0.035), vVel);
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
    foam = mix(foam, foamAverage, min(dt.mul(1.15), float(0.12)));
    const foamDecay = float(1).sub(dt.mul(float(0.24).add(thin.mul(0.16))));
    foam = clamp(foam.mul(max(foamDecay, float(0))), 0, 1);
    foam = max(foam, breaker.mul(float(0.72).add(clamp(speed.mul(0.10), 0, 0.24))));
    foam = mix(foam, sourceState.w, boundary.mul(0.10));
    foam = foam.mul(smoothstep(float(0.003), float(0.028), h));

    const filmKeep = smoothstep(float(0.0025), float(0.010), h);
    h = h.mul(filmKeep);
    uVel = uVel.mul(filmKeep);
    vVel = vVel.mul(filmKeep);
    foam = foam.mul(filmKeep);

    stateB.element(i).assign(vec4(h, uVel, vVel, foam));
  })().compute(count);

  const computeCopy = Fn(() => {
    stateA.element(instanceIndex).assign(stateB.element(instanceIndex));
  })().compute(count);

  const geometry = buildRenderGeometry(shoreline, sampleHeight, waterY, strip.ground);
  const material = new THREE.MeshStandardNodeMaterial({
    color: 0x5ca8ad,
    roughness: 0.14,
    metalness: 0,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const day = uniform(1.0);
  const storm = uniform(0.0);
  const underwater = uniform(0.0);
  const waterColor = uniform(color(0x5ea9ad));
  const foamColor = uniform(color(0xf8fbf7));
  const indexAttr = attribute("swashIndex", "float");
  const coordAttr = attribute("swashCoord", "vec2");

  material.positionNode = Fn(() => {
    const h = stateA.element(indexAttr.toUint()).x;
    return positionLocal.add(vec3(0, h.add(0.018), 0));
  })();

  const viewNormal = Fn(() => cross(dFdx(positionView), dFdy(positionView)).normalize())();
  material.normalNode = viewNormal;

  const sampled = sampleStrip(stateA, coordAttr);
  const sampledMeta = sampleStrip(meta, coordAttr);
  const film = smoothstep(float(0.006), float(0.050), sampled.x);
  const nearShore = float(1).sub(smoothstep(float(2.4), float(4.5), max(sampledMeta.x, float(0))));
  const foam = smoothstep(float(0.045), float(0.62), sampled.w).mul(film);
  const waterBody = film.mul(nearShore).mul(float(1).sub(underwater.mul(0.98)));

  material.colorNode = mix(waterColor, foamColor, foam);
  material.roughnessNode = mix(float(0.10).add(storm.mul(0.05)), float(0.58), foam);
  material.emissiveNode = foamColor.mul(foam.mul(0.012).mul(day));
  material.opacityNode = clamp(
    waterBody.mul(float(0.10).add(smoothstep(float(0.018), float(0.22), sampled.x).mul(0.16)))
      .add(foam.mul(float(0.58).add(day.mul(0.25)))),
    0,
    0.90,
  );

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  scene.add(mesh);

  return {
    gpuSwash: true,
    state: stateA,
    stateScratch: stateB,
    meta,
    basis,
    computeFrame: [computeUpdate, computeCopy],
    dtUniform,
    lastElapsed: null,
    mesh,
    geometry,
    material,
    day,
    storm,
    underwater,
    waterColor,
    foamColor,
    waterY,
    resources: [stateA, stateB, meta, basis],
  };
}

export function updateGPUSwashSolver(handle, renderer, elapsedTime = 0) {
  if (!handle?.gpuSwash || !renderer || typeof renderer.compute !== "function") return;
  let frameDt = 1 / 60;
  if (Number.isFinite(handle.lastElapsed) && Number.isFinite(elapsedTime)) {
    frameDt = THREE.MathUtils.clamp(elapsedTime - handle.lastElapsed, 1 / 240, 1 / 34);
  }
  handle.lastElapsed = Number.isFinite(elapsedTime) ? elapsedTime : 0;
  handle.dtUniform.value = frameDt;
  for (const node of handle.computeFrame) renderer.compute(node);
}

export function updateGPUSwashVisuals(handle, cameraY, storm = 0, day = 1) {
  if (!handle?.gpuSwash) return;
  const underwater = Number.isFinite(cameraY) && cameraY < handle.waterY - 0.10 ? 1 : 0;
  handle.underwater.value = underwater;
  const dayT = THREE.MathUtils.clamp(day, 0, 1);
  const stormT = THREE.MathUtils.clamp(storm, 0, 1);
  handle.day.value = dayT;
  handle.storm.value = stormT;
  handle.waterColor.value.set(0x244f58).lerp(new THREE.Color(0x6fc0c2), dayT);
  handle.foamColor.value.set(0x9aa7a8).lerp(new THREE.Color(0xf9fbf6), dayT);
}

export function disposeGPUSwashSolver(scene, handle) {
  if (!handle?.gpuSwash) return;
  scene?.remove(handle.mesh);
  try { handle.geometry?.dispose?.(); } catch (_) {}
  try { handle.material?.dispose?.(); } catch (_) {}
  for (const resource of handle.resources ?? []) {
    try { resource?.dispose?.(); } catch (_) {}
  }
}

export { SWASH_S, SWASH_R, SWASH_OFFSHORE, SWASH_LANDWARD };
