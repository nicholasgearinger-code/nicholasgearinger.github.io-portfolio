// Fluid V4 lighter cyan water pass + live mobile tuning controls.
// Keep the PBF physics untouched; tune only environment, SSFR optics and pool lighting.

await import('./main.js');

const PIN = '58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0';
const ROOT = `https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@${PIN}/`;
const CW = await import(ROOT + 'src/ssfr_composite_wgsl.js');
const ssfr = window.__ssfr;

if (!ssfr?.dev || !ssfr?.format) {
  console.warn('[Fluid V4 lighting] SSFR handle unavailable; keeping previous optics.');
} else {
  try {
    if (ssfr.env) {
      await ssfr.env.load(ROOT + 'env/quarry_cloudy_1k.hdr');
      ssfr.env.intensity = 1.15;
      ssfr.env.yaw = 0.0;
      ssfr.bindCache = null;
    }
  } catch (err) {
    console.warn('[Fluid V4 lighting] HDR environment failed; using fallback sky.', err);
  }

  let src = CW.compositePrelude + CW.compositeFS;

  // Lift very dark HDR reflections so side/grazing views stay pool-blue rather than navy.
  src = src.replace(
    '  let physical = envReflect(d);',
    '  let physical = envReflect(d) * 0.68 + vec3f(0.12, 0.20, 0.25);'
  );

  const floorRe = /fn floorColor\(p: vec3f\) -> vec3f \{[\s\S]*?\n\}/;
  const poolFloor = `fn floorColor(p: vec3f) -> vec3f {
  let uv = p.xz * 8.0;
  let cell = floor(uv);
  let f = abs(fract(uv) - vec2f(0.5));
  let grout = 1.0 - smoothstep(0.455, 0.49, max(f.x, f.y));
  let alt = (cell.x + cell.y) - 2.0 * floor((cell.x + cell.y) * 0.5);
  let aquaA = vec3f(0.28, 0.63, 0.70);
  let aquaB = vec3f(0.40, 0.75, 0.80);
  var c = mix(aquaA, aquaB, vec3f(alt * 0.66));
  c = mix(c, vec3f(0.84, 0.95, 0.95), vec3f(grout * 0.82));
  return c;
}`;
  if (floorRe.test(src)) src = src.replace(floorRe, poolFloor);

  const floorNeedle = '      return mix(floorColor(p), far, vec3f(fade));';
  const floorPatch = `      var floorLit = floorColor(p);
      let sunFill = 1.05 + 0.30 * max(C.sunDir.y, 0.0);
      floorLit = floorLit * sunFill + vec3f(0.05, 0.07, 0.075);
      if (C.bodyCount > 0) {
        let centre = bdata[0u].xyz;
        let radius = max(bdata[1u].x, 1.0e-4);
        let oc = p - centre;
        let qb = dot(oc, C.sunDir);
        let qc = dot(oc, oc) - radius * radius;
        let disc = qb * qb - qc;
        if (disc > 0.0) {
          let root = sqrt(disc);
          let tFar = -qb + root;
          if (tFar > 0.0) {
            let edge = smoothstep(0.0, radius * radius * 0.22, disc);
            let shadow = mix(1.0, 0.56, edge);
            floorLit *= vec3f(shadow * 0.97, shadow * 0.99, shadow * 1.02);
          }
        }
      }
      return mix(floorLit, far, vec3f(fade));`;
  if (src.includes(floorNeedle)) src = src.replace(floorNeedle, floorPatch);

  const transNeedle = '  let trans = hitCol * exp(-C.absorb * thick);';
  const transPatch = `  let refrDx = dpdx(refrDir);
  let refrDy = dpdy(refrDir);
  let convergence = max(0.0, -(refrDx.x + refrDy.y));
  let causticDepth = smoothstep(0.020, 0.28, thick);
  let causticDown = smoothstep(0.10, 0.86, -refrDir.y);
  let focus = min(1.55, convergence * 30.0) * causticDepth * causticDown;
  hitCol *= vec3f(1.0 + focus * 0.36, 1.0 + focus * 0.34, 1.0 + focus * 0.27);
  hitCol += vec3f(1.00, 0.98, 0.90) * focus * 0.11;

  let attenuation = exp(-C.absorb * thick);
  let scatterAmount = 1.0 - exp(-thick * 0.42);
  let waterScatter = vec3f(0.065, 0.18, 0.22) * scatterAmount;
  let trans = hitCol * attenuation + waterScatter;`;
  if (src.includes(transNeedle)) src = src.replace(transNeedle, transPatch);

  const mod = ssfr.dev.createShaderModule({ code: src, label: 'fluidV4EngineBoundWaterWGSL' });
  ssfr.pipeComposite = ssfr.dev.createRenderPipeline({
    label: 'fluidV4EngineBoundWaterComposite',
    layout: 'auto',
    vertex: { module: mod, entryPoint: 'vs' },
    fragment: { module: mod, entryPoint: 'fs', targets: [{ format: ssfr.format }] },
    primitive: { topology: 'triangle-list' },
  });
  ssfr.bindCache = null;

  // IMPORTANT: Particles4All copies its internal RayMarch values back into SSFR every frame.
  // Therefore values such as exposure/absorption/roughness/sun MUST be changed through the
  // upstream hidden controls, whose oninput handlers mutate that RayMarch object. Directly
  // assigning ssfr.exposure etc. only lasts until the next animation frame.
  const upstreamSet = (id, value) => {
    const el = document.getElementById(id);
    if (!el || typeof el.oninput !== 'function') return false;
    el.value = String(value);
    el.oninput();
    return true;
  };

  const LOOK_DEFAULTS = {
    exposure: 1.78,
    absorption: 0.045,
    thickness: 0.070,
    roughness: 0.025,
    sun: 4.45,
    sunElevation: 34,
    env: 1.15,
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v)));
  const savedKey = 'fluidV4WaterLookV2';
  let look = { ...LOOK_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(savedKey) || 'null');
    if (saved && typeof saved === 'object') look = { ...look, ...saved };
  } catch {}

  let engineBound = false;
  function applyLook() {
    look.exposure = clamp(look.exposure, 0.45, 2.8);
    look.absorption = clamp(look.absorption, 0.0, 1.2);
    look.thickness = clamp(look.thickness, 0.015, 1.2);
    look.roughness = clamp(look.roughness, 0.004, 0.18);
    look.sun = clamp(look.sun, 0.2, 8.0);
    look.sunElevation = clamp(look.sunElevation, 5, 80);
    look.env = clamp(look.env, 0.0, 2.5);

    const hits = [
      upstreamSet('exposure', look.exposure),
      upstreamSet('absorption', look.absorption),
      upstreamSet('roughness', look.roughness),
      upstreamSet('sunint', look.sun),
      upstreamSet('sunelev', look.sunElevation),
      upstreamSet('ssfrthick', look.thickness),
      upstreamSet('envintensity', look.env),
    ];
    engineBound = hits.every(Boolean);

    // These are not overwritten by the upstream per-frame RayMarch->SSFR sync.
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
      #settingsPanel{max-height:min(76vh,650px);overflow-y:auto;-webkit-overflow-scrolling:touch}
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
      .v4TuneBtn:active{transform:scale(.97)}
      .v4TuneNote{font-size:7.5px;color:#82a6b2;line-height:1.35;margin-top:7px}
      @media(max-width:600px){.v4TuneRow{grid-template-columns:64px 1fr 38px;gap:5px}.v4TuneRow label{font-size:8px}}
    `;
    document.head.appendChild(style);

    const wrap = document.createElement('div');
    wrap.id = 'v4LiveWaterTune';
    wrap.className = 'v4Tune';
    wrap.innerHTML = `
      <div class="v4TuneHead"><div class="v4TuneTitle">WATER LOOK · LIVE</div><div id="v4TuneLive" class="v4TuneLive">BINDING…</div></div>
      <div id="v4TuneRows"></div>
      <div class="v4TuneButtons"><button id="v4ClearLook" class="v4TuneBtn">CLEAR WATER</button><button id="v4ResetLook" class="v4TuneBtn">RESET LOOK</button></div>
      <div class="v4TuneNote">These controls now drive the PBF engine's own RayMarch/SSFR settings, so changes persist every frame.</div>
    `;
    panel.appendChild(wrap);

    const defs = [
      ['exposure', 'EXPOSURE', 0.45, 2.80, 0.01, 2],
      ['absorption', 'ABSORB', 0.00, 1.20, 0.005, 3],
      ['thickness', 'THICKNESS', 0.015, 1.20, 0.005, 3],
      ['roughness', 'ROUGHNESS', 0.004, 0.18, 0.001, 3],
      ['sun', 'SUN POWER', 0.20, 8.00, 0.05, 2],
      ['sunElevation', 'SUN ANGLE', 5, 80, 1, 0],
      ['env', 'HDR ENV', 0.00, 2.50, 0.02, 2],
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

    document.getElementById('v4ResetLook').onclick = e => {
      e.preventDefault(); e.stopPropagation();
      look = { ...LOOK_DEFAULTS };
      syncUI();
    };
    document.getElementById('v4ClearLook').onclick = e => {
      e.preventDefault(); e.stopPropagation();
      look = {
        ...look,
        exposure: 1.90,
        absorption: 0.012,
        thickness: 0.035,
        roughness: 0.018,
        sun: 4.8,
        sunElevation: 38,
        env: 1.20,
      };
      syncUI();
    };

    // Refresh badge now that it exists.
    applyLook();
  }

  const stats = document.getElementById('v4stats');
  if (stats && !stats.textContent.includes('tune-bound')) stats.textContent += ' · tune-bound';
  console.info('[Fluid V4 lighting] engine-bound water-look sliders enabled; upstream frame overwrite fixed.');
}
