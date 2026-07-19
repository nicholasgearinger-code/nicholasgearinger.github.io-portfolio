import * as THREE from "three";
import { getGraphicsSettings } from "./graphicsSettings.js";

// -----------------------------------------------------------------------------
// SWAP POINT: landmarks — exactly one massive, hand-crafted structure per
// biome, placed at a fixed position rather than scattered randomly like
// every other decoration. This is the one thing in each biome that isn't
// procedural/repeating: a genuine "you'll remember seeing that" discovery,
// dwarfing regular decorations in scale, each with its own glowing energy
// core marking it as something more than scenery. Swap
// createLandmark()'s per-biome branch for a different structure without
// touching placement/energy-core mechanics.
// -----------------------------------------------------------------------------

// Fixed position per biome (not random — a landmark you can navigate
// toward and remember is the whole point) — offset from dead-center so it
// isn't directly on top of the player's spawn point.
const LANDMARK_POSITION = { x: 55, z: -70 };

function createEnergyCore(colorHex, radius, coreHeight) {
  const group = new THREE.Group();
  const coreMat = new THREE.MeshStandardMaterial({
    color: colorHex, emissive: colorHex, emissiveIntensity: 1.1, roughness: 0.3, transparent: true, opacity: 0.85,
  });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(radius, 0), coreMat);
  core.position.y = coreHeight;
  group.add(core);
  const light = new THREE.PointLight(colorHex, 1.4, radius * 14);
  light.position.y = coreHeight;
  group.add(light);
  return { group, core, light, pulseSeed: Math.random() * Math.PI * 2 };
}

// Ember: a massive obsidian monolith, taller and more elaborate than the
// regular obsidian formation decoration — thick glowing veins spiral up
// its full height instead of a few short cracks.
function createEmberLandmark(colorHex) {
  const group = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x0d0a12, roughness: 0.15, metalness: 0.35, flatShading: true });
  const h = 22;
  const tiers = 3;
  let y = 0;
  for (let i = 0; i < tiers; i++) {
    const tierH = h / tiers * (1 - i * 0.15);
    const rBottom = 3.5 * (1 - i * 0.25);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(rBottom * 0.55, rBottom, tierH, 7), rockMat);
    seg.position.y = y + tierH / 2;
    seg.rotation.y = i * 0.6;
    group.add(seg);
    y += tierH * 0.92;
  }
  const veinMat = new THREE.MeshBasicMaterial({ color: colorHex });
  for (let i = 0; i < 5; i++) {
    const veinH = h * 0.6;
    const vein = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, veinH, 4), veinMat);
    const angle = (i / 5) * Math.PI * 2;
    vein.position.set(Math.sin(angle) * 1.2, veinH / 2 + 1, Math.cos(angle) * 1.2);
    vein.rotation.z = 0.15;
    group.add(vein);
  }
  const energy = createEnergyCore(colorHex, 1.4, h * 0.85);
  group.add(energy.group);
  return { group, energy, baseY: 0 };
}

// Verdant: an ancient stone arch, reclaimed by vines and glowing flowers —
// the one place in the whole landmass that reads as "something built
// this," not grown.
function createVerdantLandmark(colorHex) {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x5c5648, roughness: 0.9, flatShading: true });
  const pillarH = 9, archSpan = 8;
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, pillarH, 6), stoneMat);
    pillar.position.set(side * archSpan / 2, pillarH / 2, 0);
    group.add(pillar);
  }
  const archTop = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, archSpan + 1.5, 6), stoneMat);
  archTop.rotation.z = Math.PI / 2;
  archTop.position.y = pillarH + 0.5;
  group.add(archTop);

  // Vines climbing the pillars, flowers dotted along them.
  const vineMat = new THREE.MeshStandardMaterial({ color: 0x2d5a2a, roughness: 0.8, flatShading: true });
  const flowerColors = [0xff8fd6, 0xffd36e, 0xc9a0ff];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const segH = 1.8;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, segH, 4), vineMat);
      seg.position.set(side * (archSpan / 2 + 0.3 + Math.random() * 0.3), i * segH + 1, 0.3);
      seg.rotation.z = (Math.random() - 0.5) * 0.3;
      group.add(seg);
      const flowerMat = new THREE.MeshStandardMaterial({
        color: flowerColors[i % flowerColors.length], emissive: colorHex, emissiveIntensity: 0.2, roughness: 0.5,
      });
      const flower = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), flowerMat);
      flower.position.copy(seg.position);
      flower.position.y += segH / 2;
      group.add(flower);
    }
  }
  const energy = createEnergyCore(colorHex, 1.1, pillarH + 1.2);
  group.add(energy.group);
  return { group, energy, baseY: 0 };
}

// Crystal: a colossal crystal spire, dwarfing the regular crystal
// clusters, faceted rather than a single smooth shape so light catches it
// from every angle.
function createCrystalLandmark(colorHex) {
  const group = new THREE.Group();
  const mainMat = new THREE.MeshStandardMaterial({
    color: colorHex, emissive: colorHex, emissiveIntensity: 0.5, roughness: 0.1, metalness: 0.15, transparent: true, opacity: 0.92,
  });
  const spire = new THREE.Mesh(new THREE.OctahedronGeometry(3.5, 0), mainMat);
  spire.scale.set(1, 3.2, 1);
  spire.position.y = 11;
  group.add(spire);
  // Smaller shards clustered at the base, same pattern as the regular
  // crystal cluster but scaled up and denser.
  for (let i = 0; i < 6; i++) {
    const s = 1.2 + Math.random() * 1.5;
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(s, 0), mainMat);
    const angle = (i / 6) * Math.PI * 2;
    shard.position.set(Math.cos(angle) * 2.2, s * 0.8, Math.sin(angle) * 2.2);
    shard.rotation.set(Math.random(), Math.random() * Math.PI, Math.random());
    group.add(shard);
  }
  const energy = createEnergyCore(colorHex, 1.6, 11);
  group.add(energy.group);
  return { group, energy, baseY: 0 };
}

// Abyssal: a broken platform hovering at a fixed height, anchored by
// nothing visible — unsettling in exactly the way the rest of the biome
// already is, just at landmark scale.
function createAbyssalLandmark(colorHex) {
  const group = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x241f30, roughness: 0.85, flatShading: true, emissive: colorHex, emissiveIntensity: 0.05 });
  const platform = new THREE.Mesh(new THREE.IcosahedronGeometry(4.5, 0), rockMat);
  platform.scale.set(1.4, 0.35, 1.4);
  platform.position.y = 9; // hovering — deliberately not touching the ground
  group.add(platform);
  // A few smaller chunks drifting near it, echoing the ambient debris
  // decoration but tethered visually to this one spot.
  for (let i = 0; i < 4; i++) {
    const s = 0.6 + Math.random() * 0.7;
    const chunk = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockMat);
    const angle = Math.random() * Math.PI * 2, dist = 3 + Math.random() * 3;
    chunk.position.set(Math.cos(angle) * dist, 9 + (Math.random() - 0.5) * 4, Math.sin(angle) * dist);
    group.add(chunk);
  }
  const energy = createEnergyCore(colorHex, 1.3, 9);
  group.add(energy.group);
  return { group, energy, baseY: 9, floats: true }; // baseY used by the update loop for its own gentle hover bob
}

// Ashen: a fossilized skeleton on a scale nothing else in this landmass
// suggests — the ribcage motif from the regular fossil-remains decoration,
// but unmistakably something enormous once lived (or fell) here.
function createAshenLandmark(colorHex) {
  const group = new THREE.Group();
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xd8cdb8, roughness: 0.9, flatShading: true });
  const spineLen = 14;
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, spineLen, 6), boneMat);
  spine.rotation.x = Math.PI / 2;
  spine.position.y = 1;
  group.add(spine);
  const ribCount = 8;
  for (let i = 0; i < ribCount; i++) {
    const t = i / (ribCount - 1);
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 4 + Math.sin(t * Math.PI) * 2.5, 5), boneMat);
    rib.position.set(0, 1.2, (t - 0.5) * spineLen);
    rib.rotation.z = Math.PI / 2.5 * (i % 2 === 0 ? 1 : -1);
    rib.rotation.y = (Math.random() - 0.5) * 0.2;
    group.add(rib);
  }
  const energy = createEnergyCore(colorHex, 1.0, 4);
  energy.group.position.z = -spineLen * 0.3; // sits within the ribcage rather than centered on the spine
  group.add(energy.group);
  return { group, energy, baseY: 0 };
}

const LANDMARK_BUILDERS = {
  ember: createEmberLandmark,
  verdant: createVerdantLandmark,
  crystal: createCrystalLandmark,
  abyssal: createAbyssalLandmark,
  ashen: createAshenLandmark,
};

/**
 * @param {THREE.Scene} scene
 * @param {string} biome
 * @param {number} colorHex  the biome's own accent color, used for the energy core/glow
 * @param {(x:number, z:number) => number|null} sampleHeight
 */
function createLandmark(scene, biome, colorHex, sampleHeight) {
  const builder = LANDMARK_BUILDERS[biome];
  if (!builder) return null;
  const built = builder(colorHex);
  const groundY = sampleHeight(LANDMARK_POSITION.x, LANDMARK_POSITION.z) ?? 0;
  built.group.position.set(LANDMARK_POSITION.x, groundY, LANDMARK_POSITION.z);
  built.baseY += groundY;
  built.group.traverse((obj) => {
    if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
  });
  scene.add(built.group);
  return built;
}

function updateLandmark(handle, elapsed) {
  if (!handle) return;
  const { energy, baseY, group } = handle;
  const pulse = 0.6 + 0.4 * Math.sin(elapsed * 1.1 + energy.pulseSeed);
  energy.core.material.emissiveIntensity = 0.7 + pulse * 0.6;
  energy.light.intensity = 0.9 + pulse * 0.9;
  energy.core.rotation.y = elapsed * 0.3;
  // Abyssal's platform gently hovers up and down — everything else stays
  // put, the ground-anchored biomes shouldn't have their landmark visibly
  // floating.
  if (handle.floats) group.position.y = baseY + Math.sin(elapsed * 0.4) * 0.6;
}

function disposeLandmark(scene, handle) {
  if (!handle) return;
  scene.remove(handle.group);
  handle.group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  });
}

export { createLandmark, updateLandmark, disposeLandmark, LANDMARK_POSITION };
