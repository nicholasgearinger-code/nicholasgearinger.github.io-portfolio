import { mulberry32, hashStringToSeed } from "./worldgen.js";

// -----------------------------------------------------------------------------
// SWAP POINT: lore used to be generated live by the Anthropic API on first
// approach (see the old server/ai.js). Replaced with a curated static pool
// per biome, picked deterministically from each island's own id — same
// approach worldgen.js and crystals.js already use, so it stays consistent
// across reloads with zero network dependency. Add more lines to any biome
// array below for more variety; nothing else needs to change.
// -----------------------------------------------------------------------------

const LORE_BY_BIOME = {
  ember: [
    "The rocks here still remember the fire that lifted them into the sky.",
    "Embers drift upward long after their fuel is gone, refusing to be extinguished.",
    "Every surface holds a residual warmth, as if the island exhaled once and never inhaled again.",
    "Cinders orbit this place in slow spirals, tracing a fire that burned out centuries ago.",
    "The heat here isn't a memory — it's a promise the island hasn't broken yet.",
  ],
  verdant: [
    "Something grows here that has never seen soil.",
    "Roots spiral outward with nothing to anchor to, and thrive anyway.",
    "The green here doesn't need sunlight — it remembers a different star entirely.",
    "Vines climb toward nothing in particular, as if reaching were the whole point.",
    "Life took hold here before the island had decided what it wanted to be.",
  ],
  crystal: [
    "The air hums at a frequency only visitors seem to notice.",
    "Every facet catches a light that isn't currently in the sky.",
    "Sound arrives here a half-second late, as if the island is still deciding whether to let it in.",
    "The crystal formations grew toward each other, not upward — nobody knows why.",
    "Silence has a texture here, like it's being filtered through glass.",
  ],
  abyssal: [
    "Light bends strangely near the edge, as if the island is still falling.",
    "Gravity here is a suggestion the island only half-agrees with.",
    "The shadows fall the wrong direction, pointing toward a sun that set long ago.",
    "Something below the surface keeps pulling gently, patiently, at everything above it.",
    "The dark here isn't empty — it's occupied by something that hasn't introduced itself.",
  ],
  ashen: [
    "Ash drifts upward here, defying every rule but its own.",
    "Nothing has burned here in a long time, and yet the smoke never fully cleared.",
    "The gray isn't absence of color — it's what's left after every other color gave up.",
    "Footprints don't last here; the ash remembers, then forgets, then remembers again.",
    "This place ended once. It just never got around to admitting it.",
  ],
};

/**
 * @param {{id:string, biome:string}} island
 * @returns {string}
 */
function getIslandLore(island) {
  const pool = LORE_BY_BIOME[island.biome];
  if (!pool || pool.length === 0) return "An island drifts here, its story untold.";
  const rand = mulberry32(hashStringToSeed(island.id + "::lore"));
  return pool[Math.floor(rand() * pool.length)];
}

export { getIslandLore };
