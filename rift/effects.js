import * as THREE from "three";

// -----------------------------------------------------------------------------
// SWAP POINT: purely cosmetic. Hit detection now happens locally in main.js
// against Resonance Crystal positions (see crystals.js) rather than being
// server-arbitrated player hits, but none of that touches this file — it
// just draws bolts, muzzle flashes, and impact bursts wherever it's told to.
// -----------------------------------------------------------------------------

function createBolt(scene, origin, direction, colorHex, speed) {
  const dir = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
  const boltLength = 1.4;
  const group = new THREE.Group();

  const coreGeo = new THREE.CylinderGeometry(0.05, 0.05, boltLength, 6);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  group.add(new THREE.Mesh(coreGeo, coreMat));

  const glowGeo = new THREE.CylinderGeometry(0.16, 0.16, boltLength * 1.3, 8);
  const glowMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  group.add(new THREE.Mesh(glowGeo, glowMat));

  // Cylinders stand along +Y by default — rotate to point along the travel direction.
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  group.position.set(origin.x, origin.y, origin.z);
  scene.add(group);

  return { group, velocity: dir.clone().multiplyScalar(speed), life: 0 };
}

function updateBolt(bolt, dt) {
  bolt.group.position.addScaledVector(bolt.velocity, dt);
  bolt.life += dt;
}

function disposeBolt(scene, bolt) {
  scene.remove(bolt.group);
  bolt.group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  });
}

function createMuzzleFlash(scene, position, colorHex = 0xe8ecf1) {
  const geo = new THREE.SphereGeometry(0.22, 8, 8);
  const mat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(position.x, position.y, position.z);
  scene.add(mesh);
  return { mesh, life: 0, duration: 0.08 };
}

function updateMuzzleFlash(flash, dt) {
  flash.life += dt;
  const t = flash.life / flash.duration;
  flash.mesh.material.opacity = Math.max(0, 0.9 * (1 - t));
  flash.mesh.scale.setScalar(1 + t * 1.5);
}

function disposeMuzzleFlash(scene, flash) {
  scene.remove(flash.mesh);
  flash.mesh.geometry.dispose();
  flash.mesh.material.dispose();
}

function createImpactBurst(scene, position, colorHex, options = {}) {
  const {
    count = 8,
    speedMin = 2,
    speedMax = 4,
    particleSize = 0.07,
    duration = 0.4,
  } = options;

  const group = new THREE.Group();
  const particles = [];

  for (let i = 0; i < count; i++) {
    const geo = new THREE.SphereGeometry(particleSize, 6, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);

    // Random outward direction, uniform on a sphere.
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const dir = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi)
    );
    const speed = speedMin + Math.random() * (speedMax - speedMin);
    particles.push({ mesh, velocity: dir.multiplyScalar(speed) });
  }

  group.position.set(position.x, position.y, position.z);
  scene.add(group);
  return { group, particles, life: 0, duration };
}

function updateImpactBurst(burst, dt) {
  burst.life += dt;
  const t = Math.min(1, burst.life / burst.duration);
  for (const p of burst.particles) {
    p.mesh.position.addScaledVector(p.velocity, dt);
    p.mesh.material.opacity = 1 - t;
  }
}

function disposeImpactBurst(scene, burst) {
  scene.remove(burst.group);
  burst.particles.forEach((p) => {
    p.mesh.geometry.dispose();
    p.mesh.material.dispose();
  });
}

export {
  createBolt,
  updateBolt,
  disposeBolt,
  createMuzzleFlash,
  updateMuzzleFlash,
  disposeMuzzleFlash,
  createImpactBurst,
  updateImpactBurst,
  disposeImpactBurst,
};
