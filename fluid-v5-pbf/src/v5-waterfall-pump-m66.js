// Fluid V5 M6.6 broad native PBF waterfall source.
// The reference target is a wide, coherent falling sheet rather than an atomized cloud. This pass
// keeps the waterfall as conserved recirculating PBF liquid, but spreads it across a broad lip with
// stable depth layers and enough solved throughput for a continuous curtain on mobile.

const quality=new URLSearchParams(location.search).get('quality')||'medium';
const url=new URL('./v5-waterfall-pump-m65.js',import.meta.url);
const response=await fetch(url,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M6.6: unable to load M6.5 pump source (${response.status}).`);
let src=await response.text();

src=src.replaceAll('M6.5','M6.6');
src=src.replaceAll('fluidV5M65','fluidV5M66');
src=src.replaceAll('m65','m66');
src=src.replaceAll('bounded-reservoir-primary-m66','broad-native-pbf-curtain-m66');

// Broad waterfall lip. Existing saved phone values are clamped into the new range automatically.
src=src.replace("if(!Number.isFinite(Number(state.waterfallWidth)))state.waterfallWidth=.78;","if(!Number.isFinite(Number(state.waterfallWidth)))state.waterfallWidth=.72;");
src=src.replace("state.waterfallWidth=clamp(Number(state.waterfallWidth),.48,.92);","state.waterfallWidth=clamp(Number(state.waterfallWidth),.64,.82);");
src=src.replace("const topY=clamp(surface+Math.min(.74,b[1]*.295),surface+d*6,b[1]-d*2.5);","const topY=clamp(surface+Math.min(.92,b[1]*.35),surface+d*8,b[1]-d*2.5);");
src=src.replace("const nozzleX=Math.max(d*1.55,b[0]*.036);","const nozzleX=Math.max(d*1.10,b[0]*.020);");
src=src.replace("const vx=.225+.075*flow,vy=-.085-.025*flow,g=Math.max(1,Number(sim.params.gravity)||9.81);","const vx=.175+.035*flow,vy=-.020-.010*flow,g=Math.max(1,Number(sim.params.gravity)||9.81);");
src=src.replace("const minAcross=quality==='low'?14:quality==='high'?28:20,maxAcross=quality==='low'?24:quality==='high'?42:32;","const minAcross=quality==='low'?18:quality==='high'?30:24,maxAcross=quality==='low'?26:quality==='high'?42:34;");
src=src.replace("const thick=quality==='high'?2:1;","const thick=quality==='low'?3:4;");

// Keep a substantial solved mass in free fall, but back off the previous over-dense emitter so the
// lower curtain can form streaks and breakup rather than collapsing into large gelatinous clumps.
src=src.replace("const basePeriod=quality==='low'?260:quality==='high'?350:300;","const basePeriod=quality==='low'?78:quality==='high'?42:56;");
src=src.replace("const period=clamp(Math.round(basePeriod/flow),150,600);","const period=clamp(Math.round(basePeriod/flow),34,120);");
src=src.replace("const maxAgeMs=Math.round((fallT+.22)*1000);","const maxAgeMs=Math.round((fallT+.60)*1000);");

// Six stable inlet rows create a sheet volume. Jitter is intentionally tiny: breakup should emerge
// downstream from solved motion, not from a noisy emitter.
src=src.replace("let row=(stable/max(across*thick,1u)+C.mdata.w)%3u;","let row=(stable/max(across*thick,1u)+C.mdata.w)%6u;");
src=src.replace("let x=C.geo0.z+(f32(layer)-f32(thick-1u)*.5)*C.geo1.y*.30+(hx-.5)*C.geo1.y*.025;","let x=C.geo0.z+(f32(layer)-f32(thick-1u)*.5)*C.geo1.y*.52+(hx-.5)*C.geo1.y*.012;");
src=src.replace("let y=C.geo0.y-f32(row)*C.geo1.y*.18-hv*C.geo1.y*.055;","let y=C.geo0.y-f32(row)*C.geo1.y*.42-hv*C.geo1.y*.030;");
src=src.replace("let z=C.geo0.w+(u-.5)*C.geo1.x+(hz-.5)*C.geo1.y*.035;","let z=C.geo0.w+(u-.5)*C.geo1.x+(hz-.5)*C.geo1.y*.020;");
src=src.replace("V[i]=vec4f(C.geo1.z+(hx-.5)*.006,C.geo1.w-hv*.009,(hz-.5)*.010,0.0);","V[i]=vec4f(C.geo1.z+(hx-.5)*.004,C.geo1.w-hv*.004,(hz-.5)*.004,0.0);");

// Keep classification through true contact so the density renderer sees the complete falling body.
src=src.replace("let landed=p.y<=C.geo0.x+C.geo1.y*.90;","let landed=p.y<=C.geo0.x+C.geo1.y*.08;");
// Never hand an airborne parcel back to the generic pool renderer merely because it crossed the
// nominal impact X or exceeded its first flight-age estimate. It stays tagged until it is physically
// near the receiving surface; the render mask then has an unambiguous owner for the entire fall.
src=src.replace("if(C.shape.z==0u||landed||overshot||expired){body[i]=vec4u(ph.x,ph.y,0u,0u);return;}","if(C.shape.z==0u||landed||(expired&&p.y<=C.geo0.x+C.geo1.y*1.35)){body[i]=vec4u(ph.x,ph.y,0u,0u);return;}");

// Surface disturbance comes from solved mass and momentum, not an injected ripple bus.
src=src.replace("setInterval(rippleTick,90);","// synthetic ripple timer disabled: native PBF impact owns the pool response.");

src=src.replace('THIN PRIMARY PBF','BROAD NATIVE PBF CURTAIN');
src=src.replace('Only a small temporary primary curtain is tagged as waterfall fluid. Contact or a hard flight-age budget hands every parcel back to ordinary pool water.','A broad six-row, multi-layer inlet feeds actual PBF water. Pressure, XPBD density, local material smoothing, gravity and pool collisions determine the falling sheet and plunge; the visible density surface is reconstructed only from these solved parcels, which remain waterfall-tagged until physical pool contact.');

const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blob);}finally{URL.revokeObjectURL(blob);}
if(window.__v5WaterfallM62){
 window.__v5WaterfallM62.backend='broad-native-pbf-curtain-m66';
 window.__v5WaterfallM62.renderDecoupled=false;
 window.__v5WaterfallM62.physicallyCoupled=true;
 window.__v5WaterfallM62.syntheticRipples=false;
 window.__v5WaterfallM62.nativeBody=true;
 window.__v5WaterfallM62.inletRows=6;
 window.__v5WaterfallM62.inletLayers=quality==='low'?3:4;
 window.__v5WaterfallM62.broadCurtain=true;
 window.__v5WaterfallM62.tagUntilContact=true;
}
console.info('[Fluid V5 M6.6] broad native PBF waterfall curtain source online; carrier tag persists through pool contact.');
