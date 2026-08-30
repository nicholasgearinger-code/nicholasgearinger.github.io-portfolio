// Fluid V5 M6.9 coherent-surface-aware microdroplets.
// Starts from the proven M5.9 sparse-PBF renderer, but only converts genuinely detached,
// low-density fast parcels into droplets. Coherent sheets and bulk liquid remain in SSFR.

const url=new URL('./v5-microdrops-m59.js',import.meta.url);
const r=await fetch(url,{cache:'no-store'});
if(!r.ok)throw new Error(`Fluid V5 M6.9: unable to load M5.9 microdrop source (${r.status}).`);
let src=await r.text();

// One-time migration from the old oversized splash-droplet presentation.
src=src.replace(
 "if(!Number.isFinite(Number(state.microDropSize)))state.microDropSize=.62;\nstate.microDropSize=clamp(Number(state.microDropSize),.32,1.0);",
 "if(Number(state.microDropModelRev||0)<2){state.microDropSize=.34;state.microDropModelRev=2;}\nif(!Number.isFinite(Number(state.microDropSize)))state.microDropSize=.34;\nstate.microDropSize=clamp(Number(state.microDropSize),.18,.62);"
);

// Critical model correction: .93 rho0 was converting thin coherent water into droplets. Only truly
// sparse parcels are now tagged, and they must also have meaningful velocity away from bulk water.
const oldTune='CF[4]=.93;CF[5]=.28;CF[6]=surface+d*1.10;CF[7]=surface+d*.55;';
const newTune='CF[4]=.55;CF[5]=.48;CF[6]=surface+d*1.18;CF[7]=surface+d*.42;';
if(!src.includes(oldTune))throw new Error('Fluid V5 M6.9 microdrop classifier signature changed.');
src=src.replace(oldTune,newTune);

// Fine droplets instead of solver-sized splash parcels. World-space length still follows real speed.
src=src.replace('let px=vec2f(.75/max(C.screen.x,1.0),.75/max(C.screen.y,1.0));',
 'let px=vec2f(.34/max(C.screen.x,1.0),.34/max(C.screen.y,1.0));');
src=src.replace("let halfW=max(length(sn-cn)*.72,px.x);let halfL=max(length(ln-cn)*(.85+clamp(sp*.12,0.0,.75)),px.y*1.35);",
 "let halfW=max(length(sn-cn)*.46,px.x);let halfL=max(length(ln-cn)*(.72+clamp(sp*.10,0.0,.58)),px.y*1.20);");

// Finer, less opaque isolated water optics.
src=src.replace('let a=.055*core+.28*rim+.30*fres;','let a=.028*core+.17*rim+.20*fres;');

// Update the control range so all scenes default to physically small droplets.
src=src.replace('min=\"0.32\" max=\"1.00\" step=\"0.02\"','min=\"0.18\" max=\"0.62\" step=\"0.02\"');

src=src.replaceAll('M5.9','M6.9').replaceAll('M59','M69').replaceAll('m59','m69');
const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blob);}finally{URL.revokeObjectURL(blob);}
if(window.__v5MicroDropsM69){window.__v5MicroDropsM59=window.__v5MicroDropsM69;window.__v5MicroDropsM59.backend='coherent-surface-microdrops-m69';}
console.info('[Fluid V5 M6.9] detached PBF parcels render as fine microdroplets; coherent liquid stays SSFR.');
