// Fluid V8 M8.7.4 — physically driven vessel boundaries.
//
// The liquid has no pitcher/free/glass state machine. It is ordinary PBF water under gravity.
// The pitcher and receiving glass are geometric collision boundaries projected directly into
// every PBF substep: once after prediction and once after each density-correction iteration.
// Openings are real holes in those boundaries, so geometry + gravity alone decide when water
// leaves the pitcher, enters the spout, falls through the air, and is retained by the glass.

import {
  sim, ui, ssfr, dev, queue, scene, pitcher, glass, profile, pitcherPoint, spoutPath
} from './v5-pitcher-fluid-physics-m872.js';

const api = window.__v5M872Scene;
if (!sim?.dev || !ui || !api?.online) throw new Error('M8.7.4 physical vessel: M8.7.2 scene unavailable.');

const nativeStep = sim.step.bind(sim);
const baseCreate = dev.createCommandEncoder.bind(dev);
let inStep = false;
let passes = 0;
let resets = 0;

const smooth = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

function bodyRadius(y) {
  if (y <= profile[0][0]) return profile[0][1];
  if (y >= profile.at(-1)[0]) return profile.at(-1)[1];
  for (let i = 0; i < profile.length - 1; i++) {
    const [y0, r0] = profile[i], [y1, r1] = profile[i + 1];
    if (y <= y1) { const t = (y - y0) / (y1 - y0); return r0 + (r1 - r0) * t; }
  }
  return profile.at(-1)[1];
}

function seedHydrostaticWater() {
  // BCC lattice with exactly the same number density as a cubic lattice of spacing d:
  // a^3 = 2 d^3 and two alternating half-height layers per BCC cell.
  const d = Math.max(.001, Number(sim.params?.spacing) || .019);
  const a = Math.cbrt(2) * d;
  const dy = .5 * a;
  const minY = profile[0][0] + d * .82;
  const fillY = .092;
  const P = [], V = [];
  let layer = 0;
  const limit = Math.min(sim.cap || 6000, 3600);
  outer: for (let y = minY; y <= fillY + 1e-7; y += dy, layer++) {
    const R = Math.max(0, bodyRadius(y) - d * .72);
    const ox = (layer & 1) ? a * .5 : 0;
    const oz = (layer & 1) ? a * .5 : 0;
    const e = Math.ceil((R + a) / a);
    for (let ix = -e; ix <= e; ix++) for (let iz = -e; iz <= e; iz++) {
      const x = ix * a + ox, z = iz * a + oz;
      if (x * x + z * z > R * R) continue;
      const p = pitcherPoint([x, y, z], 0);
      P.push(p[0], p[1], p[2], 1);
      V.push(0, 0, 0, 0);
      if (P.length / 4 >= limit) break outer;
    }
  }
  const n = P.length / 4;
  const p4 = new Float32Array(P), v4 = new Float32Array(V), zero = new Float32Array(n * 4);
  for (const name of ['posA', 'posB', 'predA', 'predB']) queue.writeBuffer(sim.buf[name], 0, p4);
  for (const name of ['velA', 'velB']) queue.writeBuffer(sim.buf[name], 0, v4);
  for (const name of ['restA', 'restB']) queue.writeBuffer(sim.buf[name], 0, zero);
  if (sim.buf.bodyA) queue.writeBuffer(sim.buf.bodyA, 0, zero);
  if (sim.buf.bodyB) queue.writeBuffer(sim.buf.bodyB, 0, zero);
  sim.n = n;
  if (sim.scene) { sim.scene.n = n; sim.scene.nFluid = n; sim.scene.nBody = 0; }
  sim.uploadParams?.(1 / 240);
  sim.bindCache = null;
  scene.seeded = n;
  resets++;
  return n;
}

// Script only the rigid pitcher motion. Fluid motion is never scripted.
function physicalAngleAt(t) {
  if (t < 3.50) return 0;
  if (t < 6.20) return pitcher.maxAngle * smooth((t - 3.50) / 2.70);
  if (t < 9.20) return pitcher.maxAngle;
  if (t < 11.40) return pitcher.maxAngle * (1 - smooth((t - 9.20) / 2.20));
  return 0;
}
function physicalStageAt(t) {
  if (t < 3.50) return 'HYDROSTATIC REST';
  if (t < 6.20) return 'PITCHER TURNING — GRAVITY ONLY';
  if (t < 9.20) return 'GRAVITY POUR';
  if (t < 11.40) return 'RETURNING UPRIGHT';
  return 'POUR COMPLETE';
}
function advancePhysicalMotion(dt) {
  dt = Math.min(.05, Math.max(1 / 300, Number(dt) || 1 / 60));
  scene.lastDt = dt;
  scene.clock += dt;
  pitcher.prevAngle = pitcher.angle;
  pitcher.angle = physicalAngleAt(scene.clock);
  pitcher.omega = (pitcher.angle - pitcher.prevAngle) / dt;
}

const WGSL = `
struct UData {
  pitch  : vec4f,
  motion : vec4f,
  glass0 : vec4f,
  glass1 : vec4f,
  info   : vec4u,
}
@group(0) @binding(0) var<uniform> U : UData;
@group(0) @binding(1) var<storage, read>       pos  : array<vec4f>;
@group(0) @binding(2) var<storage, read_write> pred : array<vec4f>;

fn safe2(q: vec2f) -> vec2f {
  let m = length(q);
  return select(vec2f(1.0, 0.0), q / m, m > 1.0e-6);
}
fn toLocal(p: vec3f, a: f32) -> vec3f {
  let d = p - U.pitch.xyz;
  let c = cos(a); let s = sin(a);
  return vec3f(c * d.x + s * d.y, -s * d.x + c * d.y, d.z);
}
fn toWorld(p: vec3f) -> vec3f {
  let a = U.pitch.w; let c = cos(a); let s = sin(a);
  return U.pitch.xyz + vec3f(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}
fn bodyR(y: f32) -> f32 {
  if (y <= -.225) { return .074; }
  if (y < -.190) { return mix(.074, .105, (y + .225) / .035); }
  if (y < -.100) { return mix(.105, .137, (y + .190) / .090); }
  if (y <  .020) { return mix(.137, .145, (y + .100) / .120); }
  if (y <  .105) { return mix(.145, .127, (y - .020) / .085); }
  if (y <  .165) { return mix(.127, .095, (y - .105) / .060); }
  if (y <  .205) { return mix(.095, .070, (y - .165) / .040); }
  return .070;
}
fn spoutFloor(x: f32) -> f32 {
  if (x <= .060) { return .145; }
  if (x < .105) { return mix(.145, .165, (x - .060) / .045); }
  if (x < .155) { return mix(.165, .192, (x - .105) / .050); }
  if (x < .205) { return mix(.192, .198, (x - .155) / .050); }
  return mix(.198, .182, clamp((x - .205) / .045, 0.0, 1.0));
}
fn spoutOpening(q: vec3f, pr: f32) -> bool {
  if (q.x < .038 || q.x > .272 || abs(q.z) > .071 + pr * .35) { return false; }
  let f = spoutFloor(clamp(q.x, .060, .250));
  return q.y > f - .022 - pr * .15 && q.y < f + .105 + pr;
}
fn insideBody(q: vec3f, pr: f32) -> bool {
  if (q.y < -.225 + pr || q.y > .205 + pr * .4) { return false; }
  let r = length(q.xz);
  return r <= max(.008, bodyR(clamp(q.y, -.225, .205)) - pr * .55);
}
fn glassInner(y: f32) -> f32 {
  let t = clamp((y - U.glass0.z) / max(U.glass0.w - U.glass0.z, 1.0e-5), 0.0, 1.0);
  return mix(U.glass1.x, U.glass1.y, t);
}
fn glassOuter(y: f32) -> f32 {
  let t = clamp((y - U.glass0.z) / max(U.glass0.w - U.glass0.z, 1.0e-5), 0.0, 1.0);
  return mix(U.glass1.z, U.glass1.w, t);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= U.info.x) { return; }
  let pr = U.motion.z;
  let p0 = pos[i].xyz;
  var p = pred[i].xyz;

  // --- Moving pitcher -------------------------------------------------------
  // Classify the old particle against both the previous and current pitcher pose.
  // This makes the first substep of a moving frame continuous without tagging particles.
  let oPrev = toLocal(p0, U.motion.x);
  let oCur  = toLocal(p0, U.pitch.w);
  var q = toLocal(p, U.pitch.w);
  let wasInside = insideBody(oPrev, pr) || insideBody(oCur, pr);

  if (wasInside) {
    // Solid bottom.
    if (q.y < -.225 + pr) { q.y = -.225 + pr; }

    let r = length(q.xz);
    let yEval = clamp(q.y, -.225 + pr, .205 - pr * .25);
    let inner = max(.010, bodyR(yEval) - pr);

    // Side wall, except for the real spout cut-out.
    if (q.y <= .205 + pr * .25 && r > inner && !spoutOpening(q, pr)) {
      let d = safe2(q.xz);
      q.x = d.x * inner;
      q.z = d.y * inner;
      r = inner;
    }

    // Shoulder/rim annulus. The central neck and the spout remain genuinely open.
    let neck = max(.010, bodyR(.205) - pr);
    if (q.y > .205 - pr * .35 && r > neck && !spoutOpening(q, pr)) {
      q.y = .205 - pr * .35;
    }
  }

  // Open U-shaped spout trough. It exists whether or not a particle was previously in the
  // pitcher; there is no logical portal. The body opening simply connects to this geometry.
  let f = spoutFloor(clamp(q.x, .060, .250));
  let inSpoutBand = q.x > .044 && q.x < .258 + pr &&
                    q.y > f - .070 - pr && q.y < f + .120 + pr &&
                    abs(q.z) < .105;
  if (inSpoutBand) {
    let floorY = f - .034 + pr * .72;
    if (q.y < floorY) { q.y = floorY; }
    let halfW = max(.025, .066 - pr * .45);
    let oldZInside = abs(oPrev.z) < halfW + pr * 1.8 || abs(oCur.z) < halfW + pr * 1.8;
    if (abs(q.z) > halfW && oldZInside) {
      let sg = select(-1.0, 1.0, q.z >= 0.0);
      q.z = sg * halfW;
    }
  }
  p = toWorld(q);

  // --- Static receiving glass ---------------------------------------------
  // No capture state: falling water passes through the open center of the rim. Once its
  // previous position is inside the cavity, ordinary swept wall/base collisions retain it.
  let gc = vec2f(U.glass0.x, U.glass0.y);
  let baseTop = U.glass0.z;
  let rim = U.glass0.w;
  let bottom = U.motion.w;
  let g0 = p0.xz - gc;
  var g = p.xz - gc;
  let r0 = length(g0);
  var r = length(g);
  let oldInner = max(.008, glassInner(clamp(p0.y, baseTop, rim)) - pr);
  let wasInGlass = p0.y >= baseTop + pr * .35 && p0.y < rim + pr && r0 < oldInner;

  // Detect a top-entry segment so a very fast jet cannot tunnel through the entire base in
  // its first glass substep.
  var enteredTop = false;
  if (p0.y >= rim && p.y < rim) {
    let dy = p0.y - p.y;
    if (dy > 1.0e-6) {
      let t = clamp((p0.y - rim) / dy, 0.0, 1.0);
      let xz = p0.xz + (p.xz - p0.xz) * t;
      enteredTop = length(xz - gc) < U.glass1.y - pr * .55;
    }
  }

  if (wasInGlass || enteredTop) {
    if (p.y < baseTop + pr) { p.y = baseTop + pr; }
    if (p.y < rim + pr * .15) {
      let safe = max(.008, glassInner(clamp(p.y, baseTop, rim)) - pr);
      g = p.xz - gc; r = length(g);
      if (r > safe) {
        let d = safe2(g);
        p.x = gc.x + d.x * safe;
        p.z = gc.y + d.y * safe;
      }
    }
  } else {
    // Collision with the solid tapered shell from either side.
    if (p.y > baseTop - pr && p.y < rim + pr) {
      let inner = max(.008, glassInner(clamp(p.y, baseTop, rim)) - pr);
      let outer = glassOuter(clamp(p.y, baseTop, rim)) + pr;
      g = p.xz - gc; r = length(g);
      if (r > inner && r < outer) {
        let d = safe2(g);
        let oldOuter = glassOuter(clamp(p0.y, baseTop, rim)) + pr;
        if (r0 >= oldOuter) {
          p.x = gc.x + d.x * outer; p.z = gc.y + d.y * outer;
        } else {
          p.x = gc.x + d.x * inner; p.z = gc.y + d.y * inner;
        }
      }
    }

    // Solid bottom disk / underside.
    g = p.xz - gc; r = length(g);
    let baseOuter = U.glass1.z + pr;
    if (r < baseOuter && p.y < baseTop + pr && p.y > bottom - pr) {
      if (p0.y >= baseTop) { p.y = baseTop + pr; }
      else if (p0.y <= bottom) { p.y = bottom - pr; }
    }

    // Rim annulus; its center is open.
    g = p.xz - gc; r = length(g);
    if (abs(p.y - rim) < pr && r > U.glass1.y - pr && r < U.glass1.w + pr) {
      p.y = select(rim - pr, rim + pr, p0.y >= rim);
    }
  }

  pred[i] = vec4f(p, 1.0);
}`;

const mod = dev.createShaderModule({ code: WGSL, label: 'm874PhysicalVesselBoundaryWGSL' });
if (typeof mod.getCompilationInfo === 'function') {
  const info = await mod.getCompilationInfo();
  const errors = (info.messages || []).filter(m => m.type === 'error');
  if (errors.length) throw new Error('M8.7.4 boundary WGSL: ' + errors.map(m => `${m.lineNum || '?'}:${m.linePos || '?'} ${m.message}`).join(' | '));
}
const pipe = await dev.createComputePipelineAsync({ label: 'm874PhysicalVesselBoundary', layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
const uni = dev.createBuffer({ label: 'm874PhysicalVesselUniform', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const UF = new Float32Array(20), UU = new Uint32Array(UF.buffer);
let cachePosA = null, bgs = null;

function applyWaterParams() {
  if (!sim.params) return;
  sim.params.substeps = 4;
  sim.params.iterations = 5;
  sim.params.xsphC = .040;
  sim.params.sCorrK = .080;
  sim.params.surfaceTensionK = 0.0;
}
function applySurfaceParams() {
  if (!ssfr) return;
  ssfr.splatRadius = 1.20;
  ssfr.filter = 2;
  ssfr.filterIterations = 2;
  ssfr.thicknessRadius = 1.22;
  ssfr.thicknessFilterSize = 4;
  ssfr.bindCache = null;
}
function ensureBindings() {
  if (cachePosA === sim.buf.posA && bgs) return;
  cachePosA = sim.buf.posA;
  bgs = [[], []];
  for (let pp = 0; pp < 2; pp++) for (let qp = 0; qp < 2; qp++) {
    const ps = pp === 0 ? 'A' : 'B', qs = qp === 0 ? 'A' : 'B';
    bgs[pp][qp] = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: uni } },
      { binding: 1, resource: { buffer: sim.buf['pos' + ps] } },
      { binding: 2, resource: { buffer: sim.buf['pred' + qs] } },
    ] });
  }
}
function uploadBoundaryUniform() {
  UF.fill(0);
  const spacing = Number(sim.params?.spacing) || .019;
  const pr = Math.max(.004, spacing * .46);
  UF[0] = pitcher.cx; UF[1] = pitcher.cy; UF[2] = pitcher.cz; UF[3] = pitcher.angle;
  UF[4] = pitcher.prevAngle; UF[5] = spacing; UF[6] = pr; UF[7] = glass.bottom;
  UF[8] = glass.cx; UF[9] = glass.cz; UF[10] = glass.baseTop; UF[11] = glass.rim;
  UF[12] = glass.innerBottom; UF[13] = glass.innerTop; UF[14] = glass.outerBottom; UF[15] = glass.outerTop;
  UU[16] = sim.n; UU[17] = 0; UU[18] = 0; UU[19] = 0;
  queue.writeBuffer(uni, 0, UF);
}
function injectBoundary(enc, posParity, predParity, label) {
  ensureBindings();
  const pass = enc.beginComputePass({ label });
  pass.setPipeline(pipe);
  pass.setBindGroup(0, bgs[posParity][predParity]);
  pass.dispatchWorkgroups(Math.max(1, Math.ceil(sim.n / 256)));
  pass.end();
  passes++;
  scene.collisionPasses = passes;
}

// Insert the geometric boundary into the actual PBF loop. Prediction is constrained before the
// neighbour grid is built, and every density iteration is constrained before the next iteration.
dev.createCommandEncoder = function(desc) {
  const enc = baseCreate(desc);
  if (!inStep) return enc;
  uploadBoundaryUniform();
  let deltaIndex = 0;
  return new Proxy(enc, { get(target, prop) {
    if (prop === 'beginComputePass') return passDesc => {
      const raw = target.beginComputePass(passDesc);
      let kind = '';
      return new Proxy(raw, { get(pass, pprop) {
        if (pprop === 'setPipeline') return p => {
          if (p === sim.pipe.predict) kind = 'predict';
          else if (p === sim.pipe.delta) kind = 'delta';
          return pass.setPipeline(p);
        };
        if (pprop === 'end') return (...args) => {
          const out = pass.end(...args);
          if (kind === 'predict') {
            deltaIndex = 0;
            const par = sim.parity & 1;
            injectBoundary(target, par, par, 'm874BoundaryAfterPredict');
          } else if (kind === 'delta') {
            const posPar = sim.parity & 1;
            const predPar = posPar ^ ((deltaIndex & 1) ? 0 : 1);
            injectBoundary(target, posPar, predPar, 'm874BoundaryAfterDensity');
            deltaIndex++;
          }
          return out;
        };
        const value = Reflect.get(pass, pprop, pass);
        return typeof value === 'function' ? value.bind(pass) : value;
      }});
    };
    const value = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
};

sim.step = function(dt) {
  applyWaterParams();
  if (scene.started && !ui.paused) advancePhysicalMotion(dt);
  // M8.7.2 remains underneath us for the moving vessel renderer only. Suppress its scripted
  // motion and old pre/post clamp while the upstream PBF step is encoding.
  const started = scene.started, active = scene.active;
  scene.started = false;
  scene.active = false;
  inStep = true;
  try { return nativeStep(dt); }
  finally { inStep = false; scene.started = started; scene.active = active; }
};

function physicalReset() {
  scene.started = false;
  scene.active = true;
  scene.clock = 0;
  scene.lastDt = 1 / 60;
  pitcher.angle = 0;
  pitcher.prevAngle = 0;
  pitcher.omega = 0;
  passes = 0;
  ui.pouring = false;
  ui.pourLeft = 0;
  ui.paused = false;
  sim.timeBank = 0;
  sim.simTime = 0;
  applyWaterParams();
  applySurfaceParams();
  seedHydrostaticWater();
  scene.collisionPasses = 0;
  scene.started = true;
  syncHud();
}

const oldAgain = document.getElementById('m872Again');
if (oldAgain) {
  const fresh = oldAgain.cloneNode(true);
  oldAgain.replaceWith(fresh);
  fresh.onclick = e => { e.preventDefault(); e.stopPropagation(); physicalReset(); };
}
const hudTitle = document.querySelector('#m872Hud b');
if (hudTitle) hudTitle.textContent = 'M8.7.4 · PHYSICAL VESSEL PBF';
const status = document.getElementById('m872Status');
function syncHud() {
  if (!status) return;
  const deg = -pitcher.angle * 180 / Math.PI;
  const lip = pitcherPoint(spoutPath.at(-1));
  status.textContent = `${physicalStageAt(scene.clock)} · ${scene.clock.toFixed(1)} s\n` +
    `pitcher ${deg.toFixed(0)}° · wall ω ${Math.abs(pitcher.omega).toFixed(2)} rad/s\n` +
    `PBF water ${sim.n.toLocaleString()} · zero-velocity hydrostatic seed ${scene.seeded.toLocaleString()}\n` +
    `spout lip ${lip[0].toFixed(2)}, ${lip[1].toFixed(2)} m · glass rim ${glass.rim.toFixed(2)} m\n` +
    `substep wall projections ${passes.toLocaleString()} · persistent fluid states 0 · added submits 0`;
}
setInterval(syncHud, 300);

applyWaterParams();
applySurfaceParams();
setTimeout(() => { applyWaterParams(); applySurfaceParams(); physicalReset(); }, 760);

window.__v5M874Physical = {
  online: true,
  backend: 'pbf-per-substep-swept-geometric-vessel-boundary-m874',
  gpuSubmitsAdded: 0,
  persistentFluidStates: 0,
  restart: physicalReset,
  get passes() { return passes; },
  get clock() { return scene.clock; },
  get stage() { return physicalStageAt(scene.clock); },
};
window.__fluidV5Version = '8.7.4';
window.__fluidV5Build = 'M8.7.4 PHYSICAL VESSEL PBF / PER-SUBSTEP SWEPT BOUNDARIES / GRAVITY-ONLY POUR';
const title = document.querySelector('.hud.card.title');
if (title) title.textContent = 'FLUID V8 · M8.7.4';
document.title = 'Fluid V8 · M8.7.4 Physical Vessel PBF';
console.info('[Fluid V8 M8.7.4] per-substep geometric vessel constraints online; no fluid state machine; added submits 0.');