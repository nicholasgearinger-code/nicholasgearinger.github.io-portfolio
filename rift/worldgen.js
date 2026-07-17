// worldgen.js
// -----------------------------------------------------------------------------
// SWAP POINT: This is the entire procedural generation layer. Replace
// generateWorld() with any algorithm you like (Perlin/Simplex terrain,
// wave function collapse, hand-authored biome tables, etc). The only
// contract the rest of the app relies on is the shape of the returned
// object — see the JSDoc on generateWorld().
//
// Ported from the old server/worldgen.js unchanged — single-player no
// longer needs a network round trip to learn the island layout, so this
// now runs directly in the browser instead of on the server.
// -----------------------------------------------------------------------------

// Small deterministic PRNG (mulberry32) so the same seed always produces
// the same world.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

const BIOMES = ["ember", "verdant", "crystal", "abyssal", "ashen"];

/**
 * Generates a full world description from a seed.
 *
 * @param {string|number} seedInput
 * @returns {{
 *   seed: string,
 *   islands: Array<{
 *     id: string,
 *     position: {x:number, y:number, z:number},
 *     radius: number,
 *     height: number,
 *     biome: string,
 *     color: string
 *   }>
 * }}
 */
function generateWorld(seedInput) {
  const seedStr = String(seedInput);
  const rand = mulberry32(hashStringToSeed(seedStr));

  const islandCount = 10 + Math.floor(rand() * 6); // 10-15 islands
  const islands = [];
  const spread = 220;

  for (let i = 0; i < islandCount; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = 30 + rand() * spread;
    const biome = BIOMES[Math.floor(rand() * BIOMES.length)];

    islands.push({
      id: `isle-${i}`,
      position: {
        x: Math.cos(angle) * dist,
        y: -20 + rand() * 60,
        z: Math.sin(angle) * dist,
      },
      radius: 6 + rand() * 14,
      height: 4 + rand() * 10,
      biome,
      color: biomeColor(biome),
    });
  }

  return { seed: seedStr, islands };
}

function biomeColor(biome) {
  switch (biome) {
    case "ember":
      return "#ff6b4a";
    case "verdant":
      return "#4fd18c";
    case "crystal":
      return "#4fd1c5";
    case "abyssal":
      return "#7c6cff";
    case "ashen":
      return "#9aa4b2";
    default:
      return "#e8ecf1";
  }
}

export { generateWorld, biomeColor, mulberry32, hashStringToSeed };
