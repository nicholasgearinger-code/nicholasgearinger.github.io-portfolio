import * as THREE from "three";

// -----------------------------------------------------------------------------
// SWAP POINT: Resonance Crystal mesh lifecycle — the single-player
// replacement for "other players" as something to aim at. Placement (which
// XZ spots on a level's terrain get a crystal) now lives in levels.js;
// this file only owns what a crystal looks like and how it animates, given
// a final {id, position:{x,y,z}, color}. Swap createCrystalMesh() for
// different visuals without touching how shattering/scoring works in
// main.js.
// -----------------------------------------------------------------------------

const CRYSTAL_RADIUS = 0.55; // hit-test sphere, also roughly the visual size

function createCrystalMesh(scene, crystal) {
  const geo = new THREE.OctahedronGeometry(CRYSTAL_RADIUS, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: crystal.color,
    emissive: crystal.color,
    emissiveIntensity: 0.9,
    roughness: 0.25,
    metalness: 0.1,
    transparent: true,
    opacity: 0.92,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(crystal.position.x, crystal.position.y, crystal.position.z);
  scene.add(mesh);

  // Soft point light so crystals actually read as light sources in the
  // scene, not just glowing shapes — cheap since there are only a
  // handful active at once.
  const light = new THREE.PointLight(crystal.color, 0.6, 8);
  light.position.copy(mesh.position);
  scene.add(light);

  return { id: crystal.id, mesh, light, spinSeed: Math.random() * Math.PI * 2, baseY: crystal.position.y };
}

function updateCrystalMesh(handle, elapsed) {
  handle.mesh.rotation.y = elapsed * 0.6 + handle.spinSeed;
  handle.mesh.rotation.x = Math.sin(elapsed * 0.4 + handle.spinSeed) * 0.15;
  const bob = Math.sin(elapsed * 1.1 + handle.spinSeed) * 0.12;
  handle.mesh.position.y = handle.baseY + bob;
}

function disposeCrystalMesh(scene, handle) {
  scene.remove(handle.mesh);
  scene.remove(handle.light);
  handle.mesh.geometry.dispose();
  handle.mesh.material.dispose();
}

export { createCrystalMesh, updateCrystalMesh, disposeCrystalMesh, CRYSTAL_RADIUS };
