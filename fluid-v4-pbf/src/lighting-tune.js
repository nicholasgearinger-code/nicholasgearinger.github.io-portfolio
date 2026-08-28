// Fluid V4 reference-matched pool optics + live tuning controls.
// PBF physics stays untouched. This pass turns the free-standing fluid block into a
// visually enclosed tiled pool and matches the upstream Particles4All optical baseline.

const PIN = '58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0';
const ROOT = `https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@${PIN}/`;

// Seed the upstream RayMarch state BEFORE main.js starts. These are the exact small-preset
// spectral values, with SSFR thickness reduced to compensate for our ~3x deeper pool.
const boot = new URLSearchParams(location.search);
if (!boot.has('transmit')) boot.set('transmit', '0.34902 0.705882 0.894118');
if (!boot.has('ior')) boot.set('ior', '1.333');
if (!boot.has('absorption')) boot.set('absorption', '0.425');
if (!boot.has('roughness')) boot.set('roughness', '0.048');
if (!boot.has('sunint')) boot.set('sunint', '4.375');
if (!boot.has('sunelev')) boot.set('sunelev', '23.219');
if (!boot.has('sunazim')) boot.set('sunazim', '42.75');
if (!boot.has('exposure')) boot.set('exposure', '1.53');
if (!boot.has('ssfrthick')) boot.set('ssfrthick', '0.19');
if (!boot.has('groundrefl')) boot.set('groundrefl', '1.0');
history.replaceState(null, '', location.pathname + '?' + boot.toString() + location.hash);

await import('./main.js');

const CW = await import(ROOT + 'src/ssfr_composite_wgsl.js');
const ssfr = window.__ssfr;

if (!ssfr?.dev || !ssfr?.format) {
  console.warn('[Fluid V4 lighting] SSFR handle unavailable; keeping previous optics.');
} else {
  try {
    if (ssfr.env) {
      await ssfr.env.load(ROOT + 'env/quarry_cloudy_1k.hdr');
      ssfr.env.intensity = 1.0;
      ssfr.env.yaw = 0.0;
      ssfr.bindCache = null;
    }
  } catch (err) {
    console.warn('[Fluid V4 lighting] HDR environment failed; using fallback sky.', err);
  }

  let src = CW.compositePrelude + CW.compositeFS;

  // Use the pinned upstream reflection response. Only detach groundReflection from the
  // original reflection-suppression knob so we can reuse it as a live caustic-strength uniform.
  src = src.replace(
    '  let suppress = (1.0 - clamp(C.groundReflection, 0.0, 1.0)) * topSurface * belowHorizon;',
    '  let suppress = 0.92 * topSurface * belowHorizon;'
  );

  const floorNeedle = `fn floorColor(p: vec3f) -> vec3f {
  let base = vec3f(0.30, 0.305, 0.315);
  let g = abs(fract(p.xz) - vec2f(0.5));
  let line = 1.0 - smoothstep(0.0, 0.015, min(g.x, g.y));
  var c = mix(base, vec3f(0.50, 0.51, 0.52), vec3f(line * 0.8));
  let chk = (floor(p.x) + floor(p.z)) - 2.0 * floor((floor(p.x) + floor(p.z)) * 0.5);
  c *= mix(0.88, 1.10, chk);
  return c;
}`;

  const floorPatch = `fn poolTileColor(p: vec3f, n: vec3f) -> vec3f {
  var uv = p.xz * 8.5;
  if (abs(n.x) > 0.5) { uv = p.zy * 8.5; }
  if (abs(n.z) > 0.5) { uv = p.xy * 8.5; }
  let cell = floor(uv);
  let q = abs(fract(uv) - vec2f(0.5));
  let grout = smoothstep(0.435, 0.492, max(q.x, q.y));
  let alt = (cell.x + cell.y) - 2.0 * floor((cell.x + cell.y) * 0.5);
  let aquaA = vec3f(0.30, 0.66, 0.73);
  let aquaB = vec3f(0.43, 0.77, 0.81);
  var c = mix(aquaA, aquaB, vec3f(alt * 0.72));
  c = mix(c, vec3f(0.86, 0.95, 0.96), vec3f(grout * 0.82));
  let ndl = max(dot(n, C.sunDir), 0.0);
  c *= 0.72 + 0.34 * ndl;
  return c;
}

fn floorColor(p: vec3f) -> vec3f {
  return poolTileColor(p, vec3f(0.0, 1.0, 0.0));
}

struct PoolHit { t : f32, n : vec3f, p : vec3f }

fn tracePool(o: vec3f, d: vec3f) -> PoolHit {
  var h : PoolHit;
  h.t = 1.0e30;
  h.n = vec3f(0.0, 1.0, 0.0);
  h.p = vec3f(0.0);
  let lo = C.boxMin;
  let hi = C.boxMax;
  let pad = 0.025;

  if (abs(d.y) > 1.0e-5) {
    let t = (lo.y - o.y) / d.y;
    if (t > 1.0e-4) {
      let p = o + d * t;
      if (p.x >= lo.x - pad && p.x <= hi.x + pad && p.z >= lo.z - pad && p.z <= hi.z + pad && t < h.t) {
        h.t = t; h.n = vec3f(0.0, 1.0, 0.0); h.p = p;
      }
    }
  }

  if (abs(d.x) > 1.0e-5) {
    var t = (lo.x - o.x) / d.x;
    var p = o + d * t;
    if (t > 1.0e-4 && p.y >= lo.y - pad && p.y <= hi.y + pad && p.z >= lo.z - pad && p.z <= hi.z + pad && t < h.t) {
      h.t = t; h.n = vec3f(1.0, 0.0, 0.0); h.p = p;
    }
    t = (hi.x - o.x) / d.x;
    p = o + d * t;
    if (t > 1.0e-4 && p.y >= lo.y - pad && p.y <= hi.y + pad && p.z >= lo.z - pad && p.z <= hi.z + pad && t < h.t) {
      h.t = t; h.n = vec3f(-1.0, 0.0, 0.0); h.p = p;
    }
  }

  if (abs(d.z) > 1.0e-5) {
    var t = (lo.z - o.z) / d.z;
    var p = o + d * t;
    if (t > 1.0e-4 && p.y >= lo.y - pad && p.y <= hi.y + pad && p.x >= lo.x - pad && p.x <= hi.x + pad && t < h.t) {
      h.t = t; h.n = vec3f(0.0, 0.0, 1.0); h.p = p;
    }
    t = (hi.z - o.z) / d.z;
    p = o + d * t;
    if (t > 1.0e-4 && p.y >= lo.y - pad && p.y <= hi.y + pad && p.x >= lo.x - pad && p.x <= hi.x + pad && t < h.t) {
      h.t = t; h.n = vec3f(0.0, 0.0, -1.0); h.p = p;
    }
  }
  return h;
}`;
  if (!src.includes(floorNeedle)) throw new Error('Fluid V4 pool: upstream floor shader signature changed.');
  src = src.replace(floorNeedle, floorPatch);

  const bgNeedle = `fn background(o: vec3f, d: vec3f) -> vec3f {
  if (C.floorPlane != 0 && d.y < -1.0e-4) {
    let t = (C.boxMin.y - o.y) / d.y;
    if (t > 0.0) {
      let p = o + d * t;

      let fade = 1.0 - exp(-0.02 * t);
      var far = kHaze;
      if (C.hasEnvMap != 0) { far = envSample(d); }
      return mix(floorColor(p), far, vec3f(fade));
    }
  }
  return skyColor(d);
}`;

  const bgPatch = `fn background(o: vec3f, d: vec3f) -> vec3f {
  if (C.floorPlane != 0) {
    let ph = tracePool(o, d);
    if (ph.t < 1.0e29) {
      let tile = poolTileColor(ph.p, ph.n);
      let far = select(kHaze, envSample(d), C.hasEnvMap != 0);
      let haze = min(0.12, 1.0 - exp(-0.012 * ph.t));
      return mix(tile, far, vec3f(haze));
    }
  }
  return skyColor(d);
}`;
  if (!src.includes(bgNeedle)) throw new Error('Fluid V4 pool: upstream background shader signature changed.');
  src = src.replace(bgNeedle, bgPatch);

  // Couple optical depth to the actual tiled receiver distance. This is the key change for
  // the deep pool: side views no longer integrate absorption across an arbitrary water block.
  const transNeedle = '  let trans = hitCol * exp(-C.absorb * thick);';
  const transPatch = `  let poolHit = tracePool(ro2, refrDir);
  if (poolHit.t < 1.0e29) {
    thick = min(thick, poolHit.t);
  }

  // Dynamic caustics from convergence of neighbouring refracted rays. This energy is applied
  // only to transmitted light, so it appears on the submerged tiles instead of being painted
  // across the water surface itself.
  let refrDx = dpdx(refrDir);
  let refrDy = dpdy(refrDir);
  let convergence = max(0.0, -(refrDx.x + refrDy.y));
  let receiver = select(0.0, 1.0, poolHit.t < 1.0e29);
  let downward = smoothstep(0.02, 0.82, -refrDir.y);
  let focus = min(2.2, convergence * 38.0) * receiver * downward;
  let causticGain = 0.30 + 1.15 * clamp(C.groundReflection, 0.0, 2.0);
  hitCol *= vec3f(1.0 + focus * causticGain * 0.74,
                  1.0 + focus * causticGain * 0.70,
                  1.0 + focus * causticGain * 0.55);
  hitCol += vec3f(1.0, 0.97, 0.86) * focus * causticGain * 0.10;

  let trans = hitCol * exp(-C.absorb * thick);`;
  if (!src.includes(transNeedle)) throw new Error('Fluid V4 pool: upstream transmission shader signature changed.');
  src = src.replace(transNeedle, transPatch);

  const mod = ssfr.dev.createShaderModule({ code: src, label: 'fluidV4ReferencePoolWGSL' });
  ssfr.pipeComposite = ssfr.dev.createRenderPipeline({
    label: 'fluidV4ReferencePoolComposite',
    layout: 'auto',
    vertex: { module: mod, entryPoint: 'vs' },
    fragment: { module: mod, entryPoint: 'fs', targets: [{ format: ssfr.format }] },
    primitive: { topology: 'triangle-list' },
  });
  ssfr.bindCache = null;

  const upstreamSet = (id, value) => {
    const el = document.getElementById(id);
    if (!el || typeof el.oninput !== 'function') return false;
    el.value = String(value);
    el.oninput();
    return true;
  };

  const LOOK_REFERENCE = {
    exposure: 1.53,
    absorption: 0.425,
    thickness: 0.190,
    roughness: 0.048,
    sun: 4.375,
    sunElevation: 23.219,
    env: 1.00,
    caustics: 1.00,
  };
  const LOOK_POOL = {
    exposure: 1.62,
    absorption: 0.30,
    thickness: 0.155,
    roughness: 0.038,
    sun: 4.85,
    sunElevation: 31.0,
    env: 1.08,
    caustics: 1.35,
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v)));
  const savedKey = 'fluidV4WaterLookV3';
  let look = { ...LOOK_REFERENCE };
  try {
    const saved = JSON.parse(localStorage.getItem(savedKey) || 'null');
    if (saved && typeof saved === 'object') look = { ...look, ...saved };
  } catch {}

  let engineBound = false;
  function applyLook() {
    look.exposure = clamp(look.exposure, 0.80, 2.20);
    look.absorption = clamp(look.absorption, 0.0, 0.90);
    look.thickness = clamp(look.thickness, 0.04, 0.55);
    look.roughness = clamp(look.roughness, 0.008, 0.14);
    look.sun = clamp(look.sun, 0.5, 7.0);
    look.sunElevation = clamp(look.sunElevation, 8, 70);
    look.env = clamp(look.env, 0.35, 1.8);
    look.caustics = clamp(look.caustics, 0.0, 2.0);

    const hits = [
      upstreamSet('exposure', look.exposure),
      upstreamSet('absorption', look.absorption),
      upstreamSet('roughness', look.roughness),
      upstreamSet('sunint', look.sun),
      upstreamSet('sunelev', look.sunElevation),
      upstreamSet('ssfrthick', look.thickness),
      upstreamSet('envintensity', look.env),
      upstreamSet('groundrefl', look.caustics),
    ];
    engineBound = hits.every(Boolean);

    ssfr.ior = 1.333;
    if (ssfr.env) ssfr.env.intensity = look.env;
    ssfr.bindCache = null;

    const badge = document.getElementById('v4TuneLive');
    if (badge) {
      badge.textContent = engineBound ? 'ENGINE BOUND ✓' : 'BIND ERROR';
      badge.style.color = engineBound ? '#9dffc8' : '#ff9f9f';
    }
  }

  applyLook();

  const panel = document.getElementById('settingsPanel');
  if (panel && !document.getElementById('v4LiveWaterTune')) {
    const style = document.createElement('style');
    style.textContent = `
      #settingsPanel{max-height:min(78vh,690px);overflow-y:auto;-webkit-overflow-scrolling:touch}
      .v4Tune{margin-top:11px;padding-top:10px;border-top:1px solid rgba(78,214,220,.22)}
      .v4TuneHead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
      .v4TuneTitle{font-size:10px;color:#86f6ff;letter-spacing:.11em;font-weight:800}
      .v4TuneLive{font-size:8px;color:#9dffc8;letter-spacing:.06em}
      .v4TuneRow{display:grid;grid-template-columns:76px 1fr 42px;align-items:center;gap:7px;margin:7px 0}
      .v4TuneRow label{font-size:8.5px;color:#b6d1dc;letter-spacing:.025em}
      .v4TuneRow input[type=range]{width:100%;margin:0;accent-color:#69e8df;touch-action:pan-x;height:24px}
      .v4TuneVal{font-size:8px;text-align:right;color:#ffd890;font-variant-numeric:tabular-nums}
      .v4TuneButtons{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:9px}
      .v4TuneBtn{appearance:none;border:1px solid rgba(78,214,220,.35);background:rgba(4,17,24,.78);color:#dffcff;border-radius:9px;padding:8px 5px;font:800 8.5px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em}
      .v4TuneBtn.ref{border-color:#f1ad43;color:#ffd890}
      .v4TuneBtn:active{transform:scale(.97)}
      .v4TuneNote{font-size:7.5px;color:#82a6b2;line-height:1.35;margin-top:7px}
      @media(max-width:600px){.v4TuneRow{grid-template-columns:64px 1fr 38px;gap:5px}.v4TuneRow label{font-size:8px}}
    `;
    document.head.appendChild(style);

    const wrap = document.createElement('div');
    wrap.id = 'v4LiveWaterTune';
    wrap.className = 'v4Tune';
    wrap.innerHTML = `
      <div class="v4TuneHead"><div class="v4TuneTitle">WATER + LIGHT · LIVE</div><div id="v4TuneLive" class="v4TuneLive">BINDING…</div></div>
      <div id="v4TuneRows"></div>
      <div class="v4TuneButtons"><button id="v4MatchRef" class="v4TuneBtn ref">MATCH REF</button><button id="v4PoolLook" class="v4TuneBtn">POOL LIGHT</button></div>
      <div class="v4TuneNote">MATCH REF uses the upstream small-scene optics; POOL LIGHT keeps the same clear water but strengthens tiled-pool illumination and caustics.</div>
    `;
    panel.appendChild(wrap);

    const defs = [
      ['exposure', 'EXPOSURE', 0.80, 2.20, 0.01, 2],
      ['absorption', 'ABSORB', 0.00, 0.90, 0.005, 3],
      ['thickness', 'OPT DEPTH', 0.04, 0.55, 0.005, 3],
      ['roughness', 'ROUGHNESS', 0.008, 0.14, 0.001, 3],
      ['sun', 'SUN POWER', 0.50, 7.00, 0.05, 2],
      ['sunElevation', 'SUN ANGLE', 8, 70, 1, 0],
      ['env', 'HDR ENV', 0.35, 1.80, 0.02, 2],
      ['caustics', 'CAUSTICS', 0.00, 2.00, 0.02, 2],
    ];

    const rows = document.getElementById('v4TuneRows');
    const inputs = new Map();
    const updateReadout = (key, input, out, digits) => {
      look[key] = Number(input.value);
      out.textContent = Number(input.value).toFixed(digits);
      applyLook();
      try { localStorage.setItem(savedKey, JSON.stringify(look)); } catch {}
    };

    for (const [key, label, min, max, step, digits] of defs) {
      const row = document.createElement('div');
      row.className = 'v4TuneRow';
      const lab = document.createElement('label');
      lab.textContent = label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(look[key]);
      input.setAttribute('aria-label', label);
      const out = document.createElement('div');
      out.className = 'v4TuneVal';
      out.textContent = Number(look[key]).toFixed(digits);
      input.addEventListener('input', () => updateReadout(key, input, out, digits));
      input.addEventListener('change', () => updateReadout(key, input, out, digits));
      row.append(lab, input, out);
      rows.appendChild(row);
      inputs.set(key, { input, out, digits });
    }

    const syncUI = () => {
      for (const [key, ref] of inputs) {
        ref.input.value = String(look[key]);
        ref.out.textContent = Number(look[key]).toFixed(ref.digits);
      }
      applyLook();
      try { localStorage.setItem(savedKey, JSON.stringify(look)); } catch {}
    };

    document.getElementById('v4MatchRef').onclick = e => {
      e.preventDefault(); e.stopPropagation();
      look = { ...LOOK_REFERENCE };
      syncUI();
    };
    document.getElementById('v4PoolLook').onclick = e => {
      e.preventDefault(); e.stopPropagation();
      look = { ...LOOK_POOL };
      syncUI();
    };

    applyLook();
  }

  const stats = document.getElementById('v4stats');
  if (stats && !stats.textContent.includes('pool-light')) stats.textContent += ' · pool-light';
  console.info('[Fluid V4 lighting] reference-matched water, tiled basin and receiver-driven caustics enabled.');
}
