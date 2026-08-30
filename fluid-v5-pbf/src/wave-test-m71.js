// Fluid V5 M7.1.1 bootstrap — isolated physical gravity-pour benchmark with forced startup.
// When ?m71=pour is present, the scenario is selected before legacy weather/waterfall systems and
// those source/detail modules are not imported. A post-load watchdog directly resets the PBF core
// through the M7.1 wrapper so the elevated reservoir cannot silently fail to initialize.

const qp=new URLSearchParams(location.search);
const ISOLATED=qp.get('m71')==='pour';
const V5_BUILD='M7.1.1 PHYSICAL WATER · ISOLATED GRAVITY POUR';
const V5_VERSION='7.1.1-m71';
function stampBuild(){
 document.title=`Fluid V5 · ${V5_BUILD}`;
 const brand=document.querySelector('.hud.card.title');if(brand&&brand.textContent!=='FLUID V5 · M7.1.1')brand.textContent='FLUID V5 · M7.1.1';
 const load=document.querySelector('#loading h2');if(load&&load.textContent!=='FLUID V5 · M7.1.1')load.textContent='FLUID V5 · M7.1.1';
 window.__fluidV5Version=V5_VERSION;window.__fluidV5Build=V5_BUILD;
}
stampBuild();
const initialBrand=document.querySelector('.hud.card.title');if(initialBrand)new MutationObserver(()=>stampBuild()).observe(initialBrand,{childList:true,characterData:true,subtree:true});
const earlyStats=document.getElementById('v4stats');if(earlyStats)earlyStats.textContent='BUILD: M7.1.1 · ISOLATED PRIMARY PBF POUR · waiting for V4.4 core…';
window.__fluidV5Version=`${V5_VERSION}-booting`;
window.__v5M71Isolation=ISOLATED;

await import('./wave-test-v44.js');
async function waitForV44(timeoutMs=12000){const start=performance.now();while(performance.now()-start<timeoutMs){if(window.__sim?.dev&&window.__ssfr?.dev&&window.__ui&&window.__cam&&window.__mesh)return true;await new Promise(r=>setTimeout(r,25));}return false;}
if(!(await waitForV44()))throw new Error('Fluid V5 M7.1.1 bootstrap: V4.4 runtime did not become ready within 12 seconds.');
stampBuild();

await import('./v5-lab.js');
if(ISOLATED&&window.__v5State){
 window.__v5State.scenario='gravity-pour-m71';
 window.__ui.pouring=false;
 try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(window.__v5State));}catch{}
}
try{await import('./v5-pool-slab.js');}catch(err){console.error('[Fluid V5 pool slab] full-floor initialization failed.',err);}

let lightLabReady=false;
try{
 await import('./v5-light-lab.js');lightLabReady=!!window.__v5LightLab;stampBuild();
 try{await import('./v5-environment-m343.js');}catch(err){console.error('[Fluid V5 Environment] failed.',err);}
 try{await import('./v5-night-pool-m34.js');}catch(err){window.__v5DedicatedNightPool=false;console.error('[Fluid V5 Night Pool] failed.',err);}
 try{await import('./v5-ibl-m43.js');}catch(err){window.__v5IBLStatus={online:false,error:String(err?.message||err)};console.error('[Fluid V5 IBL] failed.',err);}
}catch(err){console.error('[Fluid V5 Light Lab] atmosphere failed.',err);}
stampBuild();
if(!window.__v5ProjectedCaustics?.online){try{await import(lightLabReady?'./v5-atomic-multilight-m34.js':'./v5-atomic-contrast-m30.js');}catch(err){console.error('[Fluid V5 atomic] failed.',err);}}

try{await import('./v5-m2-safe.js');}catch(err){console.error('[Fluid V5 M2] failed.',err);}
try{await import('./v5-debug-policy.js');}catch(err){console.error('[Fluid V5 debug] failed.',err);}
try{await import('./v5-caustic-handoff.js');}catch(err){console.error('[Fluid V5 caustic handoff] failed.',err);}
try{await import('./v5-workload-m45.js');}catch(err){console.error('[Fluid V5 M4.5] workload failed.',err);}
try{await import('./v5-physics-m40.js');}catch(err){window.__v5PhysicsM40={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M4.0] Physics 2.0 failed.',err);}
try{await import('./v5-xpbd-density-m50.js');}catch(err){window.__v5XPBDM50={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.0] XPBD failed.',err);}
try{await import('./v5-rigid-hydro-m51.js');}catch(err){window.__v5RigidHydroM51={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.1] rigid hydro failed.',err);}
try{await import('./v5-surface-m42.js');}catch(err){window.__v5SurfaceM42={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M4.2] surface failed.',err);}

if(!ISOLATED){
 try{await import('./v5-whitewater-optics-m69.js');}catch(err){console.error('[Fluid V5 M6.9] secondary water failed.',err);}
 try{await import('./v5-microdrops-m69.js');}catch(err){console.error('[Fluid V5 M6.9] microdrops failed.',err);}
 try{await import('./v5-adaptive-detail-m52.js');}catch(err){console.error('[Fluid V5 M5.2] adaptive detail failed.',err);}
}
try{await import('./v5-night-caustics-m44.js');}catch(err){console.error('[Fluid V5 M4.4] night caustics failed.',err);}
try{await import('./v5-volume-light-m53.js');}catch(err){console.error('[Fluid V5 M5.3] volume light failed.',err);}

if(!ISOLATED){
 try{await import('./v5-scenarios-m46.js');}catch(err){console.error('[Fluid V5 M4.6] scenarios failed.',err);}
 try{await import('./v5-rain-waterfall-m562.js');}catch(err){console.error('[Fluid V5 M5.6.2] weather failed.',err);}
 try{await import('./v5-ripples-m57.js');}catch(err){console.error('[Fluid V5 M5.7] ripple layer failed.',err);}
 try{await import('./v5-waterfall-spillway-m69.js');}catch(err){console.error('[Fluid V5 M6.9] spillway failed.',err);}
}

try{await import('./v5-gravity-pour-m71.js');}catch(err){window.__v5GravityPourM71={...(window.__v5GravityPourM71||{}),online:false,error:String(err?.message||err),backend:'isolated-local-gated-pour-pbf-m71'};console.error('[Fluid V5 M7.1] gravity-pour benchmark failed.',err);}

// Hard activation for the isolated benchmark. The previous build relied on a hidden DOM reset button;
// on iOS that path could leave the ordinary pool running even though the M7.1 brand loaded. Here we
// invoke the wrapped simulation reset directly, which guarantees setupAfterReset() builds the trough,
// installs the gate and redistributes the existing primary PBF water into the elevated reservoir.
if(ISOLATED){
 const forceStart=(label)=>{
  const sim=window.__sim,state=window.__v5State,S=window.__v5GravityPourM71;
  const stats=document.getElementById('v4stats');
  if(!sim||!state){if(stats)stats.textContent=`M7.1.1 INIT ${label}: runtime missing`;return false;}
  state.scenario='gravity-pour-m71';window.__ui.pouring=false;
  try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state));}catch{}
  if(!S?.online){if(stats)stats.textContent=`M7.1.1 INIT ${label}: gravity module FAILED · ${S?.error||'not loaded'}`;return false;}
  try{
   sim.reset(sim.params);
   if(stats)stats.textContent=`M7.1.1 INIT ${label}: reset issued · waiting for elevated reservoir…`;
   return true;
  }catch(err){if(stats)stats.textContent=`M7.1.1 INIT ${label}: RESET ERROR · ${String(err?.message||err)}`;console.error('[Fluid V5 M7.1.1 force start]',err);return false;}
 };
 setTimeout(()=>forceStart('A'),80);
 setTimeout(()=>{
  const S=window.__v5GravityPourM71;
  if(!S?.ready||!(S.upperParticles>0))forceStart('WATCHDOG');
 },700);
 setTimeout(()=>{
  const S=window.__v5GravityPourM71,stats=document.getElementById('v4stats');
  if(!S?.ready||!(S.upperParticles>0)){
   if(stats)stats.textContent=`M7.1.1 INIT FAILED · ready=${!!S?.ready} · elevated=${S?.upperParticles||0} · ${S?.error||'no setup error reported'}`;
  }
 },1700);
}

try{await import('./v5-tabs-m34.js');}catch(err){console.error('[Fluid V5 UI] tabs failed.',err);}
try{await import('./v5-m5-ui.js');}catch(err){console.error('[Fluid V5 UI] diagnostics failed.',err);}

stampBuild();
const stats=document.getElementById('v4stats');if(stats&&!stats.textContent.includes('BUILD:')&&!stats.textContent.includes('M7.1.1 INIT'))stats.textContent=`BUILD: M7.1.1 ISOLATED PRIMARY PBF POUR · ${stats.textContent}`;
for(const delay of [100,350,800,1600,3000,6000])setTimeout(stampBuild,delay);
setTimeout(()=>{const toggle=document.getElementById('v4WaveToggle');if(toggle?.classList.contains('active'))toggle.click();},420);
console.info(`[Fluid V5] ${V5_BUILD} / ${V5_VERSION} enabled; isolated=${ISOLATED}.`);
