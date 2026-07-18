// audio.js
// -----------------------------------------------------------------------------
// SWAP POINT: every sound here is synthesized on the fly with the Web Audio
// API — no files to source, license, or host. Swap any function's body for
// `new Audio('/sounds/whatever.mp3').play()` (or a buffer-based loader) to
// use real recorded/composed audio instead; the exported function
// signatures are the only contract the rest of the app relies on.
// -----------------------------------------------------------------------------

let ctx = null;
let masterGain = null;
let ambientNodes = null;
let muted = false;
const BASE_VOLUME = 0.6;

function ensureContext() {
  if (ctx) return ctx;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null; // unsupported browser — audio silently no-ops
  ctx = new AudioContextClass();
  masterGain = ctx.createGain();
  masterGain.gain.value = BASE_VOLUME;
  masterGain.connect(ctx.destination);
  return ctx;
}

/** Must be called from a user gesture (browsers block audio otherwise). */
function initAudio() {
  const c = ensureContext();
  if (!c) return;
  if (c.state === "suspended") c.resume();
}

function toggleMuted() {
  muted = !muted;
  if (masterGain) masterGain.gain.value = muted ? 0 : BASE_VOLUME;
  return muted;
}

function envelope(gainNode, attack, decay, peak, when) {
  const t = when;
  gainNode.gain.cancelScheduledValues(t);
  gainNode.gain.setValueAtTime(0, t);
  gainNode.gain.linearRampToValueAtTime(peak, t + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function noiseBuffer(duration) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function playShoot() {
  if (!ctx) return;
  const vol = 0.32;
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(900, t);
  osc.frequency.exponentialRampToValueAtTime(180, t + 0.12);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 2200;

  const gain = ctx.createGain();
  envelope(gain, 0.005, 0.12, vol, t);

  osc.connect(filter).connect(gain).connect(masterGain);
  osc.start(t);
  osc.stop(t + 0.16);
}

// A bright, resonant chime — distinct from playLoreChime's two-note tone so
// "I found a fragment" (crystal) and "I learned something" (proximity lore)
// stay easy to tell apart by ear alone.
function playShatter() {
  if (!ctx) return;
  const t = ctx.currentTime;

  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(0.12);
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = "highpass";
  noiseFilter.frequency.value = 1800;
  const noiseGain = ctx.createGain();
  envelope(noiseGain, 0.001, 0.1, 0.22, t);
  source.connect(noiseFilter).connect(noiseGain).connect(masterGain);
  source.start(t);

  [880, 1318.5, 1760].forEach((freq, i) => {
    const start = t + i * 0.045;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    envelope(gain, 0.004, 0.35, 0.16, start);
    osc.connect(gain).connect(masterGain);
    osc.start(start);
    osc.stop(start + 0.4);
  });
}

function playLoreChime() {
  if (!ctx) return;
  const t = ctx.currentTime;
  [660, 990].forEach((freq, i) => {
    const start = t + i * 0.1;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    envelope(gain, 0.01, 0.5, 0.14, start);
    osc.connect(gain).connect(masterGain);
    osc.start(start);
    osc.stop(start + 0.55);
  });
}

function startAmbient(biome) {
  stopAmbient();
  if (!ctx) return;
  ambientNodes = buildAmbientGraph(biome || "ember");
}

function stopAmbient() {
  if (!ambientNodes) return;
  const now = ctx ? ctx.currentTime : 0;
  // Fade out fast rather than an abrupt stop, then actually stop the
  // sources a moment later — an instant node.stop() on a live oscillator
  // is an audible click.
  for (const node of ambientNodes.stopOnSwitch) {
    try {
      if (node.gain) node.gain.gain.linearRampToValueAtTime(0.0001, now + 0.15);
      if (node.stop) node.stop(now + 0.2);
    } catch (_) { /* already stopped — ignore */ }
  }
  if (ambientNodes.intervalId) clearInterval(ambientNodes.intervalId);
  ambientNodes = null;
}

// One graph per biome, each with its own character rather than a shared
// drone recolored — matches the same "distinct per biome, not a palette
// swap" approach used throughout the visual systems.
function buildAmbientGraph(biome) {
  const stopOnSwitch = []; // anything that needs an explicit stop()/fade when switching biomes
  let intervalId = null;

  function drone(freq, type, gainVal) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = gainVal;
    osc.connect(gain).connect(masterGain);
    osc.start();
    stopOnSwitch.push(osc, gain);
    return { osc, gain };
  }

  function lfoModulate(target, freq, depth) {
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = freq;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = depth;
    lfo.connect(lfoGain);
    lfoGain.connect(target);
    lfo.start();
    stopOnSwitch.push(lfo, lfoGain);
  }

  // Continuous filtered-noise bed — the "wind"/"flow" texture several
  // biomes share, just with different filter tuning and gust modulation.
  function noiseBed(filterType, filterFreq, q, gainVal, gustFreq, gustDepth) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(4);
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    if (q) filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = gainVal;
    source.connect(filter).connect(gain).connect(masterGain);
    source.start();
    stopOnSwitch.push(source, gain);
    if (gustFreq) lfoModulate(gain.gain, gustFreq, gustDepth);
    return { source, filter, gain };
  }

  if (biome === "ember") {
    drone(42, "sawtooth", 0.03);
    drone(84, "sine", 0.015);
    noiseBed("lowpass", 400, 0.7, 0.02, 0.08, 0.008); // low rumble, slow swell
    // Random crackle/pop bursts — lava spitting.
    intervalId = setInterval(() => {
      if (Math.random() < 0.5) playCrackle();
    }, 1800);
  } else if (biome === "verdant") {
    drone(60, "sine", 0.02);
    noiseBed("bandpass", 900, 0.5, 0.03, 0.15, 0.012); // wind through foliage, gustier
    noiseBed("bandpass", 2200, 1.2, 0.008, 0.3, 0.004); // thin high shimmer — water/leaves
  } else if (biome === "crystal") {
    drone(50, "sine", 0.018);
    noiseBed("highpass", 3000, 0.8, 0.006, 0.06, 0.004);
    // Sparse resonant chime pings — crystals settling.
    intervalId = setInterval(() => {
      if (Math.random() < 0.4) playCrystalPing();
    }, 3500);
  } else if (biome === "abyssal") {
    drone(28, "sine", 0.035);
    drone(29.5, "sine", 0.02); // slightly detuned against the first — an uneasy beat frequency, not a clean chord
    noiseBed("lowpass", 200, 1.5, 0.015, 0.04, 0.006);
    // Occasional distant echoey rumble from the depths.
    intervalId = setInterval(() => {
      if (Math.random() < 0.35) playDeepRumble();
    }, 6000);
  } else { // ashen
    noiseBed("bandpass", 700, 0.4, 0.035, 0.22, 0.02); // gustier than any other biome — dry wind is the whole texture here
    drone(45, "sine", 0.012);
  }

  return { stopOnSwitch, intervalId };
}

function playCrackle() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(0.08);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1400 + Math.random() * 800;
  const gain = ctx.createGain();
  envelope(gain, 0.002, 0.06, 0.06, t);
  source.connect(filter).connect(gain).connect(masterGain);
  source.start(t);
}

function playCrystalPing() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const freq = 1600 + Math.random() * 900;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const gain = ctx.createGain();
  envelope(gain, 0.005, 0.9, 0.05, t);
  osc.connect(gain).connect(masterGain);
  osc.start(t);
  osc.stop(t + 1);
}

function playDeepRumble() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(1.2);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 90;
  const gain = ctx.createGain();
  envelope(gain, 0.3, 1.0, 0.05, t);
  source.connect(filter).connect(gain).connect(masterGain);
  source.start(t);
}

// Footsteps — short percussive hit, tuned per biome so the ground itself
// has a sound, not just a generic tap regardless of what you're standing
// on.
const FOOTSTEP_PROFILES = {
  ember: { filterType: "lowpass", freq: 900, q: 0.5, duration: 0.05, vol: 0.05 },     // dull, ashy
  verdant: { filterType: "lowpass", freq: 1400, q: 0.3, duration: 0.06, vol: 0.045 }, // soft, damp
  crystal: { filterType: "highpass", freq: 2600, q: 1.0, duration: 0.035, vol: 0.055 }, // sharp click
  abyssal: { filterType: "bandpass", freq: 500, q: 0.6, duration: 0.12, vol: 0.05 },  // hollow, echoey
  ashen: { filterType: "highpass", freq: 1800, q: 0.4, duration: 0.04, vol: 0.045 },  // dry crunch
};
function playFootstep(biome) {
  if (!ctx) return;
  const p = FOOTSTEP_PROFILES[biome] || FOOTSTEP_PROFILES.ember;
  const t = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(p.duration);
  const filter = ctx.createBiquadFilter();
  filter.type = p.filterType;
  filter.frequency.value = p.freq;
  filter.Q.value = p.q;
  const gain = ctx.createGain();
  envelope(gain, 0.002, p.duration, p.vol * (0.75 + Math.random() * 0.5), t); // slight random volume variance so footsteps don't sound mechanically identical
  source.connect(filter).connect(gain).connect(masterGain);
  source.start(t);
}

export { initAudio, toggleMuted, playShoot, playShatter, playLoreChime, startAmbient, playFootstep };
