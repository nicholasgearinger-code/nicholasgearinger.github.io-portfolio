import * as THREE from "three";
import { getGraphicsSettings } from "./graphicsSettings.js";

// -----------------------------------------------------------------------------
// SWAP POINT: distant horizon silhouettes — large faceted shapes clustered
// into ridges at three depths beyond the playable terrain. Layered
// flat-illustration mountain-range look: a dark distant ridge, a warmer
// mid ridge, warm low foreground hills closest of all, and a pale
// two-tone highlight on just the tallest peak in each ridge. Each biome's
// three depth colors and highlight color are pulled toward that biome's
// OWN established palette (see farTint/capColor below) rather than a
// single universal tint — Ember's mountains should stay dark violet/rust
// leaning amber, not drift cool/blue the way a shared tint would.
// Swap SILHOUETTE_STYLE for a different profile/color per biome. No
// update function needed — these are static, purely a backdrop.
// -----------------------------------------------------------------------------

const SILHOUETTE_STYLE = {
  // Ember Reach's own established palette (see landmarks.js's lava vein
  // core color #ff6a14 and terrain.js's HEIGHT_PALETTE.ember valley/rust
  // tones): true near-black background, warming through a dark red
  // midground into a vivid orange-red foreground and highlight — pulled
  // off the violet undertone from the previous pass, which leaned too
  // close to the volcano cone's own accent rather than the biome's
  // dominant black/red/orange lava-and-ash color story.
  ember: { count: 10, color: 0x1a0806, minH: 30, maxH: 70, jagged: true, capColor: 0xff6a14, farTint: 0x0d0403 },
  verdant: { count: 8, color: 0x0e1a14, minH: 18, maxH: 38, jagged: false, capColor: 0xbfe0c8, farTint: 0x0a2430 },
  crystal: { count: 9, color: 0x10161e, minH: 25, maxH: 55, jagged: true, capColor: 0xcfe8ff, farTint: 0x1a1a3a },
  abyssal: { count: 7, color: 0x0a0810, minH: 20, maxH: 45, jagged: true, capColor: 0x9a7ab0, farTint: 0x140a1e },
  ashen: { count: 6, color: 0x161310, minH: 12, maxH: 28, jagged: false, capColor: 0xe8d8ae, farTint: 0x2a2010 },
};

const RING_RADIUS = 340; // well beyond WORLD_BOUND_RADIUS and the terrain's own falloff rim, inside the fog's effective range so it fades in rather than popping
const MID_RING_RADIUS = 230; // closer ring for real parallax depth
// A third, closest layer — low warm foreground hills. WORLD_BOUND_RADIUS
// (the player's actual movement limit) is TERRAIN_SIZE/2*0.93 = ~112 — 165
// clears that with real margin (~48% more) while still reading as
// noticeably closer than the mid ring.
const NEAR_RING_RADIUS = 165;

// Returns a plain hex number (not a THREE.Color instance) so it stays a
// drop-in replacement anywhere a style color is normally used elsewhere
// in this file.
function lerpHexColor(hexA, hexB, t) {
  return new THREE.Color(hexA).lerp(new THREE.Color(hexB), t).getHex();
}

// A fixed, not-tied-to-day/night light direction for the facet shading
// below — the reference's dramatic light/shadow facets stay consistent
// at any time of day this way, rather than the whole horizon going flat
// black at night if this were coupled to the real sun.
const SILHOUETTE_LIGHT_DIR = new THREE.Vector3(0.45, 0.75, 0.35).normalize();

// Bakes real hard-edged faceted shading into a peak's vertex colors —
// dark shadow facets vs lighter sun-facing facets, the "jagged details
// and shading" look of low-poly illustrated mountains, instead of one
// flat silhouette color. The trick: geo.toNonIndexed() duplicates each
// face's vertices so they're no longer shared with neighboring faces,
// so a subsequent computeVertexNormals() gives each vertex its OWN face's
// normal instead of an average blended across adjacent faces — that's
// what produces genuinely hard facet edges rather than a smooth gradient.
// `capStrength` > 0 additionally blends the biome's capColor in near the
// tip (only passed for the one hero peak per cluster); 0 means a plain
// faceted peak with no highlight.
function computeFacetShading(geo, bodyColorHex, capColorHex, capStrength) {
  const nonIndexed = geo.toNonIndexed();
  nonIndexed.computeVertexNormals();
  const pos = nonIndexed.attributes.position;
  const norm = nonIndexed.attributes.normal;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const range = Math.max(maxY - minY, 1e-6);
  const baseColor = new THREE.Color(bodyColorHex);
  const shadowColor = baseColor.clone().multiplyScalar(0.5);
  const litColor = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.22);
  const capColor = capStrength > 0 && capColorHex != null ? new THREE.Color(capColorHex) : null;
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const litAmount = THREE.MathUtils.clamp(
      norm.getX(i) * SILHOUETTE_LIGHT_DIR.x + norm.getY(i) * SILHOUETTE_LIGHT_DIR.y + norm.getZ(i) * SILHOUETTE_LIGHT_DIR.z,
      -1, 1
    );
    tmp.copy(shadowColor).lerp(litColor, (litAmount + 1) / 2);
    if (capColor) {
      const heightT = (pos.getY(i) - minY) / range;
      const capT = Math.max(0, (heightT - (1 - capStrength)) / capStrength);
      tmp.lerp(capColor, capT);
    }
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  nonIndexed.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return nonIndexed;
}

// Pushes each vertex's radius in/out slightly at random — the same
// "rugged, not perfectly conical" trick landmarks.js's volcano cone uses.
// Adds real irregularity to the silhouette EDGE itself, on top of the
// baseRadius/segment-count variety already covered elsewhere. Eases off
// near the very tip so it doesn't reopen the collapsed apex point.
function jitterConeSilhouette(geo, height, amount) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const heightT = (y + height / 2) / height;
    const taper = 1 - heightT * 0.7;
    const jitter = 1 + (Math.random() - 0.5) * amount * taper;
    pos.setX(i, x * jitter);
    pos.setZ(i, z * jitter);
  }
  pos.needsUpdate = true;
}

// Leans a peak's summit off-center instead of leaving it perfectly
// symmetric. Every ConeGeometry's "tip" is actually a ring of coincident
// vertices sitting at y=height/2 (radiusTop=0 collapses them all to the
// same point) — nudging all of them by the same offset tilts the whole
// peak's axis, which is what real mountains look like far more often
// than a perfectly centered summit.
function skewApex(geo, height, maxOffset) {
  const pos = geo.attributes.position;
  const dx = (Math.random() - 0.5) * maxOffset;
  const dz = (Math.random() - 0.5) * maxOffset;
  const topY = height / 2;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getY(i) - topY) < 1e-4) {
      pos.setX(i, pos.getX(i) + dx);
      pos.setZ(i, pos.getZ(i) + dz);
    }
  }
  pos.needsUpdate = true;
}

// `capColorHex` + `isCenterPeak` are optional — pass null/false for a
// plain faceted peak with no highlight (every shoulder/companion peak,
// and the whole near/foreground layer, which isn't meant to have
// dramatic lit peaks — every peak still gets real facet shading either
// way, just not the extra cap tint).
function createSilhouetteShape(colorHex, height, jagged, capColorHex, isCenterPeak) {
  // Was a narrow 0.5-0.9 range and a fixed 5-7/flat-8 segment count —
  // every peak came out with nearly identical proportions. Widening both
  // ranges gives real variety: some peaks spiky and narrow, others
  // broad-shouldered, some sharply faceted, others smoother.
  const baseRadius = height * (0.3 + Math.random() * 1.1);
  const radialSegments = jagged ? 4 + Math.floor(Math.random() * 6) : 7 + Math.floor(Math.random() * 4);
  const geo = jagged
    ? new THREE.ConeGeometry(baseRadius, height, radialSegments)
    : new THREE.ConeGeometry(baseRadius * 1.4, height, radialSegments, 1, false); // wider base, rounder-feeling silhouette for gentle hills
  jitterConeSilhouette(geo, height, jagged ? 0.22 : 0.1); // rugged jagged edge on sharp peaks, gentler ripple on rounded hills
  skewApex(geo, height, baseRadius * 0.5);
  const shadedGeo = computeFacetShading(geo, colorHex, capColorHex, isCenterPeak ? 0.4 + Math.random() * 0.2 : 0);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  const mesh = new THREE.Mesh(shadedGeo, mat);
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

      // Twin companion sub-peak — real ridgelines often have a smaller
      // shoulder summit fused right against a bigger one. Occasionally
      // adding one here is cheap extra silhouette variety on top of the
      // shape variance above, without needing a second geometry system.
      if (Math.random() < 0.28) {
        const companionHeight = height * (0.35 + Math.random() * 0.35);
        const companionAngle = angle + (Math.random() - 0.5) * 0.05;
        const companionR = r + (Math.random() - 0.5) * 10;
        const companion = createSilhouetteShape(colorHex, companionHeight, style.jagged, null, false);
        companion.position.x = Math.cos(companionAngle) * companionR;
        companion.position.z = Math.sin(companionAngle) * companionR;
        group.add(companion);
      }
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

  // Far layer: darkest, pulled toward this biome's own farTint. Cluster
  // count doubled (1.15 -> 2.3) per request — more mountains in the
  // background.
  const farColor = lerpHexColor(style.color, style.farTint, 0.55);
  group.add(buildSilhouetteRing(style, RING_RADIUS, 2.3, 1, farColor, style.capColor));

  // Mid layer: warmer, leaning toward the biome's own capColor rather
  // than staying near-black or (as before) toward an unrelated hue.
  const midColor = lerpHexColor(style.color, style.capColor, 0.28);
  group.add(buildSilhouetteRing(style, MID_RING_RADIUS, 0.75, 0.8, midColor, style.capColor));

  // Near layer: warm low foreground hills, closest and lowest of the
  // three. Cluster count doubled (0.5 -> 1.0) per request — more
  // mountains in the foreground. Always rounded regardless of the
  // biome's usual jagged/rounded profile — this is meant to read as
  // gentle foreground land, not more peaks; no highlight cap either,
  // that drama belongs to the peaks behind it.
  const nearStyle = { ...style, jagged: false };
  const nearColor = lerpHexColor(style.color, style.capColor, 0.5);
  group.add(buildSilhouetteRing(nearStyle, NEAR_RING_RADIUS, 1.0, 0.45, nearColor, null));

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
