// Fluid V5 lab controller.
// Runs only on the isolated V5 branch. V4.4 remains the production fallback.

const sim = window.__sim;
const ui = window.__ui;
const cam = window.__cam;
const ssfr = window.__ssfr;
if (!sim || !ui || !cam || !ssfr) throw new Error('Fluid V5: V4.4 baseline did not initialize.');

const STORAGE_KEY = 'fluidV5LabStateV1';
const q = new URLSearchParams(location.search);
const coarse = matchMedia?.('(pointer: coarse)')?.matches ?? false;
const currentQuality = ['low','medium','high'].includes(q.get('quality')) ? q.get('quality') : 'medium';
const defaults = {
  autoQuality: false,
  scenario: 'pool',
  underwater: false,
  debug: 'final',
  spray: 0.62,
  projected: 0.44,
};
const state = { ...defaults };
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (saved && typeof saved === 'object') Object.assign(state, saved);
} catch {}
state.spray = Math.min(1.4, Math.max(0, Number(state.spray) || defaults.spray));
state.projected = Math.min(1.4, Math.max(0, Number(state.projected) || defaults.projected));
const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {} };
window.__v5State = state;
window.__v5DebugMode = state.debug;

// ----- V5 branding ---------------------------------------------------------
document.title = 'Fluid V5 · PBF Water Lab';
const brand = document.querySelector('.hud.card.title');
if (brand) brand.textContent = 'FLUID V5 · PBF WATER';
const loadTitle = document.querySelector('#loading h2');
if (loadTitle) loadTitle.textContent = 'FLUID V5 · PBF WATER';
const settingsTitle = document.querySelector('.settingsTitle');
if (settingsTitle) settingsTitle.textContent = 'FLUID V5 · SIMULATION LAB';

// ----- Helpers -------------------------------------------------------------
const restY = () => sim.params.box[1] * 0.28;
const stopEvent = e => { e.stopPropagation(); };
const updateQuery = (changes, reload = true) => {
  const next = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === undefined) next.delete(k); else next.set(k, String(v));
  }
  next.set('v5', '1');
  next.set('qv', String(Date.now()));
  if (reload) location.assign(location.pathname + '?' + next.toString() + location.hash);
};
const parseBody = () => {
  const raw = (q.get('body') || 'sphere:0.55:0.88').split(',')[0].split(':');
  return {
    shape: ['sphere','box','torus'].includes(raw[0]) ? raw[0] : 'sphere',
    density: Math.min(1.8, Math.max(0.2, Number(raw[1]) || 0.55)),
    startY: Math.min(0.95, Math.max(0.40, Number(raw[2]) || 0.88)),
  };
};
let bodyConfig = parseBody();

function setWaveTest(on) {
  const toggle = document.getElementById('v4WaveToggle');
  if (!toggle) return false;
  if (toggle.classList.contains('active') !== !!on) toggle.click();
  return true;
}
function resetScene() { document.getElementById('reset')?.click(); }

// ----- Physical scenarios --------------------------------------------------
let rainAdded = 0;
let lastRain = 0;
let lastDrain = 0;
let rainSeed = 0x4f31a2;
const rnd = () => {
  rainSeed = (Math.imul(rainSeed, 1664525) + 1013904223) >>> 0;
  return rainSeed / 4294967296;
};

function setScenario(name, doReset = true) {
  state.scenario = name;
  save();
  setWaveTest(name === 'wave');
  ui.pouring = false;
  rainAdded = 0;
  if (name === 'pour') {
    if (doReset) resetScene();
    ui.pourSpeed = 1.55;
    ui.pourWidth = Math.max(0.14, sim.params.box[2] * 0.16);
    ui.pourHeight = 0.86;
    ui.pourTilt = 18;
    ui.pouring = ui.pourLeft > 0;
  } else if (name === 'dam') {
    // buildScene() seeds the water as a compact block along one side. A reset therefore
    // creates a real PBF dam-break initial condition with no animated displacement map.
    resetScene();
    cam.az = -0.92; cam.el = 0.36; cam.dist = 4.0;
    cam.target = [sim.params.box[0] * 0.52, restY() * 0.82, sim.params.box[2] * 0.5];
  } else if (name === 'rain') {
    if (doReset) resetScene();
  } else if (name === 'drain') {
    if (doReset) resetScene();
  } else if (name === 'pool') {
    if (doReset) resetScene();
  }
  syncScenarioUI();
}

function driveRain(now) {
  if (state.scenario !== 'rain' || ui.paused || document.hidden) return;
  if (now - lastRain < 105 || rainAdded > Math.max(1200, sim.scene.nFluid * 0.18)) return;
  lastRain = now;
  const b = sim.params.box, d = sim.params.spacing;
  const count = currentQuality === 'low' ? 5 : currentQuality === 'high' ? 11 : 8;
  const pos = [], vel = [];
  for (let i = 0; i < count; i++) {
    const x = d * 2 + rnd() * (b[0] - d * 4);
    const z = d * 2 + rnd() * (b[2] - d * 4);
    const y = b[1] * (0.90 + rnd() * 0.055);
    pos.push(x, y, z);
    vel.push((rnd() - 0.5) * 0.10, -(1.65 + rnd() * 1.15), (rnd() - 0.5) * 0.10);
  }
  rainAdded += sim.appendFluid(pos, vel);
}

function driveDrain(now) {
  if (state.scenario !== 'drain' || ui.paused || document.hidden || now - lastDrain < 75) return;
  lastDrain = now;
  // V5 milestone 1 uses a real force sink/vortex. Particle deletion/compaction will replace
  // this in the dedicated drain milestone, but the motion itself is already solved by PBF.
  const b = sim.params.box;
  const x = b[0] * 0.52, z = b[2] * 0.52, y = b[1] * 0.34;
  const r = Math.max(0.18, b[2] * 0.20);
  sim.applyRayImpulse([x, y, z], [0, -1, 0], [0.08, -0.34, 0.18], r, 2.1);
  sim.applyRayImpulse([x, y, z], [0, -1, 0], [-0.18, -0.30, -0.08], r * 0.74, 2.1);
}

function scenarioLoop(now) {
  driveRain(now);
  driveDrain(now);
  requestAnimationFrame(scenarioLoop);
}
requestAnimationFrame(scenarioLoop);

// ----- Underwater camera ---------------------------------------------------
let savedCam = null;
function setUnderwater(on) {
  on = !!on;
  if (on === state.underwater && savedCam) return;
  state.underwater = on;
  save();
  if (on) {
    savedCam = { az: cam.az, el: cam.el, dist: cam.dist, target: [...cam.target] };
    const b = sim.params.box;
    cam.az = -0.54;
    cam.el = -0.17;
    cam.dist = Math.min(b[0], b[2]) * 0.55;
    cam.target = [b[0] * 0.52, restY() * 0.61, b[2] * 0.52];
  } else if (savedCam) {
    cam.az = savedCam.az; cam.el = savedCam.el; cam.dist = savedCam.dist; cam.target = [...savedCam.target];
    savedCam = null;
  }
  syncUnderwaterUI();
}

// ----- Developer visualization --------------------------------------------
function setDebug(mode) {
  state.debug = mode;
  window.__v5DebugMode = mode;
  save();
  ssfr.debug = 0;
  if (mode === 'particles') ui.display = 0;
  else if (mode === 'surface') ui.display = 1;
  else if (mode === 'velocity') { ui.display = 0; ui.speedMax = 4.0; }
  else {
    ui.display = 3;
    if (mode === 'normals') ssfr.debug = 1;
    if (mode === 'depth') ssfr.debug = 2;
    if (mode === 'thickness') ssfr.debug = 3;
    if (mode === 'rawdepth') ssfr.debug = 4;
  }
  syncDebugUI();
}

// ----- Adaptive quality ----------------------------------------------------
const AUTO_KEY = 'fluidV5AutoQualityV1';
try { if (localStorage.getItem(AUTO_KEY) === '1') state.autoQuality = true; } catch {}
const qualityOrder = ['low','medium','high'];
const targetFps = coarse ? 30 : 55;
let badFor = 0, goodFor = 0, lastAutoSample = performance.now();
function setAuto(on) {
  state.autoQuality = !!on;
  save();
  try { localStorage.setItem(AUTO_KEY, state.autoQuality ? '1' : '0'); } catch {}
  syncAutoUI();
}
function rebuildQuality(next) {
  if (!qualityOrder.includes(next) || next === currentQuality) return;
  updateQuery({ quality: next, v5auto: state.autoQuality ? 1 : 0 });
}
function autoLoop() {
  const now = performance.now();
  if (now - lastAutoSample < 1000) { setTimeout(autoLoop, 350); return; }
  const dt = Math.min(2, (now - lastAutoSample) / 1000);
  lastAutoSample = now;
  if (!state.autoQuality || ui.paused || document.hidden) { badFor = goodFor = 0; setTimeout(autoLoop, 500); return; }
  const m = (document.getElementById('v4fps')?.textContent || '').match(/([0-9.]+)/);
  const fps = m ? Number(m[1]) : 0;
  if (fps > 0 && fps < targetFps - 4) { badFor += dt; goodFor = 0; }
  else if (fps > targetFps + (coarse ? 9 : 8)) { goodFor += dt; badFor = 0; }
  else { badFor = Math.max(0, badFor - dt * 0.5); goodFor = Math.max(0, goodFor - dt * 0.5); }
  const idx = qualityOrder.indexOf(currentQuality);
  if (badFor >= 6 && idx > 0) rebuildQuality(qualityOrder[idx - 1]);
  if (goodFor >= 18 && idx < qualityOrder.length - 1 && (!coarse || idx < 1)) rebuildQuality(qualityOrder[idx + 1]);
  setTimeout(autoLoop, 500);
}
setTimeout(autoLoop, 1400);

// ----- UI ------------------------------------------------------------------
let scenarioButtons = [], debugButtons = [];
let autoBtn, underwaterBtn, shapeButtons = [], densityInput, densityVal, sprayInput, sprayVal, projInput, projVal;
function button(label, cls = 'v5Btn') {
  const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = label; return b;
}
function rowLabel(text) { const d = document.createElement('div'); d.className = 'v5SectionTitle'; d.textContent = text; return d; }

function installUI() {
  const panel = document.getElementById('settingsPanel');
  if (!panel || document.getElementById('v5Lab')) return false;
  const style = document.createElement('style');
  style.textContent = `
  #settingsPanel{max-height:min(76vh,620px);overflow:auto}.qualityRow{grid-template-columns:repeat(4,1fr)!important}
  .v5Lab{margin-top:11px;padding-top:10px;border-top:1px solid rgba(78,214,220,.28)}
  .v5Top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.v5Title{font-size:10px;color:#9dffc8;letter-spacing:.13em;font-weight:900}.v5Badge{font-size:7.5px;color:#7ee7ef}
  .v5SectionTitle{font-size:8px;letter-spacing:.10em;color:#91b6c3;margin:10px 0 5px}.v5Grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.v5Grid.four{grid-template-columns:repeat(4,1fr)}
  .v5Btn{appearance:none;border:1px solid rgba(78,214,220,.34);background:rgba(4,17,24,.78);color:#dffcff;border-radius:8px;padding:7px 3px;font:800 7.5px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.035em}.v5Btn.active{border-color:#f1ad43;color:#ffd890;background:rgba(77,54,17,.48)}
  .v5Wide{width:100%;margin-top:5px;padding:9px 5px;font-size:8px}.v5Slider{display:grid;grid-template-columns:68px 1fr 32px;align-items:center;gap:5px;margin-top:6px}.v5Slider label{font-size:7.5px;color:#b6d1dc}.v5Slider input{width:100%;accent-color:#69e8df}.v5Val{font-size:7.5px;text-align:right;color:#ffd890}.v5Note{font-size:7px;color:#7897a4;line-height:1.35;margin-top:6px}
  @media(max-width:600px){.v5Btn{font-size:7px;padding:7px 2px}.v5Grid{gap:4px}.v5Slider{grid-template-columns:60px 1fr 30px}}
  `;
  document.head.appendChild(style);
  const lab = document.createElement('div'); lab.id='v5Lab'; lab.className='v5Lab';
  lab.innerHTML = '<div class="v5Top"><div class="v5Title">V5 PHYSICS + RENDER LAB</div><div class="v5Badge">ISOLATED BUILD</div></div>';

  const autoRow = document.querySelector('.qualityRow');
  autoBtn = button('AUTO', 'qbtn'); autoBtn.id='v5AutoQuality';
  autoBtn.onclick = e => { e.preventDefault(); e.stopPropagation(); setAuto(!state.autoQuality); };
  autoRow?.appendChild(autoBtn);
  document.querySelectorAll('[data-quality]').forEach(b => b.addEventListener('click', () => setAuto(false), { capture:true }));

  lab.appendChild(rowLabel('SCENARIO'));
  const sg = document.createElement('div'); sg.className='v5Grid';
  for (const [key,label] of [['pool','POOL'],['wave','WAVE TANK'],['rain','RAIN'],['pour','POUR'],['dam','DAM BREAK'],['drain','DRAIN β']]) {
    const b=button(label); b.dataset.scenario=key; b.onclick=e=>{e.preventDefault();e.stopPropagation();setScenario(key,true)}; sg.appendChild(b); scenarioButtons.push(b);
  }
  lab.appendChild(sg);

  lab.appendChild(rowLabel('RIGID BODY · REAL TWO-WAY PBF'));
  const og=document.createElement('div');og.className='v5Grid';
  for(const [key,label] of [['sphere','SPHERE'],['box','CUBE'],['torus','TORUS']]){const b=button(label);b.dataset.shape=key;b.onclick=e=>{e.preventDefault();e.stopPropagation();bodyConfig.shape=key;applyBodyConfig()};og.appendChild(b);shapeButtons.push(b)}
  lab.appendChild(og);
  const dr=document.createElement('div');dr.className='v5Slider';dr.innerHTML='<label>BODY DENSITY</label><input id="v5Density" type="range" min="0.25" max="1.60" step="0.05"><div id="v5DensityVal" class="v5Val"></div>';lab.appendChild(dr);
  densityInput=dr.querySelector('input');densityVal=dr.querySelector('.v5Val');densityInput.value=bodyConfig.density;densityInput.oninput=e=>{e.stopPropagation();bodyConfig.density=Number(densityInput.value);syncBodyUI()};densityInput.onchange=e=>{e.stopPropagation();applyBodyConfig()};
  const objNote=document.createElement('div');objNote.className='v5Note';objNote.textContent='Density < 1 floats more strongly; ~1 is near neutral; > 1 sinks. Shape and density rebuild the same rigid-phase particles used by the fluid solver.';lab.appendChild(objNote);

  lab.appendChild(rowLabel('CAMERA + GPU EFFECTS'));
  underwaterBtn=button('UNDERWATER CAMERA','v5Btn v5Wide');underwaterBtn.onclick=e=>{e.preventDefault();e.stopPropagation();setUnderwater(!state.underwater)};lab.appendChild(underwaterBtn);
  const mkSlider=(label,id,min,max,step,value,oninput)=>{const r=document.createElement('div');r.className='v5Slider';r.innerHTML=`<label>${label}</label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"><div class="v5Val"></div>`;const inp=r.querySelector('input'),val=r.querySelector('.v5Val');inp.oninput=e=>{e.stopPropagation();oninput(Number(inp.value));val.textContent=Number(inp.value).toFixed(2)};val.textContent=Number(value).toFixed(2);lab.appendChild(r);return [inp,val]};
  [sprayInput,sprayVal]=mkSlider('SPRAY/FOAM','v5Spray',0,1.4,.05,state.spray,v=>{state.spray=v;save()});
  [projInput,projVal]=mkSlider('PROJECT CAUSTIC','v5Projected',0,1.4,.05,state.projected,v=>{state.projected=v;save()});

  lab.appendChild(rowLabel('DEVELOPER VIEW'));
  const dg=document.createElement('div');dg.className='v5Grid four';
  for(const [key,label] of [['final','FINAL'],['particles','PARTICLES'],['velocity','VELOCITY'],['surface','SURFACE'],['normals','NORMALS'],['depth','DEPTH'],['thickness','THICK'],['caustics','CAUSTICS']]){const b=button(label);b.dataset.debug=key;b.onclick=e=>{e.preventDefault();e.stopPropagation();setDebug(key)};dg.appendChild(b);debugButtons.push(b)}
  lab.appendChild(dg);
  const note=document.createElement('div');note.className='v5Note';note.textContent='Projected caustics and spray are separate V5 GPU passes. DRAIN β currently exercises a physical sink/vortex; true particle-removal compaction is the next drain milestone.';lab.appendChild(note);

  lab.addEventListener('pointerdown',stopEvent);lab.addEventListener('click',stopEvent);panel.appendChild(lab);
  syncAll();return true;
}
function applyBodyConfig(){updateQuery({body:`${bodyConfig.shape}:${bodyConfig.density.toFixed(2)}:${bodyConfig.startY.toFixed(2)}`})}
function syncBodyUI(){shapeButtons.forEach(b=>b.classList.toggle('active',b.dataset.shape===bodyConfig.shape));if(densityInput)densityInput.value=bodyConfig.density;if(densityVal)densityVal.textContent=bodyConfig.density.toFixed(2)+'ρ'}
function syncScenarioUI(){scenarioButtons.forEach(b=>b.classList.toggle('active',b.dataset.scenario===state.scenario))}
function syncDebugUI(){debugButtons.forEach(b=>b.classList.toggle('active',b.dataset.debug===state.debug))}
function syncUnderwaterUI(){if(underwaterBtn){underwaterBtn.classList.toggle('active',state.underwater);underwaterBtn.textContent=state.underwater?'UNDERWATER CAMERA: ON':'UNDERWATER CAMERA'}}
function syncAutoUI(){if(autoBtn){autoBtn.classList.toggle('active',state.autoQuality);autoBtn.textContent=state.autoQuality?'AUTO ✓':'AUTO'}const sb=document.getElementById('settingsBtn');if(sb&&state.autoQuality)sb.textContent=`AUTO: ${currentQuality.toUpperCase()}`}
function syncAll(){syncBodyUI();syncScenarioUI();syncDebugUI();syncUnderwaterUI();syncAutoUI()}

function bootUI(){if(!installUI())setTimeout(bootUI,70)}
bootUI();

// Restore non-destructive V5 state after all V4.4 UI modules have mounted.
setTimeout(()=>{
  if(state.scenario==='wave')setWaveTest(true);
  if(state.underwater){const wanted=state.underwater;state.underwater=false;setUnderwater(wanted)}
  setDebug(state.debug);
  syncAll();
},280);

try {
  await import('./v5-gpu-effects.js');
} catch (err) {
  console.error('[Fluid V5 GPU effects]', err);
  const note=document.querySelector('#v5Lab .v5Note');
  if(note)note.textContent='V5 GPU extension was rejected; V4.4 renderer remains active. '+(err?.message||err);
}

console.info('[Fluid V5] lab controller ready.');
