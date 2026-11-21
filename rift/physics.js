import * as THREE from "three";

const GRAVITY = 32;
const JUMP_VELOCITY = 13;
const WALK_SPEED = 16;
const AIR_CONTROL = 0.75;
const MAX_CLIMB_RATE = 26;
const MAX_DESCEND_RATE = 40;
const CAST_HEIGHT = 400;

const BUOYANCY_VELOCITY = 4;
const SWIM_UP_VELOCITY = 12;
const SWIM_DOWN_VELOCITY = 10;
const SWIM_SPEED_MULTIPLIER = 0.55;
const WATER_ENTRY_MOMENTUM_RETENTION = 0.28;
const WATER_VERTICAL_RESPONSE = 18;

const raycaster = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);

function createPlayerPhysicsState() {
  return {
    verticalVelocity: 0,
    grounded: false,
    wasSwimming: false,
  };
}

function sampleGroundHeight(x, z, terrainMesh, extraMeshes, preferredY) {
  // Beyond the finite 480x480 Coral terrain mesh, the streaming offshore
  // seabed is generated from the same analytic bathymetry. Sample it directly
  // so swimming, diving and buoyancy still work no matter how far offshore
  // the player travels. Do not change physics for the other levels.
  const oceanSample = globalThis.__riftOceanStreamGround;
  if (typeof oceanSample === "function" &&
      (Math.abs(x) > 238 || Math.abs(z) > 238)) {
    const h = oceanSample(x, z);
    return Number.isFinite(h) ? h : null;
  }
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

function moveToward(current, target, maxDelta) {
  if (current < target) return Math.min(target, current + maxDelta);
  if (current > target) return Math.max(target, current - maxDelta);
  return target;
}

function updatePlayerPhysics(camera, terrainMesh, state, dt, playerEyeHeight, jumpRequested, extraMeshes, waterLevel, swimVertical = 0) {
  const swimming = waterLevel !== undefined && waterLevel !== null && camera.position.y < waterLevel;
  const enteringWater = swimming && !state.wasSwimming;

  if (swimming) {
    // Crossing the surface now behaves like a fluid collision instead of an
    // instantaneous mode toggle. Downward/upward momentum is absorbed on entry,
    // then buoyancy/swim input accelerates toward its target over several frames.
    if (enteringWater) {
      state.verticalVelocity *= WATER_ENTRY_MOMENTUM_RETENTION;
    }

    // Free-swim mode: retain the original upward buoyancy in stable play,
    // but permit neutral hovering and analog vertical travel when enabled.
    // Look+forward and touch buttons share the same signed swimVertical.
    const freeSwim = typeof location !== "undefined" &&
      new URLSearchParams(location.search).get("riftSwim3D") === "on";
    let targetVelocity;
    if (freeSwim) {
      const input = THREE.MathUtils.clamp(swimVertical, -1, 1);
      targetVelocity = input >= 0
        ? input * SWIM_UP_VELOCITY : input * SWIM_DOWN_VELOCITY;
      // A tiny positive buoyancy makes releasing controls gently drift
      // upward, but doesn't force the camera straight back to the surface.
      if (Math.abs(input) < 0.04) targetVelocity = 0.18;
    } else if (swimVertical > 0) targetVelocity = SWIM_UP_VELOCITY;
    else if (swimVertical < 0) targetVelocity = -SWIM_DOWN_VELOCITY;
    else targetVelocity = BUOYANCY_VELOCITY;

    state.verticalVelocity = moveToward(
      state.verticalVelocity,
      targetVelocity,
      WATER_VERTICAL_RESPONSE * dt,
    );

    camera.position.y += state.verticalVelocity * dt;
    state.grounded = false;
    state.wasSwimming = true;

    // Keep the player out of the seabed while diving.
    const feetY = camera.position.y - playerEyeHeight;
    const groundY = sampleGroundHeight(camera.position.x, camera.position.z, terrainMesh, extraMeshes, feetY);
    if (groundY !== null && feetY <= groundY) {
      camera.position.y = groundY + playerEyeHeight;
      state.verticalVelocity = 0;
      state.grounded = true;
    }
    return;
  }

  state.wasSwimming = false;

  if (jumpRequested && state.grounded) {
    state.verticalVelocity = JUMP_VELOCITY;
    state.grounded = false;
  }

  if (state.grounded) {
    const preferredY = camera.position.y - playerEyeHeight;
    const groundY = sampleGroundHeight(camera.position.x, camera.position.z, terrainMesh, extraMeshes, preferredY);
    if (groundY !== null) {
      const targetY = groundY + playerEyeHeight;
      const delta = targetY - camera.position.y;
      const maxStep = (delta >= 0 ? MAX_CLIMB_RATE : MAX_DESCEND_RATE) * dt;
      camera.position.y += Math.max(-maxStep, Math.min(maxStep, delta));
      state.verticalVelocity = 0;
      return;
    }
    state.grounded = false;
  }

  state.verticalVelocity -= GRAVITY * dt;
  camera.position.y += state.verticalVelocity * dt;

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

export { createPlayerPhysicsState, updatePlayerPhysics, sampleGroundHeight, GRAVITY, JUMP_VELOCITY, WALK_SPEED, AIR_CONTROL, SWIM_SPEED_MULTIPLIER };
