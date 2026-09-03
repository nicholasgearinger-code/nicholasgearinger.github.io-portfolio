// Fluid V8 M8.5.1 — faucet visual/performance profile.
// Sharper SSFR water + high-resolution environment while deliberately removing expensive
// decorative rendering from the launcher (whitewater/bubbles/shafts/fine-spray are not loaded).
// Physics remains the M8.5 native appendFluid free jet on the M8.2 common-water solver.

const sim=window.__sim, ssfr=window.__ssfr, faucet=window.__v5M850Faucet, core=window.__v5M820FluidCore;
if(!sim||!ssfr?.env||!faucet?.online||!core?.online) throw new Error('M8.5.1 perf: M8.5 faucet/SSFR runtime unavailable.');

// Poly Haven Quarry Cloudy, CC0. 4K input produces a 1024px cube face in the upstream
// Environment loader (the previous 1K source produced only a 256px face).
const HDR4K='https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/quarry_cloudy_4k.hdr';
const HDR1K='https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/env/quarry_cloudy_1k.hdr';
let envSource='';let envStatus='loading';
try{
  envStatus=await ssfr.env.load(HDR4K);
  envSource=HDR4K;
}catch(err){
  console.warn('[M8.5.1] 4K HDR failed, falling back to 1K',err);
  try{envStatus=await ssfr.env.load(HDR1K);envSource=HDR1K;}
  catch(err2){envStatus='environment failed: '+String(err2?.message||err2);}
}
ssfr.env.intensity=1.04;ssfr.env.yaw=0;ssfr.bindCache=null;

// The background/composite stays full canvas resolution. Only SSFR depth/thickness buffers
// are scaled. 0.48 is ~2x the pixel count of the old 0.34 surface while still mobile-oriented.
const visual={scale:.48,splat:1.00,filterIterations:1,filterSigma:.68,thickBlur:8};
function applyVisual(){
  ssfr.renderScale=visual.scale;
  ssfr.splatRadius=visual.splat;
  ssfr.filterIterations=visual.filterIterations;
  ssfr.filterSigma=visual.filterSigma;
  ssfr.thicknessFilterSize=visual.thickBlur;
  ssfr.bindCache=null;
}

// Faucet-focused compute budget. M8.5's free jet can remain stable with fewer global
// correction passes than the worst-case splash profile. Adaptive CFL is retained but capped.
function applyPhysicsBudget(){
  const w=core.water;
  w.adaptiveCFL=true;
  w.minSubsteps=2;
  w.maxSubsteps=4;
  w.cflSafety=.46;
  if(faucet.active==='faucet'){
    w.divergence=.54;
    w.divIterations=2;
    w.vorticity=.030;
    w.maxCorrection=.11;
    w.xsph=.024;
    w.tension=.075;
    w.scorr=.026;
    w.densityIterations=4;
  }
}
applyVisual();applyPhysicsBudget();

// M8.5's own faucet scene switch restores its validation values. Re-apply this profile after
// scene changes without adding any GPU work; these are CPU-side uniform/settings assignments.
setInterval(()=>{
  if(faucet.active==='faucet'){applyVisual();applyPhysicsBudget();}
},350);

window.__v5M851Perf={
  online:true,backend:'sharp-ssfr-lite-shading-4k-env-m851',
  removed:['fine-spray shader','whitewater/foam/bubble/shaft composite','M7 realism/pool composite stack'],
  visual,envSource,envStatus,
  get scale(){return ssfr.renderScale},
  get substeps(){return core.water.substeps},
};
window.__fluidV5Version='8.5.1';
window.__fluidV5Build='M8.5.1 SHARP FAUCET / 4K ENV / LITE SSFR / M8.2 COMMON WATER';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.5.1';document.title='Fluid V8 · M8.5.1 Sharp Faucet Performance';
console.info(`[Fluid V8 M8.5.1] lite faucet profile online; SSFR ${visual.scale.toFixed(2)}x; env ${envStatus}.`);
