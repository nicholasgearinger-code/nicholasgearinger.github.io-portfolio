import * as THREE from "three";

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
const TERRAIN_SEGMENTS = 140;  // resolution — higher reads smoother but costs more vertices
const RIVER_WIDTH = 7;         // Verdant Hollow's river channel, half-width in world units
const RIVER_DEPTH = 5;         // how far the channel carves below the surrounding local terrain

// Where the liquid plane (see liquid.js) sits for biomes that have one.
// Tuned against each biome's own height range so it floods only the
// carved channel/cracks it belongs to, not the surrounding hills — see
// the per-biome comments in BIOME_SHAPERS below for why each value works.
const LIQUID_LEVEL = { ember: -1.5, verdant: -1 };

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
  // Jagged volcanic ground with narrow carved lava-crack channels.
  ember(u, v, seed) {
    const base = fbm2(u * 2.2, v * 2.2, seed, 5, 2.1, 0.55);
    const jagged = Math.abs(base) * 1.6; // ridged noise — sharp peaks instead of rolling hills
    const crackNoise = fbm2(u * 5 + 100, v * 5 + 100, seed + 40, 3, 2.0, 0.5);
    const crack = Math.abs(crackNoise) < 0.035 ? -3.5 : 0; // narrow deep grooves
    return jagged * 9 + crack;
  },
  // Gentle rolling hills, cut through by a winding river channel.
  verdant(u, v, seed) {
    const worldX = u * (TERRAIN_SIZE / 2), worldZ = v * (TERRAIN_SIZE / 2);
    const base = fbm2(u * 1.3, v * 1.3, seed, 4, 2.0, 0.5) * 6.5;
    // Meandering path built from two different-frequency sine waves rather
    // than one — a single sine reads as too regular/mechanical for a
    // river; layering a slow bend with a faster wobble looks natural.
    const riverCenterX = Math.sin(worldZ * 0.035 + seed * 0.01) * 28 + Math.sin(worldZ * 0.013 + seed * 0.02) * 14;
    const distFromRiver = Math.abs(worldX - riverCenterX);
    if (distFromRiver < RIVER_WIDTH) {
      const t = 1 - distFromRiver / RIVER_WIDTH; // 0 at the bank, 1 at the center
      return base - t * t * RIVER_DEPTH;
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
  // Soft falloff toward the edges so the landmass doesn't end in an abrupt
  // cliff at the boundary — it settles toward a flat rim instead.
  const edge = Math.max(Math.abs(u), Math.abs(v));
  const falloff = edge > 0.78 ? Math.max(0, 1 - (edge - 0.78) / 0.22) : 1;
  return h * falloff;
}

function applyHeightShading(geo, colorHex, minY, maxY) {
  const posAttr = geo.attributes.position;
  const range = Math.max(maxY - minY, 1e-6);
  const base = new THREE.Color(colorHex).multiplyScalar(0.3);
  const highlight = new THREE.Color(colorHex).lerp(new THREE.Color(0xffffff), 0.4);
  const colors = new Float32Array(posAttr.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    const t = (posAttr.getY(i) - minY) / range;
    tmp.copy(base).lerp(highlight, t);
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
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
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
  applyHeightShading(geo, level.color, minY, maxY);

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

export { buildPlanetTerrain, biomeHeight, terrainHeightAt, TERRAIN_SIZE, TERRAIN_SEGMENTS, LIQUID_LEVEL };
