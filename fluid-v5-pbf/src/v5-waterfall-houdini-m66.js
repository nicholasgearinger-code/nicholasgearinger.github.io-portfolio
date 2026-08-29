// Fluid V5 M6.6 particle-driven density waterfall presentation.
// The waterfall remains actual recirculating PBF liquid. The visible curtain is reconstructed only
// from those tagged PBF parcels using the established density/aeration surface pass, so mobile SSFR
// no longer exposes centimeter-scale solver blobs as the final waterfall shape.

const sim=window.__sim,ssfr=window.__ssfr,state=window.__v5State;
if(!sim?.dev||!ssfr?.dev||!state)throw new Error('Fluid V5 M6.6 density waterfall presentation: runtime unavailable.');

try{
 await import('./v5-waterfall-houdini-m65.js');
 const base=window.__v5WaterfallM60||{};
 window.__v5WaterfallM60={
  ...base,
  online:true,
  backend:'tagged-pbf-density-curtain-m66',
  densitySurface:true,
  mist:true,
  nativeBody:true,
  particleDrivenSurface:true,
  analyticCurtain:false,
  impactMist:true,
  resampled:false
 };
 window.__v5WaterfallM66={
  ...base,
  online:true,
  backend:'tagged-pbf-density-curtain-m66',
  nativeBody:true,
  particleDrivenSurface:true,
  densitySurface:true,
  aeratedCurtain:true,
  impactMist:true,
  analyticCurtain:false,
  resampled:false
 };
}catch(err){
 window.__v5WaterfallM60={...(window.__v5WaterfallM60||{}),online:false,error:String(err?.message||err),backend:'tagged-pbf-density-curtain-m66'};
 throw err;
}

function mount(){
 const host=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');
 if(!host||document.getElementById('v5WaterfallM66UI'))return;
 const d=document.createElement('div');
 d.id='v5WaterfallM66UI';
 d.style.cssText='margin-top:9px;padding:9px;border:1px solid rgba(78,214,220,.18);border-radius:10px;background:rgba(4,17,24,.58)';
 d.innerHTML=`<div style="font:800 9px ui-monospace;color:#9dffc8;letter-spacing:.10em">PBF DENSITY WATERFALL · M6.6</div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:5px">Actual tagged PBF water drives the curtain. A particle-density reconstruction joins neighbouring solved parcels into a continuous aerated sheet; lower-fall breakup and impact mist remain tied to the moving PBF source.</div>`;
 host.appendChild(d);
}
setInterval(mount,650);mount();
console.info('[Fluid V5 M6.6] tagged PBF density/aeration waterfall surface online.');
