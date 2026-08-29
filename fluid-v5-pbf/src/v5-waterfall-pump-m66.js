// Fluid V5 M6.6 low-rate physical waterfall source.
// The M6.5 bounded reservoir source remains the physics backend, but M6.6 deliberately reduces
// physical mass throughput. The visible waterfall is reconstructed independently at fine render
// resolution; these hidden PBF parcels exist to deliver real momentum, displacement and ripples.

const url=new URL('./v5-waterfall-pump-m65.js',import.meta.url);
const response=await fetch(url,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M6.6: unable to load M6.5 pump source (${response.status}).`);
let src=await response.text();
src=src.replaceAll('M6.5','M6.6');
src=src.replaceAll('fluidV5M65','fluidV5M66');
src=src.replaceAll('m65','m66');
src=src.replaceAll('bounded-reservoir-primary-m66','low-rate-impact-primary-m66');
// One physical layer on every quality tier. Rendering supplies the fine waterfall sheet.
src=src.replace("const thick=quality==='high'?2:1;","const thick=1;");
// Roughly 5-8 physical impact parcels/frame on Medium instead of the previous ~18.
src=src.replace("const basePeriod=quality==='low'?260:quality==='high'?350:300;","const basePeriod=quality==='low'?760:quality==='high'?980:900;");
src=src.replace("const period=clamp(Math.round(basePeriod/flow),150,600);","const period=clamp(Math.round(basePeriod/flow),420,1500);");
// Do not keep physical parcels classified as waterfall longer than necessary after impact.
src=src.replace("const maxAgeMs=Math.round((fallT+.22)*1000);","const maxAgeMs=Math.round((fallT+.12)*1000);");
// Make the diagnostics explicit that the PBF stream is an impact carrier, not the final visual body.
src=src.replace('THIN PRIMARY PBF','HIDDEN PBF IMPACT STREAM');
src=src.replace('Only a small temporary primary curtain is tagged as waterfall fluid. Contact or a hard flight-age budget hands every parcel back to ordinary pool water.','A small hidden PBF stream carries real mass and momentum into the pool. The visible waterfall is a separately resampled fine-resolution surface, so solver-sized parcels are never the final waterfall image.');
const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blob);}finally{URL.revokeObjectURL(blob);}
if(window.__v5WaterfallM62){
 window.__v5WaterfallM62.backend='low-rate-impact-primary-m66';
 window.__v5WaterfallM62.renderDecoupled=true;
}
console.info('[Fluid V5 M6.6] low-rate hidden PBF impact stream online.');
