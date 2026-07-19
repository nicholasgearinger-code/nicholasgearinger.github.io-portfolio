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
// A second, closer ring for real parallax depth — same per-biome
// silhouette style, fewer/smaller shapes at a nearer radius. With only
// one ring, the whole horizon reads as one flat painted backdrop no
// matter how the player moves; a second layer at a different distance
// visibly slides past the far ring at a different rate as the player
// walks/turns, which is what actually sells depth. 230 sits comfortably
// beyond the ~240-unit landmass's own edge (well over half again its
// radius of clearance) while still being noticeably nearer than the far
// ring at 340.
const MID_RING_RADIUS = 230;

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

// Builds one ring of ridge CLUSTERS at a given radius — factored out so
// the far and mid rings share identical placement logic and only differ
// in radius, count, and size, rather than risking two subtly-different
// copies of the same loop drifting apart over time.
//
// Each cluster is several peaks packed into a tight angular span (tight
// enough that their cone bases genuinely overlap at this radius), tallest
// near the cluster's center and tapering to lower shoulder peaks at its
// edges — a real mountain range reads as a handful of connected ridges
// with one or two standout peaks each, not a row of identical evenly-
// spaced standalone triangles with open sky between every single one.
// Gaps are left between CLUSTERS instead, which is what actually looks
// like separate ranges on the horizon rather than one solid wall.
function buildSilhouetteRing(style, radius, countScale, heightScale) {
  const clusterCount = Math.max(1, Math.round((style.count / 4) * countScale * getGraphicsSettings().silhouetteMultiplier));
  const group = new THREE.Group();
  for (let c = 0; c < clusterCount; c++) {
    const clusterAngle = (c / clusterCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const peaksInCluster = 3 + Math.floor(Math.random() * 3); // 3-5 peaks per ridge
    const clusterSpread = 0.14 + Math.random() * 0.06; // tight — this is what makes bases overlap
    for (let p = 0; p < peaksInCluster; p++) {
      const pt = peaksInCluster > 1 ? p / (peaksInCluster - 1) : 0.5;
      const angle = clusterAngle + (pt - 0.5) * clusterSpread;
      const r = radius + (Math.random() - 0.5) * 40;
      // 1 (dead center of the cluster) down to ~0.4 at the shoulders — a
      // real tall peak or two flanked by lower ridge, not uniform height.
      const centerBias = 1 - Math.abs(pt - 0.5) * 1.2;
      const height = (style.minH + Math.random() * (style.maxH - style.minH)) * heightScale * (0.55 + centerBias * 0.6);
      const shape = createSilhouetteShape(style.color, height, style.jagged);
      shape.position.x = Math.cos(angle) * r;
      shape.position.z = Math.sin(angle) * r;
      group.add(shape);
    }
  }
  return group;
}

/**
 * @param {THREE.Scene} scene
 * @param {string} biome
 */
function createHorizonSilhouettes(scene, biome) {
  const style = SILHOUETTE_STYLE[biome] || SILHOUETTE_STYLE.ember;
  const group = new THREE.Group();
  group.add(buildSilhouetteRing(style, RING_RADIUS, 1, 1));
  // Mid ring: ~60% as many shapes, ~75% the height — a lighter foothill
  // layer in front of the big far peaks, not a second identical wall.
  group.add(buildSilhouetteRing(style, MID_RING_RADIUS, 0.6, 0.75));
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
