import * as THREE from "three";
import { getGraphicsSettings } from "./graphicsSettings.js";

// -----------------------------------------------------------------------------
// SWAP POINT: distant horizon silhouettes — large faceted shapes clustered
// into ridges at three depths beyond the playable terrain. Was originally
// one flat near-black silhouette color per biome; now a layered
// flat-illustration mountain-range look matching the reference (a cool
// slate peak behind, a warm sunlit peak in front, warm low foreground
// hills closest of all, and a pale two-tone highlight on just the tallest
// peak in each ridge) instead of pure dark cutouts. Swap SILHOUETTE_STYLE
// for a different profile/color per biome. No update function needed —
// these are static, purely a backdrop.
// -----------------------------------------------------------------------------

const SILHOUETTE_STYLE = {
  ember: { count: 10, color: 0x1a0e0c, minH: 30, maxH: 70, jagged: true, capColor: 0xe8b98a },   // sharp volcanic peaks, warm sunlit cap
  verdant: { count: 8, color: 0x0e1a14, minH: 18, maxH: 38, jagged: false, capColor: 0xbfe0c8 }, // soft rolling hills, pale green cap
  crystal: { count: 9, color: 0x10161e, minH: 25, maxH: 55, jagged: true, capColor: 0xcfe8ff },  // angular crystal formations, icy cap
  abyssal: { count: 7, color: 0x0a0810, minH: 20, maxH: 45, jagged: true, capColor: 0x9a7ab0 },  // broken, uneven, pale violet cap
  ashen: { count: 6, color: 0x161310, minH: 12, maxH: 28, jagged: false, capColor: 0xe8d8ae },   // low, worn-down dunes, sandy cap
};

const RING_RADIUS = 340; // well beyond WORLD_BOUND_RADIUS and the terrain's own falloff rim, inside the fog's effective range so it fades in rather than popping
const MID_RING_RADIUS = 230; // closer ring for real parallax depth
// A third, closest layer — low warm foreground hills, the way the
// reference's front-most tan ridge sits well in front of the two peaks
// behind it. WORLD_BOUND_RADIUS (the player's actual movement limit) is
// TERRAIN_SIZE/2*0.93 = ~112 — 165 clears that with real margin (~48%
// more) while still reading as noticeably closer than the mid ring.
const NEAR_RING_RADIUS = 165;

// Returns a plain hex number (not a THREE.Color instance) so it stays a
// drop-in replacement anywhere a style color is normally used elsewhere
// in this file/project.
function lerpHexColor(hexA, hexB, t) {
  return new THREE.Color(hexA).lerp(new THREE.Color(hexB), t).getHex();
}

// Paints a two-tone vertical gradient onto a cone's own vertex colors —
// dark body rising to a pale/warm highlight near the tip, the same "flat
// illustration" per-vertex-gradient technique used elsewhere in this
// project (terrain.js's height palette, decorations.js's rock rim tint).
// `capStrength` controls how far down from the tip the highlight reaches.
function paintPeakGradient(geo, bodyColorHex, capColorHex, capStrength) {
  const pos = geo.attributes.position;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const range = Math.max(maxY - minY, 1e-6);
  const bodyColor = new THREE.Color(bodyColorHex);
  const capColor = new THREE.Color(capColorHex);
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) / range;
    const capT = Math.max(0, (t - (1 - capStrength)) / capStrength);
    tmp.copy(bodyColor).lerp(capColor, capT);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

// `capColorHex` + `isCenterPeak` are optional — pass null/false for a
// plain flat-colored peak (every shoulder peak, and the whole near/
// foreground layer, which isn't meant to have dramatic lit peaks).
function createSilhouetteShape(colorHex, height, jagged, capColorHex, isCenterPeak) {
  const baseRadius = height * (0.5 + Math.random() * 0.4);
  const geo = jagged
    ? new THREE.ConeGeometry(baseRadius, height, 5 + Math.floor(Math.random() * 3))
    : new THREE.ConeGeometry(baseRadius * 1.4, height, 8, 1, false); // wider base, rounder-feeling silhouette for gentle hills
  let mat;
  if (isCenterPeak && capColorHex != null) {
    // Only the tallest peak in each cluster gets the highlight — the
    // reference's drama comes from ONE lit peak standing out among
    // darker silhouettes around it, not every peak glowing equally.
    paintPeakGradient(geo, colorHex, capColorHex, 0.4 + Math.random() * 0.2);
    mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  } else {
    mat = new THREE.MeshBasicMaterial({ color: colorHex, fog: true });
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = height / 2 - 4; // sunk slightly so the base isn't a visible flat cut line against the terrain
  mesh.rotation.y = Math.random() * Math.PI * 2;
  return mesh;
}

// Builds one ring of ridge CLUSTERS at a given radius/color — factored out
// so the three depth layers share identical placement logic and only
// differ in radius, count, size, and color, rather than risking three
// subtly-different copies of the same loop drifting apart over time.
//
// Each cluster is several peaks packed into a tight angular span (tight
// enough that their cone bases genuinely overlap at this radius), tallest
// near the cluster's center and tapering to lower shoulder peaks at its
// edges — a real mountain range reads as a handful of connected ridges
// with one or two standout peaks each, not a row of identical evenly-
// spaced standalone triangles with open sky between every single one.
// Gaps are left between CLUSTERS instead, which is what actually looks
// like separate ranges on the horizon rather than one solid wall.
function buildSilhouetteRing(style, radius, countScale, heightScale, colorHex, capColorHex) {
  const clusterCount = Math.max(1, Math.round((style.count / 4) * countScale * getGraphicsSettings().silhouetteMultiplier));
  const group = new THREE.Group();
  for (let c = 0; c < clusterCount; c++) {
    const clusterAngle = (c / clusterCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const peaksInCluster = 3 + Math.floor(Math.random() * 3); // 3-5 peaks per ridge
    const clusterSpread = 0.14 + Math.random() * 0.06; // tight — this is what makes bases overlap
    const centerIdx = Math.floor(peaksInCluster / 2); // which slot gets the optional highlight cap
    for (let p = 0; p < peaksInCluster; p++) {
      const pt = peaksInCluster > 1 ? p / (peaksInCluster - 1) : 0.5;
      const angle = clusterAngle + (pt - 0.5) * clusterSpread;
      const r = radius + (Math.random() - 0.5) * 40;
      // 1 (dead center of the cluster) down to ~0.4 at the shoulders — a
      // real tall peak or two flanked by lower ridge, not uniform height.
      const centerBias = 1 - Math.abs(pt - 0.5) * 1.2;
      const height = (style.minH + Math.random() * (style.maxH - style.minH)) * heightScale * (0.55 + centerBias * 0.6);
      const shape = createSilhouetteShape(colorHex, height, style.jagged, capColorHex, p === centerIdx);
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

  // Far layer: cool and dark — the reference's back-most slate-blue peak.
  // Slightly more clusters than before ("more of those").
  const farColor = lerpHexColor(style.color, 0x1c2a3a, 0.18);
  group.add(buildSilhouetteRing(style, RING_RADIUS, 1.15, 1, farColor, style.capColor));

  // Mid layer: noticeably warmer, leaning toward the cap color itself
  // rather than staying near-black — the reference's sunlit front peak.
  const midColor = lerpHexColor(style.color, style.capColor, 0.28);
  group.add(buildSilhouetteRing(style, MID_RING_RADIUS, 0.75, 0.8, midColor, style.capColor));

  // Near layer (new): warm low foreground hills, closest and lowest of
  // the three — the reference's front-most tan/olive ridge. Always
  // rounded regardless of the biome's usual jagged/rounded profile, since
  // this is meant to read as gentle foreground land, not more peaks; no
  // highlight cap either, that drama belongs to the peaks behind it.
  const nearStyle = { ...style, jagged: false };
  const nearColor = lerpHexColor(style.color, style.capColor, 0.45);
  group.add(buildSilhouetteRing(nearStyle, NEAR_RING_RADIUS, 0.5, 0.45, nearColor, null));

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
