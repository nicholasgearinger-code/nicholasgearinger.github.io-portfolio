// Fluid V5 M6.6 coherent native PBF waterfall source.
// The waterfall remains real recirculating PBF liquid. This pass concentrates the source into a
// denser five-layer sheet, greatly reduces emitter jitter, and raises conserved physical throughput
// so the pressure/density solver has enough neighbours to form a continuous falling stream.

const quality=new URLSearchParams(location.search).get('quality')||'medium';
const url=new URL('./v5-waterfall-pump-m65.js',import.meta.url);
const response=await fetch(url,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M6.6: unable to load M6.5 pump source (${response.status}).`);
let src=await response.text();

src=src.replaceAll('M6.5','M6.6');
src=src.replaceAll('fluidV5M65','fluidV5M66');
src=src.replaceAll('m65','m66');
src=src.replaceAll('bounded-reservoir-primary-m66','coherent-native-pbf-stream-m66');

// Concentrate the conserved particle budget so a thin sheet retains enough neighbours for PBF.
// Existing saved widths are clamped down too, so this pass takes effect without clearing phone state.
src=src.replace("if(!Number.isFinite(Number(state.waterfallWidth)))state.waterfallWidth=.78;","if(!Number.isFinite(Number(state.waterfallWidth)))state.waterfallWidth=.60;");
src=src.replace("state.waterfallWidth=clamp(Number(state.waterfallWidth),.48,.92);","state.waterfallWidth=clamp(Number(state.waterfallWidth),.50,.64);");
src=src.replace("const topY=clamp(surface+Math.min(.74,b[1]*.295),surface+d*6,b[1]-d*2.5);","const topY=clamp(surface+Math.min(.88,b[1]*.335),surface+d*7,b[1]-d*2.5);");
src=src.replace("const nozzleX=Math.max(d*1.55,b[0]*.036);","const nozzleX=Math.max(d*1.20,b[0]*.022);");
src=src.replace("const vx=.225+.075*flow,vy=-.085-.025*flow,g=Math.max(1,Number(sim.params.gravity)||9.81);","const vx=.205+.045*flow,vy=-.030-.015*flow,g=Math.max(1,Number(sim.params.gravity)||9.81);");
src=src.replace("const minAcross=quality==='low'?14:quality==='high'?28:20,maxAcross=quality==='low'?24:quality==='high'?42:32;","const minAcross=quality==='low'?14:quality==='high'?24:18,maxAcross=quality==='low'?22:quality==='high'?36:28;");
src=src.replace("const thick=quality==='high'?2:1;","const thick=quality==='low'?3:5;");

// Higher physical recirculation keeps roughly 1–3k solved particles in the fall on mobile instead of
// asking SSFR to bridge widely separated droplets.
src=src.replace("const basePeriod=quality==='low'?260:quality==='high'?350:300;","const basePeriod=quality==='low'?48:quality==='high'?28:36;");
src=src.replace("const period=clamp(Math.round(basePeriod/flow),150,600);","const period=clamp(Math.round(basePeriod/flow),24,90);");
src=src.replace("const maxAgeMs=Math.round((fallT+.22)*1000);","const maxAgeMs=Math.round((fallT+.65)*1000);");

// Six staggered inlet rows and five depth layers create a connected source volume. Random position
// and velocity jitter is deliberately tiny; breakup should come from the solve after emission.
src=src.replace("let row=(stable/max(across*thick,1u)+C.mdata.w)%3u;","let row=(stable/max(across*thick,1u)+C.mdata.w)%6u;");
src=src.replace("let x=C.geo0.z+(f32(layer)-f32(thick-1u)*.5)*C.geo1.y*.30+(hx-.5)*C.geo1.y*.025;","let x=C.geo0.z+(f32(layer)-f32(thick-1u)*.5)*C.geo1.y*.58+(hx-.5)*C.geo1.y*.015;");
src=src.replace("let y=C.geo0.y-f32(row)*C.geo1.y*.18-hv*C.geo1.y*.055;","let y=C.geo0.y-f32(row)*C.geo1.y*.45-hv*C.geo1.y*.035;");
src=src.replace("let z=C.geo0.w+(u-.5)*C.geo1.x+(hz-.5)*C.geo1.y*.035;","let z=C.geo0.w+(u-.5)*C.geo1.x+(hz-.5)*C.geo1.y*.025;");
src=src.replace("V[i]=vec4f(C.geo1.z+(hx-.5)*.006,C.geo1.w-hv*.009,(hz-.5)*.010,0.0);","V[i]=vec4f(C.geo1.z+(hx-.5)*.006,C.geo1.w-hv*.006,(hz-.5)*.006,0.0);");

// Keep waterfall classification until actual surface contact; the particle remains ordinary PBF liquid.
src=src.replace("let landed=p.y<=C.geo0.x+C.geo1.y*.90;","let landed=p.y<=C.geo0.x+C.geo1.y*.08;");

// No synthetic ripple bus. Receiving-pool motion is caused by incoming mass and momentum.
src=src.replace("setInterval(rippleTick,90);","// synthetic ripple timer disabled: native PBF impact owns the pool response.");

src=src.replace('THIN PRIMARY PBF','COHERENT NATIVE PBF STREAM');
src=src.replace('Only a small temporary primary curtain is tagged as waterfall fluid. Contact or a hard flight-age budget hands every parcel back to ordinary pool water.','A dense six-row multi-layer inlet feeds actual PBF water. Pressure, XPBD density, local viscosity/cohesion, gravity and pool collisions determine the stream and plunge; no analytic waterfall curtain is present.');

const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blob);}finally{URL.revokeObjectURL(blob);}
if(window.__v5WaterfallM62){
 window.__v5WaterfallM62.backend='coherent-native-pbf-stream-m66';
 window.__v5WaterfallM62.renderDecoupled=false;
 window.__v5WaterfallM62.physicallyCoupled=true;
 window.__v5WaterfallM62.syntheticRipples=false;
 window.__v5WaterfallM62.nativeBody=true;
 window.__v5WaterfallM62.inletRows=6;
 window.__v5WaterfallM62.inletLayers=quality==='low'?3:5;
 window.__v5WaterfallM62.coherentEmitter=true;
}
console.info('[Fluid V5 M6.6] coherent dense native PBF waterfall source online.');
