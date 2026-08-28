// Fluid V5 bootstrap. The HTML shell is inherited from V4.4, so mark the build immediately,
// then wait for the validated V4.4 renderer to expose its runtime handles before mounting V5.
// This prevents the V5 lab from racing the separate pool-realism module on mobile browsers.

const V5_BUILD = 'M2.2 LIVE-ATOMIC';
document.title = `Fluid V5 · ${V5_BUILD}`;
const earlyBrand = document.querySelector('.hud.card.title');
if (earlyBrand) earlyBrand.textContent = 'FLUID V5 · M2.2';
const earlyLoadTitle = document.querySelector('#loading h2');
if (earlyLoadTitle) earlyLoadTitle.textContent = 'FLUID V5 · M2.2';
const earlyStats = document.getElementById('v4stats');
if (earlyStats) earlyStats.textContent = 'BUILD: LIVE-ATOMIC · waiting for V4.4 core…';
window.__fluidV5Version = '5.0.2-m2-booting';
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

// M1 originally coupled projected caustics and its first spray renderer in one module. If that
// extension was rejected by a mobile adapter, recover the atomic caustic system independently
// before mounting M2. The fallback traces the complete pool floor and uses conservative WGSL.
if (!window.__v5ProjectedCaustics?.texture) {
  try {
    await import('./v5-atomic-safe.js');
  } catch (err) {
    console.error('[Fluid V5 atomic] independent fallback rejected; V4.4 receiver caustics remain active.', err);
  }
}

// Milestone 2 is deliberately optional at boot. The safety loader preserves the immutable M2
// checkpoint while applying mobile/WebGPU synchronization fixes before evaluating it. If any
// experimental M2 subsystem is rejected, Milestone 1 and the validated V4.4 renderer survive.
try {
  await import('./v5-m2-safe.js');
} catch (err) {
  console.error('[Fluid V5 M2] milestone 2 module failed; retained M1/V4.4 stack.', err);
}

window.__fluidV5Version = window.__v5M2?.version || '5.0.2-m2';
const brand = document.querySelector('.hud.card.title');
if (brand) brand.textContent = 'FLUID V5 · M2.2';
const stats = document.getElementById('v4stats');
if (stats && !stats.textContent.includes('BUILD:')) stats.textContent = `BUILD: LIVE-ATOMIC · ${stats.textContent}`;

setTimeout(() => {
  const toggle = document.getElementById('v4WaveToggle');
  const want = window.__v5State?.scenario === 'wave';
  if (toggle && toggle.classList.contains('active') !== want) toggle.click();
}, 420);

console.info(`[Fluid V5] ${V5_BUILD} / ${window.__fluidV5Version} isolated lab enabled; production V4.4 remains untouched.`);
