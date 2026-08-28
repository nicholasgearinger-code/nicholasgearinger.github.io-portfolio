// Fluid V5 M2.8 caustic handoff.
// V4.4's receiver-space caustic solver remains in the inherited composite, but V5 now owns the
// visible floor-caustic presentation. Force the legacy strength to its minimum every frame and
// disable its UI slider so it cannot overpower the full-surface atomic map.

const ssfr = window.__ssfr;
const state = window.__v5State;
if (!ssfr || !state) throw new Error('Fluid V5 M2.8 handoff: runtime unavailable.');

function quietLegacyControl() {
  const wrap = document.getElementById('v4LiveWaterTune');
  if (!wrap) return;
  for (const row of wrap.querySelectorAll('.v4TuneRow')) {
    const label = row.querySelector('label');
    if ((label?.textContent || '').trim() !== 'CAUSTICS') continue;
    const input = row.querySelector('input[type="range"]');
    const out = row.querySelector('.v4TuneVal');
    if (label) label.textContent = 'LEGACY';
    if (input) {
      input.value = '0';
      input.disabled = true;
      input.setAttribute('aria-label', 'Legacy V4 caustics disabled in V5');
    }
    if (out) out.textContent = 'V5';
    row.title = 'V5 uses the full-surface atomic caustic projector instead of the legacy receiver-space caustic gain.';
    break;
  }
}

// Keep the inherited receiver solver at its minimum gain even if an old saved V4 look attempts
// to restore a larger groundReflection value after another light slider changes.
const baseRender = ssfr.render;
ssfr.render = function(...args) {
  this.groundReflection = 0.0;
  return baseRender.apply(this, args);
};
ssfr.groundReflection = 0.0;

const upstream = document.getElementById('groundrefl');
if (upstream) upstream.value = '0';

// Give the primary V5 projector enough presence to be visible beside the inherited pool material,
// but preserve any stronger value the user has intentionally selected.
if (state.projected < 0.58) state.projected = 0.58;

quietLegacyControl();
setTimeout(quietLegacyControl, 180);
setTimeout(quietLegacyControl, 650);

window.__v5CausticHandoff = {
  version: 'M2.8',
  primary: 'atomic-full-surface',
  legacyGroundReflection: 0,
};
console.info('[Fluid V5 M2.8] atomic caustics are now the primary floor-lighting path.');