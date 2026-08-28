// Fluid V5 bootstrap. The HTML shell is inherited from V4.4, so mark the build immediately,
// then wait for the validated V4.4 renderer to expose its runtime handles before mounting V5.

const V5_BUILD = 'M3.4.2 TUNED NIGHT POOL + LOCAL SIX FIXTURES';
document.title = `Fluid V5 · ${V5_BUILD}`;
const earlyBrand = document.querySelector('.hud.card.title');
if (earlyBrand) earlyBrand.textContent = 'FLUID V5 · M3.4.2';
const earlyLoadTitle = document.querySelector('#loading h2');
if (earlyLoadTitle) earlyLoadTitle.textContent = 'FLUID V5 · M3.4.2';
const earlyStats = document.getElementById('v4stats');
if (earlyStats) earlyStats.textContent = 'BUILD: TUNED NIGHT POOL · LOCAL SIX FIXTURES · waiting for V4.4 core…';
window.__fluidV5Version = '5.1.4.2-m342-booting';
window.__fluidV5Build = V5_BUILD;

await import('./wave-test-v44.js');

async function waitForV44(timeoutMs = 12000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (window.__sim?.dev && window.__ssfr?.dev && window.__ui && window.__cam) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return false;
}

if (!(await waitForV44())) {
  throw new Error('Fluid V5 bootstrap: V4.4 runtime did not become ready within 12 seconds.');
}

await import('./v5-lab.js');

// Pool-like scenarios use a shallow PBF slab spanning the full X/Z floor. Dam Break alone keeps
// the upstream compact 35%-width water column.
try {
  await import('./v5-pool-slab.js');
} catch (err) {
  console.error('[Fluid V5 pool slab] full-floor initialization failed; upstream compact block retained.', err);
}

// M3.4.2 keeps the simplified Day/Sunset/Night atmosphere controller. Night is handed off to the
// tuned six-fixture renderer so the older four-light mood pass cannot double-light the pool.
let lightLabReady = false;
try {
  await import('./v5-light-lab.js');
  lightLabReady = !!window.__v5LightLab;
  try {
    await import('./v5-night-pool-m34.js');
  } catch (err) {
    window.__v5DedicatedNightPool = false;
    console.error('[Fluid V5 Night Pool] M3.4.2 tuned six-fixture renderer failed; atmosphere fallback remains active.', err);
  }
} catch (err) {
  console.error('[Fluid V5 Light Lab] M3.4.2 atmosphere module failed; retaining the M3.0 sun path.', err);
}

// Reuse the validated mobile atomic backend. Day/Sunset provide the directional air-to-water
// source; Night reports no solar source because its fixtures are submerged.
if (!window.__v5ProjectedCaustics?.online) {
  try {
    await import(lightLabReady ? './v5-atomic-multilight-m34.js' : './v5-atomic-contrast-m30.js');
  } catch (err) {
    const prev = window.__v5AtomicStatus || {};
    window.__v5AtomicStatus = {
      ...prev,
      online:false,
      stage:`rejected @ ${prev.stage || 'module'}`,
      backend:lightLabReady ? 'time-sun-m34' : 'particle-contrast',
      width:prev.width || 0,
      height:prev.height || 0,
      error:String(err?.message || err),
    };
    console.error('[Fluid V5 atomic] M3.4.2 time-of-day caustic handoff rejected; inherited receiver lighting remains active.', err);
  }
}

// Milestone 2 remains optional. If a drain/secondary/underwater experiment is rejected, the
// validated V4.4 renderer and V5 M1 controls remain usable.
try {
  await import('./v5-m2-safe.js');
} catch (err) {
  console.error('[Fluid V5 M2] milestone 2 module failed; retained M1/V4.4 stack.', err);
}

// Developer visualizations are session-only and must never hijack the next reload.
try {
  await import('./v5-debug-policy.js');
} catch (err) {
  console.error('[Fluid V5 debug policy] unable to reset developer view.', err);
}

// Once the atomic path is online, V5 owns visible solar floor caustics. Keep the inherited V4
// receiver estimate at minimum so it cannot overpower Day/Sunset or the dedicated Night fixtures.
try {
  await import('./v5-caustic-handoff.js');
} catch (err) {
  console.error('[Fluid V5 caustic handoff] legacy receiver suppression failed.', err);
}

// Reorganize all live controls after their modules have mounted.
try {
  await import('./v5-tabs-m34.js');
} catch (err) {
  console.error('[Fluid V5 UI] M3.4.2 tabbed control shell failed; original controls remain available.', err);
}

window.__fluidV5Version = '5.1.4.2-m342';
const brand = document.querySelector('.hud.card.title');
if (brand) brand.textContent = 'FLUID V5 · M3.4.2';
const stats = document.getElementById('v4stats');
if (stats && !stats.textContent.includes('BUILD:')) stats.textContent = `BUILD: TUNED NIGHT POOL · LOCAL SIX FIXTURES · ${stats.textContent}`;

setTimeout(() => {
  const toggle = document.getElementById('v4WaveToggle');
  const want = window.__v5State?.scenario === 'wave';
  if (toggle && toggle.classList.contains('active') !== want) toggle.click();
}, 420);

console.info(`[Fluid V5] ${V5_BUILD} / ${window.__fluidV5Version} isolated lab enabled; production V4.4 remains untouched.`);
