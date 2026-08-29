// Fluid V5 M6.5 Houdini-style waterfall body.
// Reuses the M6 density/aeration renderer, removes every legacy circulation path, patches current
// WGSL reserved identifiers for Safari/WebKit, and broadens the screen-space reconstruction so a
// few hundred primary PBF parcels become one coherent curtain instead of visible solver chunks.

const url=new URL('./v5-waterfall-houdini-m60.js',import.meta.url);
const response=await fetch(url,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M6.5 renderer source unavailable (${response.status}).`);
let src=await response.text();
const activeOld="const active=()=>String(state.scenario||'').startsWith('waterfall-m58');";
if(!src.includes(activeOld))throw new Error('Fluid V5 M6.5 renderer: active-scenario signature changed.');
src=src.replace(activeOld,"const active=()=>state.scenario==='waterfall-m62';");
const a=src.indexOf('// --- Deterministic fixed-mass circulation');
const b=src.indexOf('// --- Houdini-style screen-space particle-fluid surface');
if(a<0||b<=a)throw new Error('Fluid V5 M6.5 renderer: circulation block signature changed.');
src=src.slice(0,a)+`// --- M6.5 circulation ownership ---------------------------------------------------------------\n// The bounded M6.5 reservoir source owns lifecycle. Airborne particles are never recycled here.\n\n`+src.slice(b);

// Current Safari/WebKit WGSL rejects some identifiers accepted by other implementations.
src=src.replaceAll('meta:vec4u','mdata:vec4u');
src=src.replaceAll('C.meta','C.mdata');

// Replace the compact legacy mist shader with deliberately conservative WGSL. The old one-line
// declarations hit a WebKit parser failure at the end of the module (reported as GlobalDecl 11:1).
// This keeps the same 128-byte uniform layout and render bindings, so no JS-side renderer changes
// are required; it only makes the impact mist module portable across Safari's WGSL parser.
const mistStart=src.indexOf('const mistWGSL=`');
const mistEnd=mistStart>=0?src.indexOf('`;\nconst mistMod=',mistStart):-1;
if(mistStart<0||mistEnd<0)throw new Error('Fluid V5 M6.5 renderer: mist shader signature changed.');
const safeMistDecl=[
'const mistWGSL=`',
'struct MistUniform {',
'  vp: mat4x4<f32>,',
'  geo: vec4<f32>,',
'  screen: vec4<f32>,',
'  tune: vec4<f32>,',
'  mdata: vec4<u32>,',
'}',
'',
'@group(0) @binding(0) var<uniform> C: MistUniform;',
'',
'struct MistOut {',
'  @builtin(position) pos: vec4<f32>,',
'  @location(0) quad: vec2<f32>,',
'  @location(1) alpha: f32,',
'  @location(2) ptype: f32,',
'}',
'',
'fn hash1(seedIn: u32) -> f32 {',
'  var x: u32 = seedIn;',
'  x = x ^ (x >> 16u);',
'  x = x * 0x7feb352du;',
'  x = x ^ (x >> 15u);',
'  x = x * 0x846ca68bu;',
'  x = x ^ (x >> 16u);',
'  return f32(x) / 4294967295.0;',
'}',
'',
'fn corner(i: u32) -> vec2<f32> {',
'  let corners = array<vec2<f32>, 6>(',
'    vec2<f32>(-1.0, -1.0),',
'    vec2<f32>( 1.0, -1.0),',
'    vec2<f32>(-1.0,  1.0),',
'    vec2<f32>(-1.0,  1.0),',
'    vec2<f32>( 1.0, -1.0),',
'    vec2<f32>( 1.0,  1.0)',
'  );',
'  return corners[i];',
'}',
'',
'@vertex',
'fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> MistOut {',
'  var out: MistOut;',
'  if (C.mdata.y == 0u) {',
'    out.pos = vec4<f32>(2.0, 2.0, 2.0, 2.0);',
'    out.quad = vec2<f32>(2.0, 2.0);',
'    out.alpha = 0.0;',
'    out.ptype = 0.0;',
'    return out;',
'  }',
'',
'  let h0 = hash1(ii * 9187u + 17u);',
'  let h1 = hash1(ii * 6151u + 89u);',
'  let h2 = hash1(ii * 3761u + 227u);',
'  let h3 = hash1(ii * 1597u + 601u);',
'  let ptype = select(0.0, 1.0, h3 >= 0.72);',
'  let life = fract(h2 + C.tune.x * mix(0.21, 0.52, ptype));',
'  let spread = C.geo.z * mix(0.42, 0.64, ptype);',
'  let worldX = C.geo.x + (h0 - 0.5) * C.geo.w * 0.15 + mix(0.03, 0.16, ptype) * life;',
'  let worldZ = C.geo.y + (h1 - 0.5) * spread;',
'  let worldY = C.geo.w + mix(0.02, 0.30, ptype) * life - mix(0.01, 0.16, ptype) * life * life;',
'  let clip = C.vp * vec4<f32>(worldX, worldY, worldZ, 1.0);',
'  if (clip.w <= 0.00001) {',
'    out.pos = vec4<f32>(2.0, 2.0, 2.0, 2.0);',
'    out.quad = vec2<f32>(2.0, 2.0);',
'    out.alpha = 0.0;',
'    out.ptype = ptype;',
'    return out;',
'  }',
'',
'  let q = corner(vi);',
'  let px = mix(1.4, 1.0, ptype) * 2.0 / max(C.screen.x, 1.0);',
'  let py = mix(1.4, 3.1, ptype) * 2.0 / max(C.screen.y, 1.0);',
'  let ndc = clip.xy / clip.w + q * vec2<f32>(px, py);',
'  out.pos = vec4<f32>(ndc * clip.w, clip.z, clip.w);',
'  out.quad = q;',
'  out.alpha = (1.0 - life) * C.tune.y;',
'  out.ptype = ptype;',
'  return out;',
'}',
'',
'@fragment',
'fn fs(input: MistOut) -> @location(0) vec4<f32> {',
'  let radius = length(input.quad);',
'  if (radius > 1.0) {',
'    discard;',
'  }',
'  let soft = 1.0 - smoothstep(0.10, 1.0, radius);',
'  let alpha = soft * input.alpha * mix(0.055, 0.22, input.ptype);',
'  let rgb = mix(vec3<f32>(0.82, 0.92, 0.96), vec3<f32>(0.96, 1.0, 1.0), input.ptype);',
'  return vec4<f32>(rgb, alpha);',
'}',
'`;'
].join('\n');
src=src.slice(0,mistStart)+safeMistDecl+src.slice(mistEnd+2);

// Broader anisotropic field splats: fewer primary particles reconstruct as a continuous FLIP-like body.
src=src.replace("C.geo.z*(1.35+clamp(sp*.08,0.0,.65))","C.geo.z*(2.20+clamp(sp*.10,0.0,.90))");
src=src.replace("side*C.geo.z*.72","side*C.geo.z*1.02");
src=src.replace("length(sn-cn)*1.30","length(sn-cn)*1.52");
src=src.replace("length(ln-cn)*1.28","length(ln-cn)*1.58");
// Lower density threshold + softer edge makes the primary sheet read as one body, not islands.
src=src.replace("let body=smoothstep(.035,.24,den*C.tune.x);","let body=smoothstep(.016,.115,den*C.tune.x);");
src=src.replace("let edge=clamp(length(vec2f(gx,gy))*4.5,0.0,1.0);","let edge=clamp(length(vec2f(gx,gy))*3.0,0.0,1.0);");
src=src.replace("let white=clamp(.22+aer*.56+edge*.24+streak*.12+fine*.05+speed*.08,0.0,1.0);","let white=clamp(.18+aer*.62+edge*.14+streak*.10+fine*.035+speed*.06,0.0,1.0);");
src=src.replace("let water=vec3f(.13,.39,.52);let foam=vec3f(.94,.985,1.0);","let water=vec3f(.10,.34,.48);let foam=vec3f(.95,.99,1.0);");
src=src.replaceAll('M6.0','M6.5');
src=src.replaceAll('fluidV5M60','fluidV5M65');
src=src.replaceAll('pbf-density-surface-whitewater-mist-m60','pbf-density-surface-whitewater-mist-m65');
src=src.replace("window.__v5WaterfallM60={online:true,backend:'pbf-density-surface-whitewater-mist-m65',cycleFrame:0,maxAgeMs:0,surfaceY:0,densitySurface:true,mist:true};","window.__v5WaterfallM60={online:true,backend:'pbf-density-surface-whitewater-mist-m65',surfaceY:0,densitySurface:true,mist:true,boundedPrimary:true};window.__v5WaterfallM65Render=window.__v5WaterfallM60;");
src=src.replace("setTimeout(()=>{const brand=document.querySelector('.hud.card.title');if(brand)brand.textContent='FLUID V5 · M6.5';document.title='Fluid V5 · M6.5 HOUDINI WATERFALL';window.__fluidV5Version='5.4.0-m60';},1000);","setTimeout(()=>{const brand=document.querySelector('.hud.card.title');if(brand)brand.textContent='FLUID V5 · M6.5';document.title='Fluid V5 · M6.5 BOUNDED HOUDINI WATERFALL';window.__fluidV5Version='6.5.0-m65';},1000);");
const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blob);}finally{URL.revokeObjectURL(blob);}
if(window.__v5WaterfallM60){window.__v5WaterfallM60.backend='pbf-density-surface-whitewater-mist-m65';window.__v5WaterfallM60.boundedPrimary=true;}
console.info('[Fluid V5 M6.5] Safari-safe coherent density body + impact mist renderer online.');