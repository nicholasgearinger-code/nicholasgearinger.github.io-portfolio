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
const LIQUID_LEVEL = { ember: -1.5, verdant: -1, frost: -1.2 }; // frost added per explicit "surrounded by a deep blue ocean" request — the terrain's edge falloff+sink (see biomeHeight below) already applies to every biome universally, so this one entry is what actually turns that already-submerged rim into real ocean water

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
  // Mostly flat/angular ground with sparse sharp spikes.
  crystal(u, v, seed) {
    const flat = fbm2(u * 1.6, v * 1.6, seed, 3, 2.0, 0.45) * 3;
    const spike = fbm2(u * 3 + 200, v * 3 + 200, seed + 80, 2, 2.0, 0.5);
    const spikeBoost = spike > 0.62 ? (spike - 0.62) * 26 : 0; // sparse tall spires
    return flat + spikeBoost;
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
    const base = fbm2(u * 1.4, v * 1.4, seed, 4, 2.0, 0.5) * 7; // rolling snowdrift hills
    const ridged = Math.abs(fbm2(u * 2.6, v * 2.6, seed + 80, 3, 2.0, 0.5)) * 3; // jagged wind-carved ice ridges

    // A winding tunnel/canyon the player can actually walk through — this
    // engine's player collision only ever checks the terrain heightfield
    // itself (confirmed: physics.js's only geometry argument is the
    // single terrain mesh, nothing decoration-related), so a genuinely
    // explorable "tunnel" has to be carved directly into this height
    // function, not built as a separate decorative interior. It's
    // open-air (no roof) rather than a true enclosed underground space —
    // that would need a fundamentally different interior-level system
    // this project doesn't have. Meandering centerline built from two
    // layered sine terms (same technique the river already uses) so it
    // reads as grown/winding rather than a mechanically straight line.
    const tunnelX = Math.sin(worldZ * 0.028 + seed * 0.021) * 26 + Math.sin(worldZ * 0.011 + seed * 0.037) * 14;
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
  crystal: { color: 0xcfeaff, threshold: 0.7, freq: 2.8 },  // pale mineral-vein streaks
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
  applyHeightShading(geo, level.color, minY, maxY, level.biome, seed);

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

export { buildPlanetTerrain, biomeHeight, terrainHeightAt, TERRAIN_SIZE, LIQUID_LEVEL, WATERFALL_Z, RIVER_WIDTH, POND_Z, POND_RADIUS, POND_LEVEL };
