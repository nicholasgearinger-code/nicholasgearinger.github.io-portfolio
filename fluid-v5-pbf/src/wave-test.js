// Fluid V5 bootstrap. Production V4.4 stays untouched; M4/M5 systems run only on the isolated
// fluid-v5-development branch and can fail independently back to the validated earlier stack.

const V5_BUILD = 'M5.6.1 SAFARI-SAFE STORM + WATERFALL';
document.title = `Fluid V5 · ${V5_BUILD}`;
const earlyBrand = document.querySelector('.hud.card.title');
if (earlyBrand) earlyBrand.textContent = 'FLUID V5 · M5.6.1';
const earlyLoadTitle = document.querySelector('#loading h2');
if (earlyLoadTitle) earlyLoadTitle.textContent = 'FLUID V5 · M5.6.1';
const earlyStats = document.getElementById('v4stats');
if (earlyStats) earlyStats.textContent = 'BUILD: XPBD · SHAPE HYDRO · MICRO-RAIN HOTFIX · CONTINUOUS WATERFALL · waiting for V4.4 core…';
window.__fluidV5Version = '5.3.6.1-m561-booting';
window.__fluidV5Build = V5_BUILD;

await import('./wave-test-v44.js');
async function waitForV44(timeoutMs = 12000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (window.__sim?.dev && window.__ssfr?.dev && window.__ui && window.__cam && window.__mesh) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return false;
}
if (!(await waitForV44())) throw new Error('Fluid V5 bootstrap: V4.4 runtime did not become ready within 12 seconds.');

await import('./v5-lab.js');
try { await import('./v5-pool-slab.js'); }
catch (err) { console.error('[Fluid V5 pool slab] full-floor initialization failed; upstream compact block retained.', err); }

let lightLabReady = false;
try {
  await import('./v5-light-lab.js');
  lightLabReady = !!window.__v5LightLab;
  try { await import('./v5-environment-m343.js'); }
  catch (err) { console.error('[Fluid V5 Environment] true HDR environment system failed; atmosphere fallback retained.', err); }
  try { await import('./v5-night-pool-m34.js'); }
  catch (err) { window.__v5DedicatedNightPool = false; console.error('[Fluid V5 Night Pool] photometric six-fixture renderer failed.', err); }
  try { await import('./v5-ibl-m43.js'); }
  catch (err) { window.__v5IBLStatus={online:false,stage:'rejected',backend:'split-sum-ggx-m43',error:String(err?.message||err)}; console.error('[Fluid V5 IBL] split-sum IBL failed; base sharp HDR remains active.', err); }
} catch (err) {
  console.error('[Fluid V5 Light Lab] atmosphere module failed; retaining the M3.0 sun path.', err);
}

if (!window.__v5ProjectedCaustics?.online) {
  try { await import(lightLabReady ? './v5-atomic-multilight-m34.js' : './v5-atomic-contrast-m30.js'); }
  catch (err) {
    const prev=window.__v5AtomicStatus||{};
    window.__v5AtomicStatus={...prev,online:false,stage:`rejected @ ${prev.stage||'module'}`,backend:lightLabReady?'time-sun-m34':'particle-contrast',width:prev.width||0,height:prev.height||0,error:String(err?.message||err)};
    console.error('[Fluid V5 atomic] daytime caustic handoff rejected; inherited receiver lighting remains active.',err);
  }
}

try { await import('./v5-m2-safe.js'); }
catch (err) { console.error('[Fluid V5 M2] milestone 2 module failed; retained M1/V4.4 stack.', err); }
try { await import('./v5-debug-policy.js'); }
catch (err) { console.error('[Fluid V5 debug policy] unable to reset developer view.', err); }
try { await import('./v5-caustic-handoff.js'); }
catch (err) { console.error('[Fluid V5 caustic handoff] legacy receiver suppression failed.', err); }

// ----- M4 foundation -----------------------------------------------------------------------
try { await import('./v5-workload-m45.js'); }
catch (err) { console.error('[Fluid V5 M4.5] adaptive workload manager rejected.', err); }
try { await import('./v5-physics-m40.js'); }
catch (err) { window.__v5PhysicsM40={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M4.0] Physics 2.0 rejected; base PBF remains active.', err); }

// ----- M5 solver refinement ----------------------------------------------------------------
try { await import('./v5-xpbd-density-m50.js'); }
catch (err) { window.__v5XPBDM50={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.0] XPBD density refinement rejected; M4/base PBF retained.', err); }
try { await import('./v5-rigid-hydro-m51.js'); }
catch (err) { window.__v5RigidHydroM51={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.1] shape-aware rigid hydrodynamics rejected.', err); }

// ----- Surface / whitewater / optical detail ------------------------------------------------
try { await import('./v5-surface-m42.js'); }
catch (err) { window.__v5SurfaceM42={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M4.2] Surface 2.0 rejected; base SSFR remains active.', err); }
try { await import('./v5-whitewater-optics-m54.js'); }
catch (err) { window.__v5WhitewaterM54={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.4] refractive Whitewater 2.0 rejected; simulation remains active.', err); }
try { await import('./v5-adaptive-detail-m52.js'); }
catch (err) { window.__v5AdaptiveDetailM52={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.2] adaptive refractive surface detail rejected.', err); }

// ----- Night optics -------------------------------------------------------------------------
try { await import('./v5-night-caustics-m44.js'); }
catch (err) { window.__v5NightCausticsM44={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M4.4] underwater fixture caustics rejected.', err); }
try { await import('./v5-volume-light-m53.js'); }
catch (err) { window.__v5VolumeLightM53={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.3] underwater volumetric transport rejected.', err); }

// ----- Physical scenarios ------------------------------------------------------------------
try { await import('./v5-scenarios-m46.js'); }
catch (err) { console.error('[Fluid V5 M4.6] advanced scenarios rejected.', err); }
// M5.6.1 installs scenario control takeover before compiling either optional weather shader, so
// a Safari validation failure can no longer fall through to the old giant-airborne-particle rain.
try { await import('./v5-rain-waterfall-m56.js'); }
catch (err) {
  const prev=window.__v5WeatherM56||{};
  window.__v5WeatherM56={...prev,online:!!prev.controls,controls:!!prev.controls,rainVisual:false,waterfallVisual:false,error:String(err?.message||err)};
  console.error('[Fluid V5 M5.6.1] weather module failed after control takeover; old airborne rain remains disabled if controls initialized.', err);
}

try { await import('./v5-tabs-m34.js'); }
catch (err) { console.error('[Fluid V5 UI] integrated tab shell failed; original controls remain available.', err); }
try { await import('./v5-m5-ui.js'); }
catch (err) { console.error('[Fluid V5 UI] M5 controls/status failed; M5 systems remain active.', err); }

window.__fluidV5Version='5.3.6.1-m561';
const brand=document.querySelector('.hud.card.title');
if(brand)brand.textContent='FLUID V5 · M5.6.1';
const stats=document.getElementById('v4stats');
if(stats&&!stats.textContent.includes('BUILD:'))stats.textContent=`BUILD: M5.6.1 WEATHER HOTFIX · ${stats.textContent}`;
setTimeout(()=>{
  const b=document.querySelector('.hud.card.title');
  if(b)b.textContent='FLUID V5 · M5.6.1';
  document.title='Fluid V5 · M5.6.1 SAFARI-SAFE STORM + WATERFALL';
  window.__fluidV5Version='5.3.6.1-m561';
},1450);
setTimeout(()=>{
  const toggle=document.getElementById('v4WaveToggle');
  const want=window.__v5State?.scenario==='wave';
  if(toggle&&toggle.classList.contains('active')!==want)toggle.click();
},420);
console.info(`[Fluid V5] ${V5_BUILD} / ${window.__fluidV5Version} isolated lab enabled; production V4.4 remains untouched.`);
