// Fluid V5 bootstrap. The HTML shell is inherited from V4.4, so mark the build immediately,
// then wait for the validated V4.4 renderer to expose its runtime handles before mounting V5.

const V5_BUILD = 'M2.4 COPY-ATOMIC + TABS';
document.title = `Fluid V5 · ${V5_BUILD}`;
const earlyBrand = document.querySelector('.hud.card.title');
if (earlyBrand) earlyBrand.textContent = 'FLUID V5 · M2.4';
const earlyLoadTitle = document.querySelector('#loading h2');
if (earlyLoadTitle) earlyLoadTitle.textContent = 'FLUID V5 · M2.4';
const earlyStats = document.getElementById('v4stats');
if (earlyStats) earlyStats.textContent = 'BUILD: COPY-ATOMIC · TABBED UI · waiting for V4.4 core…';
window.__fluidV5Version = '5.0.4-m2-booting';
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

// M2.4 mobile path: preserve atomic<u32> compute accumulation, then copy the raw u32 grid into
// an r32uint sampled texture. This avoids storage textures and fragment-stage storage buffers.
if (!window.__v5ProjectedCaustics?.online) {
  try {
    await import('./v5-atomic-copy.js');
  } catch (err) {
    window.__v5AtomicStatus = {
      online:false, stage:'rejected', backend:'copy-texture', width:0, height:0,
      error:String(err?.message||err),
    };
    console.error('[Fluid V5 atomic] copy-texture fallback rejected; V4.4 receiver caustics remain active.', err);
  }
}

// Milestone 2 remains optional. If a drain/secondary/underwater experiment is rejected, the
// validated V4.4 renderer and V5 M1 controls remain usable.
try {
  await import('./v5-m2-safe.js');
} catch (err) {
  console.error('[Fluid V5 M2] milestone 2 module failed; retained M1/V4.4 stack.', err);
}

// Reorganize all live controls after their modules have mounted. Moving existing nodes preserves
// the original event handlers and stored state while giving mobile users a clean tabbed interface.
try {
  await import('./v5-tabs.js');
} catch (err) {
  console.error('[Fluid V5 UI] tabbed control shell failed; original controls remain available.', err);
}

window.__fluidV5Version = '5.0.4-m2';
const brand = document.querySelector('.hud.card.title');
if (brand) brand.textContent = 'FLUID V5 · M2.4';
const stats = document.getElementById('v4stats');
if (stats && !stats.textContent.includes('BUILD:')) stats.textContent = `BUILD: COPY-ATOMIC · TABS · ${stats.textContent}`;

setTimeout(() => {
  const toggle = document.getElementById('v4WaveToggle');
  const want = window.__v5State?.scenario === 'wave';
  if (toggle && toggle.classList.contains('active') !== want) toggle.click();
}, 420);

console.info(`[Fluid V5] ${V5_BUILD} / ${window.__fluidV5Version} isolated lab enabled; production V4.4 remains untouched.`);
