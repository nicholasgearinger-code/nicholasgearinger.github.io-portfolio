// Fluid V5 M6.6 physically coupled waterfall source.
// M6.5 remains the stable reservoir-pump backend, but this wrapper retunes it so the hidden PBF
// carrier matches the visible vertical curtain and transfers enough real momentum into the pool to
// create displacement, waves and physically-driven whitewater without exposing solver-sized parcels.

const url=new URL('./v5-waterfall-pump-m65.js',import.meta.url);
const response=await fetch(url,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M6.6: unable to load M6.5 pump source (${response.status}).`);
let src=await response.text();

src=src.replaceAll('M6.5','M6.6');
src=src.replaceAll('fluidV5M65','fluidV5M66');
src=src.replaceAll('m65','m66');
src=src.replaceAll('bounded-reservoir-primary-m66','physically-coupled-impact-primary-m66');

// Match the fine visible waterfall geometry so the physical carrier lands where the rendered body lands.
src=src.replace("if(!Number.isFinite(Number(state.waterfallWidth)))state.waterfallWidth=.78;","if(!Number.isFinite(Number(state.waterfallWidth)))state.waterfallWidth=.94;");
src=src.replace("state.waterfallWidth=clamp(Number(state.waterfallWidth),.48,.92);","state.waterfallWidth=clamp(Number(state.waterfallWidth),.70,.985);");
src=src.replace("const topY=clamp(surface+Math.min(.74,b[1]*.295),surface+d*6,b[1]-d*2.5);","const topY=clamp(surface+Math.min(.88,b[1]*.335),surface+d*7,b[1]-d*2.5);");
src=src.replace("const nozzleX=Math.max(d*1.55,b[0]*.036);","const nozzleX=Math.max(d*1.20,b[0]*.022);");
src=src.replace("const vx=.225+.075*flow,vy=-.085-.025*flow,g=Math.max(1,Number(sim.params.gravity)||9.81);","const vx=.045+.018*flow,vy=-.018-.010*flow,g=Math.max(1,Number(sim.params.gravity)||9.81);");
src=src.replace("const minAcross=quality==='low'?14:quality==='high'?28:20,maxAcross=quality==='low'?24:quality==='high'?42:32;","const minAcross=quality==='low'?18:quality==='high'?32:26,maxAcross=quality==='low'?30:quality==='high'?56:44;");
src=src.replace("const thick=quality==='high'?2:1;","const thick=quality==='low'?1:2;");

// More real mass throughput than the old render-decoupled M6.6 stream, while remaining mobile-safe.
src=src.replace("const basePeriod=quality==='low'?260:quality==='high'?350:300;","const basePeriod=quality==='low'?720:quality==='high'?460:540;");
src=src.replace("const period=clamp(Math.round(basePeriod/flow),150,600);","const period=clamp(Math.round(basePeriod/flow),300,980);");
src=src.replace("const maxAgeMs=Math.round((fallT+.22)*1000);","const maxAgeMs=Math.round((fallT+.28)*1000);");

// The PBF solver itself now supplies the impact waves; do not layer synthetic ripple impulses on top.
src=src.replace("setInterval(rippleTick,90);","// synthetic ripple timer intentionally disabled: physical PBF impact owns the pool response.");

src=src.replace('THIN PRIMARY PBF','PHYSICAL PBF IMPACT CARRIER');
src=src.replace('Only a small temporary primary curtain is tagged as waterfall fluid. Contact or a hard flight-age budget hands every parcel back to ordinary pool water.','A hidden two-layer PBF carrier now matches the rendered curtain trajectory and transfers real momentum into the pool. Impact waves and secondary whitewater are driven by the solved fluid state; solver-sized parcels remain hidden from the final waterfall body.');

const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blob);}finally{URL.revokeObjectURL(blob);}
if(window.__v5WaterfallM62){
 window.__v5WaterfallM62.backend='physically-coupled-impact-primary-m66';
 window.__v5WaterfallM62.renderDecoupled=true;
 window.__v5WaterfallM62.physicallyCoupled=true;
 window.__v5WaterfallM62.syntheticRipples=false;
}
console.info('[Fluid V5 M6.6] physically coupled hidden PBF waterfall impact stream online.');
