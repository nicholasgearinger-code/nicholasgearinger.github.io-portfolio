// Fluid V5 M7.1.4 bootstrap wrapper — full scenario lab + corrected physical gravity pour.
// Builds from the last full-scenario M7.1.2 bootstrap, swaps in the M7.1.4 gravity module, and
// keeps every existing scenario available. Gravity-pour isolation remains runtime-only.

const sourceUrl='https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/26d60c396f23bf6af612b273d7b3a9b6e2dd00b1/fluid-v5-pbf/src/wave-test-m71.js';
const response=await fetch(sourceUrl,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M7.1.4: unable to load full-scenario bootstrap (${response.status}).`);
let src=await response.text();

const oldImport="await import('./v5-gravity-pour-m71.js');";
const newImport="await import('./v5-gravity-pour-m714.js');";
if(!src.includes(oldImport))throw new Error('Fluid V5 M7.1.4: gravity-module import signature changed.');
src=src.replace(oldImport,newImport);

// Prefer the gravity module's direct public activation API. This bypasses hidden DOM-reset chains
// while preserving the replay-button fallback for compatibility.
const oldActivate=`function activateGravityPour(label='AUTO'){
 const stats=document.getElementById('v4stats');
 const S=window.__v5GravityPourM71;
 if(!S?.online){
  if(stats)stats.textContent=\`M7.1.2 \${label}: gravity module unavailable · \${S?.error||'not loaded'}\`;
  return false;
 }
 const replay=document.getElementById('v5M71Replay');
 if(!replay)return false;
 replay.click();
 return true;
}`;
const newActivate=`function activateGravityPour(label='AUTO'){
 const stats=document.getElementById('v4stats');
 const S=window.__v5GravityPourM71;
 if(!S?.online){
  if(stats)stats.textContent=\`M7.1.4 \${label}: gravity module unavailable · \${S?.error||'not loaded'}\`;
  return false;
 }
 if(typeof S.activate==='function'){
  try{S.activate(label);return true;}catch(err){console.error('[Fluid V5 M7.1.4 direct activation]',err);}
 }
 const replay=document.getElementById('v5M71Replay');
 if(!replay)return false;
 replay.click();
 return true;
}`;
if(src.includes(oldActivate))src=src.replace(oldActivate,newActivate);

// The quick scenario button should also use the public direct activation when available.
const oldClick=`  const replay=document.getElementById('v5M71Replay');
  if(replay)replay.click();
  else{
   const state=window.__v5State;
   if(state){state.scenario='gravity-pour-m71';try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state));}catch{}}
   document.getElementById('reset')?.click();
  }`;
const newClick=`  const S=window.__v5GravityPourM71;
  if(typeof S?.activate==='function')S.activate('SCENARIO BUTTON');
  else{
   const replay=document.getElementById('v5M71Replay');
   if(replay)replay.click();
   else{
    const state=window.__v5State;
    if(state){state.scenario='gravity-pour-m71';try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state));}catch{}}
    document.getElementById('reset')?.click();
   }
  }`;
if(src.includes(oldClick))src=src.replace(oldClick,newClick);

src=src.replaceAll('M7.1.2','M7.1.4').replaceAll('7.1.2-m71','7.1.4-m71');
const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blob);}finally{URL.revokeObjectURL(blob);}

window.__fluidV5Version='7.1.4-m71';
window.__fluidV5Build='M7.1.4 PHYSICAL WATER · SEED LAYOUT FIX';
console.info('[Fluid V5 M7.1.4] full scenario bootstrap online with corrected gravity-pour seeding.');
