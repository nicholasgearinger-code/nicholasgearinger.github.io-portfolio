// Fluid V8 M8.5.8 — HD SSFR reconstruction on the proven M8.5.7.1 faucet.
// Physics, particle count and inlet tuning are unchanged. Spend only the remaining GPU
// headroom on surface pixel density and edge smoothing, with a mobile-safe adaptive fallback.

const sim=window.__sim, ssfr=window.__ssfr, faucet=window.__v5M852Faucet;
const high=window.__v5M853High, cohesion=window.__v5M856Cohesion, quality=window.__v5M857Quality;
if(!sim||!ssfr||!faucet?.online||!high?.online||!cohesion?.online||!quality?.online)
  throw new Error('M8.5.8 HD: M8.5.7.1 faucet runtime unavailable.');

const hd={
  minScale:.48,
  maxScale:.68,
  scale:.60,
  filterIterations:2,
  filterSigma:.68,
  splat:1.22,
  thicknessRadius:1.24,
  thicknessBlur:7,
};
let rafEMA=60, upTicks=0, downTicks=0;

function applyProfile(){
  const p=high.profile;
  if(p){
    p.minScale=hd.minScale;
    p.maxScale=hd.maxScale;
    p.scale=hd.scale;
    p.filterIterations=hd.filterIterations;
    p.filterSigma=hd.filterSigma;
    p.splat=hd.splat;
    p.thicknessRadius=hd.thicknessRadius;
    p.thicknessBlur=hd.thicknessBlur;
  }
  ssfr.renderScale=hd.scale;
  ssfr.filter=1;
  ssfr.filterIterations=hd.filterIterations;
  ssfr.filterSigma=hd.filterSigma;
  ssfr.splatRadius=hd.splat;
  ssfr.thicknessRadius=hd.thicknessRadius;
  ssfr.thicknessFilterSize=hd.thicknessBlur;
  ssfr.bindCache=null;
}

applyProfile();
setTimeout(applyProfile,300);

// The M8.5.3 controller still provides a slow emergency fallback. This HD controller reacts
// earlier so the surface can run near native-looking quality without waiting for a major FPS drop.
setInterval(()=>{
  const raf=Number(faucet.raf)||0;
  if(raf<=0)return;
  rafEMA=rafEMA*.70+raf*.30;
  if(rafEMA>=58){
    upTicks++;downTicks=0;
    if(upTicks>=2&&hd.scale<hd.maxScale){
      hd.scale=Math.min(hd.maxScale,hd.scale+.02);upTicks=0;applyProfile();
    }
  }else if(rafEMA<52){
    downTicks++;upTicks=0;
    if(downTicks>=2&&hd.scale>hd.minScale){
      const step=rafEMA<46?.04:.02;
      hd.scale=Math.max(hd.minScale,hd.scale-step);downTicks=0;applyProfile();
    }
  }else{
    upTicks=0;downTicks=0;
  }
},1000);

window.__v5M858HD={
  online:true,
  backend:'adaptive-hd-ssfr-m858',
  hd,
  get scale(){return hd.scale},
  get rafEMA(){return rafEMA},
};
window.__fluidV5Version='8.5.8';
window.__fluidV5Build='M8.5.8 HD SURFACE / 12.5K / 23MM / ADAPTIVE 48-68% SSFR';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.5.8';
document.title='Fluid V8 · M8.5.8 HD Faucet';
console.info('[Fluid V8 M8.5.8] adaptive HD SSFR online: 60% start, 68% max, 48% fallback.');
