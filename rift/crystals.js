import * as THREE from "three";
import { mulberry32, hashStringToSeed } from "./worldgen.js";

// -----------------------------------------------------------------------------
// SWAP POINT: Resonance Crystals — the single-player replacement for "other
// players" as something to aim at. Placement is deterministic (seeded off
// each island's own id), so the same world always grows crystals in the
// same spots. Swap generateCrystalsForIsland() for a different placement
// rule, or createCrystalMesh() for different visuals, without touching how
// shattering/scoring works in main.js.
// -----------------------------------------------------------------------------

const CRYSTAL_RADIUS = 0.55; // hit-test sphere, also roughly the visual size
const CRYSTALS_PER_ISLAND_MIN = 2;
const CRYSTALS_PER_ISLAND_MAX = 4;

/**
 * @param {{id:string, position:{x,y,z}, radius:number, height:number, color:string}} island
 * @returns {Array<{id:string, islandId:string, position:{x,y,z}, color:string}>}
 */
function generateCrystalsForIsland(island) {
  // Independent seed stream from the island's own id (not the world seed
  // directly) so adding/removing crystal logic later can't accidentally
  // perturb island placement itself — the two generators never share state.
  const rand = mulberry32(hashStringToSeed(island.id + "::crystals"));
  const count = CRYSTALS_PER_ISLAND_MIN + Math.floor(rand() * (CRYSTALS_PER_ISLAND_MAX - CRYSTALS_PER_ISLAND_MIN + 1));

  const crystals = [];
  for (let i = 0; i < count; i++) {
    // Scattered just above the island's surface, roughly following its
    // ellipsoid silhouette (same squash factor terrain.js/main.js use).
    const angle = rand() * Math.PI * 2;
    const heightFrac = 0.3 + rand() * 0.6;
    const surfaceR = island.radius * (0.75 + rand() * 0.35);

    crystals.push({
      id: `${island.id}-crystal-${i}`,
      islandId: island.id,
      position: {
        x: island.position.x + Math.cos(angle) * surfaceR,
        y: island.position.y + (island.height / 1.6) * heightFrac,
        z: island.position.z + Math.sin(angle) * surfaceR,
      },
      color: island.color,
    });
  }
  return crystals;
}

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
  // handful active at once (2-4 per island).
  const light = new THREE.PointLight(crystal.color, 0.6, 8);
  light.position.copy(mesh.position);
  scene.add(light);

  return { id: crystal.id, mesh, light, spinSeed: Math.random() * Math.PI * 2 };
}

function updateCrystalMesh(handle, elapsed) {
  handle.mesh.rotation.y = elapsed * 0.6 + handle.spinSeed;
  handle.mesh.rotation.x = Math.sin(elapsed * 0.4 + handle.spinSeed) * 0.15;
  const bob = Math.sin(elapsed * 1.1 + handle.spinSeed) * 0.12;
  handle.mesh.position.y = handle.mesh.userData.baseY ?? (handle.mesh.userData.baseY = handle.mesh.position.y);
  handle.mesh.position.y = handle.mesh.userData.baseY + bob;
}

function disposeCrystalMesh(scene, handle) {
  scene.remove(handle.mesh);
  scene.remove(handle.light);
  handle.mesh.geometry.dispose();
  handle.mesh.material.dispose();
}

export { generateCrystalsForIsland, createCrystalMesh, updateCrystalMesh, disposeCrystalMesh, CRYSTAL_RADIUS };
