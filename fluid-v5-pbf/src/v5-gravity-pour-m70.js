// Fluid V5 M7.0 gravity-pour benchmark — high-volume revision.
// The canonical M7.0 implementation is pinned below, then retuned without changing its architecture:
// the same PBF water starts at rest behind a physical gate and receives no launch velocity or guide.

const sourceUrl='https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/b31bb85582209f7b20c06b51ec0bf1452653eb39/fluid-v5-pbf/src/v5-gravity-pour-m70.js';
const response=await fetch(sourceUrl,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M7.0 high-volume source unavailable (${response.status}).`);
let src=await response.text();

// Migrate every device off the first small benchmark defaults.
src=src.replace('if(Number(state.gravityPourRev||0)<1){','if(Number(state.gravityPourRev||0)<2){');
src=src.replace('state.gravityPourHeight=.80;','state.gravityPourHeight=.92;');
src=src.replace('state.gravityPourWidth=.72;','state.gravityPourWidth=.975;');
src=src.replace('state.gravityPourVolume=.46;','state.gravityPourVolume=.64;');
src=src.replace('state.gravityPourRev=1;','state.gravityPourRev=2;');
src=src.replace('if(!Number.isFinite(Number(state.gravityPourHeight)))state.gravityPourHeight=.80;','if(!Number.isFinite(Number(state.gravityPourHeight)))state.gravityPourHeight=.92;');
src=src.replace('if(!Number.isFinite(Number(state.gravityPourWidth)))state.gravityPourWidth=.72;','if(!Number.isFinite(Number(state.gravityPourWidth)))state.gravityPourWidth=.975;');
src=src.replace('if(!Number.isFinite(Number(state.gravityPourVolume)))state.gravityPourVolume=.46;','if(!Number.isFinite(Number(state.gravityPourVolume)))state.gravityPourVolume=.64;');

// Allow a near-full-width gate and a substantially taller drop.
src=src.replace('state.gravityPourHeight=clamp(Number(state.gravityPourHeight),.62,.88);','state.gravityPourHeight=clamp(Number(state.gravityPourHeight),.72,.955);');
src=src.replace('state.gravityPourWidth=clamp(Number(state.gravityPourWidth),.38,.92);','state.gravityPourWidth=clamp(Number(state.gravityPourWidth),.68,.992);');
src=src.replace('state.gravityPourVolume=clamp(Number(state.gravityPourVolume),.24,.62);','state.gravityPourVolume=clamp(Number(state.gravityPourVolume),.32,.72);');
src=src.replace('const floorY=b[1]*clamp(Number(state.gravityPourHeight)||.80,.62,.88);','const floorY=b[1]*clamp(Number(state.gravityPourHeight)||.92,.72,.955);');
src=src.replace('const lipX=b[0]*.46;','const lipX=b[0]*.60;');
src=src.replace('const width=b[2]*clamp(Number(state.gravityPourWidth)||.72,.38,.92);','const width=b[2]*clamp(Number(state.gravityPourWidth)||.975,.68,.992);');
src=src.replace('const wallTop=Math.min(b[1]-d*2.2,floorY+Math.max(d*8.5,b[1]*.20));','const wallTop=Math.min(b[1]-d*.85,floorY+Math.max(d*12.0,b[1]*.28));');
src=src.replace('const upperWanted=Math.round(nFluid*clamp(Number(state.gravityPourVolume)||.46,.24,.62));','const upperWanted=Math.round(nFluid*clamp(Number(state.gravityPourVolume)||.64,.32,.72));');

// High-energy falling water needs more temporal and density resolution than the calm-pool case.
src=src.replace("sim.params.substeps=Math.max(Number(sim.params.substeps)||2,quality==='high'?5:4);","sim.params.substeps=Math.max(Number(sim.params.substeps)||2,quality==='low'?4:quality==='high'?6:5);");
src=src.replace("sim.params.iterations=Math.max(Number(sim.params.iterations)||4,quality==='high'?7:6);","sim.params.iterations=Math.max(Number(sim.params.iterations)||4,quality==='low'?6:quality==='high'?9:8);");
src=src.replace("sim.params.xsphC=Math.max(.025,Math.min(.050,Number(sim.params.xsphC)||.035));","sim.params.xsphC=Math.max(.030,Math.min(.045,Number(sim.params.xsphC)||.036));");
src=src.replace("sim.params.sCorrK=Math.min(Number(sim.params.sCorrK)||.05,.065);","sim.params.sCorrK=Math.min(Number(sim.params.sCorrK)||.035,.045);");
src=src.replace("sim.params.surfaceTensionK=Math.min(Number(sim.params.surfaceTensionK)||.08,.11);","sim.params.surfaceTensionK=Math.min(Number(sim.params.surfaceTensionK)||.055,.070);");
src=src.replace('state.xpbdDensity=Math.max(Number(state.xpbdDensity)||0,.82);','state.xpbdDensity=Math.max(Number(state.xpbdDensity)||0,.90);');

// UI range follows the new physical test envelope.
src=src.replace('min="0.62" max="0.88" step="0.01"','min="0.72" max="0.955" step="0.005"');
src=src.replace('min="0.38" max="0.92" step="0.02"','min="0.68" max="0.992" step="0.01"');
src=src.replace('min="0.24" max="0.62" step="0.02"','min="0.32" max="0.72" step="0.02"');
src=src.replace('clamp(Number(e.target.value),.62,.88)','clamp(Number(e.target.value),.72,.955)');
src=src.replace('clamp(Number(e.target.value),.38,.92)','clamp(Number(e.target.value),.68,.992)');
src=src.replace('clamp(Number(e.target.value),.24,.62)','clamp(Number(e.target.value),.32,.72)');

src=src.replace('controlled gravity-pour benchmark','high-volume gravity-pour benchmark');
src=src.replace('gated-gravity-pour-pbf-m70','high-volume-gated-pour-pbf-m70');

const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blob);}finally{URL.revokeObjectURL(blob);}
if(window.__v5GravityPourM70){
 window.__v5GravityPourM70.backend='high-volume-gated-pour-pbf-m70';
 window.__v5GravityPourM70.revision=2;
 window.__v5GravityPourM70.highVolume=true;
}
console.info('[Fluid V5 M7.0] tall, near-full-width, high-volume gravity pour revision online.');
