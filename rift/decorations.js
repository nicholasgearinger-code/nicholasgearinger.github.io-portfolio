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
  const roll = seedRand();
  switch (biome) {
    case "ember": return roll < 0.72 ? createSpire(colorHex, seedRand) : createRockCluster(biome, colorHex, seedRand);
    case "verdant":
      if (roll < 0.35) return createLivingTree(colorHex, seedRand);
      if (roll < 0.78) return createFloraStalk(colorHex, seedRand);
      return createRockCluster(biome, colorHex, seedRand);
    case "crystal": return roll < 0.72 ? createCrystalCluster(colorHex, seedRand) : createRockCluster(biome, colorHex, seedRand);
    case "abyssal":
      if (roll < 0.25) return createCaveMouth(colorHex, seedRand);
      if (roll < 0.72) return createDebris(colorHex, seedRand);
      return createRockCluster(biome, colorHex, seedRand);
    case "ashen": return roll < 0.62 ? createDeadTree(colorHex, seedRand) : createRockCluster(biome, colorHex, seedRand);
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

// A small cluster of irregular ground-sitting rocks — usable across every
// biome as plain ground texture, distinct from Abyssal's hovering debris
// (this sits still and low) and from the more vivid focal decorations
// (spires, crystal clusters). Color is a muted blend toward gray rather
// than the biome's full accent color, so these read as background texture
// and don't compete with the actual focal points.
function createRockCluster(biome, colorHex, rand) {
  const group = new THREE.Group();
  const tint = new THREE.Color(colorHex).lerp(new THREE.Color(0x555248), 0.65);
  const mat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.95, flatShading: true });
  const count = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const scale = 0.4 + rand() * 0.9;
    const geo = new THREE.IcosahedronGeometry(scale, 0);
    const pos = geo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const k = 0.8 + rand() * 0.4;
      pos.setXYZ(v, pos.getX(v) * k, pos.getY(v) * k * 0.7, pos.getZ(v) * k); // squashed vertically — reads as a settled rock, not a floating boulder
    }
    geo.computeVertexNormals();
    const rock = new THREE.Mesh(geo, mat);
    const angle = rand() * Math.PI * 2, dist = rand() * 1.3;
    rock.position.set(Math.cos(angle) * dist, scale * 0.35, Math.sin(angle) * dist);
    rock.rotation.set(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4);
    group.add(rock);
  }
  return { group, kind: "rockCluster" };
}

// An actual tree — trunk plus a cluster of overlapping foliage spheres —
// distinct from the bioluminescent flora stalk: ordinary green canopy,
// not glowing, so Verdant Hollow reads as a mix of alien flora and
// familiar-looking trees rather than one repeated motif.
function createLivingTree(colorHex, rand) {
  const group = new THREE.Group();
  const h = 4 + rand() * 4;
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.9, flatShading: true });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, h, 6), trunkMat);
  trunk.position.y = h / 2;
  group.add(trunk);

  const leafBase = new THREE.Color(0x2f7a3a);
  const leafMat = new THREE.MeshStandardMaterial({ color: leafBase, roughness: 0.85, flatShading: true });
  const clumps = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < clumps; i++) {
    const scale = 1.1 + rand() * 1.1;
    const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(scale, 0), leafMat);
    const angle = rand() * Math.PI * 2, dist = rand() * 0.9;
    foliage.position.set(Math.cos(angle) * dist, h * (0.78 + rand() * 0.22), Math.sin(angle) * dist);
    group.add(foliage);
  }
  return { group, kind: "tree", bobAmplitude: 0.02, bobSeed: rand() * Math.PI * 2 };
}

// A dark opening set into a rock outcrop, implying a cave system beneath
// Abyssal Drift's chasms without needing actual walkable interior
// geometry — the rock silhouette plus an unlit dark "hole" mesh in front
// of it is the standard cheap way to sell a cave mouth.
function createCaveMouth(colorHex, rand) {
  const group = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x2e2b38, roughness: 0.9, flatShading: true });
  const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4 + rand() * 1.2, 0), rockMat);
  rock.scale.set(1.3, 0.9, 1);
  rock.position.y = 1.4;
  group.add(rock);

  const mouthMat = new THREE.MeshBasicMaterial({ color: 0x040308 });
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.9 + rand() * 0.4, 12), mouthMat);
  mouth.position.set(0, 1.1, rock.geometry.parameters.radius * 0.75);
  group.add(mouth);

  // A faint colored glow just inside the opening — something down there,
  // never explained, matching the zone's general "never finished falling"
  // unease rather than lighting the mouth up like an invitation.
  const light = new THREE.PointLight(colorHex, 0.35, 5);
  light.position.copy(mouth.position);
  group.add(light);
  return { group, kind: "caveMouth" };
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
  } else if (handle.kind === "tree") {
    handle.group.rotation.z = Math.sin(elapsed * 0.5 + handle.bobSeed) * handle.bobAmplitude;
  } else if (handle.kind === "debris") {
    handle.group.position.y = handle.baseY + handle.hoverHeight + Math.sin(elapsed * 0.6 + handle.bobSeed) * handle.bobAmplitude;
    handle.group.rotation.y += handle.spinRate * 0.016;
  }
}

export { createDecoration, updateDecoration };
