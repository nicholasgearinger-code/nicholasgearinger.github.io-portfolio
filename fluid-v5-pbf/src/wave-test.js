// Fluid V5 bootstrap. The HTML shell is inherited from V4.4, so mark the build immediately,
// then wait for the validated V4.4 renderer to expose its runtime handles before mounting V5.

const V5_BUILD = 'M2.8 ATOMIC HANDOFF + FULL FLOOR';
document.title = `Fluid V5 · ${V5_BUILD}`;
const earlyBrand = document.querySelector('.hud.card.title');
if (earlyBrand) earlyBrand.textContent = 'FLUID V5 · M2.8';
const earlyLoadTitle = document.querySelector('#loading h2');
if (earlyLoadTitle) earlyLoadTitle.textContent = 'FLUID V5 · M2.8';
const earlyStats = document.getElementById('v4stats');
if (earlyStats) earlyStats.textContent = 'BUILD: ATOMIC HANDOFF · FULL FLOOR · waiting for V4.4 core…';
window.__fluidV5Version = '5.0.8-m2-booting';
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

// M2.8 keeps the camera-independent full PBF surface as the photon source, but widens the
// accumulation reconstruction and gives the complete floor a subtle transmitted-sun baseline.
if (!window.__v5ProjectedCaustics?.online) {
  try {
    await import('./v5-atomic-fullsurface-m28.js');
  } catch (err) {
    const prev = window.__v5AtomicStatus || {};
    window.__v5AtomicStatus = {
      ...prev,
      online:false,
      stage:`rejected @ ${prev.stage || 'module'}`,
      backend:'particle-full-wide',
      width:prev.width || 0,
      height:prev.height || 0,
      error:String(err?.message || err),
    };
    console.error('[Fluid V5 atomic] M2.8 full-floor particle pass rejected; V4.4 receiver caustics remain active.', err);
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

// Once the atomic path is online, V5 owns visible floor caustics. Keep the inherited V4 receiver
// caustic control at minimum so the old camera-space rectangle cannot overpower the atomic map.
try {
  await import('./v5-caustic-handoff.js');
} catch (err) {
  console.error('[Fluid V5 caustic handoff] legacy receiver suppression failed.', err);
}

// Reorganize all live controls after their modules have mounted.
try {
  await import('./v5-tabs-m28.js');
} catch (err) {
  console.error('[Fluid V5 UI] tabbed control shell failed; original controls remain available.', err);
}

window.__fluidV5Version = '5.0.8-m2';
const brand = document.querySelector('.hud.card.title');
if (brand) brand.textContent = 'FLUID V5 · M2.8';
const stats = document.getElementById('v4stats');
if (stats && !stats.textContent.includes('BUILD:')) stats.textContent = `BUILD: ATOMIC HANDOFF · FULL FLOOR · ${stats.textContent}`;

setTimeout(() => {
  const toggle = document.getElementById('v4WaveToggle');
  const want = window.__v5State?.scenario === 'wave';
  if (toggle && toggle.classList.contains('active') !== want) toggle.click();
}, 420);

console.info(`[Fluid V5] ${V5_BUILD} / ${window.__fluidV5Version} isolated lab enabled; production V4.4 remains untouched.`);
