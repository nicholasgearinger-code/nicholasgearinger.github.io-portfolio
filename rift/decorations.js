import * as THREE from "three";
import { getGraphicsSettings } from "./graphicsSettings.js";

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
  const highDetail = getGraphicsSettings().decorationDetail >= 2;
  // High-tier-exclusive signature piece per biome — not just "more
  // polygons of the same prop," a genuinely different shape that only
  // High actually renders. Rolled first so it doesn't skew the existing
  // biome's usual prop-mix odds when High isn't active.
  if (highDetail && seedRand() < 0.22) {
    switch (biome) {
      case "ember": return createObsidianFormation(colorHex, seedRand);
      case "verdant": return createBloomingVine(colorHex, seedRand);
      case "crystal": return createGeode(colorHex, seedRand);
      case "abyssal": return createStalagmite(colorHex, seedRand);
      case "ashen": return createFossilRemains(colorHex, seedRand);
    }
  }
  // A small flat marker etched with glowing alien glyphs — "something
  // else was here" environmental storytelling, universal across every
  // biome rather than being its own per-biome variant, since the point is
  // that these show up in unexpected/inconsistent places.
  if (seedRand() < 0.1) return createGlyphMarker(colorHex, seedRand);
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
  const sphereSeg = 6 + getGraphicsSettings().decorationDetail * 4;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.35, sphereSeg, sphereSeg), tipMat);
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
  const capSeg = 8 + getGraphicsSettings().decorationDetail * 4;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.32 + rand() * 0.2, capSeg, capSeg), capMat);
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
    const geo = new THREE.OctahedronGeometry(scale, 0); // rocks/crystals deliberately stay at their sharpest/blockiest form at every tier — smoothing them fights the low-poly art style and wastes polygon budget on something that looks worse rounded
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
  const geo = new THREE.IcosahedronGeometry(0.8 + rand() * 1.1, 0); // rock — stays blocky, see note on the crystal cluster above
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
    const geo = new THREE.IcosahedronGeometry(scale, 0); // rock — stays blocky, see note on the crystal cluster above
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
    const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(scale, getGraphicsSettings().decorationDetail), leafMat);
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
  const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4 + rand() * 1.2, 0), rockMat); // rock — stays blocky, see note on the crystal cluster above
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

// -----------------------------------------------------------------------------
// High-tier-exclusive signature pieces — one genuinely distinct shape per
// biome, not a denser version of an existing prop. Gated behind
// getGraphicsSettings().decorationDetail in createDecoration() above.
// -----------------------------------------------------------------------------

// Ember: glassy black obsidian with thin glowing crack-veins running
// across its facets — reads as freshly-cooled volcanic glass, distinct
// from the spire's rough basalt.
function createObsidianFormation(colorHex, rand) {
  const group = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x0d0a12, roughness: 0.15, metalness: 0.3, flatShading: true });
  const h = 3 + rand() * 4;
  const rock = new THREE.Mesh(new THREE.ConeGeometry(0.7 + rand() * 0.5, h, 6), rockMat);
  rock.position.y = h / 2;
  rock.rotation.y = rand() * Math.PI * 2;
  rock.rotation.z = (rand() - 0.5) * 0.25;
  group.add(rock);

  // Thin glowing crack lines up the surface — a few short emissive
  // cylinders standing in for veins, not a real crack-texture map.
  const veinMat = new THREE.MeshBasicMaterial({ color: colorHex });
  const veinCount = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < veinCount; i++) {
    const veinH = h * (0.3 + rand() * 0.4);
    const vein = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, veinH, 4), veinMat);
    const angle = rand() * Math.PI * 2;
    const along = rand() * h * 0.6;
    vein.position.set(Math.sin(angle) * 0.3, along + veinH / 2, Math.cos(angle) * 0.3);
    vein.rotation.z = (rand() - 0.5) * 0.5;
    group.add(vein);
  }
  const light = new THREE.PointLight(colorHex, 0.3, 4);
  light.position.y = h * 0.4;
  group.add(light);
  return { group, kind: "obsidian" };
}

// Verdant: a drooping flowering vine strung between low arcing segments,
// with small colored flower buds along its length — ground-level color
// and detail the flora stalk/tree don't provide on their own.
function createBloomingVine(colorHex, rand) {
  const group = new THREE.Group();
  const vineMat = new THREE.MeshStandardMaterial({ color: 0x2d5a2a, roughness: 0.8, flatShading: true });
  const segCount = 5 + Math.floor(rand() * 3);
  const arcHeight = 1.2 + rand() * 1.2;
  const arcWidth = 2 + rand() * 1.5;
  const flowerColors = [0xff8fd6, 0xffd36e, 0xff6b6b, 0xb28fff];
  for (let i = 0; i < segCount; i++) {
    const t0 = i / segCount, t1 = (i + 1) / segCount;
    const y0 = Math.sin(t0 * Math.PI) * arcHeight, y1 = Math.sin(t1 * Math.PI) * arcHeight;
    const x0 = (t0 - 0.5) * arcWidth, x1 = (t1 - 0.5) * arcWidth;
    const segLen = Math.hypot(x1 - x0, y1 - y0);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, segLen, 4), vineMat);
    seg.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
    seg.rotation.z = Math.atan2(x1 - x0, y1 - y0);
    group.add(seg);

    if (rand() < 0.6) {
      const flowerMat = new THREE.MeshStandardMaterial({
        color: flowerColors[Math.floor(rand() * flowerColors.length)],
        emissive: colorHex, emissiveIntensity: 0.15, roughness: 0.5,
      });
      const flower = new THREE.Mesh(new THREE.OctahedronGeometry(0.13 + rand() * 0.08, 0), flowerMat);
      flower.position.set(x1, y1 - 0.1, (rand() - 0.5) * 0.3);
      group.add(flower);
    }
  }
  return { group, kind: "bloomingVine" };
}

// Crystal: a split rock shell with a cluster of small crystal shards
// nested in the opening — a geode, distinct from the crystal cluster's
// bare jutting shards with no rock context at all.
function createGeode(colorHex, rand) {
  const group = new THREE.Group();
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x3a3540, roughness: 0.9, flatShading: true, side: THREE.DoubleSide });
  const shellR = 1.1 + rand() * 0.7;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(shellR, 8, 6, 0, Math.PI * 1.5), shellMat);
  shell.rotation.x = Math.PI * 0.15;
  shell.rotation.y = rand() * Math.PI * 2;
  shell.position.y = shellR * 0.4;
  group.add(shell);

  const crystalMat = new THREE.MeshStandardMaterial({
    color: colorHex, emissive: colorHex, emissiveIntensity: 0.5, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.9,
  });
  const shardCount = 4 + Math.floor(rand() * 4);
  for (let i = 0; i < shardCount; i++) {
    const s = shellR * (0.25 + rand() * 0.35);
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(s, 0), crystalMat);
    const angle = rand() * Math.PI * 2, dist = rand() * shellR * 0.5;
    shard.position.set(Math.cos(angle) * dist, shellR * 0.3 + rand() * shellR * 0.4, Math.sin(angle) * dist);
    shard.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
    group.add(shard);
  }
  const light = new THREE.PointLight(colorHex, 0.4, 5);
  light.position.y = shellR * 0.6;
  group.add(light);
  return { group, kind: "geode" };
}

// Abyssal: a tall, dramatically tapered ground spike suggesting a
// stalagmite grown up from the chasm floor over a long time — thinner
// and more elongated than the general rock cluster/debris.
function createStalagmite(colorHex, rand) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x241f30, roughness: 0.85, flatShading: true, emissive: colorHex, emissiveIntensity: 0.06 });
  const tiers = 2 + Math.floor(rand() * 2);
  let y = 0;
  for (let i = 0; i < tiers; i++) {
    const h = (2.5 + rand() * 2.5) * (1 - i * 0.2);
    const rBottom = (0.5 + rand() * 0.3) * (1 - i * 0.15);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(rBottom * 0.3, rBottom, h, 6), mat);
    cone.position.y = y + h / 2;
    cone.rotation.y = rand() * Math.PI * 2;
    group.add(cone);
    y += h * 0.85; // tiers overlap slightly rather than stacking with a visible seam
  }
  return { group, kind: "stalagmite" };
}

// Ashen: pale, half-buried bone-like fragments arranged loosely like a
// ribcage — fits the zone's "ended once" lore directly rather than just
// being another rock, without spelling out whose remains they are.
function createFossilRemains(colorHex, rand) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xd8cdb8, roughness: 0.9, flatShading: true });
  const ribCount = 4 + Math.floor(rand() * 4);
  const spineLen = 2 + rand() * 1.5;
  for (let i = 0; i < ribCount; i++) {
    const t = i / (ribCount - 1);
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.8 + rand() * 0.6, 4), mat);
    rib.position.set(0, 0.15, (t - 0.5) * spineLen);
    rib.rotation.z = Math.PI / 2.3 * (rand() < 0.5 ? 1 : -1);
    rib.rotation.y = (rand() - 0.5) * 0.3;
    group.add(rib);
  }
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, spineLen, 5), mat);
  spine.rotation.x = Math.PI / 2;
  spine.position.y = 0.15;
  group.add(spine);
  group.rotation.y = rand() * Math.PI * 2;
  return { group, kind: "fossilRemains" };
}

// A small flat stone slab etched with glowing glyph marks — "something
// else was here," without spelling out who or what. The slab stays
// angular/blocky (a BoxGeometry, no smoothing) per the same rock-art-style
// rule as every other mineral decoration; the glyphs are what carry the
// "ancient and alien" read, not the rock shape itself.
function createGlyphMarker(colorHex, rand) {
  const group = new THREE.Group();
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x353030, roughness: 0.9, flatShading: true });
  const w = 1.1 + rand() * 0.6, d = 0.9 + rand() * 0.5, t = 0.15 + rand() * 0.1;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(w, t, d), slabMat);
  slab.position.y = t / 2;
  slab.rotation.y = rand() * Math.PI * 2;
  slab.rotation.z = (rand() - 0.5) * 0.12; // slightly tilted, not perfectly flat — reads as settled/ancient rather than placed
  group.add(slab);

  const glyphMat = new THREE.MeshBasicMaterial({ color: colorHex });
  const glyphCount = 3 + Math.floor(rand() * 4);
  for (let i = 0; i < glyphCount; i++) {
    const isLine = rand() < 0.5;
    const gx = (rand() - 0.5) * w * 0.7, gz = (rand() - 0.5) * d * 0.7;
    let glyph;
    if (isLine) {
      glyph = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.15 + rand() * 0.2), glyphMat);
      glyph.rotation.y = rand() * Math.PI;
    } else {
      glyph = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.06), glyphMat);
    }
    glyph.position.set(gx, t + 0.01, gz);
    group.add(glyph);
  }
  const light = new THREE.PointLight(colorHex, 0.2, 2.5);
  light.position.y = t + 0.3;
  group.add(light);
  return { group, kind: "glyphMarker" };
}

export { createDecoration, updateDecoration };
