// audio.js
// -----------------------------------------------------------------------------
// SWAP POINT: most sounds here are synthesized on the fly with the Web Audio
// API — no files to source, license, or host for those. Ember's fire
// ambience and volcano eruption are the exception: real recorded audio
// files (see SOUND_FILES below), loaded async and with a synthesized
// fallback for anything not yet decoded. To swap any of the still-
// synthesized sounds for a file the same way, replace its body with a
// buffer-based loader (see loadSoundBuffer) or `new Audio(...).play()`;
// the exported function signatures are the only contract the rest of the
// app relies on.
// -----------------------------------------------------------------------------

import { LANDMARK_POSITION } from "./landmarks.js";

let ctx = null;
let masterGain = null;
let ambientNodes = null;
let muted = false;
const BASE_VOLUME = 0.6;

// -----------------------------------------------------------------------------
// Real recorded audio, used for Ember's fire ambience and volcano eruption —
// everything else in this file stays synthesized. Files live in rift/sounds/
// alongside this module. Loading is async (fetch + decodeAudioData), so
// every use site below checks whether the buffer has actually finished
// decoding yet and falls back to the synthesized version if not — the
// files are small enough that on any reasonable connection they're ready
// well before the player has picked a level, but this guarantees there's
// never dead silence while waiting.
// -----------------------------------------------------------------------------
const SOUND_BASE_URL = new URL("sounds/", import.meta.url);
const SOUND_FILES = {
  fireLoop: "fire-crackle-loop.mp3",      // positional — loudest near an actual fire, see updateFirePosition below
  eruptionRumble: "eruption-rumble.mp3",  // always playing at a quiet baseline, boosted while an eruption is active
  eruptionBurst: "eruption-burst.mp3",    // one-shot, fired once when an eruption starts
};
const soundBuffers = {}; // key -> decoded AudioBuffer, once ready
const soundLoadPromises = {}; // key -> in-flight/settled Promise<AudioBuffer|null>, so repeated calls share one fetch

// Returns a Promise resolving to the decoded AudioBuffer, or null if it
// failed to load/decode. Safe to call repeatedly — the first call kicks
// off the fetch, every later call (before or after it settles) gets the
// same cached Promise rather than re-fetching.
function loadSoundBuffer(key) {
  if (soundBuffers[key]) return Promise.resolve(soundBuffers[key]);
  if (soundLoadPromises[key]) return soundLoadPromises[key];
  if (!ctx) return Promise.resolve(null);
  const url = new URL(encodeURIComponent(SOUND_FILES[key]), SOUND_BASE_URL);
  soundLoadPromises[key] = fetch(url)
    .then((res) => res.arrayBuffer())
    .then((arr) => ctx.decodeAudioData(arr))
    .then((buffer) => { soundBuffers[key] = buffer; return buffer; })
    .catch((err) => {
      // Missing/blocked file, bad path, decode failure, etc. Whoever
      // called this handles a null result — there's no synthesized
      // fallback anymore (removed per an earlier request that Ember play
      // only the uploaded recordings), so a failed load here just means
      // that sound stays silent rather than something else standing in.
      console.warn(`Rift audio: couldn't load ${SOUND_FILES[key]}.`, err);
      return null;
    });
  return soundLoadPromises[key];
}

function preloadRealSounds() {
  loadSoundBuffer("fireLoop");
  loadSoundBuffer("eruptionRumble");
  loadSoundBuffer("eruptionBurst");
}

// Ember-only state, both reset in stopAmbient() when leaving the biome so
// they never point at disposed/stale nodes:
// - eruptionRumbleGain: the persistent gain node feeding the always-on
//   rumble loop — setEruptionIntensity ramps this up/down rather than
//   starting/stopping the source itself, since the rumble is never fully
//   silent anymore.
// - fireCracklePanner: the PannerNode carrying the fire-crackle loop,
//   repositioned every frame (from main.js, via updateFirePosition) to
//   whichever fire is currently nearest the player.
let eruptionRumbleGain = null;
let fireCracklePanner = null;

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
  preloadRealSounds();
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
  eruptionRumbleGain = null;
  fireCracklePanner = null;
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
  // Built up front (not just at the return statement) so the async
  // .then() callbacks in the ember branch below can close over THIS
  // exact object and check `ambientNodes !== handle` once their sound
  // finishes loading — biome-switching away before that happens is a
  // real possibility (loads take a moment), and without this check a
  // late-arriving sound would attach itself to a graph nobody's using
  // anymore.
  const handle = { stopOnSwitch: [], intervalId: null };
  const stopOnSwitch = handle.stopOnSwitch;

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
    // Ember plays ONLY the real recordings — no synthesized fallback
    // texture layered underneath (an earlier version's synthesized
    // crackle interval running "regardless" of the real recording read
    // as an unwanted mechanical chugging, not an enhancement). Both
    // sounds attach themselves via loadSoundBuffer's Promise rather than
    // a synchronous check here — loading takes real time (network +
    // decode), so checking `soundBuffers.fireLoop` just once at this
    // exact moment would very often find it not ready yet and then never
    // try again for the rest of the level. Attaching on the Promise
    // instead means the sound starts the instant it's actually decoded,
    // whether that's before this function even returns or several
    // seconds later.
    loadSoundBuffer("fireLoop").then((buffer) => {
      if (!buffer || ambientNodes !== handle) return;
      // Positional — repositioned every frame (main.js calls
      // updateFirePosition with whichever fire is currently nearest the
      // player) so this is audibly louder standing next to an actual
      // fire and fades with real distance via the PannerNode's own
      // rolloff model, not a flat always-the-same-volume loop.
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0.7; // feeds the panner's distance falloff, not the final loudness by itself — worth a by-ear pass once live
      const panner = ctx.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 4; // full volume within ~4 units of a fire
      panner.maxDistance = 45; // effectively inaudible past this
      panner.rolloffFactor = 1.4;
      source.connect(gain).connect(panner).connect(masterGain);
      source.start();
      stopOnSwitch.push(source, gain);
      fireCracklePanner = panner;
    });

    loadSoundBuffer("eruptionRumble").then((buffer) => {
      if (!buffer || ambientNodes !== handle) return;
      // Positioned once at the volcano's own location (it doesn't move,
      // unlike the fire panner which retargets every frame) — genuinely
      // louder approaching the volcano via the PannerNode's own distance
      // model, not a flat everywhere-the-same volume. Baseline vs.
      // eruption-active gain (set below) still controls how loud it gets
      // AT the volcano; setEruptionIntensity pushes that up further while
      // an eruption is actually active, rather than starting the sound
      // from nothing.
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0.65; // even louder AT the volcano itself, per explicit follow-up request — worth a further by-ear pass once live
      const panner = ctx.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 18; // the volcano is a massive landmark — should start attenuating much further out than a small ground fire
      panner.maxDistance = 220; // covers the whole playable radius (~112) with real falloff room beyond it
      panner.rolloffFactor = 1.1;
      if (panner.positionX) {
        panner.positionX.value = LANDMARK_POSITION.x;
        panner.positionY.value = 0;
        panner.positionZ.value = LANDMARK_POSITION.z;
      } else if (panner.setPosition) {
        panner.setPosition(LANDMARK_POSITION.x, 0, LANDMARK_POSITION.z);
      }
      source.connect(gain).connect(panner).connect(masterGain);
      source.start();
      stopOnSwitch.push(source, gain);
      eruptionRumbleGain = gain;
    });
  } else if (biome === "verdant") {
    drone(60, "sine", 0.02);
    noiseBed("bandpass", 900, 0.5, 0.03, 0.15, 0.012); // wind through foliage, gustier
    noiseBed("bandpass", 2200, 1.2, 0.008, 0.3, 0.004); // thin high shimmer — water/leaves
    // Ambient calls — a living forest, not just wind through leaves.
    // Birds during the day, a genuinely different set of night creatures
    // once it's actually dark, not the same birds just quieter.
    handle.intervalId = setInterval(() => {
      if (Math.random() < 0.55) {
        if (currentDayAmount > 0.3) playBirdChirp();
        else playNightCreature();
      }
    }, 2200);
  } else if (biome === "crystal") {
    drone(50, "sine", 0.018);
    noiseBed("highpass", 3000, 0.8, 0.006, 0.06, 0.004);
    // Sparse resonant chime pings — crystals settling.
    handle.intervalId = setInterval(() => {
      if (Math.random() < 0.4) playCrystalPing();
    }, 3500);
  } else if (biome === "abyssal") {
    drone(28, "sine", 0.035);
    drone(29.5, "sine", 0.02); // slightly detuned against the first — an uneasy beat frequency, not a clean chord
    noiseBed("lowpass", 200, 1.5, 0.015, 0.04, 0.006);
    // Occasional distant echoey rumble from the depths.
    handle.intervalId = setInterval(() => {
      if (Math.random() < 0.35) playDeepRumble();
    }, 6000);
  } else { // ashen
    noiseBed("bandpass", 700, 0.4, 0.035, 0.22, 0.02); // gustier than any other biome — dry wind is the whole texture here
    drone(45, "sine", 0.012);
  }

  return handle;
}

// Ramps the (silent-until-now) eruption rumble bed up or down — called
// from main.js whenever the volcano's own erupting flag changes, not
// every frame, so the ramp isn't repeatedly cancelled/restarted. Ramps in
// fast (an eruption starts abruptly) and fades out slower (the rumble
// lingers a bit as things settle).
function setEruptionIntensity(active) {
  if (!eruptionRumbleGain || !ctx) return;
  const now = ctx.currentTime;
  const gainParam = eruptionRumbleGain.gain;
  gainParam.cancelScheduledValues(now);
  gainParam.setValueAtTime(gainParam.value, now);
  // 0.8 during an eruption vs. the 0.4 loud-baseline set where this gain
  // node is created — ramps in fast (an eruption starts abruptly) and
  // back down slower (the rumble lingers as things settle), never all
  // the way to silent either way.
  gainParam.linearRampToValueAtTime(active ? 1.1 : 0.65, now + (active ? 1.2 : 2.5));
}

// Repositions the fire-crackle PannerNode — called every frame from
// main.js with whichever fire is currently nearest the player. No-ops if
// there's no active panner (non-Ember biome, or the recording hasn't
// loaded yet).
function updateFirePosition(x, y, z) {
  if (!fireCracklePanner || !ctx) return;
  const now = ctx.currentTime;
  if (fireCracklePanner.positionX) {
    fireCracklePanner.positionX.setValueAtTime(x, now);
    fireCracklePanner.positionY.setValueAtTime(y, now);
    fireCracklePanner.positionZ.setValueAtTime(z, now);
  } else if (fireCracklePanner.setPosition) {
    fireCracklePanner.setPosition(x, y, z); // older browsers without the AudioParam-based positioning API
  }
}

// Keeps the AudioListener (the "ears" all positional audio is measured
// against) matched to the camera every frame — called from main.js
// regardless of biome, harmless when nothing positional is currently
// playing.
function updateListenerPosition(x, y, z, forwardX, forwardY, forwardZ) {
  if (!ctx) return;
  const listener = ctx.listener;
  const now = ctx.currentTime;
  if (listener.positionX) {
    listener.positionX.setValueAtTime(x, now);
    listener.positionY.setValueAtTime(y, now);
    listener.positionZ.setValueAtTime(z, now);
    listener.forwardX.setValueAtTime(forwardX, now);
    listener.forwardY.setValueAtTime(forwardY, now);
    listener.forwardZ.setValueAtTime(forwardZ, now);
    listener.upX.setValueAtTime(0, now);
    listener.upY.setValueAtTime(1, now);
    listener.upZ.setValueAtTime(0, now);
  } else if (listener.setPosition) {
    listener.setPosition(x, y, z);
    if (listener.setOrientation) listener.setOrientation(forwardX, forwardY, forwardZ, 0, 1, 0);
  }
}

// One-shot impact — the real cannon-round recording when loaded, fired
// once on the RISING edge of an eruption (main.js detects the
// transition). Falls back to a synthesized deep boom + whoosh otherwise.
function playEruptionBurst() {
  if (!ctx || !soundBuffers.eruptionBurst) return;
  const t = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = soundBuffers.eruptionBurst;
  const gain = ctx.createGain();
  gain.gain.value = 0.5; // rough level, worth a by-ear pass once live
  source.connect(gain).connect(masterGain);
  source.start(t);
}

// Updated every frame from main.js — lets setInterval-based ambient
// callbacks (which fire independently of the render loop) know whether
// it's currently day or night when they go off, without needing a full
// per-frame audio update loop of their own.
let currentDayAmount = 1;
function setAmbientDayAmount(dayAmount) {
  currentDayAmount = dayAmount;
}

// Low croaks and rhythmic cricket-like ticks — insects/frogs waking up
// once the birds go quiet, genuinely different in character (lower,
// more percussive, less melodic) from the bright warbling bird call
// rather than just a quieter version of the same sound.
function playNightCreature() {
  if (!ctx) return;
  const t = ctx.currentTime;
  if (Math.random() < 0.5) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180 + Math.random() * 40, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.12);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 500;
    const gain = ctx.createGain();
    envelope(gain, 0.01, 0.14, 0.05, t);
    osc.connect(filter).connect(gain).connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.2);
  } else {
    const ticks = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < ticks; i++) {
      const start = t + i * 0.09;
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 3800 + Math.random() * 400;
      const gain = ctx.createGain();
      envelope(gain, 0.002, 0.02, 0.01, start);
      osc.connect(gain).connect(masterGain);
      osc.start(start);
      osc.stop(start + 0.04);
    }
  }
}

// A short 2-4 note trill with a real upward-then-down pitch warble per
// note (not a flat tone — a flat tone reads as a beep, not a bird call),
// randomized base pitch so successive calls don't sound identical.
function playBirdChirp() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const chirps = 2 + Math.floor(Math.random() * 3);
  const baseFreq = 1800 + Math.random() * 1400;
  for (let i = 0; i < chirps; i++) {
    const start = t + i * (0.09 + Math.random() * 0.05);
    const f = baseFreq * (0.9 + Math.random() * 0.25);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(f, start);
    osc.frequency.exponentialRampToValueAtTime(f * (1.3 + Math.random() * 0.4), start + 0.05);
    osc.frequency.exponentialRampToValueAtTime(f * 0.85, start + 0.1);
    const gain = ctx.createGain();
    envelope(gain, 0.008, 0.09, 0.045, start);
    osc.connect(gain).connect(masterGain);
    osc.start(start);
    osc.stop(start + 0.15);
  }
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

export { initAudio, toggleMuted, playShoot, playShatter, playLoreChime, startAmbient, playFootstep, setEruptionIntensity, playEruptionBurst, updateFirePosition, updateListenerPosition, setAmbientDayAmount };
