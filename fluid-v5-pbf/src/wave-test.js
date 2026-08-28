// Fluid V5 bootstrap. The HTML shell is inherited from V4.4, so mark the build immediately,
// then wait for the validated V4.4 renderer to expose its runtime handles before mounting V5.

const V5_BUILD = 'M3.2 DISTINCTIVE LIGHT RIGS + COLORED CAUSTICS';
document.title = `Fluid V5 · ${V5_BUILD}`;
const earlyBrand = document.querySelector('.hud.card.title');
if (earlyBrand) earlyBrand.textContent = 'FLUID V5 · M3.2';
const earlyLoadTitle = document.querySelector('#loading h2');
if (earlyLoadTitle) earlyLoadTitle.textContent = 'FLUID V5 · M3.2';
const earlyStats = document.getElementById('v4stats');
if (earlyStats) earlyStats.textContent = 'BUILD: DISTINCTIVE LIGHT RIGS · COLORED CAUSTICS · waiting for V4.4 core…';
window.__fluidV5Version = '5.1.2-m32-booting';
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

// M3.2: presets now change real receiver light color/shape/falloff and environment balance.
// Sun/Spot/Point may drive atomic caustics; Underwater/Skylight remain direct or ambient sources.
let lightLabReady = false;
try {
  await import('./v5-light-lab.js');
  lightLabReady = window.__v5LightLab?.version === 'M3.2';
} catch (err) {
  console.error('[Fluid V5 Light Lab] M3.2 lighting module failed; retaining the M3.0 sun path.', err);
}

// Keep the validated full-PBF-surface, atomic<u32> -> r32uint mobile backend. M3.2 adds
// per-preset caustic gain and emitter tint while retaining the local-density high-pass.
if (!window.__v5ProjectedCaustics?.online) {
  try {
    await import(lightLabReady ? './v5-atomic-multilight-m32.js' : './v5-atomic-contrast-m30.js');
  } catch (err) {
    const prev = window.__v5AtomicStatus || {};
    window.__v5AtomicStatus = {
      ...prev,
      online:false,
      stage:`rejected @ ${prev.stage || 'module'}`,
      backend:lightLabReady ? 'particle-multilight-m32' : 'particle-contrast',
      width:prev.width || 0,
      height:prev.height || 0,
      error:String(err?.message || err),
    };
    console.error('[Fluid V5 atomic] M3.2 caustic projector rejected; inherited receiver lighting remains active.', err);
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
// caustic control at minimum so the old camera-space estimate cannot overpower the atomic map.
try {
  await import('./v5-caustic-handoff.js');
} catch (err) {
  console.error('[Fluid V5 caustic handoff] legacy receiver suppression failed.', err);
}

// Reorganize all live controls after their modules have mounted.
try {
  await import('./v5-tabs-m32.js');
} catch (err) {
  console.error('[Fluid V5 UI] M3.2 tabbed control shell failed; original controls remain available.', err);
}

window.__fluidV5Version = '5.1.2-m32';
const brand = document.querySelector('.hud.card.title');
if (brand) brand.textContent = 'FLUID V5 · M3.2';
const stats = document.getElementById('v4stats');
if (stats && !stats.textContent.includes('BUILD:')) stats.textContent = `BUILD: DISTINCTIVE LIGHT RIGS · COLORED CAUSTICS · ${stats.textContent}`;

setTimeout(() => {
  const toggle = document.getElementById('v4WaveToggle');
  const want = window.__v5State?.scenario === 'wave';
  if (toggle && toggle.classList.contains('active') !== want) toggle.click();
}, 420);

console.info(`[Fluid V5] ${V5_BUILD} / ${window.__fluidV5Version} isolated lab enabled; production V4.4 remains untouched.`);
