// Fluid V8 M8.5.3 — larger-framed HIGH-fast faucet profile.
// Runs on top of the stripped M8.5.2 faucet fast path.
// The main gain is free: correct the hard-coded legacy camera for the smaller faucet lab.
// Then spend part of the 60 Hz headroom on more SSFR pixels while dynamically targeting ~45-50 RAF/s.

const sim=window.__sim, ssfr=window.__ssfr, cam=window.__cam, faucet=window.__v5M852Faucet;
if(!sim||!ssfr||!cam||!faucet?.online) throw new Error('M8.5.3 profile: M8.5.2 faucet runtime unavailable.');

const profile={
  targetFps:47,
  minScale:.38,
  maxScale:.46,
  scale:.43,
  splat:1.14,
  filterIterations:1,
  filterSigma:.60,
  thicknessRadius:1.18,
  thicknessBlur:6,
};
let rafEMA=55, stableTicks=0;

function frameCamera(){
  const b=sim.params?.box||[1.10,1.50,.74];
  cam.az=-.70;
  cam.el=.39;
  cam.dist=2.12;
  cam.target=[b[0]*.50,b[1]*.47,b[2]*.50];
}
function applyVisual(){
  ssfr.renderScale=profile.scale;
  ssfr.splatRadius=profile.splat;
  ssfr.filter=1;
  ssfr.filterIterations=profile.filterIterations;
  ssfr.filterSigma=profile.filterSigma;
  ssfr.thicknessRadius=profile.thicknessRadius;
  ssfr.thicknessFilterSize=profile.thicknessBlur;
  ssfr.bindCache=null;
}
frameCamera();applyVisual();

// M8.5.2 resets its lean visual settings at the beginning of each physics frame.
// Reapply this quality profile after physics but before the renderer consumes SSFR settings.
const prevStep=sim.step.bind(sim);
sim.step=function(dt){
  const out=prevStep(dt);
  applyVisual();
  return out;
};

// Use the measured requestAnimationFrame rate from M8.5.2, not the old simulation-FPS label.
// Make slow, small adjustments to avoid texture reallocations thrashing every second.
setInterval(()=>{
  const fps=Number(faucet.raf)||0;
  if(fps<=0)return;
  rafEMA=rafEMA*.72+fps*.28;
  stableTicks++;
  if(stableTicks<2)return;
  stableTicks=0;
  if(rafEMA<43.5 && profile.scale>profile.minScale){
    profile.scale=Math.max(profile.minScale,profile.scale-.02);
  }else if(rafEMA>53 && profile.scale<profile.maxScale){
    profile.scale=Math.min(profile.maxScale,profile.scale+.01);
  }
  applyVisual();
},1000);

// Keep the corrected close framing if the static scene controller resets anything later.
setTimeout(frameCamera,450);
setTimeout(frameCamera,1200);

window.__v5M853High={
  online:true,backend:'high-fast-close-camera-adaptive-ssfr-m853',profile,
  get rafEMA(){return rafEMA},get scale(){return profile.scale}
};
window.__fluidV5Version='8.5.3';
window.__fluidV5Build='M8.5.3 HIGH-FAST FAUCET / CLOSE CAMERA / ADAPTIVE SSFR / FINE PBF';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.5.3';
document.title='Fluid V8 · M8.5.3 High-Fast Faucet';
console.info('[Fluid V8 M8.5.3] close camera + adaptive HIGH-fast SSFR online.');
