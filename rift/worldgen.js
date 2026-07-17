// worldgen.js
// -----------------------------------------------------------------------------
// SWAP POINT: deterministic PRNG + biome color lookup shared by levels.js
// (island layout) and crystals.js (crystal placement). The old scattered
// multi-biome world generator that used to live here moved to levels.js
// once the game split into one level per biome.
// -----------------------------------------------------------------------------

// Small deterministic PRNG (mulberry32) so the same seed always produces
// the same layout.
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

export { biomeColor, mulberry32, hashStringToSeed };
