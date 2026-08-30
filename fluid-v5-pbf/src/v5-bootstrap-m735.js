// Fluid V5 M7.3.5 — normal-module scenario/bootstrap path for iOS.
// No runtime source rewriting and no Blob-backed bootstrap module. Relative imports stay
// attached to real HTTP module URLs so Safari/Chrome on iOS can resolve them normally.

const qp = new URLSearchParams(location.search);
const autoGravity = qp.get('m71') === 'pour';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stats = document.getElementById('v4stats');

function stamp() {
  window.__fluidV5Version = '7.3.5';
  window.__fluidV5Build = 'M7.3.5 NO-BLOB SCENARIO BOOT';
  const brand = document.querySelector('.hud.card.title');
  if (brand) brand.textContent = 'FLUID V5 · M7.3.5';
  const load = document.querySelector('#loading h2');
  if (load) load.textContent = 'FLUID V5 · M7.3.5';
  document.title = 'Fluid V5 · M7.3.5 Physical Water';
}
stamp();

async function waitForCore(timeoutMs = 12000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    if (window.__sim?.dev && window.__ssfr?.dev && window.__ui && window.__cam && window.__mesh) return true;
    await sleep(25);
  }
  return false;
}

async function optional(path, label) {
  try {
    await import(path);
    return true;
  } catch (err) {
    console.error(`[Fluid V5 M7.3.5 ${label}]`, err);
    return false;
  }
}

if (!(await waitForCore())) throw new Error('M7.3.5: physical-water core did not become ready within 12 seconds.');

// The wave test is a plain local module. It no longer sits inside a generated Blob module.
await optional('./wave-test-v44.js', 'wave test');

// Shared lab state must exist before the rest of the scene drivers are installed.
await import('./v5-lab.js');
stamp();

await optional('./v5-pool-slab.js', 'pool slab');
await optional('./v5-light-lab.js', 'light lab');
await optional('./v5-environment-m343.js', 'environment');
await optional('./v5-night-pool-m34.js', 'night pool');
await optional('./v5-ibl-m43.js', 'IBL');

// Physics stack.
await optional('./v5-m2-safe.js', 'M2 safety');
await optional('./v5-debug-policy.js', 'debug policy');
await optional('./v5-caustic-handoff.js', 'caustic handoff');
await optional('./v5-workload-m45.js', 'workload controller');
await optional('./v5-physics-m40.js', 'physics controller');
await optional('./v5-xpbd-density-m50.js', 'XPBD density');
await optional('./v5-rigid-hydro-m51.js', 'rigid hydrodynamics');
await optional('./v5-surface-m42.js', 'surface controller');

// Optional detail systems. Failures here must never stop the physical simulator from booting.
await optional('./v5-whitewater-optics-m69.js', 'whitewater');
await optional('./v5-microdrops-m69.js', 'microdrops');
await optional('./v5-adaptive-detail-m52.js', 'adaptive detail');
await optional('./v5-night-caustics-m44.js', 'night caustics');
await optional('./v5-volume-light-m53.js', 'volume light');

// Full scene suite.
await optional('./v5-scenarios-m46.js', 'advanced scenarios');
await optional('./v5-rain-waterfall-m562.js', 'rain/waterfall');
await optional('./v5-ripples-m57.js', 'ripples');
await optional('./v5-waterfall-spillway-m69.js', 'spillway');

// M7 gravity benchmark. This hotfix's generated module contains no relative imports, so it does
// not have the URL-resolution failure that broke the old wave-test bootstrap. The next cleanup
// can flatten it too after the normal module graph is stable again.
await optional('./v5-gravity-pour-m714.js', 'gravity pour');

if (autoGravity) {
  const state = window.__v5State;
  if (state) {
    state.scenario = 'gravity-pour-m71';
    try { localStorage.setItem('fluidV5LabStateV1', JSON.stringify(state)); } catch {}
  }
  for (let i = 0; i < 24; i++) {
    const G = window.__v5GravityPourM71;
    if (typeof G?.activate === 'function') {
      try { G.activate('M7.3.5 AUTO'); } catch (err) { console.error('[M7.3.5 gravity activation]', err); }
      break;
    }
    await sleep(100);
  }
}

stamp();
if (stats) stats.textContent = `BUILD: M7.3.5 · NORMAL MODULE GRAPH · ${stats.textContent || 'ready'}`;
window.__v5M735Ready = true;
console.info('[Fluid V5 M7.3.5] normal-module physical scene graph ready.');
