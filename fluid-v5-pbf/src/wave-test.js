// Fluid V5 M6.0.1 bootstrap. Production V4.4 stays untouched; the isolated V5 development stack
// can fail subsystem-by-subsystem back to earlier validated paths. M6 replaces the old direct
// waterfall sheet renderer with a Houdini-style PBF -> reconstructed body -> whitewater -> mist path.

const V5_BUILD = 'M6.0.1 HOUDINI WATERFALL';
const V5_VERSION = '6.0.1-m601';

function stampBuild() {
  document.title = `Fluid V5 · ${V5_BUILD}`;
  const brand = document.querySelector('.hud.card.title');
  if (brand && brand.textContent !== 'FLUID V5 · M6.0.1') brand.textContent = 'FLUID V5 · M6.0.1';
  const loadTitle = document.querySelector('#loading h2');
  if (loadTitle && loadTitle.textContent !== 'FLUID V5 · M6.0.1') loadTitle.textContent = 'FLUID V5 · M6.0.1';
  window.__fluidV5Version = V5_VERSION;
  window.__fluidV5Build = V5_BUILD;
}

// Stamp before any inherited module can identify itself. A MutationObserver keeps M6 authoritative
// because the validated M3.5 lighting wrapper still contains its own historical branding code.
stampBuild();
const brandNode = document.querySelector('.hud.card.title');
if (brandNode) {
  new MutationObserver(() => stampBuild()).observe(brandNode, { childList:true, characterData:true, subtree:true });
}
const earlyStats = document.getElementById('v4stats');
if (earlyStats) earlyStats.textContent = 'BUILD: M6 HOUDINI WATERFALL · PBF BODY RECONSTRUCTION · WHITEWATER · MIST · waiting for V4.4 core…';
window.__fluidV5Version = `${V5_VERSION}-booting`;
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
if (!(await waitForV44())) throw new Error('Fluid V5 M6.0.1 bootstrap: V4.4 runtime did not become ready within 12 seconds.');
stampBuild();

await import('./v5-lab.js');
try { await import('./v5-pool-slab.js'); }
catch (err) { console.error('[Fluid V5 pool slab] full-floor initialization failed; upstream compact block retained.', err); }

let lightLabReady = false;
try {
  await import('./v5-light-lab.js');
  lightLabReady = !!window.__v5LightLab;
  stampBuild();
  try { await import('./v5-environment-m343.js'); }
  catch (err) { console.error('[Fluid V5 Environment] true HDR environment system failed; atmosphere fallback retained.', err); }
  try { await import('./v5-night-pool-m34.js'); }
  catch (err) { window.__v5DedicatedNightPool = false; console.error('[Fluid V5 Night Pool] photometric six-fixture renderer failed.', err); }
  try { await import('./v5-ibl-m43.js'); }
  catch (err) { window.__v5IBLStatus={online:false,stage:'rejected',backend:'split-sum-ggx-m43',error:String(err?.message||err)}; console.error('[Fluid V5 IBL] split-sum IBL failed; base sharp HDR remains active.', err); }
} catch (err) {
  console.error('[Fluid V5 Light Lab] atmosphere module failed; retaining the M3.0 sun path.', err);
}
stampBuild();

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

try { await import('./v5-workload-m45.js'); }
catch (err) { console.error('[Fluid V5 M4.5] adaptive workload manager rejected.', err); }
try { await import('./v5-physics-m40.js'); }
catch (err) { window.__v5PhysicsM40={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M4.0] Physics 2.0 rejected; base PBF remains active.', err); }
try { await import('./v5-xpbd-density-m50.js'); }
catch (err) { window.__v5XPBDM50={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.0] XPBD density refinement rejected; M4/base PBF retained.', err); }
try { await import('./v5-rigid-hydro-m51.js'); }
catch (err) { window.__v5RigidHydroM51={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.1] shape-aware rigid hydrodynamics rejected.', err); }

try { await import('./v5-surface-m42.js'); }
catch (err) { window.__v5SurfaceM42={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M4.2] Surface 2.0 rejected; base SSFR remains active.', err); }
try { await import('./v5-whitewater-optics-m54.js'); }
catch (err) { window.__v5WhitewaterM54={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.9] fine refractive Whitewater rejected; simulation remains active.', err); }
try { await import('./v5-adaptive-detail-m52.js'); }
catch (err) { window.__v5AdaptiveDetailM52={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.2] adaptive refractive surface detail rejected.', err); }

try { await import('./v5-night-caustics-m44.js'); }
catch (err) { window.__v5NightCausticsM44={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M4.4] underwater fixture caustics rejected.', err); }
try { await import('./v5-volume-light-m53.js'); }
catch (err) { window.__v5VolumeLightM53={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.3] underwater volumetric transport rejected.', err); }

try { await import('./v5-scenarios-m46.js'); }
catch (err) { console.error('[Fluid V5 M4.6] advanced scenarios rejected.', err); }
try { await import('./v5-rain-waterfall-m562.js'); }
catch (err) {
  const prev=window.__v5WeatherM56||{};
  window.__v5WeatherM56={...prev,online:!!prev.controls,controls:!!prev.controls,rainVisual:!!prev.rainVisual,rippleVisual:false,waterfallVisual:!!prev.waterfallVisual,waterfallMist:false,error:String(err?.message||err)};
  console.error('[Fluid V5 M5.6.2] weather module failed; any initialized capture-phase controls remain authoritative.', err);
}
try { await import('./v5-ripples-m57.js'); }
catch (err) { window.__v5RippleM57={online:false,visual:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.7] global ripple layer rejected; real PBF motion remains active.',err); }

// M6 waterfall stack:
// 1) prime the bounded tagged PBF curtain once;
// 2) globally replace sparse airborne non-waterfall PBF parcels with microdroplets;
// 3) reconstruct tagged waterfall particles as one continuous density/aeration body + mist.
// The obsolete M5.8/M5.9 direct waterfall sheet module is intentionally NOT imported here.
try { await import('./v5-waterfall-physics-m57.js'); }
catch (err) { window.__v5WaterfallM57={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M6.0.1] fixed-mass waterfall physics rejected; other scenarios remain active.',err); }
try { await import('./v5-microdrops-m59.js'); }
catch (err) { window.__v5MicroDropsM59={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M6.0.1] microdroplet surfacing rejected; ordinary SSFR remains active.',err); }
try { await import('./v5-waterfall-houdini-m60.js'); }
catch (err) {
  window.__v5WaterfallM60={online:false,error:String(err?.message||err)};
  console.error('[Fluid V5 M6.0.1] Houdini-style waterfall body/whitewater/mist renderer rejected; real PBF waterfall remains active.',err);
}

try { await import('./v5-tabs-m34.js'); }
catch (err) { console.error('[Fluid V5 UI] integrated tab shell failed; original controls remain available.', err); }
try { await import('./v5-m5-ui.js'); }
catch (err) { console.error('[Fluid V5 UI] M5/M6 controls/status failed; simulation systems remain active.', err); }

stampBuild();
const stats=document.getElementById('v4stats');
if(stats&&!stats.textContent.includes('BUILD:'))stats.textContent=`BUILD: M6 HOUDINI PBF → BODY → WHITEWATER → MIST · ${stats.textContent}`;

// Hold the integrated build label authoritative while slower HDR/light modules settle.
for (const delay of [100,350,800,1600,3000,6000]) setTimeout(stampBuild,delay);
setTimeout(()=>{
  const toggle=document.getElementById('v4WaveToggle');
  const want=window.__v5State?.scenario==='wave';
  if(toggle&&toggle.classList.contains('active')!==want)toggle.click();
},420);

console.info(`[Fluid V5] ${V5_BUILD} / ${V5_VERSION} enabled; M6 waterfall renderer is authoritative and production V4.4 remains untouched.`);
