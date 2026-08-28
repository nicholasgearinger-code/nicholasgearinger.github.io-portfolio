// Fluid V5 M3.4.4 tab-shell loader: HDR time-of-day UI + bright submerged flood diagnostics.
const srcUrl=new URL('./v5-tabs.js',import.meta.url);
const response=await fetch(srcUrl,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 tabs M3.4.4: unable to load tab shell (${response.status}).`);
let src=await response.text();
const swap=(a,b,label)=>{if(!src.includes(a))throw new Error(`Fluid V5 tabs M3.4.4: ${label} signature changed.`);src=src.replace(a,b)};
swap("  ['light','LIGHT + WATER','Tune water optics, sun direction/intensity, exposure, absorption, and projected caustics. These controls determine how the live surface bends and focuses light.'],",
"  ['water','WATER','Tune the underlying water material and optical response independently of the scene mood.'],\n  ['lighting','LIGHTING','Choose Day, Sunset or Night. Night keeps the overhead environment black and uses six bright wide-angle submerged flood fixtures, overlapping colored receiver pools and water-volume scattering so the pool glows from within.'],",'tab definitions');
swap("else if(n.querySelector?.('#v5Projected'))move(n,'light');","else if(n.querySelector?.('#v5Projected'))move(n,'lighting');",'projected control destination');
swap("move(document.getElementById('v4WaveTest'),'scenes');move(document.getElementById('v4LiveWaterTune'),'light');move(document.getElementById('v44RealismLab'),'realism');",
"move(document.getElementById('v4WaveTest'),'scenes');move(document.getElementById('v4LiveWaterTune'),'water');move(document.getElementById('v5LightLab'),'lighting');move(document.getElementById('v44RealismLab'),'realism');",'control destinations');
const hudNeedle="hud.textContent=`V5 M2.4 · ${q}${state?.autoQuality?' AUTO':''}\\nFPS ${fps} · SSFR ${scale}% · GPU ${pressure}%\\nPBF ${total.toLocaleString()} · fluid ${fluid.toLocaleString()} · rigid ${rigid.toLocaleString()}\\nsecondary ${m2?.secondaryCapacity?.toLocaleString?.()||'--'} · drained ${m2?.drainedTotal?.toLocaleString?.()||'0'}\\natomic ${atomic.trim()} · UW ${uw.toFixed(2)} m`;";
const hudReplacement="const light=window.__v5LightState;const mood=(light?.timeOfDay||'day').toUpperCase();const pool=window.__v5LightLab?.state?.poolLight?.toUpperCase?.()||'';const np=window.__v5NightPoolStatus;const es=window.__v5EnvironmentStatus;const envTag=es?.online?`${String(es.mode||'').toUpperCase()} HDRI`:`ENV ${String(es?.stage||'...').toUpperCase()}`;const nightTag=mood==='NIGHT'?` · pool ${np?.online?'6-FLOOD':'fallback'} ${pool}`:'';hud.textContent=`V5 M3.4.4 · ${q}${state?.autoQuality?' AUTO':''}\\nFPS ${fps} · SSFR ${scale}% · GPU ${pressure}%\\nPBF ${total.toLocaleString()} · fluid ${fluid.toLocaleString()} · rigid ${rigid.toLocaleString()}\\nsecondary ${m2?.secondaryCapacity?.toLocaleString?.()||'--'} · drained ${m2?.drainedTotal?.toLocaleString?.()||'0'}\\natomic ${atomic.trim()} · ${mood} · ${envTag}${nightTag} · UW ${uw.toFixed(2)} m`;";
swap(hudNeedle,hudReplacement,'compact HUD');
src=src.replace('The map is generated from live refracted sunlight and projected across the pool floor.','Day/Sunset use the atomic sun projector. Night has no solar source: six broad submerged floods provide the receiver light and colored water-volume scattering.');
const blobUrl=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blobUrl)}finally{URL.revokeObjectURL(blobUrl)}
console.info('[Fluid V5 UI] M3.4.4 bright night-flood tab enabled.');
