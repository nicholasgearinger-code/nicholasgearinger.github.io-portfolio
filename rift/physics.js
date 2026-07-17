import * as THREE from "three";

// -----------------------------------------------------------------------------
// SWAP POINT: platforming physics. Vertical movement (gravity, jump, landing)
// is handled here via a downward raycast against the current level's island
// meshes — the old free-flight version just added/subtracted from
// camera.position.y directly with no ground concept at all. Horizontal wall
// collision (not falling through the SIDE of an island) stays a separate,
// simpler ellipsoid push in main.js, since standing on top and bumping into
// a cliff face are different enough problems to solve independently.
//
// Tuned together: GRAVITY/JUMP_VELOCITY/WALK_SPEED determine the maximum
// jump distance levels.js generates gaps against — change one, reconsider
// the other.
// -----------------------------------------------------------------------------

const GRAVITY = 32;          // units/s^2
const JUMP_VELOCITY = 13;    // units/s, upward impulse on takeoff
const WALK_SPEED = 16;       // units/s, grounded — also main.js's max horizontal speed for jump-distance purposes
const AIR_CONTROL = 0.75;    // horizontal movement multiplier while airborne (a little less responsive than grounded, not locked)
const GROUND_SNAP_DISTANCE = 0.4; // how far below a raycast hit the feet can sit before snapping up, avoids visible clipping
const RAY_ORIGIN_LIFT = 3;   // cast from this far above the feet so a fast fall in one frame still gets caught
const RAY_MAX_DIST = 3 + GROUND_SNAP_DISTANCE + 2; // generous enough to catch normal per-frame fall distances

const raycaster = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);

function createPlayerPhysicsState() {
  return { verticalVelocity: 0, grounded: false };
}

/**
 * Advances vertical position by one frame of gravity/jump/ground-collision.
 * Horizontal position is expected to already be applied by the caller
 * (via controls.moveRight/moveForward, same as before) — this only touches
 * camera.position.y.
 *
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.Mesh[]} groundMeshes  the current level's island meshes
 * @param {{verticalVelocity:number, grounded:boolean}} state
 * @param {number} dt
 * @param {number} playerEyeHeight  camera.position.y is eye height; feet are this far below
 * @param {boolean} jumpRequested  true only on the frame the jump key was first pressed (edge-triggered by the caller)
 */
function updatePlayerPhysics(camera, groundMeshes, state, dt, playerEyeHeight, jumpRequested) {
  if (jumpRequested && state.grounded) {
    state.verticalVelocity = JUMP_VELOCITY;
    state.grounded = false;
  }

  state.verticalVelocity -= GRAVITY * dt;
  camera.position.y += state.verticalVelocity * dt;

  const feetY = camera.position.y - playerEyeHeight;
  let grounded = false;

  if (state.verticalVelocity <= 0 && groundMeshes.length > 0) {
    raycaster.set(
      new THREE.Vector3(camera.position.x, feetY + RAY_ORIGIN_LIFT, camera.position.z),
      DOWN
    );
    raycaster.far = RAY_MAX_DIST;
    const hits = raycaster.intersectObjects(groundMeshes, false);
    if (hits.length > 0) {
      const groundY = hits[0].point.y;
      if (feetY <= groundY + GROUND_SNAP_DISTANCE) {
        camera.position.y = groundY + playerEyeHeight;
        state.verticalVelocity = 0;
        grounded = true;
      }
    }
  }

  state.grounded = grounded;
}

export { createPlayerPhysicsState, updatePlayerPhysics, GRAVITY, JUMP_VELOCITY, WALK_SPEED, AIR_CONTROL };
