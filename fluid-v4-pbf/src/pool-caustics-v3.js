// Fluid V4.3 realtime refracted-light caustics.
// Loads the existing PBF integration/tuning, then rebuilds only the final SSFR composite.
// Physics remains untouched. Caustics are solved from the live reconstructed water surface
// and actual sun direction/intensity using explicit finite samples (no dpdx/dpdy), keeping
// the pass compatible with mobile WebGPU validation rules.

await import('./lighting-tune.js');

const PIN = '58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0';
const ROOT = `https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@${PIN}/`;
const CW = await import(ROOT + 'src/ssfr_composite_wgsl.js');
const ssfr = window.__ssfr;

if (!ssfr?.dev || !ssfr?.format) {
  console.warn('[Fluid V4.3] SSFR unavailable; keeping previous composite.');
} else {
  let src = CW.compositePrelude + CW.compositeFS;

  // Preserve the bright HDR reflection response while leaving groundReflection free as our
  // live caustic-strength control.
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

  if (!src.includes(floorNeedle)) throw new Error('Fluid V4.3: upstream floor signature changed.');
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

  if (!src.includes(bgNeedle)) throw new Error('Fluid V4.3: upstream background signature changed.');
  src = src.replace(bgNeedle, bgPatch);

  // Add mobile-safe helpers that use the already-generated SSFR eye-depth texture as a live
  // water-surface database. This lets the caustic pass solve from receiver -> sun -> water.
  const toneNeedle = `fn tonemap(c: vec3f) -> vec3f {`;
  const causticHelpers = `struct CausticSurface { valid : f32, p : vec3f, n : vec3f }

fn causticPixelNdc(q: vec2i, lim: vec2i) -> vec2f {
  let uv = (vec2f(q) + vec2f(0.5)) / vec2f(lim);
  return vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
}

fn causticWorldToPixel(w: vec3f, lim: vec2i) -> vec2i {
  let rel = w - C.eye.xyz;
  let vx = dot(rel, C.invView[0].xyz);
  let vy = dot(rel, C.invView[1].xyz);
  let vz = dot(rel, C.invView[2].xyz);
  if (vz > -1.0e-4) { return vec2i(-4096); }
  let ndc = vec2f(-vx * C.proj00 / vz, -vy * C.proj11 / vz);
  let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  return vec2i(floor(uv * vec2f(lim)));
}

fn causticSurfaceAt(q: vec2i, lim: vec2i) -> CausticSurface {
  var o : CausticSurface;
  o.valid = 0.0;
  o.p = vec3f(0.0);
  o.n = vec3f(0.0, 1.0, 0.0);
  if (q.x < 1 || q.y < 1 || q.x >= lim.x - 1 || q.y >= lim.y - 1) { return o; }

  let zc = textureLoad(uEyeZ, q, 0).r;
  let zxp = fetchNeighbourZ(q + vec2i(1, 0), lim);
  let zxm = fetchNeighbourZ(q - vec2i(1, 0), lim);
  let zyp = fetchNeighbourZ(q - vec2i(0, 1), lim);
  let zym = fetchNeighbourZ(q + vec2i(0, 1), lim);
  if (isEmptyZ(zc) || isEmptyZ(zxp) || isEmptyZ(zxm) || isEmptyZ(zyp) || isEmptyZ(zym)) { return o; }

  let ndc = causticPixelNdc(q, lim);
  let stepNdc = 2.0 / vec2f(lim);
  let pc = viewPos(ndc, zc);
  let pr = viewPos(ndc + vec2f(stepNdc.x, 0.0), zxp);
  let pl = viewPos(ndc - vec2f(stepNdc.x, 0.0), zxm);
  let pt = viewPos(ndc + vec2f(0.0, stepNdc.y), zyp);
  let pb = viewPos(ndc - vec2f(0.0, stepNdc.y), zym);

  var tx = pc - pl;
  if (abs(pr.z - pc.z) < abs(pc.z - pl.z)) { tx = pr - pc; }
  var ty = pc - pb;
  if (abs(pt.z - pc.z) < abs(pc.z - pb.z)) { ty = pt - pc; }

  let nView = normalize(cross(tx, ty));
  let iv = mat3x3f(C.invView[0].xyz, C.invView[1].xyz, C.invView[2].xyz);
  var nw = normalize(iv * nView);
  if (any(nw != nw)) { return o; }
  if (nw.y < 0.0) { nw = -nw; }

  o.valid = 1.0;
  o.p = (C.invView * vec4f(pc, 1.0)).xyz;
  o.n = nw;
  return o;
}

fn tonemap(c: vec3f) -> vec3f {`;
  if (!src.includes(toneNeedle)) throw new Error('Fluid V4.3: upstream tonemap signature changed.');
  src = src.replace(toneNeedle, causticHelpers);

  const transNeedle = '  let trans = hitCol * exp(-C.absorb * thick);';
  const transPatch = `  let poolHit = tracePool(ro2, refrDir);
  if (poolHit.t < 1.0e29) {
    thick = min(thick, poolHit.t);
  }

  // V4.3 true realtime caustics. Start at the visible receiver, backtrace toward the actual
  // sun to the approximate resting surface, then snap that guess onto the LIVE SSFR water
  // depth. Refract the real sun ray with Snell's law and compare neighbouring ray footprints.
  // The surface/receiver area ratio is a direct photon-density estimate: compression brightens,
  // expansion darkens. No procedural sine pattern and no screen derivatives are involved.
  var causticFocus = 0.0;
  var causticTransmission = vec3f(1.0);
  let receiverValid = poolHit.t < 1.0e29;
  let sunAbove = smoothstep(0.015, 0.16, C.sunDir.y);

  if (receiverValid && sunAbove > 0.0) {
    let receiverP = poolHit.p;
    let restWaterY = C.boxMin.y + (C.boxMax.y - C.boxMin.y) * 0.28;
    let backT = max(0.0, (restWaterY - receiverP.y) / max(C.sunDir.y, 0.06));
    let firstGuess = receiverP + C.sunDir * backT;
    var sourcePixel = causticWorldToPixel(firstGuess, lim);
    var s0 = causticSurfaceAt(sourcePixel, lim);

    if (s0.valid > 0.5) {
      let sunIn = -normalize(C.sunDir);
      var ray0 = refract(sunIn, s0.n, 1.0 / C.ior);
      if (dot(ray0, ray0) < 1.0e-8) { ray0 = sunIn; }
      var h0 = tracePool(s0.p + ray0 * 1.0e-3, ray0);

      // One receiver-space correction removes most of the error from using an approximate
      // resting water level. It shifts the sampled surface by the ray's landing miss and
      // re-samples the actual animated water there.
      if (h0.t < 1.0e29) {
        let correctedGuess = s0.p - (h0.p - receiverP);
        let correctedPixel = causticWorldToPixel(correctedGuess, lim);
        let corrected = causticSurfaceAt(correctedPixel, lim);
        if (corrected.valid > 0.5) {
          sourcePixel = correctedPixel;
          s0 = corrected;
          ray0 = refract(sunIn, s0.n, 1.0 / C.ior);
          if (dot(ray0, ray0) < 1.0e-8) { ray0 = sunIn; }
          h0 = tracePool(s0.p + ray0 * 1.0e-3, ray0);
        }
      }

      let sx = causticSurfaceAt(sourcePixel + vec2i(1, 0), lim);
      let sy = causticSurfaceAt(sourcePixel - vec2i(0, 1), lim);
      if (h0.t < 1.0e29 && sx.valid > 0.5 && sy.valid > 0.5) {
        var rayX = refract(sunIn, sx.n, 1.0 / C.ior);
        var rayY = refract(sunIn, sy.n, 1.0 / C.ior);
        if (dot(rayX, rayX) < 1.0e-8) { rayX = sunIn; }
        if (dot(rayY, rayY) < 1.0e-8) { rayY = sunIn; }
        let hx = tracePool(sx.p + rayX * 1.0e-3, rayX);
        let hy = tracePool(sy.p + rayY * 1.0e-3, rayY);

        if (hx.t < 1.0e29 && hy.t < 1.0e29 &&
            dot(h0.n, hx.n) > 0.90 && dot(h0.n, hy.n) > 0.90) {
          let surfaceArea = max(length(cross(sx.p - s0.p, sy.p - s0.p)), 1.0e-7);
          let receiverArea = max(length(cross(hx.p - h0.p, hy.p - h0.p)), 1.0e-7);
          let concentration = clamp(surfaceArea / receiverArea, 0.0, 8.0);
          let focused = max(concentration - 0.92, 0.0);

          // Deposit onto the actual visible receiver. The correction above normally makes this
          // error tiny; the soft kernel keeps the solver stable at silhouettes and splash edges.
          let miss = h0.p - receiverP;
          let deposit = exp(-dot(miss, miss) * 18.0);
          let incidence = max(dot(s0.n, C.sunDir), 0.0);
          let fresnelLoss = 1.0 - fresnelFull(incidence, 1.0, C.ior);
          let receiverCos = max(dot(h0.n, -ray0), 0.0);

          // Analytic rigid-sphere occlusion: caustics disappear inside the ball's real shadow.
          var unoccluded = 1.0;
          if (C.bodyCount > 0) {
            let centre = bdata[0u].xyz;
            let radius = max(bdata[1u].x, 1.0e-4);
            let oc = receiverP - centre;
            let qb = dot(oc, C.sunDir);
            let qc = dot(oc, oc) - radius * radius;
            let disc = qb * qb - qc;
            if (disc > 0.0 && (-qb + sqrt(disc)) > 0.0) { unoccluded = 0.08; }
          }

          let sunScale = clamp(C.sunIntensity / 4.5, 0.0, 1.8);
          causticFocus = min(3.4, focused * deposit * incidence * receiverCos *
                            fresnelLoss * sunAbove * sunScale * unoccluded);
          causticTransmission = exp(-C.absorb * max(h0.t, 0.0));
        }
      }
    }
  }

  let causticGain = 0.28 + 1.22 * clamp(C.groundReflection, 0.0, 2.0);
  let focusedEnergy = causticFocus * causticGain;
  // A small redistribution dip between focused regions stops the effect reading like emissive
  // paint while preserving enough ambient pool light for mobile displays.
  let redistribution = 0.94 + min(1.55, focusedEnergy * 0.46);
  hitCol *= vec3f(redistribution * 1.025, redistribution * 1.012, redistribution);
  hitCol += vec3f(1.0, 0.97, 0.86) * causticTransmission * focusedEnergy * 0.19;

  let trans = hitCol * exp(-C.absorb * thick);`;

  if (!src.includes(transNeedle)) throw new Error('Fluid V4.3: upstream transmission signature changed.');
  src = src.replace(transNeedle, transPatch);

  const mod = ssfr.dev.createShaderModule({ code: src, label: 'fluidV43RealtimeCausticsWGSL' });
  const previousPipe = ssfr.pipeComposite;
  try {
    // Validate before swapping. A rejected V4.3 pipeline leaves the proven previous renderer
    // active rather than taking down the simulation on mobile WebGPU.
    const nextPipe = await ssfr.dev.createRenderPipelineAsync({
      label: 'fluidV43RealtimeCausticsComposite',
      layout: 'auto',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format: ssfr.format }] },
      primitive: { topology: 'triangle-list' },
    });
    ssfr.pipeComposite = nextPipe;
    ssfr.bindCache = null;

    const stats = document.getElementById('v4stats');
    if (stats && !stats.textContent.includes('ray-caustics')) stats.textContent += ' · ray-caustics · sun-linked';
    console.info('[Fluid V4.3] realtime receiver-space refracted-sun caustics enabled.');
  } catch (err) {
    ssfr.pipeComposite = previousPipe;
    console.error('[Fluid V4.3] realtime caustic pipeline rejected; retained previous stable renderer.', err);
  }
}
