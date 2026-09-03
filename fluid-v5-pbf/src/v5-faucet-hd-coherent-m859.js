// Fluid V8 M8.5.9 — HD reconstruction on the proven M8.5.6 coherent stream.
// Keep the exact M8.5.6 fluid/inlet physics and 10.5K / 25 mm particle lattice.
// Spend GPU headroom only on SSFR pixel density and smoothing. The existing M8.5.3
// render wrapper consumes this shared profile every frame, so no extra GPU submit is added.

const sim=window.__sim,ssfr=window.__ssfr,faucet=window.__v5M852Faucet;
const high=window.__v5M853High,cohesion=window.__v5M856Cohesion;
if(!sim||!ssfr||!faucet?.online||!high?.online||!cohesion?.online)
  throw new Error('M8.5.9 HD coherent: M8.5.6 faucet runtime unavailable.');

const profile=high.profile;
const hd={minScale:.50,maxScale:.70,startScale:.60};
let rafEMA=60,stable=0;

function preservePhysics(){
  if(!sim.params)return;
  sim.params.xsphC=.052;
  sim.params.sCorrK=.031;
  sim.params.surfaceTensionK=.074;
  sim.params.substeps=2;
  sim.params.iterations=3;
}
function applyVisual(){
  profile.minScale=hd.minScale;
  profile.maxScale=hd.maxScale;
  profile.scale=Math.max(hd.minScale,Math.min(hd.maxScale,Number(profile.scale)||hd.startScale));
  profile.filterIterations=2;
  profile.filterSigma=.66;
  profile.splat=1.21;
  profile.thicknessRadius=1.22;
  profile.thicknessBlur=7;

  ssfr.renderScale=profile.scale;
  ssfr.filter=1;
  ssfr.filterIterations=2;
  ssfr.filterSigma=.66;
  ssfr.splatRadius=1.21;
  ssfr.thicknessRadius=1.22;
  ssfr.thicknessFilterSize=7;
  ssfr.bindCache=null;
}

preservePhysics();
profile.scale=hd.startScale;
applyVisual();
setTimeout(()=>{preservePhysics();profile.scale=hd.startScale;applyVisual()},300);

// Adaptive HD controller. Keep the coherent physics fixed; only surface pixel density moves.
// It responds before the old M8.5.3 emergency controller so mobile never has to collapse badly.
setInterval(()=>{
  if(faucet.active!=='faucet')return;
  preservePhysics();
  const raf=Number(faucet.raf)||0;
  if(raf<=0){applyVisual();return;}
  rafEMA=rafEMA*.72+raf*.28;
  stable++;
  if(stable>=2){
    stable=0;
    if(rafEMA>=58.5&&profile.scale<hd.maxScale)profile.scale=Math.min(hd.maxScale,profile.scale+.02);
    else if(rafEMA<54&&profile.scale>hd.minScale)profile.scale=Math.max(hd.minScale,profile.scale-(rafEMA<48?.04:.02));
  }
  applyVisual();
},1000);

window.__v5M859HDCoherent={
  online:true,backend:'m856-coherent-physics-plus-adaptive-hd-ssfr-m859',hd,
  get scale(){return profile.scale},get rafEMA(){return rafEMA}
};
window.__fluidV5Version='8.5.9';
window.__fluidV5Build='M8.5.9 M8.5.6 COHERENT STREAM / ADAPTIVE 50-70% HD SSFR';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.5.9';
document.title='Fluid V8 · M8.5.9 HD Coherent Stream';
console.info('[Fluid V8 M8.5.9] M8.5.6 coherent physics preserved; adaptive HD SSFR online.');
