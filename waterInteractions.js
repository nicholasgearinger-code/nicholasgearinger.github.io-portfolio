import * as THREE from "three";

// Gameplay-facing interaction layer. Intentionally CPU-light: the GPU FFT drives
// visual waves, while this smooth, deterministic swell proxy drives rigid-body
// motion without costly GPU readbacks. It is not an exact FFT height readback.
const MAX_RIPPLES = 24;
const WATER_DENSITY = 1025; // seawater, kg/m³
const GRAVITY = 9.81;
const MAX_STEP = 1 / 60;
const SWELLS = [
  [0.054, 0.019, 0.62, 0.92],
  [-0.026, 0.045, 0.35, 1.37],
  [0.086, -0.031, 0.19, 0.61],
  [0.16, 0.11, 0.09, 1.95],
];

export function sampleGameplayWater(handle, x, z, t, out = {}) {
  const base = handle?.waterY ?? 0;
  const storm = THREE.MathUtils.clamp(handle?.stormAmount?.value ?? 0, 0, 1);
  if (!handle?.gpuFFT) {
    out.height = base;
    out.nx = 0; out.nz = 0;
    return out;
  }
  // Low-frequency, multi-directional swells approximate the dominant
  // spectral bands. The precise FFT displacement stays on the GPU.
  let h = base, dx = 0, dz = 0;
  const gain = 1 + storm * 0.7;
  for (const [kx, kz, amp, rate] of SWELLS) {
    const phase = x * kx + z * kz - t * rate;
    h += amp * gain * Math.sin(phase);
    dx += amp * gain * kx * Math.cos(phase);
    dz += amp * gain * kz * Math.cos(phase);
  }
  out.height = h;
  out.nx = -dx;
  out.nz = -dz;
  return out;
}

function makeBoat() {
  const root = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.7, 1.55),
    new THREE.MeshStandardMaterial({ color: 0x78513c, roughness: 0.78 }));
  hull.position.y = -0.22;
  root.add(hull);
  const gunwale = new THREE.Mesh(new THREE.BoxGeometry(3.65, 0.12, 1.7),
    new THREE.MeshStandardMaterial({ color: 0xd3b48b, roughness: 0.68 }));
  gunwale.position.y = 0.12;
  root.add(gunwale);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 1.4),
    new THREE.MeshStandardMaterial({ color: 0xb68c62 }));
  bench.position.y = 0.14;
  root.add(bench);
  return root;
}

function makeRing() {
  const points = [];
  for (let j = 0; j <= 40; j++) {
    const a = j / 40 * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color: 0xc9f4f5, transparent: true, opacity: 0.6, depthWrite: false });
  const mesh = new THREE.LineLoop(geometry, material);
  mesh.visible = false;
  mesh.renderOrder = 4;
  return mesh;
}

export function createWaterInteractions(scene, handle, groundHeight) {
  if (!handle || !Number.isFinite(handle.waterY) || !handle.gpuFFT) return null;
  const state = { scene, handle, objects: [], rings: [], cursor: 0, previousPlayer: null, lastSplash: -100, sample: {} };
  // Small demonstrator vessels. The same sampler/update path can be attached
  // to GLTF boats and pickups later using registerFloatingObject().
  const candidates = [[-17, -21], [14, -30], [30, 12], [-36, 17], [7, 42]];
  for (let i = 0; i < candidates.length; i++) {
    const [x, z] = candidates[i];
    if (typeof groundHeight === "function" && groundHeight(x, z) > handle.waterY - 1.6) continue;
    const root = i === 0 ? makeBoat() : new THREE.Mesh(
      new THREE.IcosahedronGeometry(i % 2 ? 0.55 : 0.8, 1),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0xd2b58a : 0x8b7557, roughness: 0.9 }),
    );
    root.position.set(x, handle.waterY, z);
    scene.add(root);
    registerFloatingObject(state, root, {
      length: i === 0 ? 3.5 : 1.15,
      beam: i === 0 ? 1.55 : 1.15,
      hullHeight: i === 0 ? 0.7 : 1.25,
      mass: i === 0 ? 750 : (i % 2 ? 340 : 630),
      hullFill: i === 0 ? 0.75 : 0.72,
      owned: true,
      initialize: true,
    });
  }
  for (let i = 0; i < MAX_RIPPLES; i++) {
    const ring = makeRing();
    scene.add(ring);
    state.rings.push({ mesh: ring, time: -100, duration: 1.35 });
  }
  return state;
}

/**
 * Register any boat, raft or pickup as a lightweight rigid body.
 * Dimensions use world units (nominally meters); mass uses kilograms.
 * The body uses a rectangular distributed-volume hull approximation.
 * The visible mesh is never modified or owned unless owned=true.
 */
export function registerFloatingObject(state, mesh, {
  mass = 500, length = 2, beam = 1, hullHeight = 0.8,
  hullFill = 0.72, linearDamping = 1.5, angularDamping = 2.4,
  draft, owned = false, initialize = false,
} = {}) {
  if (!state || !mesh || state.objects.some(body => body.mesh === mesh)) return null;
  mass = Math.max(0.01, mass);
  length = Math.max(0.1, length);
  beam = Math.max(0.1, beam);
  hullHeight = Math.max(0.1, hullHeight);
  hullFill = THREE.MathUtils.clamp(hullFill, 0.1, 1);
  const area = length * beam * hullFill;
  const equilibriumDraft = Math.min(hullHeight, mass / (WATER_DENSITY * area));
  const offsets = [];
  // 3x3 distributed buoyancy cells: bow, stern, port and starboard.
  // Their local x/z positions rotate with heading; none require GPU readback.
  for (let ix = -1; ix <= 1; ix++) {
    for (let iz = -1; iz <= 1; iz++) {
      offsets.push([ix * length / 3, iz * beam / 3]);
    }
  }
  const body = {
    mesh, mass, length, beam, hullHeight, hullFill, area, offsets,
    owned, velocityY: 0, angularVelocityX: 0, angularVelocityZ: 0,
    linearDamping, angularDamping, previousImmersion: 0, lastImpact: -100,
    // Height of the bottom of the buoyant volume relative to the mesh pivot.
    bottomOffset: -hullHeight * 0.5,
    // Inertia of the simplified rectangular hull around its pivot.
    inertiaX: mass * (beam * beam + hullHeight * hullHeight) / 12,
    inertiaZ: mass * (length * length + hullHeight * hullHeight) / 12,
    sample: {},
  };
  // Legacy draft is supported as an explicit desired waterline offset; mass
  // remains the source of buoyant force, so draft is no longer a magic bob value.
  if (Number.isFinite(draft)) body.bottomOffset = -hullHeight + Math.max(0, draft);
  if (initialize) {
    mesh.position.y = state.handle.waterY - body.bottomOffset - equilibriumDraft;
  }
  state.objects.push(body);
  return body;
}

export function unregisterFloatingObject(state, mesh) {
  if (!state) return false;
  const index = state.objects.findIndex(body => body.mesh === mesh);
  if (index < 0) return false;
  state.objects.splice(index, 1);
  return true;
}

// Distributed hydrostatic force integration, with damping and simple rigid-body
// pitch/roll torques. No JS allocation per cell, no GPU readback, no physics lib.
function stepBuoyancy(state, body, step, t) {
  const { mesh, offsets, hullHeight, mass, area } = body;
  const yaw = mesh.rotation.y;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cellArea = area / offsets.length;
  const wave = body.sample;
  let forceY = -mass * GRAVITY;
  let torqueX = 0, torqueZ = 0, immersion = 0;
  // Rotation around z gives y=+pitch*x, rotation around x gives y=-roll*z.
  const pitch = mesh.rotation.z;
  const roll = mesh.rotation.x;
  for (let i = 0; i < offsets.length; i++) {
    const [lx, lz] = offsets[i];
    const wx = mesh.position.x + cy * lx + sy * lz;
    const wz = mesh.position.z - sy * lx + cy * lz;
    const localY = pitch * lx - roll * lz + body.bottomOffset;
    const water = sampleGameplayWater(state.handle, wx, wz, t, wave).height;
    const depth = THREE.MathUtils.clamp(water - mesh.position.y - localY, 0, hullHeight);
    immersion += depth;
    if (depth <= 0) continue;
    // Each element displaces water in proportion to its immersed column.
    const buoyantForce = WATER_DENSITY * GRAVITY * cellArea * depth;
    // The local vertical velocity includes angular motion at each hull cell.
    const pointVelocity = body.velocityY + body.angularVelocityZ * lx - body.angularVelocityX * lz;
    const dragForce = -pointVelocity * body.linearDamping * WATER_DENSITY * cellArea * depth;
    const lift = buoyantForce + dragForce;
    forceY += lift;
    torqueZ += lx * lift;
    torqueX -= lz * lift;
  }
  immersion /= offsets.length * hullHeight;
  // Cap accelerations to recover smoothly even after a low-FPS hitch.
  const accelY = THREE.MathUtils.clamp(forceY / mass, -GRAVITY * 2, GRAVITY * 3);
  body.velocityY = THREE.MathUtils.clamp(body.velocityY + accelY * step, -9, 9);
  mesh.position.y += body.velocityY * step;
  const accelX = THREE.MathUtils.clamp(torqueX / body.inertiaX, -18, 18);
  const accelZ = THREE.MathUtils.clamp(torqueZ / body.inertiaZ, -18, 18);
  body.angularVelocityX += (accelX - body.angularVelocityX * body.angularDamping) * step;
  body.angularVelocityZ += (accelZ - body.angularVelocityZ * body.angularDamping) * step;
  body.angularVelocityX = THREE.MathUtils.clamp(body.angularVelocityX, -1.8, 1.8);
  body.angularVelocityZ = THREE.MathUtils.clamp(body.angularVelocityZ, -1.8, 1.8);
  mesh.rotation.x = THREE.MathUtils.clamp(mesh.rotation.x + body.angularVelocityX * step, -0.65, 0.65);
  mesh.rotation.z = THREE.MathUtils.clamp(mesh.rotation.z + body.angularVelocityZ * step, -0.65, 0.65);
  // A hard landing adds a temporary surface disturbance, not a permanent wake.
  if (immersion > 0.02 && body.previousImmersion <= 0.02 &&
      body.velocityY < -1.1 && t - body.lastImpact > 0.6) {
    emitWaterSplash(state, mesh.position.x, mesh.position.z, t, Math.min(2, 0.7 + Math.abs(body.velocityY) * 0.2));
    body.lastImpact = t;
  }
  body.previousImmersion = immersion;
}

export function emitWaterSplash(state, x, z, time, strength = 1) {
  if (!state) return;
  const ring = state.rings[state.cursor++ % state.rings.length];
  ring.time = time;
  ring.strength = THREE.MathUtils.clamp(strength, 0.3, 2);
  ring.mesh.visible = true;
  ring.mesh.position.set(x, sampleGameplayWater(state.handle, x, z, time, state.sample).height + 0.07, z);
}

export function updateWaterInteractions(state, dt, t, playerPosition, swimming = false) {
  if (!state || !dt) return;
  // Substep at ~60 Hz for stable distributed hydrostatics on mobile.
  // Limit catch-up work after backgrounding or large frame stalls.
  dt = Math.min(dt, 0.05);
  const steps = Math.max(1, Math.ceil(dt / MAX_STEP));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const sampleTime = t - dt + (i + 1) * h;
    for (const body of state.objects) stepBuoyancy(state, body, h, sampleTime);
  }
  if (playerPosition && swimming) {
    const prev = state.previousPlayer;
    const distance = prev ? Math.hypot(playerPosition.x - prev.x, playerPosition.z - prev.z) : 0;
    if (t - state.lastSplash > 0.2 && (distance > 0.11 || !prev)) {
      emitWaterSplash(state, playerPosition.x, playerPosition.z, t, 0.8 + Math.min(distance, 1));
      state.lastSplash = t;
    }
    state.previousPlayer = { x: playerPosition.x, z: playerPosition.z };
  } else {
    state.previousPlayer = null;
  }
  for (const ripple of state.rings) {
    const age = t - ripple.time;
    if (age < 0 || age >= ripple.duration) { ripple.mesh.visible = false; continue; }
    const u = age / ripple.duration;
    ripple.mesh.scale.setScalar((0.5 + u * 3.4) * ripple.strength);
    ripple.mesh.material.opacity = 0.65 * (1 - u) * (1 - u);
    const x = ripple.mesh.position.x, z = ripple.mesh.position.z;
    ripple.mesh.position.y = sampleGameplayWater(state.handle, x, z, t, state.sample).height + 0.08;
  }
}

export function disposeWaterInteractions(state) {
  if (!state) return;
  for (const body of state.objects) {
    if (!body.owned) continue;
    state.scene.remove(body.mesh);
    body.mesh.traverse?.(obj => {
      obj.geometry?.dispose?.();
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material?.dispose?.();
    });
  }
  for (const ripple of state.rings) {
    state.scene.remove(ripple.mesh);
    ripple.mesh.geometry.dispose();
    ripple.mesh.material.dispose();
  }
  state.objects.length = 0;
  state.rings.length = 0;
}
