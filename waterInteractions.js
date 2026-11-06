import * as THREE from "three";

// Gameplay-facing interaction layer. Intentionally CPU-light: the GPU FFT drives
// visual waves, while this smooth, deterministic swell proxy drives rigid-body
// motion without costly GPU readbacks. It is not an exact FFT height readback.
const UP = new THREE.Vector3(0, 1, 0);
const MAX_RIPPLES = 24;
const tmpNormal = new THREE.Vector3();

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
  const waves = [
    [0.054, 0.019, 0.62, 0.92],
    [-0.026, 0.045, 0.35, 1.37],
    [0.086, -0.031, 0.19, 0.61],
    [0.16, 0.11, 0.09, 1.95],
  ];
  let h = base, dx = 0, dz = 0;
  const gain = 1 + storm * 0.7;
  for (const [kx, kz, amp, rate] of waves) {
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
    registerFloatingObject(state, root, { draft: i === 0 ? 0.12 : 0.24, length: i === 0 ? 3.5 : 1, beam: i === 0 ? 1.5 : 1 });
  }
  for (let i = 0; i < MAX_RIPPLES; i++) {
    const ring = makeRing();
    scene.add(ring);
    state.rings.push({ mesh: ring, time: -100, duration: 1.35 });
  }
  return state;
}

export function registerFloatingObject(state, mesh, { draft = 0, length = 1, beam = 1, stiffness = 3.5 } = {}) {
  if (!state || !mesh) return null;
  const body = { mesh, draft, length, beam, stiffness, velocityY: 0, heading: mesh.rotation.y, baseX: mesh.position.x, baseZ: mesh.position.z };
  state.objects.push(body);
  return body;
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
  dt = Math.min(dt, 0.05);
  for (const body of state.objects) {
    const { mesh, length, beam } = body;
    const x = mesh.position.x, z = mesh.position.z;
    const halfL = length * 0.5, halfB = beam * 0.5;
    const a = sampleGameplayWater(state.handle, x - halfL, z, t, {});
    const b = sampleGameplayWater(state.handle, x + halfL, z, t, {});
    const c = sampleGameplayWater(state.handle, x, z - halfB, t, {});
    const d = sampleGameplayWater(state.handle, x, z + halfB, t, {});
    const targetY = (a.height + b.height + c.height + d.height) * 0.25 - body.draft;
    // Critically damped vertical spring: no jitter or teleporting between frames.
    const omega = body.stiffness;
    const accel = omega * omega * (targetY - mesh.position.y) - 2 * omega * body.velocityY;
    body.velocityY += accel * dt;
    mesh.position.y += body.velocityY * dt;
    const pitch = Math.atan2(b.height - a.height, Math.max(0.1, length));
    const roll = -Math.atan2(d.height - c.height, Math.max(0.1, beam));
    const alpha = 1 - Math.exp(-3 * dt);
    mesh.rotation.z = THREE.MathUtils.lerp(mesh.rotation.z, pitch, alpha);
    mesh.rotation.x = THREE.MathUtils.lerp(mesh.rotation.x, roll, alpha);
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
