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
// Current WGSL reserves `meta`; patch every surviving renderer uniform member before compilation.
src=src.replaceAll('meta:vec4u','mdata:vec4u');
src=src.replaceAll('C.meta','C.mdata');
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