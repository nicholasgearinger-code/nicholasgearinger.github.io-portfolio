import * as THREE from "three";
import {
  Fn, instanceIndex, instancedArray, float, uint, If,
  uniform, vec3, vec2, color, positionLocal, mix, clamp,
  min, max, attribute, time, sin, cos, fract, floor, dot, cross,
  pow, positionWorld, cameraPosition, normalWorld, reflect,
  uniformArray, texture, uv, modelViewMatrix, cameraProjectionMatrix, hash, smoothstep as tslSmoothstep, vertexColor,
} from "three/tsl";
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

// Same WebGPU null-image fix as main.js's own copy of this helper (see
// its comment there for the full explanation) — a freshly-created
// THREE.Texture's `.image` is `null` until TextureLoader's async fetch
// completes, and WebGPURenderer's Textures.updateTexture reads
// `image.complete` with no null-check, throwing on any frame rendered
// before the photo arrives. This file has its own TextureLoader calls
// (getRippleNormalTexture, getFoamDetailTexture) separate from main.js's,
// so it needs its own copy of this helper — ES modules don't share scope.
function riftEnsureTextureImage(texture) {
  if (!texture.image) {
    const placeholderCanvas = document.createElement("canvas");
    placeholderCanvas.width = 1;
    placeholderCanvas.height = 1;
    texture.image = placeholderCanvas;
  }
  return texture;
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
  // Per explicit "increase mesh displacement for more up and down waves"
  // — a single multiplier applied uniformly across the whole spectrum
  // here, rather than hand-editing each of the 15 components' own
  // amplitude values individually. Scales real vertical motion up
  // without touching direction/wavelength/speed/steepness, so the
  // wave SHAPE and travel behavior stay exactly as already tuned —
  // only how far up and down the surface actually moves changes.
  const AMPLITUDE_BOOST = 1.6;
  return { ndx: w.dirX / len, ndz: w.dirZ / len, k: (Math.PI * 2) / w.wavelength, amplitude: w.amplitude * AMPLITUDE_BOOST, speed: w.speed, steepness: w.steepness };
});
const GERSTNER_AMPLITUDE_SUM = GERSTNER_WAVES.reduce((sum, w) => sum + w.amplitude, 0);
// Real GPU-side (TSL) copy of the exact same 15-component spectrum above
// (10 near + 5 far) — per explicit "rebuild it to look realistic using
// the best tool we have." These are NOT re-derived/approximated: each
// number was obtained by actually RUNNING the JS generator above (same
// methodology already used once for the terrain caustics' own Gerstner
// sync in main.js) and transcribing its real output, so the GPU-driven
// wave shape is numerically identical to this file's own CPU spectrum,
// not just visually similar. Every wave's steepness independently
// verified to already be hitting its own safety cap (0.5, the max this
// formula allows before self-intersecting loops become possible) — the
// underlying math was already at its sharpest safe setting; the real
// bottleneck was mesh resolution, capped by this exact computation
// previously having to run per-vertex on the CPU every frame. Moving it
// to a TSL positionNode (see buildWaterMaterial) removes that
// bottleneck, since the SAME analytic (non-iterative, non-simulated —
// still the stable closed-form Gerstner equation, not the earlier
// abandoned fluid-sim's discretized wave equation) formula now
// evaluates in parallel across however many vertices the mesh actually
// has, instead of costing linear CPU time per vertex per frame.
// Per explicit "increase mesh displacement for more up and down waves" —
// same AMPLITUDE_BOOST multiplier as GERSTNER_WAVES above, applied here
// too since this is the array that actually drives the real-time
// positionNode displacement (see this array's own comment above) —
// boosting only the CPU copy would have left the visible GPU-driven
// water completely unchanged.
const GERSTNER_WAVES_TSL = [
  { ndx: 0.957826, ndz: 0.287348, k: 0.1496, amplitude: 0.448603 * 1.6, speed: 1.9, steepness: 0.5 },
  { ndx: 0.295404, ndz: 0.955372, k: 0.199142, amplitude: 0.336999 * 1.6, speed: 1.646785, steepness: 0.5 },
  { ndx: 0.405755, ndz: -0.913982, k: 0.265092, amplitude: 0.253161 * 1.6, speed: 1.427317, steepness: 0.5 },
  { ndx: 0.128265, ndz: 0.99174, k: 0.352883, amplitude: 0.190179 * 1.6, speed: 1.237097, steepness: 0.5 },
  { ndx: 0.999244, ndz: 0.038884, k: 0.469747, amplitude: 0.142866 * 1.6, speed: 1.072228, steepness: 0.5 },
  { ndx: 0.883834, ndz: -0.4678, k: 0.625312, amplitude: 0.107324 * 1.6, speed: 0.929331, steepness: 0.5 },
  { ndx: -0.120653, ndz: 0.992695, k: 0.832396, amplitude: 0.080624 * 1.6, speed: 0.805478, steepness: 0.5 },
  { ndx: 0.544216, ndz: -0.838945, k: 1.10806, amplitude: 0.060566 * 1.6, speed: 0.698131, steepness: 0.5 },
  { ndx: 0.704654, ndz: 0.709551, k: 1.475016, amplitude: 0.045498 * 1.6, speed: 0.605091, steepness: 0.5 },
  { ndx: 0.663943, ndz: 0.747783, k: 1.963495, amplitude: 0.034179 * 1.6, speed: 0.52445, steepness: 0.5 },
  { ndx: 0.957826, ndz: 0.287348, k: 0.069813, amplitude: 0.411886 * 1.6, speed: 2.6, steepness: 0.5 },
  { ndx: 0.295404, ndz: 0.955372, k: 0.096164, amplitude: 0.299021 * 1.6, speed: 2.215315, steepness: 0.5 },
  { ndx: 0.405755, ndz: -0.913982, k: 0.132461, amplitude: 0.217083 * 1.6, speed: 1.887547, steepness: 0.5 },
  { ndx: 0.128265, ndz: 0.99174, k: 0.182459, amplitude: 0.157598 * 1.6, speed: 1.608274, steepness: 0.5 },
  { ndx: 0.999244, ndz: 0.038884, k: 0.251327, amplitude: 0.114413 * 1.6, speed: 1.37032, steepness: 0.5 },
];

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
  rippleNormalTexture = riftEnsureTextureImage(new THREE.TextureLoader().load(
    url,
    () => console.log("[liquid] ripple normal texture loaded:", url),
    undefined,
    (err) => console.error("[liquid] ripple normal texture FAILED to load:", url, err)
  ));
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
  foamDetailTexture = riftEnsureTextureImage(new THREE.TextureLoader().load(
    url,
    () => console.log("[liquid] foam detail texture loaded:", url),
    undefined,
    (err) => console.error("[liquid] foam detail texture FAILED to load:", url, err)
  ));
  foamDetailTexture.wrapS = foamDetailTexture.wrapT = THREE.RepeatWrapping;
  return foamDetailTexture;
}

// -----------------------------------------------------------------------------
// SWAP POINT: real WebGPU compute-shader fluid simulation, Coral Shallows
// water only — genuine finite-difference wave physics (neighbor-based
// Laplacian, the same technique the standalone fluid-sim prototype proved
// working in-browser), replacing the CPU-side Gerstner-sum approximation
// every other biome (and crystal itself, when this flag is off) still
// uses. Single flip-point, same discipline as CRYSTAL_WATER_SHADER_ENABLED
// above — createLiquidPlane branches to this ENTIRELY SEPARATE, self-
// contained function before touching any of the existing shared geo/
// posAttr/colors setup below, so flipping this off is a full, clean
// revert to the known-working Gerstner path with zero risk of leftover
// state from this one.
//
// STAGE 1 SCOPE (deliberately, not an oversight — see chat plan): real
// wave motion + real per-vertex normals only. Explicitly NOT included yet:
// shore damping (the prototype's shore formula assumes a straight
// coastline along one axis, which is WRONG for Coral Shallows' actual
// irregular island shape — porting it as-is would look correct only in
// one direction; real terrain-aware shore damping is its own follow-up
// stage, not guessed at here), foam, reflection, refraction, rain-ripple
// reactivity, and the pointer/wake-trail interaction system (demo-input-
// specific, not yet wired to real player position). The whole plane
// behaves as uniform open ocean for now.
// Per explicit "should we try another algorithm, Gerstner looks good" —
// reverted to false. The real reason to switch, beyond preference: the
// existing CPU-side Gerstner system (GERSTNER_WAVES below, real 10-wave
// trochoidal spectrum + far-field waves, actual deep-water dispersion,
// domain warping) writes displaced positions via plain posAttr.setXYZ()
// calls — a completely standard, renderer-agnostic geometry attribute
// update, identical under WebGL or WebGPU. It was NEVER actually broken
// by the WebGPU migration; only the separate foam/reflection SHADING
// layer (onBeforeCompile, already disabled via
// CRYSTAL_WATER_SHADER_ENABLED above) was the incompatible part. This
// compute-shader system was built to replace something that didn't
// need replacing, and cost real time chasing a whole class of bugs
// (CFL numerical instability, TSL time-node quirks under compute-only
// dispatch) that a pure analytic per-frame evaluation like Gerstner
// simply doesn't have — there's no iterative state to destabilize.
// It also already has real sun glint (with day/night fade), foam with
// genuine "instant rise, slow fade" persistence, and shore damping
// already tuned through past iteration — all more complete than what
// this compute path had built up. Left in place, still working and
// still flag-gated, in case a future real use case specifically needs
// GPU-compute wave physics (crowds of interactive objects genuinely
// disturbing the surface, for instance) — but that's a different
// problem than "make Coral Shallows' ocean look right," which the
// existing Gerstner system already solves.
const CRYSTAL_FLUID_SIM_ENABLED = false;
// Per "tanking performance" — lowered back from 256. The world-space
// chop/swell fix (see computeUpdate below) already decoupled visible
// wavelength from grid resolution, which was the ONLY reason 256 was
// tried in the first place — so there's no real visual reason left to
// keep the 4x compute+vertex cost 256 carries over 128. This is both the
// compute-shader cell count AND the render mesh's actual vertex count
// (WIDTH*WIDTH each), so it's a direct, real lever on both costs at
// once, not just one of them.
const FLUID_SIM_WIDTH = 128;
const fluidSimHash21 = Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031));
  const p3b = p3.add(vec3(dot(p3, p3.add(vec3(33.33, 33.33, 33.33))).add(0)));
  return fract(p3b.x.add(p3b.y).mul(p3b.z));
});

function buildCrystalFluidSimPlane(scene, y, size, sampleHeight) {
  const WIDTH = FLUID_SIM_WIDTH;
  const CELL_COUNT = WIDTH * WIDTH;

  const heightBufferA = instancedArray(CELL_COUNT, "float");
  const heightBufferB = instancedArray(CELL_COUNT, "float");
  const velocityBuffer = instancedArray(CELL_COUNT, "float");
  let heightBufferNode = heightBufferA; // always points at the buffer computeUpdate currently reads FROM — swapped by updateFluidSimWater each frame

  // Per "water physics are not working" — confirmed via real pixel-
  // diffing of a phone recording AND the on-screen dispatch counter
  // together: dispatch genuinely runs continuously (#7789 and climbing),
  // yet the surface is completely static. That combination points at
  // TSL's built-in `time` node specifically — it's normally driven by
  // renderer.render()'s per-frame update cycle, and this shader is only
  // ever dispatched via renderer.compute(), never render(). If `time`
  // isn't actually advancing inside a compute-only context, every
  // dispatch injects the identical frozen wave-forcing value — with the
  // light damping (0.994) here, a lightly-damped system driven by
  // CONSTANT forcing will genuinely settle into a true static
  // equilibrium within a few seconds and stay there, which matches
  // exactly what thousands of successful-but-invisible dispatches would
  // look like. Rather than depend on uncertain built-in update timing,
  // this is a real, self-managed uniform — explicitly set from main.js's
  // own already-tracked elapsedTime every frame (see updateFluidSimWater
  // below), completely independent of whatever renderer.compute() does
  // or doesn't do to the global time node.
  const fluidTimeUniform = uniform(0);

  // Real shore damping, Stage 2 — per "too much wave going onto the land."
  // Precomputed ONCE here in plain JS using the REAL terrain heightfield
  // (sampleHeight, the same callback the old Gerstner path already used
  // for its own per-vertex shoreDamp array), not the prototype's
  // straight-line shore formula, which would be wrong for Coral
  // Shallows' actual irregular island coastline. 0 at/above the real
  // shoreline (no wave energy at all right at the sand), ramping to 1 by
  // SHORE_DAMP_DEPTH units of real depth — same constant and same
  // falloff shape the old system used, so this reads consistently with
  // how shore damping already looks everywhere else in this project.
  // instancedArray() accepts a pre-filled Float32Array directly (not
  // just a cell count) to seed a real GPU storage buffer with this CPU-
  // computed data — confirmed via Three.js's own TSL examples, not
  // guessed at.
  const SHORE_DAMP_DEPTH = 3.5;
  const shoreDampData = new Float32Array(CELL_COUNT);
  if (sampleHeight) {
    for (let sy = 0; sy < WIDTH; sy++) {
      for (let sx = 0; sx < WIDTH; sx++) {
        const worldX = (sx / WIDTH - 0.5) * size;
        const worldZ = (sy / WIDTH - 0.5) * size;
        const groundY = sampleHeight(worldX, worldZ);
        const depth = y - groundY; // positive = real water depth at this cell; negative/zero = dry land
        const damp = Math.max(0, Math.min(1, depth / SHORE_DAMP_DEPTH));
        shoreDampData[sy * WIDTH + sx] = damp;
      }
    }
  } else {
    shoreDampData.fill(1); // no terrain sampler given — behaves as open ocean everywhere, same as Stage 1
  }
  const shoreDampBuffer = instancedArray(shoreDampData, "float");

  const computeInit = Fn(() => {
    heightBufferA.element(instanceIndex).assign(0);
    heightBufferB.element(instanceIndex).assign(0);
    velocityBuffer.element(instanceIndex).assign(0);
  })().compute(CELL_COUNT);

  // The real wave equation — acceleration proportional to how far this
  // cell's height differs from the average of its neighbors (the
  // discrete Laplacian). Edges CLAMPED (re-reading the edge cell's own
  // value) rather than wrapped, so waves reflect inward off the plane's
  // boundary like a real pool wall instead of teleporting to the far
  // side. Directly ported from the confirmed-working prototype, only
  // WIDTH/size-related constants changed to match this plane's real
  // dimensions.
  const computeUpdate = Fn(() => {
    const i = instanceIndex;
    const x = i.mod(uint(WIDTH)).toFloat();
    const yy = i.div(uint(WIDTH)).toFloat();
    const self = heightBufferA.element(i);

    const xm = max(x.sub(1), float(0));
    const xp = min(x.add(1), float(WIDTH - 1));
    const ym = max(yy.sub(1), float(0));
    const yp = min(yy.add(1), float(WIDTH - 1));

    const idxL = yy.mul(WIDTH).add(xm).toUint();
    const idxR = yy.mul(WIDTH).add(xp).toUint();
    const idxU = ym.mul(WIDTH).add(x).toUint();
    const idxD = yp.mul(WIDTH).add(x).toUint();

    const left = heightBufferA.element(idxL);
    const right = heightBufferA.element(idxR);
    const up = heightBufferA.element(idxU);
    const down = heightBufferA.element(idxD);

    const laplacian = left.add(right).add(up).add(down).sub(self.mul(4));
    // Per "moves at first then settles and stops, a lot of flickering" —
    // this is almost certainly numerical instability, not a real
    // architectural bug: waveSpeed=1.4 was ported directly from the
    // prototype's own 40-unit demo plane, but this grid's cells are
    // ~50x larger in real-world size (2000-unit plane / 128 cells here,
    // vs 40 / 128 there) and the Laplacian term below is never
    // normalized by actual cell spacing — so the same constant behaves
    // completely differently at this scale. An explicit finite-
    // difference wave scheme run past its stability threshold produces
    // exactly this signature: looks fine briefly, then decays into
    // chaotic high-frequency noise that reads as "stopped" because it's
    // no longer coherent motion. Cut substantially as the direct,
    // standard fix for exactly this failure mode — worth confirming
    // live, this isn't something I can verify without running it.
    const waveSpeed = float(0.35);
    const damping = float(0.985); // slightly heavier than before (0.994) — extra margin to actively damp out any residual instability rather than only barely tolerating it

    // Real shore damping (see shoreDampBuffer above) — 0 at/above the
    // actual shoreline, 1 in genuine open water. Applied to the PHYSICS
    // velocity itself (not just a decorative visual cutoff layered on
    // top), same as the old Gerstner system's own shoreDamp — a real
    // wave loses energy shoaling into shallow water, this is that
    // mechanism, not an approximation of it.
    const shoreDamp = shoreDampBuffer.element(i);
    const newVelocity = velocityBuffer.element(i).add(laplacian.mul(waveSpeed)).mul(damping).mul(shoreDamp);
    velocityBuffer.element(i).assign(newVelocity);
    let newHeight = self.add(newVelocity.mul(0.05));

    // Ambient ocean chop — three overlapping sine waves at different
    // scales/directions/speeds (real wind-driven chop has no single
    // dominant direction/period) plus small per-cell phase jitter so the
    // result reads as organic texture rather than a geometrically clean,
    // obviously-periodic pattern.
    //
    // Uses REAL WORLD-SPACE position (cellWorldX/Z), not raw cell index
    // (x/yy) — the prototype's own version used cell index directly,
    // which was fine on its 40-unit demo plane but meant visual wave
    // wavelength was entirely a function of grid resolution rather than
    // real distance. On Coral Shallows' actual 2000-unit ocean that
    // produced technically-real but essentially invisible waves spanning
    // hundreds of world units. World-space frequencies below keep the
    // wavelength meaningful (tens of units, roughly ocean-swell-to-chop
    // scale) regardless of how many cells the grid actually has.
    const cellWorldX = x.div(float(WIDTH)).sub(0.5).mul(float(size));
    const cellWorldZ = yy.div(float(WIDTH)).sub(0.5).mul(float(size));
    const jitter = fluidSimHash21(vec2(cellWorldX.mul(0.05), cellWorldZ.mul(0.05))).sub(0.5).mul(0.4);
    // Per "wave motion could be slower" — time multipliers cut roughly
    // in half across chop and the dominant swell below.
    const chop1 = sin(cellWorldX.mul(0.28).add(cellWorldZ.mul(0.11)).add(fluidTimeUniform.mul(0.65)).add(jitter));
    const chop2 = sin(cellWorldX.mul(0.14).sub(cellWorldZ.mul(0.22)).sub(fluidTimeUniform.mul(0.45)).add(jitter.mul(0.7)));
    const chop3 = sin(cellWorldX.mul(0.5).add(cellWorldZ.mul(0.4)).add(fluidTimeUniform.mul(0.85)).add(1.7).add(jitter.mul(1.3)));
    const chop = chop1.mul(0.4).add(chop2.mul(0.3)).add(chop3.mul(0.2));
    // Per "just some animated ripples, no movement" — chop1/2/3 above are
    // all similarly fast/short-wavelength, so together they read as fine
    // shimmer/texture rather than actual rolling waves. Real ocean swell
    // is dominated by ONE much longer, much slower wave train underneath
    // the finer chop, not several similarly-scaled ones — this is that
    // missing dominant term: long wavelength (~90 units), slow period
    // (~9s), and deliberately the largest single contributor to height
    // here, with chop layered on top as surface detail rather than being
    // the only thing moving.
    // Per "behave more like realistic ocean waves" — real ocean swell
    // isn't a symmetric sine wave: it has sharp, narrow CRESTS and
    // broad, flat TROUGHS (the classic trochoidal/Gerstner shape), which
    // is a large part of why plain sin() reads as mechanical rather than
    // oceanic. True Gerstner motion also displaces horizontally, which
    // isn't achievable in a pure heightfield (this grid's vertices are
    // fixed in X/Z, only Y moves) — this is the standard height-only
    // approximation of that same crest/trough asymmetry instead: remap
    // sin()'s [-1,1] range to [0,1], raise it to a power >1 (compresses
    // most of the range toward the bottom, leaving only a narrow band
    // near the top at full height — narrow crests, broad troughs), then
    // remap back to [-1,1].
    const swellPhase = cellWorldX.mul(0.035).add(cellWorldZ.mul(0.02)).add(fluidTimeUniform.mul(0.35));
    const swellNorm = sin(swellPhase).add(1).mul(0.5); // [-1,1] -> [0,1]
    const bigSwell = pow(swellNorm, 1.8).mul(2).sub(1); // sharpened, back to [-1,1]
    // Per "not much vertical waves to look real" — 0.35/0.15 was an
    // overcorrection from the previous "tone down" pass. Split the
    // difference between that and the earlier too-much 0.6/0.25: 0.5/0.2
    // — real, visible vertical motion without going back to the earlier
    // amount that looked like too much wave energy.
    newHeight = newHeight.add(bigSwell.mul(0.5).mul(shoreDamp)).add(chop.mul(0.2).mul(shoreDamp));

    heightBufferB.element(i).assign(newHeight);
  })().compute(CELL_COUNT);

  // renderer.copyBufferToBuffer isn't available on this renderer (confirmed
  // via the prototype's own real testing, not assumed) — copying via a
  // trivial per-cell compute-shader assignment instead, same mechanism as
  // computeInit/computeUpdate above, not a new unverified API surface.
  const computeCopyBack = Fn(() => {
    heightBufferA.element(instanceIndex).assign(heightBufferB.element(instanceIndex));
  })().compute(CELL_COUNT);

  const geometry = new THREE.PlaneGeometry(size, size, WIDTH - 1, WIDTH - 1);
  geometry.rotateX(-Math.PI / 2);
  // Explicit vertex-to-cell mapping — PlaneGeometry with WIDTH-1 segments
  // lays out vertices in row-major order matching exactly how the height
  // buffer is indexed (x + y*WIDTH), a direct 1:1 correspondence.
  const cellIndices = new Float32Array(WIDTH * WIDTH);
  for (let ci = 0; ci < cellIndices.length; ci++) cellIndices[ci] = ci;
  geometry.setAttribute("cellIndex", new THREE.Float32BufferAttribute(cellIndices, 1));
  // Belt-and-suspenders per the console's "AttributeNode: Vertex attribute
  // 'uv' not found on geometry" warning — PlaneGeometry always generates
  // uv by default and none of this material's node graph (positionNode/
  // normalNode/colorNode below) references uv anywhere, so this specific
  // warning most likely belongs to a DIFFERENT object elsewhere in the
  // scene (several other, clearly-unrelated errors show up in the same
  // console dump). Logged explicitly here so that's actually verifiable
  // rather than assumed either way, and generated as a real fallback in
  // the genuinely-unexpected case this mesh's own geometry is somehow
  // missing it.
  console.log("[liquid] fluid-sim geometry has uv attribute:", !!geometry.attributes.uv);
  if (!geometry.attributes.uv) {
    const uvs = new Float32Array(WIDTH * WIDTH * 2);
    for (let uy = 0; uy < WIDTH; uy++) {
      for (let ux = 0; ux < WIDTH; ux++) {
        const idx = uy * WIDTH + ux;
        uvs[idx * 2] = ux / (WIDTH - 1);
        uvs[idx * 2 + 1] = uy / (WIDTH - 1);
      }
    }
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    console.log("[liquid] fluid-sim: generated a fallback uv attribute");
  }

  const style = LIQUID_STYLE.crystal;
  const material = new THREE.MeshStandardNodeMaterial({
    color: style.baseColor, roughness: style.roughness, metalness: 0.05,
    emissive: style.emissive, emissiveIntensity: style.emissiveIntensity,
    transparent: true, opacity: style.opacity,
  });

  const cellIdx = attribute("cellIndex", "float").toUint();
  const cellSpacing = float(size / WIDTH);

  const computeWaveNormal = Fn(() => {
    const cx = cellIdx.mod(uint(WIDTH)).toFloat();
    const cy = cellIdx.div(uint(WIDTH)).toFloat();
    const hC = heightBufferNode.element(cellIdx);
    const cxRight = min(cx.add(1), float(WIDTH - 1));
    const cyDown = min(cy.add(1), float(WIDTH - 1));
    const idxRight = cy.mul(WIDTH).add(cxRight).toUint();
    const idxDown = cyDown.mul(WIDTH).add(cx).toUint();
    const hRight = heightBufferNode.element(idxRight);
    const hDown = heightBufferNode.element(idxDown);
    const tangent = vec3(cellSpacing, hRight.sub(hC), 0);
    const bitangent = vec3(0, hDown.sub(hC), cellSpacing);
    return cross(bitangent, tangent).normalize();
  });

  material.positionNode = Fn(() => {
    // Diagnostic wave (confirmed positionNode works — see chat) removed.
    // heightAtVertex alone now, straight from the compute buffer, so the
    // next test isolates the buffer path specifically.
    const heightAtVertex = heightBufferNode.element(cellIdx);
    return positionLocal.add(vec3(0, heightAtVertex, 0));
  })();
  material.normalNode = computeWaveNormal();

  // Per "a lot of banding, make it look more like real ocean" — a real
  // photo of open ocean (see chat) reads as a fairly consistent deep
  // blue-teal, with SUBTLE brightness variation from the surface shape,
  // not sweeping shifts between two very different colors. The previous
  // version blended all the way from deep blue to near-white
  // (style.frothColor) on every wave cycle — even at a modest 0.4
  // multiplier, that swing between two very different hues is exactly
  // what reads as banding/stripes. This blends toward a SLIGHTLY
  // brighter version of the SAME deep color instead of a different hue
  // entirely, and much less of it — real whitecap foam (a genuinely
  // different white color) is deliberately a separate, later stage
  // rather than being faked here via a height threshold.
  material.colorNode = Fn(() => {
    const heightAtVertex = heightBufferNode.element(cellIdx);
    const deep = color(style.baseColor);
    const litDeep = deep.mul(1.35); // same hue, just brighter — not a shift toward white
    const t = clamp(heightAtVertex.mul(0.15).add(0.1), 0, 1);
    return mix(deep, litDeep, t);
  })();

  // Per explicit "apply a custom shader to make it look like water" — a
  // real fresnel term: a surface's reflectivity genuinely increases at
  // grazing viewing angles (why looking straight down INTO a lake shows
  // its actual color/depth, while looking ACROSS it near the horizon
  // shows a bright sky-like sheen instead) — this is the single most
  // recognizable "that's water, not a painted blue plane" visual cue,
  // and was completely absent from the flat two-tone colorNode alone.
  // Uses the same computeWaveNormal() already driving normalNode, so the
  // fresnel term correctly responds to actual wave slope, not a flat
  // up-vector — a crest tilted toward the camera reads differently than
  // a trough, same as real water.
  material.emissiveNode = Fn(() => {
    const viewDir = cameraPosition.sub(positionWorld).normalize();
    const grazing = float(1.0).sub(clamp(dot(normalWorld, viewDir), 0, 1));
    const fresnelTerm = pow(grazing, 8.0);
    const skyHighlight = color(0xcfe8ff); // pale sky tone — reads as reflected sky/light, not a light SOURCE of its own
    const baseEmissive = color(style.emissive).mul(style.emissiveIntensity);
    // Per "something is wrong with the water" on a night-time screenshot
    // — style.emissiveIntensity is 0.015, extremely low, meaning almost
    // all of this water's visible brightness normally comes from real
    // scene lighting (a PBR material's diffuse/specular response), not
    // emissive. At night, with little direct light for the wave normals
    // to interact with, that leaves very little left to actually SEE —
    // the geometry can be moving correctly underneath while still
    // reading as a flat, dark, undifferentiated slab. This is a real,
    // independent floor — the water's own base color at low intensity —
    // so there's always SOME visible tonal variation regardless of how
    // dark the actual scene lighting gets, without meaningfully changing
    // the daytime look (this is small next to what real sunlight already
    // contributes).
    const nightFloor = color(style.baseColor).mul(0.06);
    const baseEmissiveFloored = baseEmissive.add(nightFloor);
    // Per "not quite right, more like [reference photo] — 10fps" —
    // TWO problems with the previous hash-noise sparkle at once: (1) it
    // was almost certainly the real performance cause — emissiveNode
    // runs PER PIXEL (not per vertex like positionNode/normalNode), so a
    // fract/dot/hash noise evaluation on every single covered pixel is
    // real, substantial cost, unlike the cheap per-vertex wave physics;
    // (2) the reference photo shows a long, STREAKY reflection path
    // toward the sun, not scattered random dots — that's a real
    // specular highlight (reflect the view ray off each wave facet's
    // own normal, check how closely it points at the sun), not noise at
    // all. This replaces the noise sparkle with exactly that: reflect()
    // + dot() + pow() — three cheap ops, the same category of cost as
    // the fresnel term already above, not a new expensive class of
    // computation. Individual glints naturally form a broken streaky
    // path (not a uniform blob) because only wave facets whose ACTUAL
    // slope happens to align with the sun direction light up — the real
    // physical mechanism behind real sun glitter, not an approximation
    // of it. sunDir is a fixed low-angle approximation (this material
    // doesn't currently receive the game's real dynamic sun direction as
    // a uniform) matching the reference photo's dramatic low-sun mood.
    const sunDir = vec3(0.35, 0.3, -0.9).normalize();
    const reflectDir = reflect(viewDir.negate(), normalWorld);
    const sunAlign = clamp(dot(reflectDir, sunDir), 0, 1);
    // Per "lots of flickering" — confirmed via consecutive-frame pixel
    // diffing (not a guess): pow(48) was specular aliasing, a well-known
    // rendering artifact — an exponent this high makes the highlight so
    // narrow that tiny sub-pixel changes in wave normal (which happen
    // continuously as real waves move) flip individual pixels in and out
    // of the lit band discontinuously instead of shifting smoothly. The
    // reference photo also confirms the fix independently: real sun
    // glitter is soft and diffuse — many gentle overlapping highlights,
    // not one razor-thin line. Softened significantly (48 -> 14) and the
    // peak brightness pulled back to compensate for the wider, less
    // concentrated highlight this produces.
    const glint = pow(sunAlign, 14.0);
    return baseEmissiveFloored
      .add(skyHighlight.mul(fresnelTerm).mul(0.1))
      .add(color(0xfff4e0).mul(glint).mul(1.1)); // warm sun-tone, not pure white — matches a real low-sun glint's color
  })();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = y;
  mesh.renderOrder = -50; // matches the Gerstner-path crystal water's own renderOrder — see its comment for why this needs to stably win against sky-layer depth sort
  mesh.receiveShadow = true;
  scene.add(mesh);

  return {
    fluidSim: true,
    mesh,
    computeInit, computeUpdate, computeCopyBack,
    heightBufferA, heightBufferB,
    fluidTimeUniform, // self-managed clock — see its own comment above for why; updateFluidSimWater sets .value from main.js's real elapsedTime every frame
    initialized: false, // updateFluidSimWater dispatches computeInit exactly once, the first time it's called for this handle
    getHeightBufferNode: () => heightBufferNode,
    setHeightBufferNode: (n) => { heightBufferNode = n; },
  };
}

// Real per-frame compute dispatch for the fluid-sim water — separate from
// updateLiquidPlane (which is CPU-side only) because dispatching a compute
// shader needs the renderer, which only main.js holds. Called from
// main.js's animate loop, crystal-and-fluid-sim-enabled only.
//
// Per "tanking performance" — this used to be `await
// renderer.computeAsync(...)` three times, every frame. computeAsync
// forces a real CPU<->GPU synchronization round-trip on each call (that's
// what makes it "async" — it waits for the GPU to actually finish and
// hand results back), which is exactly the wrong tool for an ordinary
// per-frame dispatch that nothing needs to read back on the CPU side.
// Three.js's own current guidance (confirmed, not assumed): prefer the
// synchronous `renderer.compute()` for the ordinary frame loop, and
// reserve computeAsync for when the promise/readback semantics are
// actually needed — which this isn't. Switching to it removes three
// unnecessary GPU sync stalls per frame, which was very likely the bulk
// of the performance cost. This also fully replaces the earlier
// timeout-guarded async version — that whole hang-detection apparatus
// was built to diagnose computeAsync specifically stalling in a way that
// turned out to be a diagnostic-logging bug, not a real hang (see chat) —
// none of that complexity is needed for a synchronous call.
function updateFluidSimWater(handle, renderer, elapsedTime) {
  if (!handle || !handle.fluidSim) return;
  if (handle.fluidTimeUniform) handle.fluidTimeUniform.value = elapsedTime;
  const diagEl = typeof window !== "undefined" ? window.riftFluidSimDiagEl : null;
  if (diagEl) diagEl.style.display = "block";
  if (handle.fluidSimBroken) {
    if (diagEl) diagEl.textContent = "wave: FAILED — " + (handle.fluidSimBrokenReason || "unknown");
    return;
  }
  const canSyncCompute = typeof renderer.compute === "function";
  try {
    if (!handle.initialized) {
      if (canSyncCompute) renderer.compute(handle.computeInit);
      else renderer.computeAsync(handle.computeInit); // defensive fallback for a renderer build without sync compute() — not awaited, since nothing here can usefully block a synchronous per-frame loop anyway
      handle.initialized = true;
    }
    if (canSyncCompute) {
      renderer.compute(handle.computeUpdate);
      renderer.compute(handle.computeCopyBack);
    } else {
      renderer.computeAsync(handle.computeUpdate);
      renderer.computeAsync(handle.computeCopyBack);
    }
    handle.fluidSimDispatchCount = (handle.fluidSimDispatchCount || 0) + 1;
    // Per "the water region is completely static" (confirmed via real
    // pixel-diffing of a phone screen recording, not a look complaint) —
    // this on-screen line is readable straight off a phone without
    // devtools, exactly for that situation. If this count is climbing
    // while the water still isn't visibly moving, the dispatch itself is
    // fine and the bug is elsewhere (the buffer not reaching the
    // material). If it's NOT climbing / shows FAILED, the dispatch call
    // itself is the problem — most likely iOS Safari's WebGPU compute
    // support behaving differently than the desktop Chrome this was last
    // confirmed working on.
    if (diagEl) diagEl.textContent = "wave: " + (canSyncCompute ? "sync" : "async-fallback") + ", #" + handle.fluidSimDispatchCount + ", t=" + elapsedTime.toFixed(1);
  } catch (err) {
    console.error("[liquid] fluid-sim: compute dispatch failed:", err);
    // Stops retrying every frame once this happens — if compute doesn't
    // work at all on this device/browser, hammering it 60x/second would
    // just spam identical errors forever rather than surfacing one clear
    // one.
    handle.fluidSimBroken = true;
    handle.fluidSimBrokenReason = String(err && err.message || err);
    if (diagEl) diagEl.textContent = "wave: FAILED — " + handle.fluidSimBrokenReason;
  }
  // computeUpdate reads FROM heightBufferA and writes INTO heightBufferB;
  // computeCopyBack then copies B back into A — so heightBufferA always
  // holds the current, fully-settled state by the time this returns,
  // matching what positionNode/normalNode already read via
  // getHeightBufferNode(). No buffer-identity swap needed (unlike a
  // classic ping-pong scheme) since computeCopyBack does that work on
  // the GPU side every frame — same scheme the confirmed-working
  // prototype itself used.
}

// -----------------------------------------------------------------------------
// Real 3D breaking-wave geometry — per explicit "genuine 3D breaking wave
// geometry," a real, different request from the foam pass just before it.
// A heightfield (which is what the whole ocean above IS — one Y value per
// X/Z position) can structurally never curl over itself; that's not a
// tuning limitation, it's what a heightfield IS. A genuine overturning
// wave needs an actual parametric CURL — a tube/barrel cross-section
// swept along the shore, where the SAME (x,z) column legitimately has
// multiple real Y values as the lip arcs up, over, and back down. This
// is a completely separate mesh from the ocean plane above (additive,
// same discipline as the ripple layer and volumetric clouds — doesn't
// touch or replace the existing water at all), built along a REAL
// detected shoreline (sampled from the same terrain heightfield the
// ocean's own shore-damping already uses), not a hardcoded straight
// line.
//
// Honest scope limits, stated up front rather than discovered later:
// - Shoreline detection is a single-crossing scan per X column (see
//   detectShorelinePoints below) — this works well for a simple, mostly-
//   one-directional coastline. A complex bay/inlet with multiple shore
//   crossings at the same X isn't something this first pass handles.
// - Capped to a representative shore SEGMENT (~440 units), not the
//   entire coastline — matching how the rest of this project scopes
//   "small/local" additions rather than a fully general everywhere-
//   system.
// -----------------------------------------------------------------------------

const BREAK_CROSS_RES = 14; // vertices across the curl profile, back (calm water) to tip (breaking lip)
const BREAK_ALONG_STEP = 3; // world units between along-shore sample points

// Real shoreline detection — reuses the SAME sampleHeight callback the
// ocean's own shoreDampBuffer already samples from, scanning for where
// real terrain height crosses the water level. For each X column, scans
// Z from one edge of the search window to the other and records the
// FIRST point where depth crosses from "wet" to "dry" (or vice versa) —
// a real, computed shoreline, not an authored/guessed line.
function detectShorelinePoints(sampleHeight, waterY, size) {
  const points = [];
  if (!sampleHeight) return points;
  const scanRange = Math.min(size / 2, 220); // real, deliberate cap — a representative shore segment, not the whole map's coastline
  for (let x = -scanRange; x <= scanRange; x += BREAK_ALONG_STEP) {
    let prevDepth = null;
    for (let z = -scanRange; z <= scanRange; z += 1.5) {
      const depth = waterY - sampleHeight(x, z);
      if (prevDepth !== null && ((prevDepth > 0.3) !== (depth > 0.3))) {
        points.push({ x, z: z - 0.75 }); // roughly the midpoint of the crossing step
        break;
      }
      prevDepth = depth;
    }
  }
  return points;
}

function createBreakingWave(scene, waterY, sampleHeight, size) {
  const shorePoints = detectShorelinePoints(sampleHeight, waterY, size);
  // Per "I don't see any line for the new waves" — real miscommunication
  // found: the on-screen diagEl below is a visual HUD overlay (same
  // pattern as the FPS counter), not a console message, so it would
  // never show up in devtools console no matter what it said. Added a
  // real console.log alongside it now that real devtools access is
  // confirmed available, so this is visible in BOTH places — the page
  // overlay for phone-only testing, the console log for exactly this
  // desktop-with-devtools situation.
  const diagEl = typeof window !== "undefined" ? window.riftBreakingWaveDiagEl : null;
  if (diagEl) diagEl.style.display = "block";
  if (shorePoints.length < 2) {
    const msg = "[liquid] wave-crest: NO SHORELINE FOUND (0-1 points in ±220 range)";
    if (diagEl) diagEl.textContent = msg;
    console.log(msg);
    return { mesh: null, breakTimeUniform: null }; // no usable shoreline found in range — real, defensive bail rather than building broken geometry
  }
  const xs = shorePoints.map((p) => p.x), zs = shorePoints.map((p) => p.z);
  const msg = `[liquid] wave-crest: ${shorePoints.length} pts, x[${Math.min(...xs).toFixed(0)},${Math.max(...xs).toFixed(0)}] z[${Math.min(...zs).toFixed(0)},${Math.max(...zs).toFixed(0)}]`;
  if (diagEl) diagEl.textContent = msg.replace("[liquid] ", "");
  console.log(msg);

  const crossRes = BREAK_CROSS_RES;
  const vertCount = shorePoints.length * crossRes;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const shoreNormals = new Float32Array(vertCount * 3);

  for (let i = 0; i < shorePoints.length; i++) {
    const p = shorePoints[i];
    const prev = shorePoints[Math.max(0, i - 1)];
    const next = shorePoints[Math.min(shorePoints.length - 1, i + 1)];
    const tanX = next.x - prev.x, tanZ = next.z - prev.z;
    const tanLen = Math.hypot(tanX, tanZ) || 1;
    // Perpendicular to the along-shore tangent — the cross-section
    // direction a real wave crest curls along, toward or away from open
    // water.
    let normX = -(tanZ / tanLen), normZ = tanX / tanLen;
    // Real orientation check — samples a few units out along the
    // candidate normal and flips it if that direction turns out to be
    // the DRIER one (a real wave curls TOWARD the shore, arriving FROM
    // open water, so the normal needs to consistently point offshore,
    // not flip randomly segment to segment based on which way the
    // tangent happened to be computed).
    if (sampleHeight) {
      const outDepth = waterY - sampleHeight(p.x + normX * 4, p.z + normZ * 4);
      const inDepth = waterY - sampleHeight(p.x - normX * 4, p.z - normZ * 4);
      if (inDepth > outDepth) { normX = -normX; normZ = -normZ; }
    }
    for (let j = 0; j < crossRes; j++) {
      const vi = (i * crossRes + j);
      positions[vi * 3] = p.x;
      positions[vi * 3 + 1] = waterY;
      positions[vi * 3 + 2] = p.z;
      uvs[vi * 2] = i / (shorePoints.length - 1);
      uvs[vi * 2 + 1] = j / (crossRes - 1);
      shoreNormals[vi * 3] = normX;
      shoreNormals[vi * 3 + 1] = 0;
      shoreNormals[vi * 3 + 2] = normZ;
    }
  }

  const indices = [];
  for (let i = 0; i < shorePoints.length - 1; i++) {
    for (let j = 0; j < crossRes - 1; j++) {
      const a = i * crossRes + j, b = (i + 1) * crossRes + j, c = (i + 1) * crossRes + j + 1, d = i * crossRes + j + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute("shoreNormal", new THREE.BufferAttribute(shoreNormals, 3));
  geo.setIndex(indices);
  // Real, confirmed bug (actual devtools console access, not guessed) —
  // "THREE.TSL: Vertex attribute 'normal' not found on geometry."
  // MeshStandardNodeMaterial is a LIT material; it needs real normals
  // for its lighting model, and this geometry never had any computed at
  // all. Standard Three.js API, already used twice elsewhere in this
  // same file for exactly this purpose — not a new/unproven pattern.
  geo.computeVertexNormals();

  const breakTimeUniform = uniform(0);
  const material = new THREE.MeshStandardNodeMaterial({ transparent: true, side: THREE.DoubleSide, roughness: 0.25, metalness: 0 });

  // uvNode.x = along-shore progress (0-1 across the detected segment);
  // uvNode.y = cross-section progress (0 = base/calm water, 1 = the
  // curling lip's own tip). Plain JS helper (not Fn()-wrapped) — called
  // from within each of positionNode/colorNode/opacityNode's own Fn()
  // bodies below, matching the confirmed pattern from real TSL raymarch
  // examples (helper functions invoked directly inside a Loop/If body,
  // not separately Fn()-wrapped themselves) rather than nesting Fn()
  // calls inside Fn() calls, which isn't a pattern this project has
  // used or verified elsewhere. Recomputes the same curl math
  // independently in each of the three call sites below — real,
  // duplicated GPU cost, but the SAME deliberate, already-justified
  // trade-off this file's own Gerstner normalNode/positionNode split
  // already makes ("reusing TSL node objects ACROSS separate material-
  // property Fn() bodies isn't a pattern this project has verified, so
  // this recomputes... instead of risking that uncertainty").
  const sharedCurl = () => {
    const uvNode = uv();
    const shoreNormal = attribute("shoreNormal", "vec3");
    const alongShore = uvNode.x;
    const v = uvNode.y;

    // Per "needs to be like water physics... too stiff" — real, confirmed
    // cause: EVERY point along the shore broke in perfectly smooth
    // lockstep (one clean linear phase gradient), and EVERY point across
    // a cross-section rotated as one rigid arm (angle = v * breakProgress,
    // nothing else). Real surf is chaotic at multiple scales — no two
    // stretches of a beach break with identical timing or height, and the
    // water surface itself is never perfectly smooth even mid-motion.
    // Per-segment randomization (NOT a smooth function of alongShore) so
    // adjacent stretches of shore genuinely differ, the way a real
    // uneven seafloor makes real waves break unevenly along a beach —
    // hash() of the segment index, blended across the segment boundary
    // so it doesn't visibly pop between segments.
    // Per real rendered-frame testing (an actual headless-WebGL preview
    // of this exact math, not just code review) — this was the direct
    // cause of the "too stiff... jagged" look: segmentCount was tied to
    // shorePoints.length, the SAME resolution as the vertex grid itself,
    // so the per-segment randomization varied at nearly the same
    // frequency as individual vertices — wild vertex-to-vertex jumps
    // (a jagged "picket fence" of narrow spikes, confirmed visually)
    // instead of smooth, wide wave groups. A "segment" needs to span
    // many vertices, not one — fixed at a small constant, decoupled
    // from vertex resolution entirely.
    const segmentCount = float(6);
    const segF = alongShore.mul(segmentCount);
    const segI = floor(segF);
    const segFrac = fract(segF);
    const segRand = mix(hash(segI), hash(segI.add(1)), segFrac);
    const segRand2 = mix(hash(segI.add(97)), hash(segI.add(98)), segFrac);

    // Per "only take a second to play the whole animation" — cut from a
    // 6.5-8.7s cycle to ~1-1.4s, a completely different pace, not a
    // tuning tweak.
    const cyclePeriod = float(1.0).add(segRand2.mul(0.4));
    const phase = fract(breakTimeUniform.div(cyclePeriod).sub(alongShore.mul(0.6)).add(segRand.mul(0.8)));

    // Per "flow down flat onto the shore as white water" — real,
    // confirmed missing phase: the old model only ever curled UP then
    // shrank back down to nothing, with no equivalent of the actual
    // collapse — a real broken wave's curl crashes down and then
    // surges FORWARD across the sand as a flat, spreading sheet of
    // whitewater (the swash), which is a genuinely different motion
    // from the curl itself (low and wide vs. tall and tight), not just
    // the same curl fading out. Two separate, overlapping envelopes now:
    // curlProgress is a short, sharp spike (the barrel forming and
    // immediately collapsing); swashProgress rises as the curl is
    // already collapsing and fades out over a longer tail (the flat
    // water actually reaching up the sand and draining back).
    const curlAttack = tslSmoothstep(float(0), float(0.12), phase);
    const curlRelease = float(1).sub(tslSmoothstep(float(0.12), float(0.32), phase));
    const curlProgress = curlAttack.mul(curlRelease);
    const swashAttack = tslSmoothstep(float(0.2), float(0.4), phase);
    const swashRelease = float(1).sub(tslSmoothstep(float(0.4), float(0.88), phase));
    const swashProgress = swashAttack.mul(swashRelease);
    // breakProgress kept as the general "how lit-up/foamy is this point
    // right now" driver for color/opacity below — whichever of the two
    // phases is more active at this instant.
    const breakProgress = max(curlProgress, swashProgress);

    // Fast, chaotic turbulence riding on TOP of the main curl motion —
    // real water is never perfectly smooth even mid-wave. Two sine terms
    // at different, non-harmonic frequencies (so they don't just look
    // like one regular ripple) driven by real elapsed time, along-shore
    // position, AND cross-section position, scaled down by breakProgress
    // so it's a subtle wobble on an already-curling wave, not noise on
    // still water.
    const turb1 = sin(breakTimeUniform.mul(9.0).add(alongShore.mul(37.0)).add(v.mul(11.0)));
    const turb2 = sin(breakTimeUniform.mul(14.0).sub(alongShore.mul(22.0)).add(v.mul(19.0)).add(segRand.mul(6.28)));
    const turbulence = turb1.mul(0.55).add(turb2.mul(0.45)).mul(breakProgress).mul(0.09);

    // The curl itself (tube forming/collapsing) — sin/cos of the SAME
    // angle parameter is what makes the tip genuinely arc up, OVER, and
    // back down as angle passes 90°, a true overhang rather than just a
    // steep face. Driven by curlProgress specifically (its own short
    // spike), not the general breakProgress — the curl itself is brief.
    const maxCurlAngle = float(1.9).add(segRand2.mul(0.5));
    const waveHeight = float(0.55).add(segRand.mul(0.4));
    const angle = v.mul(maxCurlAngle).mul(curlProgress).add(turbulence);
    const radius = waveHeight.mul(mix(float(0.25), float(1), curlProgress)).mul(v.mul(0.6).add(0.4)).add(turbulence.mul(waveHeight).mul(0.5));
    const curlAcross = sin(angle).mul(radius);
    const curlUp = float(1).sub(cos(angle)).mul(radius);

    // The swash — low and flat (real whitewater is a thin sheet, not a
    // tall shape), reaching noticeably FURTHER onto the shore than the
    // curl itself did (real swash runs up the sand past where the wave
    // actually broke), fading out as it drains back.
    const swashReach = waveHeight.mul(1.9).mul(swashProgress).mul(v.mul(0.7).add(0.3));
    const swashHeight = waveHeight.mul(0.18).mul(swashProgress);

    const totalAcross = curlAcross.add(swashReach);
    const totalUp = curlUp.add(swashHeight);

    // Per "curling the opposite direction" — real, confirmed feedback
    // from actually seeing it, not a re-derivation: sign flipped
    // directly (removed the .negate() that was here) rather than
    // re-reasoning about which way shoreNormal "should" point in
    // theory.
    const worldOffset = shoreNormal.mul(totalAcross);
    return { worldOffset, upOffset: totalUp, v, breakProgress };
  };

  material.positionNode = Fn(() => {
    const { worldOffset, upOffset } = sharedCurl();
    return positionLocal.add(vec3(worldOffset.x, upOffset, worldOffset.z));
  })();

  // Per "it's not white right yet" — real, confirmed cause (screenshots
  // showed a uniformly dark, flat-shaded shape, not just dim foam):
  // colorNode sets a LIT material's surface albedo, which still gets
  // multiplied by actual scene light before it reaches the screen — at
  // dusk/night, even a pure white albedo renders dark, because there's
  // barely any light hitting it to reflect. The ocean's OWN existing
  // foam crest system already solves exactly this by using emissiveNode
  // instead (an unlit glow added on top, independent of scene lighting)
  // — matched here directly rather than re-solving the same problem a
  // different way.
  material.colorNode = Fn(() => {
    const { breakProgress } = sharedCurl();
    // Kept dark and subtle — this is the LIT base color, mostly hidden
    // under the real emissive foam glow below except right at the calm
    // edges of the ribbon.
    return color(0x123840).mul(float(1).sub(breakProgress.mul(0.5)));
  })();

  material.emissiveNode = Fn(() => {
    const { v, breakProgress } = sharedCurl();
    // Real foam glow, visible regardless of time of day — brightest
    // toward the curling tip and specifically where breakProgress is
    // high (the moment it's actually breaking, not mid-swell), same
    // general shaping logic as the ocean's own crest foam, just applied
    // to real 3D geometry instead of a flat surface signal.
    const foamAmount = clamp(v.mul(1.3).add(breakProgress.mul(0.6)).sub(0.5), 0, 1);
    return color(0xf4faff).mul(foamAmount).mul(1.6);
  })();

  material.opacityNode = Fn(() => {
    const { breakProgress } = sharedCurl();
    // Fades toward fully transparent when NOT breaking (breakProgress
    // near 0) so this ribbon blends into the real ocean surface beside
    // it during the calm part of its own cycle, instead of showing as a
    // visible flat intrusion sitting at a fixed height.
    return clamp(breakProgress.mul(1.4), 0.15, 0.95);
  })();

  const mesh = new THREE.Mesh(geo, material);
  scene.add(mesh);
  return { mesh, breakTimeUniform };
}

function updateBreakingWave(handle, elapsed) {
  if (!handle || !handle.mesh) return;
  handle.breakTimeUniform.value = elapsed;
}

function disposeBreakingWave(scene, handle) {
  if (!handle || !handle.mesh) return;
  scene.remove(handle.mesh);
  riftDeferDispose(() => {
    handle.mesh.geometry.dispose();
    handle.mesh.material.dispose();
  });
}

function createLiquidPlane(scene, biome, y, size, sampleHeight, flowDir = { x: 0.6, z: 0.35 }, excludeRegions = []) {
  const style = LIQUID_STYLE[biome];
  if (!style) return null;

  if (biome === "crystal" && CRYSTAL_FLUID_SIM_ENABLED) {
    return buildCrystalFluidSimPlane(scene, y, size, sampleHeight);
  }

  // Per explicit "rebuild it... using the best tool we have" — crystal's
  // wave shape now displaces on the GPU (positionNode, below), which
  // removes the CPU-per-vertex-per-frame cost that previously capped
  // this at getGraphicsSettings().liquidSegments (a shared, modest
  // number tuned for CPU affordability across every biome). A GPU vertex
  // shader evaluates the same analytic formula in parallel regardless of
  // vertex count, so crystal specifically can afford somewhat more detail.
  //
  // Per "performance... low FPS even at low settings" — the flat 350
  // above was a REAL bug, not a deliberate choice: it ignored the
  // graphics tier entirely, so even Low (10 segments intended) actually
  // ran the water at 350 — denser than even High tier's own intended
  // maximum (260). Fixed to scale off the real tier value instead, with
  // a modest 1.3x multiplier for crystal specifically (the GPU wave
  // system does benefit from somewhat more resolution than other
  // biomes' simpler water) rather than overriding tier entirely. Low
  // now gets ~13 segments, Medium ~85, High ~338 — real headroom on
  // High without silently taxing Low/Medium the same amount.
  const segs = biome === "crystal" ? Math.round(getGraphicsSettings().liquidSegments * 1.3) : getGraphicsSettings().liquidSegments;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);

  // Per explicit "add a small additive ripple layer" — real disturbance
  // propagation (a genuine discrete wave equation, GPU compute-driven),
  // layered ON TOP of the existing Gerstner ocean above via positionNode,
  // not replacing it. Reuses the EXACT proven instancedArray ping-pong
  // pattern and the real hard-won CFL-stable constants (waveSpeed=0.35,
  // damping=0.985) from buildCrystalFluidSimPlane's own past debugging
  // (that system fought real numerical-instability and TSL time-node
  // bugs to arrive at these — reused directly here rather than re-
  // guessed) — but deliberately smaller in scope: a small grid covering
  // a fixed area around the map's central water/shore region (not the
  // whole 2000-unit ocean), with NO ambient chop/swell of its own (that's
  // already Gerstner's job) — this layer stays flat and silent until a
  // real disturbance (currently: the player moving at/near the surface,
  // see updateLiquidPlane) actually excites it, then lets real physics
  // carry that disturbance outward and fade.
  const RIPPLE_ENABLED = biome === "crystal";
  const RIPPLE_WIDTH = 64;
  const RIPPLE_CELL_COUNT = RIPPLE_WIDTH * RIPPLE_WIDTH;
  const RIPPLE_AREA_SIZE = 260; // world units this grid covers — fixed placement, not following the player (a moving/scrolling grid would need to shift stored wave STATE, not just its own world-mapping, to avoid ripples appearing to slide; out of scope for this "small" pass)
  let rippleLayer = null;
  if (RIPPLE_ENABLED) {
    const rippleHeightA = instancedArray(RIPPLE_CELL_COUNT, "float");
    const rippleHeightB = instancedArray(RIPPLE_CELL_COUNT, "float");
    const rippleVelocity = instancedArray(RIPPLE_CELL_COUNT, "float");
    const ripplePlayerPos = uniform(vec2(9999, 9999)); // parked far outside the grid until the first real update — see updateLiquidPlane
    const rippleSplashStrength = uniform(0);

    const rippleComputeInit = Fn(() => {
      rippleHeightA.element(instanceIndex).assign(0);
      rippleHeightB.element(instanceIndex).assign(0);
      rippleVelocity.element(instanceIndex).assign(0);
    })().compute(RIPPLE_CELL_COUNT);

    const rippleComputeUpdate = Fn(() => {
      const i = instanceIndex;
      const x = i.mod(uint(RIPPLE_WIDTH)).toFloat();
      const yy = i.div(uint(RIPPLE_WIDTH)).toFloat();
      const self = rippleHeightA.element(i);

      // Edges clamped (re-reads the edge cell's own value), same
      // boundary technique as buildCrystalFluidSimPlane — reflects
      // energy inward like a real wall rather than wrapping.
      const xm = max(x.sub(1), float(0));
      const xp = min(x.add(1), float(RIPPLE_WIDTH - 1));
      const ym = max(yy.sub(1), float(0));
      const yp = min(yy.add(1), float(RIPPLE_WIDTH - 1));
      const idxL = yy.mul(RIPPLE_WIDTH).add(xm).toUint();
      const idxR = yy.mul(RIPPLE_WIDTH).add(xp).toUint();
      const idxU = ym.mul(RIPPLE_WIDTH).add(x).toUint();
      const idxD = yp.mul(RIPPLE_WIDTH).add(x).toUint();
      const left = rippleHeightA.element(idxL);
      const right = rippleHeightA.element(idxR);
      const up = rippleHeightA.element(idxU);
      const down = rippleHeightA.element(idxD);

      const laplacian = left.add(right).add(up).add(down).sub(self.mul(4));
      const waveSpeed = float(0.35);
      const damping = float(0.985);
      const newVelocity = rippleVelocity.element(i).add(laplacian.mul(waveSpeed)).mul(damping);
      rippleVelocity.element(i).assign(newVelocity);
      let newHeight = self.add(newVelocity.mul(0.05));

      // Real disturbance injection — every cell checks its OWN distance
      // to the player's current grid position and adds a falloff-
      // weighted bump, rather than needing a targeted single-cell write
      // (no such operation needed here — this is just a per-cell
      // distance check against a uniform, same category of technique
      // already used elsewhere in this project for proximity gating).
      const cellWorldX = x.div(float(RIPPLE_WIDTH)).sub(0.5).mul(float(RIPPLE_AREA_SIZE));
      const cellWorldZ = yy.div(float(RIPPLE_WIDTH)).sub(0.5).mul(float(RIPPLE_AREA_SIZE));
      const distToPlayer = vec2(cellWorldX, cellWorldZ).sub(ripplePlayerPos).length();
      const splashFalloff = tslSmoothstep(float(6), float(0), distToPlayer);
      newHeight = newHeight.add(splashFalloff.mul(rippleSplashStrength));

      rippleHeightB.element(i).assign(newHeight);
    })().compute(RIPPLE_CELL_COUNT);

    // renderer.copyBufferToBuffer isn't available on this renderer
    // (confirmed via buildCrystalFluidSimPlane's own real testing) —
    // copying via a trivial per-cell compute assignment instead, the
    // same proven mechanism, not a new unverified API.
    const rippleComputeCopyBack = Fn(() => {
      rippleHeightA.element(instanceIndex).assign(rippleHeightB.element(instanceIndex));
    })().compute(RIPPLE_CELL_COUNT);

    rippleLayer = {
      heightBuffer: rippleHeightA, width: RIPPLE_WIDTH, areaSize: RIPPLE_AREA_SIZE,
      playerPos: ripplePlayerPos, splashStrength: rippleSplashStrength,
      computeInit: rippleComputeInit, computeUpdate: rippleComputeUpdate, computeCopyBack: rippleComputeCopyBack,
      initialized: false, lastPlayerX: null, lastPlayerZ: null,
    };
  }

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
  // Per repeated, confirmed failure of the classic BufferAttribute +
  // needsUpdate mechanism to produce ANY visible change under this
  // project's WebGPU NodeMaterial water (two different colorNode fixes
  // both tested live with zero visual difference) — this project has
  // exactly ONE mechanism actually PROVEN to correctly move CPU-written
  // per-frame data to a GPU shader read: instancedArray + plain
  // .value.array[i] writes + .toAttribute() (confirmed working for rain
  // and foam particles). shoreDampBuffer follows this same proven
  // mechanism now — it's written ONCE here at creation (shore proximity
  // is static, computed from real terrain depth, never changes frame to
  // frame), not per-frame, so there's no ongoing CPU cost either way.
  // foam is no longer a separate persistent buffer at all in this
  // rebuild — the old "instant rise, slow fade" CPU-side persistence
  // (foamAccum) is a genuinely nice quality this simplifies away in
  // exchange for real GPU-computed, instantaneous wave-disturbance-based
  // foam instead (see buildWaterMaterial's emissiveNode) — replicating
  // true CROSS-FRAME persistence on the GPU would need a real stateful
  // compute shader (write this frame's value, read next frame's), the
  // same category of added complexity that caused the earlier fluid-sim
  // wave system's own instability. A deliberate, flagged simplification,
  // not a silent omission.
  const shoreDampBuffer = biome === "crystal" ? instancedArray(posAttr.count, "float") : null;
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
      if (shoreDampBuffer) shoreDampBuffer.value.array[i] = swashDamp;
      tmpDepth.copy(shallow).lerp(deep, t);
      const distFromCenter = Math.hypot(vx, vz);
      const farT = THREE.MathUtils.clamp((distFromCenter - FAR_DARKEN_START) / (FAR_DARKEN_END - FAR_DARKEN_START), 0, 1);
      if (farT > 0) tmpDepth.lerp(FAR_DARKEN_COLOR, farT * farT * (3 - 2 * farT));
      tmpDepth.toArray(depthColors, i * 3);
      tmpDepth.toArray(colors, i * 3);
    }
    // Written once, right here at creation — real shore proximity never
    // changes frame to frame, so this needsUpdate call happens exactly
    // once per level load, not every frame.
    if (shoreDampBuffer) shoreDampBuffer.value.needsUpdate = true;
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
    // aFoam BufferAttribute removed — foamBuffer (instancedArray, above)
    // replaces it entirely now.
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
    // Per explicit "make waves and foam look more like [reference photo]"
    // — a real, connected foam SHEET rather than sparse individual
    // particles, using data that's already being computed correctly
    // every frame (the aFoam vertex attribute) but was never actually
    // visible, since the shader that would have displayed it
    // (onBeforeCompile, below) has been disabled the whole time. Reuses
    // the EXACT emissiveNode pattern already proven working elsewhere in
    // this file (the fluid-sim water's own fresnel/glint emissiveNode) —
    // additive on top of the material's normal PBR lighting response,
    // not a colorNode override that would need to manually reconstruct
    // the whole base color pipeline. Switched to MeshStandardNodeMaterial
    // (already proven working in this exact file) instead of
    // MeshPhysicalMaterial specifically to get TSL node support at
    // all — the one real tradeoff is losing clearcoat (envMapIntensity
    // itself is a regular MeshStandardMaterial property too, so that
    // carries over unchanged). Deliberately kept CHEAP given the current
    // 10fps baseline: reads an already-computed per-VERTEX attribute
    // (free GPU interpolation across each triangle, not a per-pixel
    // recomputation) and one texture sample for organic detail — no new
    // compute buffers, no new particle systems.
    const m = biome === "crystal"
      ? new THREE.MeshStandardNodeMaterial({ ...options, envMapIntensity: 1.7 })
      : new THREE.MeshStandardMaterial(options);
    if (biome === "crystal") {
      // Per "still looking wrong... uniform gray/white" — a real
      // regression from the MeshPhysicalMaterial -> MeshStandardNodeMaterial
      // switch, not a foam-coverage issue: the water's actual blue/depth
      // coloring comes entirely from the per-vertex "color" attribute
      // (colorAttr, written every frame in updateLiquidPlane), driven by
      // the classic `vertexColors: true` constructor option — genuinely
      // uncertain whether NodeMaterial variants honor that flag the same
      // automatic way classic materials do (couldn't confirm either way
      // from documentation), so rather than keep trusting an unverified
      // assumption, this wires the SAME attribute in explicitly via
      // colorNode — an INPUT to the PBR lighting model (not a final
      // output override), so normal light response is unaffected.
      // Per "still looking wrong... uniform gray/white" persisting even
      // after wiring attribute("color") explicitly — that fix was
      // real but incomplete: confirmed via Three.js's own TSL docs that
      // VertexColorNode is a DISTINCT class from a generic AttributeNode
      // (extends it, doesn't just alias it), meaning the dedicated
      // vertexColor() TSL function very likely handles something a
      // generic attribute("color") read skips — most plausibly sRGB-to-
      // linear color-space conversion, standard for color data feeding a
      // PBR pipeline, which would explain an overbright/washed-out
      // result if skipped. aFoam (below) is a plain scalar, not a color,
      // so it doesn't have this same category of concern — only the
      // base color read needed correcting.
      // Real GPU-driven wave shape — per explicit "rebuild it to look
      // realistic using the best tool we have." positionNode/normalNode
      // below replace the CPU-side per-vertex Gerstner loop entirely for
      // crystal — this is the actual fix for "barely moving, no breaking
      // waves": the math itself (domain warp + 15-wave trochoidal sum,
      // real horizontal+vertical displacement) is UNCHANGED and already
      // correct; what changes is that it now evaluates in parallel on
      // the GPU across a MUCH higher-resolution mesh (350 segments, up
      // from whatever CPU-affordable count this ran at before — see
      // createLiquidPlane), instead of costing linear CPU time per
      // vertex per frame, which is what was actually smoothing away the
      // already-correct sharp crests before they ever reached the
      // screen. GERSTNER_WAVES_TSL (module-level, above) is the exact
      // same 15-component spectrum this file's own CPU generator
      // produces — obtained by actually running that generator, not
      // re-derived — so wave SHAPE is unchanged, only where it's
      // computed. waterTimeUniform is the same self-managed-uniform
      // pattern already proven necessary throughout this project (TSL's
      // built-in time is not reliably usable the way a naive read would
      // assume), updated every frame in updateLiquidPlane below.
      const waterTimeUniform = uniform(0);
      const gerstnerDomainWarpTSL = (bx, bz, t) => {
        const dwWx = sin(bx.mul(0.016).add(bz.mul(0.009)).add(t.mul(0.05))).mul(16.0)
          .add(sin(bx.mul(0.006).sub(bz.mul(0.011)).sub(t.mul(0.02))).mul(9.0));
        const dwWz = cos(bx.mul(0.011).sub(bz.mul(0.014)).add(t.mul(0.04))).mul(16.0)
          .add(cos(bx.mul(0.008).add(bz.mul(0.007)).sub(t.mul(0.018))).mul(9.0));
        return [bx.add(dwWx), bz.add(dwWz)];
      };
      m.positionNode = Fn(() => {
        const t = waterTimeUniform;
        const bx = positionLocal.x, bz = positionLocal.z;
        const [wbx, wbz] = gerstnerDomainWarpTSL(bx, bz, t);
        const shoreT = shoreDampBuffer.toAttribute();
        let dx = float(0), dz = float(0), dy = float(0);
        for (const w of GERSTNER_WAVES_TSL) {
          const amp = shoreT.mul(w.amplitude);
          const f = dot(vec2(w.ndx, w.ndz), vec2(wbx, wbz)).mul(w.k).sub(t.mul(w.speed));
          const s = sin(f), c = cos(f);
          dx = dx.add(c.mul(amp).mul(w.steepness * w.ndx));
          dz = dz.add(c.mul(amp).mul(w.steepness * w.ndz));
          dy = dy.add(s.mul(amp));
        }
        // Real additive ripple layer (see this function's own setup
        // comment above) — nearest-neighbor sample (not bilinear; a real
        // simplification for this "small" pass, worth upgrading to
        // bilinear later if the per-cell blockiness is visible up close)
        // from the SAME instancedArray buffer the compute shader writes,
        // read directly here by index rather than through a texture —
        // this only works because instancedArray buffers are genuine GPU
        // storage buffers any shader holding a reference to them can
        // read, not something scoped to whichever material "owns" a
        // matching vertex layout.
        let rippleY = float(0);
        if (rippleLayer) {
          const rgx = clamp(positionLocal.x.div(float(rippleLayer.areaSize)).add(0.5), 0, 1).mul(float(rippleLayer.width - 1));
          const rgz = clamp(positionLocal.z.div(float(rippleLayer.areaSize)).add(0.5), 0, 1).mul(float(rippleLayer.width - 1));
          const rippleIdx = rgz.round().toUint().mul(uint(rippleLayer.width)).add(rgx.round().toUint());
          rippleY = rippleLayer.heightBuffer.element(rippleIdx);
        }
        return vec3(positionLocal.x.add(dx), positionLocal.y.add(dy).add(rippleY), positionLocal.z.add(dz));
      })();
      // Real analytic Gerstner normal — the exact same closed-form
      // derivative-based formula the old CPU version used (not a
      // geometric/triangle-derived approximation), evaluated
      // independently here in its own Fn() rather than sharing node
      // objects with positionNode above — a deliberate, conservative
      // choice: reusing TSL node objects ACROSS separate material-
      // property Fn() bodies isn't a pattern this project has verified,
      // so this recomputes the same sum a second time instead of risking
      // that uncertainty. The GPU cost of that duplication is real but
      // minor compared to the risk of an unverified sharing pattern.
      m.normalNode = Fn(() => {
        const t = waterTimeUniform;
        const bx = positionLocal.x, bz = positionLocal.z;
        const [wbx, wbz] = gerstnerDomainWarpTSL(bx, bz, t);
        const shoreT = shoreDampBuffer.toAttribute();
        let nx = float(0), nz = float(0), nyTerm = float(0);
        for (const w of GERSTNER_WAVES_TSL) {
          const amp = shoreT.mul(w.amplitude);
          const f = dot(vec2(w.ndx, w.ndz), vec2(wbx, wbz)).mul(w.k).sub(t.mul(w.speed));
          const s = sin(f), c = cos(f);
          const WA = amp.mul(w.k);
          nx = nx.sub(WA.mul(c).mul(w.ndx));
          nz = nz.sub(WA.mul(c).mul(w.ndz));
          nyTerm = nyTerm.add(WA.mul(s).mul(w.steepness));
        }
        const ny = float(1).sub(nyTerm);
        const nLen = vec3(nx, ny, nz).length();
        return vec3(nx.div(nLen), ny.div(nLen), nz.div(nLen));
      })();
      m.userData.waterTimeUniform = waterTimeUniform;
      m.colorNode = vertexColor();
      // Real underwater caustic lighting — per explicit "the underwater
      // caustic lighting from the prototype." The original lived inside
      // the same dead onBeforeCompile block removed a few rounds back
      // during the foam cleanup (its own comment described a Voronoi
      // F1/F2 feature-point technique — "nearest + second-nearest
      // feature point... traces thin lines along cell boundaries rather
      // than filled blobs"), applied to the water's own surface, not the
      // seafloor (terrain.js, not available this session, is where a
      // true seafloor-projected version would need to live instead).
      // Rebuilt here using the SAME hash-cell technique already proven
      // working in this project for the lens droplet effect — two
      // overlapping grids at different scale/speed/rotation, each
      // producing a bright dot near one jittered point per cell, taking
      // the max of both layers (not multiplying — multiplying two sparse
      // independent patterns would only light up where both happen to
      // coincide, far too rare; max gives the continuous, interlocking
      // web of light real overlapping ripples actually focus into).
      // Per explicit "remove the surface caustics system, we want just
      // the seafloor" — this water-surface caustic glow (a hash-cell
      // approximation built before terrain.js was available this
      // session) is removed entirely. The real, more accurate seafloor
      // version — built later using the actual prototype's texture-
      // based min() technique and full wave-sync — lives in main.js's
      // simpleTerrainMat and is unaffected by this removal.
      // Real, self-managed water-level reference for the foam signal
      // below — set once at creation (the base water Y never changes
      // during a level), not per-frame.
      const waterLevelUniform = uniform(y);
      // Real sun-direction uniform for the glint sparkle below — fed
      // each frame in updateLiquidPlane from the REAL sunDir parameter
      // that function already receives (main.js's actual sun position),
      // same confirmed uniform(vec3(...)) + .value.copy() pattern already
      // proven working for the rain particles' own camera-position
      // uniform. Defaults to the same fallback direction the old
      // (disabled) fluid-sim material used, in case a frame ever runs
      // before the first real update.
      const sunDirUniform = uniform(vec3(0.35, 0.3, -0.9));
      m.userData.sunDirUniform = sunDirUniform;
      m.emissiveNode = Fn(() => {
        // Real foam, derived directly from the GPU-displaced position —
        // per the foamBuffer removal above, no longer a separate
        // persistent CPU-written buffer. positionWorld.y already
        // reflects the wave height AFTER positionNode's displacement
        // (fragment interpolation happens downstream of vertex
        // displacement), so this needs no separate wave-sum
        // recomputation at all — genuinely the cheapest possible way to
        // get a real, wave-synced foam signal. Same normalization shape
        // as the old CPU disturbance value (clamped 0-1 across the
        // spectrum's real total amplitude), just instantaneous rather
        // than persisted frame-to-frame (see this file's own
        // shoreDampBuffer comment for why persistence was deliberately
        // dropped in this rebuild).
        const waveHeight = positionWorld.y.sub(waterLevelUniform);
        const rawFoam = clamp(waveHeight.add(GERSTNER_AMPLITUDE_SUM).div(GERSTNER_AMPLITUDE_SUM * 2), 0, 1);
        // Per "should be white lines... breaking waves at the crests
        // only" — narrowed significantly (was 0.15-0.55, a broad
        // mid-to-high band; now 0.62-0.8) so foam only appears right at
        // the true peak of the wave height range. Real whitecaps form
        // specifically where a wave actually crests, not across most of
        // its rising face.
        const foamMask = tslSmoothstep(0.62, 0.8, rawFoam);
        // Per "foam looks applied to the whole ocean instead of just
        // when it washes on shore" (a real bug already found and fixed
        // once this session) — reapplied here so this rebuild doesn't
        // silently reintroduce it. shoreDampBuffer is 0 at the shoreline
        // and ramps to 1 in open water; inverted here since foam
        // coverage needs the opposite shape (strong near shore, fading
        // in open water) — same real shore-proximity data already
        // driving the wave amplitude damping above, not a separate
        // computation.
        const shoreProximityRaw = float(1).sub(shoreDampBuffer.toAttribute());
        // Per explicit "volumetric foam layer... that touches the
        // shore... more realistic" — real waves don't wash up to the
        // exact same point on the sand continuously; they arrive in
        // loose sets, each reaching a bit further than the calm in
        // between (matching the reference video's own rolling-in/
        // receding rhythm). shoreDampBuffer itself is fixed per-vertex
        // real-terrain data and shouldn't change, but the EFFECTIVE
        // "counts as near-shore" threshold can breathe — a slow sine
        // (real ~35s period, deliberately much slower than any
        // individual wave's own crest-to-crest period so it reads as a
        // genuine set/lull cycle, not just another wave) biases
        // shoreProximity upward during a "wash in," letting foam
        // genuinely reach further up the slope in cycles rather than
        // sitting at one static line.
        const washCycle = sin(waterTimeUniform.mul(0.18)).mul(0.5).add(0.5); // 0..1, ~35s period
        const shoreProximity = clamp(shoreProximityRaw.add(washCycle.mul(0.3)), 0, 1);
        // Real crest-line pattern — per "change it to white lines...
        // to look like breaking waves," replacing the old isotropic
        // detail-texture multiply (which read as scattered round dots,
        // not lines). A wave's own phase function — the SAME
        // dot(direction, position)*k - speed*t term already driving the
        // real Gerstner displacement above, not a separate invention —
        // is mathematically constant along lines PERPENDICULAR to that
        // wave's travel direction, which is exactly the real geometry
        // of a breaking crest line. Uses the dominant (largest-
        // amplitude) wave component as a cheap single-term proxy for
        // orientation, not the full 15-wave sum — this only needs to
        // establish which way the lines run, not exact height.
        const dominantWave = GERSTNER_WAVES_TSL[0];
        const dominantPhase = dot(vec2(dominantWave.ndx, dominantWave.ndz), positionWorld.xz).mul(dominantWave.k).sub(waterTimeUniform.mul(dominantWave.speed));
        // fract() turns the phase into a repeating 0-1 sawtooth, one
        // cycle per real wavelength; thresholding narrow bands at BOTH
        // ends (0 and 1 wrap to the same point) gives thin lines spaced
        // one wavelength apart, tracing the crest contour instead of
        // filling the whole crest region solid.
        const linePhase = fract(dominantPhase.div(6.28318));
        const lineWidth = float(0.08);
        const crestLines = tslSmoothstep(float(1).sub(lineWidth), float(1), linePhase).add(tslSmoothstep(lineWidth, float(0), linePhase));
        // Per "volumetric foam layer" — a real wave's crest line doesn't
        // stay a thin line all the way to shore; the moment it actually
        // reaches shallow water it dissolves into a full, rough,
        // connected foam MASS (exactly what the reference video shows —
        // a thick white wash, not a hairline). Blends the existing thin
        // crestLines (kept as-is for open-water chop, far from shore)
        // toward a much wider, noise-broken-up band as shoreProximity
        // rises — same hash(x.add(y.mul(57.0))) single-scalar-seed
        // technique already proven working in this project's lens
        // shader, reused here rather than inventing a new spatial-noise
        // approach. `.floor()` on the seed coordinates keeps the noise
        // texture stable per small world-space cell rather than
        // shimmering every fragment.
        const foamNoiseSeed = positionWorld.x.mul(2.2).add(waterTimeUniform.mul(1.3)).floor().add(positionWorld.z.mul(2.2).floor().mul(57.0));
        const foamNoise = hash(foamNoiseSeed);
        const wideWash = tslSmoothstep(float(0.3), float(0.75), foamNoise).mul(tslSmoothstep(float(1).sub(lineWidth.mul(4)), float(1), linePhase).add(tslSmoothstep(lineWidth.mul(4), float(0), linePhase)));
        const foamShape = mix(crestLines, max(crestLines, wideWash), shoreProximity);
        const foamCoverage = foamMask.mul(foamShape).mul(shoreProximity);
        // Per "volumetric" — a real foamy wash has visible thickness/
        // depth, not a flat, uniformly-bright color fill. A second,
        // coarser noise layer darkens SOME of the covered area slightly
        // (reads as shadowed pockets between foam bubbles/clumps) while
        // the brightest cells stay near-white — real foam has exactly
        // this uneven, clumpy brightness variation, not a flat wash.
        const depthNoiseSeed = positionWorld.x.mul(0.9).add(positionWorld.z.mul(0.9).mul(37.0));
        const depthNoise = mix(float(0.65), float(1.15), hash(depthNoiseSeed));
        const foamGlow = color(0xf0f8ff).mul(foamCoverage).mul(depthNoise).mul(1.8);

        // Real sun-glint specular sparkle — per "not seeing a lot of
        // actual waves going up and down": this was a real, significant
        // omission in the first version of this rebuild, not a distance/
        // perspective illusion (confirmed via real frame-to-frame pixel
        // diffing that the geometry IS moving, just without this — the
        // strongest VISUAL CUE the old CPU version had for "the water is
        // actively waving," since it's a bright, wave-crest-tracking
        // highlight, not just a subtle base-color shift). normalWorld
        // here reflects the REAL analytic normal from normalNode above
        // (that's the whole purpose of overriding it) — trusted rather
        // than recomputing the wave sum a third independent time.
        // Manual length-based normalization throughout (not .normalize()
        // as a node method — appears in this file's disabled fluid-sim
        // code but was never actually live-tested, so not trusted here
        // either, same reasoning as normalNode's own manual normalize).
        const viewVec = cameraPosition.sub(positionWorld);
        const viewDir = viewVec.div(viewVec.length());
        const sunDirNorm = sunDirUniform.div(sunDirUniform.length());
        const reflectDir = reflect(viewDir.negate(), normalWorld);
        const sunAlign = clamp(dot(reflectDir, sunDirNorm), 0, 1);
        // Sharper near crests, softer in troughs — reuses rawFoam
        // (already computed above from the real wave-displaced position)
        // as the crest-proximity signal, matching the old CPU version's
        // own "steeper near crests" intent without a third independent
        // wave-sum recomputation. 150 (soft, trough) to 450 (tight,
        // crest) — same range as the original.
        // Per "why so many white dots on the ocean waves" — the exact
        // same specular-aliasing bug already diagnosed and fixed once
        // this session for this water's OWN earlier glint (confirmed via
        // real frame-diffing that pow(48) was too sharp, softened to
        // pow(14)) — reintroduced here at an even worse severity (150-450)
        // and compounded by the new 350-segment mesh: more individual
        // vertices, each independently flipping in/out of a razor-thin
        // highlight, reads as scattered dots instead of a smooth
        // streak. Matches the same proven-good range this project
        // already established, not a fresh guess.
        const glintExponent = float(10).add(rawFoam.mul(8));
        const glintCore = pow(sunAlign, glintExponent);
        // Multiplier pulled back too (1.8 -> 1.1) — the earlier-proven
        // value for this same softer exponent range (a wider highlight
        // naturally covers more pixels, so it reads brighter overall at
        // the same multiplier than the old razor-sharp one did).
        const sunGlint = color(0xfff4e0).mul(glintCore).mul(1.1);

        return foamGlow.add(sunGlint);
      })();
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
    flowDir: normalizeFlow(flowDir), crustOctaves, crackOctaves, flowBeads, rippleTexture, foamAccum, shoreDampBuffer,
    rippleLayer,
    lastElapsed: undefined, // set on first updateLiquidPlane call — used to derive real per-frame dt for the foam decay above, since this function only receives cumulative elapsed time
  };
}

// Real disturbance-driven update for the additive ripple layer (see
// createLiquidPlane's own setup comment) — separate from
// updateLiquidPlane itself for the SAME reason updateFluidSimWater is
// separate from it: compute dispatch needs the real renderer, which
// updateLiquidPlane (called from a CPU-only context in main.js) doesn't
// receive. Call this alongside updateLiquidPlane, with the renderer main.js
// already has on hand.
function updateRippleLayer(handle, renderer, playerPos, playerY, dt) {
  const ripple = handle && handle.rippleLayer;
  if (!ripple) return;
  if (!renderer || typeof renderer.compute !== "function") return; // defensive — same canSyncCompute-style guard updateFluidSimWater already uses
  if (!ripple.initialized) {
    renderer.compute(ripple.computeInit);
    ripple.initialized = true;
  }
  // Real per-frame horizontal speed, derived from consecutive position
  // values (this function only ever receives position, not velocity) —
  // same derive-speed-from-position-delta technique already used
  // elsewhere in this project for anything handed position only.
  let speed = 0;
  if (ripple.lastPlayerX !== null && dt > 0) {
    const ddx = playerPos.x - ripple.lastPlayerX;
    const ddz = playerPos.z - ripple.lastPlayerZ;
    speed = Math.sqrt(ddx * ddx + ddz * ddz) / dt;
  }
  ripple.lastPlayerX = playerPos.x;
  ripple.lastPlayerZ = playerPos.z;
  // Only disturbs the water when the player is actually AT the surface
  // (swimming/wading), not just anywhere above or below it — a real
  // proximity gate, not a decorative one.
  const nearSurface = Math.abs(playerY - handle.waterY) < 2.5;
  ripple.playerPos.value.set(playerPos.x, playerPos.z);
  ripple.splashStrength.value = nearSurface ? Math.min(0.6, speed * 0.05) : 0;
  renderer.compute(ripple.computeUpdate);
  renderer.compute(ripple.computeCopyBack);
}

function updateLiquidPlane(handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon, reflectionTexture, reflectionMatrix, refractionTexture, resolution, stormAmount = 0, dayAmount = 1, windStrength = 0) {
  if (!handle) return;
  // Fluid-sim water (see buildCrystalFluidSimPlane) is driven entirely by
  // a GPU compute shader, dispatched separately from main.js's animate
  // loop via updateFluidSimWater (needs the renderer, which this
  // CPU-only function doesn't have) — nothing below applies to it.
  if (handle.fluidSim) return;
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
  // Water-surface caustic uniform updates removed — per explicit "remove
  // the surface caustics system, we want just the seafloor" (see
  // buildWaterMaterial's own removal comment). The seafloor version in
  // main.js's simpleTerrainMat has its own, separate update path and is
  // unaffected.
  if (biome === "crystal") {
    // Real GPU-driven wave shape — per explicit "rebuild it... using the
    // best tool we have." position/normal/color/foam are now all real
    // TSL nodes on the material (see buildWaterMaterial's
    // positionNode/normalNode/colorNode/emissiveNode) — the CPU-side
    // per-vertex loop further below (posAttr/colorAttr writes, the
    // Gerstner sum, foam persistence, SSS/Fresnel/sun-glint) is now
    // entirely dead for crystal, replaced by the GPU computation. The
    // self-managed time and sun-direction uniforms still need updating
    // here each frame — sunDir is the same real parameter this function
    // already receives (main.js's actual sun position), not a new input.
    // Returns before that loop runs at all — not just skipping crystal's
    // OWN branch inside it, the whole per-vertex CPU cost this rebuild
    // exists to eliminate.
    if (mesh.material.userData.waterTimeUniform) mesh.material.userData.waterTimeUniform.value = elapsed;
    if (backMesh && backMesh.material.userData.waterTimeUniform) backMesh.material.userData.waterTimeUniform.value = elapsed;
    if (sunDir) {
      if (mesh.material.userData.sunDirUniform) mesh.material.userData.sunDirUniform.value.copy(sunDir);
      if (backMesh && backMesh.material.userData.sunDirUniform) backMesh.material.userData.sunDirUniform.value.copy(sunDir);
    }
    return;
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
  // Foam signal — crystal-only (see createLiquidPlane). No longer a
  // geometry attribute; handle.foamBuffer (instancedArray) replaces it —
  // see that variable's own comment in createLiquidPlane for why.
  const foamBuffer = biome === "crystal" ? handle.foamBuffer : null;
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
      //
      // Per explicit "a slight breeze and a big storm... should make the
      // water waves more choppy" — this used to be driven ONLY by
      // stormAmount (=rainIntensity), meaning completely calm, dry
      // weather always meant dead-flat baseline chop regardless of any
      // actual wind blowing. windStrength is the SAME live value weather.js
      // already feeds trees and rain-drift (it already includes the
      // storm boost internally, see its own comment there), so a plain
      // breeze now ruffles the water a little even with zero rain, and a
      // real squall — wind boosted hard by heavy rain — pushes chop
      // considerably further than the old rain-only formula did.
      // 0.35 is Crystal's own calm-weather windBaseStrength (weather.js)
      // — windExcess is 0 at that ordinary calm state (so this doesn't
      // change how the sea already looked on an unremarkable day),
      // rising only as real wind — an actual breeze gust or a squall —
      // pushes above it.
      const windExcess = Math.max(0, windStrength - 0.35);
      const stormWaveMult = 1 + windExcess * 0.35 + stormAmount * 0.9;
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
        // Per "foam looks applied to the whole ocean instead of just
        // when it washes on shore" — real bug: `disturbance` (below,
        // unchanged) is purely wave-crest-height-based, which is high at
        // crests EVERYWHERE across the open ocean, not something that
        // was ever shore-specific on its own. shoreProximity uses the
        // SAME shoreDamp array already computed above for the swash
        // zone (0 right at the shoreline, ramping up to 1 in deep
        // water) — inverted here, since that convention is the opposite
        // of what foam coverage needs — to gate foam down to near-zero
        // once a vertex is genuinely out in open water, regardless of
        // how tall its own wave crest happens to be.
        const shoreProximity = handle.shoreDamp ? 1 - handle.shoreDamp[i] : 0;
        const persistedFoam = Math.max(disturbance, (foamAccum[i] || 0) * foamDecayFactor) * shoreProximity;
        foamAccum[i] = persistedFoam;
        // Per a confirmed Three.js source (a real advanced-TSL guide,
        // not a guess): instancedArray's underlying writable data lives
        // at .value (the actual BufferAttribute object, confirmed by
        // .value.addUpdateRange being a real, documented
        // BufferAttribute method), NOT a plain .array shortcut the way
        // uniformArray works — those are different TSL constructs with
        // different CPU-write APIs, which earlier code in this exact
        // file wrongly conflated.
        if (foamBuffer) foamBuffer.value.array[i] = persistedFoam;
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
    // foamBuffer (instancedArray) needs its OWN needsUpdate — set on
    // .value specifically (the real BufferAttribute underneath), not on
    // foamBuffer itself, per the same confirmed API shape used for the
    // write above. No addUpdateRange call — every single element gets a
    // new value every frame (not a small subset), so the simpler
    // whole-buffer needsUpdate=true (Three.js's own default behavior
    // without a narrowed range) is the correct, safe choice here rather
    // than guessing at addUpdateRange's exact byte-vs-element-offset
    // convention for this specific API.
    if (foamBuffer) foamBuffer.value.needsUpdate = true;
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
  if (handle.fluidSim) {
    scene.remove(handle.mesh);
    riftDeferDispose(() => {
      handle.mesh.geometry.dispose();
      handle.mesh.material.dispose();
      // GENUINELY UNVERIFIED: whether Three.js's compute storage buffers
      // (instancedArray, used for height/velocity above) need their own
      // explicit disposal beyond the mesh/geometry/material, on top of
      // the buffer-destroy timing issue already fixed elsewhere in this
      // file. Wrapped in try/catch so an unexpected API shape here can't
      // crash disposal for everything else — if this turns out to leak
      // GPU memory over repeated level switches, that's the next thing
      // to investigate with real devtools memory profiling, not guessed
      // at further here.
      try {
        if (handle.heightBufferA && typeof handle.heightBufferA.dispose === "function") handle.heightBufferA.dispose();
        if (handle.heightBufferB && typeof handle.heightBufferB.dispose === "function") handle.heightBufferB.dispose();
      } catch (err) {
        console.warn("[liquid] fluid-sim buffer disposal — unverified API, logging instead of crashing:", err);
      }
    });
    return;
  }
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
    // Same genuinely-unverified disposal question as the fluid-sim
    // buffers above (see that block's own comment) — try/catch for the
    // same reason, so an unexpected API shape here can't break disposal
    // for everything else.
    if (handle.rippleLayer) {
      try {
        const r = handle.rippleLayer;
        if (r.heightBuffer && typeof r.heightBuffer.dispose === "function") r.heightBuffer.dispose();
      } catch (err) {
        console.warn("[liquid] ripple layer buffer disposal — unverified API, logging instead of crashing:", err);
      }
    }
  });
}

// -----------------------------------------------------------------------------
// Real foam particles, Coral Shallows only — per explicit "add real foam
// particles... using webgpu". Genuinely GPU-compute-driven (not the flat
// vertex-color aFoam signal from updateLiquidPlane above, which stays as-is
// and still drives the base water material's own foam blend) — this is a
// SEPARATE layer of individually-visible foam sprites scattered along the
// actual breaking shoreline.
//
// This is a deliberately DIFFERENT category of compute problem than the
// wave height-field simulation that caused so much trouble earlier in this
// project: each particle here is fully independent — it spawns, drifts,
// fades, and dies with ZERO dependency on any neighboring particle's state.
// The wave sim's instability came specifically from each grid cell reading
// its NEIGHBORS every step (a coupled system that can amplify error); there
// is no equivalent coupling here, so that whole class of bug structurally
// cannot happen in this system.
//
// Two real lessons carried over from the wave-simulation debugging, applied
// proactively rather than rediscovered the hard way again:
// 1. Never rely on TSL's built-in `time`/`deltaTime` inside a compute-only
//    dispatch — confirmed unreliable there earlier. Uses its own explicit,
//    self-managed dt uniform, set from main.js's real per-frame `dt` value.
// 2. Uses the synchronous `renderer.compute()` (not `computeAsync()`) for
//    the same real performance reason established during the wave work.
const FOAM_PARTICLE_COUNT = 600;
const FOAM_SHORE_SAMPLE_COUNT = 160;

function buildFoamShorePoints(sampleHeight, y, size) {
  // Walks a grid across the plane once at level-build time and keeps every
  // point where the real terrain height crosses close to the water level —
  // i.e., the actual shoreline, following Coral Shallows' real irregular
  // island coastline rather than assuming a straight line (the same
  // reasoning already established for shoreDampBuffer above). Downsampled
  // to a fixed FOAM_SHORE_SAMPLE_COUNT so the per-frame disturbance
  // evaluation below (real Gerstner math, just at a small number of points)
  // stays cheap regardless of how many raw candidates the walk finds.
  const candidates = [];
  const STEP = Math.max(4, size / 220);
  const BAND = 1.4; // how close to the water level counts as "shoreline" for this walk
  for (let x = -size / 2; x <= size / 2; x += STEP) {
    for (let z = -size / 2; z <= size / 2; z += STEP) {
      const h = sampleHeight(x, z);
      if (h == null) continue;
      if (Math.abs(h - y) < BAND) candidates.push({ x, z });
    }
  }
  if (candidates.length === 0) return null;
  const points = [];
  for (let i = 0; i < FOAM_SHORE_SAMPLE_COUNT; i++) {
    points.push(candidates[Math.floor((i / FOAM_SHORE_SAMPLE_COUNT) * candidates.length)]);
  }
  return points;
}

function createFoamParticles(scene, sampleHeight, y, size) {
  const shorePoints = buildFoamShorePoints(sampleHeight, y, size);
  if (!shorePoints) return null; // no shoreline found (shouldn't happen for crystal, but this is a real fallback, not assumed away)

  const shoreX = uniformArray(shorePoints.map((p) => p.x), "float");
  const shoreZ = uniformArray(shorePoints.map((p) => p.z), "float");
  // Real wave disturbance at each shore point, re-evaluated every frame in
  // plain JS (see updateFoamParticles below) using the SAME Gerstner sum
  // GERSTNER_WAVES already uses for the base water surface — genuinely
  // reactive to the real wave state, not an independent/fake pattern. Only
  // FOAM_SHORE_SAMPLE_COUNT points, so this stays cheap even though it's a
  // real analytic evaluation, not a lookup.
  const shoreDisturbance = uniformArray(new Array(FOAM_SHORE_SAMPLE_COUNT).fill(0), "float");

  const positionBuffer = instancedArray(FOAM_PARTICLE_COUNT, "vec3");
  const velocityBuffer = instancedArray(FOAM_PARTICLE_COUNT, "vec3");
  const lifeBuffer = instancedArray(FOAM_PARTICLE_COUNT, "float");
  const particleDt = uniform(0.016); // self-managed — see the file-level comment above for why, set from real dt every frame below
  // Real per-frame-varying seed for respawn shore-point selection — a
  // TSL Fn() body only runs ONCE at shader-construction time to BUILD the
  // node graph, so a plain JS Date.now() call inside it would bake in a
  // single frozen constant forever, never actually varying per frame (the
  // exact same category of mistake as relying on TSL's built-in `time`
  // inside a compute-only dispatch — see updateFluidSimWater's own
  // history). This uniform is what actually varies, set from real elapsed
  // time in updateFoamParticles below.
  const spawnSeed = uniform(0);

  const computeInit = Fn(() => {
    lifeBuffer.element(instanceIndex).assign(0); // dead — respawns on the very next computeUpdate, no separate spawn-immediately logic needed
    positionBuffer.element(instanceIndex).assign(vec3(0, -9999, 0)); // parked far below the scene until its first real spawn, so nothing flashes at the origin for one frame
  })().compute(FOAM_PARTICLE_COUNT);

  const computeUpdate = Fn(() => {
    const id = instanceIndex;
    const life = lifeBuffer.element(id);
    const pos = positionBuffer.element(id);
    const vel = velocityBuffer.element(id);

    If(life.lessThanEqual(0), () => {
      // Respawn attempt. A different shore index each real respawn (not
      // just each particle) — hash() fed by both id AND a coarse time
      // bucket, so the same particle slot cycles through different shore
      // points over its lifetime instead of always reviving at the same
      // spot.
      const shoreIdx = hash(id.add(uint(spawnSeed))).mul(float(FOAM_SHORE_SAMPLE_COUNT)).floor().toUint();
      const disturbance = shoreDisturbance.element(shoreIdx);
      // Only spawns where the real wave is actually cresting/breaking right
      // now (disturbance above threshold) — quiet stretches of shore stay
      // foam-free, matching how real surf only foams where waves are
      // actively breaking.
      If(disturbance.greaterThan(0.35), () => {
        const sx = shoreX.element(shoreIdx);
        const sz = shoreZ.element(shoreIdx);
        const jitterX = hash(id.add(uint(1))).sub(0.5).mul(2.5);
        const jitterZ = hash(id.add(uint(2))).sub(0.5).mul(2.5);
        pos.assign(vec3(sx.add(jitterX), float(y).add(0.05), sz.add(jitterZ)));
        const outAngle = hash(id.add(uint(3))).mul(6.28318);
        const outSpeed = hash(id.add(uint(4))).mul(0.6).add(0.3);
        vel.assign(vec3(outAngle.cos().mul(outSpeed), hash(id.add(uint(5))).mul(0.5).add(0.3), outAngle.sin().mul(outSpeed)));
        life.assign(hash(id.add(uint(6))).mul(1.5).add(1.2)); // 1.2-2.7s — real foam froths up fast and lingers only briefly, not a long slow fade
      });
    }).Else(() => {
      // Alive — integrate real motion using the self-managed dt (see file
      // comment for why not TSL's built-in time/deltaTime).
      vel.y.subAssign(particleDt.mul(1.1)); // gravity — foam settles/sinks back rather than floating forever
      pos.addAssign(vel.mul(particleDt));
      life.subAssign(particleDt);
    });
  })().compute(FOAM_PARTICLE_COUNT);

  const material = new THREE.SpriteNodeMaterial({
    transparent: true, depthWrite: false, blending: THREE.NormalBlending, // NOT additive — real foam is diffuse/opaque-ish white, not a glowing light source; additive would make overlapping foam blow out to blinding white
  });
  material.positionNode = positionBuffer.toAttribute();
  const lifeAttr = lifeBuffer.toAttribute();
  // Fades in fast, out slow — matches the same "instant rise, slow fade"
  // shape already established for the base water's own foam attribute
  // (see updateLiquidPlane's persistedFoam comment) rather than a plain
  // linear fade, so this reads consistently with the foam that's already
  // there.
  material.opacityNode = clamp(lifeAttr.mul(2.2), 0, 1).mul(clamp(lifeAttr, 0, 1));
  // Per real giant-blob rendering — CONFIRMED via Three.js's own GitHub
  // issue tracker: scaleNode on SpriteNodeMaterial expects a vec2 (width,
  // height), not vec3 (their own docs were wrong about this too). A vec3
  // gets silently coerced through an internal float() cast, which very
  // likely explains the oversized distorted foam shapes reported live.
  const foamSize = clamp(lifeAttr.mul(0.9), 0.15, 0.9);
  material.scaleNode = vec2(foamSize, foamSize);
  const foamTex = texture(getFoamTexture(), uv());
  material.colorNode = foamTex.rgb;
  material.opacityNode = material.opacityNode.mul(foamTex.a);

  // Per the real crash — `THREE.SpriteGeometry` isn't a real constructor;
  // confirmed directly against Three.js's own official Sprite docs:
  // `.count` (WebGPU-only, for exactly this instanced-sprite-particle use
  // case) is a real property on `THREE.Sprite` itself. Sprite carries its
  // own internal geometry — it isn't built from THREE.Mesh + a separate
  // geometry object at all, unlike every other mesh in this file.
  const sprite = new THREE.Sprite(material);
  sprite.count = FOAM_PARTICLE_COUNT;
  sprite.frustumCulled = false; // positions live entirely on the GPU buffer — CPU-side geometry bounds have no idea where particles actually are, so normal frustum culling would cull incorrectly
  scene.add(sprite);

  return {
    foamParticles: true,
    sprite, computeInit, computeUpdate, particleDt, spawnSeed,
    shoreDisturbance, shoreX, shoreZ, shorePoints,
    positionBuffer, velocityBuffer, lifeBuffer, // exposed for real disposal below — previously only reachable via closure, so disposeFoamParticles could never actually reach them
    initialized: false, broken: false,
  };
}

function updateFoamParticles(handle, renderer, dt) {
  if (!handle || !handle.foamParticles || handle.broken) return;
  // Real wave disturbance at each shore sample point, re-evaluated every
  // frame — a small, cheap CPU loop (FOAM_SHORE_SAMPLE_COUNT points, not
  // the full water mesh) using the exact same domain-warped Gerstner sum
  // the base water surface uses, so foam genuinely tracks real wave state
  // rather than an independent decorative pattern.
  const elapsed = performance.now() / 1000;
  for (let i = 0; i < handle.shorePoints.length; i++) {
    const p = handle.shorePoints[i];
    const [wx, wz] = gerstnerDomainWarp(p.x, p.z, elapsed);
    let dy = 0;
    for (const w of GERSTNER_WAVES) {
      const f = w.k * (w.ndx * wx + w.ndz * wz) - w.speed * elapsed;
      dy += w.amplitude * Math.sin(f);
    }
    handle.shoreDisturbance.array[i] = Math.abs(dy) / (GERSTNER_AMPLITUDE_SUM * 0.5);
  }
  // Real per-frame-varying respawn seed (see spawnSeed's own comment above
  // for why this can't just be computed inside the TSL Fn() body) —
  // multiplied by a large odd-ish constant and wrapped, so it changes every
  // single frame without ever repeating on any short, noticeable cycle.
  handle.spawnSeed.value = Math.floor(elapsed * 733) % 999983;
  handle.particleDt.value = Math.min(dt, 0.05); // clamped — a real stall/tab-switch shouldn't let one giant dt fling every dead particle's respawn timing at once
  const canSyncCompute = typeof renderer.compute === "function";
  try {
    if (!handle.initialized) {
      if (canSyncCompute) renderer.compute(handle.computeInit); else renderer.computeAsync(handle.computeInit);
      handle.initialized = true;
    }
    if (canSyncCompute) renderer.compute(handle.computeUpdate); else renderer.computeAsync(handle.computeUpdate);
  } catch (err) {
    console.error("[liquid] foam particles: compute dispatch failed:", err);
    handle.broken = true; // stop retrying every frame — same reasoning as updateFluidSimWater's own identical guard
  }
}

function disposeFoamParticles(scene, handle) {
  if (!handle) return;
  // Per a real "GPUValidationError: [Buffer (unlabeled)] used in submit
  // while destroyed" — positionBuffer/velocityBuffer/lifeBuffer were
  // created here but never actually exposed on the returned handle, so
  // this function could only ever reach sprite.geometry/material, never
  // the underlying compute storage buffers themselves. Disposing the
  // material likely tears down ITS OWN referenced buffers (positionNode
  // = positionBuffer.toAttribute(), etc.) as an internal side effect,
  // while computeInit/computeUpdate — separate node graphs, not owned by
  // the material — kept referencing those same now-invalid buffer
  // objects, exactly matching a "used after destroyed" GPU error.
  // handle.broken is set synchronously (not deferred) as an immediate
  // safety net: even though main.js nulls its own foamParticlesHandle
  // reference right after calling this, this guarantees
  // updateFoamParticles becomes a no-op instantly for this handle
  // specifically, regardless of how it's reached.
  handle.broken = true;
  scene.remove(handle.sprite);
  riftDeferDispose(() => {
    handle.sprite.geometry.dispose();
    handle.sprite.material.dispose();
    // Storage/uniform buffer disposal is genuinely less-documented API
    // surface (same honest caveat as the fluid-sim system's own buffer
    // disposal above) — wrapped defensively so a missing/renamed method
    // logs instead of throwing during teardown.
    for (const buf of [handle.positionBuffer, handle.velocityBuffer, handle.lifeBuffer, handle.shoreDisturbance, handle.shoreX, handle.shoreZ]) {
      try {
        if (buf && typeof buf.dispose === "function") buf.dispose();
      } catch (err) {
        console.error("[liquid] foam particles: buffer dispose failed (non-fatal):", err);
      }
    }
  });
}

export { createLiquidPlane, updateLiquidPlane, updateRippleLayer, disposeLiquidPlane, updateFluidSimWater, createFoamParticles, updateFoamParticles, disposeFoamParticles, createBreakingWave, updateBreakingWave, disposeBreakingWave, createWaterfall, updateWaterfall, disposeWaterfall, createRiverCurrent, updateRiverCurrent, disposeRiverCurrent, createRiverFlowStrip, updateRiverFlowStrip, disposeRiverFlowStrip, createCliffWall, disposeCliffWall, createSourcePond, updateSourcePond, disposeSourcePond, createOceanSurfaceDetail, updateOceanSurfaceDetail, disposeOceanSurfaceDetail };

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
