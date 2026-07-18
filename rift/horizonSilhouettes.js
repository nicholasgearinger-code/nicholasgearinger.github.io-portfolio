import * as THREE from "three";
import { getGraphicsSettings } from "./graphicsSettings.js";

// -----------------------------------------------------------------------------
// SWAP POINT: distant horizon silhouettes — large faceted shapes scattered
// in a ring well beyond the playable terrain, dark and flat-shaded so they
// read purely as silhouette against the sky rather than competing with
// anything nearby. The point isn't detail, it's letting the world imply
// it keeps going past the fog line instead of visibly ending in a wall of
// haze. Swap SILHOUETTE_STYLE for a different profile/color per biome.
// No update function needed — these are static, purely a backdrop.
// -----------------------------------------------------------------------------

const SILHOUETTE_STYLE = {
  ember: { count: 10, color: 0x1a0e0c, minH: 30, maxH: 70, jagged: true },   // sharp volcanic peaks
  verdant: { count: 8, color: 0x0e1a14, minH: 18, maxH: 38, jagged: false }, // soft rolling hills
  crystal: { count: 9, color: 0x10161e, minH: 25, maxH: 55, jagged: true },  // angular crystal formations
  abyssal: { count: 7, color: 0x0a0810, minH: 20, maxH: 45, jagged: true },  // broken, uneven — chasm walls continuing into the distance
  ashen: { count: 6, color: 0x161310, minH: 12, maxH: 28, jagged: false },   // low, worn-down dunes
};

const RING_RADIUS = 340; // well beyond WORLD_BOUND_RADIUS and the terrain's own falloff rim, inside the fog's effective range so it fades in rather than popping

function createSilhouetteShape(color, height, jagged) {
  const baseRadius = height * (0.5 + Math.random() * 0.4);
  const geo = jagged
    ? new THREE.ConeGeometry(baseRadius, height, 5 + Math.floor(Math.random() * 3))
    : new THREE.ConeGeometry(baseRadius * 1.4, height, 8, 1, false); // wider base, rounder-feeling silhouette for gentle hills
  const mat = new THREE.MeshBasicMaterial({ color, fog: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = height / 2 - 4; // sunk slightly so the base isn't a visible flat cut line against the terrain
  mesh.rotation.y = Math.random() * Math.PI * 2;
  return mesh;
}

/**
 * @param {THREE.Scene} scene
 * @param {string} biome
 */
function createHorizonSilhouettes(scene, biome) {
  const style = SILHOUETTE_STYLE[biome] || SILHOUETTE_STYLE.ember;
  const count = Math.max(1, Math.round(style.count * getGraphicsSettings().silhouetteMultiplier));
  const group = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const radius = RING_RADIUS + (Math.random() - 0.5) * 60;
    const height = style.minH + Math.random() * (style.maxH - style.minH);
    const shape = createSilhouetteShape(style.color, height, style.jagged);
    shape.position.x += Math.cos(angle) * radius;
    shape.position.z += Math.sin(angle) * radius;
    group.add(shape);
  }
  scene.add(group);
  return { group };
}

function disposeHorizonSilhouettes(scene, handle) {
  if (!handle) return;
  scene.remove(handle.group);
  handle.group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  });
}

export { createHorizonSilhouettes, disposeHorizonSilhouettes };
