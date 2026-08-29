// Fluid V5 M6.2.2 bootstrap. Production V4.4 stays untouched; V5 development systems fail
// independently. M6.2.2 uses an iOS-safe separate GPU submission for the closed-loop submerged
// reservoir pump, then reconstructs the resulting real PBF waterfall Houdini-style.

const V5_BUILD='M6.2.2 SEPARATE-SUBMIT RESERVOIR HOUDINI WATERFALL';
const V5_VERSION='6.2.2-m622';
function stampBuild(){document.title=`Fluid V5 · ${V5_BUILD}`;const brand=document.querySelector('.hud.card.title');if(brand&&brand.textContent!=='FLUID V5 · M6.2.2')brand.textContent='FLUID V5 · M6.2.2';const load=document.querySelector('#loading h2');if(load&&load.textContent!=='FLUID V5 · M6.2.2')load.textContent='FLUID V5 · M6.2.2';window.__fluidV5Version=V5_VERSION;window.__fluidV5Build=V5_BUILD;}
stampBuild();
const initialBrand=document.querySelector('.hud.card.title');if(initialBrand)new MutationObserver(()=>stampBuild()).observe(initialBrand,{childList:true,characterData:true,subtree:true});
const earlyStats=document.getElementById('v4stats');if(earlyStats)earlyStats.textContent='BUILD: M6.2.2 · SEPARATE GPU PUMP · RESERVOIR · HOUDINI BODY · waiting for V4.4 core…';
window.__fluidV5Version=`${V5_VERSION}-booting`;

await import('./wave-test-v44.js');
async function waitForV44(timeoutMs=12000){const start=performance.now();while(performance.now()-start<timeoutMs){if(window.__sim?.dev&&window.__ssfr?.dev&&window.__ui&&window.__cam&&window.__mesh)return true;await new Promise(r=>setTimeout(r,25));}return false;}
if(!(await waitForV44()))throw new Error('Fluid V5 M6.2.2 bootstrap: V4.4 runtime did not become ready within 12 seconds.');stampBuild();

await import('./v5-lab.js');
try{await import('./v5-pool-slab.js');}catch(err){console.error('[Fluid V5 pool slab] full-floor initialization failed; upstream compact block retained.',err);}

let lightLabReady=false;
try{await import('./v5-light-lab.js');lightLabReady=!!window.__v5LightLab;stampBuild();try{await import('./v5-environment-m343.js');}catch(err){console.error('[Fluid V5 Environment] true HDR environment system failed.',err);}try{await import('./v5-night-pool-m34.js');}catch(err){window.__v5DedicatedNightPool=false;console.error('[Fluid V5 Night Pool] photometric fixtures failed.',err);}try{await import('./v5-ibl-m43.js');}catch(err){window.__v5IBLStatus={online:false,stage:'rejected',backend:'split-sum-ggx-m43',error:String(err?.message||err)};console.error('[Fluid V5 IBL] split-sum IBL failed.',err);}}catch(err){console.error('[Fluid V5 Light Lab] atmosphere module failed.',err);}stampBuild();
if(!window.__v5ProjectedCaustics?.online){try{await import(lightLabReady?'./v5-atomic-multilight-m34.js':'./v5-atomic-contrast-m30.js');}catch(err){const prev=window.__v5AtomicStatus||{};window.__v5AtomicStatus={...prev,online:false,stage:`rejected @ ${prev.stage||'module'}`,backend:lightLabReady?'time-sun-m34':'particle-contrast',width:prev.width||0,height:prev.height||0,error:String(err?.message||err)};console.error('[Fluid V5 atomic] daytime caustic handoff rejected.',err);}}

try{await import('./v5-m2-safe.js');}catch(err){console.error('[Fluid V5 M2] milestone 2 failed.',err);}
try{await import('./v5-debug-policy.js');}catch(err){console.error('[Fluid V5 debug] reset failed.',err);}
try{await import('./v5-caustic-handoff.js');}catch(err){console.error('[Fluid V5 caustic handoff] failed.',err);}
try{await import('./v5-workload-m45.js');}catch(err){console.error('[Fluid V5 M4.5] workload manager rejected.',err);}
try{await import('./v5-physics-m40.js');}catch(err){window.__v5PhysicsM40={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M4.0] Physics 2.0 rejected.',err);}
try{await import('./v5-xpbd-density-m50.js');}catch(err){window.__v5XPBDM50={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.0] XPBD rejected.',err);}
try{await import('./v5-rigid-hydro-m51.js');}catch(err){window.__v5RigidHydroM51={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.1] rigid hydro rejected.',err);}
try{await import('./v5-surface-m42.js');}catch(err){window.__v5SurfaceM42={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M4.2] surface rejected.',err);}
try{await import('./v5-whitewater-optics-m54.js');}catch(err){window.__v5WhitewaterM54={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.4] whitewater rejected.',err);}
try{await import('./v5-adaptive-detail-m52.js');}catch(err){window.__v5AdaptiveDetailM52={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.2] adaptive detail rejected.',err);}
try{await import('./v5-night-caustics-m44.js');}catch(err){window.__v5NightCausticsM44={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M4.4] night caustics rejected.',err);}
try{await import('./v5-volume-light-m53.js');}catch(err){window.__v5VolumeLightM53={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.3] volume light rejected.',err);}

try{await import('./v5-scenarios-m46.js');}catch(err){console.error('[Fluid V5 M4.6] advanced scenarios rejected.',err);}
try{await import('./v5-rain-waterfall-m562.js');}catch(err){const prev=window.__v5WeatherM56||{};window.__v5WeatherM56={...prev,online:!!prev.controls,controls:!!prev.controls,rainVisual:!!prev.rainVisual,rippleVisual:false,waterfallVisual:!!prev.waterfallVisual,waterfallMist:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.6.2] weather module failed.',err);}
try{await import('./v5-ripples-m57.js');}catch(err){window.__v5RippleM57={online:false,visual:false,error:String(err?.message||err)};console.error('[Fluid V5 M5.7] global ripple layer rejected.',err);}

// Authoritative M6.2.2 waterfall stack. The reservoir pump submits its compute work in a dedicated
// command buffer before SSFR rendering to avoid iOS/WebKit same-encoder live-buffer hazards.
try{await import('./v5-waterfall-pump-m62.js');}catch(err){window.__v5WaterfallM62={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M6.2.2] reservoir pump rejected.',err);}
try{await import('./v5-microdrops-m59.js');}catch(err){window.__v5MicroDropsM59={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M6.2.2] microdroplet surfacing rejected.',err);}
try{await import('./v5-waterfall-houdini-m62.js');}catch(err){window.__v5WaterfallM60={online:false,error:String(err?.message||err)};console.error('[Fluid V5 M6.2.2] Houdini reconstructed body/whitewater/mist rejected.',err);}

try{await import('./v5-tabs-m34.js');}catch(err){console.error('[Fluid V5 UI] tab shell failed.',err);}
try{await import('./v5-m5-ui.js');}catch(err){console.error('[Fluid V5 UI] integrated diagnostics failed.',err);}

stampBuild();const stats=document.getElementById('v4stats');if(stats&&!stats.textContent.includes('BUILD:'))stats.textContent=`BUILD: M6.2.2 RESERVOIR + HOUDINI · ${stats.textContent}`;
for(const delay of [100,350,800,1600,3000,6000])setTimeout(stampBuild,delay);
setTimeout(()=>{const toggle=document.getElementById('v4WaveToggle');const want=window.__v5State?.scenario==='wave';if(toggle&&toggle.classList.contains('active')!==want)toggle.click();},420);
console.info(`[Fluid V5] ${V5_BUILD} / ${V5_VERSION} enabled; waterfall pump uses a dedicated GPU submission.`);
