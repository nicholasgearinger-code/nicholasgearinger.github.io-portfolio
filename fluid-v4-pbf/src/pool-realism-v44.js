// Fluid V4.4 experimental realism stack.
// Builds one consolidated composite from the validated V4.3 realtime-caustic base, then adds:
// micro/capillary ripples, volumetric caustic shafts, spectral dispersion, wet waterlines,
// energetic edge foam, stronger refracted object shadows, depth scattering, and a true
// two-frame WebGPU temporal accumulation pass. PBF particle physics remains untouched.

await import('./lighting-tune.js');

const ssfr = window.__ssfr;
if (!ssfr?.dev || !ssfr?.format) throw new Error('Fluid V4.4: SSFR unavailable.');
const dev = ssfr.dev;

const STORAGE_KEY = 'fluidV44RealismLabV1';
const realism = {
  micro: 0.34,
  volume: 0.30,
  dispersion: 0.42,
  wet: 0.58,
  foam: 0.24,
  shadow: 0.82,
  scattering: 0.34,
  temporal: 0.24,
};
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (saved && typeof saved === 'object') {
    for (const k of Object.keys(realism)) {
      const v = Number(saved[k]);
      if (Number.isFinite(v)) realism[k] = Math.min(1.25, Math.max(0, v));
    }
  }
} catch {}
const saveRealism = () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(realism)); } catch {}
};

// Extend the upstream 256-byte composite uniform without changing any of its existing offsets.
// The original renderer continues writing bytes 0..255; V4.4 owns two vec4s at 256..287.
const oldCompUni = ssfr.compUni;
ssfr.compUni = dev.createBuffer({
  label: 'fluidV44CompositeUniform',
  size: 288,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
ssfr.bindCache = null;
// Keep oldCompUni alive until GC; an in-flight frame may still reference it.
void oldCompUni;

const realismF = new Float32Array(8);
const baseRender = ssfr.render;
let temporalEnabledLast = false;
let temporalW = 0, temporalH = 0;
let currentTex = null, currentView = null;
let historyTex = [null, null], historyView = [null, null];
let historyRead = 0;
let historyReady = false;

const temporalSampler = dev.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const temporalUni = dev.createBuffer({
  label: 'fluidV44TemporalUniform',
  size: 16,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const temporalUF = new Float32Array(4);
const temporalShader = `
struct T { blend:f32, ready:f32, reject:f32, pad:f32 }
@group(0) @binding(0) var<uniform> U:T;
@group(0) @binding(1) var curTex:texture_2d<f32>;
@group(0) @binding(2) var histTex:texture_2d<f32>;
@group(0) @binding(3) var samp:sampler;
struct V { @builtin(position) pos:vec4f, @location(0) uv:vec2f }
@vertex fn vs(@builtin(vertex_index) i:u32)->V {
  let p=vec2f(f32((i<<1u)&2u),f32(i&2u));
  var o:V; o.uv=vec2f(p.x,1.0-p.y); o.pos=vec4f(p*2.0-1.0,0.0,1.0); return o;
}
struct O { @location(0) screen:vec4f, @location(1) history:vec4f }
@fragment fn fs(v:V)->O {
  let c=textureSampleLevel(curTex,samp,v.uv,0.0);
  let h=textureSampleLevel(histTex,samp,v.uv,0.0);
  let dl=abs(dot(c.rgb-h.rgb,vec3f(0.299,0.587,0.114)));
  let stable=exp(-dl*U.reject)*U.ready;
  let a=clamp(U.blend*stable,0.0,0.72);
  let r=vec4f(mix(c.rgb,h.rgb,vec3f(a)),1.0);
  var o:O; o.screen=r; o.history=r; return o;
}`;
const temporalMod = dev.createShaderModule({ code: temporalShader, label: 'fluidV44TemporalWGSL' });
const temporalPipe = await dev.createRenderPipelineAsync({
  label: 'fluidV44Temporal', layout: 'auto',
  vertex: { module: temporalMod, entryPoint: 'vs' },
  fragment: { module: temporalMod, entryPoint: 'fs', targets: [{ format: ssfr.format }, { format: ssfr.format }] },
  primitive: { topology: 'triangle-list' },
});

function destroyTemporalTargets() {
  currentTex?.destroy?.();
  historyTex[0]?.destroy?.();
  historyTex[1]?.destroy?.();
  currentTex = null; currentView = null;
  historyTex = [null, null]; historyView = [null, null];
}
function ensureTemporalTargets(w, h) {
  w = Math.max(1, w | 0); h = Math.max(1, h | 0);
  if (currentTex && temporalW === w && temporalH === h) return;
  destroyTemporalTargets();
  temporalW = w; temporalH = h;
  const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
  currentTex = dev.createTexture({ label:'fluidV44Current', size:[w,h], format:ssfr.format, usage });
  currentView = currentTex.createView();
  for (let i=0;i<2;i++) {
    historyTex[i] = dev.createTexture({ label:`fluidV44History${i}`, size:[w,h], format:ssfr.format, usage });
    historyView[i] = historyTex[i].createView();
  }
  historyRead = 0;
  historyReady = false;
}

ssfr.render = function(...args) {
  const now = performance.now() * 0.001;
  realismF[0] = now;
  realismF[1] = realism.micro;
  realismF[2] = realism.volume;
  realismF[3] = realism.dispersion;
  realismF[4] = realism.wet;
  realismF[5] = realism.foam;
  realismF[6] = realism.shadow;
  realismF[7] = realism.scattering;
  dev.queue.writeBuffer(this.compUni, 256, realismF);

  const temporalOn = realism.temporal > 0.005;
  if (!temporalOn) {
    if (temporalEnabledLast) historyReady = false;
    temporalEnabledLast = false;
    return baseRender.apply(this, args);
  }
  temporalEnabledLast = true;

  const enc = args[0];
  const target = args[1];
  const width = args[10] || 1;
  const height = args[11] || 1;
  ensureTemporalTargets(width, height);

  const altered = args.slice();
  altered[1] = currentView;
  baseRender.apply(this, altered);

  const write = 1 - historyRead;
  temporalUF[0] = Math.min(0.70, realism.temporal * 0.62);
  temporalUF[1] = historyReady ? 1 : 0;
  temporalUF[2] = 11.0;
  temporalUF[3] = 0;
  dev.queue.writeBuffer(temporalUni, 0, temporalUF);
  const bg = dev.createBindGroup({
    layout: temporalPipe.getBindGroupLayout(0),
    entries: [
      { binding:0, resource:{ buffer:temporalUni } },
      { binding:1, resource:currentView },
      { binding:2, resource:historyView[historyRead] },
      { binding:3, resource:temporalSampler },
    ],
  });
  const pass = enc.beginRenderPass({
    colorAttachments: [
      { view:target, clearValue:{r:0,g:0,b:0,a:1}, loadOp:'clear', storeOp:'store' },
      { view:historyView[write], clearValue:{r:0,g:0,b:0,a:1}, loadOp:'clear', storeOp:'store' },
    ],
  });
  pass.setPipeline(temporalPipe);
  pass.setBindGroup(0, bg);
  pass.draw(3);
  pass.end();
  historyRead = write;
  historyReady = true;
};

// Build V4.4 from the full validated V4.3 shader source instead of stacking source wrappers.
const v43Url = new URL('./pool-caustics-v3.js', import.meta.url);
const response = await fetch(v43Url, { cache:'no-store' });
if (!response.ok) throw new Error(`Fluid V4.4: unable to load realtime-caustic base (${response.status}).`);
let moduleSource = await response.text();
moduleSource = moduleSource.replace("await import('./lighting-tune.js');", '// lighting already initialized by V4.4');
moduleSource = moduleSource.replaceAll('Fluid V4.3', 'Fluid V4.4');
moduleSource = moduleSource.replaceAll('fluidV43', 'fluidV44');

const patches = [];
patches.push([
`  mapScale    : vec2f,
}`,
`  mapScale    : vec2f,
  realism0    : vec4f,
  realism1    : vec4f,
}`,
'extended realism uniforms']);

patches.push([
`fn poolTileColor(p: vec3f, n: vec3f) -> vec3f {`,
`fn realismMicro(p: vec3f) -> vec2f {
  let t = C.realism0.x;
  let a = sin(p.x * 31.0 + p.z * 17.0 + t * 4.15);
  let b = sin(p.x * -23.0 + p.z * 29.0 - t * 3.35);
  let c = sin((p.x + p.z) * 43.0 + t * 5.30);
  return vec2f(a + c * 0.38, b - c * 0.31) * (0.018 * C.realism0.y);
}

fn realismShadow(p: vec3f) -> f32 {
  if (C.bodyCount <= 0 || C.realism1.z <= 0.001) { return 1.0; }
  let centre = bdata[0u].xyz;
  let radius = max(bdata[1u].x, 1.0e-4);
  let oc = p - centre;
  let qb = dot(oc, C.sunDir);
  let qc = dot(oc, oc) - radius * radius;
  let disc = qb * qb - qc;
  if (disc <= 0.0) { return 1.0; }
  let root = sqrt(disc);
  let tNear = -qb - root;
  let tFar = -qb + root;
  if (tFar <= 0.0) { return 1.0; }
  let softness = smoothstep(0.0, radius * radius * 0.26, disc);
  return mix(1.0, 0.20, softness * C.realism1.z);
}

fn poolTileColor(p: vec3f, n: vec3f) -> vec3f {`,
'realism helpers']);

patches.push([
`  let ndl = max(dot(n, C.sunDir), 0.0);
  c *= 0.80 + 0.30 * ndl;
  return c;`,
`  let ndl = max(dot(n, C.sunDir), 0.0);
  let restY = C.boxMin.y + (C.boxMax.y - C.boxMin.y) * 0.28;
  let side = 1.0 - abs(n.y);
  let submerged = 1.0 - smoothstep(restY - 0.018, restY + 0.018, p.y);
  let waterline = exp(-abs(p.y - restY) * 54.0) * side;
  c *= 0.76 + 0.30 * ndl;
  c *= 1.0 - submerged * side * C.realism1.x * 0.075;
  c *= 1.0 - waterline * C.realism1.x * 0.20;
  c *= realismShadow(p);
  return c;`,
'wet receiver and direct shadow']);

patches.push([
`  o.valid = 1.0;
  o.p = (C.invView * vec4f(pc, 1.0)).xyz;
  o.n = nw;`,
`  let wp = (C.invView * vec4f(pc, 1.0)).xyz;
  let mr = realismMicro(wp);
  nw = normalize(nw + vec3f(mr.x, 0.0, mr.y));
  o.valid = 1.0;
  o.p = wp;
  o.n = nw;`,
'micro ripples in caustic surface']);

patches.push([
`  if (dot(n, rd) > 0.0) { n = -n; }

  if (C.debug == 1)`,
`  if (dot(n, rd) > 0.0) { n = -n; }
  let microN = realismMicro(p);
  n = normalize(n + vec3f(microN.x, 0.0, microN.y));
  if (dot(n, rd) > 0.0) { n = -n; }

  if (C.debug == 1)`,
'micro ripples in visible surface']);

patches.push([
`  var causticFocus = 0.0;
  var causticTransmission = vec3f(1.0);`,
`  var causticFocus = 0.0;
  var causticTransmission = vec3f(1.0);
  var causticSpectrum = vec3f(1.0);`,
'caustic spectral state']);

const focusNeedle = `      let sx = causticSurfaceAt(sourcePixel + vec2i(1, 0), lim);
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
      }`;
const focusReplacement = `      let sx = causticSurfaceAt(sourcePixel + vec2i(2, 0), lim);
      let sy = causticSurfaceAt(sourcePixel + vec2i(0, 2), lim);
      if (h0.t < 1.0e29 && sx.valid > 0.5 && sy.valid > 0.5) {
        var rayX = refract(sunIn, sx.n, 1.0 / C.ior);
        var rayY = refract(sunIn, sy.n, 1.0 / C.ior);
        if (dot(rayX, rayX) < 1.0e-8) { rayX = sunIn; }
        if (dot(rayY, rayY) < 1.0e-8) { rayY = sunIn; }
        let hx = tracePool(sx.p + rayX * 1.0e-3, rayX);
        let hy = tracePool(sy.p + rayY * 1.0e-3, rayY);

        let dxSurf = sx.p - s0.p;
        let dySurf = sy.p - s0.p;
        let lenX = max(length(dxSurf), 1.0e-4);
        let lenY = max(length(dySurf), 1.0e-4);
        let angularDiv = dot(rayX - ray0, dxSurf / lenX) / lenX +
                         dot(rayY - ray0, dySurf / lenY) / lenY;
        let angularCompression = max(-angularDiv, 0.0);
        let angularFocus = smoothstep(0.010, 0.24, angularCompression) * 1.85 +
                           min(1.35, angularCompression * 0.48);

        var receiverFocus = 0.0;
        if (hx.t < 1.0e29 && hy.t < 1.0e29 &&
            dot(h0.n, hx.n) > 0.62 && dot(h0.n, hy.n) > 0.62) {
          let surfaceArea = max(length(cross(dxSurf, dySurf)), 1.0e-7);
          let receiverArea = max(length(cross(hx.p - h0.p, hy.p - h0.p)), 1.0e-7);
          let concentration = clamp(surfaceArea / receiverArea, 0.0, 10.0);
          receiverFocus = max(concentration - 0.60, 0.0);
        }
        let focused = max(receiverFocus, angularFocus);

        let miss = h0.p - receiverP;
        let deposit = exp(-dot(miss, miss) * 4.2);
        let incidence = max(dot(s0.n, C.sunDir), 0.0);
        let fresnelLoss = 1.0 - fresnelFull(incidence, 1.0, C.ior);
        let receiverCos = max(dot(h0.n, -ray0), 0.0);

        // Tiny wavelength-dependent IOR offsets create real spatial RGB separation at the
        // receiving tile instead of tinting a procedural pattern.
        let spread = 0.0060 * clamp(C.realism0.w, 0.0, 1.25);
        if (spread > 1.0e-5) {
          var rayR = refract(sunIn, s0.n, 1.0 / max(1.001, C.ior - spread));
          var rayB = refract(sunIn, s0.n, 1.0 / (C.ior + spread));
          if (dot(rayR, rayR) < 1.0e-8) { rayR = ray0; }
          if (dot(rayB, rayB) < 1.0e-8) { rayB = ray0; }
          let hR = tracePool(s0.p + rayR * 1.0e-3, rayR);
          let hB = tracePool(s0.p + rayB * 1.0e-3, rayB);
          var dR = deposit;
          var dB = deposit;
          if (hR.t < 1.0e29 && dot(hR.n, h0.n) > 0.50) {
            let mr = hR.p - receiverP; dR = exp(-dot(mr, mr) * 4.2);
          }
          if (hB.t < 1.0e29 && dot(hB.n, h0.n) > 0.50) {
            let mb = hB.p - receiverP; dB = exp(-dot(mb, mb) * 4.2);
          }
          let invD = 1.0 / max(deposit, 0.08);
          causticSpectrum = clamp(vec3f(dR, deposit, dB) * invD, vec3f(0.45), vec3f(1.65));
        }

        var unoccluded = 1.0;
        if (C.bodyCount > 0) {
          let centre = bdata[0u].xyz;
          let radius = max(bdata[1u].x, 1.0e-4);
          let oc = receiverP - centre;
          let qb = dot(oc, C.sunDir);
          let qc = dot(oc, oc) - radius * radius;
          let disc = qb * qb - qc;
          if (disc > 0.0 && (-qb + sqrt(disc)) > 0.0) {
            unoccluded = mix(1.0, 0.06, C.realism1.z);
          }
        }

        let sunScale = clamp(C.sunIntensity / 3.2, 0.0, 2.35);
        let floorPreference = clamp(0.14 + 0.86 * max(h0.n.y, 0.0), 0.14, 1.0);
        let receiverLight = (0.18 + 0.82 * receiverCos) * floorPreference;
        causticFocus = min(5.2, focused * deposit * incidence * receiverLight *
                           fresnelLoss * sunAbove * sunScale * unoccluded * 1.35);
        causticTransmission = exp(-C.absorb * max(h0.t, 0.0));
      }`;
patches.push([focusNeedle, focusReplacement, 'high contrast spectral floor caustics']);

patches.push([
`  let causticGain = 0.28 + 1.22 * clamp(C.groundReflection, 0.0, 2.0);
  let focusedEnergy = causticFocus * causticGain;
  // A small redistribution dip between focused regions stops the effect reading like emissive
  // paint while preserving enough ambient pool light for mobile displays.
  let redistribution = 0.94 + min(1.55, focusedEnergy * 0.46);
  hitCol *= vec3f(redistribution * 1.025, redistribution * 1.012, redistribution);
  hitCol += vec3f(1.0, 0.97, 0.86) * causticTransmission * focusedEnergy * 0.19;`,
`  let causticGain = 0.62 + 1.62 * clamp(C.groundReflection, 0.0, 2.0);
  let focusedEnergy = causticFocus * causticGain;
  let redistribution = 0.82 + min(2.35, focusedEnergy * 0.72);
  hitCol *= vec3f(redistribution * 1.025, redistribution * 1.012, redistribution);
  hitCol += vec3f(1.0, 0.97, 0.84) * causticSpectrum * causticTransmission * focusedEnergy * 0.42;`,
'high contrast spectral receiver']);

patches.push([
`  let trans = hitCol * exp(-C.absorb * thick);`,
`  let attenuation = exp(-C.absorb * thick);
  let opticalDepth = 1.0 - exp(-max(thick, 0.0) * 1.35);
  let forward = pow(max(dot(-refrDir, C.sunDir), 0.0), 2.4);
  let scatterPhase = 0.22 + 0.78 * forward;
  let scatterTint = vec3f(0.19, 0.58, 0.72);
  let singleScatter = scatterTint * opticalDepth * scatterPhase * C.realism1.w *
                      clamp(C.sunIntensity / 5.0, 0.0, 1.5) * 0.23;
  // Shafts share the solved caustic focus, so visible beams move when the real PBF surface
  // changes and rotate when the real sun direction changes.
  let shaftDepth = smoothstep(0.04, 0.62, thick);
  let shaftPhase = 0.28 + 0.72 * pow(max(dot(-rd, C.sunDir), 0.0), 1.4);
  let shaftEnergy = focusedEnergy * shaftDepth * shaftPhase * C.realism0.z * 0.095;
  let trans = hitCol * attenuation + singleScatter +
              vec3f(1.0, 0.96, 0.82) * causticSpectrum * shaftEnergy;`,
'depth scattering and volumetric shafts']);

patches.push([
`  var col = mix(trans, refl, vec3f(kS));`,
`  var col = mix(trans, refl, vec3f(kS));
  let restY44 = C.boxMin.y + (C.boxMax.y - C.boxMin.y) * 0.28;
  let ex = min(abs(p.x - C.boxMin.x), abs(C.boxMax.x - p.x));
  let ez = min(abs(p.z - C.boxMin.z), abs(C.boxMax.z - p.z));
  let nearWall = 1.0 - smoothstep(0.025, 0.16, min(ex, ez));
  let slope = 1.0 - clamp(abs(n.y), 0.0, 1.0);
  let energetic = smoothstep(0.20, 0.62, slope);
  let foam = (energetic * (0.18 + 0.82 * nearWall) + smoothstep(0.62, 0.88, slope) * 0.15) * C.realism1.y;
  let meniscus = nearWall * exp(-abs(p.y - restY44) * 58.0) * C.realism1.x;
  let whiteWater = clamp(foam * 0.44 + meniscus * 0.10, 0.0, 0.48);
  col = mix(col, vec3f(0.92, 0.98, 1.0), vec3f(whiteWater));`,
'foam and meniscus']);

const marker = `  const mod = ssfr.dev.createShaderModule({ code: src, label: 'fluidV44RealtimeCausticsWGSL' });`;
if (!moduleSource.includes(marker)) throw new Error('Fluid V4.4: base pipeline marker changed.');
const injection = `
  const v44Replace = (needle, replacement, label) => {
    if (!src.includes(needle)) throw new Error('Fluid V4.4 patch missing: ' + label);
    src = src.replace(needle, replacement);
  };
${patches.map(([a,b,c]) => `  v44Replace(${JSON.stringify(a)}, ${JSON.stringify(b)}, ${JSON.stringify(c)});`).join('\n')}
`;
moduleSource = moduleSource.replace(marker, injection + '\n' + marker);
moduleSource = moduleSource.replace(
  "if (stats && !stats.textContent.includes('ray-caustics')) stats.textContent += ' · ray-caustics · sun-linked';",
  "if (stats && !stats.textContent.includes('ray-caustics')) stats.textContent += ' · V4.4-realism';"
);
moduleSource = moduleSource.replace(
  "console.info('[Fluid V4.4] realtime receiver-space refracted-sun caustics enabled.');",
  "console.info('[Fluid V4.4] realtime caustics + full realism lab enabled.');"
);

const blobUrl = URL.createObjectURL(new Blob([moduleSource], { type:'text/javascript' }));
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}

// Preserve the proven V4.3.2 aimable sun controls.
await import(new URL('./caustic-angle.js', import.meta.url).href);

function installRealismUI() {
  const panel = document.getElementById('settingsPanel');
  if (!panel || document.getElementById('v44RealismLab')) return !!panel;
  const style = document.createElement('style');
  style.textContent = `
    .v44Lab{margin-top:11px;padding-top:10px;border-top:1px solid rgba(78,214,220,.22)}
    .v44Head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}
    .v44Title{font-size:10px;color:#86f6ff;letter-spacing:.11em;font-weight:800}.v44Badge{font-size:8px;color:#9dffc8}
    .v44Row{display:grid;grid-template-columns:76px 1fr 38px;align-items:center;gap:6px;margin:6px 0}
    .v44Row label{font-size:8px;color:#b6d1dc}.v44Row input{width:100%;margin:0;accent-color:#69e8df;height:23px;touch-action:pan-x}
    .v44Val{font-size:8px;color:#ffd890;text-align:right;font-variant-numeric:tabular-nums}
    .v44Buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-top:8px}
    .v44Btn{appearance:none;border:1px solid rgba(78,214,220,.34);background:rgba(4,17,24,.78);color:#dffcff;border-radius:8px;padding:8px 3px;font:800 8px ui-monospace,SFMono-Regular,Menlo,monospace}
    .v44Btn.full{border-color:#f1ad43;color:#ffd890}.v44Note{font-size:7.3px;color:#82a6b2;line-height:1.4;margin-top:7px}
    @media(max-width:600px){.v44Row{grid-template-columns:63px 1fr 35px;gap:5px}.v44Row label{font-size:7.7px}}
  `;
  document.head.appendChild(style);
  const wrap = document.createElement('div');
  wrap.id = 'v44RealismLab';
  wrap.className = 'v44Lab';
  wrap.innerHTML = `<div class="v44Head"><div class="v44Title">REALISM LAB · V4.4</div><div class="v44Badge">8 LIVE FX</div></div><div id="v44Rows"></div><div class="v44Buttons"><button class="v44Btn" data-v44="off">OFF</button><button class="v44Btn" data-v44="balanced">BALANCED</button><button class="v44Btn full" data-v44="full">FULL</button></div><div class="v44Note">All effects are physically tied to the reconstructed PBF surface or refracted sun path. TEMPORAL is a real history-buffer pass; raise it carefully on moving cameras.</div>`;
  panel.appendChild(wrap);
  const defs = [
    ['micro','MICRO RIPPLE'], ['volume','LIGHT SHAFT'], ['dispersion','DISPERSION'], ['wet','WET LINE'],
    ['foam','EDGE FOAM'], ['shadow','SUN SHADOW'], ['scattering','SCATTER'], ['temporal','TEMPORAL'],
  ];
  const rows = document.getElementById('v44Rows');
  const refs = new Map();
  for (const [key,label] of defs) {
    const row = document.createElement('div'); row.className='v44Row';
    const lab=document.createElement('label'); lab.textContent=label;
    const input=document.createElement('input'); input.type='range'; input.min='0'; input.max=key==='temporal'?'0.85':'1.25'; input.step='0.01'; input.value=String(realism[key]); input.setAttribute('aria-label',label);
    const out=document.createElement('div'); out.className='v44Val'; out.textContent=Number(realism[key]).toFixed(2);
    const update=()=>{ realism[key]=Math.max(0,Math.min(Number(input.max),Number(input.value)||0)); out.textContent=realism[key].toFixed(2); if(key==='temporal') historyReady=false; saveRealism(); };
    input.addEventListener('input',update); input.addEventListener('change',update);
    row.append(lab,input,out); rows.appendChild(row); refs.set(key,{input,out});
  }
  const presets = {
    off:{micro:0,volume:0,dispersion:0,wet:0,foam:0,shadow:0,scattering:0,temporal:0},
    balanced:{micro:.34,volume:.30,dispersion:.42,wet:.58,foam:.24,shadow:.82,scattering:.34,temporal:.24},
    full:{micro:.70,volume:.72,dispersion:.78,wet:.82,foam:.55,shadow:1.0,scattering:.72,temporal:.42},
  };
  const applyPreset = name => {
    Object.assign(realism,presets[name]);
    for (const [k,r] of refs) { r.input.value=String(realism[k]); r.out.textContent=realism[k].toFixed(2); }
    historyReady=false; saveRealism();
  };
  for (const b of wrap.querySelectorAll('[data-v44]')) b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();applyPreset(b.dataset.v44);});
  wrap.addEventListener('pointerdown',e=>e.stopPropagation()); wrap.addEventListener('click',e=>e.stopPropagation());
  return true;
}
function bootUI(){ if(!installRealismUI()) setTimeout(bootUI,50); }
bootUI();

const stats = document.getElementById('v4stats');
if (stats && !stats.textContent.includes('realism-lab')) stats.textContent += ' · realism-lab';
window.__fluidV44Realism = realism;
console.info('[Fluid V4.4] realism lab ready: micro ripples, shafts, dispersion, wet line, foam, shadows, scattering, temporal history.');
