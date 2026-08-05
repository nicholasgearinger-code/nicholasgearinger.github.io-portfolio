import * as THREE from "three";
import { getGraphicsSettings } from "./graphicsSettings.js";

// -----------------------------------------------------------------------------
// SWAP POINT: this is the entire terrain-shaping algorithm. It builds one
// large heightfield landmass per biome (a subdivided plane with per-vertex
// noise displacement) instead of the old small floating-island shapes —
// "a whole planet to explore" rather than a chain of separate platforms.
// Swap buildPlanetTerrain() for a different algorithm (a real heightmap
// texture, domain-warped noise, hydraulic erosion, hand-sculpted chunks)
// as long as it keeps returning a THREE.BufferGeometry sized to
// TERRAIN_SIZE x TERRAIN_SIZE in the XZ plane.
// -----------------------------------------------------------------------------

const TERRAIN_SIZE = 240;      // full width/depth of the landmass, in world units

const TERRAIN_SEGMENTS_DEFAULT = 140;  // fallback only — actual resolution comes from graphicsSettings' current tier
const RIVER_WIDTH = 10;        // Verdant Hollow's river channel, half-width in world units — widened from 7 for a more substantial "long river" presence
const RIVER_DEPTH = 7;         // was 2.5 — pushed much deeper per explicit request. Still guarantees a continuous flooded channel regardless of surrounding hill terrain (see the verdant shaper below)
const WATERFALL_Z = -80;       // fixed world Z where the elevated upstream "source" terrain drops into the river — main.js positions the waterfall visual here too, by sampling the actual rendered terrain height rather than duplicating this file's noise math
const WATERFALL_SOURCE_HEIGHT = 16; // how high the source area rises above the normal rolling-hills base at its peak, past the ramp-up zone
// A small source pond up on the elevated plateau, feeding the waterfall
// — without one the falls had no visible water source at all. Kept well
// north of WATERFALL_Z - 4 (the waterfall visual's own sampling point in
// main.js) so carving this basin can never affect where the falls are
// positioned or how tall they read.
const POND_Z = WATERFALL_Z - 24;
const POND_RADIUS = 13;
const POND_LEVEL = 12;         // fixed absolute height the pond's water sits at — well within the plateau's typical elevated range (base + WATERFALL_SOURCE_HEIGHT), clearly above the main river far below
const POND_DEPTH = 4;          // how far below POND_LEVEL the basin's carved floor sits — same "blend toward a fixed absolute floor" guarantee the main river channel uses, so the basin holds water regardless of the surrounding hill noise
// A dedicated entrance ramp leading down to a genuinely separate
// underground room (the room mesh itself is built in main.js, using
// ROOM_FLOOR_Y here to guarantee the two meet at the same height).
// Fixed location, well clear of the winding canyon's own range (that
// meandering path can reach up to ±40 in X at its widest, so X=60 keeps
// real margin regardless of the canyon's exact position at this Z).
const RAMP_CENTER_X = 60, RAMP_CENTER_Z = 50, RAMP_LENGTH = 18, RAMP_HALF_WIDTH = 8; // widened from 4 — at Low graphics tier the terrain mesh is only 40 segments across 240 units (6-unit grid spacing), and the old 8-unit-wide ramp was barely 1.33 grid cells wide, genuinely too narrow for such a sparse mesh to reliably represent
// The room itself is WIDER than the narrow ramp corridor above — these
// two constants are shared with main.js's room-mesh construction so the
// two can never drift out of sync, the same way ROOM_FLOOR_Y already is.
const ROOM_WIDTH = 16, ROOM_LENGTH = 24;
const ROOM_ROOF_Y = -7; // just above the room's own ceiling — verified numerically: the ceiling box's actual top surface sits at -8.4 (center -9 + half its 1.2 thickness), so -7 leaves a comfortable 1.4-unit buried margin rather than a razor-thin one
// A real mountain covering the whole ramp/room/tunnel network — centered
// to comfortably cover the existing system's full footprint (the ramp
// starts at Z=50, the room extends out to Z=94) with real margin, not
// just barely enclosing it.
const MOUNTAIN_CENTER_X = 60, MOUNTAIN_CENTER_Z = 70, MOUNTAIN_RADIUS = 55, MOUNTAIN_PEAK_HEIGHT = 35; // radius widened from 45 to comfortably cover the branch+second chamber too, not just the original room — verified numerically the chamber's far edge was just barely outside the old radius
// A connecting branch off the main room, leading to a second chamber —
// a level corridor (stays at ROOM_FLOOR_Y the whole way, no ramp needed
// since it connects two already-underground spaces) exiting the main
// room's east wall.
const BRANCH_START_X = RAMP_CENTER_X + ROOM_WIDTH / 2; // starts exactly at the main room's east wall
const BRANCH_LENGTH = 22, BRANCH_HALF_WIDTH = 8; // same width as the ramp, for the same coarse-mesh robustness reasoning
const BRANCH_Z = RAMP_CENTER_Z + RAMP_LENGTH + ROOM_LENGTH / 2; // same Z as the main room's own center, so it branches off sideways at the same depth
const CHAMBER_RADIUS = 11; // the second, smaller chamber at the branch's far end
const ROOM_FLOOR_Y = -18; // MUST match main.js's room-mesh floor placement — the ramp's floor at its far end and the room's own floor must meet at the same height for a seamless transition
const LAVA_CHANNEL_WIDTH = 9;  // Ember's main winding lava channel, half-width in world units — separate constant since it's deliberately wider/deeper than Verdant's river
const EMBER_PATH_INNER = LAVA_CHANNEL_WIDTH + 0.5; // small gap between the channel's edge and the path so they don't visually run together
const EMBER_PATH_OUTER = LAVA_CHANNEL_WIDTH + 3.5;

// Shared by BIOME_SHAPERS.ember (to carve the channel) and
// applyHeightShading (to paint a sandy path alongside it) — one formula,
// not two copies that could drift apart over future edits.
function emberChannelCenterX(worldZ, seed) {
  return Math.sin(worldZ * 0.03 + seed * 0.012) * 30 + Math.sin(worldZ * 0.011 + seed * 0.02) * 15;
}

// Where the liquid plane (see liquid.js) sits for biomes that have one.
// Tuned against each biome's own height range so it floods only the
// carved channel/cracks it belongs to, not the surrounding hills — see
// the per-biome comments in BIOME_SHAPERS below for why each value works.
const LIQUID_LEVEL = { ember: -1.5, verdant: -1, crystal: 8 }; // crystal's underwater reef shaping peaks at seafloor(2.2)+ripple(0.3)+reefMound(3.96)=~6.46 in the worst case every noise stacks at once — 8 keeps a real safety margin above every reef mound while staying shallow enough for a bright, light-filled reef rather than a deep trench. The one deliberate exception is the emergent island (peak 11.5, guaranteed via Math.max) near the landmark position — that's SUPPOSED to clear this line; everywhere else on the map should stay well below it.

function hashStringToSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h >>> 0) / 4294967296; // 0..1
}

// Deterministic 2D hash -> pseudo-random [0,1). Cheap, deterministic, good
// enough for terrain (not cryptographic).
function hash2(x, y, seed) {
  const n = x * 127.1 + y * 311.7 + seed * 999.9;
  const s = Math.sin(n) * 43758.5453123;
  return s - Math.floor(s);
}

function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise2(x, y, seed) {
  const x0 = Math.floor(x), x1 = x0 + 1;
  const y0 = Math.floor(y), y1 = y0 + 1;
  const tx = smooth(x - x0), ty = smooth(y - y0);
  const c00 = hash2(x0, y0, seed), c10 = hash2(x1, y0, seed);
  const c01 = hash2(x0, y1, seed), c11 = hash2(x1, y1, seed);
  const top = lerp(c00, c10, tx), bot = lerp(c01, c11, tx);
  return lerp(top, bot, ty) * 2 - 1; // -1..1
}

function fbm2(x, y, seed, octaves, lacunarity, gain) {
  let amplitude = 1, frequency = 1, sum = 0, max = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2(x * frequency, y * frequency, seed + i * 17.13) * amplitude;
    max += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / max;
}

// -----------------------------------------------------------------------------
// Per-biome shaping. Each returns a height (in world units) for a given
// normalized (u,v) position in [-1,1] — u/v map linearly onto the
// TERRAIN_SIZE plane. Distinct octave counts/frequencies/post-processing
// per biome, not just a color swap, so each landmass actually reads as a
// different kind of place.
// -----------------------------------------------------------------------------
const BIOME_SHAPERS = {
  // Jagged volcanic ground with narrow carved lava-crack channels, plus
  // one main winding lava channel (same meandering-sine technique as
  // Verdant's river) — gives Ember one clear signature flow line instead
  // of only scattered noise-based cracks, matching the reference
  // composition of one continuous lava river rather than a diffuse field
  // of small cracks.
  ember(u, v, seed) {
    const worldX = u * (TERRAIN_SIZE / 2), worldZ = v * (TERRAIN_SIZE / 2);
    const base = fbm2(u * 2.2, v * 2.2, seed, 5, 2.1, 0.55);
    const jagged = Math.abs(base) * 1.6; // ridged noise — sharp peaks instead of rolling hills
    const crackNoise = fbm2(u * 5 + 100, v * 5 + 100, seed + 40, 3, 2.0, 0.5);
    const crack = Math.abs(crackNoise) < 0.09 ? -3.5 : 0; // wider grooves than before — larger, more connected lava flows instead of thin cracks

    const channelCenterX = emberChannelCenterX(worldZ, seed);
    const distFromChannel = Math.abs(worldX - channelCenterX);
    let channel = 0;
    if (distFromChannel < LAVA_CHANNEL_WIDTH) {
      const t = 1 - distFromChannel / LAVA_CHANNEL_WIDTH;
      channel = -t * t * 6; // deeper than the scattered cracks — ensures the ground lava plane (liquid.js, LIQUID_LEVEL.ember) reliably floods this whole winding line, not just isolated low points
    }

    // Flatten the jagged/cracked terrain within the path band alongside
    // the channel — a real smooth trail, not just jagged rock painted
    // tan by applyHeightShading's matching path-color band below. Never
    // overlaps `channel` itself (the path starts just past the channel's
    // own width), so no interaction between the two.
    const offsetFromChannel = worldX - channelCenterX;
    let flattenT = 0;
    if (offsetFromChannel > EMBER_PATH_INNER && offsetFromChannel < EMBER_PATH_OUTER) {
      const mid = (EMBER_PATH_INNER + EMBER_PATH_OUTER) / 2, half = (EMBER_PATH_OUTER - EMBER_PATH_INNER) / 2;
      flattenT = Math.max(0, 1 - Math.abs((offsetFromChannel - mid) / half));
    }
    const jaggedFlattened = jagged * (1 - flattenT * 0.85);
    const crackFlattened = crack * (1 - flattenT); // suppress any scattered crack that happens to fall inside the path so it doesn't trench through the trail

    return jaggedFlattened * 9 + crackFlattened + channel;
  },
  // Gentle rolling hills, cut through by a winding river channel.
  verdant(u, v, seed) {
    const worldX = u * (TERRAIN_SIZE / 2), worldZ = v * (TERRAIN_SIZE / 2);
    // Two noise scales layered together — big sweeping hill formations
    // with finer rolling detail riding on top, rather than one
    // uniform-frequency bump field just scaled taller (which reads as
    // spikier, not hillier).
    // The primary noise field's amplitude is scaled up directly (a
    // guaranteed increase regardless of seed, since it's literally the
    // same field just amplified) — a second, lower-frequency layer adds
    // supplementary big-hill variety on top, rather than being relied on
    // for the increase itself (two independent noise fields don't add
    // their amplitudes predictably; their peaks rarely line up at the
    // same point, so how much extra range that alone provides varies a
    // lot by seed luck).
    const detail = fbm2(u * 1.3, v * 1.3, seed, 4, 2.0, 0.5) * 10.5; // was 8.5 — more pronounced hills per explicit request
    const macro = fbm2(u * 0.5, v * 0.5, seed + 300, 3, 2.0, 0.5) * 5; // was 3 — bigger, more separated hill formations, not just gentle rolling
    let base = detail + macro;

    // A fixed elevated "source" area upstream of the waterfall — terrain
    // ramps up sharply past WATERFALL_Z, so the river genuinely descends
    // from higher ground via a real cliff at the falls point, rather
    // than winding across one continuous elevation the whole way. The
    // waterfall visual (wired in main.js) samples the ACTUAL rendered
    // terrain height on both sides of this same WATERFALL_Z to position
    // itself, rather than duplicating this noise math elsewhere — so
    // it's always correctly aligned regardless of the exact noise values
    // at this point.
    if (worldZ < WATERFALL_Z) {
      const t = Math.min(1, (WATERFALL_Z - worldZ) / 4); // tight ramp — a real cliff, not a gradual slope, so the waterfall mesh (which assumes a sharp vertical drop) actually matches the terrain underneath it
      base += t * t * WATERFALL_SOURCE_HEIGHT;
    }

    // The source pond basin — positioned along the SAME riverCenterX path
    // (just computed with POND_Z instead of worldZ) so it reads as a
    // genuine upstream continuation of the river rather than a randomly
    // placed puddle up on the plateau.
    const pondCenterX = Math.sin(POND_Z * 0.035 + seed * 0.01) * 28 + Math.sin(POND_Z * 0.013 + seed * 0.02) * 14;
    const distFromPond = Math.hypot(worldX - pondCenterX, worldZ - POND_Z);
    if (distFromPond < POND_RADIUS) {
      // A fully-guaranteed inner CORE (t=1 exactly, independent of the
      // surrounding hill noise) rather than a blend that only
      // APPROACHES the floor as distance shrinks — worst-case-checked
      // numerically before shipping: with a plain `t = 1 - dist/radius`
      // blend, even a small water mesh near the center could theoretically
      // still end up floating above the actual terrain if the noise
      // happened to peak there, since that blend only reaches the true
      // floor exactly at distance zero. The water mesh (liquid.js/main.js)
      // is sized to sit within this core, so it's genuinely guaranteed
      // submerged regardless of the noise, the same structural guarantee
      // the river channel below uses.
      const pondFloor = POND_LEVEL - POND_DEPTH;
      const coreRadius = POND_RADIUS * 0.55;
      if (distFromPond <= coreRadius) return pondFloor;
      const t = 1 - (distFromPond - coreRadius) / (POND_RADIUS - coreRadius);
      return base * (1 - t * t) + pondFloor * (t * t);
    }

    // Meandering path built from two different-frequency sine waves rather
    // than one — a single sine reads as too regular/mechanical for a
    // river; layering a slow bend with a faster wobble looks natural.
    const riverCenterX = Math.sin(worldZ * 0.035 + seed * 0.01) * 28 + Math.sin(worldZ * 0.013 + seed * 0.02) * 14;
    const distFromRiver = Math.abs(worldX - riverCenterX);
    // River channel only carves south of the falls — north of it is the
    // elevated dry source area with no water feature, which is what
    // actually creates the cliff face for the waterfall to fall down.
    if (worldZ >= WATERFALL_Z && distFromRiver < RIVER_WIDTH) {
      const t = 1 - distFromRiver / RIVER_WIDTH; // 0 at the bank, 1 at the center
      // Blends toward a FIXED absolute floor at the center (well below
      // the water surface) rather than just subtracting a fixed amount
      // from the local hill height — a pure subtraction meant a tall
      // enough hill under the river's path could push the channel back
      // above water level there, breaking one long river into
      // disconnected pond-like segments wherever that happened. Blending
      // toward an absolute floor guarantees continuous flooding along
      // the whole length regardless of the surrounding terrain.
      const riverFloor = LIQUID_LEVEL.verdant - RIVER_DEPTH;
      return base * (1 - t * t) + riverFloor * (t * t);
    }
    return base;
  },
  // Crystal Spire, redesigned as a submerged tropical reef: a gently
  // rolling sandy seafloor (fine ripples layered over broad dunes) with
  // scattered broad reef mounds where coral has built up — rounded domes,
  // not the old sharp angular spikes, since coral heads read as lumpy
  // accretions rather than crystalline points. LIQUID_LEVEL.crystal below
  // sits comfortably above every mound's peak so the whole biome is
  // permanently flooded (same proven technique as Frost's since-removed
  // ocean — a real water plane with zero new rendering code, just a
  // LIQUID_LEVEL/LIQUID_STYLE entry), while staying shallow enough that
  // light can plausibly reach the floor for a "bright" reef rather than a
  // deep-sea trench.
  crystal(u, v, seed) {
    const worldX = u * (TERRAIN_SIZE / 2), worldZ = v * (TERRAIN_SIZE / 2);
    const sandRipple = fbm2(u * 7, v * 7, seed, 2, 2.0, 0.5) * 0.3; // fine current-carved sand ripples
    const seafloor = fbm2(u * 1.4, v * 1.4, seed + 40, 4, 2.0, 0.45) * 2.2; // gentle rolling seafloor swells
    const reefNoise = fbm2(u * 2.4 + 200, v * 2.4 + 200, seed + 80, 3, 2.0, 0.5);
    const reefMound = reefNoise > 0.56 ? (reefNoise - 0.56) * 9 : 0; // broad rounded reef-buildup mounds, not spires

    // A real emergent tropical island at the same coordinates landmarks.js
    // places its landmark (0, -30) — Math.max against the reef shape
    // below rather than adding to it, so the island's height is a
    // structural guarantee independent of whatever the local reef noise
    // happens to be, not a tuned constant hoping to clear the water line.
    // MOVED AGAIN from (30, -30) per explicit "stretch the coastline"
    // follow-up — X centered at 0 gives a full symmetric ±120 units of
    // clearance along that axis (recomputed directly: min(120-0,120+0)
    // =120), vs. the ~90 units available at x=30. Z clearance unchanged
    // (90, at the -Z direction).
    const islandDx = worldX - 0, islandDz = worldZ - (-30);
    // ELONGATED along X — per the same follow-up ("stretch the
    // coastline... goes very far in the distance"). The angle used for
    // the cove notch below is computed from these RAW (unstretched)
    // offsets, so the cove's opening direction stays geometrically
    // meaningful; only the RADIAL distance below is stretched, which is
    // what actually elongates the landmass shape itself.
    const ISLAND_STRETCH_X = 1.3; // verified safe: BLEND(88)*1.3=114.4, a real 5.6-unit margin under the 120-unit X clearance — not eyeballed
    const islandDist = Math.hypot(islandDx / ISLAND_STRETCH_X, islandDz);
    // RESCALED from 38/48/26 in an earlier round — that version was
    // just the SAME small bump scaled up vertically (a tall pointy
    // hill), not an actual large-scale environment. Real coastal
    // scenery is two different things at two different scales: a
    // fairly steep, SHORT cliff face right at the shore, then broad,
    // gently-rolling hills extending far beyond it — not one tall
    // cone. CORE/BLEND use most of the available clearance; PEAK stays
    // modest so the height-to-radius RATIO is low — that ratio, not
    // the absolute height, is what reads as "broad landscape" vs.
    // "steep small hill."
    const ISLAND_CORE = 78, ISLAND_BLEND = 88, ISLAND_PEAK = 20;

    // COVE — an angular "notch" carves a beach opening through the hill
    // mass; everywhere OUTSIDE that wedge, the hill rises to its full
    // height and meets the water directly (no beach shelf there),
    // reading as grass/cliff plunging to the sea.
    const islandAngle = Math.atan2(islandDz, islandDx);
    const COVE_ANGLE = Math.PI / 2; // arbitrary chosen opening direction (facing +Z) — rotate this if a specific approach angle matters more once seen in-browser
    let coveAngleDiff = islandAngle - COVE_ANGLE;
    coveAngleDiff = Math.atan2(Math.sin(coveAngleDiff), Math.cos(coveAngleDiff)); // wrap to [-PI, PI]
    // Widened from 0.5 (~29°) to 0.85 (~49°) — per the reference photo's
    // own much broader bay opening, not a narrow slot.
    const COVE_HALF_WIDTH = 0.85;
    const coveT = Math.min(1, Math.abs(coveAngleDiff) / COVE_HALF_WIDTH); // 0 at the cove's own center angle, 1 at/beyond its edge into solid hillside
    const coveShape = coveT * coveT * (3 - 2 * coveT); // smoothstep — 0 inside the cove (low), 1 in the hills (full height)

    // Distinct dunes along the ridge — per explicit "distinct dunes in
    // the background" follow-up. A real spatially-separate dune feature
    // doesn't fit in the remaining clearance beyond the main landmass
    // (there's genuinely no room left in most directions after the
    // stretch above), so instead this varies the ridge's OWN peak
    // height along its length via low-frequency noise (a few distinct
    // high/low points along X, not fine texture — same fbm2 helper
    // already used throughout this file), reading as a series of
    // separate dune humps along the same coastline rather than one
    // uniform smooth hill.
    const duneVariation = fbm2(worldX * 0.013, 0, seed + 700, 2, 2.0, 0.5); // lowered from 0.02 — broader, more gradual humps along the coastline instead of tightly-packed ones, per explicit "area between the dunes could be smoother" request. Deliberately near-zero Z dependence — this is a variation ALONG the coastline's length, not across it
    const dunePeakMult = 0.88 + Math.max(0, duneVariation + 0.5) * 0.24; // narrowed from 0.7x-1.3x to 0.88x-1.12x — softens the height difference between adjacent dune peaks so the terrain between them reads as a gentle roll rather than a jagged dip

    let islandBump = 0;
    const BEACH_PLATEAU = LIQUID_LEVEL.crystal + 0.9; // REGRESSION FIX: the previous +0.35 margin was too thin against the water plane's own real wave motion — waves were poking up into the cove notch, flooding it ("water appears where it shouldn't be"). Bumped past the original +0.7 for safer clearance. "Flatter near the shore" is now achieved below via an eased rise curve instead of by lowering this absolute height.
    const VALLEY_FLOOR = BEACH_PLATEAU + 0.4; // where the cove's own floor levels out further inland — still low and close to sea level, matching a real cove valley rather than rising toward a peak
    if (islandDist < ISLAND_BLEND) {
      if (islandDist >= ISLAND_CORE) {
        // Beach ring — genuinely gentle (~9° grade) rise from below the
        // waterline up to the modest plateau above, using the full
        // 10-unit band uniformly (linear, not smoothstep — smoothstep
        // would still concentrate steepness in the middle of this band,
        // which is exactly what "nearly flat" can't tolerate anywhere
        // within it).
        const beachT = 1 - (islandDist - ISLAND_CORE) / (ISLAND_BLEND - ISLAND_CORE); // 0 at BLEND, 1 at CORE
        // Eased (not linear) — per "down near the shore flatter" request:
        // stays close to the low end for most of the band's width (reads
        // flat underfoot) and only climbs toward BEACH_PLATEAU in the
        // final stretch approaching CORE, rather than rising at a
        // constant rate the whole way. Height AT CORE (beachT=1) is
        // identical either way, so the safe water clearance above stays
        // exactly what it was — only the shape of the climb changes.
        const easedBeachT = Math.pow(beachT, 1.8);
        const rampHeight = easedBeachT * (BEACH_PLATEAU - (LIQUID_LEVEL.crystal - 1)) + (LIQUID_LEVEL.crystal - 1);
        const outerFade = Math.min(1, beachT / 0.45); // fades the ramp to exactly 0 within the outermost ~45% of the band (near BLEND) instead of colliding with the hard 0 default just outside the islandDist<BLEND guard below — widened from 0.15 (only ~1.65 units) specifically because that was finer than the default mobile terrain mesh's own segment spacing, so it rendered as one hard triangle edge instead of a gradual blend
        // (1 - coveShape) suppresses this ring to ~0 outside the cove —
        // the beach only actually rises within the narrow opening; the
        // Math.max below just falls through to the underwater seafloor
        // everywhere else along this ring, so there's no sandy shelf
        // ringing the whole island anymore.
        // Sand ripple texture — per explicit "the sand is looking too
        // flat" / "add displacement like this [wind-ripple reference
        // photo]" reports. The dry beach previously had NO noise added
        // to its height at all (unlike the underwater seafloor just
        // below, which already gets a real sandRipple term), then a
        // first attempt used plain isotropic noise — that reads as
        // scattered lumps, not the long, wavy, roughly PARALLEL ridge
        // lines real wind-blown sand actually forms. Rebuilt as a real
        // directional ripple: world position is rotated onto a fixed
        // "wind" axis, a low-frequency wobble is added along the ridge
        // direction so the lines aren't perfectly straight (organic,
        // not a ruled pattern), then a sine at a real ridge WAVELENGTH
        // (not blob noise) forms the actual parallel crests, with a
        // second harmonic layered in for irregularity between ridges —
        // the same "coarse structure + finer variation" layering this
        // file already uses elsewhere (e.g. the crust/crack pattern in
        // liquid.js). Still scaled by beachT (0 at the wet outer edge,
        // full further up the dry beach) so it can never eat into the
        // water-clearance margin established after the FU163 regression.
        const RIPPLE_ANGLE = 0.4; // radians — a fixed "prevailing wind" direction for the ridge pattern
        const rippleAlong = worldX * Math.cos(RIPPLE_ANGLE) + worldZ * Math.sin(RIPPLE_ANGLE);
        const rippleAcross = -worldX * Math.sin(RIPPLE_ANGLE) + worldZ * Math.cos(RIPPLE_ANGLE);
        const rippleWobble = fbm2(rippleAlong * 0.04, 0, seed + 771, 2, 2.0, 0.5) * 1.3; // deliberately near-zero rippleAlong-perpendicular dependence — a slow bend ALONG the ridge's own length, not across it, so ridges wander gently rather than staying ruler-straight
        const ridgePhase = (rippleAcross + rippleWobble) * (Math.PI * 2 / 2.4); // ~2.4-unit ridge spacing
        const sandRippleTerrain = (Math.sin(ridgePhase) * 0.5 + Math.sin(ridgePhase * 2.1 + 1.3) * 0.15) * 0.16 * beachT;
        islandBump = (rampHeight + sandRippleTerrain) * outerFade * (1 - coveShape);
      } else {
        // Interior hill — carries the REST of the rise, from this same
        // angle's base height (see baseAtCore below — matches the beach
        // ring's own height at CORE for continuity, no seam) up to this
        // angle's peak.
        //
        // SHAPE CHANGED from smoothstep to an "ease-out" power curve —
        // per the same "broad landscape, not a pointy hill" follow-up.
        // Smoothstep is symmetric (steepest at the radial midpoint,
        // flattening equally on both ends) — over this much larger
        // radius that reads as one huge smooth dome, not "cliff near
        // the coast, flat rolling top further in." A power curve
        // (1-(1-hillT)^POWER) is steep right where hillT is small (near
        // CORE — i.e., right at the coast) and flattens out fast as
        // hillT grows (moving inland toward the peak) — verified
        // numerically (not eyeballed): with POWER=4.5 at this CORE/PEAK,
        // height barely drops for the first ~30 units in from CORE,
        // then falls off more steeply approaching the shore, giving a
        // real "broad flat top, distinct drop near the coast" profile.
        const HILL_POWER = 4.5;
        const hillT = Math.min(1, 1 - islandDist / ISLAND_CORE); // 0 at CORE, 1 at the island's center
        const shaped = 1 - Math.pow(1 - hillT, HILL_POWER);
        // Base height right at CORE for THIS angle — deliberately
        // mirrors the beach ring's own (1 - coveShape) suppression so
        // the two pieces meet with no seam: outside the cove this is
        // ~0 (hill rises straight from the water), inside the cove
        // this is BEACH_PLATEAU (continues the beach's own height).
        const baseAtCore = BEACH_PLATEAU * (1 - coveShape);
        // Peak height for THIS angle — full ISLAND_PEAK outside the
        // cove (tall flanking hills), the much lower VALLEY_FLOOR dead
        // center of the cove (the notch itself stays low) — this is
        // what actually carves the channel through the hill mass,
        // not just thinning the beach ring alone.
        // dunePeakMult (computed above, per-worldX) varies the FLANKING
        // hill's own peak along the coastline's length — only applied
        // outside the cove (coveShape scales it in), so the cove's own
        // valley floor height is untouched by this variation.
        const peakForThisAngle = VALLEY_FLOOR + coveShape * (ISLAND_PEAK * dunePeakMult - VALLEY_FLOOR);
        islandBump = baseAtCore + shaped * (peakForThisAngle - baseAtCore);
      }
    }

    return Math.max(seafloor + sandRipple + reefMound, islandBump);
  },
  // Deep chasms cut through otherwise moderate terrain.
  abyssal(u, v, seed) {
    const base = fbm2(u * 1.6, v * 1.6, seed, 4, 2.0, 0.5) * 6;
    const chasmNoise = fbm2(u * 1.8 + 300, v * 1.8 + 300, seed + 120, 3, 2.0, 0.5);
    const chasm = chasmNoise > 0.3 ? -(chasmNoise - 0.3) * 22 : 0;
    return base + chasm;
  },
  // Cracked dry lakebed — very low relief with fine dune ripples, plus a
  // shallow winding scar where a river evidently used to run (visual
  // crack only, no water — fits the zone's "ended once" lore rather than
  // contradicting it with an actual river).
  ashen(u, v, seed) {
    const worldX = u * (TERRAIN_SIZE / 2), worldZ = v * (TERRAIN_SIZE / 2);
    const dunes = fbm2(u * 4, v * 4, seed, 2, 2.0, 0.5) * 1.1;
    const swell = fbm2(u * 0.8, v * 0.8, seed + 60, 3, 2.0, 0.5) * 2.2;
    const scarCenterX = Math.sin(worldZ * 0.03 + seed * 0.015) * 30;
    const distFromScar = Math.abs(worldX - scarCenterX);
    const scarWidth = 5;
    const scar = distFromScar < scarWidth ? -(1 - distFromScar / scarWidth) * 0.7 : 0;
    return dunes + swell + scar;
  },
  // Frozen icy terrain — rolling snow-covered hills with a jagged
  // ice-ridge texture riding on top, plus scattered deep ice caverns cut
  // into the ground. The caverns reuse the exact same threshold-carved
  // technique Abyssal's chasms already use above (a proven pattern for
  // "the ground occasionally opens into a real pit" rather than a new
  // one), just re-tuned for shallower, more frequent openings. Color
  // identity comes from SURFACE_PATCH_STYLE.frost below plus the base
  // color passed into applyHeightShading (set in levels.js), not from
  // the carving math itself.
  frost(u, v, seed) {
    const worldX = u * (TERRAIN_SIZE / 2), worldZ = v * (TERRAIN_SIZE / 2);
    let base = fbm2(u * 1.4, v * 1.4, seed, 4, 2.0, 0.5) * 7; // rolling snowdrift hills
    const ridged = Math.abs(fbm2(u * 2.6, v * 2.6, seed + 80, 3, 2.0, 0.5)) * 3; // jagged wind-carved ice ridges

    // A large, deliberately SIMPLE test chasm — open-air, no roof, no
    // rooms, none of the mountain/ramp/room machinery below. Positioned
    // well clear of that system (opposite quadrant of the map) so
    // there's zero interaction between them. Reuses Abyssal's exact
    // proven threshold-carved-chasm shape (a technique already
    // established as working in this project) rather than anything new,
    // specifically to validate that basic large-scale carving renders
    // correctly in isolation before building more complexity on top.
    const CHASM_TEST_X = -50, CHASM_TEST_Z = -50, CHASM_OUTER_RADIUS = 40, CHASM_OPENING_RADIUS = 24, CHASM_TEST_FLOOR = -20; // position verified numerically to keep the chasm's full outer edge within WORLD_BOUND_RADIUS (110.7 vs 112 — the widest outer radius that still fits at this fixed position). CHASM_OUTER_RADIUS is now the edge of the whole bridged mountain structure; CHASM_OPENING_RADIUS (24, sized for both "a large hole" and a robust core against Low tier's coarse mesh) is the skylight left open within it, per explicit request to bridge over most of the top

    // A brand new mountain with a genuine THROUGH-TUNNEL — distinct from
    // both the ramp/room mountain and the bridged chasm above, per
    // explicit request for a new, unrelated feature. Position (35,-60)
    // found via systematic search across the whole map, oriented
    // north-south specifically so the tunnel's own length never needs to
    // clear the winding canyon's X-range (a first attempt running
    // east-west put the tunnel's far end well within the canyon's
    // possible reach — caught and fixed before shipping). Verified
    // numerically: comfortably clear of both other mountains (98+ units
    // vs the 85-90 needed) and the whole structure's farthest points stay
    // within WORLD_BOUND_RADIUS (max 101.2 vs 112).
    const TUNNEL_MTN_X = 35, TUNNEL_MTN_Z = -60, TUNNEL_MTN_RADIUS = 30, TUNNEL_MTN_PEAK = 25;
    const distFromTunnelMtn = Math.hypot(worldX - TUNNEL_MTN_X, worldZ - TUNNEL_MTN_Z);
    if (distFromTunnelMtn < TUNNEL_MTN_RADIUS) {
      const tmt = 1 - distFromTunnelMtn / TUNNEL_MTN_RADIUS;
      base += TUNNEL_MTN_PEAK * tmt * tmt;
    }

    // A straight north-south tunnel through the mountain — a genuine
    // THROUGH-passage with two open ends, unlike the chasm's single
    // vertical skylight above. Runs along Z (not X) specifically to
    // avoid the canyon-overlap risk described above. Same guaranteed-
    // core-floor technique used throughout this arc: the floor is an
    // ABSOLUTE value within its core, completely unaffected by the
    // mountain's own elevation (added to base just above), so the
    // tunnel stays genuinely hollow no matter how tall the mountain gets.
    const TUNNEL_MTN_HALF_LENGTH = 35; // wider than the mountain's own diameter (60), so both ends clearly exit into open terrain beyond the mountain's footprint
    const TUNNEL_MTN_HALF_WIDTH = 8; // same width already proven robust against Low tier's coarse mesh elsewhere in this arc (the ramp, the branch corridor) — named distinctly from the EXISTING winding canyon's own TUNNEL_HALF_WIDTH further below, a real redeclaration bug caught only by actually loading the file (node --check alone missed it)
    const TUNNEL_MTN_FLOOR_Y = -12;
    const distAlongTunnelMtn = Math.abs(worldZ - TUNNEL_MTN_Z);
    const distFromTunnelMtnCenterX = Math.abs(worldX - TUNNEL_MTN_X);
    if (distAlongTunnelMtn < TUNNEL_MTN_HALF_LENGTH && distFromTunnelMtnCenterX < TUNNEL_MTN_HALF_WIDTH) {
      const coreX = TUNNEL_MTN_HALF_WIDTH * 0.6;
      if (distFromTunnelMtnCenterX <= coreX) return TUNNEL_MTN_FLOOR_Y;
      const t = 1 - (distFromTunnelMtnCenterX - coreX) / (TUNNEL_MTN_HALF_WIDTH - coreX);
      return (base + ridged) * (1 - t * t) + TUNNEL_MTN_FLOOR_Y * (t * t);
    }

    // A narrow crevice branching off the tunnel-mountain's own eastern
    // edge, extending further along the X-axis — per explicit request.
    // Starts exactly where the tunnel's own passage width ends
    // (CREVICE_START_X = TUNNEL_MTN_X + TUNNEL_MTN_HALF_WIDTH) so the two
    // connect naturally without needing any overlap-priority logic
    // between them. Same linear-corridor technique as the branch
    // corridor elsewhere in this arc. This location has substantially
    // more clearance than the canyon spot used for feature #5 (70+
    // units of margin here vs the 11-13 max radius there), so a robust
    // width was used from the start rather than needing a widening pass.
    const CREVICE_START_X = TUNNEL_MTN_X + TUNNEL_MTN_HALF_WIDTH;
    const CREVICE_LENGTH = 25, CREVICE_HALF_WIDTH = 8, CREVICE_FLOOR_Y = -22;
    const distAlongCrevice = worldX - CREVICE_START_X;
    const distFromCreviceZ = Math.abs(worldZ - TUNNEL_MTN_Z);
    if (distAlongCrevice >= 0 && distAlongCrevice < CREVICE_LENGTH && distFromCreviceZ < CREVICE_HALF_WIDTH) {
      const coreZ2 = CREVICE_HALF_WIDTH * 0.6;
      if (distFromCreviceZ <= coreZ2) return CREVICE_FLOOR_Y;
      const t2 = 1 - (distFromCreviceZ - coreZ2) / (CREVICE_HALF_WIDTH - coreZ2);
      return (base + ridged) * (1 - t2 * t2) + CREVICE_FLOOR_Y * (t2 * t2);
    }

    // Icy cliffs/mountains surrounding the chasm, leaving its own
    // opening as a genuine hole/entrance — per explicit request. Added
    // to `base` BEFORE the chasm's own carving check below, so the
    // chasm's blend-zone walls (which react to base+ridged) pick up
    // this elevated surrounding terrain, naturally forming steep cliffs
    // right at the chasm's edge rather than needing a separate carve.
    // The chasm's own guaranteed core (its actual floor) is an ABSOLUTE
    // value, not a blend — completely unaffected regardless of how tall
    // the surrounding mountain becomes, so the entrance always stays a
    // real open hole, never covered over.
    const distFromChasmMountain = Math.hypot(worldX - CHASM_TEST_X, worldZ - CHASM_TEST_Z);
    const CHASM_MOUNTAIN_RADIUS = 70;
    if (distFromChasmMountain < CHASM_MOUNTAIN_RADIUS) {
      const cmt = 1 - distFromChasmMountain / CHASM_MOUNTAIN_RADIUS;
      base += 30 * cmt * cmt;
    }

    // The chasm's opening is now much smaller than the mountain built
    // over it (a "skylight" rather than the whole top being open) — per
    // explicit request to bridge the edges with solid ground, leaving
    // only a gap. Everything from the opening's edge out to
    // CHASM_OUTER_RADIUS now reads as ordinary walkable mountain terrain
    // (base+ridged, already elevated by the mountain bump above) rather
    // than continuing the pit — a real bridge connecting the rim on
    // every side, not just two opposite edges.
    const distFromChasmTest = Math.hypot(worldX - CHASM_TEST_X, worldZ - CHASM_TEST_Z);
    if (distFromChasmTest < CHASM_OPENING_RADIUS) {
      const coreR = CHASM_OPENING_RADIUS * 0.6; // guaranteed floor within this radius, independent of the surrounding noise — same core-guarantee technique proven on the pond/tunnel/room
      if (distFromChasmTest <= coreR) return CHASM_TEST_FLOOR;
      const t = 1 - (distFromChasmTest - coreR) / (CHASM_OPENING_RADIUS - coreR);
      return (base + ridged) * (1 - t * t) + CHASM_TEST_FLOOR * (t * t);
    }
    if (distFromChasmTest < CHASM_OUTER_RADIUS) {
      return base + ridged; // the bridged-over ground — a natural continuation of the surrounding mountain, not a carved pit
    }

    // A real mountain landform over the ramp/room/tunnel network below —
    // per explicit request that the whole underground system sit beneath
    // a mountain, not flat ground, with a single opening leading down.
    // Added directly to `base` (now `let` rather than `const`) so every
    // downstream carve (ramp, room roof-cover, canyon, branch) picks it
    // up automatically. This is safe specifically because the roof-cover
    // carves below all use `Math.min(base+ridged, someRoofY)` — capping
    // DOWN to a fixed buried height regardless of how much taller the
    // surrounding terrain becomes, so a much taller mountain here still
    // gets correctly hollowed out beneath it rather than needing each
    // carve individually reworked.
    const distFromMountain = Math.hypot(worldX - MOUNTAIN_CENTER_X, worldZ - MOUNTAIN_CENTER_Z);
    if (distFromMountain < MOUNTAIN_RADIUS) {
      const mt = 1 - distFromMountain / MOUNTAIN_RADIUS;
      base += MOUNTAIN_PEAK_HEIGHT * mt * mt; // eased falloff (t^2) rather than linear, so the mountain has a real rounded profile rather than a conical tent shape
    }

    // A winding tunnel/canyon the player can actually walk through — this
    // engine's player collision only ever checks the terrain heightfield
    // itself (confirmed: physics.js's only geometry argument used to be
    // the single terrain mesh — since extended to optionally support
    // additional collidable meshes too, see the entrance ramp/room
    // further below), so a genuinely explorable "tunnel" has to be
    // carved directly into this height function, not built as a
    // separate decorative interior. This particular feature stays
    // open-air (no roof) by design — a real enclosed underground room DOES
    // exist elsewhere on this map now (the entrance ramp below), it's
    // just not this one. Meandering centerline built from two layered
    // sine terms (same technique the river already uses) so it reads as
    // grown/winding rather than a mechanically straight line.
    const tunnelX = Math.sin(worldZ * 0.028 + seed * 0.021) * 26 + Math.sin(worldZ * 0.011 + seed * 0.037) * 14;

    // A deep rock tunnel opening at the bottom of the canyon, at one
    // specific point along its winding path — per explicit request to
    // use the canyon's own existing geometry as the entrance rather
    // than a new standalone location. Aligned with `tunnelX` (computed
    // just above) rather than needing to know the actual numeric seed
    // value, so this stays perfectly on the canyon's real floor
    // regardless of exactly where its winding path happens to sit at
    // this world seed. Z=0 chosen after searching several candidate
    // points along the canyon — it gives the most clearance (max safe
    // radius ~11) of anywhere checked; radius 10 used for a small safety
    // margin under that ceiling. The resulting core (1.0 grid cell at
    // Low tier) is a real improvement over an initial too-narrow attempt
    // (0.6 cells) but genuinely can't reach the 2-4 cell robustness used
    // elsewhere in this arc without risking overlap with the ramp/room
    // or chasm mountains — a real spatial constraint at this location,
    // not an arbitrary choice.
    const DEEP_TUNNEL_Z = 0, DEEP_TUNNEL_Z_HALF_RANGE = 12, DEEP_TUNNEL_RADIUS = 10, DEEP_TUNNEL_FLOOR = -30;
    const CANYON_FLOOR = -9; // matches TUNNEL_FLOOR below — the canyon's own floor, which this blends UP FROM rather than from the surrounding hill noise
    if (Math.abs(worldZ - DEEP_TUNNEL_Z) < DEEP_TUNNEL_Z_HALF_RANGE) {
      const distFromDeepTunnel = Math.hypot(worldX - tunnelX, worldZ - DEEP_TUNNEL_Z);
      if (distFromDeepTunnel < DEEP_TUNNEL_RADIUS) {
        const coreR = DEEP_TUNNEL_RADIUS * 0.6;
        if (distFromDeepTunnel <= coreR) return DEEP_TUNNEL_FLOOR;
        const t = 1 - (distFromDeepTunnel - coreR) / (DEEP_TUNNEL_RADIUS - coreR);
        return CANYON_FLOOR * (1 - t * t) + DEEP_TUNNEL_FLOOR * (t * t);
      }
    }

    // A genuine walkable ROOM connected to the deep tunnel above — per
    // explicit follow-up that the opening needed to lead somewhere real,
    // not just a decorative alcove. Positioned at Z=5, found via a fresh
    // clearance search (the deep tunnel's own Z=0 was already at its
    // practical ceiling) — Z=5 actually has MORE room (max safe radius
    // 13.0 vs 11.0 at Z=0), and naturally overlaps the tunnel's own
    // footprint (centers only 5 apart vs a combined 21 in radii), so the
    // two merge into one continuous space rather than needing a separate
    // connecting corridor. Same tunnelX-alignment technique as the
    // tunnel above (no need to know the actual seed value), same floor
    // (-30) for a seamless connection between the two.
    const DEEP_ROOM_Z = 5, DEEP_ROOM_RADIUS = 11;
    if (Math.abs(worldZ - DEEP_ROOM_Z) < DEEP_ROOM_RADIUS) {
      const distFromDeepRoom = Math.hypot(worldX - tunnelX, worldZ - DEEP_ROOM_Z);
      if (distFromDeepRoom < DEEP_ROOM_RADIUS) {
        const coreR2 = DEEP_ROOM_RADIUS * 0.6; // named distinctly from the tunnel's own coreR just above, in the same function scope
        if (distFromDeepRoom <= coreR2) return DEEP_TUNNEL_FLOOR;
        const t2 = 1 - (distFromDeepRoom - coreR2) / (DEEP_ROOM_RADIUS - coreR2);
        return CANYON_FLOOR * (1 - t2 * t2) + DEEP_TUNNEL_FLOOR * (t2 * t2);
      }
    }

    const distFromTunnel = Math.abs(worldX - tunnelX);
    const TUNNEL_HALF_WIDTH = 5;
    if (distFromTunnel < TUNNEL_HALF_WIDTH) {
      // Same "fully-guaranteed inner core, independent of the surrounding
      // noise entirely" technique proven on the source pond's basin —
      // without this, the walls' actual height above the floor would
      // vary with whatever the hill noise happens to be doing at each
      // point along the path, occasionally leaving a stretch with barely
      // any wall at all. TUNNEL_FLOOR=-9 against typical base+ridged
      // values near 0 gives walls roughly 9 units tall (~5.6x the
      // player's own eye height) — genuinely towering, not a shallow
      // ditch, and the core guarantee holds even in the noise's absolute
      // worst case.
      const TUNNEL_FLOOR = -9;
      const core = TUNNEL_HALF_WIDTH * 0.5;
      if (distFromTunnel <= core) return TUNNEL_FLOOR;
      const t = 1 - (distFromTunnel - core) / (TUNNEL_HALF_WIDTH - core);
      return (base + ridged) * (1 - t * t) + TUNNEL_FLOOR * (t * t);
    }

    const cavernNoise = fbm2(u * 1.9 + 500, v * 1.9 + 500, seed + 200, 3, 2.0, 0.5);
    const cavern = cavernNoise > 0.3 ? -(cavernNoise - 0.3) * 18 : 0; // real carved openings, not just texture

    // A dedicated entrance ramp leading down to a genuinely SEPARATE
    // underground room (built as its own collidable floor mesh in
    // main.js, wired into physics.js's newly-added extraMeshes support)
    // — unlike the open-air canyon above, this actually goes fully
    // underground with a real ceiling. Kept deliberately separate rather
    // than trying to connect the two systems, to avoid any interaction
    // between them.
    const distAlongRamp = worldZ - RAMP_CENTER_Z;
    if (Math.abs(worldX - RAMP_CENTER_X) < RAMP_HALF_WIDTH && distAlongRamp >= 0 && distAlongRamp <= RAMP_LENGTH) {
      const t = Math.min(1, distAlongRamp / RAMP_LENGTH); // 0 at the surface entrance, 1 at the room's floor level
      const rampFloor = (base + ridged) + t * (ROOM_FLOOR_Y - (base + ridged)); // interpolates from the ACTUAL surrounding terrain height at the entrance (no seam) to EXACTLY ROOM_FLOOR_Y at the far end regardless of what the surrounding noise happens to be there — the base+ridged terms cancel out algebraically at t=1
      const distFromRampX = Math.abs(worldX - RAMP_CENTER_X);
      const coreX = RAMP_HALF_WIDTH * 0.6; // same guaranteed-core technique as the pond/tunnel — rampFloor itself already correctly reduces to the natural terrain at t=0 and the exact room floor at t=1, so returning it directly within this radius is safe at every point along the ramp
      if (distFromRampX <= coreX) return rampFloor;
      const tx = 1 - (distFromRampX - coreX) / (RAMP_HALF_WIDTH - coreX);
      return (base + ridged) * (1 - tx * tx) + rampFloor * (tx * tx);
    }
    // The room itself is WIDER than the narrow ramp corridor above (see
    // ROOM_WIDTH) — this covers the room's ACTUAL footprint with a thin
    // guaranteed-buried roof, so the room's walls/ceiling never poke up
    // above the surface there. Without this, only the ramp's own narrow
    // width was carved, leaving the wider room's walls sitting in
    // completely normal, uncarved terrain — exactly what made them
    // visible sticking up above ground. Uses the SAME roomCenterZ
    // formula as main.js's own room construction (not just "wherever the
    // ramp ends") since the room floor deliberately starts 2 units
    // earlier than that, to overlap into the ramp's tail and avoid a
    // seam — using the ramp's end alone left exactly that 2-unit band
    // uncovered.
    const roomCenterZ = RAMP_CENTER_Z + RAMP_LENGTH + ROOM_LENGTH / 2;
    const roomFootprintZMin = roomCenterZ - (ROOM_LENGTH + 4) / 2;
    const roomFootprintZMax = roomCenterZ + (ROOM_LENGTH + 4) / 2;
    if (worldZ >= roomFootprintZMin && worldZ <= roomFootprintZMax && Math.abs(worldX - RAMP_CENTER_X) < ROOM_WIDTH / 2 + 4) { // margin widened from +1 to +4 — same low-res mesh robustness reasoning as the ramp's widening above
      return Math.min(base + ridged, ROOM_ROOF_Y); // whichever is LOWER — if the natural terrain here is already below the roof height, leave it as-is; otherwise cap it down to guarantee full coverage regardless of the surrounding noise
    }

    // The connecting branch — a LEVEL corridor (stays at ROOM_FLOOR_Y the
    // whole way, no descent needed since it connects two already-buried
    // spaces) leading from the main room's east wall out to a second,
    // smaller chamber. Same guaranteed-core technique as the ramp.
    const distAlongBranch = worldX - BRANCH_START_X;
    if (Math.abs(worldZ - BRANCH_Z) < BRANCH_HALF_WIDTH && distAlongBranch >= 0 && distAlongBranch <= BRANCH_LENGTH) {
      const distFromBranchZ = Math.abs(worldZ - BRANCH_Z);
      const coreZ = BRANCH_HALF_WIDTH * 0.6;
      if (distFromBranchZ <= coreZ) return ROOM_FLOOR_Y;
      const tz = 1 - (distFromBranchZ - coreZ) / (BRANCH_HALF_WIDTH - coreZ);
      return (base + ridged) * (1 - tz * tz) + ROOM_FLOOR_Y * (tz * tz);
    }
    // Roof-cover for the branch corridor — same margin-widening reasoning
    // as the room's own roof-cover.
    if (Math.abs(worldZ - BRANCH_Z) < BRANCH_HALF_WIDTH + 4 && distAlongBranch >= -4 && distAlongBranch <= BRANCH_LENGTH + 4) {
      return Math.min(base + ridged, ROOM_ROOF_Y);
    }

    // The second chamber at the branch's far end — a radial guaranteed-
    // core carve, same technique as the source pond's basin, giving a
    // genuinely different (round rather than rectangular) room shape for
    // variety.
    const chamberX = BRANCH_START_X + BRANCH_LENGTH, chamberZ = BRANCH_Z;
    const distFromChamber = Math.hypot(worldX - chamberX, worldZ - chamberZ);
    if (distFromChamber < CHAMBER_RADIUS) {
      const coreR = CHAMBER_RADIUS * 0.55;
      if (distFromChamber <= coreR) return ROOM_FLOOR_Y;
      const tc = 1 - (distFromChamber - coreR) / (CHAMBER_RADIUS - coreR);
      return (base + ridged) * (1 - tc * tc) + ROOM_FLOOR_Y * (tc * tc);
    }
    // Roof-cover for the second chamber.
    if (distFromChamber < CHAMBER_RADIUS + 4) {
      return Math.min(base + ridged, ROOM_ROOF_Y);
    }
    return base + ridged + cavern;
  },
};

/**
 * Samples this biome's terrain height at an arbitrary world XZ position —
 * used both to build the mesh and (via terrainHeightAt, below) to place
 * decorations/crystals/spawn points consistently with the actual surface.
 */
function biomeHeight(biome, worldX, worldZ, seed) {
  const u = worldX / (TERRAIN_SIZE / 2);
  const v = worldZ / (TERRAIN_SIZE / 2);
  const shaper = BIOME_SHAPERS[biome] || BIOME_SHAPERS.verdant;
  let h = shaper(u, v, seed);
  // RADIAL falloff toward the edges. This deliberately uses Euclidean
  // distance (hypot) rather than the Chebyshev metric — max(|u|,|v|) —
  // it used before: max() produces SQUARE-shaped contours, which is
  // exactly why the landmass used to end in straight edges with clearly
  // visible corners. hypot() makes the island genuinely round, so there
  // are no corners to see from any viewing angle.
  const edge = Math.hypot(u, v);
  const FALLOFF_START = 0.76; // land is untouched inside this radius
  const FALLOFF_END = 0.98;   // fully flattened to the base plane by here
  let falloff = 1;
  if (edge > FALLOFF_START) {
    const t = Math.min(1, (edge - FALLOFF_START) / (FALLOFF_END - FALLOFF_START));
    falloff = 1 - t * t; // eased rather than linear, so the coastline curves off instead of creasing
  }
  // Past the shoreline the ground actively sinks rather than just
  // flattening — a flat rim at height 0 still sits ABOVE every biome's
  // liquid level, so it would remain visible as a pale plate stretching
  // to the map edge. Driving it well below the water line instead lets
  // the rim disappear under water/fog, which is what actually hides the
  // boundary. The square's far corners (edge up to ~1.41) sink hardest,
  // so they submerge completely.
  const sink = edge > FALLOFF_END ? (edge - FALLOFF_END) * 80 : 0;
  return h * falloff - sink;
}

// A second color patches into the ground at scattered spots, independent
// of elevation — scorched ash, mineral veins, sun-bleached cracks — so the
// terrain reads with more variety than a pure height gradient. Threshold
// controls how much of the surface shows the patch (lower = rarer).
const SURFACE_PATCH_STYLE = {
  ember: { color: 0x120806, threshold: 0.62, freq: 3.2 },   // scorched/ash-dark patches
  verdant: { color: 0x1e5a2e, threshold: 0.6, freq: 1.8 }, // darker green shadow-blob patches, not brown soil — matches the reference's flat-illustration ground with a few rounded darker-green patches rather than dirt
  crystal: { color: 0xf5e9c8, threshold: 0.38, freq: 2.2 }, // pale sand-and-shell-rubble — threshold lowered (was 0.68) so real open sand covers much more of the seafloor between coral, not just rare specks
  abyssal: { color: 0x050308, threshold: 0.6, freq: 2.5 },  // near-black void patches
  ashen: { color: 0xe8dfc8, threshold: 0.65, freq: 3.6 },   // sun-bleached, cracked-pale patches
  frost: { color: 0xaee0f5, threshold: 0.6, freq: 2.4 },    // pale ice-blue shadow patches — cold light through snow, not brown/grey rock texture
};

// A much finer, higher-frequency speckle used to be layered on top of the
// patches above (small pebble/grit flecks). Removed — at this project's
// flat-illustration art direction it read as grainy noise rather than
// deliberate texture, working against the bold-flat-color look rather
// than supporting it.

// -----------------------------------------------------------------------------
// Flat-illustration height palettes — a small ordered list of bold colors
// posterized across the height range, instead of one smooth base->highlight
// gradient. This is the terrain half of the art-direction pass toward the
// reference's flat-vector look: a handful of confident color bands (like
// strata) rather than a continuous shaded gradient. Only Ember is defined
// so far — biomes without an entry here keep the original smooth-gradient
// look untouched until their own pass.
//
// NOTE: this only controls per-vertex color. If the mesh's material still
// responds to the day/night scene lighting with smooth Phong/PBR shading,
// that lighting will still paint a continuous brightness gradient across
// these bands and soften the flat look this is going for. Worth checking
// in main.js whether Ember's terrain material can go flatShading:true /
// a lower-lit material — that's outside this file's reach.
// -----------------------------------------------------------------------------
const HEIGHT_PALETTE = {
  ember: [0x120a08, 0x3a1208, 0x7a2410, 0xc8471c, 0xef8a34, 0xffd9a0], // shadowed valley -> deep rock -> mid rock -> molten-adjacent rust -> warm highlight -> pale sunlit rim
  // Shaded sand troughs -> open sunlit sand -> coral-orange mound base ->
  // vivid coral-pink crown -> warm sunlit-highlight where the shallowest
  // reef peaks catch the most light from the surface above. That last
  // stop was a bright cyan (0x7fe8ff) nearly identical to the water's own
  // shallow-tint color in liquid.js (0x7fd0d8) — right where the reef's
  // true peaks sit closest to the surface (and so are seen through the
  // thinnest, most saturated wedge of that same shallow-water tint), the
  // seafloor and the water above it were painting almost the same color,
  // reading as "the sand and the water are the same color." A warm
  // highlight reads as sunlit coral/sand catching the light without
  // fighting the water's own cool cyan tint for the same hue.
  crystal: [0x6b5a3a, 0xe8cf9a, 0xff8a5c, 0xff5c8a, 0xffe6c2],
};

// Smooth multi-stop gradient across the palette — was a posterized,
// hard-seamed version (matching flat-vector illustration strata), reverted
// per direction to blend both styles: bold flat color for the lava itself
// stays, but the rock surface reads with soft continuous shading instead
// of discrete color-block bands, closer to a hand-drawn gradient dune face
// than a stepped contour map.
function smoothPaletteColorAt(t, palette, out) {
  const bandCount = palette.length - 1;
  const scaled = THREE.MathUtils.clamp(t, 0, 1) * bandCount;
  const idx = Math.min(bandCount - 1, Math.floor(scaled));
  const localT = scaled - idx;
  out.copy(palette[idx]).lerp(palette[Math.min(bandCount, idx + 1)], localT);
  return out;
}

function applyHeightShading(geo, colorHex, minY, maxY, biome, seed) {
  const posAttr = geo.attributes.position;
  const range = Math.max(maxY - minY, 1e-6);
  const patchStyle = SURFACE_PATCH_STYLE[biome];
  const patchColor = patchStyle ? new THREE.Color(patchStyle.color) : null;
  const colors = new Float32Array(posAttr.count * 3);
  const tmp = new THREE.Color();

  const paletteHex = HEIGHT_PALETTE[biome];
  if (paletteHex) {
    const palette = paletteHex.map((h) => new THREE.Color(h));
    // Sandy path alongside the lava channel — Ember only, one side of the
    // channel (not both), matching the reference's single winding trail
    // rather than symmetric banks. Small gap between the channel's edge
    // and the path itself so they don't visually run together.
    const pathColor = biome === "ember" ? new THREE.Color(0xc99a5e) : null;
    // Crystal's emergent island (terrain.js's Math.max-guaranteed dome
    // near the landmark position) needs to read as actual beach, not
    // whatever the reef palette says at that normalized height — the
    // palette's own top band is bright cyan, which is right for a
    // sunlit reef crest but wrong for dry sand. Blended in below by
    // real world height crossing the water line, not by the palette t
    // value, so this stays correct regardless of how the island's own
    // peak height shifts the mesh's overall min/max. Two sand tones
    // (rather than one flat color) so the beach itself has a gradient —
    // pale, slightly cool sand right at the waterline where it's still
    // damp, warming to a golden tone higher up where the sand is dry.
    const islandSandWet = biome === "crystal" ? new THREE.Color(0xc9a876) : null; // was 0xf3efe4 (pale near-white) — real wet sand is a rich saturated tan right at the waterline, not washed-out pale, per the reference photo
    const islandSandDry = biome === "crystal" ? new THREE.Color(0xe8c97a) : null;
    const islandSandTmp = biome === "crystal" ? new THREE.Color() : null;
    // A darker fleck tone blended in via noise for real sand grain/
    // texture — per explicit "too flat" report. A warm dark brown, not
    // anything cool/green, so it can't itself contribute to any greenish
    // cast.
    const ISLAND_SAND_FLECK = new THREE.Color(0x8a6b3f);
    const waterLine = biome === "crystal" ? LIQUID_LEVEL.crystal : undefined;
    // Slope-based rock/grass — per explicit reference photo follow-up
    // ("beach surrounded by high cliffs with green on top"): height
    // ALONE can't tell a steep cliff face apart from a flat hilltop at
    // the same elevation, so this reads the geometry's own real vertex
    // normal (geo.computeVertexNormals() already ran before this
    // function is called) as a genuine slope signal — normal.y near 1
    // is flat ground, near 0 is a near-vertical face. Bare rock on
    // steep ground regardless of height, grass only where it's flat
    // enough to hold soil — this happens to align naturally with how
    // the cove's own hill shape works (terrain.js's smoothstep hill
    // profile is flattest right at CORE and right at its own peak,
    // steepest in between), so no separate shape change was needed for
    // this to land on the right places.
    const islandRock = biome === "crystal" ? new THREE.Color(0x8f8a7c) : null; // pale warm granite
    const islandRockShadow = biome === "crystal" ? new THREE.Color(0x5a564c) : null;
    const islandGrass = biome === "crystal" ? new THREE.Color(0x5a8a3c) : null;
    const islandGrassDark = biome === "crystal" ? new THREE.Color(0x3d6b28) : null;
    const islandRockTmp = biome === "crystal" ? new THREE.Color() : null;
    const islandGrassTmp = biome === "crystal" ? new THREE.Color() : null;
    const normalAttr = biome === "crystal" ? geo.attributes.normal : null;
    for (let i = 0; i < posAttr.count; i++) {
      const t = (posAttr.getY(i) - minY) / range;
      const x = posAttr.getX(i), z = posAttr.getZ(i);
      smoothPaletteColorAt(t, palette, tmp);
      if (patchStyle) {
        const n = fbm2(x * 0.01 * patchStyle.freq, z * 0.01 * patchStyle.freq, seed + 500, 3, 2.0, 0.5);
        // Softened back to a gradual ramp (was near-full-strength
        // immediately past the threshold, matching flat-illustration
        // splatter shapes) — the rock surface now reads with soft
        // continuous shading throughout, patches included, rather than
        // hard-edged color blocks.
        if (n > patchStyle.threshold) {
          const patchStrength = Math.min(1, (n - patchStyle.threshold) / (1 - patchStyle.threshold)) * 0.75;
          tmp.lerp(patchColor, patchStrength);
        }
      }
      if (pathColor) {
        const offsetFromChannel = x - emberChannelCenterX(z, seed);
        if (offsetFromChannel > EMBER_PATH_INNER && offsetFromChannel < EMBER_PATH_OUTER) {
          const mid = (EMBER_PATH_INNER + EMBER_PATH_OUTER) / 2, half = (EMBER_PATH_OUTER - EMBER_PATH_INNER) / 2;
          const pathT = Math.max(0, 1 - Math.abs((offsetFromChannel - mid) / half));
          tmp.lerp(pathColor, pathT * 0.85);
        }
      }
      if (islandSandWet) {
        const worldY = posAttr.getY(i);
        const beachT = Math.min(1, Math.max(0, (worldY - (waterLine - 2)) / 4.5)); // widened from 1.8 to 4.5 units to match the new, more gradual beach shelf's own extent — a narrower color band than the actual slope would look like a hard line cutting across a smooth rise
        if (beachT > 0) {
          const goldT = Math.min(1, Math.max(0, (worldY - waterLine) / 6)); // widened from 4 to 6 for the same reason — fades from wet white-sand near the shore to warm gold sand further up the now-longer beach
          islandSandTmp.copy(islandSandWet).lerp(islandSandDry, goldT);
          // Real color texture — per explicit "flat" report, the sand
          // was a perfectly smooth 2-tone gradient with no grain/fleck
          // variation at all. A fine noise sample blends in a slightly
          // darker fleck tone, breaking up the flatness the same way
          // rock/grass elsewhere in this function already use noise for
          // their own texture, not a uniform painted color.
          const sandFleckNoise = fbm2(x * 0.12, z * 0.12, seed + 810, 2, 2.0, 0.5);
          if (sandFleckNoise > 0.15) islandSandTmp.lerp(ISLAND_SAND_FLECK, Math.min(1, (sandFleckNoise - 0.15) / 0.5) * 0.35);
          tmp.lerp(islandSandTmp, beachT);
        }
        // Rock/grass only above the beach's own zone (beachT<1 leaves
        // room right at the shore for sand alone, no rock/grass
        // blending fighting it there) — real cliffs and grass start
        // once you're past the immediate shoreline, not at the water's
        // edge itself.
        if (beachT >= 1 && islandRock) {
          const flatness = normalAttr.getY(i); // 1 = flat, 0 = vertical
          // Hand-written smoothstep (not THREE.MathUtils.smoothstep —
          // that method isn't confirmed used anywhere in this file, so
          // its availability in this project's three.js version isn't
          // verified; THREE.MathUtils.clamp IS already used above,
          // safe to build on).
          const rockT = THREE.MathUtils.clamp((0.82 - flatness) / (0.82 - 0.55), 0, 1); // steep (low flatness) -> 1 (full rock); gentle (flatness>0.82) -> 0
          const rockAmount = rockT * rockT * (3 - 2 * rockT);
          const rockNoise = fbm2(x * 0.04, z * 0.04, seed + 900, 2, 2.0, 0.5);
          islandRockTmp.copy(islandRock).lerp(islandRockShadow, Math.max(0, rockNoise));
          tmp.lerp(islandRockTmp, rockAmount);
          // Grass density gradient by elevation above the beach — sparse
          // right where the beach ends, gradually filling in further
          // inland/upslope, per explicit "sparse at the shore and
          // gradually more towards the top" request. worldY is the best
          // available proxy for "distance up from the shore" here (the
          // interior hill's own height rises monotonically inland), and
          // this multiplies on top of the existing slope-based amount so
          // steep ground still stays bare regardless of elevation.
          const grassShoreT = THREE.MathUtils.clamp((worldY - (waterLine + 6)) / 16, 0, 1); // start distance widened from waterLine+1 to +6 — grass was starting to blend in too close to the shore, reading as unwanted green on what should still be sand
          const grassShoreFactor = grassShoreT * grassShoreT * (3 - 2 * grassShoreT);
          const grassAmount = (1 - rockAmount) * grassShoreFactor;
          const grassNoise = fbm2(x * 0.05 + 300, z * 0.05 + 300, seed + 950, 2, 2.0, 0.5);
          islandGrassTmp.copy(islandGrass).lerp(islandGrassDark, Math.max(0, grassNoise));
          tmp.lerp(islandGrassTmp, grassAmount * 0.92); // not fully 1 — softens the transition slightly rather than a mechanically hard edge
        }
      }
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return;
  }

  // Original smooth two-color gradient — still used by every biome that
  // hasn't had its own flat-illustration pass yet.
  const base = new THREE.Color(colorHex).multiplyScalar(0.44); // was 0.3 — read as muddy/dark at low elevations rather than showing the actual biome color
  const highlight = new THREE.Color(colorHex).lerp(new THREE.Color(0xffffff), 0.22); // was 0.4 — less washed toward white, keeps more color saturation at peaks instead of desaturating them
  for (let i = 0; i < posAttr.count; i++) {
    const t = (posAttr.getY(i) - minY) / range;
    const x = posAttr.getX(i), z = posAttr.getZ(i);
    tmp.copy(base).lerp(highlight, t);
    if (patchStyle) {
      const n = fbm2(x * 0.01 * patchStyle.freq, z * 0.01 * patchStyle.freq, seed + 500, 3, 2.0, 0.5);
      if (n > patchStyle.threshold) {
        const patchStrength = Math.min(1, (n - patchStyle.threshold) / (1 - patchStyle.threshold)) * 0.75; // never fully overrides the base shading, just blends toward the patch
        tmp.lerp(patchColor, patchStrength);
      }
    }
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

/**
 * @param {{biome:string, color:string}} level
 * @param {string} seedStr
 * @returns {THREE.BufferGeometry}
 */
function buildPlanetTerrain(level, seedStr) {
  const seed = hashStringToSeed(seedStr + "::" + level.biome) * 1000;
  const segments = getGraphicsSettings().terrainSegments || TERRAIN_SEGMENTS_DEFAULT; // reverted the earlier ×1.4 workaround — terrainSegments itself is now increased directly in graphicsSettings.js, which wasn't available to edit in the round that added the workaround
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segments, segments);
  geo.rotateX(-Math.PI / 2); // lie flat in the XZ plane, +Y up

  const posAttr = geo.attributes.position;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), z = posAttr.getZ(i);
    const y = biomeHeight(level.biome, x, z, seed);
    posAttr.setY(i, y);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  geo.computeVertexNormals();
  // Crystal's palette normalization uses a fixed range for the reef
  // itself (verified against the shaper's own real height variation,
  // -2.5..6.5) rather than the raw scanned minY/maxY — the edge falloff's
  // sink (~-35 at the far corners, present on every biome) and the new
  // emergent island's peak (11.5) both stretch far beyond what the reef
  // actually needs to represent, compressing the sand->coral->cyan story
  // into a narrower slice of the palette than intended. The white-sand
  // override in applyHeightShading already handles anything above the
  // water line on its own terms, so this only affects underwater color.
  const paletteMinY = level.biome === "crystal" ? -2.5 : minY;
  const paletteMaxY = level.biome === "crystal" ? 6.5 : maxY;
  applyHeightShading(geo, level.color, paletteMinY, paletteMaxY, level.biome, seed);

  return geo;
}

/**
 * Same height biomeHeight() would give, but handles the seed derivation
 * internally so callers just pass the same (level, seedStr) they'd pass to
 * buildPlanetTerrain() — meant for callers needing many cheap height
 * samples (e.g. scattering grass) where raycasting against the built mesh
 * per-sample would be far more expensive for no accuracy benefit, since
 * this *is* the exact function the mesh itself was built from.
 */
function terrainHeightAt(level, worldX, worldZ, seedStr) {
  const seed = hashStringToSeed(seedStr + "::" + level.biome) * 1000;
  return biomeHeight(level.biome, worldX, worldZ, seed);
}

export { buildPlanetTerrain, biomeHeight, terrainHeightAt, TERRAIN_SIZE, LIQUID_LEVEL, WATERFALL_Z, RIVER_WIDTH, POND_Z, POND_RADIUS, POND_LEVEL, RAMP_CENTER_X, RAMP_CENTER_Z, RAMP_LENGTH, RAMP_HALF_WIDTH, ROOM_FLOOR_Y, ROOM_WIDTH, ROOM_LENGTH, BRANCH_START_X, BRANCH_LENGTH, BRANCH_HALF_WIDTH, BRANCH_Z, CHAMBER_RADIUS };
