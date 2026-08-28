// Fluid V5 M3.3 tab-shell loader: simplified time-of-day lighting UI.
const srcUrl=new URL('./v5-tabs.js',import.meta.url);
const response=await fetch(srcUrl,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 tabs M3.3: unable to load tab shell (${response.status}).`);
let src=await response.text();
const swap=(a,b,label)=>{if(!src.includes(a))throw new Error(`Fluid V5 tabs M3.3: ${label} signature changed.`);src=src.replace(a,b)};

swap("  ['light','LIGHT + WATER','Tune water optics, sun direction/intensity, exposure, absorption, and projected caustics. These controls determine how the live surface bends and focuses light.'],",
"  ['water','WATER','Tune the underlying water material and optical response independently of the scene mood.'],\n  ['lighting','LIGHTING','Choose Day, Sunset or Night. Environment, sun, exposure, water reflections and caustics move together; Night reveals Blue, Aqua, Red and Rainbow pool-light modes.'],",'tab definitions');
swap("else if(n.querySelector?.('#v5Projected'))move(n,'light');","else if(n.querySelector?.('#v5Projected'))move(n,'lighting');",'projected control destination');
swap("move(document.getElementById('v4WaveTest'),'scenes');move(document.getElementById('v4LiveWaterTune'),'light');move(document.getElementById('v44RealismLab'),'realism');",
"move(document.getElementById('v4WaveTest'),'scenes');move(document.getElementById('v4LiveWaterTune'),'water');move(document.getElementById('v5LightLab'),'lighting');move(document.getElementById('v44RealismLab'),'realism');",'control destinations');

const hudNeedle="hud.textContent=`V5 M2.4 · ${q}${state?.autoQuality?' AUTO':''}\\nFPS ${fps} · SSFR ${scale}% · GPU ${pressure}%\\nPBF ${total.toLocaleString()} · fluid ${fluid.toLocaleString()} · rigid ${rigid.toLocaleString()}\\nsecondary ${m2?.secondaryCapacity?.toLocaleString?.()||'--'} · drained ${m2?.drainedTotal?.toLocaleString?.()||'0'}\\natomic ${atomic.trim()} · UW ${uw.toFixed(2)} m`;";
const hudReplacement="const light=window.__v5LightState;const mood=(light?.timeOfDay||'day').toUpperCase();const pool=window.__v5LightLab?.state?.poolLight?.toUpperCase?.()||'';hud.textContent=`V5 M3.3 · ${q}${state?.autoQuality?' AUTO':''}\\nFPS ${fps} · SSFR ${scale}% · GPU ${pressure}%\\nPBF ${total.toLocaleString()} · fluid ${fluid.toLocaleString()} · rigid ${rigid.toLocaleString()}\\nsecondary ${m2?.secondaryCapacity?.toLocaleString?.()||'--'} · drained ${m2?.drainedTotal?.toLocaleString?.()||'0'}\\natomic ${atomic.trim()} · ${mood}${mood==='NIGHT'?' '+pool:''} · UW ${uw.toFixed(2)} m`;";
swap(hudNeedle,hudReplacement,'compact HUD');
src=src.replace('The map is generated from live refracted sunlight and projected across the pool floor.','The map follows the active time-of-day sun. Night pool fixtures are underwater and therefore do not use the air-to-water atomic caustic pass.');

const blobUrl=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blobUrl)}finally{URL.revokeObjectURL(blobUrl)}
console.info('[Fluid V5 UI] M3.3 simplified time-of-day lighting tab enabled.');
