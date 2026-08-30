// Fluid V5 M7.4.0 — safe feature restore on top of the unified iOS frame scheduler.
// Only modules that encode into the existing SSFR encoder, use writeBuffer, or use deferred
// impulses are restored here. Known extra-submit and runtime-Blob modules stay out of this build.

const ui=window.__ui,sim=window.__sim,ssfr=window.__ssfr;
if(!ui||!sim?.dev||!ssfr?.dev||!window.__v5M740Unified?.online)throw new Error('M7.4 bootstrap: unified physical-water core unavailable.');
const load=document.getElementById('loading'),note=document.getElementById('loadnote');
const phase=t=>{if(note)note.textContent=t;if(load){load.classList.add('v5hold');load.classList.remove('gone')}};
async function optional(path,label){phase(`loading ${label}…`);try{await import(path);return true}catch(err){console.error(`[M7.4 ${label}]`,err);return false}}

const wasPaused=!!ui.paused;ui.paused=true;
try{
  // Do not let a persisted auto-quality setting reload the page while the feature graph mounts.
  try{const k='fluidV5LabStateV1',s=JSON.parse(localStorage.getItem(k)||'null');if(s&&typeof s==='object'){s.autoQuality=false;localStorage.setItem(k,JSON.stringify(s))}localStorage.setItem('fluidV5AutoQualityV1','0')}catch{}

  phase('loading physical scene state…');
  await optional('./wave-test-v44.js','wave driver');
  await import('./v5-lab.js');
  if(window.__v5State){window.__v5State.autoQuality=false;window.__v5State.vorticity=0;window.__v5State.hydroDrag=0;window.__v5State.xpbdDensity=0;try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(window.__v5State))}catch{}}

  phase('restoring full-floor physical pool…');
  await optional('./v5-pool-slab-m740.js','unified pool slab');
  await optional('./v5-debug-policy.js','debug policy');
  await optional('./v5-physics-m737-coreonly.js','adaptive core PBF physics');
  await optional('./v5-surface-m42.js','surface reconstruction');

  phase('restoring physical scenarios…');
  await optional('./v5-scenarios-m46.js','advanced scenarios');
  await optional('./v5-rain-waterfall-m562.js','rain + waterfall');
  await optional('./v5-ripples-m57.js','surface ripple bus');

  // M4.1 encodes its compute/render work into the SSFR encoder supplied by Renderer.draw(), so
  // M7.4 automatically folds it into the same single command buffer. Start conservatively on Low.
  if(window.__v5State){const q=new URLSearchParams(location.search);window.__v5State.whitewater=q.get('quality')==='low'?.22:.42;}
  await optional('./v5-whitewater-m41.js','unified whitewater');

  window.__v5M740Features={
    online:true,
    optics:'V4.3 realtime caustics / normal HTTP modules',
    unified:true,
    scenes:true,
    whitewater:!!window.__v5WhitewaterM41,
    surface:!!window.__v5SurfaceM42,
    locked:['GPU vorticity','XPBD post-density','rigid hydro','Blob V4.4 shader FX','spillway pump','gravity-pour seed'],
  };
  console.info('[Fluid V5 M7.4] safe feature graph ready; extra-submit/Blob systems remain locked.');
}finally{
  ui.paused=wasPaused;
}
