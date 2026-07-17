import * as THREE from "three";

// -----------------------------------------------------------------------------
// SWAP POINT: purely cosmetic scattered props, one distinct type per biome,
// so each landmass reads as a different kind of place at a glance and not
// just a different terrain color. None of these are collidable — they sit
// on top of the terrain wherever levels.js decided to place them (height
// sampled from the real terrain mesh once it exists, same as crystals).
// Swap createDecoration() for different geometry per biome, or add more
// variety within a biome, without touching terrain or placement logic.
// -----------------------------------------------------------------------------

function createDecoration(biome, colorHex, seedRand) {
  switch (biome) {
    case "ember": return createSpire(colorHex, seedRand);
    case "verdant": return createFloraStalk(colorHex, seedRand);
    case "crystal": return createCrystalCluster(colorHex, seedRand);
    case "abyssal": return createDebris(colorHex, seedRand);
    case "ashen": return createDeadTree(colorHex, seedRand);
    default: return createSpire(colorHex, seedRand);
  }
}

// Jagged basalt spire with a glowing tip crack.
function createSpire(colorHex, rand) {
  const group = new THREE.Group();
  const h = 5 + rand() * 6;
  const geo = new THREE.ConeGeometry(0.9 + rand() * 0.6, h, 5);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a1a16, roughness: 0.9, flatShading: true });
  const cone = new THREE.Mesh(geo, mat);
  cone.position.y = h / 2;
  cone.rotation.y = rand() * Math.PI;
  group.add(cone);

  const tipMat = new THREE.MeshBasicMaterial({ color: colorHex });
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 6), tipMat);
  tip.position.y = h * 0.92;
  group.add(tip);
  const light = new THREE.PointLight(colorHex, 0.5, 6);
  light.position.y = h * 0.92;
  group.add(light);
  return { group, kind: "spire" };
}

// Bioluminescent flora stalk — tapered stem with a glowing cap.
function createFloraStalk(colorHex, rand) {
  const group = new THREE.Group();
  const h = 2.5 + rand() * 3.5;
  const geo = new THREE.CylinderGeometry(0.06, 0.16, h, 6);
  const mat = new THREE.MeshStandardMaterial({ color: 0x123322, roughness: 0.7, flatShading: true });
  const stem = new THREE.Mesh(geo, mat);
  stem.position.y = h / 2;
  stem.rotation.z = (rand() - 0.5) * 0.3;
  group.add(stem);

  const capMat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 0.8, roughness: 0.4 });
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.32 + rand() * 0.2, 8, 8), capMat);
  cap.position.y = h;
  group.add(cap);
  return { group, kind: "stalk", bobAmplitude: 0.15 + rand() * 0.1, bobSeed: rand() * Math.PI * 2 };
}

// Natural-looking cluster of angular crystal shards at varying scale.
function createCrystalCluster(colorHex, rand) {
  const group = new THREE.Group();
  const count = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const scale = 0.8 + rand() * 1.8;
    const geo = new THREE.OctahedronGeometry(scale, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex, emissive: colorHex, emissiveIntensity: 0.35,
      roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.9,
    });
    const shard = new THREE.Mesh(geo, mat);
    const angle = rand() * Math.PI * 2, dist = rand() * 1.4;
    shard.position.set(Math.cos(angle) * dist, scale * 0.75, Math.sin(angle) * dist);
    shard.rotation.set(rand() * 0.6, rand() * Math.PI * 2, rand() * 0.6);
    group.add(shard);
  }
  return { group, kind: "crystalCluster" };
}

// Irregular rock chunk that hovers and slowly drifts just above the ground
// — reads as unstable/anti-gravity, fitting the Abyssal Drift theme.
function createDebris(colorHex, rand) {
  const group = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(0.8 + rand() * 1.1, 0);
  // Irregular shape: nudge vertices outward randomly so it doesn't read as
  // a perfect icosahedron.
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = 0.85 + rand() * 0.3;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.85, flatShading: true, emissive: colorHex, emissiveIntensity: 0.08 });
  const rock = new THREE.Mesh(geo, mat);
  group.add(rock);
  return { group, kind: "debris", hoverHeight: 1.2 + rand() * 1.5, bobAmplitude: 0.3 + rand() * 0.3, bobSeed: rand() * Math.PI * 2, spinRate: (rand() - 0.5) * 0.3 };
}

// Bare, branching skeletal tree silhouette.
function createDeadTree(colorHex, rand) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 0.95, flatShading: true });
  const h = 3 + rand() * 3;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, h, 5), mat);
  trunk.position.y = h / 2;
  group.add(trunk);
  const branchCount = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < branchCount; i++) {
    const branchH = h * (0.35 + rand() * 0.3);
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.08, branchH, 4), mat);
    const along = h * (0.4 + rand() * 0.55);
    branch.position.set(0, along, 0);
    branch.rotation.z = (rand() - 0.5) * 1.4;
    branch.rotation.y = rand() * Math.PI * 2;
    branch.position.x += Math.sin(branch.rotation.z) * branchH * 0.4;
    group.add(branch);
  }
  return { group, kind: "deadTree" };
}

function updateDecoration(handle, elapsed) {
  if (handle.kind === "stalk") {
    handle.group.scale.setScalar(1 + Math.sin(elapsed * 1.4 + handle.bobSeed) * handle.bobAmplitude * 0.06);
  } else if (handle.kind === "debris") {
    handle.group.position.y = handle.baseY + handle.hoverHeight + Math.sin(elapsed * 0.6 + handle.bobSeed) * handle.bobAmplitude;
    handle.group.rotation.y += handle.spinRate * 0.016;
  }
}

export { createDecoration, updateDecoration };
