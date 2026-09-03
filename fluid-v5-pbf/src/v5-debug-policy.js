// Fluid V5 M2.6 safe developer-view policy.
// Developer visualizations are intentionally session-only. A stale CAUSTICS/ATOMIC selection
// must never replace the final renderer after a reload on mobile.

const sim = window.__sim;
const ui = window.__ui;
const ssfr = window.__ssfr;
const state = window.__v5State;
if (!sim || !ui || !ssfr || !state) throw new Error('Fluid V5 debug policy: runtime unavailable.');

// Always return to the normal renderer on a fresh build/reload.
state.debug = 'final';
window.__v5DebugMode = 'final';
ssfr.debug = 0;
ui.display = 3;
try {
  const key = 'fluidV5LabStateV1';
  const saved = JSON.parse(localStorage.getItem(key) || 'null');
  if (saved && typeof saved === 'object') {
    saved.debug = 'final';
    localStorage.setItem(key, JSON.stringify(saved));
  }
} catch {}

// Install after the atomic/M2 render wrappers. CAUSTICS becomes a normal-scene diagnostic:
// temporarily treat it as FINAL for the underlying renderer but raise projected-light strength.
// Only the explicit ATOMIC view is allowed to clear the frame and show the raw accumulation map.
const baseRender = ssfr.render;
ssfr.render = function(...args) {
  const requested = window.__v5DebugMode;
  if (requested !== 'caustics') return baseRender.apply(this, args);

  const originalMode = requested;
  const originalStrength = state.projected;
  window.__v5DebugMode = 'final';
  state.projected = Math.max(originalStrength, 1.0);
  try {
    return baseRender.apply(this, args);
  } finally {
    state.projected = originalStrength;
    window.__v5DebugMode = originalMode;
  }
};

window.__v5DebugPolicy = {
  version: 'M2.6',
  persistedViews: false,
  fullscreenAtomicOnly: true,
};
console.info('[Fluid V5 M2.6] safe developer-view policy enabled; startup view reset to FINAL.');
