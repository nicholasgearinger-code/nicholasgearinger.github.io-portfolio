// Fluid V4.2 pool presentation + receiver caustics.
// Loads the existing PBF integration/tuning, then rebuilds only the final SSFR composite.
// Physics remains untouched.

await import('./lighting-tune.js');

const PIN = '58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0';
const ROOT = `https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@${PIN}/`;
const CW = await import(ROOT + 'src/ssfr_composite_wgsl.js');
const ssfr = window.__ssfr;

if (!ssfr?.dev || !ssfr?.format) {
  console.warn('[Fluid V4.2] SSFR unavailable; keeping previous composite.');
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

  // The simulation domain is intentionally tall to allow splashes. The visible tiled pool
  // lining is not: cap the side walls just above the normal water level.
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

  if (!src.includes(floorNeedle)) throw new Error('Fluid V4.2: upstream floor signature changed.');
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
      let far = select(kHaze, envSample(d), C.hasEnvMap != 0);
      let haze = min(0.075, 1.0 - exp(-0.010 * ph.t));
      return mix(tile, far, vec3f(haze));
    }
  }
  return skyColor(d);
}`;

  if (!src.includes(bgNeedle)) throw new Error('Fluid V4.2: upstream background signature changed.');
  src = src.replace(bgNeedle, bgPatch);

  const transNeedle = '  let trans = hitCol * exp(-C.absorb * thick);';
  const transPatch = `  let poolHit = tracePool(ro2, refrDir);
  if (poolHit.t < 1.0e29) {
    thick = min(thick, poolHit.t);
  }

  // Approximate light focusing from the live refracted surface. The derivative term moves
  // with every PBF ripple/wave. Receiver-facing weighting keeps caustics readable on both
  // the floor and the submerged vertical tile walls.
  let refrDx = dpdx(refrDir);
  let refrDy = dpdy(refrDir);
  let convergence = max(0.0, -(refrDx.x + refrDy.y));
  let curvature = length(refrDx) + length(refrDy);
  let receiver = select(0.0, 1.0, poolHit.t < 1.0e29);
  let receiverFacing = max(dot(poolHit.n, -refrDir), 0.0);
  let focus = min(2.8, convergence * 54.0 + curvature * 4.0) * receiver;
  focus *= 0.42 + 0.58 * receiverFacing;
  let causticGain = 0.28 + 1.30 * clamp(C.groundReflection, 0.0, 2.0);

  // Warm-white refracted sunlight, preserving the aqua tile colour beneath it.
  hitCol *= vec3f(1.0 + focus * causticGain * 0.72,
                  1.0 + focus * causticGain * 0.69,
                  1.0 + focus * causticGain * 0.56);
  hitCol += vec3f(1.0, 0.97, 0.86) * focus * causticGain * 0.12;

  let trans = hitCol * exp(-C.absorb * thick);`;

  if (!src.includes(transNeedle)) throw new Error('Fluid V4.2: upstream transmission signature changed.');
  src = src.replace(transNeedle, transPatch);

  const mod = ssfr.dev.createShaderModule({ code: src, label: 'fluidV42PoolCausticsWGSL' });
  ssfr.pipeComposite = ssfr.dev.createRenderPipeline({
    label: 'fluidV42PoolCausticsComposite',
    layout: 'auto',
    vertex: { module: mod, entryPoint: 'vs' },
    fragment: { module: mod, entryPoint: 'fs', targets: [{ format: ssfr.format }] },
    primitive: { topology: 'triangle-list' },
  });
  ssfr.bindCache = null;

  const stats = document.getElementById('v4stats');
  if (stats && !stats.textContent.includes('short-wall')) stats.textContent += ' · short-wall · wall-caustics';
  console.info('[Fluid V4.2] shorter tiled pool walls and bottom/side caustics enabled.');
}
