// Fluid V5 M6.6.1 Safari-safe wrapper for the resampled waterfall renderer.
// Fixes static M6.6 integration/compiler errors before compilation/use:
// 1) quality presets accidentally compared the URLSearchParams object instead of `quality`;
// 2) the mist uniform WGSL struct is 128 bytes, not 112 bytes;
// 3) the body fragment shader mutates alpha, so it must be declared with `var`, not `let`;
// 4) WebKit's WGSL parser rejects the compact M6.6 mist shader on iOS, so replace it
//    with equivalent canonical WGSL using explicit generic types and conservative syntax.

const diag=document.createElement('div');
diag.id='v5WaterfallM661Diag';
diag.style.cssText='display:none;position:fixed;z-index:51;left:12px;right:12px;top:150px;max-width:760px;margin:auto;padding:8px 10px;border:1px solid rgba(255,118,118,.7);border-radius:10px;background:rgba(28,7,11,.94);color:#ffb0b0;font:8px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;pointer-events:none';
document.body.appendChild(diag);

const url=new URL('./v5-waterfall-houdini-m66.js',import.meta.url);
const response=await fetch(url,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M6.6.1: unable to load M6.6 renderer (${response.status}).`);
let src=await response.text();

const fixes=[
 ["const COLS=q==='low'?16:q==='high'?30:22;","const COLS=quality==='low'?16:quality==='high'?30:22;"],
 ["const ROWS=q==='low'?30:q==='high'?58:44;","const ROWS=quality==='low'?30:quality==='high'?58:44;"],
 ["const MIST_CAP=q==='low'?140:q==='high'?520:300;","const MIST_CAP=quality==='low'?140:quality==='high'?520:300;"],
 ["size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST","size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST"],
 ["const MF=new Float32Array(28),MU=new Uint32Array(MF.buffer);","const MF=new Float32Array(32),MU=new Uint32Array(MF.buffer);"],
 ["let alpha=edge*density*C.style.z;","var alpha=edge*density*C.style.z;"],
];
for(const [a,b] of fixes){
 if(src.includes(a))src=src.replace(a,b);
 else if(!src.includes(b))throw new Error(`Fluid V5 M6.6.1 renderer patch signature missing: ${a.slice(0,54)}`);
}

const safeMistWGSL=`
struct U {
  vp: mat4x4<f32>,
  geo: vec4<f32>,
  screen: vec4<f32>,
  tune: vec4<f32>,
  mdata: vec4<u32>,
}

@group(0) @binding(0)
var<uniform> C: U;

struct O {
  @builtin(position) p: vec4<f32>,
  @location(0) q: vec2<f32>,
  @location(1) a: f32,
}

fn hash1(x0: u32) -> f32 {
  var x: u32 = x0;
  x = x ^ (x >> 16u);
  x = x * 0x7feb352du;
  x = x ^ (x >> 15u);
  x = x * 0x846ca68bu;
  x = x ^ (x >> 16u);
  return f32(x) / 4294967295.0;
}

fn corner(i: u32) -> vec2<f32> {
  let a = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0)
  );
  return a[i];
}

@vertex
fn vs(
  @builtin(vertex_index) vi: u32,
  @builtin(instance_index) ii: u32
) -> O {
  var o: O;
  let h0 = hash1(ii * 9187u + 17u);
  let h1 = hash1(ii * 6151u + 89u);
  let h2 = hash1(ii * 3761u + 227u);
  let life = fract(h2 + C.tune.x * (0.23 + 0.27 * h0));
  let x = C.geo.x + (h0 - 0.5) * C.geo.w * 0.18 + 0.10 * life;
  let z = C.geo.y + (h1 - 0.5) * C.geo.z * 0.78;
  let y = C.screen.z + 0.015 + 0.24 * life - 0.15 * life * life;
  let pc = C.vp * vec4<f32>(x, y, z, 1.0);

  if (pc.w <= 0.00001) {
    o.p = vec4<f32>(2.0, 2.0, 2.0, 2.0);
    o.q = vec2<f32>(2.0, 2.0);
    o.a = 0.0;
    return o;
  }

  let q = corner(vi);
  let px = 2.30 / max(C.screen.x, 1.0);
  let py = 4.40 / max(C.screen.y, 1.0);
  let ndc = pc.xy / pc.w + q * vec2<f32>(px, py);
  o.p = vec4<f32>(ndc * pc.w, pc.z, pc.w);
  o.q = q;
  o.a = (1.0 - life) * C.tune.y;
  return o;
}

@fragment
fn fs(v: O) -> @location(0) vec4<f32> {
  let r = length(v.q);
  if (r > 1.0) {
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }
  let a = (1.0 - smoothstep(0.08, 1.0, r)) * v.a * 0.16;
  return vec4<f32>(0.91, 0.97, 1.0, a);
}
`;

const mistDecl='const mistWGSL=`';
const mistStart=src.indexOf(mistDecl);
const mistMarker='`;\nconst mistMod=';
const mistEnd=mistStart>=0?src.indexOf(mistMarker,mistStart+mistDecl.length):-1;
if(mistStart<0||mistEnd<0)throw new Error('Fluid V5 M6.6.1: unable to locate mist WGSL source block.');
src=src.slice(0,mistStart)+'const mistWGSL='+JSON.stringify(safeMistWGSL)+';\nconst mistMod='+src.slice(mistEnd+mistMarker.length);

src=src.replaceAll('M6.6','M6.6.1');
src=src.replaceAll('fluidV5M66','fluidV5M661');
src=src.replaceAll('m66','m661');
src=src.replaceAll('resampled-ballistic-curtain-m661','resampled-ballistic-curtain-m661-safari');

const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{
 await import(blob);
 if(window.__v5WaterfallM60){window.__v5WaterfallM60.backend='resampled-ballistic-curtain-m661-safari';window.__v5WaterfallM60.error='';}
 const S=window.__v5WaterfallM661||window.__v5WaterfallM66;
 if(S){S.backend='resampled-ballistic-curtain-m661-safari';S.safariFixed=true;}
}catch(err){
 window.__v5WaterfallM60={...(window.__v5WaterfallM60||{}),online:false,error:String(err?.message||err),backend:'resampled-ballistic-curtain-m661-safari'};
 diag.style.display='block';diag.textContent='WATERFALL M6.6.1 RENDER ERROR · '+String(err?.message||err);
 throw err;
}finally{URL.revokeObjectURL(blob);}
console.info('[Fluid V5 M6.6.1] corrected resampled waterfall renderer online.');
