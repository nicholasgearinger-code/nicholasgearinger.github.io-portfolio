// Fluid V5 M5.7 integrated tab shell: M4/M5 physics, storm rain, global propagating ripples,
// and the real ballistic PBF waterfall.
const srcUrl=new URL('./v5-tabs.js',import.meta.url);
const response=await fetch(srcUrl,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 tabs M5.7: unable to load tab shell (${response.status}).`);
let src=await response.text();
const swap=(a,b,label)=>{if(!src.includes(a))throw new Error(`Fluid V5 tabs M5.7: ${label} signature changed.`);src=src.replace(a,b)};
swap("  ['light','LIGHT + WATER','Tune water optics, sun direction/intensity, exposure, absorption, and projected caustics. These controls determine how the live surface bends and focuses light.'],",
"  ['water','WATER','Tune the underlying water material and Surface Reconstruction 2.0 independently of scene mood.'],\n  ['lighting','LIGHTING','Day and Sunset use adaptive true Radiance HDR, split-sum GGX prefiltering, irradiance and BRDF integration. Night uses black HDR, six localized submerged fixtures and reflected surface caustics.'],",'tab definitions');
swap("else if(n.querySelector?.('#v5Projected'))move(n,'light');","else if(n.querySelector?.('#v5Projected'))move(n,'lighting');",'projected control destination');
swap("move(document.getElementById('v4WaveTest'),'scenes');move(document.getElementById('v4LiveWaterTune'),'light');move(document.getElementById('v44RealismLab'),'realism');",
"move(document.getElementById('v4WaveTest'),'scenes');move(document.getElementById('v4LiveWaterTune'),'water');move(document.getElementById('v5LightLab'),'lighting');move(document.getElementById('v44RealismLab'),'realism');",'control destinations');
const hudNeedle="hud.textContent=`V5 M2.4 · ${q}${state?.autoQuality?' AUTO':''}\\nFPS ${fps} · SSFR ${scale}% · GPU ${pressure}%\\nPBF ${total.toLocaleString()} · fluid ${fluid.toLocaleString()} · rigid ${rigid.toLocaleString()}\\nsecondary ${m2?.secondaryCapacity?.toLocaleString?.()||'--'} · drained ${m2?.drainedTotal?.toLocaleString?.()||'0'}\\natomic ${atomic.trim()} · UW ${uw.toFixed(2)} m`;";
const hudReplacement="const light=window.__v5LightState;const mood=(light?.timeOfDay||'day').toUpperCase();const pool=window.__v5LightLab?.state?.poolLight?.toUpperCase?.()||'';const np=window.__v5NightPoolStatus;const nc=window.__v5NightCausticsM44;const es=window.__v5EnvironmentStatus;const ibl=window.__v5IBLStatus;const ph=window.__v5PhysicsM40;const ww=window.__v5WhitewaterM41;const sf=window.__v5SurfaceM42;const work=window.__v5Workload;const wx=window.__v5WeatherM56;const rp=window.__v5RippleM57;const wf=window.__v5WaterfallM57;const envTag=es?.online?(mood==='NIGHT'?'BLACK HDR':`HDR ${String(es?.resolution||'').toUpperCase()} C${es?.cubeSize||'--'}`):`ENV ${String(es?.stage||'...').toUpperCase()}`;const nightTag=mood==='NIGHT'?` · pool ${np?.online?'6-PHOTO':'fallback'} ${pool} · nCaustic ${nc?.online?'ON':'OFF'}`:'';const weatherTag=wx?.controls?`rain ${wx.rainVisual?'ON':'fallback'} · storm ripple ${wx.rippleVisual?'ON':'fallback'}`:'rain fallback';const globalTag=`global ripple ${rp?.visual?'ON':'fallback'} · waterfall ${wf?.online?'PBF':'fallback'}`;hud.textContent=`V5 M5.7 · ${q}${state?.autoQuality?' AUTO':''}\\nFPS ${fps} · SSFR ${scale}% · GPU ${pressure}% · grid ${work?.particlesPerCell?.toFixed?.(1)||'--'} p/c\\nPBF ${total.toLocaleString()} · fluid ${fluid.toLocaleString()} · rigid ${rigid.toLocaleString()} · ${ph?.dynamic?.substeps||sim?.params?.substeps||'--'} sub\\nphysics ${ph?.online?'M4.0':'fallback'} · whitewater ${ww?.online?'M4.1':'fallback'} · surface ${sf?.online?'M4.2':'fallback'}\\n${weatherTag} · ${globalTag}\\natomic ${atomic.trim()} · ${mood} · ${envTag} · IBL ${ibl?.online?'GGX':'fallback'}${nightTag} · UW ${uw.toFixed(2)} m`;";
swap(hudNeedle,hudReplacement,'M5.7 compact HUD');
src=src.replace('The map is generated from live refracted sunlight and projected across the pool floor.','Day/Sunset use the live refracted atomic sun projector plus split-sum HDR IBL. Night uses a separate reflected atomic projector driven by the six submerged fixtures.');
const blobUrl=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blobUrl)}finally{URL.revokeObjectURL(blobUrl)}
const move=(id,key)=>{const n=document.getElementById(id),p=document.querySelector(`#v5TabHost [data-panel="${key}"]`);if(n&&p)p.appendChild(n)};
move('v5WorkloadM45','quality');
move('v5ScenariosM46','scenes');
move('v5WeatherM562','scenes');
move('v5WaterfallM57','scenes');
move('v5PhysicsM40','physics');
move('v5SurfaceM42','water');
move('v5WhitewaterM41','realism');
const devPanel=document.querySelector('#v5TabHost [data-panel="developer"]');
if(devPanel&&!document.getElementById('v5M4Status')){
 const d=document.createElement('div');d.id='v5M4Status';d.className='v5AtomicDetail ok';
 d.textContent='M5.7 suite: Physics/XPBD · Surface 2.0 · split-sum GGX IBL · storm micro-rain · global interaction ripple bus · real ballistic PBF waterfall · whitewater impact response.';
 devPanel.appendChild(d);
}
console.info('[Fluid V5 UI] M5.7 integrated ripple + physics-waterfall diagnostics enabled.');
