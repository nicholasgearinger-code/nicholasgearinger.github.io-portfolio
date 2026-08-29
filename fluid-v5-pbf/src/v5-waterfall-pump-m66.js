// Fluid V5 M6.6 native PBF waterfall source.
// The waterfall is now a real recirculating PBF sheet, not a sparse hidden carrier for an analytic
// render curtain. Deep pool particles are promoted at high enough flux to form a multi-layer liquid
// sheet, then gravity, PBF pressure, XPBD density refinement, collisions and the receiving pool solve
// determine the fall, breakup and plunge. Particle count is conserved by recirculation.

const url=new URL('./v5-waterfall-pump-m65.js',import.meta.url);
const response=await fetch(url,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M6.6: unable to load M6.5 pump source (${response.status}).`);
let src=await response.text();

src=src.replaceAll('M6.5','M6.6');
src=src.replaceAll('fluidV5M65','fluidV5M66');
src=src.replaceAll('m65','m66');
src=src.replaceAll('bounded-reservoir-primary-m66','native-pbf-waterfall-m66');

// Concentrate the same conserved particle budget into a narrower, denser spill. This gives the PBF
// kernel enough neighbours across the sheet thickness for pressure/density constraints to act on it.
src=src.replace("if(!Number.isFinite(Number(state.waterfallWidth)))state.waterfallWidth=.78;","if(!Number.isFinite(Number(state.waterfallWidth)))state.waterfallWidth=.70;");
src=src.replace("state.waterfallWidth=clamp(Number(state.waterfallWidth),.48,.92);","state.waterfallWidth=clamp(Number(state.waterfallWidth),.54,.82);");
src=src.replace("const topY=clamp(surface+Math.min(.74,b[1]*.295),surface+d*6,b[1]-d*2.5);","const topY=clamp(surface+Math.min(.88,b[1]*.335),surface+d*7,b[1]-d*2.5);");
src=src.replace("const nozzleX=Math.max(d*1.55,b[0]*.036);","const nozzleX=Math.max(d*1.20,b[0]*.022);");
src=src.replace("const vx=.225+.075*flow,vy=-.085-.025*flow,g=Math.max(1,Number(sim.params.gravity)||9.81);","const vx=.205+.045*flow,vy=-.030-.015*flow,g=Math.max(1,Number(sim.params.gravity)||9.81);");
src=src.replace("const minAcross=quality==='low'?14:quality==='high'?28:20,maxAcross=quality==='low'?24:quality==='high'?42:32;","const minAcross=quality==='low'?16:quality==='high'?28:22,maxAcross=quality==='low'?26:quality==='high'?46:36;");
src=src.replace("const thick=quality==='high'?2:1;","const thick=quality==='low'?2:3;");

// Native sheet throughput. With the deep-reservoir eligibility band this targets tens of new PBF
// particles per rendered frame on Medium, leaving several hundred simultaneously in free fall.
src=src.replace("const basePeriod=quality==='low'?260:quality==='high'?350:300;","const basePeriod=quality==='low'?112:quality==='high'?52:72;");
src=src.replace("const period=clamp(Math.round(basePeriod/flow),150,600);","const period=clamp(Math.round(basePeriod/flow),36,160);");
src=src.replace("const maxAgeMs=Math.round((fallT+.22)*1000);","const maxAgeMs=Math.round((fallT+.55)*1000);");

// A four-row inlet lattice and near-spacing layer separation avoid spawning a compressed clump.
src=src.replace("let row=(stable/max(across*thick,1u)+C.mdata.w)%3u;","let row=(stable/max(across*thick,1u)+C.mdata.w)%4u;");
src=src.replace("let x=C.geo0.z+(f32(layer)-f32(thick-1u)*.5)*C.geo1.y*.30+(hx-.5)*C.geo1.y*.025;","let x=C.geo0.z+(f32(layer)-f32(thick-1u)*.5)*C.geo1.y*.74+(hx-.5)*C.geo1.y*.055;");
src=src.replace("let y=C.geo0.y-f32(row)*C.geo1.y*.18-hv*C.geo1.y*.055;","let y=C.geo0.y-f32(row)*C.geo1.y*.58-hv*C.geo1.y*.10;");
src=src.replace("let z=C.geo0.w+(u-.5)*C.geo1.x+(hz-.5)*C.geo1.y*.035;","let z=C.geo0.w+(u-.5)*C.geo1.x+(hz-.5)*C.geo1.y*.16;");
src=src.replace("V[i]=vec4f(C.geo1.z+(hx-.5)*.006,C.geo1.w-hv*.009,(hz-.5)*.010,0.0);","V[i]=vec4f(C.geo1.z+(hx-.5)*.030,C.geo1.w-hv*.020,(hz-.5)*.035,0.0);");

// Keep waterfall classification until actual near-contact; the particle itself remains ordinary PBF
// liquid throughout and continues through the same solver after its source tag is cleared.
src=src.replace("let landed=p.y<=C.geo0.x+C.geo1.y*.90;","let landed=p.y<=C.geo0.x+C.geo1.y*.18;");

// No synthetic ripple bus. All surface response comes from mass and momentum entering the pool.
src=src.replace("setInterval(rippleTick,90);","// synthetic ripple timer disabled: native PBF impact owns the pool response.");

src=src.replace('THIN PRIMARY PBF','NATIVE MULTI-LAYER PBF WATERFALL');
src=src.replace('Only a small temporary primary curtain is tagged as waterfall fluid. Contact or a hard flight-age budget hands every parcel back to ordinary pool water.','The waterfall body is the actual PBF liquid: a dense multi-layer recirculating source is solved with the same pressure, density, gravity and collision model as the receiving pool. There is no independent analytic waterfall curtain.');

const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blob);}finally{URL.revokeObjectURL(blob);}
if(window.__v5WaterfallM62){
 window.__v5WaterfallM62.backend='native-pbf-waterfall-m66';
 window.__v5WaterfallM62.renderDecoupled=false;
 window.__v5WaterfallM62.physicallyCoupled=true;
 window.__v5WaterfallM62.syntheticRipples=false;
 window.__v5WaterfallM62.nativeBody=true;
 window.__v5WaterfallM62.inletRows=4;
}
console.info('[Fluid V5 M6.6] dense native PBF waterfall sheet online.');
