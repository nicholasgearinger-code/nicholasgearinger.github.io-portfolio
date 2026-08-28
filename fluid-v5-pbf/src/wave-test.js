// Fluid V5 bootstrap. The HTML shell is inherited from V4.4, so mark the build immediately,
// then wait for the validated V4.4 renderer to expose its runtime handles before mounting V5.

const V5_BUILD = 'M3.4.5 USER PANORAMAS + BLACK NIGHT + BRIGHT FLOODS';
document.title = `Fluid V5 · ${V5_BUILD}`;
const earlyBrand = document.querySelector('.hud.card.title');
if (earlyBrand) earlyBrand.textContent = 'FLUID V5 · M3.4.5';
const earlyLoadTitle = document.querySelector('#loading h2');
if (earlyLoadTitle) earlyLoadTitle.textContent = 'FLUID V5 · M3.4.5';
const earlyStats = document.getElementById('v4stats');
if (earlyStats) earlyStats.textContent = 'BUILD: USER DAY/SUNSET MAPS · BLACK NIGHT · BRIGHT FLOODS · waiting for V4.4 core…';
window.__fluidV5Version = '5.1.4.5-m345-booting';
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

// M3.4.5 uses the user-supplied 2:1 panorama maps for Day and Sunset, a true black map for Night,
// and keeps M3.4.4's broad submerged flood-light transport for the night pool itself.
let lightLabReady = false;
try {
  await import('./v5-light-lab.js');
  lightLabReady = !!window.__v5LightLab;
  try {
    await import('./v5-environment-m343.js');
  } catch (err) {
    console.error('[Fluid V5 Environment] M3.4.5 supplied panorama system failed; atmosphere fallback retained.', err);
  }
  try {
    await import('./v5-night-pool-m34.js');
  } catch (err) {
    window.__v5DedicatedNightPool = false;
    console.error('[Fluid V5 Night Pool] broad-flood renderer failed; atmosphere fallback remains active.', err);
  }
} catch (err) {
  console.error('[Fluid V5 Light Lab] M3.4.5 atmosphere module failed; retaining the M3.0 sun path.', err);
}

// Reuse the validated mobile atomic backend. Day/Sunset provide the directional air-to-water
// source. Night reports no solar source because the only active lights are submerged fixtures.
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
    console.error('[Fluid V5 atomic] M3.4.5 time-of-day caustic handoff rejected; inherited receiver lighting remains active.', err);
  }
}

try {
  await import('./v5-m2-safe.js');
} catch (err) {
  console.error('[Fluid V5 M2] milestone 2 module failed; retained M1/V4.4 stack.', err);
}

try {
  await import('./v5-debug-policy.js');
} catch (err) {
  console.error('[Fluid V5 debug policy] unable to reset developer view.', err);
}

try {
  await import('./v5-caustic-handoff.js');
} catch (err) {
  console.error('[Fluid V5 caustic handoff] legacy receiver suppression failed.', err);
}

try {
  await import('./v5-tabs-m34.js');
} catch (err) {
  console.error('[Fluid V5 UI] M3.4.5 tabbed control shell failed; original controls remain available.', err);
}

window.__fluidV5Version = '5.1.4.5-m345';
const brand = document.querySelector('.hud.card.title');
if (brand) brand.textContent = 'FLUID V5 · M3.4.5';
const stats = document.getElementById('v4stats');
if (stats && !stats.textContent.includes('BUILD:')) stats.textContent = `BUILD: USER PANORAMAS · BLACK NIGHT · BRIGHT FLOODS · ${stats.textContent}`;

// The night module has its own delayed development branding; stamp the integrated build after it.
setTimeout(() => {
  const b = document.querySelector('.hud.card.title');
  if (b) b.textContent = 'FLUID V5 · M3.4.5';
  document.title = 'Fluid V5 · M3.4.5 USER PANORAMAS + BRIGHT NIGHT FLOODS';
  window.__fluidV5Version = '5.1.4.5-m345';
}, 1150);

setTimeout(() => {
  const toggle = document.getElementById('v4WaveToggle');
  const want = window.__v5State?.scenario === 'wave';
  if (toggle && toggle.classList.contains('active') !== want) toggle.click();
}, 420);

console.info(`[Fluid V5] ${V5_BUILD} / ${window.__fluidV5Version} isolated lab enabled; production V4.4 remains untouched.`);
