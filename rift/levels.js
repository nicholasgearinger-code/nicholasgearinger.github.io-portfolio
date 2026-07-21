import { mulberry32, hashStringToSeed, biomeColor } from "./worldgen.js";
import { TERRAIN_SIZE } from "./terrain.js";

// -----------------------------------------------------------------------------
// SWAP POINT: level layout. Each biome is one continuous landmass (see
// terrain.js) instead of a chain of separate islands — this only decides
// *where* on that landmass things go (crystals, lore markers, decorative
// props), all as XZ coordinates. Heights aren't computed here at all:
// main.js samples the real terrain mesh's height at each of these points
// once it's built, so placement can never drift out of sync with the
// actual rendered surface the way a parallel analytic height guess could.
// -----------------------------------------------------------------------------

const LEVELS = [
  { biome: "ember", name: "Ember Reach", tagline: "Jagged volcanic ground, cracked through with old fire." },
  { biome: "verdant", name: "Verdant Hollow", tagline: "Rolling hills, bioluminescent and overgrown." },
  { biome: "crystal", name: "Crystal Spire", tagline: "Flat, angular ground broken by sudden crystal spires." },
  { biome: "abyssal", name: "Abyssal Drift", tagline: "Solid ground cut through with chasms that never end." },
  { biome: "ashen", name: "Ashen Expanse", tagline: "A cracked, wind-swept lakebed that forgot how to be full." },
];
LEVELS.forEach((l) => { l.color = biomeColor(l.biome); });

const CRYSTAL_COUNT = 12;
const LORE_MARKER_COUNT = 5;
const DECORATION_COUNT = 60; // was 22 — the real bottleneck behind "the forest looks sparse everywhere, not just Verdant specifically" (main.js's forest-filler pass only ever supplemented whatever this produced, it never fixed the underlying scarcity)

// Both crystals and decorations stay within this fraction of the terrain's
// half-size — keeps everything off the soft falloff rim at the edge (see
// terrain.js) where the ground is flattening out toward the boundary.
const PLACEMENT_RADIUS_FRAC = 0.78; // was 0.7 — a little more reach toward the edge, blending better into main.js's forest-filler pass (which covers out to ~0.95*WORLD_BOUND_RADIUS) and horizonSilhouettes.js's distant treeline just beyond that

function randomPointOnTerrain(rand) {
  // sqrt(rand()) rather than a bare rand() — a disc's AREA at radius r
  // grows with r, so sampling r linearly over-concentrates points near
  // the center; the sqrt correction is what actually makes points land
  // uniformly per unit of ground area instead of clustering inward.
  const r = Math.sqrt(rand()) * (TERRAIN_SIZE / 2) * PLACEMENT_RADIUS_FRAC;
  const angle = rand() * Math.PI * 2;
  return { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
}

/**
 * @param {string} biome
 * @param {string} seed
 * @returns {{
 *   spawn: {x:number, z:number},
 *   crystalSeeds: Array<{id:string, x:number, z:number}>,
 *   loreMarkers: Array<{id:string, x:number, z:number}>,
 *   decorationSeeds: Array<{id:string, x:number, z:number, rand:() => number}>,
 * }}
 */
function generateLevelLayout(biome, seed) {
  const rand = mulberry32(hashStringToSeed(seed + "::level::" + biome));

  const spawn = { x: 0, z: 0 }; // terrain center — every biome's falloff/shaping keeps this area gentle

  const crystalSeeds = [];
  for (let i = 0; i < CRYSTAL_COUNT; i++) {
    const p = randomPointOnTerrain(rand);
    crystalSeeds.push({ id: `${biome}-crystal-${i}`, x: p.x, z: p.z });
  }

  const loreMarkers = [];
  for (let i = 0; i < LORE_MARKER_COUNT; i++) {
    const p = randomPointOnTerrain(rand);
    loreMarkers.push({ id: `${biome}-lore-${i}`, x: p.x, z: p.z });
  }

  const decorationSeeds = [];
  for (let i = 0; i < DECORATION_COUNT; i++) {
    const p = randomPointOnTerrain(rand);
    // Each decoration gets its own derived PRNG stream (seeded off its own
    // index) so createDecoration()'s internal randomness — branch counts,
    // crystal-shard counts, scale variation — stays deterministic and
    // reproducible per placement without decorations affecting each
    // other's random draws.
    const localRand = mulberry32(hashStringToSeed(seed + "::decoration::" + biome + "::" + i));
    decorationSeeds.push({ id: `${biome}-deco-${i}`, x: p.x, z: p.z, rand: localRand });
  }

  return { spawn, crystalSeeds, loreMarkers, decorationSeeds };
}

export { LEVELS, generateLevelLayout, CRYSTAL_COUNT, LORE_MARKER_COUNT };
