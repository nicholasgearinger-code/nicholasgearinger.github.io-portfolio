// Fluid V4 portfolio integration layer.
// PBF/SSFR core pinned to Particles4All commit 58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0 (MIT).

const UPSTREAM = 'https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/src/';
const q = new URLSearchParams(location.search);
const QUALITY = {
  low: {
    label: 'LOW', short: 'LOW', particles: '18400', spacing: '0.044',
    ssfrscale: '0.50', substeps: '2', iters: '3', ssfriters: '2', ssfrthickblur: '14',
    note: 'Low · ~18K particles · 50% edge-aware surface · lighter physics with cleaner splashes.'
  },
  medium: {
    label: 'MEDIUM', short: 'MED', particles: '30000', spacing: '0.0375',
    ssfrscale: '0.58', substeps: '2', iters: '4', ssfriters: '3', ssfrthickblur: '18',
    note: 'Medium · ~30K particles · 58% edge-aware surface · recommended mobile balance.'
  },
  high: {
    label: 'HIGH', short: 'HIGH', particles: '48600', spacing: '0.032',
    ssfrscale: '0.68', substeps: '3', iters: '5', ssfriters: '4', ssfrthickblur: '22',
    note: 'High · ~49K particles · 68% edge-aware surface · densest water, heavier GPU load.'
  }
};
const qualityName = QUALITY[q.get('quality')] ? q.get('quality') : 'medium';
const quality = QUALITY[qualityName];

// The medium configuration is about three times the previous water volume/depth.
// Spacing and particle count are co-varied so Low/Med/High keep approximately the
// same physical amount of water instead of draining/filling the pool when quality changes.
const defaults = {
  preset: 'small', view: 'ssfr', quality: qualityName,
  box: '1.9 2.5 1.25', bodies: '1', body: 'sphere:0.55:0.88', bodysize: '0.09',
  grab: '1', grabstrength: '23', force: '1', fradius: '0.20', fstrength: '46', flimit: '8',
  particles: quality.particles, spacing: quality.spacing,
  substeps: quality.substeps, iters: quality.iters,
  xsph: '0.03', scorr: '0.08', tension: '0.25',
  ssfrscale: quality.ssfrscale, ssfrfilter: '2', ssfriters: quality.ssfriters,
  ssfrradius: '0.76', ssfrdelta: '8.6', ssfrmu: '1.04',
  ssfrthickr: '1.82', ssfrthick: '0.82', ssfrthickblur: quality.ssfrthickblur,
  ior: '1.333', absorption: '0.68', transmit: '0.27 0.66 0.91', roughness: '0.032',
  camera: '-0.72 0.43 3.05 0.95 0.66 0.625', floorplane: '1', cubemap: '', v4ui: '1'
};
for (const [k, v] of Object.entries(defaults)) if (!q.has(k)) q.set(k, v);
history.replaceState(null, '', location.pathname + '?' + q.toString() + location.hash);

// Load the upstream composite source before the engine. We keep the MIT solver untouched and
// replace only its final SSFR composite pipeline after initialization.
const CW = await import(UPSTREAM + 'ssfr_composite_wgsl.js');
await import(UPSTREAM + 'main.js');

const canvas = document.getElementById('view');
const fpsEl = document.getElementById('v4fps');
const statsEl = document.getElementById('v4stats');
const modeEl = document.getElementById('v4mode');
const hintEl = document.getElementById('v4hint');
const modeBtn = document.getElementById('modeBtn');
const dropBtn = document.getElementById('dropBtn');
const pauseBtn = document.getElementById('pauseV4');
const resetBtn = document.getElementById('resetV4');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const qualityNote = document.getElementById('qualityNote');

const sim = window.__sim;
const ui = window.__ui;
const cam = window.__cam;
const ssfr = window.__ssfr;
if (!sim || !ui || !cam) throw new Error('Fluid V4 bridge: upstream PBF core did not initialize.');

function installOptics() {
  if (!ssfr?.dev || !ssfr?.format) {
    console.warn('[Fluid V4] SSFR handle unavailable; using upstream optics.');
    return false;
  }

  let src = CW.compositePrelude + CW.compositeFS;

  // The upstream composite reads the reduced-resolution eye-depth target with a single
  // integer textureLoad. On a Retina display that exposes every SSFR texel as a square,
  // especially around fast, thin splash sheets. Reconstruct depth from a 2x2 footprint,
  // but reject samples across depth discontinuities so the pool, glass and jug edges stay
  // crisp. r32float is not universally filterable on mobile WebGPU, so this is deliberately
  // implemented with portable textureLoad calls instead of relying on float32 filtering.
  const upscaleFunctionNeedle = `fn viewPos(ndc: vec2f, z: f32) -> vec3f {`;
  const upscaleFunctionPatch = `fn edgeAwareEyeZ(mapP: vec2f, lim: vec2i) -> f32 {
  let gridP = mapP - vec2f(0.5);
  let baseP = vec2i(floor(gridP));
  let blendP = fract(gridP);
  let maxP = lim - vec2i(1);
  let p00 = clamp(baseP, vec2i(0), maxP);
  let p10 = clamp(baseP + vec2i(1, 0), vec2i(0), maxP);
  let p01 = clamp(baseP + vec2i(0, 1), vec2i(0), maxP);
  let p11 = clamp(baseP + vec2i(1, 1), vec2i(0), maxP);
  let z00 = textureLoad(uEyeZ, p00, 0).r;
  let z10 = textureLoad(uEyeZ, p10, 0).r;
  let z01 = textureLoad(uEyeZ, p01, 0).r;
  let z11 = textureLoad(uEyeZ, p11, 0).r;
  var anchorZ = -1.0e4;
  if (!isEmptyZ(z00)) { anchorZ = max(anchorZ, z00); }
  if (!isEmptyZ(z10)) { anchorZ = max(anchorZ, z10); }
  if (!isEmptyZ(z01)) { anchorZ = max(anchorZ, z01); }
  if (!isEmptyZ(z11)) { anchorZ = max(anchorZ, z11); }
  if (isEmptyZ(anchorZ)) { return anchorZ; }
  let edgeBand = max(0.018, abs(anchorZ) * 0.012);
  let w00 = (1.0 - blendP.x) * (1.0 - blendP.y);
  let w10 = blendP.x * (1.0 - blendP.y);
  let w01 = (1.0 - blendP.x) * blendP.y;
  let w11 = blendP.x * blendP.y;
  var sumZ = 0.0;
  var sumW = 0.0;
  if (!isEmptyZ(z00) && abs(z00 - anchorZ) <= edgeBand) { sumZ += z00 * w00; sumW += w00; }
  if (!isEmptyZ(z10) && abs(z10 - anchorZ) <= edgeBand) { sumZ += z10 * w10; sumW += w10; }
  if (!isEmptyZ(z01) && abs(z01 - anchorZ) <= edgeBand) { sumZ += z01 * w01; sumW += w01; }
  if (!isEmptyZ(z11) && abs(z11 - anchorZ) <= edgeBand) { sumZ += z11 * w11; sumW += w11; }
  if (sumW < 1.0e-5) { return anchorZ; }
  return sumZ / sumW;
}

fn viewPos(ndc: vec2f, z: f32) -> vec3f {`;
  if (!src.includes(upscaleFunctionNeedle)) throw new Error('Fluid V8 upscale: composite signature changed.');
  src = src.replace(upscaleFunctionNeedle, upscaleFunctionPatch);

  const upscaleLookupNeedle = `  let ip = vec2i(in.clip.xy * C.mapScale);
  let lim = vec2i(textureDimensions(uEyeZ, 0));
  let z = textureLoad(uEyeZ, ip, 0).r;`;
  const upscaleLookupPatch = `  let mapP = in.clip.xy * C.mapScale;
  let ip = vec2i(mapP);
  let lim = vec2i(textureDimensions(uEyeZ, 0));
  let z = edgeAwareEyeZ(mapP, lim);`;
  if (!src.includes(upscaleLookupNeedle)) throw new Error('Fluid V8 upscale: depth lookup signature changed.');
  src = src.replace(upscaleLookupNeedle, upscaleLookupPatch);

  // Underwater sphere shadow on the receiving floor. This uses the same packed rigid-body
  // data as the upstream SSFR renderer, but solves the single-sphere shadow analytically so
  // it costs almost nothing compared with ray marching another SDF per pixel.
  const floorNeedle = '      return mix(floorColor(p), far, vec3f(fade));';
  const floorPatch = `      var floorLit = floorColor(p);\n      if (C.bodyCount > 0) {\n        let centre = bdata[0u].xyz;\n        let radius = max(bdata[1u].x, 1.0e-4);\n        let oc = p - centre;\n        let qb = dot(oc, C.sunDir);\n        let qc = dot(oc, oc) - radius * radius;\n        let disc = qb * qb - qc;\n        if (disc > 0.0) {\n          let root = sqrt(disc);\n          let tFar = -qb + root;\n          if (tFar > 0.0) {\n            let edge = smoothstep(0.0, radius * radius * 0.20, disc);\n            let shadow = mix(1.0, 0.42, edge);\n            floorLit *= vec3f(shadow * 0.92, shadow * 0.97, shadow * 1.04);\n          }\n        }\n      }\n      return mix(floorLit, far, vec3f(fade));`;
  if (!src.includes(floorNeedle)) throw new Error('Fluid V4 optics: upstream floor shader signature changed.');
  src = src.replace(floorNeedle, floorPatch);

  // Real-time caustic estimate from the reconstructed water itself. Neighbouring refracted
  // rays that converge have negative screen-space divergence; use that as a compact photon
  // density estimate. This means every tap/wave physically moves the caustic pattern too.
  const transNeedle = '  let trans = hitCol * exp(-C.absorb * thick);';
  const transPatch = `  let refrDx = dpdx(refrDir);\n  let refrDy = dpdy(refrDir);\n  let convergence = max(0.0, -(refrDx.x + refrDy.y));\n  let causticDepth = smoothstep(0.035, 0.34, thick);\n  let causticDown = smoothstep(0.04, 0.86, -refrDir.y);\n  let causticEnergy = min(2.45, convergence * 42.0) * causticDepth * causticDown;\n  let caustic = 1.0 + causticEnergy;\n  hitCol *= vec3f(caustic * 1.035, caustic * 1.018, caustic);\n\n  let trans = hitCol * exp(-C.absorb * thick);`;
  if (!src.includes(transNeedle)) throw new Error('Fluid V4 optics: upstream transmission shader signature changed.');
  src = src.replace(transNeedle, transPatch);

  const mod = ssfr.dev.createShaderModule({ code: src, label: 'fluidV4OpticsWGSL' });
  ssfr.pipeComposite = ssfr.dev.createRenderPipeline({
    label: 'fluidV4OpticsComposite',
    layout: 'auto',
    vertex: { module: mod, entryPoint: 'vs' },
    fragment: { module: mod, entryPoint: 'fs', targets: [{ format: ssfr.format }] },
    primitive: { topology: 'triangle-list' },
  });
  ssfr.bindCache = null;

  // Stronger but still water-like depth optics for the deeper pool.
  ssfr.ior = 1.333;
  ssfr.absorption = 0.68;
  ssfr.transmit = [0.27, 0.66, 0.91];
  ssfr.thicknessScale = 0.82;
  ssfr.roughness = 0.032;
  ssfr.sunIntensity = 4.65;
  ssfr.groundReflection = 0.08;
  console.info('[Fluid V4] surface caustics, underwater shadow, refraction and depth absorption enabled.');
  return true;
}

let opticsEnabled = false;
try { opticsEnabled = installOptics(); }
catch (err) { console.error('[Fluid V4 optics]', err); }

const CAMERA = { az: -0.72, el: 0.43, dist: 3.05, target: [0.95, 0.66, 0.625] };
function resetCamera() {
  cam.az = CAMERA.az;
  cam.el = CAMERA.el;
  cam.dist = CAMERA.dist;
  cam.target = [...CAMERA.target];
}
resetCamera();

settingsBtn.textContent = `QUALITY: ${quality.short}`;
qualityNote.textContent = quality.note;

function applyQuality(next) {
  if (!QUALITY[next]) return;
  if (next === qualityName) {
    settingsPanel.classList.add('hidden');
    return;
  }
  for (const b of document.querySelectorAll('[data-quality]')) {
    b.classList.toggle('active', b.dataset.quality === next);
  }
  settingsBtn.textContent = `LOADING: ${QUALITY[next].short}`;
  qualityNote.textContent = `Rebuilding ${QUALITY[next].label.toLowerCase()} simulation…`;

  const nextQuery = new URLSearchParams({ quality: next, qv: String(Date.now()) });
  location.assign(location.pathname + '?' + nextQuery.toString() + location.hash);
}

for (const b of document.querySelectorAll('[data-quality]')) {
  b.classList.toggle('active', b.dataset.quality === qualityName);
  b.addEventListener('pointerdown', e => e.stopPropagation());
  b.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    applyQuality(b.dataset.quality);
  });
}
settingsBtn.onclick = e => {
  e.preventDefault();
  e.stopPropagation();
  settingsPanel.classList.toggle('hidden');
};
settingsPanel.addEventListener('pointerdown', e => e.stopPropagation());
settingsPanel.addEventListener('click', e => e.stopPropagation());
document.addEventListener('pointerdown', e => {
  if (!settingsPanel.contains(e.target) && e.target !== settingsBtn) settingsPanel.classList.add('hidden');
});

let mode = 'water';
let activePointer = null;
let rotating = false;
let draggingBall = false;
let dragDistance = 0;
let dragOffset = [0, 0, 0];
let dragTarget = null;
let lastX = 0, lastY = 0;
let lastRay = null;
let dropUntil = 0;
let dropWasActive = false;

const rayAt = (x, y) => {
  const r = canvas.getBoundingClientRect();
  return window.__screenRay((x - r.left) / Math.max(1, r.width), (y - r.top) / Math.max(1, r.height), r.width / Math.max(1, r.height));
};
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function hitSphere(ray) {
  const body = sim.bodies?.[0], pose = sim.bodyPose?.[0];
  if (!body || !pose) return null;
  const c = pose.centre, radius = body.size * 1.2;
  const oc = sub(ray.origin, c), b = dot(oc, ray.dir), cc = dot(oc, oc) - radius * radius;
  const d = b * b - cc;
  if (d < 0) return null;
  const s = Math.sqrt(d), t = (-b - s) > 0 ? (-b - s) : (-b + s);
  if (t <= 0) return null;
  return { t, hit: add(ray.origin, mul(ray.dir, t)), centre: [...c], radius };
}
function clampBallTarget(p, r) {
  const b = sim.params.box;
  return [
    Math.min(b[0] - r, Math.max(r, p[0])),
    Math.min(b[1] - r, Math.max(r, p[1])),
    Math.min(b[2] - r, Math.max(r, p[2]))
  ];
}
function setMode(next) {
  mode = next;
  if (mode === 'water') {
    modeBtn.textContent = 'MODE: WATER';
    modeBtn.classList.add('active');
    modeEl.textContent = 'WATER MODE';
    hintEl.textContent = 'Water mode: tap for a strong ripple, or drag through the surface to stir the PBF water.';
    if (draggingBall) { draggingBall = false; sim.releaseBody(); }
  } else {
    modeBtn.textContent = 'MODE: BALL';
    modeBtn.classList.remove('active');
    modeEl.textContent = 'BALL MODE';
    hintEl.textContent = 'Ball mode: touch the sphere, drag it, then release slowly to drop or quickly to throw.';
  }
}
modeBtn.onclick = () => setMode(mode === 'water' ? 'ball' : 'water');

function waterTap(ray, strength = 5.4) {
  // A sharper, wider downward impulse creates a true PBF crater/rebound ring rather than
  // a cosmetic ripple. The surface reconstruction and caustics follow the resulting motion.
  const imp = [ray.dir[0] * strength * 0.58, -Math.abs(ray.dir[1]) * strength * 1.28 - 1.25, ray.dir[2] * strength * 0.58];
  sim.applyRayImpulse(ray.origin, ray.dir, imp, Math.max(ui.forceRadius || 0.20, 0.20), Math.max(ui.forceLimit || 8, 8));
}
function waterDrag(a, b, dx, dy) {
  const gain = 58;
  const imp = [
    (b.dir[0] - a.dir[0]) * gain,
    b.dir[1] * 0.48 + (dy > 0 ? -0.48 : 0),
    (b.dir[2] - a.dir[2]) * gain
  ];
  sim.applyRayImpulse(b.origin, b.dir, imp, Math.max(ui.forceRadius || 0.20, 0.20) * 1.12, Math.max(ui.forceLimit || 8, 8));
}

canvas.onpointerdown = e => {
  if (e.button !== 0) return;
  e.preventDefault();
  settingsPanel.classList.add('hidden');
  activePointer = e.pointerId;
  lastX = e.clientX; lastY = e.clientY; lastRay = rayAt(lastX, lastY);
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  if (mode === 'water') {
    waterTap(lastRay);
    return;
  }
  const hit = hitSphere(lastRay);
  if (hit) {
    draggingBall = true; rotating = false; dragDistance = hit.t; dragOffset = sub(hit.hit, hit.centre); dragTarget = hit.centre;
  } else {
    rotating = true;
  }
};
canvas.onpointermove = e => {
  if (activePointer !== e.pointerId) return;
  e.preventDefault();
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  const ray = rayAt(e.clientX, e.clientY);
  if (mode === 'water') {
    if (lastRay && (Math.abs(dx) + Math.abs(dy) > 0.5)) waterDrag(lastRay, ray, dx, dy);
  } else if (draggingBall) {
    const body = sim.bodies?.[0];
    const raw = sub(add(ray.origin, mul(ray.dir, dragDistance)), dragOffset);
    dragTarget = clampBallTarget(raw, (body?.size || 0.09) * 1.05);
  } else if (rotating) {
    cam.orbit(-dx * 0.006, dy * 0.006);
  }
  lastX = e.clientX; lastY = e.clientY; lastRay = ray;
};
function endPointer(e) {
  if (activePointer !== e.pointerId) return;
  e.preventDefault();
  if (draggingBall) { draggingBall = false; dragTarget = null; sim.releaseBody(); }
  rotating = false; activePointer = null; lastRay = null;
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
}
canvas.onpointerup = endPointer;
canvas.onpointercancel = endPointer;
canvas.onwheel = e => { e.preventDefault(); cam.zoom(e.deltaY > 0 ? 1.08 : 0.92); };

ui.holdFrame = () => {
  const now = performance.now();
  if (dropUntil > now) {
    const b = sim.params.box, body = sim.bodies?.[0];
    const r = (body?.size || 0.09) * 1.05;
    sim.holdBody(1, clampBallTarget([b[0] * 0.5, b[1] * 0.94, b[2] * 0.5], r), 28, 8);
    dropWasActive = true;
    return;
  }
  if (dropWasActive) { dropWasActive = false; sim.releaseBody(); }
  if (draggingBall && dragTarget && !ui.paused) sim.holdBody(1, dragTarget, 24, 8);
};

dropBtn.onclick = () => {
  setMode('ball');
  dropUntil = performance.now() + 360;
  dropWasActive = false;
};
pauseBtn.onclick = () => {
  document.getElementById('pause').click();
  requestAnimationFrame(() => { pauseBtn.textContent = ui.paused ? 'RESUME' : 'PAUSE'; });
};
resetBtn.onclick = () => {
  draggingBall = false; dragTarget = null; dropUntil = 0; sim.releaseBody();
  document.getElementById('reset').click();
  resetCamera();
};

setMode('water');

function hudLoop() {
  const text = document.getElementById('stats').textContent || '';
  const m = text.match(/([0-9.]+)\s+fps/i);
  if (m) fpsEl.textContent = Math.round(Number(m[1])) + ' FPS';
  const fluid = sim.scene?.nFluid || sim.n || 0;
  const scale = window.__ssfr?.renderScale;
  statsEl.textContent = `${quality.short} · ${fluid.toLocaleString()} · ${scale ? Math.round(scale * 100) + '% surf' : 'PBF'} · 3× depth${opticsEnabled ? ' · optics' : ''}`;
  pauseBtn.textContent = ui.paused ? 'RESUME' : 'PAUSE';
  requestAnimationFrame(hudLoop);
}
requestAnimationFrame(hudLoop);
