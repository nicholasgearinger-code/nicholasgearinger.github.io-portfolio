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

// Paints a simple two-tone vertical gradient across a geometry's own local
// Y extent via vertex colors — same "flat illustration" idea as terrain.js's
// height palette, applied at prop scale. A shape using this needs
// `vertexColors: true` on its material (and a plain white material.color,
// so nothing multiplies the gradient down) rather than a fixed color.
function applyVerticalGradient(geo, colorLow, colorHigh) {
  const pos = geo.attributes.position;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const range = Math.max(maxY - minY, 1e-6);
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) / range;
    tmp.copy(colorLow).lerp(colorHigh, t);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

// -----------------------------------------------------------------------------
// Flat 2D painted rock silhouettes — used for Ember's rocks/spires instead
// of 3D geometry. Nothing here is collidable (see the file header above),
// so there's no gameplay reason to keep them as real meshes, and a painted
// jagged silhouette matches the reference's bold flat rock shapes far more
// directly than any amount of low-poly faceting could.
// -----------------------------------------------------------------------------

// Paints a jagged rock silhouette — near-black/deep-violet fill (the
// reference's foreground rocks read almost as pure dark shapes against
// the bright sky/lava) with a couple of thin warm rim-light streaks along
// one edge, which is what keeps a flat silhouette from reading as an
// inert cutout. `style` is "spire" (one tall narrow peak) or "cluster"
// (a wider, lower, multi-bump profile).
function createPaintedRockTexture(seed, style) {
  const w = 128, h = style === "spire" ? 224 : 144;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");

  const peakCount = style === "spire" ? 1 : 2 + Math.floor((seed % 1) * 2);
  const edgeSteps = 14;
  const points = [];
  for (let i = 0; i <= edgeSteps; i++) {
    const t = i / edgeSteps;
    const n = Math.sin(t * Math.PI * peakCount * 2 + seed * 5) * 0.5 + Math.sin(t * 17 + seed * 3) * 0.15;
    const peak = Math.pow(Math.sin(t * Math.PI), 0.6); // taller in the middle, tapering toward the ground at both edges
    const yTop = h * (1 - peak * (0.55 + n * 0.4));
    points.push({ x: t * w, y: Math.max(h * 0.08, yTop) });
  }

  ctx.beginPath();
  ctx.moveTo(0, h);
  for (const p of points) ctx.lineTo(p.x, p.y);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = "#170d0a";
  ctx.fill();

  // Warm rim-light streaks along the upper-left edge, clipped to the
  // silhouette so they only ever fall inside the rock shape itself.
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = "rgba(255,150,70,0.55)";
  ctx.lineWidth = w * 0.02;
  for (let i = 0; i < 3; i++) {
    const sx = w * (0.1 + i * 0.28 + ((seed * 7 + i) % 1) * 0.1);
    ctx.beginPath();
    ctx.moveTo(sx, h * 0.05);
    ctx.lineTo(sx - w * 0.06, h);
    ctx.stroke();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; // without this, canvas colors render washed-out/pale — see liquid.js/landmarks.js for the same fix
  return tex;
}

// Two planes crossed at 90°, sharing one painted texture — gives
// reasonable silhouette coverage from any horizontal approach angle
// without needing a true camera-facing billboard (that requires per-frame
// rotation from the render loop in main.js, outside this file's reach).
function createRockSprite(tex, width, height) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  const geo = new THREE.PlaneGeometry(width, height);
  const planeA = new THREE.Mesh(geo, mat);
  planeA.position.y = height / 2;
  group.add(planeA);
  const planeB = new THREE.Mesh(geo, mat);
  planeB.position.y = height / 2;
  planeB.rotation.y = Math.PI / 2;
  group.add(planeB);
  return group;
}

// Same crossed-plane technique as createRockSprite above, but LIT
// (MeshStandardMaterial, not MeshBasicMaterial) with an emissive glow
// map layered on top. Kept as a separate function rather than changing
// createRockSprite itself, which Ember's rocks also use and should stay
// unlit. Trees need to actually darken with the scene's own lighting
// now that Verdant's night is crushed near-black — an unlit material
// would stay at full brightness regardless of time of day, directly
// undermining that. The glowTex, painted on a black background with a
// few bright bioluminescent spots, is what keeps specific accents
// visible via emissive even when the rest of the tree goes dark.
function createTreeSprite(tex, glowTex, width, height) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, side: THREE.DoubleSide, roughness: 0.9,
    emissiveMap: glowTex, emissive: 0xffffff, emissiveIntensity: 3.5,
  });
  const geo = new THREE.PlaneGeometry(width, height);
  const planeA = new THREE.Mesh(geo, mat);
  planeA.position.y = height / 2;
  group.add(planeA);
  const planeB = new THREE.Mesh(geo, mat);
  planeB.position.y = height / 2;
  planeB.rotation.y = Math.PI / 2;
  group.add(planeB);
  return group;
}

function createDecoration(biome, colorHex, seedRand) {
  // Rare oversized "foreground framing" variant — rolled BEFORE anything
  // else below so it doesn't skew the existing per-biome prop-mix odds.
  // Every decoration currently sits at roughly the same on-screen scale
  // no matter how close the player walks up to it; occasionally letting
  // one loom far larger means passing near it fills the frame the way a
  // real foreground element would, a classic illustrated-environment
  // depth cue that costs nothing extra to build (same geometry, just
  // scaled up on the group).
  const isGiant = seedRand() < 0.035;
  const handle = buildBaseDecoration(biome, colorHex, seedRand);
  if (isGiant) {
    handle.group.scale.setScalar(2.4 + seedRand() * 1.4);
  }
  return handle;
}

function buildBaseDecoration(biome, colorHex, seedRand) {
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
    case "ember":
      if (roll < 0.5) return createSpire(biome, colorHex, seedRand);
      if (roll < 0.72) return createRockCluster(biome, colorHex, seedRand);
      if (roll < 0.88) return createEmberVent(colorHex, seedRand);
      return createEmberFire(colorHex, seedRand);
    case "verdant":
      if (roll < 0.55) return createLivingTree(colorHex, seedRand); // trees still dominant
      if (roll < 0.75) return createBush(colorHex, seedRand); // real bush/shrub undergrowth variety, not just trees + flowers
      if (roll < 0.9) return createFloraStalk(colorHex, seedRand);
      if (roll < 0.95) return createGlowFungus(colorHex, seedRand); // glowing bioluminescent ground clusters
      return createRockCluster(biome, colorHex, seedRand);
    case "crystal": return roll < 0.72 ? createCrystalCluster(colorHex, seedRand) : createRockCluster(biome, colorHex, seedRand);
    case "abyssal":
      if (roll < 0.25) return createCaveMouth(colorHex, seedRand);
      if (roll < 0.72) return createDebris(colorHex, seedRand);
      return createRockCluster(biome, colorHex, seedRand);
    case "ashen": return roll < 0.62 ? createDeadTree(colorHex, seedRand) : createRockCluster(biome, colorHex, seedRand);
    default: return createSpire(biome, colorHex, seedRand);
  }
}

// Paints a small jagged glowing ground crack — dark scorched edges with a
// bright molten line down the center, same visual language as the
// volcano's own veins/cracks but tiny and ground-level, scattered across
// the surrounding terrain rather than on the cone itself.
function createEmberVentTexture(seed) {
  const w = 48, h = 108;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");

  const points = [];
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wob = Math.sin(t * 6 + seed * 4) * 0.5 + Math.sin(t * 11 + seed * 2.4) * 0.3;
    points.push({ x: w / 2 + wob * w * 0.22, y: t * h });
  }

  ctx.strokeStyle = "#4a1204";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();

  ctx.strokeStyle = "#ffb35a";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A small ground-level glowing crack, scattered across the terrain around
// the volcano — gives the surrounding ground some of the same "cracked
// through with old fire" texture the cone itself has, instead of the
// area immediately around the landmark being visually quieter than the
// volcano it surrounds.
function createEmberVent(colorHex, rand) {
  const group = new THREE.Group();
  const tex = createEmberVentTexture(rand() * 100);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  const w = 0.7 + rand() * 0.5, len = 1.4 + rand() * 1.1;
  const geo = new THREE.PlaneGeometry(w, len);
  geo.rotateX(-Math.PI / 2); // lie flat — same established ground-plane pattern terrain.js/liquid.js use
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.y = rand() * Math.PI * 2; // single clean yaw, no rotation-order ambiguity since it's the only mesh-level rotation
  mesh.position.y = 0.02;
  group.add(mesh);

  const light = new THREE.PointLight(colorHex, 0.3, 3);
  light.position.y = 0.3;
  group.add(light);

  return { group, kind: "emberVent", light, pulseSeed: rand() * Math.PI * 2 };
}

// Paints a flame silhouette — tapers to a point at the top with a wobbly
// irregular outline (not a smooth teardrop), widest a little above the
// base, same wobble-along-a-path technique createEmberVentTexture uses
// for its crack line. Warm gradient from a bright near-white core low
// down to a redder edge higher up, since real flame is hottest/whitest
// at its base and cools toward the tip.
function createFlameTexture(seed) {
  const w = 64, h = 96;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");

  const steps = 10;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wob = Math.sin(t * 5 + seed * 3) * 0.5 + Math.sin(t * 9 + seed * 1.7) * 0.25;
    const envelope = Math.pow(1 - t, 0.7) * (1 - 0.15 * Math.sin(t * Math.PI));
    points.push({
      x: w / 2 + wob * w * 0.16 * (1 - t * 0.6),
      halfWidth: w * 0.33 * envelope,
      y: h * (1 - t),
    });
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x - points[0].halfWidth, points[0].y);
  for (const p of points) ctx.lineTo(p.x - p.halfWidth, p.y);
  for (let i = points.length - 1; i >= 0; i--) ctx.lineTo(points[i].x + points[i].halfWidth, points[i].y);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, "rgba(255,150,40,0.95)");
  grad.addColorStop(0.4, "rgba(255,190,60,0.92)");
  grad.addColorStop(0.72, "rgba(255,235,150,0.88)");
  grad.addColorStop(1, "rgba(255,252,225,0.65)");
  ctx.fillStyle = grad;
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Small glowing animated fire — Ember Reach's namesake element, scattered
// as ambient ground decoration rather than just the volcano's own
// eruption/veins. 2-3 camera-facing flame sprites (true THREE.Sprite,
// like the sun/moon/aurora sprites in dayNightCycle.js — a real billboard
// is the right tool here, not the crossed-planes trick the rock
// silhouettes use, since fire benefits from always facing the camera
// exactly) sharing one painted texture, a warm PointLight, and a handful
// of small embers drifting up out of the flame on their own looping arc
// (same idea as landmarks.js's ember sparks, scaled down for a ground
// prop). All animation happens in updateDecoration below.
// `spawnElapsed`/`lifespan` are optional — level-placed fires (via
// buildBaseDecoration below) leave lifespan at the Infinity default and
// burn forever, same as before. Dynamically runtime-spawned fires (see
// main.js's fire spawner) pass a real spawnElapsed/lifespan pair so
// updateDecoration can fade them out and flag them expired once their
// time is up.
function createEmberFire(colorHex, rand, spawnElapsed = 0, lifespan = Infinity) {
  const group = new THREE.Group();
  const tex = createFlameTexture(rand() * 100);
  const baseHeight = 0.9 + rand() * 0.7;
  const flames = [];
  const flameCount = 2 + Math.floor(rand() * 2); // 2-3 overlapping sprites for a fuller silhouette from any angle
  for (let i = 0; i < flameCount; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const sprite = new THREE.Sprite(mat);
    const h = baseHeight * (0.75 + rand() * 0.5);
    sprite.center.set(0.5, 0); // anchored at its base so scaling grows upward from the ground, not from the sprite's middle
    sprite.scale.set(h * 0.6, h, 1);
    sprite.position.set((rand() - 0.5) * 0.3, 0, (rand() - 0.5) * 0.3);
    group.add(sprite);
    flames.push({ sprite, baseW: h * 0.6, baseH: h, phase: rand() * Math.PI * 2, phase2: rand() * Math.PI * 2 });
  }

  const light = new THREE.PointLight(0xff7a28, 1.1, 6);
  light.position.y = baseHeight * 0.5;
  group.add(light);

  // Each ember gets its OWN cloned material — a shared material across
  // "independent" embers would defeat their individual opacity animation
  // (the same class of bug that broke this project's lava-river flow the
  // first time it was built; see landmarks.js/liquid.js notes).
  const embers = [];
  const emberCount = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < emberCount; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffb35a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), mat);
    group.add(mesh);
    embers.push({
      mesh,
      angle: rand() * Math.PI * 2,
      dist: rand() * 0.2,
      riseHeight: baseHeight * (1.2 + rand() * 1.2),
      duration: 1.4 + rand() * 1.2,
      pause: 0.8 + rand() * 1.6,
      delay: rand() * 3,
    });
  }

  return {
    group, kind: "emberFire", flames, light, embers,
    baseLightIntensity: light.intensity, flickerSeed: rand() * Math.PI * 2,
    spawnElapsed, lifespan, expired: false,
  };
}

// Jagged basalt spire with a glowing tip crack. Ember gets a flat 2D
// painted silhouette (see the note above createPaintedRockTexture); other
// biomes that fall back to this shape keep the original 3D cone.
function createSpire(biome, colorHex, rand) {
  const group = new THREE.Group();
  const h = 5 + rand() * 6;

  if (biome === "ember") {
    const tex = createPaintedRockTexture(rand() * 100, "spire");
    const width = 1.6 + rand() * 1.0;
    group.add(createRockSprite(tex, width, h));
  } else {
    const geo = new THREE.ConeGeometry(0.9 + rand() * 0.6, h, 5);
    // Painted gradient instead of one flat rock color — dark base rising to
    // a warm rust tone near the top, echoing terrain.js's Ember palette
    // rather than looking like a separately-lit prop dropped onto it.
    applyVerticalGradient(geo, new THREE.Color(0x1c0f0a), new THREE.Color(0x6a2a14));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const cone = new THREE.Mesh(geo, mat);
    cone.position.y = h / 2;
    cone.rotation.y = rand() * Math.PI;
    group.add(cone);
  }

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

// Small shrub/bush — several squashed-low foliage clumps, deliberately
// tiny compared to createLivingTree, for real size variety in the
// undergrowth rather than every piece of greenery being a full tree.
// Reuses "tree" as its `kind` so updateDecoration's existing gentle sway
// applies here too without needing a new branch there.
function createBush(colorHex, rand) {
  const group = new THREE.Group();
  const leafLow = new THREE.Color(VERDANT_LEAF_PALETTE[Math.floor(rand() * VERDANT_LEAF_PALETTE.length)]);
  const leafHigh = leafLow.clone().lerp(new THREE.Color(0xd8f06a), 0.35);
  const leafMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.85, flatShading: true,
    emissive: leafLow, emissiveIntensity: 0.22, // keeps a visible green tint even under this biome's darkened night lighting, instead of going to a featureless black blob — same fix as createLivingTree's foliage
  });
  const baseScale = 0.32 + rand() * 0.42; // small — this is undergrowth, not a tree
  const clumpCount = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < clumpCount; i++) {
    const scale = baseScale * (0.6 + rand() * 0.6);
    const geo = new THREE.IcosahedronGeometry(scale, getGraphicsSettings().decorationDetail);
    const gp = geo.attributes.position;
    for (let v = 0; v < gp.count; v++) gp.setY(v, gp.getY(v) * 0.7); // squashed low and wide, shrub silhouette not a ball
    gp.needsUpdate = true;
    geo.computeVertexNormals();
    applyVerticalGradient(geo, leafLow, leafHigh);
    const clump = new THREE.Mesh(geo, leafMat);
    const angle = rand() * Math.PI * 2, dist = rand() * baseScale * 0.7;
    clump.position.set(Math.cos(angle) * dist, baseScale * (0.35 + rand() * 0.25), Math.sin(angle) * dist);
    group.add(clump);
  }
  return { group, kind: "tree", bobAmplitude: 0.015, bobSeed: rand() * Math.PI * 2 };
}

// Small clusters of glowing bioluminescent mushroom caps — genuinely
// emissive (not just a bright diffuse color), so they read as a real
// light source scattered on the forest floor, especially once the night
// itself goes near-black. A soft, dim PointLight adds a small halo of
// actual light spilling onto the nearby ground, matching the same
// "glowing prop lights its own surroundings a little" idea as Ember's
// createEmberFire/emberVent.
const FUNGUS_GLOW_COLORS = [0x7cffb2, 0x8fe3ff, 0xd8ff6a, 0xc98fff];
function createGlowFungus(colorHex, rand) {
  const group = new THREE.Group();
  const glowColor = new THREE.Color(FUNGUS_GLOW_COLORS[Math.floor(rand() * FUNGUS_GLOW_COLORS.length)]);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.8, flatShading: true });
  const capMat = new THREE.MeshStandardMaterial({
    color: glowColor, roughness: 0.6, flatShading: true,
    emissive: glowColor, emissiveIntensity: 3.2,
  });
  const clusterCount = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < clusterCount; i++) {
    const scale = 0.12 + rand() * 0.14;
    const stemHeight = scale * (1.6 + rand() * 0.8);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(scale * 0.18, scale * 0.26, stemHeight, 5), stemMat);
    stem.position.y = stemHeight / 2;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(scale, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.55), capMat);
    cap.position.y = stemHeight;
    const cluster = new THREE.Group();
    cluster.add(stem, cap);
    const angle = rand() * Math.PI * 2, dist = rand() * 0.4;
    cluster.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
    group.add(cluster);
  }
  const light = new THREE.PointLight(glowColor.getHex(), 1.1, 5);
  light.position.y = 0.15;
  group.add(light);
  return { group, kind: "glowFungus", bobAmplitude: 0.4, bobSeed: rand() * Math.PI * 2, material: capMat, light };
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
// (spires, crystal clusters). Ember gets a flat 2D painted silhouette
// (see the note above createPaintedRockTexture); other biomes keep the
// original 3D cluster, muted toward gray so it reads as background
// texture rather than competing with actual focal points.
function createRockCluster(biome, colorHex, rand) {
  const group = new THREE.Group();

  if (biome === "ember") {
    const tex = createPaintedRockTexture(rand() * 100, "cluster");
    const width = 1.6 + rand() * 1.4, height = 0.9 + rand() * 0.8;
    group.add(createRockSprite(tex, width, height));
    return { group, kind: "rockCluster" };
  }

  // Non-Ember: real 3D rocks. A single flat tinted-gray color read as an
  // inert lump next to Ember's painted rim-light streaks — the closest
  // safe equivalent for a real MeshStandardMaterial prop (no per-frame
  // sun-facing calc available in this file) is a per-rock vertical
  // gradient from a dark base up to the biome's own accent color, the
  // same "flat illustration" vertex-color technique the non-Ember spire
  // already uses above. Each rock gets its own fresh gradient rather than
  // one shared material/geometry so the highlight isn't identical on
  // every rock in the cluster.
  const rockLow = new THREE.Color(0x2a2620);
  const rockHigh = new THREE.Color(colorHex).lerp(new THREE.Color(0xffffff), 0.15);
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
    applyVerticalGradient(geo, rockLow, rockHigh);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
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
// Real forests aren't one uniform green — a handful of distinct leaf
// tones (picked per-tree, not per-leaf) plus a couple of bark tones so
// trees actually read as different from each other at a glance, not
// just different sizes of the same silhouette. Pushed bolder/more
// saturated than a naturalistic palette — the reference is a flat
// illustration with vivid, punchy color blocks, not a muted realistic
// woodland.
const VERDANT_LEAF_PALETTE = [0x3d9a42, 0x4fc24f, 0x6bcc4a, 0x2f9a68, 0x5ab83a];
const VERDANT_BARK_PALETTE = [0x6b4423, 0x7a4f2a, 0x5a3a1e];

// -----------------------------------------------------------------------------
// Flat 2D painted tree silhouettes — same technique as Ember's
// createPaintedRockTexture/createRockSprite above, applied to Verdant's
// trees. The reference this was built from is a flat illustration; a
// painted silhouette matches it directly, where 3D branch geometry could
// only ever approximate it (see git history — several rounds of 3D
// branch/foliage-clump tuning never quite got there).
// -----------------------------------------------------------------------------

// Paints a tree silhouette. "conical" (pine, the dominant archetype) gets
// several overlapping jagged-edged triangular tiers stacked tall and
// narrow — a classic conifer profile, not one smooth cone. "round"/
// "spreading" get a broader canopy built from overlapping rounded lobes
// instead. A sliver of trunk peeks out at the very base either way — the
// reference shows almost no bare trunk, foliage covers nearly the whole
// tree.
function createTreeTexture(seed, archetype, leafColorHex, capColorHex, barkColorHex) {
  const w = 110;
  const h = archetype === "conical" ? 340 : archetype === "spreading" ? 210 : archetype === "palm" ? 380 : 250;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");

  // Wide enough to stay visible from any angle — on a crossed-plane
  // sprite, a thin trunk foreshortens down to almost nothing at oblique
  // viewing angles even though the much wider canopy above it stays
  // fully visible, which reads as a canopy floating with no support.
  // Foliage below is guaranteed to reach down over almost all of this
  // trunk via an explicit closing shape (see the base triangle/lobe in
  // each archetype branch below) rather than relying on the tier/lobe
  // placement math to reach far enough down on its own. Palms are the
  // deliberate exception — a tall, mostly-bare trunk with fronds only at
  // the very top IS the palm silhouette, not something to hide.
  const trunkTop = archetype === "palm" ? h * 0.16 : h * 0.78;
  ctx.fillStyle = `#${new THREE.Color(barkColorHex).getHexString()}`;
  ctx.fillRect(w * 0.4, trunkTop, w * 0.2, h - trunkTop);

  ctx.fillStyle = `#${new THREE.Color(leafColorHex).getHexString()}`;

  if (archetype === "palm") {
    // A crown of long arcing frond blades radiating from a point near
    // the top — the defining tropical silhouette, genuinely different
    // in construction from the other three archetypes rather than a
    // recolored variant of one of them.
    const crownY = h * 0.1;
    const frondCount = 6 + Math.floor((seed % 1) * 4);
    for (let i = 0; i < frondCount; i++) {
      const angle = (i / frondCount) * Math.PI * 2 + seed * 6;
      const droop = 0.35 + ((seed * 17 + i) % 1) * 0.45;
      const length = w * (0.62 + ((seed * 23 + i) % 1) * 0.3);
      const dirX = Math.cos(angle), dirY = Math.sin(angle) * 0.35 + droop * 0.65; // biased downward — fronds arc down and out, not straight sideways
      const midX = w * 0.5 + dirX * length * 0.55;
      const midY = crownY + dirY * length * 0.35;
      const endX = w * 0.5 + dirX * length;
      const endY = crownY + dirY * length * 0.85 + h * 0.06;
      const frondWidth = w * 0.045;
      const perpX = -dirY, perpY = dirX;
      ctx.beginPath();
      ctx.moveTo(w * 0.5, crownY);
      ctx.quadraticCurveTo(midX + perpX * frondWidth, midY + perpY * frondWidth, endX, endY);
      ctx.quadraticCurveTo(midX - perpX * frondWidth, midY - perpY * frondWidth, w * 0.5, crownY);
      ctx.closePath();
      ctx.fill();
    }
    // A small crown mass tying the fronds together at their shared base.
    ctx.beginPath();
    ctx.arc(w * 0.5, crownY, w * 0.13, 0, Math.PI * 2);
    ctx.fill();
  } else if (archetype === "conical") {
    const tiers = 4 + Math.floor((seed % 1) * 3);
    let tierTop = h * 0.03;
    const tierBottomMax = h * 0.92;
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const tierBottom = tierTop + (tierBottomMax - tierTop) * (0.32 + 0.1 * (1 - t));
      const halfWidth = (w * 0.5) * (0.28 + t * 0.62);
      const jag = 5;
      ctx.beginPath();
      ctx.moveTo(w / 2, tierTop);
      for (let j = 0; j <= jag; j++) {
        const jt = j / jag;
        const wob = Math.sin(jt * Math.PI * 5 + seed * 9 + i) * halfWidth * 0.12;
        ctx.lineTo(w / 2 + jt * halfWidth + wob, tierTop + jt * jt * (tierBottom - tierTop));
      }
      for (let j = jag; j >= 0; j--) {
        const jt = j / jag;
        const wob = Math.sin(jt * Math.PI * 5 + seed * 9 + i + 3) * halfWidth * 0.12;
        ctx.lineTo(w / 2 - jt * halfWidth - wob, tierTop + jt * jt * (tierBottom - tierTop));
      }
      ctx.closePath();
      ctx.fill();
      tierTop += (tierBottom - tierTop) * 0.62; // next tier starts partway down this one — overlapping tiers, not stacked edge-to-edge
    }
    // A final wide triangle at the base, GUARANTEED to reach all the way
    // down over the trunk regardless of where the tier loop above
    // actually landed — that loop's own math only closes 62% of the
    // remaining gap each iteration, so it approaches tierBottomMax
    // asymptotically and falls noticeably short with only 4-6 tiers, no
    // matter how high tierBottomMax itself is set. This shape doesn't
    // depend on that math at all.
    const baseHalfWidth = w * 0.48;
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.58);
    ctx.lineTo(w * 0.5 + baseHalfWidth, h * 0.98);
    ctx.lineTo(w * 0.5 - baseHalfWidth, h * 0.98);
    ctx.closePath();
    ctx.fill();
  } else {
    const lobes = archetype === "spreading" ? 5 : 4;
    const canopyTop = h * 0.06;
    const canopyBottom = h * 0.86;
    for (let i = 0; i < lobes; i++) {
      const lt = i / (lobes - 1);
      const cx = w * (0.5 + (lt - 0.5) * (archetype === "spreading" ? 0.9 : 0.55));
      const cy = canopyTop + (canopyBottom - canopyTop) * (0.35 + 0.3 * Math.abs(lt - 0.5));
      const r = (w * (archetype === "spreading" ? 0.42 : 0.36)) * (0.75 + ((seed * 13 + i) % 1) * 0.4);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // A wide low lobe specifically to close the gap down to the trunk —
    // the scattered lobes above only ever reach about halfway down this
    // canopy's own range by construction (their cy formula tops out at
    // canopyTop+(canopyBottom-canopyTop)*0.5), so without this there's a
    // real bare gap between the canopy and the trunk, not just an
    // exposed trunk.
    const closeR = w * (archetype === "spreading" ? 0.46 : 0.4);
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.88, closeR, 0, Math.PI * 2);
    ctx.fill();
  }

  // A warm highlight rim along one edge, composited only onto whatever's
  // already painted — same flat-illustration rim-light trick as the rock
  // silhouettes above, keeps a solid dark canopy from reading as an inert
  // cutout. source-atop (not the rocks' clip()) since the canopy here is
  // several separate shapes, not one continuous path.
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  const cap = new THREE.Color(capColorHex);
  const rim = ctx.createLinearGradient(w * 0.2, 0, w * 0.8, 0);
  rim.addColorStop(0, "rgba(0,0,0,0)");
  rim.addColorStop(0.65, "rgba(0,0,0,0)");
  rim.addColorStop(1, `rgba(${Math.round(cap.r * 255)},${Math.round(cap.g * 255)},${Math.round(cap.b * 255)},0.55)`);
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A small pool of pre-baked variants per archetype+color combo, reused
// across every tree that rolls that combo, instead of one brand-new
// canvas texture per tree instance. With hundreds of trees in a forest,
// unique-per-tree textures would scale GPU memory linearly with tree
// count; pooling bounds it by how much color/archetype variety exists
// instead — this is what actually makes pushing tree count up safe.
const TREE_TEXTURE_VARIANTS = 3;
const treeTextureCache = new Map();
function getTreeTexture(archetype, leafColorHex, capColorHex, barkColorHex, rand) {
  const key = `${archetype}|${leafColorHex}|${barkColorHex}`;
  let variants = treeTextureCache.get(key);
  if (!variants) {
    variants = [];
    for (let i = 0; i < TREE_TEXTURE_VARIANTS; i++) {
      variants.push(createTreeTexture((i + 1) / (TREE_TEXTURE_VARIANTS + 1), archetype, leafColorHex, capColorHex, barkColorHex));
    }
    treeTextureCache.set(key, variants);
  }
  return variants[Math.floor(rand() * variants.length)];
}

// A handful of bright bioluminescent glow spots painted on a black
// background, at the same canvas dimensions as createTreeTexture for the
// given archetype so it lines up correctly as an emissive map on the
// same UVs. Black pixels contribute nothing to emissive output, so only
// the painted spots actually glow — everything else on the tree still
// gets lit normally by the scene's own lighting. Pooled the same way as
// the diffuse texture, keyed only by archetype (glow color/placement
// doesn't need to vary by leaf/bark color the way the diffuse look does).
const GLOW_TEXTURE_VARIANTS = 3;
const GLOW_COLORS = ["#7cffb2", "#8fe3ff", "#d8ff6a"];
const treeGlowTextureCache = new Map();
function createTreeGlowTexture(seed, archetype) {
  const w = 110;
  const h = archetype === "conical" ? 340 : archetype === "spreading" ? 210 : archetype === "palm" ? 380 : 250;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);
  const spotCount = 8 + Math.floor((seed % 1) * 7);
  for (let i = 0; i < spotCount; i++) {
    const gx = w * (0.15 + ((seed * 7 + i * 13) % 1) * 0.7);
    const gy = h * (0.12 + ((seed * 11 + i * 17) % 1) * 0.8); // spread across most of the canvas — reads fine whether it lands on trunk or canopy
    const r = w * (0.045 + ((seed * 3 + i) % 1) * 0.035);
    const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
    const color = GLOW_COLORS[i % GLOW_COLORS.length];
    grad.addColorStop(0, color);
    grad.addColorStop(0.5, color);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(gx, gy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function getTreeGlowTexture(archetype, rand) {
  let variants = treeGlowTextureCache.get(archetype);
  if (!variants) {
    variants = [];
    for (let i = 0; i < GLOW_TEXTURE_VARIANTS; i++) {
      variants.push(createTreeGlowTexture((i + 1) / (GLOW_TEXTURE_VARIANTS + 1) + 0.37, archetype));
    }
    treeGlowTextureCache.set(archetype, variants);
  }
  return variants[Math.floor(rand() * variants.length)];
}

function createLivingTree(colorHex, rand) {
  const archetypeRoll = rand();
  // Tropical rainforest weighting — palm and broad-leaf canopies (round/
  // spreading) now dominant, conical (pine) reduced to a rare minority
  // rather than the previous pine-forest-dominant mix.
  const archetype = archetypeRoll < 0.35 ? "palm" : archetypeRoll < 0.65 ? "spreading" : archetypeRoll < 0.9 ? "round" : "conical";
  const bark = VERDANT_BARK_PALETTE[Math.floor(rand() * VERDANT_BARK_PALETTE.length)];
  const leaf = VERDANT_LEAF_PALETTE[Math.floor(rand() * VERDANT_LEAF_PALETTE.length)];
  const cap = 0xd8f06a; // same vivid yellow-green highlight used elsewhere for Verdant foliage
  const tex = getTreeTexture(archetype, leaf, cap, bark, rand);
  const glowTex = getTreeGlowTexture(archetype, rand);

  const height = (3 + rand() * 9) * (archetype === "palm" ? 1.5 : archetype === "conical" ? 1.35 : 1); // palms read as tall canopy emergents, taller even than the (now rare) pines
  // Width matches the canvas's own aspect ratio per archetype (see the w/h
  // values in createTreeTexture) so the painted silhouette doesn't stretch.
  const aspect = archetype === "conical" ? 110 / 340 : archetype === "spreading" ? 110 / 210 : archetype === "palm" ? 110 / 380 : 110 / 250;
  const width = height * aspect;

  const spriteGroup = createTreeSprite(tex, glowTex, width, height);
  return {
    group: spriteGroup, kind: "tree", bobAmplitude: 0.02, bobSeed: rand() * Math.PI * 2,
    material: spriteGroup.children[0].material, // both crossed planes share one material — grabbing it here lets updateDecoration animate a subtle canopy shimmer without createRockSprite itself needing to expose it
  };
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
    if (handle.material) {
      // A subtle brightness shimmer on the same phase as the sway — reads
      // as light catching the leaves as they move, not just a rigid
      // rocking silhouette. Small enough it doesn't fight the painted
      // texture's own gradient/rim-light.
      const shimmer = 1 + Math.sin(elapsed * 0.5 + handle.bobSeed) * 0.08;
      handle.material.color.setScalar(shimmer);
    }
  } else if (handle.kind === "glowFungus") {
    const pulse = 0.6 + 0.4 * Math.sin(elapsed * 0.9 + handle.bobSeed) * Math.sin(elapsed * 0.37 + handle.bobSeed * 1.7);
    if (handle.material) handle.material.emissiveIntensity = 2.2 + pulse * 2.2;
    if (handle.light) handle.light.intensity = 0.5 + pulse * 0.9;
  } else if (handle.kind === "debris") {
    handle.group.position.y = handle.baseY + handle.hoverHeight + Math.sin(elapsed * 0.6 + handle.bobSeed) * handle.bobAmplitude;
    handle.group.rotation.y += handle.spinRate * 0.016;
  } else if (handle.kind === "emberVent") {
    handle.light.intensity = 0.2 + 0.25 * (0.5 + 0.5 * Math.sin(elapsed * 1.6 + handle.pulseSeed));
  } else if (handle.kind === "emberFire") {
    // Fires with a finite lifespan (dynamically spawned, see main.js's
    // fire spawner) fade out over their last few seconds instead of
    // vanishing abruptly, then flag themselves expired so main.js's
    // animate loop can remove+dispose them. Static level-placed fires
    // (lifespan left at the createEmberFire default of Infinity) never
    // reach fadeOut < 1 and burn indefinitely, same as before this
    // feature existed.
    const age = elapsed - handle.spawnElapsed;
    const fadeWindow = 4;
    const remaining = handle.lifespan - age;
    const fadeOut = handle.lifespan === Infinity ? 1 : THREE.MathUtils.clamp(remaining / fadeWindow, 0, 1);
    if (handle.lifespan !== Infinity && remaining <= 0) handle.expired = true;

    // Layered sine waves (not raw per-frame randomness) approximate real
    // fire's irregular-but-smooth flicker without looking like static.
    const flicker = (0.82 + 0.12 * Math.sin(elapsed * 9 + handle.flickerSeed) + 0.06 * Math.sin(elapsed * 23 + handle.flickerSeed * 1.7)) * fadeOut;
    for (const f of handle.flames) {
      const sway = Math.sin(elapsed * 4 + f.phase) * 0.06 + Math.sin(elapsed * 11 + f.phase2) * 0.03;
      f.sprite.scale.set(f.baseW * (flicker + sway), f.baseH * flicker, 1);
      f.sprite.material.rotation = sway * 0.4;
      f.sprite.material.opacity = (0.75 + 0.2 * flicker) * fadeOut;
    }
    handle.light.intensity = handle.baseLightIntensity * flicker;

    for (const e of handle.embers) {
      // Positive-safe modulo — elapsed-minus-delay can go negative early
      // on, and JS's `%` preserves the sign of the dividend (see the
      // project-wide note on this in landmarks.js/liquid.js).
      const cycle = e.duration + e.pause;
      const raw = elapsed - e.delay;
      const localT = ((raw % cycle) + cycle) % cycle;
      if (localT > e.duration) {
        e.mesh.material.opacity = 0;
        continue;
      }
      const t = localT / e.duration;
      e.mesh.position.set(Math.cos(e.angle) * e.dist, t * e.riseHeight, Math.sin(e.angle) * e.dist);
      e.mesh.material.opacity = Math.sin(t * Math.PI) * 0.85 * fadeOut;
    }
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
  const h = 3 + rand() * 4;
  // Flat 2D painted body, same as the regular spire/rock cluster — offset
  // seed (+50) so obsidian's silhouettes don't roll the same shapes as
  // regular spires nearby.
  const tex = createPaintedRockTexture(rand() * 100 + 50, "spire");
  const width = 1.1 + rand() * 0.7;
  group.add(createRockSprite(tex, width, h));

  // Thin glowing crack lines up the surface — a few short emissive
  // cylinders standing in for veins, not a real crack-texture map.
  // Already flat/unlit (MeshBasicMaterial), so these carry over unchanged
  // from the 3D version; radial offset pulled in slightly (0.3 -> 0.12)
  // since there's no real volume to wrap around anymore.
  const veinMat = new THREE.MeshBasicMaterial({ color: colorHex });
  const veinCount = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < veinCount; i++) {
    const veinH = h * (0.3 + rand() * 0.4);
    const vein = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, veinH, 4), veinMat);
    const angle = rand() * Math.PI * 2;
    const along = rand() * h * 0.6;
    vein.position.set(Math.sin(angle) * 0.12, along + veinH / 2, Math.cos(angle) * 0.12);
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

// -----------------------------------------------------------------------------
// Canopy light shafts — Verdant only. Scattered "god ray" sprites
// reaching down from canopy height toward the ground. dayNightCycle.js's
// existing sun beams use the same tapered-beam texture technique but
// aren't exported and stay tightly bound to tracking the sun's own
// position, so this is a small self-contained version rather than
// importing that one. Brightness is driven by the day/night cycle's own
// dayAmount, updated each frame from main.js — bright at midday, fading
// toward nothing at night, since light can't shine through a canopy that
// isn't lit in the first place.
// -----------------------------------------------------------------------------

let sharedLightShaftTexture = null;
function getLightShaftTexture() {
  if (sharedLightShaftTexture) return sharedLightShaftTexture;
  const w = 48, h = 200;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.18)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.filter = "blur(6px)"; // soft edges, not a cut shape
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(w * 0.42, 0);
  ctx.lineTo(w * 0.58, 0);
  ctx.lineTo(w * 0.85, h);
  ctx.lineTo(w * 0.15, h);
  ctx.closePath();
  ctx.fill();
  sharedLightShaftTexture = new THREE.CanvasTexture(canvas);
  return sharedLightShaftTexture;
}

function createLightShaft(x, z, groundY, rand) {
  const mat = new THREE.SpriteMaterial({
    map: getLightShaftTexture(), color: 0xdcf0a0, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
    rotation: (rand() - 0.5) * 0.25, // a slight tilt, not perfectly vertical
  });
  const sprite = new THREE.Sprite(mat);
  sprite.center.set(0.5, 1); // anchored at the top (canopy height), extends downward — same convention dayNightCycle.js's sun beams use
  const length = 7 + rand() * 8;
  sprite.scale.set(length * 0.3, length, 1);
  sprite.position.set(x, groundY + length, z);
  return { sprite, baseOpacity: 0.3 + rand() * 0.25 };
}

function updateLightShafts(shafts, dayAmount) {
  if (!shafts) return;
  const t = Math.max(0, dayAmount);
  for (const s of shafts) s.sprite.material.opacity = s.baseOpacity * t;
}

function disposeLightShafts(scene, shafts) {
  if (!shafts) return;
  for (const s of shafts) {
    scene.remove(s.sprite);
    s.sprite.material.dispose();
  }
}

export { createDecoration, updateDecoration, createEmberFire, createLivingTree, createBush, createLightShaft, updateLightShafts, disposeLightShafts };
