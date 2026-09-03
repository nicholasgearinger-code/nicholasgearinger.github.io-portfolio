// Fluid V5 M7.3.4 — iOS-safe water/optics bootstrap.
// Avoid runtime Blob-module compilation on WebKit. The V4.4 realism module currently fetches
// V4.3 source, patches it as text, creates a Blob URL, then dynamic-imports that Blob. The
// physical PBF core does not need that indirection, so this compatibility path boots the proven
// V4.3 realtime-caustic renderer as ordinary HTTP modules and exposes a neutral realism state
// for the M7.3 settings controller.

await import('./pool-caustics-v3.js');
await import('./caustic-angle.js');

const STORAGE_KEY = 'fluidV44RealismLabV1';
const realism = {
  micro: 0,
  volume: 0,
  dispersion: 0,
  wet: 0,
  foam: 0,
  shadow: 0,
  scattering: 0,
  temporal: 0,
};
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  // Keep the saved values available for later restoration, but do not enable effects that are
  // not part of this no-Blob renderer. This bootstrap is deliberately about stability first.
  if (saved && typeof saved === 'object') window.__fluidV44SavedRealism = saved;
} catch {}

window.__fluidV44Realism = realism;
window.__fluidV44RealismMode = 'V4.3 HTTP fallback · no Blob modules';
const stats = document.getElementById('v4stats');
if (stats && !stats.textContent.includes('no-blob')) stats.textContent += ' · no-blob';
console.info('[Fluid V5 M7.3.4] iOS-safe V4.3 optics active; Blob-module realism path bypassed.');
