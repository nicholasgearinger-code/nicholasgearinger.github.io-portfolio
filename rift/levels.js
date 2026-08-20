import "./runtime_bootstrap.js";
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
  { biome: "crystal", name: "Coral Shallows", tagline: "A bright tropical reef, sunlit and alive in the shallow water." },
  { biome: "abyssal", name: "Abyssal Drift", tagline: "Solid ground cut through with chasms that never end." },
  { biome: "ashen", name: "Ashen Expanse", tagline: "A cracked, wind-swept lakebed that forgot how to be full." },
  { biome: "frost", name: "Frostbound Reach", tagline: "A blizzard-locked expanse, ice caverns cut deep beneath the snow." },
];
LEVELS.forEach((l) => {
  if (l.biome === "frost") return;
  l.color = biomeColor(l.biome);
});
LEVELS.find((l) => l.biome === "frost").color = 0xbfe8fa;

const CRYSTAL_COUNT = 12;
const LORE_MARKER_COUNT = 5;
const DECORATION_COUNT = 60;
const PLACEMENT_RADIUS_FRAC = 0.78;

function randomPointOnTerrain(rand) {
  const r = Math.sqrt(rand()) * (TERRAIN_SIZE / 2) * PLACEMENT_RADIUS_FRAC;
  const angle = rand() * Math.PI * 2;
  return { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
}

function generateLevelLayout(biome, seed) {
  const rand = mulberry32(hashStringToSeed(seed + "::level::" + biome));
  const spawn = { x: 0, z: 0 };

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
    const localRand = mulberry32(hashStringToSeed(seed + "::decoration::" + biome + "::" + i));
    decorationSeeds.push({ id: `${biome}-deco-${i}`, x: p.x, z: p.z, rand: localRand });
  }

  return { spawn, crystalSeeds, loreMarkers, decorationSeeds };
}

export { LEVELS, generateLevelLayout, CRYSTAL_COUNT, LORE_MARKER_COUNT };
