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

const raycaster = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);

function createPlayerPhysicsState() {
  return { verticalVelocity: 0, grounded: false };
}

/**
 * Samples the terrain's height directly below (x, z), or null if the
 * terrain mesh doesn't extend that far (shouldn't normally happen within
 * the bounded play area, but callers should treat null as "no ground").
 */
function sampleGroundHeight(x, z, terrainMesh) {
  if (!terrainMesh) return null;
  raycaster.set(new THREE.Vector3(x, CAST_HEIGHT, z), DOWN);
  raycaster.far = CAST_HEIGHT + 50;
  const hits = raycaster.intersectObject(terrainMesh, false);
  return hits.length > 0 ? hits[0].point.y : null;
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
 */
function updatePlayerPhysics(camera, terrainMesh, state, dt, playerEyeHeight, jumpRequested) {
  if (jumpRequested && state.grounded) {
    state.verticalVelocity = JUMP_VELOCITY;
    state.grounded = false;
  }

  if (state.grounded) {
    const groundY = sampleGroundHeight(camera.position.x, camera.position.z, terrainMesh);
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

  state.verticalVelocity -= GRAVITY * dt;
  camera.position.y += state.verticalVelocity * dt;

  if (state.verticalVelocity <= 0) {
    const groundY = sampleGroundHeight(camera.position.x, camera.position.z, terrainMesh);
    const feetY = camera.position.y - playerEyeHeight;
    if (groundY !== null && feetY <= groundY) {
      camera.position.y = groundY + playerEyeHeight;
      state.verticalVelocity = 0;
      state.grounded = true;
    }
  }
}

export { createPlayerPhysicsState, updatePlayerPhysics, sampleGroundHeight, GRAVITY, JUMP_VELOCITY, WALK_SPEED, AIR_CONTROL };
