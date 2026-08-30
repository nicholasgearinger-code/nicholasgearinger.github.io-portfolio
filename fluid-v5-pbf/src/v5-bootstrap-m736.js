// Fluid V5 M7.3.6 — atomic stable bootstrap for iOS.
// The visible simulation is not exposed until the complete essential module graph is installed.
// This prevents the old baseline from running while physics/render wrappers are still attaching.

const qp = new URLSearchParams(location.search);
const autoGravity = qp.get('m71') === 'pour';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stats = document.getElementById('v4stats');
const loading = document.getElementById('loading');
const note = document.getElementById('loadnote');
const phase = text => {
  if (note) note.textContent = text;
  if (loading) { loading.classList.add('v5hold'); loading.classList.remove('gone'); }
};

window.__v5BrandLock = 'M7.3.6';
function stamp() {
  window.__fluidV5Version = '7.3.6';
  window.__fluidV5Build = 'M7.3.6 ATOMIC STABLE BOOT';
  document.title = 'Fluid V5 · M7.3.6 Physical Water';
  const brand = document.querySelector('.hud.card.title');
  if (brand) brand.textContent = 'FLUID V5 · M7.3.6';
  const load = document.querySelector('#loading h2');
  if (load) load.textContent = 'FLUID V5 · M7.3.6';
}
stamp();

async function optional(path, label) {
  phase(`loading ${label}…`);
  try { await import(path); return true; }
  catch (err) { console.error(`[M7.3.6 ${label}]`, err); return false; }
}

if (!window.__sim?.dev || !window.__ssfr?.dev || !window.__ui || !window.__cam) {
  throw new Error('M7.3.6: physical-water core unavailable.');
}

// Freeze the simulation while wrappers/controllers are installed. The user sees one coherent
// build rather than a running older baseline that changes underneath them.
const ui = window.__ui;
const wasPaused = !!ui.paused;
ui.paused = true;
phase('locking stable module graph…');

// Disable persisted auto-quality for the stability build. It can be turned back on manually
// after boot from SETTINGS; this prevents an automatic quality reload during initialization.
try {
  const key='fluidV5LabStateV1';
  const saved=JSON.parse(localStorage.getItem(key)||'null');
  if(saved&&typeof saved==='object'){ saved.autoQuality=false; localStorage.setItem(key,JSON.stringify(saved)); }
  localStorage.setItem('fluidV5AutoQualityV1','0');
} catch {}

await optional('./wave-test-v44.js', 'wave driver');
phase('loading scene state…');
await import('./v5-lab.js');
if (window.__v5State) { window.__v5State.autoQuality = false; try { localStorage.setItem('fluidV5LabStateV1',JSON.stringify(window.__v5State)); } catch {} }
stamp();

// Essential geometry and solver stack only. Heavy secondary FX are deliberately not hot-loaded
// after first paint in this stability pass.
await optional('./v5-pool-slab.js', 'pool geometry');
await optional('./v5-m2-safe.js', 'safety controller');
await optional('./v5-debug-policy.js', 'debug policy');
await optional('./v5-workload-m45.js', 'workload controller');
await optional('./v5-physics-m40.js', 'physics controller');
await optional('./v5-xpbd-density-m50.js', 'XPBD density');
await optional('./v5-rigid-hydro-m51.js', 'rigid hydrodynamics');
await optional('./v5-surface-m42.js', 'surface controller');

// Scene drivers remain available, but the expensive whitewater/microdrop/volumetric stacks are
// not installed during boot. We will add them back only behind explicit performance toggles.
await optional('./v5-scenarios-m46.js', 'advanced scenarios');
await optional('./v5-rain-waterfall-m562.js', 'rain and waterfall');
await optional('./v5-ripples-m57.js', 'physical ripples');
await optional('./v5-waterfall-spillway-m69.js', 'spillway');
await optional('./v5-gravity-pour-m714.js', 'gravity pour');

if (autoGravity) {
  const state = window.__v5State;
  if (state) {
    state.scenario='gravity-pour-m71';
    try { localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state)); } catch {}
  }
  for (let i=0;i<20;i++) {
    const G=window.__v5GravityPourM71;
    if (typeof G?.activate==='function') {
      try { G.activate('M7.3.6 ATOMIC BOOT'); } catch (err) { console.error('[M7.3.6 gravity activate]',err); }
      break;
    }
    await sleep(80);
  }
}

stamp();
window.__v5M736Ready=true;
if (stats) stats.textContent = `BUILD: M7.3.6 · ATOMIC STABLE · ${stats.textContent || 'ready'}`;

// Leave boot paused only long enough for one compositor turn, then start exactly once.
await new Promise(requestAnimationFrame);
ui.paused = wasPaused;
phase('ready');
if (loading) { loading.classList.remove('v5hold'); loading.classList.add('gone'); }
console.info('[Fluid V5 M7.3.6] atomic stable module graph ready; no late boot imports remain.');
