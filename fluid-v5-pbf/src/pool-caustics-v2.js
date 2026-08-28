// Fluid V4.2.1 pool presentation + stable receiver caustics.
// Loads the existing PBF integration/tuning, then rebuilds only the final SSFR composite.
// Physics remains untouched. This version intentionally avoids WGSL screen derivatives in
// divergent fragment control flow because mobile WebGPU can reject that pipeline.

await import('./lighting-tune.js');

const PIN = '58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0';
const ROOT = `https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@${PIN}/`;
const CW = await import(ROOT + 'src/ssfr_composite_wgsl.js');
const ssfr = window.__ssfr;

if (!ssfr?.dev || !ssfr?.format) {
  console.warn('[Fluid V4.2.1] SSFR unavailable; keeping previous composite.');
} else {
  let src = CW.compositePrelude + CW.compositeFS;

  // Preserve the bright HDR reflection response while leaving groundReflection free as our
  // caustic-strength control.
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

  const poolFns = `fn poolTileColor(p: vec3f, n: vec3f) -> vec3f {
  var uv = p.xz * 8.5;
  if (abs(n.x) > 0.5) { uv = p.zy * 8.5; }
  if (abs(n.z) > 0.5) { uv = p.xy * 8.5; }
  let cell = floor(uv);
  let q = abs(fract(uv) - vec2f(0.5));
  let grout = smoothstep(0.435, 0.492, max(q.x, q.y));
  let alt = (cell.x + cell.y) - 2.0 * floor((cell.x + cell.y) * 0.5);
  let aquaA = vec3f(0.31, 0.68, 0.74);
  let aquaB = vec3f(0.45, 0.79, 0.82);
  var c = mix(aquaA, aquaB, vec3f(alt * 0.70));
  c = mix(c, vec3f(0.88, 0.96, 0.97), vec3f(grout * 0.84));
  let ndl = max(dot(n, C.sunDir), 0.0);
  c *= 0.80 + 0.30 * ndl;
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

  // Keep the tall physics domain for splashes, but render a normal pool lining only a little
  // above the resting waterline.
  let wallTop = lo.y + (hi.y - lo.y) * 0.37;

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
    if (t > 1.0e-4 && p.y >= lo.y - pad && p.y <= wallTop && p.z >= lo.z - pad && p.z <= hi.z + pad && t < h.t) {
      h.t = t; h.n = vec3f(1.0, 0.0, 0.0); h.p = p;
    }
    t = (hi.x - o.x) / d.x;
    p = o + d * t;
    if (t > 1.0e-4 && p.y >= lo.y - pad && p.y <= wallTop && p.z >= lo.z - pad && p.z <= hi.z + pad && t < h.t) {
      h.t = t; h.n = vec3f(-1.0, 0.0, 0.0); h.p = p;
    }
  }

  if (abs(d.z) > 1.0e-5) {
    var t = (lo.z - o.z) / d.z;
    var p = o + d * t;
    if (t > 1.0e-4 && p.y >= lo.y - pad && p.y <= wallTop && p.x >= lo.x - pad && p.x <= hi.x + pad && t < h.t) {
      h.t = t; h.n = vec3f(0.0, 0.0, 1.0); h.p = p;
    }
    t = (hi.z - o.z) / d.z;
    p = o + d * t;
    if (t > 1.0e-4 && p.y >= lo.y - pad && p.y <= wallTop && p.x >= lo.x - pad && p.x <= hi.x + pad && t < h.t) {
      h.t = t; h.n = vec3f(0.0, 0.0, -1.0); h.p = p;
    }
  }
  return h;
}`;

  if (!src.includes(floorNeedle)) throw new Error('Fluid V4.2.1: upstream floor signature changed.');
  src = src.replace(floorNeedle, poolFns);

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
      var far = kHaze;
      if (C.hasEnvMap != 0) { far = envSample(d); }
      let haze = min(0.075, 1.0 - exp(-0.010 * ph.t));
      return mix(tile, far, vec3f(haze));
    }
  }
  return skyColor(d);
}`;

  if (!src.includes(bgNeedle)) throw new Error('Fluid V4.2.1: upstream background signature changed.');
  src = src.replace(bgNeedle, bgPatch);

  const transNeedle = '  let trans = hitCol * exp(-C.absorb * thick);';
  const transPatch = `  let poolHit = tracePool(ro2, refrDir);
  if (poolHit.t < 1.0e29) {
    thick = min(thick, poolHit.t);
  }

  // Stable mobile caustics: no dpdx/dpdy. The pattern is projected in receiver space and
  // warped by the live reconstructed water normal + Snell refraction direction, so ripples
  // physically move and squeeze the bright bands without triggering WGSL derivative rules.
  let receiver = select(0.0, 1.0, poolHit.t < 1.0e29);
  let receiverFacing = max(dot(poolHit.n, -refrDir), 0.0);
  let receiverSun = 0.22 + 0.78 * abs(dot(poolHit.n, C.sunDir));

  var cuv = poolHit.p.xz * 7.5;
  var cwarp = refrDir.xz * 2.2 + n.xz * 3.4;
  if (abs(poolHit.n.x) > 0.5) {
    cuv = poolHit.p.zy * 7.5;
    cwarp = refrDir.zy * 2.2 + n.zy * 3.4;
  }
  if (abs(poolHit.n.z) > 0.5) {
    cuv = poolHit.p.xy * 7.5;
    cwarp = refrDir.xy * 2.2 + n.xy * 3.4;
  }

  let a = sin((cuv.x + cwarp.x) * 6.2831853 + (cuv.y + cwarp.y) * 2.30);
  let b = sin((cuv.y - cwarp.y * 0.72) * 7.15 - (cuv.x + cwarp.x * 0.44) * 1.85);
  let c = sin((cuv.x + cuv.y + cwarp.x - cwarp.y) * 4.35);
  let cells = clamp(0.48 + 0.22 * a + 0.20 * b + 0.14 * c, 0.0, 1.0);
  let bands = pow(smoothstep(0.56, 0.90, cells), 2.2);
  let waveEnergy = clamp(0.18 + length(n.xz) * 2.0 + abs(refrDir.x) * 0.30 + abs(refrDir.z) * 0.30, 0.0, 1.35);
  let focus = bands * waveEnergy * receiver * receiverFacing * receiverSun;
  let causticGain = 0.24 + 1.18 * clamp(C.groundReflection, 0.0, 2.0);

  hitCol *= vec3f(1.0 + focus * causticGain * 0.78,
                  1.0 + focus * causticGain * 0.75,
                  1.0 + focus * causticGain * 0.62);
  hitCol += vec3f(1.0, 0.97, 0.86) * focus * causticGain * 0.14;

  let trans = hitCol * exp(-C.absorb * thick);`;

  if (!src.includes(transNeedle)) throw new Error('Fluid V4.2.1: upstream transmission signature changed.');
  src = src.replace(transNeedle, transPatch);

  const mod = ssfr.dev.createShaderModule({ code: src, label: 'fluidV421StablePoolCausticsWGSL' });
  const previousPipe = ssfr.pipeComposite;
  try {
    // Validate asynchronously and only swap the live renderer after the pipeline is known-good.
    // If mobile WebGPU rejects the custom shader, the proven previous composite stays active.
    const nextPipe = await ssfr.dev.createRenderPipelineAsync({
      label: 'fluidV421StablePoolCausticsComposite',
      layout: 'auto',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format: ssfr.format }] },
      primitive: { topology: 'triangle-list' },
    });
    ssfr.pipeComposite = nextPipe;
    ssfr.bindCache = null;

    const stats = document.getElementById('v4stats');
    if (stats && !stats.textContent.includes('stable-caustics')) stats.textContent += ' · short-wall · stable-caustics';
    console.info('[Fluid V4.2.1] stable derivative-free bottom/side caustics enabled.');
  } catch (err) {
    ssfr.pipeComposite = previousPipe;
    console.error('[Fluid V4.2.1] custom caustic pipeline rejected; retained previous stable renderer.', err);
  }
}
