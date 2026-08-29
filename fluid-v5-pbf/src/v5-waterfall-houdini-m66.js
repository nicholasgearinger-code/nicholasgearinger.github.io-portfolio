// Fluid V5 M6.6 native PBF waterfall presentation.
// IMPORTANT: there is intentionally no independent waterfall curtain, ballistic mesh, canned mist
// field, or impact foam patch in this module. The visible waterfall body is reconstructed by the
// existing SSFR pipeline from the actual simulated PBF particles. Spray / foam / bubbles come only
// from the PBF-derived whitewater system, so every visible feature is driven by solved fluid state.

const sim=window.__sim,ssfr=window.__ssfr,state=window.__v5State;
if(!sim?.dev||!ssfr?.dev||!state)throw new Error('Fluid V5 M6.6 native waterfall presentation: runtime unavailable.');

function mount(){
 const host=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');
 if(!host||document.getElementById('v5WaterfallM66UI'))return;
 const d=document.createElement('div');
 d.id='v5WaterfallM66UI';
 d.style.cssText='margin-top:9px;padding:9px;border:1px solid rgba(78,214,220,.18);border-radius:10px;background:rgba(4,17,24,.58)';
 d.innerHTML=`<div style="font:800 9px ui-monospace;color:#9dffc8;letter-spacing:.10em">NATIVE PBF WATERFALL · M6.6</div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:5px">No analytic waterfall VFX. The waterfall body is the actual recirculating PBF liquid rendered through the same SSFR surface reconstruction as the pool. Physical impact state drives the secondary whitewater system.</div>`;
 host.appendChild(d);
}
setInterval(mount,650);mount();

window.__v5WaterfallM60={online:true,backend:'native-pbf-ssfr-m66',densitySurface:true,mist:false,resampled:false,foam:false,nativeBody:true};
window.__v5WaterfallM66={online:true,backend:'native-pbf-ssfr-m66',frames:0,nativeBody:true,analyticCurtain:false,analyticMist:false,analyticFoam:false};
console.info('[Fluid V5 M6.6] native PBF waterfall uses core SSFR; analytic curtain/mist/foam disabled.');
