// Fluid V4.3 continuous-wave test harness.
// This does not animate the renderer. It injects small, broad GPU velocity impulses into the
// real PBF particles along one short pool wall so travelling/reflected waves continuously
// exercise the realtime caustic solver.

const STORAGE_KEY = 'fluidV4ContinuousWavesV1';
const state = {
  enabled: false,
  power: 0.70,
};

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (saved && typeof saved === 'object') {
    state.enabled = saved.enabled === true;
    const p = Number(saved.power);
    if (Number.isFinite(p)) state.power = Math.min(1.40, Math.max(0.15, p));
  }
} catch {}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function installWaveUI() {
  const panel = document.getElementById('settingsPanel');
  if (!panel || document.getElementById('v4WaveTest')) return false;

  const style = document.createElement('style');
  style.textContent = `
    .v4WaveTest{margin-top:11px;padding-top:10px;border-top:1px solid rgba(78,214,220,.22)}
    .v4WaveHead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}
    .v4WaveTitle{font-size:10px;color:#86f6ff;letter-spacing:.11em;font-weight:800}
    .v4WaveBadge{font-size:8px;color:#82a6b2;letter-spacing:.06em}
    .v4WaveToggle{width:100%;appearance:none;border:1px solid rgba(78,214,220,.38);background:rgba(4,17,24,.78);color:#dffcff;border-radius:9px;padding:10px 7px;font:800 9px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.055em}
    .v4WaveToggle.active{border-color:#f1ad43;color:#ffd890;background:rgba(77,54,17,.48)}
    .v4WaveToggle:active{transform:scale(.985)}
    .v4WaveRow{display:grid;grid-template-columns:72px 1fr 38px;align-items:center;gap:7px;margin-top:8px}
    .v4WaveRow label{font-size:8.5px;color:#b6d1dc}
    .v4WaveRow input{width:100%;margin:0;accent-color:#69e8df;touch-action:pan-x;height:24px}
    .v4WaveVal{font-size:8px;text-align:right;color:#ffd890;font-variant-numeric:tabular-nums}
    .v4WaveNote{font-size:7.5px;color:#82a6b2;line-height:1.4;margin-top:6px}
    @media(max-width:600px){.v4WaveRow{grid-template-columns:62px 1fr 36px;gap:5px}.v4WaveRow label{font-size:8px}}
  `;
  document.head.appendChild(style);

  const wrap = document.createElement('div');
  wrap.id = 'v4WaveTest';
  wrap.className = 'v4WaveTest';
  wrap.innerHTML = `
    <div class="v4WaveHead"><div class="v4WaveTitle">CAUSTIC WAVE TEST</div><div id="v4WaveBadge" class="v4WaveBadge">PBF SOURCE</div></div>
    <button id="v4WaveToggle" class="v4WaveToggle" type="button"></button>
    <div class="v4WaveRow">
      <label for="v4WavePower">WAVE POWER</label>
      <input id="v4WavePower" type="range" min="0.15" max="1.40" step="0.05" value="${state.power}" aria-label="Continuous wave power">
      <div id="v4WavePowerVal" class="v4WaveVal"></div>
    </div>
    <div class="v4WaveNote">Broad physical waves are generated at one pool wall, then travel, reflect and interfere through the live PBF water. Caustics should move with those actual surface normals.</div>
  `;
  panel.appendChild(wrap);

  const toggle = document.getElementById('v4WaveToggle');
  const power = document.getElementById('v4WavePower');
  const powerVal = document.getElementById('v4WavePowerVal');
  const badge = document.getElementById('v4WaveBadge');

  const sync = () => {
    toggle.textContent = state.enabled ? 'CONTINUOUS WAVES: ON' : 'CONTINUOUS WAVES: OFF';
    toggle.classList.toggle('active', state.enabled);
    power.value = String(state.power);
    powerVal.textContent = state.power.toFixed(2);
    badge.textContent = state.enabled ? 'LIVE PBF ✓' : 'PBF SOURCE';
    badge.style.color = state.enabled ? '#9dffc8' : '#82a6b2';
  };

  toggle.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    state.enabled = !state.enabled;
    saveState();
    sync();
  });
  power.addEventListener('input', e => {
    e.stopPropagation();
    state.power = Math.min(1.40, Math.max(0.15, Number(power.value) || 0.70));
    saveState();
    sync();
  });
  power.addEventListener('change', e => e.stopPropagation());
  wrap.addEventListener('pointerdown', e => e.stopPropagation());
  wrap.addEventListener('click', e => e.stopPropagation());

  sync();
  return true;
}

function startWaveDriver() {
  const sim = window.__sim;
  const ui = window.__ui;
  if (!sim?.applyRayImpulse || !sim?.params?.box) return false;

  let start = performance.now();
  let lastPulse = 0;

  const tick = now => {
    requestAnimationFrame(tick);
    if (!state.enabled || document.hidden || ui?.paused) {
      start = now;
      lastPulse = now;
      return;
    }

    // ~12.5 Hz forcing keeps GPU overhead small. Each pulse is solved by the upstream GPU
    // impulse compute shader and then propagated normally by PBF on subsequent simulation steps.
    if (now - lastPulse < 80) return;
    lastPulse = now;

    const box = sim.params?.box;
    if (!box || box.length < 3) return;

    const t = Math.max(0, (now - start) * 0.001);
    const hz = 0.72;
    const phase = t * Math.PI * 2 * hz;
    const primary = Math.sin(phase);
    const secondary = Math.sin(phase * 1.67 + 0.85) * 0.18;
    const drive = primary + secondary;
    const p = state.power;

    // Two overlapping vertical cylinders span most of the short wall. Their almost-identical
    // phase produces a broad crest instead of two obvious circular splash sources.
    const x = box[0] * 0.075;
    const y = box[1] * 0.96;
    const zA = box[2] * 0.32;
    const zB = box[2] * 0.68;
    const radius = Math.max(0.24, box[2] * 0.30);
    const speedLimit = 1.25 + p * 0.85;

    // Horizontal paddle motion drives the travelling wave. A smaller vertical component gives
    // the crest enough curvature for strong moving caustics without turning into repeated splashes.
    const push = 0.115 * p * drive;
    const lift = 0.038 * p * drive;
    const cross = 0.012 * p * Math.sin(phase * 0.73);

    sim.applyRayImpulse([x, y, zA], [0, -1, 0], [push, lift, cross], radius, speedLimit);
    sim.applyRayImpulse([x, y, zB], [0, -1, 0], [push, lift, -cross], radius, speedLimit);
  };

  requestAnimationFrame(tick);
  console.info('[Fluid V4.3] continuous physical wave-test driver ready.');
  return true;
}

function boot() {
  const uiReady = installWaveUI();
  const driverReady = startWaveDriver();
  if (uiReady && driverReady) return;
  setTimeout(boot, 60);
}

boot();
