import { mulberry32, hashStringToSeed, biomeColor } from "./worldgen.js";
import { GRAVITY, JUMP_VELOCITY, WALK_SPEED, AIR_CONTROL } from "./physics.js";

// -----------------------------------------------------------------------------
// SWAP POINT: level layout. Each biome is now its own short platforming
// course instead of a handful of islands scattered through a huge
// free-flight volume — a winding chain where each island sits within
// actual jump range of the one before it. Swap generateLevelIslands() for
// a different course-generation rule (branching paths, hand-placed
// islands, etc.) as long as it keeps returning the same island shape
// terrain.js and crystals.js already expect.
//
// Reachability isn't just "keep the gap under some fixed number" — a jump
// that's also climbing has less usable horizontal range than a flat one,
// so gap and climb are generated together against the real projectile
// math below (imported straight from physics.js so the two can't drift
// out of sync with each other).
// -----------------------------------------------------------------------------

const LEVELS = [
  { biome: "ember", name: "Ember Reach", tagline: "Islands still warm from a fire that lifted them into the sky." },
  { biome: "verdant", name: "Verdant Hollow", tagline: "Green that grew here without ever touching soil." },
  { biome: "crystal", name: "Crystal Spire", tagline: "Formations that hum at a frequency only visitors notice." },
  { biome: "abyssal", name: "Abyssal Drift", tagline: "Islands that never quite finished falling." },
  { biome: "ashen", name: "Ashen Expanse", tagline: "A place that ended once and never got around to admitting it." },
];

const ISLANDS_PER_LEVEL = 8;
const MIN_GAP = 4, MAX_GAP = 9;   // island-edge to island-edge, before reachability clamping below
const MAX_DESCEND = 6;             // descending isn't reachability-constrained the way climbing is, just kept sane for feel

// Height a jump has actually reached after covering horizontal distance dx
// at the given horizontal speed — the real constraint on how much a gap can
// also climb, not just an independent "max climb" number.
const H_SPEED = WALK_SPEED * AIR_CONTROL;
function heightAtDistance(dx) {
  const t = dx / H_SPEED;
  return JUMP_VELOCITY * t - 0.5 * GRAVITY * t * t;
}
const CLIMB_SAFETY_MARGIN = 0.7; // use at most 70% of the theoretical max height at that distance, leaving room for player timing error

/**
 * @param {string} biome
 * @param {string} seed
 * @returns {Array<{id, position:{x,y,z}, radius, height, biome, color, isStart:boolean}>}
 */
function generateLevelIslands(biome, seed) {
  const rand = mulberry32(hashStringToSeed(seed + "::level::" + biome));
  const islands = [];
  let pos = { x: 0, y: 0, z: 0 };
  let heading = rand() * Math.PI * 2;
  let prevRadius = 10;

  for (let i = 0; i < ISLANDS_PER_LEVEL; i++) {
    const isStart = i === 0;
    const radius = isStart ? 10 : 4.5 + rand() * 4.5;
    const height = 4 + rand() * 5;

    islands.push({
      id: `${biome}-${i}`,
      position: { x: pos.x, y: pos.y, z: pos.z },
      radius,
      height,
      biome,
      color: biomeColor(biome),
      isStart,
    });

    // Wind the path left/right rather than a straight line.
    heading += (rand() - 0.5) * 1.3;
    const gap = MIN_GAP + rand() * (MAX_GAP - MIN_GAP);
    const nextRadius = 4.5 + rand() * 4.5;
    const centerDist = prevRadius + nextRadius + gap;

    const climbing = rand() < 0.5;
    let vertical;
    if (climbing) {
      // Reachability is about the edge-to-edge gap the player actually has
      // to clear in open air — not the center-to-center distance, which
      // also includes both islands' radii and would wildly overstate how
      // far the jump itself needs to travel.
      const safeMaxClimb = Math.max(0, heightAtDistance(gap) * CLIMB_SAFETY_MARGIN);
      vertical = rand() * safeMaxClimb;
    } else {
      vertical = -rand() * MAX_DESCEND;
    }

    pos = {
      x: pos.x + Math.cos(heading) * centerDist,
      y: pos.y + vertical,
      z: pos.z + Math.sin(heading) * centerDist,
    };
    prevRadius = nextRadius;
  }

  return islands;
}

export { LEVELS, generateLevelIslands, ISLANDS_PER_LEVEL };
