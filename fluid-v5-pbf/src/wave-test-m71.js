// Fluid V5 M7.1.2 bootstrap — full scenario lab + runtime-isolated gravity-pour benchmark.
// All existing experiments remain loaded and selectable. M7.1 isolation is now a runtime property:
// only while gravity-pour-m71 is active does its append guard prevent other sources from changing
// primary fluid mass. This avoids removing Faucet/Waterfall/Paddle/Whirlpool/Fountain from the lab.

const qp=new URLSearchParams(location.search);
const AUTO_M71=qp.get('m71')==='pour';
const V5_BUILD='M7.1.2 PHYSICAL WATER · FULL SCENARIO LAB';
const V5_VERSION='7.1.2-m71';

function stampBuild(){
 document.title=`Fluid V5 · ${V5_BUILD}`;
 const brand=document.querySelector('.hud.card.title');
 if(brand&&brand.textContent!=='FLUID V5 · M7.1.2')brand.textContent='FLUID V5 · M7.1.2';
 const load=document.querySelector('#loading h2');
 if(load&&load.textContent!=='FLUID V5 · M7.1.2')load.textContent='FLUID V5 · M7.1.2';
 window.__fluidV5Version=V5_VERSION;
 window.__fluidV5Build=V5_BUILD;
}
stampBuild();
const initialBrand=document.querySelector('.hud.card.title');
if(initialBrand)new MutationObserver(()=>stampBuild()).observe(initialBrand,{childList:true,characterData:true,subtree:true});
const earlyStats=document.getElementById('v4stats');
if(earlyStats)earlyStats.textContent='BUILD: M7.1.2 · FULL SCENARIO LAB · waiting for V4.4 core…';
window.__fluidV5Version=`${V5_VERSION}-booting`;
window.__v5M71Isolation=false;

await import('./wave-test-v44.js');
async function waitForV44(timeoutMs=12000){
 const start=performance.now();
 while(performance.now()-start<timeoutMs){
  if(window.__sim?.dev&&window.__ssfr?.dev&&window.__ui&&window.__cam&&window.__mesh)return true;
  await new Promise(r=>setTimeout(r,25));
 }
 return false;
}
if(!(await waitForV44()))throw new Error('Fluid V5 M7.1.2 bootstrap: V4.4 runtime did not become ready within 12 seconds.');
stampBuild();

await import('./v5-lab.js');
try{await import('./v5-pool-slab.js');}catch(err){console.error('[Fluid V5 pool slab] full-floor initialization failed.',err);}

let lightLabReady=false;
try{
 await import('./v5-light-lab.js');
 lightLabReady=!!window.__v5LightLab;
 stampBuild();
 try{await import('./v5-environment-m343.js');}catch(err){console.error('[Fluid V5 Environment] failed.',err);}
 try{await import('./v5-night-pool-m34.js');}catch(err){window.__v5DedicatedNightPool=false;console.error('[Fluid V5 Night Pool] failed.',err);}
 try{await import('./v5-ibl-m43.js');}catch(err){window.__v5IBLStatus={online:false,error:String(err?.message||err)};console.error('[Fluid V5 IBL] failed.',err);}
}catch(err){console.error('[Fluid V5 Light Lab] atmosphere failed.',err);}
stampBuild();
if(!window.__v5ProjectedCaustics?.online){
 try{await import(lightLabReady?'./v5-atomic-multilight-m34.js':'./v5-atomic-contrast-m30.js');}
 catch(err){console.error('[Fluid V5 atomic] failed.',err);}
}

try{await import('./v5-m2-safe.js');}catch(err){console.error('[Fluid V5 M2] failed.',err);}
try{await import('./v5-debug-policy.js');}catch(err){console.error('[Fluid V5 debug] failed.',err);}
try{await import('./v5-caustic-handoff.js');}catch(err){console.error('[Fluid V5 caustic handoff] failed.',err);}
try{await import('./v5-workload-m45.js');}catch(err){console.error('[Fluid V5 M4.5] workload failed.',err);}
try{await import('./v5-physics-m40.js');}catch(err){window.__v5PhysicsM40={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M4.0] Physics 2.0 failed.',err);}
try{await import('./v5-xpbd-density-m50.js');}catch(err){window.__v5XPBDM50={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.0] XPBD failed.',err);}
try{await import('./v5-rigid-hydro-m51.js');}catch(err){window.__v5RigidHydroM51={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.1] rigid hydro failed.',err);}
try{await import('./v5-surface-m42.js');}catch(err){window.__v5SurfaceM42={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M4.2] surface failed.',err);}

// Shared detail systems stay available for every normal scene. M7.1 itself prevents primary
// appendFluid calls while active, so these modules can remain loaded without changing benchmark mass.
try{await import('./v5-whitewater-optics-m69.js');}catch(err){console.error('[Fluid V5 M6.9] secondary water failed.',err);}
try{await import('./v5-microdrops-m69.js');}catch(err){console.error('[Fluid V5 M6.9] microdrops failed.',err);}
try{await import('./v5-adaptive-detail-m52.js');}catch(err){console.error('[Fluid V5 M5.2] adaptive detail failed.',err);}
try{await import('./v5-night-caustics-m44.js');}catch(err){console.error('[Fluid V5 M4.4] night caustics failed.',err);}
try{await import('./v5-volume-light-m53.js');}catch(err){console.error('[Fluid V5 M5.3] volume light failed.',err);}

// Restore the complete scenario suite. Each source/driver already gates itself by state.scenario.
try{await import('./v5-scenarios-m46.js');}catch(err){console.error('[Fluid V5 M4.6] scenarios failed.',err);}
try{await import('./v5-rain-waterfall-m562.js');}catch(err){console.error('[Fluid V5 M5.6.2] weather failed.',err);}
try{await import('./v5-ripples-m57.js');}catch(err){console.error('[Fluid V5 M5.7] ripple layer failed.',err);}
try{await import('./v5-waterfall-spillway-m69.js');}catch(err){console.error('[Fluid V5 M6.9] spillway failed.',err);}

try{
 await import('./v5-gravity-pour-m71.js');
}catch(err){
 window.__v5GravityPourM71={...(window.__v5GravityPourM71||{}),online:false,error:String(err?.message||err),backend:'isolated-local-gated-pour-pbf-m71'};
 console.error('[Fluid V5 M7.1] gravity-pour benchmark failed.',err);
}

// Add M7.1 to the ordinary SCENARIO grid instead of replacing the other experiments.
function mountGravityScenarioButton(){
 const lab=document.getElementById('v5Lab');
 if(!lab||document.getElementById('v5M71ScenarioQuick'))return false;
 const grids=lab.querySelectorAll('.v5Grid');
 const scenarioGrid=grids?.[0];
 if(!scenarioGrid)return false;
 const b=document.createElement('button');
 b.id='v5M71ScenarioQuick';
 b.type='button';
 b.className='v5Btn';
 b.textContent='GRAVITY POUR';
 b.onclick=e=>{
  e.preventDefault();e.stopPropagation();
  const replay=document.getElementById('v5M71Replay');
  if(replay)replay.click();
  else{
   const state=window.__v5State;
   if(state){state.scenario='gravity-pour-m71';try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state));}catch{}}
   document.getElementById('reset')?.click();
  }
 };
 scenarioGrid.appendChild(b);
 return true;
}

function syncGravityScenarioButton(){
 const b=document.getElementById('v5M71ScenarioQuick');
 if(b)b.classList.toggle('active',window.__v5State?.scenario==='gravity-pour-m71');
}

// Use the module's own public UI activation path. That path performs the same reset used by the
// rest of the lab, then its wrapped sim.reset builds the elevated trough and seeds motionless water.
function activateGravityPour(label='AUTO'){
 const stats=document.getElementById('v4stats');
 const S=window.__v5GravityPourM71;
 if(!S?.online){
  if(stats)stats.textContent=`M7.1.2 ${label}: gravity module unavailable · ${S?.error||'not loaded'}`;
  return false;
 }
 const replay=document.getElementById('v5M71Replay');
 if(!replay)return false;
 replay.click();
 return true;
}

let activationAttempts=0;
const activationPoll=setInterval(()=>{
 mountGravityScenarioButton();
 syncGravityScenarioButton();
 if(!AUTO_M71){clearInterval(activationPoll);return;}
 if(window.__v5GravityPourM71?.ready&&window.__v5GravityPourM71?.upperParticles>0){clearInterval(activationPoll);return;}
 if(++activationAttempts>30){
  clearInterval(activationPoll);
  const stats=document.getElementById('v4stats');
  const S=window.__v5GravityPourM71;
  if(stats)stats.textContent=`M7.1.2 STARTUP FAILED · ready=${!!S?.ready} · elevated=${S?.upperParticles||0} · ${S?.error||'activation UI unavailable'}`;
  return;
 }
 activateGravityPour(`AUTO ${activationAttempts}`);
},180);

try{await import('./v5-tabs-m34.js');}catch(err){console.error('[Fluid V5 UI] tabs failed.',err);}
try{await import('./v5-m5-ui.js');}catch(err){console.error('[Fluid V5 UI] diagnostics failed.',err);}

for(const delay of [50,180,420,900,1800,3500])setTimeout(()=>{stampBuild();mountGravityScenarioButton();syncGravityScenarioButton();},delay);
setInterval(syncGravityScenarioButton,350);

stampBuild();
const stats=document.getElementById('v4stats');
if(stats&&!stats.textContent.includes('BUILD:'))stats.textContent=`BUILD: M7.1.2 FULL SCENARIO LAB · ${stats.textContent}`;
console.info(`[Fluid V5] ${V5_BUILD} / ${V5_VERSION} enabled; autoM71=${AUTO_M71}.`);
