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
  startAmbient();
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

function startAmbient() {
  if (ambientNodes || !ctx) return;

  const drones = [55, 55 * 1.5, 55 * 2.01].map((freq) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = 0.02;
    osc.connect(gain).connect(masterGain);
    osc.start();
    return { osc, gain };
  });

  // Slow filter-less "breathing" via LFO-modulated gain on the middle drone,
  // so the ambience feels alive rather than a static hum.
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.05;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.008;
  lfo.connect(lfoGain);
  lfoGain.connect(drones[1].gain.gain);
  lfo.start();

  ambientNodes = { drones, lfo };
}

export { initAudio, toggleMuted, playShoot, playShatter, playLoreChime };
