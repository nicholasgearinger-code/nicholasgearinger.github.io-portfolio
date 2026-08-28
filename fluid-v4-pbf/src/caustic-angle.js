// Fluid V4.3.2 caustic light-direction controls.
// Exposes both solar elevation and azimuth so the refracted-light network can be aimed at the
// floor and rotated around the pool without changing the water simulation or caustic solver.

const STORAGE_KEY = 'fluidV4CausticDirectionV1';
const DEFAULT = { elevation: 56, azimuth: 40 };
let direction = { ...DEFAULT };
let hadSaved = false;

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (saved && typeof saved === 'object') {
    const elevation = Number(saved.elevation);
    const azimuth = Number(saved.azimuth);
    if (Number.isFinite(elevation)) direction.elevation = Math.min(78, Math.max(12, elevation));
    if (Number.isFinite(azimuth)) direction.azimuth = Math.min(180, Math.max(-180, azimuth));
    hadSaved = true;
  }
} catch {}

const save = () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(direction)); } catch {}
};

function setUpstream(id, value) {
  const el = document.getElementById(id);
  if (!el) return false;
  el.value = String(value);
  if (typeof el.oninput === 'function') el.oninput();
  else el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

function install() {
  const panel = document.getElementById('settingsPanel');
  const elevationInput = panel?.querySelector('input[aria-label="SUN ANGLE"]');
  if (!panel || !elevationInput) return false;
  if (document.getElementById('v4SunAzimuth')) return true;

  // First run of this version: move the sun noticeably higher so refracted rays land mainly on
  // the pool floor. Afterwards the user's chosen direction is persisted and never overwritten.
  if (!hadSaved) {
    elevationInput.value = String(DEFAULT.elevation);
    elevationInput.dispatchEvent(new Event('input', { bubbles: true }));
    direction.elevation = DEFAULT.elevation;
    direction.azimuth = DEFAULT.azimuth;
    setUpstream('sunazim', direction.azimuth);
    save();
  } else {
    elevationInput.value = String(direction.elevation);
    elevationInput.dispatchEvent(new Event('input', { bubbles: true }));
    setUpstream('sunazim', direction.azimuth);
  }

  const elevationRow = elevationInput.closest('.v4TuneRow');
  const row = document.createElement('div');
  row.className = 'v4TuneRow';
  row.id = 'v4SunAzimuth';

  const label = document.createElement('label');
  label.textContent = 'SUN AZIMUTH';
  label.setAttribute('for', 'v4SunAzimuthInput');

  const input = document.createElement('input');
  input.type = 'range';
  input.id = 'v4SunAzimuthInput';
  input.min = '-180';
  input.max = '180';
  input.step = '1';
  input.value = String(direction.azimuth);
  input.setAttribute('aria-label', 'SUN AZIMUTH');

  const out = document.createElement('div');
  out.className = 'v4TuneVal';
  out.textContent = `${Math.round(direction.azimuth)}°`;

  const updateAzimuth = () => {
    direction.azimuth = Math.min(180, Math.max(-180, Number(input.value) || 0));
    out.textContent = `${Math.round(direction.azimuth)}°`;
    setUpstream('sunazim', direction.azimuth);
    save();
  };
  input.addEventListener('input', updateAzimuth);
  input.addEventListener('change', updateAzimuth);
  row.append(label, input, out);

  if (elevationRow?.parentElement) elevationRow.after(row);
  else panel.appendChild(row);

  // Persist changes made through the existing elevation slider too.
  const captureElevation = () => {
    direction.elevation = Math.min(78, Math.max(12, Number(elevationInput.value) || DEFAULT.elevation));
    save();
  };
  elevationInput.addEventListener('input', captureElevation);
  elevationInput.addEventListener('change', captureElevation);

  // Add a one-tap reference-oriented direction preset without changing the optical strength.
  const buttons = panel.querySelector('.v4TuneButtons');
  if (buttons && !document.getElementById('v4FloorLight')) {
    buttons.style.gridTemplateColumns = 'repeat(3,1fr)';
    const button = document.createElement('button');
    button.id = 'v4FloorLight';
    button.className = 'v4TuneBtn';
    button.textContent = 'FLOOR LIGHT';
    button.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      direction = { ...DEFAULT };
      elevationInput.value = String(direction.elevation);
      elevationInput.dispatchEvent(new Event('input', { bubbles: true }));
      input.value = String(direction.azimuth);
      updateAzimuth();
      save();
    });
    buttons.appendChild(button);
  }

  const note = panel.querySelector('.v4TuneNote');
  if (note) note.textContent += ' FLOOR LIGHT aims the sun higher so caustics land mainly on the basin floor; SUN AZIMUTH rotates their direction around the pool.';

  const stats = document.getElementById('v4stats');
  if (stats && !stats.textContent.includes('aimable-sun')) stats.textContent += ' · aimable-sun';

  window.__fluidCausticDirection = direction;
  console.info(`[Fluid V4.3.2] caustic sun direction: elevation ${direction.elevation}°, azimuth ${direction.azimuth}°.`);
  return true;
}

function boot() {
  if (!install()) setTimeout(boot, 50);
}
boot();
