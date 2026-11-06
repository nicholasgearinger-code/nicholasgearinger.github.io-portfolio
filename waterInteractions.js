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
  let h = base, dx = 0, dz = 0;
  // Low-frequency reconstruction of the ocean's actual seeded spectrum.
  // The GPU resolves all 16,384 coefficients; gameplay only resolves its
  // strongest 48 low modes. The full visible FFT still differs in detail.
  const modes = handle.gameplayModes;
  if (modes?.length) {
    const size = handle.spectrumSize || 2000;
    const gain = handle.waveScale?.value ?? (1 + storm * 0.7);
    for (const m of modes) {
      const phase = m.kx * (x + size * 0.5) + m.kz * (size * 0.5 - z);
      const w = m.omega * t, cw = Math.cos(w), sw = Math.sin(w);
      const real = (m.re + m.mirrorRe) * cw + (m.mirrorIm - m.im) * sw;
      const imag = (m.re - m.mirrorRe) * sw + (m.im + m.mirrorIm) * cw;
      const cp = Math.cos(phase), sp = Math.sin(phase);
      const v = (real * cp - imag * sp) * gain / (128 * 128);
      h += v;
      const slope = (-real * sp - imag * cp) * gain / (128 * 128);
      dx += slope * m.kx;
      dz -= slope * m.kz;
    }
  } else {
    // Fallback for water handles built before spectral gameplay modes.
    const gain = 1 + storm * 0.7;
    for (const [kx, kz, amp, rate] of SWELLS) {
      const phase = x * kx + z * kz - t * rate;
      h += amp * gain * Math.sin(phase);
      dx += amp * gain * kx * Math.cos(phase);
      dz += amp * gain * kz * Math.cos(phase);
    }
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

// Pooled bow spray: one draw call for all droplets, no per-frame allocations.
function createSpray(state) {
  const count = 48;
  const positions = new Float32Array(count * 3);
  positions.fill(-10000);
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", attribute);
  const material = new THREE.PointsMaterial({
    color: 0xe6ffff, size: 0.19, transparent: true, opacity: 0.82,
    depthWrite: false, sizeAttenuation: true,
  });
  const mesh = new THREE.Points(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  state.scene.add(mesh);
  state.spray = { mesh, geometry, material, positions, attribute,
    particles: Array.from({ length: count }, () => ({
      x: 0, y: -10000, z: 0, vx: 0, vy: 0, vz: 0, life: 0,
    })), cursor: 0 };
}

function emitBowSpray(state, body, t) {
  if (!state.spray || t - body.lastSpray < 0.085) return;
  const speed = Math.hypot(body.velocityX, body.velocityZ);
  if (speed < 1.8 || body.previousImmersion < 0.03) return;
  body.lastSpray = t;
  const yaw = body.mesh.rotation.y;
  const fx = Math.cos(yaw), fz = -Math.sin(yaw);
  const sx = Math.sin(yaw), sz = Math.cos(yaw);
  for (const side of [-1, 1]) {
    const p = state.spray.particles[state.spray.cursor++ % state.spray.particles.length];
    p.x = body.mesh.position.x + fx * body.length * 0.50 + sx * side * body.beam * 0.4;
    p.z = body.mesh.position.z + fz * body.length * 0.50 + sz * side * body.beam * 0.4;
    p.y = sampleGameplayWater(state.handle, p.x, p.z, t, state.sample).height + 0.1;
    p.vx = fx * speed * 0.2 + sx * side * (1 + speed * 0.2);
    p.vz = fz * speed * 0.2 + sz * side * (1 + speed * 0.2);
    p.vy = 1.1 + speed * 0.35;
    p.life = 0.55;
  }
}

function updateSpray(state, dt) {
  if (!state.spray) return;
  const { particles, positions, attribute } = state.spray;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i], j = i * 3;
    if (p.life > 0) {
      p.life -= dt;
      p.vy -= 9.81 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    positions[j] = p.life > 0 ? p.x : -10000;
    positions[j + 1] = p.life > 0 ? p.y : -10000;
    positions[j + 2] = p.life > 0 ? p.z : -10000;
  }
  attribute.needsUpdate = true;
}

function createWakeTracks(state, body) {
  if (!body.boat) return;
  body.wakeTracks = [-1, 1].map(side => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(11 * 3);
    const attribute = new THREE.BufferAttribute(positions, 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", attribute);
    const material = new THREE.LineBasicMaterial({
      color: 0xd9fdf7, transparent: true, opacity: 0.0, depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.visible = false;
    line.frustumCulled = false;
    line.renderOrder = 4;
    state.scene.add(line);
    return { side, line, geometry, material, positions, attribute };
  });
}

function updateWakeTracks(state, body, t) {
  if (!body.wakeTracks) return;
  const speed = Math.hypot(body.velocityX, body.velocityZ);
  const active = speed > 0.75 && body.previousImmersion > 0.03;
  const yaw = body.mesh.rotation.y, fx = Math.cos(yaw), fz = -Math.sin(yaw);
  const sx = Math.sin(yaw), sz = Math.cos(yaw);
  for (const track of body.wakeTracks) {
    track.line.visible = active;
    if (!active) continue;
    const totalLength = Math.min(12, 2 + speed * 1.8);
    track.material.opacity = Math.min(0.7, 0.2 + speed * 0.10);
    for (let i = 0; i < 11; i++) {
      const u = i / 10;
      const backward = body.length * 0.55 + totalLength * u;
      const lateral = track.side * (body.beam * 0.55 + u * totalLength * 0.33);
      const x = body.mesh.position.x - fx * backward + sx * lateral;
      const z = body.mesh.position.z - fz * backward + sz * lateral;
      const idx = i * 3;
      track.positions[idx] = x;
      track.positions[idx + 1] = sampleGameplayWater(state.handle, x, z, t, state.sample).height + 0.09;
      track.positions[idx + 2] = z;
    }
    track.attribute.needsUpdate = true;
  }
}

export function createWaterInteractions(scene, handle, groundHeight) {
  if (!handle || !Number.isFinite(handle.waterY) || !handle.gpuFFT) return null;
  const state = { scene, handle, groundHeight, objects: [], rings: [], cursor: 0, previousPlayer: null, lastSplash: -100, sample: {} };
  createSpray(state);
  // Small demonstrator vessels. The same sampler/update path can be attached
  // to GLTF boats and pickups later using registerFloatingObject().
  const candidates = [[-17, -21], [14, -30], [30, 12], [-36, 17], [7, 42], [48, -31], [-43, -35]];
  let boatCreated = false;
  for (let i = 0; i < candidates.length; i++) {
    const [x, z] = candidates[i];
    if (typeof groundHeight === "function" && groundHeight(x, z) > handle.waterY - 1.6) continue;
    const isBoat = !boatCreated;
    const root = isBoat ? makeBoat() : new THREE.Mesh(
      new THREE.IcosahedronGeometry(i % 2 ? 0.55 : 0.8, 1),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0xd2b58a : 0x8b7557, roughness: 0.9 }),
    );
    root.position.set(x, handle.waterY, z);
    scene.add(root);
    registerFloatingObject(state, root, {
      length: isBoat ? 3.5 : 1.15,
      beam: isBoat ? 1.55 : 1.15,
      hullHeight: isBoat ? 0.7 : 1.25,
      mass: isBoat ? 750 : (i % 2 ? 340 : 630),
      hullFill: isBoat ? 0.75 : 0.72,
      boat: isBoat,
      owned: true,
      initialize: true,
    });
    if (isBoat) boatCreated = true;
  }
  // Keep an interactable vessel available even if the preset positions
  // happen to land on shallow terrain in a different world generation.
  if (!boatCreated) {
    const root = makeBoat();
    root.position.set(-17, handle.waterY, -21);
    scene.add(root);
    registerFloatingObject(state, root, {
      boat: true, mass: 750, length: 3.5, beam: 1.55,
      hullHeight: 0.7, hullFill: 0.75, owned: true, initialize: true,
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
/**
 * Move the demo vessel to accessible water near the player spawn.
 * Invoked only when the level is built. Never respawns/moves the boat
 * after the player has started exploring.
 */
export function positionDemoBoatNearSpawn(state, spawnX, spawnZ) {
  if (!state || !Number.isFinite(spawnX) || !Number.isFinite(spawnZ)) return false;
  const body = state.objects.find(item => item.boat);
  if (!body || typeof state.groundHeight !== "function") return false;
  const waterY = state.handle.waterY;
  let best = null;
  const radii = [8, 12, 18, 24, 32, 42, 55, 70];
  for (const radius of radii) {
    let nearestOnThisRing = null;
    for (let i = 0; i < 20; i++) {
      const angle = i * Math.PI * 2 / 20;
      const x = spawnX + Math.cos(angle) * radius;
      const z = spawnZ + Math.sin(angle) * radius;
      const ground = state.groundHeight(x, z);
      const depth = waterY - ground;
      if (!Number.isFinite(depth) || depth < 1.15 || depth > 9) continue;
      // Prefer a gently shelving approach while keeping room beneath the hull.
      const score = Math.abs(depth - 2.8);
      if (!nearestOnThisRing || score < nearestOnThisRing.score) {
        nearestOnThisRing = { x, z, score };
      }
    }
    if (nearestOnThisRing) {
      best = nearestOnThisRing;
      break;
    }
  }
  if (!best) return false;
  const { mesh } = body;
  mesh.position.set(best.x, waterY - body.bottomOffset -
    Math.min(body.hullHeight, body.mass / (WATER_DENSITY * body.area)), best.z);
  mesh.rotation.set(0, 0, 0);
  body.velocityX = body.velocityY = body.velocityZ = 0;
  body.angularVelocityX = body.angularVelocityZ = 0;
  return true;
}

export function registerFloatingObject(state, mesh, {
  mass = 500, length = 2, beam = 1, hullHeight = 0.8,
  hullFill = 0.72, linearDamping = 1.5, angularDamping = 2.4,
  draft, owned = false, initialize = false, boat = false,
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
    owned, boat, velocityY: 0, angularVelocityX: 0, angularVelocityZ: 0,
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
  body.velocityX = 0;
  body.velocityZ = 0;
  body.throttle = 0;
  body.rudder = 0;
  body.maxThrust = 0; // inactive unless explicitly configured for a powered vessel
  body.waterDrag = 0.65;
  body.lastWake = -100;
  body.lastSpray = -100;
  createWakeTracks(state, body);
  state.objects.push(body);
  return body;
}
/** Enable optional boat navigation. Throttle and rudder are normalized [-1,1]. */
export function setBoatControls(body, { throttle, rudder, maxThrust } = {}) {
  if (!body) return;
  if (Number.isFinite(throttle)) body.throttle = THREE.MathUtils.clamp(throttle, -1, 1);
  if (Number.isFinite(rudder)) body.rudder = THREE.MathUtils.clamp(rudder, -1, 1);
  if (Number.isFinite(maxThrust)) body.maxThrust = Math.max(0, maxThrust);
}

export function unregisterFloatingObject(state, mesh) {
  if (!state) return false;
  const index = state.objects.findIndex(body => body.mesh === mesh);
  if (index < 0) return false;
  const [body] = state.objects.splice(index, 1);
  for (const track of body.wakeTracks || []) {
    state.scene.remove(track.line);
    track.geometry.dispose();
    track.material.dispose();
  }
  return true;
}

// Distributed hydrostatic force integration, with damping and simple rigid-body
// pitch/roll torques. No JS allocation per cell, no GPU readback, no physics lib.
function stepBuoyancy(state, body, step, t) {
  const { mesh, offsets, hullHeight, mass, area } = body;
  // Horizontal water drag and opt-in propulsion; boats with no controls
  // settle naturally instead of drifting away. Heading uses local +X.
  const thrust = body.throttle * body.maxThrust;
  const speed = Math.hypot(body.velocityX, body.velocityZ);
  const drag = body.waterDrag * speed;
  const heading = mesh.rotation.y;
  body.velocityX += ((Math.cos(heading) * thrust / mass) - body.velocityX * drag) * step;
  body.velocityZ += ((-Math.sin(heading) * thrust / mass) - body.velocityZ * drag) * step;
  body.velocityX = THREE.MathUtils.clamp(body.velocityX, -8, 8);
  body.velocityZ = THREE.MathUtils.clamp(body.velocityZ, -8, 8);
  const nextX = mesh.position.x + body.velocityX * step;
  const nextZ = mesh.position.z + body.velocityZ * step;
  const ground = typeof state.groundHeight === "function"
    ? state.groundHeight(nextX, nextZ) : -Infinity;
  if (body.boat && Number.isFinite(ground) && ground > state.handle.waterY - 0.45) {
    // Run aground gently rather than sailing straight through the island.
    body.velocityX *= -0.08; body.velocityZ *= -0.08;
  } else {
    mesh.position.x = nextX; mesh.position.z = nextZ;
  }
  mesh.rotation.y += body.rudder * Math.min(speed, 5) * 0.22 * step;
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
  if (immersion > 0.05 && Math.hypot(body.velocityX, body.velocityZ) > 0.9 && t - body.lastWake > 0.33) {
    const aft = body.length * 0.55;
    emitWaterSplash(state, mesh.position.x - Math.cos(mesh.rotation.y) * aft,
      mesh.position.z + Math.sin(mesh.rotation.y) * aft, t, 0.45);
    body.lastWake = t;
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
  for (const body of state.objects) {
    if (!body.boat) continue;
    updateWakeTracks(state, body, t);
    emitBowSpray(state, body, t);
  }
  updateSpray(state, dt);
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
    for (const track of body.wakeTracks || []) {
      state.scene.remove(track.line);
      track.geometry.dispose();
      track.material.dispose();
    }
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
  if (state.spray) {
    state.scene.remove(state.spray.mesh);
    state.spray.geometry.dispose();
    state.spray.material.dispose();
    state.spray = null;
  }
  state.objects.length = 0;
  state.rings.length = 0;
}
