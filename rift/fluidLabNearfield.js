// Bounded near-field position-based fluid spray from Fluid Simulation Lab M4/M5.
// Uses actual particle gravity, fluid-neighbor separation, viscosity and
// water-surface collision. Ocean displacement remains FFT + finite-depth GPU.
// Explicitly NOT a full SSFR/PBF replacement for kilometres of open sea.
// One instanced draw; 64 mobile or 144 desktop droplets, max 2 CPU substeps.
// ?riftFluidLab=off disables both this and the solver-based surface optics.
import * as THREE from "three";
import { consumeRiftWaterVisualImpact } from "./waterLabInteractions.js";

const TOUCH = typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "") ||
    (navigator.maxTouchPoints || 0) > 0);
const MAX_PARTICLES = TOUCH ? 64 : 144;
const SMOOTHING_RADIUS = 0.31;
const GRAVITY = 9.81;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createFluidLabNearfield(scene, handle) {
  if (!handle?.gpuFFT || !scene) return null;
  const geometry = new THREE.SphereGeometry(0.076, 6, 4);
  const material = new THREE.MeshBasicNodeMaterial({
    color: 0xd2faf5, transparent: true, opacity: 0.72,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, MAX_PARTICLES);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.visible = false;
  scene.add(mesh);
  const dummy = new THREE.Object3D();
  const dots = Array.from({ length: MAX_PARTICLES }, () => ({
    x: 0, y: -10000, z: 0, px: 0, py: 0, pz: 0,
    vx: 0, vy: 0, vz: 0, life: 0, radius: 0.05,
  }));
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < MAX_PARTICLES; i++) mesh.setMatrixAt(i, hidden);
  mesh.instanceMatrix.needsUpdate = true;
  let cursor = 0, disposed = false, emitted = 0;
  const active = new Int16Array(MAX_PARTICLES);

  function splash(event, camera) {
    if (!event || !Number.isFinite(event.x) || !Number.isFinite(event.z)) return;
    if (camera && Math.hypot(camera.x - event.x, camera.z - event.z) > 48) return;
    const strength = clamp(event.strength, 0, 2);
    const count = Math.min(TOUCH ? 7 : 12, Math.ceil(2 + strength * 3));
    const sourceY = (handle.waterY ?? 0) + 0.06;
    const scale = event.kind === "hull" ? 1.2 : 0.75;
    for (let i = 0; i < count; i++) {
      const p = dots[cursor++ % MAX_PARTICLES];
      // Low-discrepancy angles avoid frame-to-frame white noise and
      // physically separate short-lived droplets from a contact point.
      const angle = (i * 2.399963 + emitted * 0.73);
      const spread = (0.09 + (i % 3) * 0.075) * scale;
      const dx = Math.cos(angle), dz = Math.sin(angle);
      p.x = event.x + dx * spread;
      p.z = event.z + dz * spread;
      p.y = sourceY + 0.02 + (i % 4) * 0.025;
      p.vx = dx * (0.40 + strength * 0.37) * scale;
      p.vz = dz * (0.40 + strength * 0.37) * scale;
      p.vy = (0.95 + (i % 4) * 0.25 + strength * 0.80) * scale;
      p.life = 0.36 + Math.min(0.35, strength * 0.15);
      p.radius = 0.038 + (i % 3) * 0.012;
    }
    emitted++;
  }

  // Small position-based fluid solve: conserve local particle spacing and
  // damp differential velocities. This transfers the lab's shape/contact
  // principle without its tens of thousands of GPU SSFR particles.
  function step(h, elapsed) {
    let count = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = dots[i];
      if (p.life <= 0) continue;
      p.life -= h;
      if (p.life <= 0) continue;
      active[count++] = i;
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.vy -= GRAVITY * h;
      p.x += p.vx * h;
      p.y += p.vy * h;
      p.z += p.vz * h;
    }
    // Two PBF-style constraint projections; particles remain volume-like
    // blobs rather than passing straight through one another.
    for (let iteration = 0; iteration < 2; iteration++) {
      for (let i = 0; i < count; i++) {
        const a = dots[active[i]];
        for (let j = i + 1; j < count; j++) {
          const b = dots[active[j]];
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 1e-9 || d2 >= SMOOTHING_RADIUS * SMOOTHING_RADIUS) continue;
          const distance = Math.sqrt(d2);
          const push = Math.min(0.035, (SMOOTHING_RADIUS - distance) * 0.11)
            / distance;
          const px = dx * push, py = dy * push, pz = dz * push;
          a.x -= px; a.y -= py; a.z -= pz;
          b.x += px; b.y += py; b.z += pz;
        }
      }
    }
    // Derive velocity from constrained positions. Surface re-entry
    // dissipates droplets into the actual shallow-water ripple/foam state.
    for (let i = 0; i < count; i++) {
      const p = dots[active[i]];
      const surface = (handle.waterY ?? 0) + 0.02;
      if (p.y < surface && p.vy < 0) {
        p.life = 0;
        continue;
      }
      const inverse = 1 / Math.max(0.006, h);
      p.vx = clamp((p.x - p.px) * inverse * 0.94, -3, 3);
      p.vy = clamp((p.y - p.py) * inverse * 0.96, -5, 5);
      p.vz = clamp((p.z - p.pz) * inverse * 0.94, -3, 3);
    }
  }

  function update(dt, elapsed, camera) {
    if (disposed) return;
    // Emitted oar strikes, swimmer splashes and hull slaps share one bus.
    // Consume at most 2 events/frame: avoids a burst after tab suspension.
    for (let i = 0; i < 2; i++) {
      const event = consumeRiftWaterVisualImpact(handle);
      if (!event) break;
      splash(event, camera);
    }
    dt = clamp(Number(dt) || 0, 0, 0.05);
    if (dt > 0) {
      const steps = dt > 0.025 ? 2 : 1;
      for (let i = 0; i < steps; i++) step(dt / steps, elapsed);
    }
    let visible = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = dots[i];
      if (p.life > 0) {
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.setScalar(p.radius / 0.076);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        visible++;
      } else {
        mesh.setMatrixAt(i, hidden);
      }
    }
    mesh.visible = visible > 0;
    if (visible) mesh.instanceMatrix.needsUpdate = true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  return { update, dispose, particles: dots, mesh, capacity: MAX_PARTICLES };
}
