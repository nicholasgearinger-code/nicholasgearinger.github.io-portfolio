// Fluid V5 M6.6.1 Safari wrapper for the particle-driven PBF density waterfall.
// The tagged PBF carrier remains fully simulated, but M6.7 removes those solver-scale parcels from
// the generic pool SSFR so Safari sees only the dedicated particle-density waterfall reconstruction.

const diag=document.createElement('div');
diag.id='v5WaterfallM661Diag';
diag.style.cssText='display:none;position:fixed;z-index:51;left:12px;right:12px;top:150px;max-width:760px;margin:auto;padding:8px 10px;border:1px solid rgba(255,118,118,.7);border-radius:10px;background:rgba(28,7,11,.94);color:#ffb0b0;font:8px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;pointer-events:none';
document.body.appendChild(diag);

try{
 // Rendering ownership only: this does not remove particles from PBF/XPBD physics.
 await import('./v5-waterfall-ssfr-mask-m67.js');
 await import('./v5-waterfall-houdini-m66.js');
 const base=window.__v5WaterfallM66||{};
 window.__v5WaterfallM661={
  ...base,
  online:true,
  backend:'tagged-pbf-density-curtain-m661-safari',
  safariFixed:true,
  nativeBody:true,
  particleDrivenSurface:true,
  densitySurface:true,
  analyticCurtain:false,
  genericCarrierVisible:false,
  physicsCarrierActive:true
 };
 if(window.__v5WaterfallM60){
  window.__v5WaterfallM60.backend='tagged-pbf-density-curtain-m661-safari';
  window.__v5WaterfallM60.error='';
  window.__v5WaterfallM60.genericCarrierVisible=false;
  window.__v5WaterfallM60.physicsCarrierActive=true;
 }
}catch(err){
 window.__v5WaterfallM60={...(window.__v5WaterfallM60||{}),online:false,error:String(err?.message||err),backend:'tagged-pbf-density-curtain-m661-safari'};
 diag.style.display='block';
 diag.textContent='WATERFALL M6.6.1 RENDER ERROR · '+String(err?.message||err);
 throw err;
}
console.info('[Fluid V5 M6.6.1] Safari PBF density waterfall presentation + M6.7 SSFR carrier mask online.');
