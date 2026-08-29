// Fluid V5 M6.2 Houdini-style waterfall renderer wrapper.
// Reuses the validated M6 density/aeration/whitewater/mist renderer, but removes every airborne
// recycling path. M6.2 circulation belongs exclusively to the closed-loop reservoir pump.

const url=new URL('./v5-waterfall-houdini-m60.js',import.meta.url);
const response=await fetch(url,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M6.2 renderer source unavailable (${response.status}).`);
let src=await response.text();
const activeOld="const active=()=>String(state.scenario||'').startsWith('waterfall-m58');";
if(!src.includes(activeOld))throw new Error('Fluid V5 M6.2 renderer: active-scenario signature changed.');
src=src.replace(activeOld,"const active=()=>state.scenario==='waterfall-m62';");
const a=src.indexOf('// --- Deterministic fixed-mass circulation');
const b=src.indexOf('// --- Houdini-style screen-space particle-fluid surface');
if(a<0||b<=a)throw new Error('Fluid V5 M6.2 renderer: circulation block signature changed.');
src=src.slice(0,a)+`// --- M6.2 circulation ownership ---------------------------------------------------------------\n// No contact, timeout or time-bucket recycling lives in the renderer. The reservoir pump moves\n// only submerged intake particles to the inlet; airborne waterfall particles are never teleported.\n\n`+src.slice(b);
src=src.replaceAll('M6.0','M6.2');
src=src.replaceAll('fluidV5M60','fluidV5M62');
src=src.replaceAll('pbf-density-surface-whitewater-mist-m60','pbf-density-surface-whitewater-mist-m62');
src=src.replace("window.__v5WaterfallM60={online:true,backend:'pbf-density-surface-whitewater-mist-m62',cycleFrame:0,maxAgeMs:0,surfaceY:0,densitySurface:true,mist:true};","window.__v5WaterfallM60={online:true,backend:'pbf-density-surface-whitewater-mist-m62',surfaceY:0,densitySurface:true,mist:true,reservoir:true};window.__v5WaterfallM62Render=window.__v5WaterfallM60;");
src=src.replace("setTimeout(()=>{const brand=document.querySelector('.hud.card.title');if(brand)brand.textContent='FLUID V5 · M6.2';document.title='Fluid V5 · M6.2 HOUDINI WATERFALL';window.__fluidV5Version='5.4.0-m60';},1000);","setTimeout(()=>{const brand=document.querySelector('.hud.card.title');if(brand)brand.textContent='FLUID V5 · M6.2';document.title='Fluid V5 · M6.2 RESERVOIR HOUDINI WATERFALL';window.__fluidV5Version='6.2.0-m62';},1000);");
const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blob);}finally{URL.revokeObjectURL(blob);}
if(window.__v5WaterfallM60){window.__v5WaterfallM60.backend='pbf-density-surface-whitewater-mist-m62';window.__v5WaterfallM60.reservoir=true;}
console.info('[Fluid V5 M6.2] Houdini body/whitewater/mist renderer online with airborne recycling removed.');
