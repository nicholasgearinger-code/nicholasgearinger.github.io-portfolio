// Fluid V5 M7.3.7 — single-submit stability bootstrap for iOS/WebKit.
// Keeps the proven upstream PBF/SSFR core, but deliberately omits every persistent
// post-PBF module that submits a second GPU CommandBuffer each frame.

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const loading=document.getElementById('loading');
const note=document.getElementById('loadnote');
const stats=document.getElementById('v4stats');
const phase=t=>{if(note)note.textContent=t;if(loading){loading.classList.remove('gone');loading.classList.add('v5hold')}};

window.__v5BrandLock='M7.3.7';
function stamp(){
 window.__fluidV5Version='7.3.7';
 window.__fluidV5Build='M7.3.7 IOS SINGLE-SUBMIT';
 document.title='Fluid V5 · M7.3.7 Physical Water';
 const b=document.querySelector('.hud.card.title');if(b)b.textContent='FLUID V5 · M7.3.7';
 const l=document.querySelector('#loading h2');if(l)l.textContent='FLUID V5 · M7.3.7';
}
stamp();

if(!window.__sim?.dev||!window.__ui||!window.__cam)throw new Error('M7.3.7: physical-water core unavailable.');
const ui=window.__ui,wasPaused=!!ui.paused;ui.paused=true;

async function optional(path,label){phase(`loading ${label}…`);try{await import(path);return true}catch(err){console.error(`[M7.3.7 ${label}]`,err);return false}}

// Reset persisted heavy physics/FX before any controller can read them.
try{
 const key='fluidV5LabStateV1';const s=JSON.parse(localStorage.getItem(key)||'null')||{};
 s.autoQuality=false;s.physicsAuto=false;s.vorticity=0;s.hydroDrag=0;s.xpbdDensity=0;s.whitewater=0;
 localStorage.setItem(key,JSON.stringify(s));localStorage.setItem('fluidV5AutoQualityV1','0');
}catch{}

phase('loading scene state…');
await import('./v5-lab.js');
if(window.__v5State){window.__v5State.autoQuality=false;window.__v5State.physicsAuto=false;window.__v5State.vorticity=0;window.__v5State.hydroDrag=0;window.__v5State.xpbdDensity=0;window.__v5State.whitewater=0;try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(window.__v5State))}catch{}}
stamp();

await optional('./v5-pool-slab.js','pool geometry');
await optional('./v5-m2-safe.js','safety controller');
await optional('./v5-debug-policy.js','debug policy');
await optional('./v5-physics-m737-coreonly.js','single-submit physics');

// Scene definitions are retained. They are inactive in the default pool stability test.
await optional('./v5-scenarios-m46.js','advanced scenes');
await optional('./v5-rain-waterfall-m562.js','rain/waterfall scenes');
await optional('./v5-ripples-m57.js','physical ripples');
await optional('./v5-waterfall-spillway-m69.js','spillway scene');

// Do NOT auto-run gravity pour in this stability build. It adds a one-shot seed submission
// and changes boundaries; first prove that the steady pool can run indefinitely without a GPU stall.
window.__v5M737Ready=true;
stamp();
if(stats)stats.textContent=`BUILD: M7.3.7 · SINGLE-SUBMIT · ${stats.textContent||'ready'}`;
await new Promise(requestAnimationFrame);
ui.paused=wasPaused;
phase('ready');if(loading){loading.classList.remove('v5hold');loading.classList.add('gone')}
console.info('[Fluid V5 M7.3.7] stable core running. M4 post-submit, XPBD post-submit and rigid hydro are disabled.');
