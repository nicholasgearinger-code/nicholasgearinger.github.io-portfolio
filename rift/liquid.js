import * as THREE from "three";
import { getGraphicsSettings } from "./graphicsSettings.js";

// Per real WebGPU error "[Buffer (unlabeled)] used in submit while
// destroyed" hit switching Ember -> Verdant — confirmed via a real
// devtools GPUValidationError, not guessed. Root cause: renderer.render()
// issues real GPU work (queue.submit()) that finishes ASYNCHRONOUSLY, off
// the JS thread — calling .dispose() on a geometry/material/texture
// SYNCHRONOUSLY in the same tick a level is torn down can destroy a
// buffer the GPU hasn't actually finished using yet from the previous
// frame's submission, which WebGPU validates strictly (WebGL silently
// tolerated the same eager disposal). This is a well-documented Three.js
// WebGPU migration issue, not something specific to this codebase — the
// Three.js community's own recommended mitigation is exactly this: defer
// the actual dispose() call past the current frame rather than doing it
// eagerly. scene.remove() itself is NOT deferred (stays synchronous, so
// nothing wrong ever gets drawn) — only the GPU-resource-freeing
// .dispose() calls are pushed past a frame boundary. Double-rAF (two
// frame boundaries, not one) for extra margin, since a single frame isn't
// guaranteed long enough for the GPU process to fully catch up.
function riftDeferDispose(disposeFn) {
  requestAnimationFrame(() => requestAnimationFrame(disposeFn));
}

// THREE.Water tried and removed three times (twice on this file's own
// near-water plane, once on a separate background "skirt" plane that
// used to extend the ocean out to the horizon) — a rigid flat reflective
// surface never reconciled with genuinely wave-displaced water sitting
// right below/at it. The separate background skirt itself is GONE now
// too (see GERSTNER_WAVES below) — per explicit "remove the skirt
// completely and merge the near Gerstner waves with the far ones"
// request, Coral Shallows is back to ONE continuous water plane again,
// just sized much larger than the landmass itself, with a single merged
// wave spectrum (near chop + far swell) driving the whole thing.

// -----------------------------------------------------------------------------
// SWAP POINT: lava/water rendering. A single large flat plane at a fixed
// height, per biome — simpler and far cheaper than carving actual liquid
// geometry into the terrain, and works because each biome's terrain
// shaping (terrain.js) was tuned so the plane's height only intersects the
// channel/cracks it's meant to fill (Ember's lava cracks, Verdant's river
// bed) rather than flooding the whole landmass. Per-vertex color (frothy
// white for water, glowing hot-spots for lava) is derived from the same
// ripple displacement already being computed for the geometry, not a
// second simulation — wherever the surface is most disturbed reads as
// whiter/brighter, which is what actually sells "liquid" instead of "flat
// tinted plane." Swap createLiquidPlane() for a shader-based version (real
// flow distortion) without touching terrain generation or placement.
// -----------------------------------------------------------------------------

const LIQUID_STYLE = {
  ember: {
    crustColor: new THREE.Color(0x1a0800), baseColor: new THREE.Color(0xdd2c00), hotColor: new THREE.Color(0xffd23f),
    emissive: 0xff5522, emissiveIntensity: 2.2, opacity: 0.96, roughness: 0.55,
    glowColor: 0xff8a1a, glowOpacity: 0.35,
  },
  verdant: {
    baseColor: new THREE.Color(0x0f4a78), frothColor: new THREE.Color(0xf2fbff),
    emissive: 0x2a8fd6, emissiveIntensity: 0.02, opacity: 0.78, roughness: 0.1, // pushed down further (was 0.06, originally 0.2) per explicit "make night more pronounced" follow-up
  },
  // Crystal Spire, redesigned as a tropical reef ocean — this is now the
  // biome's actual ground-level water (the whole landmass sits below
  // LIQUID_LEVEL.crystal in terrain.js), not a small feature within it.
  // baseColor brightened toward a real saturated ocean blue per explicit
  // reference photo comparison — the previous 0x214d75 was a dark,
  // fairly desaturated navy; real open-ocean water under clear daylight
  // reads as a much more vivid medium blue. frothColor stays pure white
  // — bright white crest highlights against a saturated blue body is
  // still the core look, just with a livelier base tone underneath it.
  crystal: {
    baseColor: new THREE.Color(0x1f7fb0), frothColor: new THREE.Color(0xffffff),
    emissive: 0x2a5578, emissiveIntensity: 0.015, opacity: 0.88, roughness: 0.05,
  },
};

// A dark, murky storm-sea color — Coral Shallows only, blended in by
// stormAmount (see updateLiquidPlane) instead of swapping LIQUID_STYLE
// itself, so the calm-weather tuning above stays untouched and the storm
// look is purely a runtime blend on top of it. Shared/reused (not
// allocated per-vertex per-frame) the same way sssColor/fresnelTint
// already are further down this file.
const STORM_SEA_COLOR = new THREE.Color(0x1a3226);

// -----------------------------------------------------------------------------
// Gerstner (trochoidal) wave components — Coral Shallows' ocean only. A
// real Gerstner wave displaces each vertex horizontally as well as
// vertically (walking it toward the wave crest and back), which is what
// gives an ocean surface its actual peaked, slightly-pointed crests and
// broader troughs instead of the perfectly smooth, symmetric bumps a
// plain per-vertex sine gives. Several components at different
// directions/wavelengths/speeds summed together (the standard "sum of
// Gerstner waves" ocean technique) reads as real chop layered on top of
// a big rolling swell, rather than one uniform ripple. Ember's lava and
// Verdant's river keep their existing simpler sine-based ripple — this
// is scoped to the actual open-ocean biome specifically.
//
// REWORKED from a hand-picked 4-wave set to a GENERATED 10-wave
// spectrum — per explicit "doesn't behave or look as real as it should"
// follow-up. The real problem with only 4 discrete components: the
// combined pattern is fixed and exactly repeats, which reads as
// synthetic at close range once your eye starts recognizing the same
// shapes recurring. Ten components, generated from a real underlying
// relationship rather than hand-picked, is a genuinely richer, less
// repetitive combination — and two real physical corrections came out
// of doing this properly:
//
// (1) DISPERSION DIRECTION FIXED. The previous hand-tuned set had
//     SHORT wavelengths moving FASTEST (speed 1.75->4.6 as wavelength
//     went 40->7) — backwards from real deep-water gravity waves, where
//     phase speed scales with sqrt(wavelength): LONGER swells actually
//     travel faster than short chop. This generator derives speed from
//     that real relationship instead of arbitrary per-wave numbers.
// (2) Direction spread now uses golden-angle spacing (2.399963 rad)
//     around one dominant wind heading — mathematically guaranteed to
//     never have two components running exactly parallel or clustering,
//     unlike 4 arbitrarily-picked direction vectors.
//
// TOTAL AMPLITUDE deliberately kept at the SAME already-tuned sum
// (1.7) as the previous 4-wave version, not increased again — this
// round is about wave SHAPE/behavior, not making them taller. The
// coefficient below is solved backward from that target rather than
// picked per-wave, so adding more components doesn't silently inflate
// the total the way naively sampling the same amplitude/wavelength
// relationship at more points would.
//
// steepness (Q) controls how sharp the crest peak is — too high and
// neighboring vertices can cross over each other (self-intersecting
// geometry); kept comfortably under this file's own established rule
// (steepness*k*amplitude, summed across all waves, well under ~1.0 —
// verified numerically for this exact spectrum, aggregate ≈0.34, not
// eyeballed) via an explicit per-wave cap.
const GERSTNER_WAVE_COUNT = 10;
const GERSTNER_WIND_ANGLE = Math.atan2(0.3, 1.0); // same dominant heading the original swell used
const GERSTNER_GOLDEN_ANGLE = 2.399963; // radians — well-distributed direction spacing, never clusters or exactly repeats
const GERSTNER_LONGEST_WAVELENGTH = 42;
const GERSTNER_SHORTEST_WAVELENGTH = 3.2;
const GERSTNER_SPEED_AT_LONGEST = 1.9;
const GERSTNER_TARGET_AMPLITUDE_SUM = 1.7; // matches the previous 4-wave version's already-tuned total exactly
const GERSTNER_WAVES_RAW = (() => {
  const wavelengths = [];
  let wavelengthSum = 0;
  for (let i = 0; i < GERSTNER_WAVE_COUNT; i++) {
    const t = i / (GERSTNER_WAVE_COUNT - 1);
    // Geometric (not linear) spacing across wavelengths — a real ocean
    // spectrum's energy spans orders of magnitude, not an evenly-spaced
    // range.
    const wl = GERSTNER_LONGEST_WAVELENGTH * Math.pow(GERSTNER_SHORTEST_WAVELENGTH / GERSTNER_LONGEST_WAVELENGTH, t);
    wavelengths.push(wl);
    wavelengthSum += wl;
  }
  const amplitudeCoeff = GERSTNER_TARGET_AMPLITUDE_SUM / wavelengthSum; // solved backward so the SUM lands exactly on target regardless of wave count
  const waves = [];
  for (let i = 0; i < GERSTNER_WAVE_COUNT; i++) {
    const wavelength = wavelengths[i];
    const amplitude = wavelength * amplitudeCoeff; // longer waves carry proportionally more amplitude, same relationship the original 4-wave set's own numbers implied
    const speed = GERSTNER_SPEED_AT_LONGEST * Math.sqrt(wavelength / GERSTNER_LONGEST_WAVELENGTH); // real deep-water dispersion
    // Spread widened from ~35Β° (0.62 rad) to ~83Β° (1.45 rad) per explicit
    // "the waves should also animate back and forth instead of just side
    // to side" correction — the narrower cone kept every component
    // traveling in a broadly similar (mostly-X) direction relative to
    // GERSTNER_WIND_ANGLE (~16.7Β°), so the combined motion read as one-
    // directional. This range now spans well past 90Β° at its extremes,
    // so some components travel substantially along Z (toward/away from
    // the camera — genuine back-and-forth) while others stay close to
    // the original dominant heading (the "side to side" swell), summed
    // together rather than one replacing the other. Amplitude/speed/
    // wavelength generation above is unaffected — this only changes
    // which direction each component travels.
    const angle = GERSTNER_WIND_ANGLE + Math.sin(i * GERSTNER_GOLDEN_ANGLE) * 1.45;
    const k = (Math.PI * 2) / wavelength;
    const steepness = Math.min(0.5, 0.35 / (k * amplitude * GERSTNER_WAVE_COUNT));
    waves.push({ dirX: Math.cos(angle), dirZ: Math.sin(angle), wavelength, amplitude, speed, steepness });
  }
  return waves;
})();
// A SECOND set of longer-wavelength "far swell" components, merged into
// the SAME spectrum below — per explicit "remove the skirt completely
// and merge the near Gerstner waves with the far ones" request. These
// used to be a separate, smaller spectrum (SKIRT_GERSTNER_WAVES) driving
// a second, disconnected background plane; now it's one continuous
// ocean, one wave field. Kept as a genuinely SEPARATE generation block
// (not folded into the loop above) so the near spectrum's own long-
// standing tuning stays completely undisturbed — this only ADDS
// components. Amplitude kept modest (1.2, not the old skirt's 3.5) since
// these waves are now summed in EVERYWHERE, including right at the
// player's feet, not just far away — a full 3.5 on top of the near
// spectrum's own 1.7 would tower over the 1.6-unit eye height this
// system was originally tuned against.
const FAR_WAVE_COUNT = 5;
const FAR_LONGEST_WAVELENGTH = 90;
const FAR_SHORTEST_WAVELENGTH = 25;
const FAR_SPEED_AT_LONGEST = 2.6;
const FAR_TARGET_AMPLITUDE_SUM = 1.2;
const FAR_WAVES_RAW = (() => {
  const wavelengths = [];
  let wavelengthSum = 0;
  for (let i = 0; i < FAR_WAVE_COUNT; i++) {
    const t = i / (FAR_WAVE_COUNT - 1);
    const wl = FAR_LONGEST_WAVELENGTH * Math.pow(FAR_SHORTEST_WAVELENGTH / FAR_LONGEST_WAVELENGTH, t);
    wavelengths.push(wl);
    wavelengthSum += wl;
  }
  const amplitudeCoeff = FAR_TARGET_AMPLITUDE_SUM / wavelengthSum;
  const waves = [];
  for (let i = 0; i < FAR_WAVE_COUNT; i++) {
    const wavelength = wavelengths[i];
    const amplitude = wavelength * amplitudeCoeff;
    const speed = FAR_SPEED_AT_LONGEST * Math.sqrt(wavelength / FAR_LONGEST_WAVELENGTH);
    const angle = GERSTNER_WIND_ANGLE + Math.sin(i * GERSTNER_GOLDEN_ANGLE) * 1.45; // same heading/spread as the near spectrum, for continuous-looking motion
    const k = (Math.PI * 2) / wavelength;
    const steepness = Math.min(0.5, 0.35 / (k * amplitude * FAR_WAVE_COUNT));
    waves.push({ dirX: Math.cos(angle), dirZ: Math.sin(angle), wavelength, amplitude, speed, steepness });
  }
  return waves;
})();
const GERSTNER_WAVES = [...GERSTNER_WAVES_RAW, ...FAR_WAVES_RAW].map((w) => {
  const len = Math.hypot(w.dirX, w.dirZ) || 1;
  return { ndx: w.dirX / len, ndz: w.dirZ / len, k: (Math.PI * 2) / w.wavelength, amplitude: w.amplitude, speed: w.speed, steepness: w.steepness };
});
const GERSTNER_AMPLITUDE_SUM = GERSTNER_WAVES.reduce((sum, w) => sum + w.amplitude, 0);

// Domain warping — per explicit follow-up, this is what actually kills
// the "I can recognize the same wave pattern repeating" tell cheaply,
// without needing a genuinely different simulation technique (real FFT
// ocean sim would be a much larger, higher-risk rewrite — flagged and
// deliberately not attempted this round). Distorts the SAMPLE POSITION
// before evaluating the Gerstner sum, using a couple of large-scale,
// low-frequency sine terms with cross terms (both axes depend on BOTH
// x and z, not just their own axis) so it reads as smooth, organic
// drift rather than an axis-aligned artifact. Frequencies (0.006-0.016
// per unit) are deliberately much lower than any wave's own spatial
// frequency (wavelengths 3.2-42 units), so this reads as a slow large-
// scale bend layered UNDER the finer wave detail, not a competing
// pattern of its own.
function gerstnerDomainWarp(x, z, t) {
  // Magnitude boosted substantially (was 4.5/2.5, now 16/9 — roughly
  // 3.5x) per explicit "doesn't look any different" follow-up — the
  // original tuning was too conservative to read clearly against the
  // 3.2-42 unit wavelengths at normal player eye height. Still smooth/
  // continuous vertex-to-vertex (the warp function's own spatial
  // frequency, 0.006-0.016 per unit, is unchanged — only the magnitude
  // grew), so this can't cause any mesh tearing or discontinuity, just
  // a much more visible bend.
  const wx = Math.sin(x * 0.016 + z * 0.009 + t * 0.05) * 16.0 + Math.sin(x * 0.006 - z * 0.011 - t * 0.02) * 9.0;
  const wz = Math.cos(x * 0.011 - z * 0.014 + t * 0.04) * 16.0 + Math.cos(x * 0.008 + z * 0.007 - t * 0.018) * 9.0;
  return [x + wx, z + wz];
}

// A soft mottled noise pattern, tiled — real distortion needs a
// post-process shader this project doesn't have, so instead this scrolls
// upward and wobbles sideways on a mostly-transparent overlay just above
// the lava, which is enough to read as rising heat haze without needing
// actual screen-space refraction.
function createShimmerTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 6 + Math.random() * 16;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,220,180,0.35)");
    grad.addColorStop(1, "rgba(255,220,180,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

// -----------------------------------------------------------------------------
// Flow noise — cheap value-noise fbm evaluated per-vertex per-frame, used
// only by Ember's lava. Replaces the old per-vertex-index bubble cycle
// (`(i * 12.9898) % 1`), which had no spatial correlation between
// neighboring vertices — each one popped/faded on its own independent
// clock, which is what read as "glowing squares that fade out" rather
// than a liquid surface. Sampling a continuous 2D noise field and
// scrolling the sample coordinates over time in a fixed direction makes
// brightness move ACROSS the surface, like something is actually flowing
// downhill, instead of blinking in place. Still no shader/GPU work — this
// is the same CPU per-vertex-loop approach the rest of the file already
// uses, just fed a spatially coherent field instead of an index hash.
// -----------------------------------------------------------------------------

function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise2D(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, u), THREE.MathUtils.lerp(c, d, u), v);
}

function fbm(x, y, octaves) {
  let total = 0, amp = 0.5, freq = 1, max = 0;
  for (let o = 0; o < octaves; o++) {
    total += valueNoise2D(x * freq, y * freq) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return total / max;
}

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function normalizeFlow(dir) {
  const len = Math.hypot(dir.x, dir.z) || 1;
  return { x: dir.x / len, z: dir.z / len };
}

// Small glowing droplets drifting across the lava's surface in the flow
// direction, same technique used for the volcano's veins (landmarks.js) —
// a physically-moving bright point is a much stronger "this is flowing"
// cue than the per-vertex color animation alone, which is continuous but
// subtle. Loops each bead along the flow direction across the plane's
// full span, with a randomized perpendicular offset so they don't all
// trace the same line, fading in/out near both ends of their loop.
function createLavaFlowBeads(flowDir, size, count) {
  const perp = { x: -flowDir.z, z: flowDir.x };
  const group = new THREE.Group();
  const beads = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfff3c8, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), mat);
    group.add(mesh);
    beads.push({
      mesh,
      phase: i / count + Math.random() * 0.1,
      speed: 0.018 + Math.random() * 0.012,
      perpOffset: (Math.random() - 0.5) * size * 0.7,
    });
  }
  return { group, beads, flowDir, perp, size };
}

function updateLavaFlowBeads(flowBeads, elapsed, y) {
  const span = flowBeads.size * 1.3;
  for (const b of flowBeads.beads) {
    const u = (elapsed * b.speed + b.phase) % 1;
    const along = (u - 0.5) * span;
    const x = flowBeads.flowDir.x * along + flowBeads.perp.x * b.perpOffset;
    const z = flowBeads.flowDir.z * along + flowBeads.perp.z * b.perpOffset;
    b.mesh.position.set(x, y + 0.15, z);
    const fadeWindow = 0.08;
    const fade = Math.max(0, Math.min(1, u / fadeWindow, (1 - u) / fadeWindow));
    b.mesh.material.opacity = fade * 0.85;
  }
}

/**
 * @param {THREE.Scene} scene
 * @param {string} biome
 * @param {number} y  world-space height to place the plane at
 * @param {number} size  full width/depth to cover (should match/exceed the terrain size)
 * @param {(x:number, z:number) => number|null} [sampleHeight]  used only for Ember's floating cooled-rock chunks, to place them in genuine lava channels rather than scattering blindly across the whole plane
 * @param {{x:number, z:number}} [flowDir]  Ember only — world-space direction the lava's crust/crack pattern drifts in. Defaults to a fixed diagonal; pass a real downhill direction (e.g. sampled from terrain.js's heightfield gradient) for a more physically-grounded flow per landmark/channel.
 */
// A tileable vertical-streak texture for the falling water sheet —
// random-width bright streaks on a translucent pale-blue base, repeated
// vertically so scrolling its offset each frame reads as continuously
// falling water rather than one static image.
let sharedWaterfallTexture = null;
function getWaterfallTexture() {
  if (sharedWaterfallTexture) return sharedWaterfallTexture;
  const w = 64, h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(210,235,255,0.55)";
  ctx.fillRect(0, 0, w, h);
  // Broken, staggered streak segments — not full-height lines, which
  // read as too clean/regular for turbulent falling water.
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * w;
    const sw = 1 + Math.random() * 3.5;
    const segH = h * (0.15 + Math.random() * 0.5);
    const segY = Math.random() * (h - segH);
    ctx.fillStyle = `rgba(255,255,255,${(0.3 + Math.random() * 0.5).toFixed(2)})`;
    ctx.fillRect(x, segY, sw, segH);
  }
  // Scattered foam-white blob clusters throughout, not just a foam pool
  // at the very bottom — real whitewater churns and breaks up along the
  // whole fall, not just where it lands.
  for (let i = 0; i < 22; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const r = 2 + Math.random() * 4;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.8)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  sharedWaterfallTexture = tex;
  return tex;
}

// A soft white foam-pool glow for where the falls hit the river below.
let sharedFoamTexture = null;
function getFoamTexture() {
  if (sharedFoamTexture) return sharedFoamTexture;
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.4)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  sharedFoamTexture = new THREE.CanvasTexture(canvas);
  return sharedFoamTexture;
}

// A cascading waterfall — Verdant only, one fixed feature at the river's
// carved cliff. topY/bottomY/x/z come from SAMPLING the actual rendered
// terrain height on both sides of that cliff (main.js does this via
// terrainHeightAt/WATERFALL_Z from terrain.js) rather than this file
// duplicating terrain.js's noise math — so it's always correctly aligned
// regardless of the exact noise values at that point.
function createWaterfall(scene, topY, bottomY, x, z, width) {
  const height = THREE.MathUtils.clamp(topY - bottomY, 0, 16); // clamped — an unlucky extreme terrain sample right at the cliff could otherwise produce a wildly oversized panel
  if (height < 2) return null; // not enough of a cliff here to bother with
  const geo = new THREE.PlaneGeometry(width, height);
  const mat = new THREE.MeshBasicMaterial({
    map: getWaterfallTexture(), color: 0xdfeeff, transparent: true, side: THREE.DoubleSide,
    depthWrite: false, opacity: 0.8, fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, bottomY + height / 2, z);
  scene.add(mesh);

  const foamMat = new THREE.SpriteMaterial({ map: getFoamTexture(), transparent: true, opacity: 0.7, depthWrite: false, fog: true });
  const foam = new THREE.Sprite(foamMat);
  foam.scale.set(width * 1.5, width * 0.75, 1);
  foam.position.set(x, bottomY + 0.15, z);
  scene.add(foam);

  // A burst of small splash particles at the base — arcing outward and
  // falling back, continuously recycled, rather than a static foam glow
  // standing in for actual splashing.
  const splashCount = 36;
  const splashPositions = new Float32Array(splashCount * 3);
  const splashVel = new Float32Array(splashCount * 3);
  const splashLife = new Float32Array(splashCount);
  for (let i = 0; i < splashCount; i++) splashLife[i] = 1; // start "dead" so the update loop's reset logic spawns them staggered on the first few frames, not all at once
  const splashGeo = new THREE.BufferGeometry();
  splashGeo.setAttribute("position", new THREE.BufferAttribute(splashPositions, 3));
  const splashMat = new THREE.PointsMaterial({
    map: getFoamTexture(), color: 0xffffff, size: 0.4, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const splash = new THREE.Points(splashGeo, splashMat);
  scene.add(splash);

  return { mesh, foam, splash, splashVel, splashLife, baseX: x, baseY: bottomY, baseZ: z, width };
}

function updateWaterfall(handle, dt, elapsed) {
  if (!handle) return;
  handle.mesh.material.map.offset.y += dt * 2.2; // was -= — that direction scrolled the texture upward instead of down, per direct observation
  handle.foam.material.opacity = 0.55 + Math.sin(elapsed * 2.2) * 0.15; // gentle churn, not a static glow

  const posAttr = handle.splash.geometry.attributes.position;
  for (let i = 0; i < handle.splashLife.length; i++) {
    handle.splashLife[i] += dt * 0.45; // slowed from 0.9 — the boosted upward velocity needs more time to complete its arc before respawning
    if (handle.splashLife[i] >= 1) {
      // Respawn — a fresh outward-and-up burst from a random point along
      // the base of the falls.
      handle.splashLife[i] = 0;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.8 + Math.random() * 1.8;
      posAttr.setXYZ(i,
        handle.baseX + (Math.random() - 0.5) * handle.width * 0.8,
        handle.baseY + 0.1,
        handle.baseZ + (Math.random() - 0.5) * handle.width * 0.4
      );
      handle.splashVel[i * 3] = Math.cos(angle) * speed * 0.35;
      handle.splashVel[i * 3 + 1] = 4 + Math.random() * 3; // was 1.6-3.2 — much higher arc, visibly above the water surface per explicit request
      handle.splashVel[i * 3 + 2] = Math.sin(angle) * speed * 0.35;
    } else {
      // Simple ballistic arc — rises, gravity pulls it back down.
      const t = handle.splashLife[i];
      const gravity = 3.2;
      posAttr.setX(i, posAttr.getX(i) + handle.splashVel[i * 3] * dt);
      posAttr.setY(i, posAttr.getY(i) + (handle.splashVel[i * 3 + 1] - gravity * t) * dt);
      posAttr.setZ(i, posAttr.getZ(i) + handle.splashVel[i * 3 + 2] * dt);
    }
  }
  posAttr.needsUpdate = true;
  handle.splash.material.opacity = 0.7 + Math.sin(elapsed * 3.1) * 0.15;
}

// A genuine flowing current along the river's actual winding path —
// particles travel downstream (increasing Z) while tracking the river's
// curve via the SAME riverCenterX formula terrain.js uses (replicated
// here with the same seed derivation) rather than a straight flow
// direction, since a straight direction wouldn't follow a winding
// channel. This is what actually reads as "the river has a current,"
// distinct from the ambient wave/ripple system.
// Same formula terrain.js's verdant shaper uses for its river's
// meandering centerline, replicated here (not imported — liquid.js
// doesn't depend on terrain.js) so anything needing to follow the
// river's actual path stays correctly aligned with the real carved
// channel.
function riverCenterXAt(z, terrainSeed) {
  return Math.sin(z * 0.035 + terrainSeed * 0.01) * 28 + Math.sin(z * 0.013 + terrainSeed * 0.02) * 14;
}

// A horizontally-tiling streak texture for the river's surface — same
// painting technique as the waterfall texture, but wrapped for a
// sideways/downstream scroll instead of a vertical fall.
let sharedRiverSurfaceTexture = null;
function getRiverSurfaceTexture() {
  if (sharedRiverSurfaceTexture) return sharedRiverSurfaceTexture;
  const w = 128, h = 48;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < 30; i++) {
    const y = Math.random() * h;
    const sh = 1 + Math.random() * 2.5;
    const segW = w * (0.15 + Math.random() * 0.4);
    const segX = Math.random() * (w - segW);
    ctx.fillStyle = `rgba(255,255,255,${(0.2 + Math.random() * 0.35).toFixed(2)})`;
    ctx.fillRect(segX, y, segW, sh);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  sharedRiverSurfaceTexture = tex;
  return tex;
}

// A series of flat textured segments laid along the river's actual
// winding path (not one single straight mesh, which couldn't follow a
// curve), each oriented to the local tangent direction so the seams
// between segments stay reasonably aligned with the river's own bend —
// gives the water's surface the same kind of visible "flowing texture"
// look the waterfall already has, distinct from the current's particles.
function createRiverFlowStrip(scene, terrainSeed, waterY, zMin, zMax, width, segmentCount) {
  const group = new THREE.Group();
  const tex = getRiverSurfaceTexture();
  const segLength = (zMax - zMin) / segmentCount;
  for (let i = 0; i < segmentCount; i++) {
    const zStart = zMin + i * segLength;
    const zEnd = zStart + segLength;
    const zMid = (zStart + zEnd) / 2;
    const xStart = riverCenterXAt(zStart, terrainSeed);
    const xEnd = riverCenterXAt(zEnd, terrainSeed);
    const xMid = riverCenterXAt(zMid, terrainSeed);
    const geo = new THREE.PlaneGeometry(width, segLength * 1.15); // slight overlap between segments so bends don't leave a visible gap
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(xMid, waterY + 0.03, zMid);
    mesh.rotation.y = Math.atan2(xEnd - xStart, zEnd - zStart); // aligns each segment with the river's local bend
    group.add(mesh);
  }
  scene.add(group);
  return { group, texture: tex };
}

function updateRiverFlowStrip(handle, dt) {
  if (!handle) return;
  handle.texture.offset.x -= dt * 0.5; // scrolls sideways across each segment for a flowing-surface look
}

function disposeRiverFlowStrip(scene, handle) {
  if (!handle) return;
  scene.remove(handle.group);
  riftDeferDispose(() => {
    handle.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose(); // the shared pooled texture itself intentionally not disposed
    });
  });
}

function createRiverCurrent(scene, terrainSeed, waterY, zMin, zMax, count) {
  const mat = new THREE.PointsMaterial({
    map: getFoamTexture(), color: 0xffffff, size: 0.55, transparent: true, opacity: 0.65,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const positions = new Float32Array(count * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  const zPositions = new Float32Array(count);
  const speeds = new Float32Array(count);
  const perpOffsets = new Float32Array(count); // fixed sideways scatter within the channel width, set once (not re-randomized every frame, which would look like static)
  for (let i = 0; i < count; i++) {
    zPositions[i] = zMin + Math.random() * (zMax - zMin);
    speeds[i] = 9 + Math.random() * 5;
    perpOffsets[i] = (Math.random() - 0.5) * 7;
  }
  return { points, zPositions, speeds, perpOffsets, terrainSeed, waterY, zMin, zMax, count };
}

function updateRiverCurrent(handle, dt) {
  if (!handle) return;
  const posAttr = handle.points.geometry.attributes.position;
  const span = handle.zMax - handle.zMin;
  for (let i = 0; i < handle.count; i++) {
    handle.zPositions[i] += handle.speeds[i] * dt;
    if (handle.zPositions[i] > handle.zMax) handle.zPositions[i] -= span; // wraps back to the upstream end, preserving overflow instead of snapping to a fixed value
    const z = handle.zPositions[i];
    const riverX = riverCenterXAt(z, handle.terrainSeed);
    posAttr.setXYZ(i, riverX + handle.perpOffsets[i], handle.waterY + 0.08, z);
  }
  posAttr.needsUpdate = true;
}

function disposeRiverCurrent(scene, handle) {
  if (!handle) return;
  scene.remove(handle.points);
  riftDeferDispose(() => {
    handle.points.geometry.dispose();
    handle.points.material.dispose();
  });
}

// A wide craggy rock wall spanning the whole cliff face the waterfall
// falls from — the cliff itself is just terrain (grass-colored, matching
// the rest of the hillside), so without this the "cliff" only reads as
// a rock formation right where the small scattered boulders happen to
// sit, not as a genuine rock FACE. A segmented plane with per-vertex
// jitter (forward/back AND up/down) reads as a jagged rock surface
// rather than a flat card, with a real vertex-color gradient (dark stone
// low down, blending toward a mossy tint near the top where it meets
// the grass) using the same technique this project's other rock props
// already use.
function createCliffWall(scene, topY, bottomY, x, z, width, seedRand) {
  const height = THREE.MathUtils.clamp(topY - bottomY, 0, 16) + 3; // a bit taller than the falls itself so the rock face visibly extends past both edges of the water
  const segsX = 40, segsY = 10; // was 26,6 — bumped further per explicit "higher poly count everywhere" request
  const geo = new THREE.PlaneGeometry(width, height, segsX, segsY); // caller passes the exact total width directly now (no internal multiplier)
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const stoneLow = new THREE.Color(0x3a3a34);
  const stoneHigh = new THREE.Color(0x5c6b4a);
  for (let i = 0; i < pos.count; i++) {
    const jitter = (seedRand() - 0.5) * 1.1;
    pos.setZ(i, pos.getZ(i) + jitter); // forward/back — the actual jagged-rock read
    pos.setY(i, pos.getY(i) + (seedRand() - 0.5) * 0.4);
    const t = THREE.MathUtils.clamp((pos.getY(i) + height / 2) / height, 0, 1); // 0 at the base, 1 near the top
    const c = stoneLow.clone().lerp(stoneHigh, t);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  // Stays facing +Z by default (a standard PlaneGeometry's normal), which
  // is the direction the player approaches from downstream — no rotation
  // needed.
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, bottomY + height / 2 - 1.5, z - 2.5); // was z+0.3 — that positive offset actually placed it IN FRONT of the waterfall (closer to the player, who approaches from the south/higher Z), occluding it entirely; negative offset genuinely sits it behind, matching the cave mouth's convention
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { mesh };
}

function disposeCliffWall(scene, handle) {
  if (!handle) return;
  scene.remove(handle.mesh);
  riftDeferDispose(() => {
    handle.mesh.geometry.dispose();
    handle.mesh.material.dispose();
  });
}

// The pond feeding the waterfall from above — without this the falls had
// no visible source at all. The `radius` passed in must be small enough
// that this SQUARE plane's CORNERS (which reach radius*sqrt(2), not
// radius) stay within terrain.js's guaranteed core radius (0.55 *
// POND_RADIUS, where the basin floor is an absolute guarantee
// independent of the surrounding hill noise) — verified numerically at
// the main.js call site, not just assumed from the plane's nominal size.
function createSourcePond(scene, x, z, y, radius) {
  const segs = 20;
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const basePositions = pos.array.slice();
  // Soft circular fade at the edges (via vertex alpha isn't available on
  // a single opaque material, so this fades the OPACITY of the whole
  // material toward the edges isn't possible per-vertex either) — instead
  // the mesh is kept comfortably smaller than the actual guaranteed-flat
  // basin floor, so its straight edges sit over flat, water-colored
  // terrain rather than a visible seam against a slope.
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0f4a78, roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.9,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { mesh, basePositions };
}

function updateSourcePond(handle, elapsed) {
  if (!handle) return;
  const pos = handle.mesh.geometry.attributes.position;
  const base = handle.basePositions;
  // Same two-layer swell+chop technique as the main water plane's wave
  // system, just a gentler amplitude — a small still pond shouldn't churn
  // as much as the river/waterfall below it, but it should still read as
  // real moving water rather than a static painted disc.
  for (let i = 0; i < pos.count; i++) {
    const bx = base[i * 3], bz = base[i * 3 + 2];
    const swell = Math.sin(bx * 0.25 + elapsed * 0.7) * 0.05 + Math.cos(bz * 0.22 + elapsed * 0.55) * 0.05;
    const chop = Math.sin(bx * 0.6 + bz * 0.45 + elapsed * 1.6) * 0.02;
    pos.setY(i, swell + chop);
  }
  pos.needsUpdate = true;
}

function disposeSourcePond(scene, handle) {
  if (!handle) return;
  scene.remove(handle.mesh);
  riftDeferDispose(() => {
    handle.mesh.geometry.dispose();
    handle.mesh.material.dispose();
  });
}

function disposeWaterfall(scene, handle) {
  if (!handle) return;
  scene.remove(handle.mesh);
  scene.remove(handle.foam);
  scene.remove(handle.splash);
  riftDeferDispose(() => {
    handle.mesh.geometry.dispose();
    handle.mesh.material.dispose(); // shared pooled texture itself intentionally not disposed
    handle.foam.material.dispose();
    handle.splash.geometry.dispose();
    handle.splash.material.dispose();
  });
}

// -----------------------------------------------------------------------------
// Real photo-derived ripple detail — a genuine normal map (surface-
// direction encoding, NOT baked color, same reasoning as the sky dome's
// structure-only cloud texture: an image dropped straight in as diffuse
// color would freeze one fixed lighting moment onto water that's
// supposed to shift color with the day/night cycle and skyColor tint
// already computed per-frame below). Reuses the exact same asset as the
// Coral Shallows THREE.Water mirror plane (`waternormals.jpg`) — one
// real photo now backs ripple detail on BOTH water systems in the
// project instead of just the one. Cached at module level (the raw
// disk-loaded texture); createLiquidPlane clones it per call so each
// biome's plane can set its own independent repeat/offset without
// fighting over one shared Texture object's properties (see clouds.js's
// own dual-layer note for why sharing a Texture instance for per-
// instance offset animation doesn't work).
let rippleNormalTexture = null;
function getRippleNormalTexture() {
  if (rippleNormalTexture) return rippleNormalTexture;
  const url = new URL("textures/waternormals.jpg", import.meta.url).href;
  rippleNormalTexture = new THREE.TextureLoader().load(
    url,
    () => console.log("[liquid] ripple normal texture loaded:", url),
    undefined,
    (err) => console.error("[liquid] ripple normal texture FAILED to load:", url, err)
  );
  rippleNormalTexture.wrapS = rippleNormalTexture.wrapT = THREE.RepeatWrapping;
  return rippleNormalTexture;
}

// Real photo-derived FOAM detail — a grayscale mask (white = foam,
// black = clear water) extracted from a real PBR ocean-foam reference,
// same structure-only reasoning as the normal map above: this is
// blended INTO the existing procedural Voronoi foam pattern below
// rather than replacing it outright, so the real organic foam detail
// shows through while the procedural noise still breaks up the
// otherwise-visible repetition of one small tiled texture stretched
// across a huge ocean plane. Crystal-only, same as the whole foam
// shader it feeds.
let foamDetailTexture = null;
function getFoamDetailTexture() {
  if (foamDetailTexture) return foamDetailTexture;
  const url = new URL("textures/oceanfoam.jpg", import.meta.url).href;
  foamDetailTexture = new THREE.TextureLoader().load(
    url,
    () => console.log("[liquid] foam detail texture loaded:", url),
    undefined,
    (err) => console.error("[liquid] foam detail texture FAILED to load:", url, err)
  );
  foamDetailTexture.wrapS = foamDetailTexture.wrapT = THREE.RepeatWrapping;
  return foamDetailTexture;
}

function createLiquidPlane(scene, biome, y, size, sampleHeight, flowDir = { x: 0.6, z: 0.35 }, excludeRegions = []) {
  const style = LIQUID_STYLE[biome];
  if (!style) return null;
  const segs = getGraphicsSettings().liquidSegments; // reverted the earlier ×1.4 workaround — liquidSegments itself is now increased directly in graphicsSettings.js
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);

  // Punches real holes in the water plane for any excluded region (e.g.
  // a chasm that should read as genuinely dry, not flooded) — this flat
  // plane otherwise covers the WHOLE map uniformly at one fixed height,
  // with no awareness of what's actually been carved beneath it, so a
  // deep pit anywhere below `y` would always appear flooded regardless
  // of intent. Removes any triangle whose centroid falls within an
  // excluded region's radius; vertex colors are untouched since they're
  // still valid for the remaining boundary triangles that reference them.
  if (excludeRegions.length > 0) {
    const posAttr = geo.attributes.position;
    const oldIndex = geo.index.array;
    const newIndex = [];
    for (let i = 0; i < oldIndex.length; i += 3) {
      const a = oldIndex[i], b = oldIndex[i + 1], c = oldIndex[i + 2];
      const cx = (posAttr.getX(a) + posAttr.getX(b) + posAttr.getX(c)) / 3;
      const cz = (posAttr.getZ(a) + posAttr.getZ(b) + posAttr.getZ(c)) / 3;
      const excluded = excludeRegions.some((r) => Math.hypot(cx - r.x, cz - r.z) < r.radius);
      if (!excluded) newIndex.push(a, b, c);
    }
    geo.setIndex(newIndex);
  }

  const posAttr = geo.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);
  // Depth-based base color — Crystal only. Real oceans read lighter over
  // a shallow reef/shoreline and darker over open deep water; a single
  // flat baseColor everywhere (what every other biome's water still
  // uses) can't capture that. Computed once here from the actual terrain
  // height under each vertex (same sampleHeight technique the ember
  // rocks above already use), stored on the handle so the per-frame wave
  // update below blends wave disturbance on TOP of this instead of one
  // uniform starting color.
  let depthColors = null;
  let shoreDamp = null;
  if (biome === "crystal" && sampleHeight) {
    depthColors = new Float32Array(posAttr.count * 3);
    // Per explicit "ocean waves are coming up through [the cove], adjust
    // the waves so it doesn't flow up too much onto the sand" — the
    // Gerstner wave sum (updateLiquidPlane below) previously applied its
    // FULL amplitude uniformly across the whole plane, all the way up to
    // the shoreline itself, with no reduction in shallow water. Real
    // waves lose height approaching shore (shoaling/damping) — this
    // precomputes that falloff once per vertex here (reusing the SAME
    // depth sample already being taken for depthColors, no extra cost),
    // stored on the handle and read cheaply in the per-frame wave loop
    // instead of adding a new sample there. 0 right at/above the
    // shoreline (zero wave contribution — a previous fix already raised
    // the cove's own static floor height, but that alone can't stop a
    // wave CREST riding on top of the calm water level from still
    // reaching over it), ramping to full strength by SHORE_DAMP_DEPTH
    // units of real depth.
    shoreDamp = new Float32Array(posAttr.count);
    const SHORE_DAMP_DEPTH = 3.5;
    const shallow = new THREE.Color(0x7fd0d8); // was 0x5fa8c4 — brighter, more vivid turquoise right at the shoreline per the reference's clear, bright shallow water
    const deep = style.baseColor; // the deep blue tuned in LIQUID_STYLE.crystal
    const tmpDepth = new THREE.Color();
    const MAX_DEPTH = 7; // beyond this the water reads as fully "deep" — matches the reef's own real depth range from terrain.js
    // Distance-based far darkening — per "merge the near Gerstner waves
    // with the far ones" request: now that this is ONE plane extending
    // well past the coastline (the separate background skirt is gone),
    // the depth-based shallow/deep blend above alone still only reaches
    // LIQUID_STYLE.crystal's own medium reef-blue at "deep" — it never
    // gets as dark as the old skirt's own distinct DEEP_COLOR further
    // out. This preserves that "gets progressively darker toward the
    // horizon" read on the same single plane, starting beyond the
    // coastline (300 units) and reaching full darkness by ~45% of
    // whatever size this plane was actually built at.
    const FAR_DARKEN_COLOR = new THREE.Color(0x061824);
    const FAR_DARKEN_START = 300;
    const FAR_DARKEN_END = Math.max(FAR_DARKEN_START + 200, size * 0.45);
    // Per explicit "waves that actually roll onto the shore" — SIGNED
    // depth (NOT clamped to 0 the way `depth` below is, for the existing
    // color blend) is what makes a real swash zone possible: negative
    // above water (dry sand), positive below (real depth). The OLD
    // shoreDamp reached exactly 0 right at the average shoreline and
    // stayed 0 for any dry-land vertex — meaning a wave crest could
    // never rise high enough to visibly reach the sand at all, since its
    // amplitude was already zeroed well before getting there. This new
    // version keeps a small, CAPPED amplitude in a narrow band just
    // above the shoreline instead of hard-zeroing it — enough for a real
    // wave crest to occasionally rise a controlled amount above the
    // sand's own height, then recede, rather than none at all.
    // SWASH_REACH matches the terrain's OWN foam-wash effect's max reach
    // (~0.6 units, see the wave-wash block in main.js) so the water's
    // actual rising edge visually lines up with where the sand's own
    // foam/wet-band effect already expects the wave edge to be, instead
    // of the two independently-tuned systems disagreeing.
    // SWASH_MAX_AMPLITUDE is deliberately small (22% of full wave
    // amplitude, not the full uncontrolled height) — this is the same
    // shoreline this exact damping was built to STOP waves flowing up
    // over uncontrollably in the first place (see this function's own
    // earlier comment); the fix here is a small, deliberate, bounded
    // reach, not simply undoing that original fix.
    const SWASH_REACH = 0.55;
    const SWASH_MAX_AMPLITUDE = 0.22;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i), vz = posAttr.getZ(i);
      const groundY = sampleHeight(vx, vz);
      const depth = groundY === null ? MAX_DEPTH : Math.max(0, y - groundY);
      const signedDepth = groundY === null ? MAX_DEPTH : y - groundY;
      const t = Math.min(1, depth / MAX_DEPTH);
      let swashDamp;
      if (signedDepth < -SWASH_REACH) {
        swashDamp = 0; // too far up the beach, never reached
      } else if (signedDepth < 0) {
        // Dry-sand swash zone — ramps 0 (at the outer SWASH_REACH edge)
        // up to SWASH_MAX_AMPLITUDE (right at the average shoreline).
        const st = (signedDepth + SWASH_REACH) / SWASH_REACH;
        swashDamp = (st * st * (3 - 2 * st)) * SWASH_MAX_AMPLITUDE;
      } else {
        // Underwater — ramps from SWASH_MAX_AMPLITUDE (right at the
        // shoreline, matching the dry-side zone's own value exactly at
        // the boundary so there's no visible seam) up to full amplitude
        // by SHORE_DAMP_DEPTH.
        const st = Math.min(1, signedDepth / SHORE_DAMP_DEPTH);
        const eased = st * st * (3 - 2 * st);
        swashDamp = SWASH_MAX_AMPLITUDE + eased * (1 - SWASH_MAX_AMPLITUDE);
      }
      shoreDamp[i] = swashDamp;
      tmpDepth.copy(shallow).lerp(deep, t);
      const distFromCenter = Math.hypot(vx, vz);
      const farT = THREE.MathUtils.clamp((distFromCenter - FAR_DARKEN_START) / (FAR_DARKEN_END - FAR_DARKEN_START), 0, 1);
      if (farT > 0) tmpDepth.lerp(FAR_DARKEN_COLOR, farT * farT * (3 - 2 * farT));
      tmpDepth.toArray(depthColors, i * 3);
      tmpDepth.toArray(colors, i * 3);
    }
  } else {
    for (let i = 0; i < posAttr.count; i++) {
      style.baseColor.toArray(colors, i * 3);
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  // Per-vertex wave-crest intensity, fed into the custom foam fragment
  // shader below (crystal only) — updateLiquidPlane writes the same
  // "disturbance" value it already computes for the froth-color blend
  // into this each frame, raw/unshaped, so all the actual foam shaping
  // (thresholding, Voronoi masking) happens in the shader instead of
  // being pre-baked per-vertex like the rest of this file's coloring.
  if (biome === "crystal") {
    geo.setAttribute("aFoam", new THREE.BufferAttribute(new Float32Array(posAttr.count), 1));
    // Sun-glitter intensity — same per-vertex-attribute pattern as aFoam
    // above, computed each frame in updateLiquidPlane from the exact
    // analytic Gerstner normal + real view/sun vectors already computed
    // there for the Fresnel term (no duplicate math, just reused).
    geo.setAttribute("aSunGlint", new THREE.BufferAttribute(new Float32Array(posAttr.count), 1));
    // Same pattern again — carries the already-computed grazing-angle
    // Fresnel value into the reflection shader's blend strength, reused
    // rather than recomputed in GLSL.
    geo.setAttribute("aReflectionFresnel", new THREE.BufferAttribute(new Float32Array(posAttr.count), 1));
    // Coarse per-vertex reflection distortion — the XZ (horizontal)
    // components of the exact same analytic Gerstner normal already
    // computed for lighting/Fresnel/sun-glint, reused here to bend the
    // reflection sample based on real wave slope, not just vertical
    // bob. A perfectly flat patch has normal (0,1,0) -> zero distortion;
    // a steep wave face has real horizontal normal components -> visibly
    // bent reflection there, which is what makes choppy water actually
    // look choppy in its reflection instead of a clean undistorted
    // mirror riding on top of bumpy geometry.
    geo.setAttribute("aReflectionDistort", new THREE.BufferAttribute(new Float32Array(posAttr.count * 2), 2));
  }

  const matOptions = {
    vertexColors: true, emissive: style.emissive, emissiveIntensity: style.emissiveIntensity,
    transparent: true, opacity: style.opacity, roughness: style.roughness, metalness: 0.1,
  };
  // Real ripple detail from a photo-derived normal map — water biomes
  // only (verdant, crystal); lava isn't reflective/rippled the same way
  // and keeps its own existing crust/crack/emissive look untouched. A
  // per-instance CLONE of the shared cached texture (not the shared
  // texture itself) so this plane's own repeat/offset don't collide with
  // any other biome's water plane using the same underlying image.
  // Repeat count is tied to `size` so the ripple detail reads at a
  // consistent physical scale whether this is Verdant's smaller river
  // plane or Crystal's much larger ocean, rather than one fixed repeat
  // looking right on one and smeared/tiny on the other.
  let rippleTexture = null;
  if (biome !== "ember") {
    rippleTexture = getRippleNormalTexture().clone();
    rippleTexture.needsUpdate = true;
    const repeatCount = Math.max(6, Math.round(size / 9));
    rippleTexture.repeat.set(repeatCount, repeatCount);
    matOptions.normalMap = rippleTexture;
    // Subtle — this rides ON TOP of the existing Gerstner/sine wave
    // geometry and per-vertex foam/color work, adding fine specular
    // micro-detail rather than replacing any of the shape/color that
    // system already computes. Too strong and it fights the real
    // geometric wave normals crystal already writes analytically above.
    matOptions.normalScale = new THREE.Vector2(0.45, 0.45);
  }
  // Builds one water material with the shared foam shader patch applied —
  // factored into a function because crystal now needs TWO materials
  // (see the front/back split below) rather than duplicating the whole
  // shader-injection string a second time.
  function buildWaterMaterial(side, depthWrite) {
    const options = { ...matOptions, side, depthWrite };
    // MeshPhysicalMaterial with clearcoat for the ocean specifically — a
    // water surface's specular highlight really is a thin, near-flat
    // reflective film on top of the bulk-colored water beneath it, which
    // clearcoat models properly. This previously rendered black at
    // grazing angles (the horizon) because clearcoat needs an
    // environment map to reflect and this scene had none — main.js now
    // sets scene.environment for the crystal biome specifically (a PMREM
    // map generated from the sky's own real current zenith/horizon
    // colors, kept in sync through the day/night cycle), so there's
    // something real for it to reflect. Ember's lava and Verdant's river
    // keep plain MeshStandardMaterial, unchanged — this is scoped to the
    // one biome that actually has an environment map set up for it.
    const m = biome === "crystal"
      ? new THREE.MeshPhysicalMaterial({
          ...options, clearcoat: 1.0, clearcoatRoughness: 0.06,
          // Boosted from the implicit default (1.0) — per explicit
          // request to lean harder on this ALREADY-BUILT reflection
          // system (the sky-gradient PMREM env map set up in main.js)
          // now that the separate THREE.Water mirror plane has been
          // removed entirely. envMapIntensity is a well-tested built-in
          // MeshPhysicalMaterial property (not custom shader code), so
          // this carries none of the render-target risk that broke the
          // mirror — it just tells the material to sample its existing
          // environment map more strongly.
          envMapIntensity: 1.7,
        })
      : new THREE.MeshStandardMaterial(options);
    // Per "Coral Shallows won't load" — this onBeforeCompile block uses
    // the exact same technique (raw GLSL string-patching a three.js-
    // generated shader) already confirmed officially unsupported under
    // real WebGPU execution, the same root cause that broke the terrain
    // shader earlier in this project (see main.js's CAUSTICS_ENABLED /
    // simpleTerrainMat). That fix only ever addressed the terrain side —
    // this water-specific onBeforeCompile (foam/reflection/refraction/
    // caustics, crystal-biome-only) was never touched, and crystal is the
    // ONLY biome that reaches this branch, which is exactly why Coral
    // Shallows specifically fails to load while the others don't.
    // CRYSTAL_WATER_SHADER_ENABLED is the same single flip-point pattern
    // as CAUSTICS_ENABLED — stage-1 stopgap: crystal's water falls back
    // to a plain MeshPhysicalMaterial (still has clearcoat/PBR lighting,
    // loses the foam/reflection/refraction/caustic shader layer) so the
    // level loads again. Every downstream consumer of
    // mesh.material.userData.shader (updateLiquidPlane's reflection/
    // refraction/uTime pushes below) is already guarded with
    // `if (...userData.shader)` checks, so leaving it unset here is
    // safe — confirmed by reading those call sites, not assumed. Real
    // fix is a TSL node-material rebuild of this whole block, not yet
    // started, same as the terrain caustics.
    const CRYSTAL_WATER_SHADER_ENABLED = false;
    if (biome === "crystal" && CRYSTAL_WATER_SHADER_ENABLED) {
      // Procedural whitecap foam — real Voronoi/Worley cellular noise
      // evaluated per-PIXEL in the fragment shader, not per-vertex like
      // everything else this file paints. onBeforeCompile patches the
      // three.js-generated MeshPhysicalMaterial shader directly rather
      // than writing a full custom ShaderMaterial, so clearcoat/PBR
      // lighting/fog from the rest of this material keep working
      // unmodified — only the diffuse color gets a foam pass layered on
      // top, right where the per-vertex froth/Fresnel/SSS blending from
      // updateLiquidPlane already leaves off.
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        shader.uniforms.uFoamTex = { value: getFoamDetailTexture() };
        // Real planar reflection — texture + projection matrix are both
        // owned and updated by main.js each frame (it renders the actual
        // reflection pass; see updateLiquidPlane's own reflectionTexture/
        // reflectionMatrix params above for how they get here). Starts
        // null/identity so nothing breaks before the first frame sets
        // them.
        shader.uniforms.uReflectionTex = { value: null };
        shader.uniforms.uReflectionMatrix = { value: new THREE.Matrix4() };
        // Fine-scale reflection distortion — reuses the SAME loaded
        // ripple-normal texture already driving the material's own
        // lighting normalMap (see `rippleTexture` above), sampled again
        // here as an explicit second reference specifically for
        // perturbing the reflection UV. Kept as its own uniform (not
        // reusing Three's internal normalMap sampler binding directly)
        // since that internal name/timing isn't something to rely on
        // without being able to verify it live.
        shader.uniforms.uDistortTex = { value: rippleTexture };
        // Real refraction — a second offscreen render, owned and updated
        // by main.js the same way the reflection texture is (it's the
        // one place with the real renderer/camera), but rendered from
        // the MAIN camera's own view rather than a reflected one — this
        // is "what the camera would see if the water weren't there,"
        // sampled with simple screen-space UV (gl_FragCoord) rather than
        // the reflection's projective-matrix math, since it's already
        // aligned with the current view.
        shader.uniforms.uRefractionTex = { value: null };
        shader.uniforms.uResolution = { value: new THREE.Vector2(1, 1) };
        // Per explicit "add realistic light scattering on the water mesh
        // to implement natural sunlight caustics" — gates the new
        // caustic pattern below to daylight, same reasoning the existing
        // sun-glitter fade already uses (real caustics need direct
        // sunlight, not moonlight or an overcast sky). A clean, explicit
        // uDayAmount rather than reusing skyColor brightness as a proxy
        // the way sun-glitter's JS-side dayFactor currently does.
        shader.uniforms.uDayAmount = { value: 1 };
        // Per explicit "optimize graphics tiers" — gates the caustic net
        // and sun-glitter contributions below (NOT reflection/refraction,
        // which are a separate, already tier-throttled system via
        // reflectionUpdateInterval and stay untouched here) so Low tier
        // gets a genuinely cheaper fragment shader, not just visually
        // thinner effects still costing the same per-pixel math.
        shader.uniforms.uOceanEffectsEnabled = { value: 1 };
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nattribute float aFoam;\nvarying float vFoam;\nvarying vec2 vFoamPos;\nattribute float aSunGlint;\nvarying float vSunGlint;\nattribute float aReflectionFresnel;\nvarying float vReflectionFresnel;\nattribute vec2 aReflectionDistort;\nvarying vec2 vReflectionDistort;\nuniform mat4 uReflectionMatrix;\nvarying vec4 vReflectionCoord;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFoam = aFoam;\nvFoamPos = position.xz;\nvSunGlint = aSunGlint;\nvReflectionFresnel = aReflectionFresnel;\nvReflectionDistort = aReflectionDistort;\nvReflectionCoord = uReflectionMatrix * modelMatrix * vec4(transformed, 1.0);"); // local-space XZ IS world XZ here — this mesh has no runtime x/z translation or rotation (baked in at creation), only a Y offset. `transformed` at this point already holds the CPU-side wave-displaced position (the real per-frame Gerstner sum written into the position attribute in updateLiquidPlane, not a GPU displacement) — so the reflection coordinate genuinely follows the real wave surface, not a flat approximation of it.
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", `#include <common>
uniform float uTime;
uniform sampler2D uFoamTex;
uniform sampler2D uReflectionTex;
uniform sampler2D uDistortTex;
uniform sampler2D uRefractionTex;
uniform vec2 uResolution;
uniform float uDayAmount;
uniform float uOceanEffectsEnabled;
varying float vFoam;
varying vec2 vFoamPos;
varying float vSunGlint;
varying float vReflectionFresnel;
varying vec2 vReflectionDistort;
varying vec4 vReflectionCoord;
// Compact 2D Worley/Voronoi noise — hashed jittered grid, 3x3 neighbor
// search for the nearest feature point. Cheap enough for two octaves
// per fragment on mobile.
vec2 foamHash(vec2 p) {
  float n = sin(dot(p, vec2(41.0, 289.0)));
  return fract(vec2(262144.0, 32768.0) * n);
}
float foamVoronoi(vec2 p) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float minDist = 1.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 point = foamHash(ip + neighbor);
      minDist = min(minDist, length(neighbor + point - fp));
    }
  }
  return minDist;
}
// F1 AND F2 (nearest + second-nearest feature point) — F2-F1 traces
// thin lines along cell boundaries rather than filled blobs. Same
// technique (and reasoning) as main.js's terrain caustic net and shore
// foam tendrils — added here so open-water whitecaps can have the same
// lacy, branching character instead of only filled bubble clusters.
vec2 foamVoronoiF1F2(vec2 p) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float f1 = 8.0, f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 point = foamHash(ip + neighbor);
      float d = length(neighbor + point - fp);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return vec2(f1, f2);
}`)
          .replace("#include <color_fragment>", `#include <color_fragment>
{
  // Distortion computed ONCE here — two combined scales, same "coarse +
  // fine" layering this file already uses for foam (Voronoi octaves)
  // and normal detail. Coarse: the real per-vertex Gerstner wave slope
  // (vReflectionDistort), so large swells visibly bend what they show.
  // Fine: the loaded ripple-normal texture sampled at the same world-
  // space scale the foam texture already uses, its RG channels remapped
  // from [0,1] tangent-space encoding to a [-1,1] offset direction —
  // small ripples breaking things up at a finer grain than the
  // per-vertex resolution alone could ever produce. Shared by BOTH the
  // refraction and reflection samples below so the two bend consistently
  // with each other, not independently.
  vec2 fineDistort = (texture2D(uDistortTex, vFoamPos * 0.045 + vec2(uTime * 0.01, uTime * 0.007)).rg - 0.5) * 2.0;
  vec2 totalDistort = vReflectionDistort * 0.06 + fineDistort * 0.012;

  // Real refraction — what the seafloor looks like bent through the
  // water surface, viewed from the SAME camera (not a reflected one),
  // per explicit follow-up request. uRefractionTex is rendered by
  // main.js from the main camera each frame with the water hidden —
  // "what this camera would see if the water weren't there." Simple
  // screen-space UV (gl_FragCoord) is correct here since it's already
  // aligned with the current view, unlike the reflection's projective-
  // matrix sampling below. Distortion scaled down from the reflection's
  // own (0.5x) — real refraction bending is present but subtler than a
  // full reflected image would need.
  vec2 screenUv = gl_FragCoord.xy / uResolution;
  vec2 refractionUv = clamp(screenUv + totalDistort * 0.5, 0.001, 0.999);
  vec3 refractionColor = texture2D(uRefractionTex, refractionUv).rgb;
  // vReflectionFresnel is the SAME grazing-angle value used below for
  // the reflection blend — steep viewing angles (low fresnel) let most
  // light actually pass through and refract, so refraction should
  // DOMINATE there; grazing angles (high fresnel) approach total
  // internal reflection, where refraction contributes almost nothing
  // and the reflection block below takes over instead. This is the
  // same physical trade-off real water shows, not two unrelated effects
  // fighting for the same pixel.
  diffuseColor.rgb = mix(refractionColor, diffuseColor.rgb, vReflectionFresnel);

  // Real planar reflection — projective texture lookup, the same
  // standard technique THREE.Water/Reflector use internally, just
  // sampled directly onto this ALREADY wave-displaced surface instead
  // of a separate flat plane. Manual perspective divide (not
  // textureProj, for GLSL ES1/ES3 compatibility) — guard against w<=0
  // (behind the reflection camera / degenerate) so a bad sample can't
  // wrap/smear across the screen.
  if (vReflectionCoord.w > 0.0001) {
    vec2 reflectionUv = vReflectionCoord.xy / vReflectionCoord.w + totalDistort;
    reflectionUv = clamp(reflectionUv, 0.001, 0.999); // distortion can push a coordinate that started safely inside [0,1] slightly outside it — clamp rather than let it wrap/smear from the opposite edge
    if (reflectionUv.x > 0.0 && reflectionUv.x < 1.0 && reflectionUv.y > 0.0 && reflectionUv.y < 1.0) {
      vec3 reflectionColor = texture2D(uReflectionTex, reflectionUv).rgb;
      // vReflectionFresnel is the SAME grazing-angle Fresnel value
      // already computed once per vertex in updateLiquidPlane (JS side)
      // for the existing sky-tint blend — reused here rather than
      // recomputed, so this can't drift out of sync with it. Real
      // reflections are strongest at grazing angles, weakest looking
      // straight down — exactly what this term already models.
      diffuseColor.rgb = mix(diffuseColor.rgb, reflectionColor, vReflectionFresnel * 0.65);
    }
  }
  // Two Voronoi octaves at different scale/drift — big loose bubble
  // clusters plus finer surface foam, rather than one uniform cell size.
  float cellsBig = foamVoronoi(vFoamPos * 0.3 + uTime * 0.035);
  float cellsFine = foamVoronoi(vFoamPos * 1.0 - uTime * 0.06);
  float bubbles = (1.0 - smoothstep(0.0, 0.55, cellsBig)) * 0.65 + (1.0 - smoothstep(0.0, 0.4, cellsFine)) * 0.55;
  bubbles = clamp(bubbles, 0.0, 1.0);
  // Real photo-derived foam texture, tiled and drifting at its own rate
  // (deliberately different from the Voronoi octaves' own 0.035/0.06 so
  // the two never move in visible lockstep). 0.045 UV scale puts roughly
  // one foam-texture tile per ~22 world units — real whitecap-sized
  // patches against an ocean plane hundreds of units across, not one
  // texture stretched over the whole thing (which would look smeared)
  // or repeating so densely it reads as an obvious grid.
  float realFoam = texture2D(uFoamTex, vFoamPos * 0.045 + vec2(uTime * 0.01, uTime * 0.007)).r;
  // Real texture leads (it's far more organic/detailed than the pure
  // procedural pattern alone), Voronoi still contributes secondary
  // variation so the same small tile doesn't read as a visibly repeating
  // stamp at a distance.
  bubbles = clamp(realFoam * 0.75 + bubbles * 0.35, 0.0, 1.0);
  // Lacy branching lines — SAME technique now used for the shore foam
  // and underwater caustic net, per explicit "add the same foam into
  // the waves themselves" request. Only eligible right at the crest
  // edge (a tight vFoam band, not the whole crest region bubbles uses)
  // so it reads as thin streaks trailing off a breaking crest rather
  // than covering the same area as the bubble clusters.
  vec2 waveTendrilUv = vFoamPos * 1.6 + vec2(uTime * 0.08, -uTime * 0.06);
  vec2 wtv = foamVoronoiF1F2(waveTendrilUv);
  float waveTendrilLines = 1.0 - smoothstep(0.0, 0.05, wtv.y - wtv.x);
  float waveTendrilMask = waveTendrilLines * smoothstep(0.35, 0.55, vFoam);
  // vFoam is the raw per-vertex wave-crest disturbance (0..1, interpolated
  // across the triangle) — only the actual crest region should be
  // eligible for foam at all, the Voronoi pattern then decides which
  // pixels within that region actually show it.
  float foamMask = clamp(max(bubbles * smoothstep(0.5, 0.92, vFoam), waveTendrilMask * 0.8), 0.0, 1.0);
  foamMask *= 0.0; // per explicit "try removing all foam" — zeroed rather than the line deleted, for a clean single-line revert once this diagnostic pass is done
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), foamMask);
  // Real specular sun-glitter — vSunGlint is computed per-vertex in
  // updateLiquidPlane (JS side) from the exact analytic Gerstner normal
  // and the real view/sun half-vector, the same trusted values already
  // driving the Fresnel term right next to it there, not new/separate
  // math. Additive (not mixed toward white like the foam above) so it
  // can genuinely blow out brighter than the base albedo the way a real
  // specular highlight does, rather than just capping at flat white.
  diffuseColor.rgb += vec3(1.0, 0.97, 0.85) * vSunGlint * 2.4 * uOceanEffectsEnabled;

  // Per explicit "add realistic light scattering on the water mesh to
  // implement natural sunlight caustics" — a genuinely NEW effect (the
  // water surface had specular sun-glitter already, but nothing tracing
  // a caustic NET pattern). Reuses foamVoronoiF1F2 (the same proven
  // technique already used for foam above and, previously, the terrain's
  // own caustic net) but at its own scale/drift so it reads as a
  // distinct pattern from the foam rather than overlapping it — real
  // underwater caustic nets drift slowly and broadly, much slower than
  // foam breaking on a crest.
  //
  // DELIBERATELY kept bounded and modest THIS time, learning directly
  // from the terrain caustic net's own history: that effect started
  // reasonable but was tuned upward across several separate rounds
  // without ever checking the CUMULATIVE math, until it mathematically
  // peaked around 1.29 added directly onto diffuseColor — enough to
  // blow out to near-white and dominate the entire surface underneath
  // Per explicit "let's see more of this all across the waves" —
  // expanded on confirmed positive feedback (not blind tuning): lines
  // widened for more spatial coverage, Fresnel-gating loosened so the
  // effect has real presence across more viewing angles instead of only
  // concentrating near straight-down, and intensity raised. Still safely
  // bounded — mix() toward a fixed highlight color structurally cannot
  // exceed that color regardless of how far any of these move, same
  // safeguard as before. New verified peak: causticMask maxes at 1.0
  // (clamped), Fresnel term now maxes at 1.0 (0.35 baseline + 0.65 at
  // straight-down), uDayAmount maxes at 1.0, times 0.4 = 0.4 real worst
  // case — a much more present but still genuinely bounded 40% blend at
  // most, not the earlier 22%.
  vec2 causticUv = vFoamPos * 0.5 + vec2(uTime * 0.018, -uTime * 0.013);
  vec2 causticCells = foamVoronoiF1F2(causticUv);
  float causticNet = 1.0 - smoothstep(0.0, 0.075, causticCells.y - causticCells.x);
  // A second, finer octave breaks up the single-frequency look a lone
  // Voronoi net always has — real caustics show layered detail at more
  // than one scale, not one uniform cell size.
  vec2 causticUv2 = vFoamPos * 1.3 - vec2(uTime * 0.011, uTime * 0.021);
  vec2 causticCells2 = foamVoronoiF1F2(causticUv2);
  float causticNet2 = 1.0 - smoothstep(0.0, 0.05, causticCells2.y - causticCells2.x);
  float causticMask = clamp(causticNet * 0.7 + causticNet2 * 0.4, 0.0, 1.0);
  // Fresnel gate loosened — was pure (1.0-fresnel), which suppressed the
  // effect almost entirely at grazing/horizon viewing angles (exactly
  // where the confirmed-good screenshot showed it working well). A 0.35
  // baseline keeps real presence at every angle, still favoring the
  // straight-down case physically like refraction does, just less
  // exclusively.
  float causticFresnelGate = 0.35 + 0.65 * (1.0 - vReflectionFresnel);
  float causticStrength = causticMask * causticFresnelGate * uDayAmount * 0.4 * uOceanEffectsEnabled;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.98, 0.88), causticStrength);
}`);
        m.userData.shader = shader; // so updateLiquidPlane can push uTime each frame
      };
    }
    return m;
  }

  // Crystal used to be ONE material with side:DoubleSide + depthWrite:
  // false — that fixed the close-up "flips between dark and light"
  // symptom (self-transparency z-fighting between front/back faces of a
  // wavy surface) but broke the opposite case: viewed from a distance or
  // elevation at a grazing angle across the whole ocean, a single
  // DoubleSide+depthWrite:false mesh has no way to correctly self-occlude
  // — the GPU rasterizes front AND back triangles in index order with no
  // per-triangle distance sort within one draw call, which showed up as a
  // solid black band across the horizon (clearcoat sampling the
  // environment map with backface-flipped normals in an inconsistent
  // order). Two separate single-sided meshes sharing the SAME geometry
  // fixes both at once: the front mesh (depthWrite:true) handles the
  // common "looking across/down at the ocean" case with normal, correct
  // self-occlusion; the back mesh (depthWrite:false) handles only the
  // close-up "looking up at the underside while submerged" case, which is
  // where the original flicker actually lived. Sharing one `geo` means
  // updateLiquidPlane's per-frame wave/color writes apply to both
  // automatically — no duplicate per-frame work needed.
  let mesh, backMesh = null;
  if (biome === "crystal") {
    mesh = new THREE.Mesh(geo, buildWaterMaterial(THREE.FrontSide, true));
    mesh.position.y = y;
    // Per explicit "flickering between the sky and the water" (happens
    // specifically while moving, not standing still) — this had NO
    // renderOrder at all, while every sky layer (gradient dome, cloud
    // dome, stars/moon/planet — see clouds.js/dayNightCycle.js/main.js)
    // explicitly uses -95 to -101. Without an explicit value here, the
    // water's own depth-sort against those distant sky surfaces at the
    // horizon was left to per-frame floating-point distance comparison —
    // stable while standing still (the same marginal comparison repeats
    // every frame), but exactly the kind of thing camera movement
    // destabilizes, flipping which one wins frame to frame. -50 sits
    // comfortably above every sky layer's own renderOrder, so the water
    // now always wins that comparison outright instead of it being
    // ambiguous.
    mesh.renderOrder = -50;
    scene.add(mesh);
    backMesh = new THREE.Mesh(geo, buildWaterMaterial(THREE.BackSide, false));
    backMesh.position.y = y;
    backMesh.renderOrder = -50;
    scene.add(backMesh);
  } else {
    mesh = new THREE.Mesh(geo, buildWaterMaterial(THREE.FrontSide, true));
    mesh.position.y = y;
    scene.add(mesh);
  }

  // A separate unlit, additively-blended plane just above the surface —
  // gives lava genuine luminous "glow" the way MeshStandardMaterial's own
  // emissive can't on its own once it's subject to the renderer's
  // lighting/tone mapping alongside the day/night cycle. Water doesn't
  // get one — it isn't meant to look lit from within.
  let glow = null;
  let shimmer = null;
  if (style.glowColor !== undefined) {
    const glowGeo = new THREE.PlaneGeometry(size, size, 1, 1);
    glowGeo.rotateX(-Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({
      color: style.glowColor, transparent: true, opacity: style.glowOpacity,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.y = y + 0.05;
    scene.add(glow);

    // Heat shimmer sits a few units above the surface (not on it) so it
    // reads as haze rising off the lava rather than another lava-colored
    // layer — subtle and additive, meant to be almost subliminal up close.
    const shimmerGeo = new THREE.PlaneGeometry(size, size, 1, 1);
    shimmerGeo.rotateX(-Math.PI / 2);
    const shimmerMat = new THREE.MeshBasicMaterial({
      map: createShimmerTexture(), transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
    });
    shimmer = new THREE.Mesh(shimmerGeo, shimmerMat);
    shimmer.position.y = y + 3.5;
    scene.add(shimmer);
  }

  // Small cooled-obsidian chunks drifting on the lava's surface — placed
  // by sampling real terrain height (like grass/flowers/landmarks already
  // do), so they only ever land in spots genuinely low enough to be
  // covered by the lava plane, never floating visibly over solid ground.
  let rocks = null;
  if (biome === "ember" && sampleHeight) {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x120a08, roughness: 0.6, flatShading: true, emissive: 0xff5522, emissiveIntensity: 0.15 });
    const rockGeo = new THREE.IcosahedronGeometry(1, 0); // unit size — actual scale applied per-instance
    const maxRocks = 26;
    const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, maxRocks);
    const dummy = new THREE.Object3D();
    const rockData = [];
    let attempts = 0, placed = 0;
    while (placed < maxRocks && attempts < maxRocks * 12) {
      attempts++;
      const rx = (Math.random() - 0.5) * size * 0.42, rz = (Math.random() - 0.5) * size * 0.42;
      const groundY = sampleHeight(rx, rz);
      if (groundY === null || groundY >= y - 0.3) continue; // only genuinely submerged spots, not right at the lava's edge
      const s = 0.3 + Math.random() * 0.5;
      dummy.position.set(rx, y + 0.05, rz);
      dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      rockMesh.setMatrixAt(placed, dummy.matrix);
      rockData.push({ x: rx, z: rz, seed: Math.random() * Math.PI * 2, bobAmp: 0.03 + Math.random() * 0.04, scale: s });
      placed++;
    }
    rockMesh.count = placed;
    rockMesh.instanceMatrix.needsUpdate = true;
    scene.add(rockMesh);
    rocks = { mesh: rockMesh, data: rockData, baseY: y };
  }

  // Flow-noise octave counts scale with segment density (itself already
  // tier-gated by graphicsSettings) rather than reading a tier name
  // directly — fewer segments already means coarser geometry, so this
  // just keeps the noise detail proportionate instead of spending 3
  // octaves of fbm per vertex on a Low-tier mesh that has few vertices
  // to show it on anyway.
  const crustOctaves = segs >= 40 ? 2 : 1;
  const crackOctaves = segs >= 40 ? 3 : (segs >= 24 ? 2 : 1);

  // Traveling flow-bead droplets — Ember only, same visual language as
  // the volcano's own vein beads for a consistent "the whole biome is
  // alive" feel rather than the volcano being the only thing that
  // visibly flows.
  let flowBeads = null;
  if (biome === "ember") {
    flowBeads = createLavaFlowBeads(normalizeFlow(flowDir), size, 10);
    scene.add(flowBeads.group);
  }

  const basePositions = new Float32Array(posAttr.array); // original Y per vertex, for the ripple to animate around
  // Foam persistence accumulator — per-vertex, decays over real time
  // rather than the previous purely-instantaneous foam (which appeared
  // and vanished in lockstep with the wave signal, no lingering). Own
  // Float32Array on the handle (not a GPU buffer attribute — this is
  // plain per-frame JS state, read/written each updateLiquidPlane call,
  // then copied into aFoam for the shader same as before).
  const foamAccum = biome === "crystal" ? new Float32Array(posAttr.count) : null;

  return {
    mesh, backMesh, glow, shimmer, rocks, waterY: y, basePositions, biome, style, depthColors, shoreDamp,
    flowDir: normalizeFlow(flowDir), crustOctaves, crackOctaves, flowBeads, rippleTexture, foamAccum,
    lastElapsed: undefined, // set on first updateLiquidPlane call — used to derive real per-frame dt for the foam decay above, since this function only receives cumulative elapsed time
  };
}

function updateLiquidPlane(handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon, reflectionTexture, reflectionMatrix, refractionTexture, resolution, stormAmount = 0, dayAmount = 1) {
  if (!handle) return;
  const { mesh, backMesh, glow, shimmer, rocks, basePositions, biome, style, flowDir, crustOctaves, crackOctaves, flowBeads, waterY, rippleTexture, foamAccum } = handle;
  // Real per-frame dt, derived from consecutive elapsed values — this
  // function only ever receives cumulative elapsed time, not a raw
  // per-frame delta, but the foam-persistence decay below needs a real
  // dt to stay frame-rate-independent (same reasoning as everywhere
  // else in this project that already avoids incremental-per-frame
  // accumulation without a real time basis). First call has no prior
  // value to diff against, so dt is 0 that frame only.
  const dt = handle.lastElapsed !== undefined ? Math.max(0, elapsed - handle.lastElapsed) : 0;
  handle.lastElapsed = elapsed;
  // Real planar reflection, sampled DIRECTLY inside the crystal fragment
  // shader below — reflectionTexture/reflectionMatrix are computed and
  // owned by main.js each frame (it's the one place with access to the
  // real renderer/camera needed to render the reflection pass) and
  // handed in here, same pattern already used for sunDir/skyColor. Both
  // optional/undefined-safe: every other biome, and any frame before
  // main.js has set them up, simply skips pushing them.
  if (mesh.material.userData.shader) {
    if (reflectionTexture) mesh.material.userData.shader.uniforms.uReflectionTex.value = reflectionTexture;
    if (reflectionMatrix) mesh.material.userData.shader.uniforms.uReflectionMatrix.value.copy(reflectionMatrix);
  }
  if (backMesh && backMesh.material.userData.shader) {
    if (reflectionTexture) backMesh.material.userData.shader.uniforms.uReflectionTex.value = reflectionTexture;
    if (reflectionMatrix) backMesh.material.userData.shader.uniforms.uReflectionMatrix.value.copy(reflectionMatrix);
  }
  // Real refraction — same ownership pattern as the reflection just
  // above (main.js renders it, this just receives the finished texture
  // + current resolution each frame).
  if (mesh.material.userData.shader) {
    if (refractionTexture) mesh.material.userData.shader.uniforms.uRefractionTex.value = refractionTexture;
    if (resolution) mesh.material.userData.shader.uniforms.uResolution.value.copy(resolution);
    mesh.material.userData.shader.uniforms.uDayAmount.value = dayAmount;
    mesh.material.userData.shader.uniforms.uOceanEffectsEnabled.value = getGraphicsSettings().oceanEffectsEnabled ? 1 : 0;
  }
  if (backMesh && backMesh.material.userData.shader) {
    if (refractionTexture) backMesh.material.userData.shader.uniforms.uRefractionTex.value = refractionTexture;
    if (resolution) backMesh.material.userData.shader.uniforms.uResolution.value.copy(resolution);
    backMesh.material.userData.shader.uniforms.uDayAmount.value = dayAmount;
    backMesh.material.userData.shader.uniforms.uOceanEffectsEnabled.value = getGraphicsSettings().oceanEffectsEnabled ? 1 : 0;
  }
  // Scroll the ripple normal map slowly along the plane's own flow
  // direction — a static (non-scrolling) normal map would still add real
  // per-pixel lighting detail, but it'd be a fixed pattern frozen in
  // place while the geometry waves around underneath it, which reads as
  // "detail painted on" rather than actual moving water surface texture.
  // Absolute position (elapsed * speed), not an incremental += each
  // frame — this file only receives cumulative `elapsed`, not a
  // per-frame dt, so setting the offset directly from elapsed stays
  // exact regardless of frame rate rather than drifting with it.
  if (rippleTexture) {
    const RIPPLE_SCROLL_SPEED = 0.015;
    rippleTexture.offset.set(flowDir.x * elapsed * RIPPLE_SCROLL_SPEED, flowDir.z * elapsed * RIPPLE_SCROLL_SPEED);
  }
  const posAttr = mesh.geometry.attributes.position;
  const colorAttr = mesh.geometry.attributes.color;
  // Crystal writes real analytic Gerstner normals straight into this
  // attribute each frame (see the per-vertex loop below) instead of
  // calling geometry.computeVertexNormals() afterward — the analytic
  // formula is exact for the current frame's exact displacement, where
  // computeVertexNormals() would only be geometrically approximate and
  // (since it'd run after this loop) a frame behind. Every other biome
  // still gets the normal geometric method, called at the end of this
  // function as before.
  const normalAttr = mesh.geometry.attributes.normal;
  // Foam attribute + the onBeforeCompile shader's uTime uniform — both
  // crystal-only (see createLiquidPlane). uTime only needs setting once
  // per frame, not per vertex.
  const foamAttr = biome === "crystal" ? mesh.geometry.attributes.aFoam : null;
  const sunGlintAttr = biome === "crystal" ? mesh.geometry.attributes.aSunGlint : null;
  const reflectionFresnelAttr = biome === "crystal" ? mesh.geometry.attributes.aReflectionFresnel : null;
  const reflectionDistortAttr = biome === "crystal" ? mesh.geometry.attributes.aReflectionDistort : null;
  const foamShader = biome === "crystal" ? mesh.material.userData.shader : null;
  if (foamShader) foamShader.uniforms.uTime.value = elapsed;
  // backMesh has its own separate material (built by its own
  // onBeforeCompile call) even though it shares mesh's geometry, so its
  // foam shader's uTime needs setting independently — not covered by the
  // line above.
  const backFoamShader = (biome === "crystal" && backMesh) ? backMesh.material.userData.shader : null;
  if (backFoamShader) backFoamShader.uniforms.uTime.value = elapsed;
  // Sun direction is passed as sun.position (a world position far from
  // the scene, not a literal direction) — normalizing it directly is a
  // fine approximation of "direction toward the sun" at this distance,
  // the same approximation the old mirror-water reflection used.
  const sunDirUnit = (biome === "crystal" && sunDir) ? sunDir.clone().normalize() : null;
  // Cheap per-vertex ripple for ember/verdant — lava churns slower/
  // heavier, water ripples lighter and faster. A second, higher-
  // frequency/lower-amplitude term layered on top of the main swell adds
  // finer chop instead of one smooth wave shape everywhere. Crystal no
  // longer uses these — its ocean surface is driven by the Gerstner wave
  // sum above instead (see GERSTNER_WAVES).
  const speed = biome === "ember" ? 0.6 : 1.4;
  const amp = biome === "ember" ? 0.18 : 0.16;
  const chopAmp = amp * 0.35;
  const swell2Amp = amp * 0.55;
  const flowSpeed = 0.12; // noise-space units/sec the crust/crack field drifts along flowDir
  const tmpColor = new THREE.Color();
  const tmpDepthColor = new THREE.Color();
  // Subsurface-scattering crest tint and Fresnel grazing-angle rim —
  // Crystal only. Real water isn't opaque: light entering a wave crest
  // scatters inside it and exits toward the viewer tinted by the water
  // itself, brightest right where the crest faces the sun — a bright
  // aqua-green rather than the deep-water base blue. Fresnel is the
  // separate, purely geometric effect of any surface reflecting more of
  // its environment at a grazing viewing angle than head-on — a real sky
  // reflection shows more zenith color looking straight down at the
  // water and more horizon color at a shallow/grazing angle, so this now
  // blends between the day/night cycle's own actual zenith and horizon
  // colors (skyColor/skyHorizon, passed in from dayNightCycle.js each
  // frame) rather than one flat constant tint. fresnelZenith/Horizon are
  // just aliases for clarity; fresnelTint is the single reused Color
  // instance the per-vertex loop writes into, avoiding an allocation per
  // vertex per frame.
  const sssColor = new THREE.Color(0x39e6b5);
  const fresnelZenith = skyColor || new THREE.Color(0xe8f6ff);
  const fresnelHorizon = skyHorizon || fresnelZenith;
  const fresnelTint = new THREE.Color();
  // Water tints toward the current sky color each frame (recomputed fresh,
  // not stored — otherwise it'd drift further every frame instead of
  // tracking the actual sky) — real reflection needs a render-to-texture
  // pass this project doesn't have, but a lake visibly bluer at noon and
  // darker at night reads as "reflective" even without a literal mirror
  // image in it. Lava doesn't get this — it's not reflective, it's lit
  // from within.
  const baseColor = ((biome === "verdant" || biome === "crystal") && skyColor)
    ? style.baseColor.clone().lerp(skyColor, 0.4)
    : style.baseColor;
  // Storm darkening — Coral Shallows only, and only on the freshly
  // cloned instance above (never style.baseColor itself, which is the
  // shared module-level LIQUID_STYLE object every frame and every other
  // call reads from — lerping that in place would permanently corrupt
  // it, compounding a little further every frame).
  if (biome === "crystal" && skyColor && stormAmount > 0) baseColor.lerp(STORM_SEA_COLOR, stormAmount * 0.85);
  // Foam persistence decay factor — real foam lingers for roughly a
  // second or two after a crest passes rather than vanishing the
  // instant the wave signal drops, which is what the previous purely-
  // instantaneous version did. Exponential decay expressed as "fraction
  // remaining after 1 second" so the tuning knob is intuitive, then
  // converted to a real per-frame multiplier via the actual dt above —
  // frame-rate-independent (same decay speed at 30fps and 60fps),
  // unlike a flat per-frame multiplier would be.
  const FOAM_RETENTION_PER_SECOND = 0.35;
  const foamDecayFactor = Math.pow(FOAM_RETENTION_PER_SECOND, dt);
  for (let i = 0; i < posAttr.count; i++) {
    const bx = basePositions[i * 3], bz = basePositions[i * 3 + 2];
    let ripple, range, gerstnerX = bx, gerstnerZ = bz, nx = 0, ny = 1, nz = 0;
    if (biome === "crystal") {
      // Real Gerstner (trochoidal) displacement — each wave component
      // pulls the vertex horizontally toward the crest as well as
      // pushing it up, which is what makes real ocean waves look peaked
      // rather than a symmetric sine bump. Summed across several
      // directional components (see GERSTNER_WAVES above the function)
      // for a genuine rolling-swell-plus-chop ocean surface. The normal
      // (nx, ny, nz) is accumulated analytically alongside the
      // displacement using the standard closed-form Gerstner normal
      // formula, rather than derived after the fact from triangle
      // geometry — exact for this frame's precise wave shape, and what
      // feeds the material's real specular highlights and the Fresnel/
      // SSS terms below.
      let dx = 0, dz = 0, dy = 0, nyTerm = 0;
      // Domain warp applied to the SAMPLE position only (what part of
      // the wave field gets evaluated here), not the vertex's actual
      // base position — dx/dz (horizontal Gerstner displacement) are
      // still added to the real bx/bz below, so the mesh doesn't shift
      // location, only which piece of the combined wave pattern shows
      // up at each point. This is what actually breaks up the "same
      // shape repeating" tell — two vertices at different world
      // positions now sample the wave sum from different EFFECTIVE
      // positions instead of a purely linear function of their real one.
      const [wbx, wbz] = gerstnerDomainWarp(bx, bz, elapsed);
      // Runtime roughness multiplier — Coral Shallows storms read as a
      // genuinely rougher sea, not just a darker-colored calm one. Scales
      // each wave's amplitude-derived contribution uniformly (steepness*
      // amplitude and k*amplitude terms are both linear in amplitude, so
      // substituting a scaled `amp` for `w.amplitude` here is equivalent
      // to having generated the whole GERSTNER_WAVES table at a taller
      // target amplitude, without mutating that shared, module-level
      // table or its baked per-wave steepness values).
      const stormWaveMult = 1 + stormAmount * 0.9;
      // Shore damping — see its own precomputation comment in
      // createLiquidPlane above. Defaults to 1 (no damping) for any
      // biome/plane that didn't precompute it, so this is a no-op
      // everywhere except Coral Shallows.
      const shoreT = handle.shoreDamp ? handle.shoreDamp[i] : 1;
      for (const w of GERSTNER_WAVES) {
        const amp = w.amplitude * stormWaveMult * shoreT;
        const f = w.k * (w.ndx * wbx + w.ndz * wbz) - w.speed * elapsed;
        const s = Math.sin(f), c = Math.cos(f);
        dx += w.steepness * amp * w.ndx * c;
        dz += w.steepness * amp * w.ndz * c;
        dy += amp * s;
        const WA = w.k * amp;
        nx -= w.ndx * WA * c;
        nz -= w.ndz * WA * c;
        nyTerm += w.steepness * WA * s;
      }
      ny = 1 - nyTerm;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen; ny /= nLen; nz /= nLen;
      // Reflection distortion — the horizontal (XZ) components of this
      // exact analytic normal, written unconditionally here (doesn't
      // need playerPos/view vector the way Fresnel/sun-glint do — a
      // wave's slope is the same regardless of where the camera is).
      if (reflectionDistortAttr) reflectionDistortAttr.setXY(i, nx, nz);
      gerstnerX = bx + dx;
      gerstnerZ = bz + dz;
      ripple = dy;
      range = GERSTNER_AMPLITUDE_SUM * stormWaveMult * 2;
    } else {
      // Cheap per-vertex ripple — lava churns slower/heavier, water
      // ripples lighter and faster. A second, higher-frequency/
      // lower-amplitude term layered on top of the main swell adds
      // finer chop instead of one smooth wave shape everywhere.
      const swell = Math.sin(bx * 0.15 + elapsed * speed) * amp + Math.cos(bz * 0.12 + elapsed * speed * 0.8) * amp;
      const chop = Math.sin(bx * 0.55 + bz * 0.4 + elapsed * speed * 2.3) * chopAmp;
      // A slow, large-scale diagonal swell — water only (lava's existing
      // 2-layer churn feeds its own crust/crack heat pattern and stays
      // untouched). Different angle and much lower frequency than the
      // other two layers, so it reads as a genuine second wave system
      // moving through the water rather than just a bigger version of the
      // same ripple.
      const swell2 = biome !== "ember" ? Math.sin((bx + bz) * 0.045 + elapsed * speed * 0.35) * swell2Amp : 0;
      ripple = swell + chop + swell2;
      range = (amp + chopAmp + (biome !== "ember" ? swell2Amp : 0)) * 2;
    }
    // A real reactive ripple around wherever the player currently is —
    // water only, not ambient wave motion. Expanding concentric rings
    // (dist*frequency - elapsed*speed) rather than one static bump, so
    // it reads as a wake propagating outward from them as they move.
    if (playerPos && biome !== "ember") {
      const pdx = bx - playerPos.x, pdz = bz - playerPos.z;
      const pDistSq = pdx * pdx + pdz * pdz;
      const RIPPLE_RADIUS = 4.5;
      if (pDistSq < RIPPLE_RADIUS * RIPPLE_RADIUS) {
        const pDist = Math.sqrt(pDistSq);
        const wave = Math.sin(pDist * 2.4 - elapsed * 6.5) * (1 - pDist / RIPPLE_RADIUS);
        ripple += wave * 0.14;
      }
    }

    // Normalize ripple to 0..1.
    const disturbance = THREE.MathUtils.clamp((ripple + range / 2) / range, 0, 1);

    if (biome === "ember" && style.crustColor) {
      // Sample coordinates drift over time along flowDir — this is what
      // makes the pattern actually flow instead of animating in place.
      const fx = bx * 0.045 - elapsed * flowSpeed * flowDir.x;
      const fz = bz * 0.045 - elapsed * flowSpeed * flowDir.z;

      // Low-frequency layer = cooled dark crust. High-frequency layer,
      // warped by the crust value itself (fx*2.6 + crust*1.6), = the
      // molten cracks running through it — the warp is what keeps the
      // cracks from looking like a generic tiled pattern and gives them
      // the branching, uneven look real fracture networks have.
      const crust = fbm(fx, fz, crustOctaves);
      const cracks = fbm(fx * 2.6 + crust * 1.6, fz * 2.6, crackOctaves);
      let heat = smoothstep(0.46, 0.58, cracks) * (1 - THREE.MathUtils.clamp(crust * 0.8, 0, 1));
      // A touch of the physical ripple folded back in keeps the surface
      // feeling like it's genuinely churning, not just a static crack
      // pattern sliding past.
      heat = THREE.MathUtils.clamp(heat + disturbance * 0.12, 0, 1);

      // 3-band gradient, now driven by heat instead of ripple-disturbance:
      // dark crust -> molten red -> white-hot, with crust dominating at
      // rest and the hot band reserved for genuinely open cracks.
      tmpColor.copy(style.crustColor).lerp(baseColor, THREE.MathUtils.clamp(heat * 1.4, 0, 1));
      if (heat > 0.55) tmpColor.lerp(style.hotColor, (heat - 0.55) / 0.45);

      // Bubbling — a faster, higher-frequency noise layer that also
      // evolves in time (elapsed*0.4 inside the sample), so pockets of
      // extra brightness well up and pop as they drift along with the
      // flow, correlated with their neighbors, instead of each vertex
      // flickering on its own independent clock like before.
      const bubblePulse = fbm(fx * 6 + elapsed * 0.4, fz * 6, 2);
      if (bubblePulse > 0.66) {
        const pop = (bubblePulse - 0.66) / 0.34;
        tmpColor.lerp(style.hotColor, pop * 0.9);
      }

      // Hot cracks bulge very slightly — thinner crust over rising
      // pressure reads as a subtle raised ridge, not just a flat color
      // change.
      posAttr.setY(i, ripple + heat * 0.15);
    } else {
      const accent = style.frothColor;
      // Lowered further with stormAmount — a rough storm sea shows
      // whitecaps over much more of its surface, not just the sharpest
      // crests a calm sea's higher exponent restricts foam to.
      const frothPower = biome === "crystal" ? 1.9 - stormAmount * 0.7 : 3; // nudged lower (was 2.2) for more visible white crest banding per the deep-blue-with-white reference — the earlier "too much distortion" complaint was mainly the separate screen-space distortAmp, not this
      let localBase = baseColor;
      if (handle.depthColors) {
        // Crystal's own per-vertex depth color (lighter over the reef/
        // shoreline, deep blue over open water) — same sky-reflection
        // blend the flat baseColor gets elsewhere, just applied per
        // vertex here instead of once globally.
        tmpDepthColor.fromArray(handle.depthColors, i * 3);
        if (skyColor) tmpDepthColor.lerp(skyColor, 0.4);
        if (biome === "crystal" && stormAmount > 0) tmpDepthColor.lerp(STORM_SEA_COLOR, stormAmount * 0.85); // tmpDepthColor is a reused per-frame temp (see its declaration above), safe to mutate further — unlike style.baseColor, nothing shared gets corrupted
        localBase = tmpDepthColor;
      }
      tmpColor.copy(localBase).lerp(accent, Math.pow(disturbance, frothPower));
      if (biome === "crystal") {
        // Subsurface scattering — brightest where a wave crest faces the
        // sun (positive normal·sunDir) and only near an actual crest
        // (disturbance close to 1, squared to keep it from washing out
        // the troughs too). Real light passing through thin water at a
        // crest exits tinted aqua-green rather than the deep base blue.
        if (sunDirUnit) {
          const nDotL = Math.max(0, nx * sunDirUnit.x + ny * sunDirUnit.y + nz * sunDirUnit.z);
          const sss = nDotL * disturbance * disturbance;
          if (sss > 0) tmpColor.lerp(sssColor, Math.min(1, sss) * 0.65);
        }
        // Fresnel — the classic grazing-angle brightening every real
        // surface shows, computed from the actual view vector (camera
        // minus this vertex's current world position) against the exact
        // analytic normal above. No environment map to literally
        // reflect, so blended toward the sky's own current color
        // instead — and specifically toward more horizon color at a
        // shallow/grazing angle, more zenith color when viewed closer to
        // overhead, matching how a real sky reflection actually shifts
        // with viewing angle rather than one flat tint regardless of it.
        if (playerPos) {
          const wx = gerstnerX, wyWorld = waterY + ripple, wz = gerstnerZ;
          let vx = playerPos.x - wx, vy = (cameraY !== undefined ? cameraY : playerPos.y) - wyWorld, vz = playerPos.z - wz;
          const vLen = Math.hypot(vx, vy, vz) || 1;
          vx /= vLen; vy /= vLen; vz /= vLen;
          const viewDot = Math.abs(nx * vx + ny * vy + nz * vz);
          const grazing = THREE.MathUtils.clamp(1 - viewDot, 0, 1);
          const fresnel = Math.pow(grazing, 3);
          fresnelTint.copy(fresnelZenith).lerp(fresnelHorizon, grazing);
          tmpColor.lerp(fresnelTint, fresnel * 0.55);
          // Real planar reflection blend strength — reuses this SAME
          // grazing-angle fresnel value (not recomputed) so the new
          // reflection sampling in the fragment shader can't drift out
          // of sync with the sky-tint blend right above it.
          if (reflectionFresnelAttr) reflectionFresnelAttr.setX(i, fresnel);
          // Sun-glitter — real specular sparkle toward the sun, per
          // explicit request to get closer to a reference photo showing
          // a bright glinting streak across the water. Reuses the SAME
          // view vector (vx,vy,vz) and analytic normal (nx,ny,nz) the
          // Fresnel term right above just computed — no separate/
          // duplicate math, so this can't drift out of sync with it.
          // Half-vector (Blinn-Phong) between view and sun direction —
          // standard, well-understood specular math, deliberately kept
          // simple since GLSL correctness can't be live-verified in this
          // environment; the JS side here IS verifiable/testable logic.
          if (sunGlintAttr && sunDirUnit) {
            let hx = vx + sunDirUnit.x, hy = vy + sunDirUnit.y, hz = vz + sunDirUnit.z;
            const hLen = Math.hypot(hx, hy, hz) || 1;
            hx /= hLen; hy /= hLen; hz /= hLen;
            const nDotH = Math.max(0, nx * hx + ny * hy + nz * hz);
            // Exponent now varies with wave height (disturbance, already
            // computed above: 0 at trough, 1 at crest) instead of a flat
            // 300 everywhere — per explicit "crest-vs-trough specular
            // sharpness" request. Real water shows tight, sharp glints
            // right at wave crests and a softer, broader sheen in the
            // smoother troughs; a single fixed exponent couldn't capture
            // that difference. 150 (soft) at trough up to 450 (tight) at
            // crest — same underlying Blinn-Phong math, just a per-vertex
            // sharpness instead of a constant.
            const glintExponent = 150 + disturbance * 300;
            const glintCore = Math.pow(nDotH, glintExponent);
            // Per-vertex, time-varying sparkle mask — real glitter is
            // countless individual wave facets twinkling independently,
            // not one smooth highlight; this project's per-vertex (not
            // per-pixel) resolution can't reproduce that exactly, but a
            // spatial hash animated over time gives a genuine twinkling
            // scatter of glints across the lit area instead of one flat
            // blob, which reads much closer to real sun glitter.
            const sparkleSeed = hash2(Math.floor(bx * 2.2), Math.floor(bz * 2.2));
            const sparkleTime = 0.5 + 0.5 * Math.sin(elapsed * 4.2 + sparkleSeed * 62.8);
            const dayFactor = THREE.MathUtils.clamp((skyColor ? skyColor.r + skyColor.g + skyColor.b : 1) / 1.2, 0, 1); // fades out at night the same general way the sky itself darkens — no separate dayAmount param passed into this function, skyColor is the closest already-available signal
            sunGlintAttr.setX(i, glintCore * (0.25 + 0.75 * sparkleTime) * dayFactor);
          } else if (sunGlintAttr) {
            sunGlintAttr.setX(i, 0);
          }
        } else if (sunGlintAttr) {
          sunGlintAttr.setX(i, 0);
        }
        if (reflectionFresnelAttr && !playerPos) reflectionFresnelAttr.setX(i, 0);
        // Real vertical wave height restored — a previous round had this
        // flattened to 0 to move ALL visible wave motion onto a separate
        // mirror plane, which has since been removed entirely in favor
        // of sampling a real planar reflection directly onto THIS
        // genuinely wave-displaced geometry. That only works if this
        // mesh actually displaces again.
        posAttr.setXYZ(i, gerstnerX, ripple, gerstnerZ);
        normalAttr.setXYZ(i, nx, ny, nz);
        // Foam persistence — this vertex's foam is the LOUDER of (a) its
        // real instantaneous disturbance right now, or (b) whatever was
        // there last frame, decayed toward zero. `max` (not blend) is
        // what gives a genuine "instant rise, slow fade" shape — real
        // foam froths up fast when a crest breaks, then lingers and
        // drains away gradually, not a symmetric ease in/out.
        const persistedFoam = Math.max(disturbance, (foamAccum[i] || 0) * foamDecayFactor);
        foamAccum[i] = persistedFoam;
        foamAttr.setX(i, persistedFoam); // shaped signal now (still smoothstepped/threshold-masked further in the fragment shader on top of this)
      } else {
        posAttr.setY(i, ripple);
      }
    }
    tmpColor.toArray(colorAttr.array, i * 3);
  }
  posAttr.needsUpdate = true;
  colorAttr.needsUpdate = true;
  if (biome === "crystal") {
    normalAttr.needsUpdate = true; // written analytically above, per-frame — skip the geometric recompute below
    foamAttr.needsUpdate = true;
    sunGlintAttr.needsUpdate = true;
    reflectionFresnelAttr.needsUpdate = true;
    reflectionDistortAttr.needsUpdate = true;
  } else {
    mesh.geometry.computeVertexNormals();
  }

  // Lava also gets a slow overall "breathing" pulse in its base emissive
  // intensity, independent of the spatial hot-spot pattern above — reads
  // as the whole surface swelling with heat, not just individual crests
  // glinting. The separate glow overlay pulses in sync, a touch more
  // strongly, since it's what actually sells "this is a light source."
  if (biome === "ember") {
    const pulse = 0.85 + 0.25 * Math.sin(elapsed * 0.9);
    mesh.material.emissiveIntensity = style.emissiveIntensity * pulse;
    // Proximity — standing right at a crack's edge should feel hotter
    // than glancing at lava from across the terrain. cameraY vs. the
    // lava plane's own Y is a cheap but effective proxy: the closer the
    // player's actual height is to the lava's level, the more likely
    // they're standing right at (or leaning over) a crack.
    const heightDiff = cameraY !== undefined ? Math.abs(cameraY - mesh.position.y) : 20;
    const proximity = THREE.MathUtils.clamp(1 - heightDiff / 10, 0, 1);
    if (glow) glow.material.opacity = style.glowOpacity * (0.75 + 0.4 * Math.sin(elapsed * 0.9)) * (1 + proximity * 0.8);
    if (shimmer) {
      shimmer.material.map.offset.set(Math.sin(elapsed * 0.25) * 0.3, (elapsed * 0.12) % 1); // upward scroll + gentle sideways wobble, not a static texture
      shimmer.material.opacity = 0.18 + proximity * 0.35;
    }
    if (flowBeads) updateLavaFlowBeads(flowBeads, elapsed, mesh.position.y);
  }

  // Cooled rock chunks bob gently with the same ripple rhythm the lava
  // itself uses, plus a slow lazy drift — floating debris, not glued to
  // a fixed point.
  if (rocks) {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < rocks.data.length; i++) {
      const r = rocks.data[i];
      const bob = Math.sin(elapsed * 0.7 + r.seed) * r.bobAmp;
      const driftX = r.x + Math.sin(elapsed * 0.08 + r.seed) * 0.6;
      const driftZ = r.z + Math.cos(elapsed * 0.08 + r.seed) * 0.6;
      dummy.position.set(driftX, rocks.baseY + 0.05 + bob, driftZ);
      dummy.rotation.set(r.seed, elapsed * 0.15 + r.seed, r.seed * 0.5);
      dummy.scale.setScalar(r.scale);
      dummy.updateMatrix();
      rocks.mesh.setMatrixAt(i, dummy.matrix);
    }
    rocks.mesh.instanceMatrix.needsUpdate = true;
  }

}

function disposeLiquidPlane(scene, handle) {
  if (!handle) return;
  scene.remove(handle.mesh);
  if (handle.backMesh) scene.remove(handle.backMesh);
  if (handle.glow) scene.remove(handle.glow);
  if (handle.shimmer) scene.remove(handle.shimmer);
  if (handle.rocks) scene.remove(handle.rocks.mesh);
  if (handle.flowBeads) scene.remove(handle.flowBeads.group);
  riftDeferDispose(() => {
    handle.mesh.geometry.dispose();
    handle.mesh.material.dispose();
    // handle.rippleTexture IS disposed here — it's a per-instance clone
    // (see createLiquidPlane), not the shared module-level cached texture,
    // so this plane owns it exclusively. The shared original stays
    // resident, same reasoning as clouds.js's own realisticCloudTexture.
    if (handle.rippleTexture) handle.rippleTexture.dispose();
    if (handle.backMesh) {
      // Shares handle.mesh's geometry (see createLiquidPlane) — already
      // disposed above, only the material is this mesh's own.
      handle.backMesh.material.dispose();
    }
    if (handle.glow) {
      handle.glow.geometry.dispose();
      handle.glow.material.dispose();
    }
    if (handle.shimmer) {
      handle.shimmer.geometry.dispose();
      handle.shimmer.material.map.dispose();
      handle.shimmer.material.dispose();
    }
    if (handle.rocks) {
      handle.rocks.mesh.geometry.dispose();
      handle.rocks.mesh.material.dispose();
    }
    if (handle.flowBeads) {
      for (const b of handle.flowBeads.beads) {
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
      }
    }
  });
}


export { createLiquidPlane, updateLiquidPlane, disposeLiquidPlane, createWaterfall, updateWaterfall, disposeWaterfall, createRiverCurrent, updateRiverCurrent, disposeRiverCurrent, createRiverFlowStrip, updateRiverFlowStrip, disposeRiverFlowStrip, createCliffWall, disposeCliffWall, createSourcePond, updateSourcePond, disposeSourcePond, createOceanSurfaceDetail, updateOceanSurfaceDetail, disposeOceanSurfaceDetail };

// Ocean surface detail — Coral Shallows only. DISABLED entirely per
// explicit follow-up request, after two rounds of trying to fix the
// whitecap Points system (untextured "glitter" removed as flat squares
// in FU143, then the surviving whitecaps' horizon-distance flicker
// fixed by capping their scatter radius in FU145) — rather than
// continuing to patch a system built on sizeAttenuated Points (which
// are inherently prone to this class of distance-based flicker), it's
// removed outright. The real per-pixel wave-crest foam shader added to
// the crystal material's onBeforeCompile block (see above) already
// covers dynamic surface foam/highlight far better than scattered
// Points ever did anyway. Returns null; updateOceanSurfaceDetail and
// disposeOceanSurfaceDetail already null-guard (`if (!handle) return;`),
// and main.js's own submersion-visibility toggle is already wrapped in
// `if (oceanSurfaceDetailHandle)`, so this needs no other changes
// anywhere, including main.js.
function createOceanSurfaceDetail(scene, y, size) {
  return null;
}

function updateOceanSurfaceDetail(handle, elapsed, dayAmount = 1) {
  if (!handle) return;
  // Whitecaps breathe very slowly and subtly — real chop doesn't flicker,
  // it just varies gradually in how much foam is visible at once.
  handle.whitecaps.material.opacity = 0.42 + Math.sin(elapsed * 0.3) * 0.08;
}

function disposeOceanSurfaceDetail(scene, handle) {
  if (!handle) return;
  scene.remove(handle.whitecaps);
  riftDeferDispose(() => {
    handle.whitecaps.geometry.dispose();
    handle.whitecaps.material.dispose();
  });
}
