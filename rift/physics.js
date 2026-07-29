import * as THREE from "three";

// -----------------------------------------------------------------------------
// SWAP POINT: platforming/walking physics. Ground contact works by sampling
// the terrain height directly under the player every frame via a downward
// raycast — and critically, once grounded, movement STICKS to whatever
// that sampled height is (capped to a max climb/descend rate so steep
// terrain feels like slow climbing rather than teleporting) instead of the
// old approach, which only re-snapped if a small per-frame gravity nudge
// happened to land within a narrow tolerance of the surface. That old
// approach broke the instant the terrain sloped at all — walking forward
// onto a rising or falling patch of ground would outpace the tolerance and
// the player would just fall through. This is the standard technique for
// character movement over uneven terrain.
//
// Free-fall (gravity + jump arc) only kicks in once no ground is found at
// all — walking off an edge, or jumping.
// -----------------------------------------------------------------------------

const GRAVITY = 32;          // units/s^2, used only while actually airborne
const JUMP_VELOCITY = 13;    // units/s, upward impulse on takeoff
const WALK_SPEED = 16;       // units/s
const AIR_CONTROL = 0.75;    // horizontal movement multiplier while airborne
const MAX_CLIMB_RATE = 26;   // units/s the player can follow a rising slope — steeper ground just slows how fast you can walk up it, rather than snapping instantly
const MAX_DESCEND_RATE = 40; // a bit more forgiving going downhill than climbing
const CAST_HEIGHT = 400;     // fixed altitude to cast down from — comfortably above any terrain height, avoids needing to tune a "how far above the player" margin

// Swimming — passed in per-call as an optional `waterLevel`, only non-null
// for Coral Shallows (the one biome that's a real whole-level ocean, not
// just a small liquid feature like Ember's lava channel or Verdant's
// river). When `waterLevel` is omitted this entire feature is inert and
// every line below behaves exactly as it always did — the swim branches
// below all short-circuit on `swimming`, which is only ever true when a
// real waterLevel was passed in.
const SWIM_GRAVITY = 5;          // units/s^2 — a gentle sink, not a plummet; water should feel weighty but forgiving, not like falling
const SWIM_UP_VELOCITY = 9;      // units/s — a swim stroke, gentler than a real jump's 13, and repeatable (not ground-gated) so tapping jump repeatedly is how you rise
const SWIM_CEILING_BUFFER = 0.6; // stay this far below the real water surface — close enough to see it clearly from underneath, without ever poking through into open air above it

const raycaster = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);

function createPlayerPhysicsState() {
  return { verticalVelocity: 0, grounded: false };
}

/**
 * Samples the terrain's height directly below (x, z), or null if nothing
 * is hit. `extraMeshes` (optional) lets additional collidable geometry —
 * specifically, a separate underground cave floor/ceiling disconnected
 * from the main terrain — participate in this same raycast. A plain
 * single-mesh raycast always resolves to the HIGHEST hit, which is
 * correct for open terrain but wrong the moment two valid surfaces exist
 * at the same XZ (the outer ground above a cave, and the cave's own
 * floor beneath it) — so when more than one hit comes back, this prefers
 * whichever is closest to `preferredY` (the player's own height just
 * before this sample) rather than always picking the higher one. With no
 * extraMeshes, this is byte-identical to the original single-mesh path.
 */
function sampleGroundHeight(x, z, terrainMesh, extraMeshes, preferredY) {
  if (!terrainMesh) return null;
  raycaster.set(new THREE.Vector3(x, CAST_HEIGHT, z), DOWN);
  raycaster.far = CAST_HEIGHT + 50;
  const hits = extraMeshes && extraMeshes.length
    ? raycaster.intersectObjects([terrainMesh, ...extraMeshes], false)
    : raycaster.intersectObject(terrainMesh, false);
  if (hits.length === 0) return null;
  if (hits.length === 1 || preferredY === undefined || preferredY === null) return hits[0].point.y;
  let best = hits[0], bestDist = Math.abs(hits[0].point.y - preferredY);
  for (let i = 1; i < hits.length; i++) {
    const d = Math.abs(hits[i].point.y - preferredY);
    if (d < bestDist) { best = hits[i]; bestDist = d; }
  }
  return best.point.y;
}

/**
 * Advances vertical position by one frame. Horizontal position is expected
 * to already be applied by the caller (via controls.moveRight/moveForward)
 * — this only touches camera.position.y, reading camera.position.x/z to
 * know where to sample.
 *
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.Mesh} terrainMesh  the current level's terrain
 * @param {{verticalVelocity:number, grounded:boolean}} state
 * @param {number} dt
 * @param {number} playerEyeHeight  camera.position.y is eye height; feet are this far below
 * @param {boolean} jumpRequested  true only on the frame the jump key was first pressed (edge-triggered by the caller)
 * @param {THREE.Mesh[]} [extraMeshes]  optional additional collidable geometry (e.g. a separate underground cave floor) that participates in the SAME ground raycast as the main terrain — see sampleGroundHeight's own comment for why disambiguating multiple hits matters here
 * @param {number} [waterLevel]  the Y height of a real, whole-level ocean surface (Coral Shallows' LIQUID_LEVEL.crystal) — omit for every other biome. When provided and the player's eye height is below it, swim mode activates: see the SWIM_* constants above.
 */
function updatePlayerPhysics(camera, terrainMesh, state, dt, playerEyeHeight, jumpRequested, extraMeshes, waterLevel) {
  const swimming = waterLevel !== undefined && waterLevel !== null && camera.position.y < waterLevel;

  if (jumpRequested && (state.grounded || swimming)) {
    state.verticalVelocity = swimming ? SWIM_UP_VELOCITY : JUMP_VELOCITY;
    state.grounded = false;
  }

  if (state.grounded) {
    const preferredY = camera.position.y - playerEyeHeight; // the player's own feet height a moment ago — used to keep following whichever surface they're actually already standing on, not whichever the ray happens to hit first
    const groundY = sampleGroundHeight(camera.position.x, camera.position.z, terrainMesh, extraMeshes, preferredY);
    if (groundY !== null) {
      const targetY = groundY + playerEyeHeight;
      const delta = targetY - camera.position.y;
      const maxStep = (delta >= 0 ? MAX_CLIMB_RATE : MAX_DESCEND_RATE) * dt;
      camera.position.y += Math.max(-maxStep, Math.min(maxStep, delta));
      state.verticalVelocity = 0;
      return;
    }
    state.grounded = false; // walked off the edge — start falling
  }

  state.verticalVelocity -= (swimming ? SWIM_GRAVITY : GRAVITY) * dt;
  camera.position.y += state.verticalVelocity * dt;

  if (swimming) {
    // A soft ceiling just under the real water surface — without this,
    // repeated swim-up taps would carry the player straight through the
    // surface into open air above the ocean, which breaks the whole
    // "you're underwater" framing this biome depends on.
    const ceiling = waterLevel - SWIM_CEILING_BUFFER;
    if (camera.position.y > ceiling) {
      camera.position.y = ceiling;
      if (state.verticalVelocity > 0) state.verticalVelocity = 0;
    }
  }

  if (state.verticalVelocity <= 0) {
    const feetY = camera.position.y - playerEyeHeight;
    const groundY = sampleGroundHeight(camera.position.x, camera.position.z, terrainMesh, extraMeshes, feetY);
    if (groundY !== null && feetY <= groundY) {
      camera.position.y = groundY + playerEyeHeight;
      state.verticalVelocity = 0;
      state.grounded = true;
    }
  }
}

export { createPlayerPhysicsState, updatePlayerPhysics, sampleGroundHeight, GRAVITY, JUMP_VELOCITY, WALK_SPEED, AIR_CONTROL };
