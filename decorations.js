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
      if (roll < 0.35) return createLivingTree(colorHex, seedRand);
      if (roll < 0.78) return createFloraStalk(colorHex, seedRand);
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
// just different sizes of the same silhouette.
const VERDANT_LEAF_PALETTE = [0x2f7a3a, 0x3f8f3a, 0x5a9a3a, 0x2f6a52, 0x4a7a2a];
const VERDANT_BARK_PALETTE = [0x4a3524, 0x5a4030, 0x3a2a1c];

// Living tree, one of three archetypes picked per-instance so a cluster
// of them reads as a real varied grove instead of the same silhouette
// copy-pasted at different scales: "round" (bushy clumps, the original
// look), "conical" (stacked pine/fir tiers), "spreading" (wide, flatter,
// offset canopy). Each foliage piece gets its own vertex-color gradient
// (applyVerticalGradient, same flat-illustration rim-light technique used
// elsewhere in this file) from the tree's own leaf color up to a lighter/
// warmer tone, rather than one flat foliage color.
function createLivingTree(colorHex, rand) {
  const group = new THREE.Group();
  const archetypeRoll = rand();
  const archetype = archetypeRoll < 0.4 ? "round" : archetypeRoll < 0.75 ? "conical" : "spreading";

  const h = 4 + rand() * 5;
  const bark = new THREE.Color(VERDANT_BARK_PALETTE[Math.floor(rand() * VERDANT_BARK_PALETTE.length)]);
  const trunkMat = new THREE.MeshStandardMaterial({ color: bark, roughness: 0.9, flatShading: true });
  const trunkRadiusTop = 0.12 + rand() * 0.1;
  const trunkRadiusBottom = trunkRadiusTop + 0.1 + rand() * 0.12;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(trunkRadiusTop, trunkRadiusBottom, h, 6), trunkMat);
  trunk.position.y = h / 2;
  // A slight lean rather than perfectly vertical — real trees rarely grow
  // arrow-straight, and a whole grove standing bolt upright is part of
  // why they all looked identical.
  trunk.rotation.z = (rand() - 0.5) * 0.12;
  trunk.rotation.x = (rand() - 0.5) * 0.12;
  group.add(trunk);

  const leafLow = new THREE.Color(VERDANT_LEAF_PALETTE[Math.floor(rand() * VERDANT_LEAF_PALETTE.length)]);
  const leafHigh = leafLow.clone().lerp(new THREE.Color(0xffffff), 0.22);
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });

  if (archetype === "conical") {
    let baseY = h * 0.55;
    const tiers = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < tiers; i++) {
      const tierT = i / tiers;
      const tierRadius = (1.3 - tierT * 0.7) * (0.9 + rand() * 0.3);
      const tierHeight = h * (0.32 - tierT * 0.06);
      const geo = new THREE.ConeGeometry(tierRadius, tierHeight, 6 + Math.floor(rand() * 3));
      applyVerticalGradient(geo, leafLow, leafHigh);
      const cone = new THREE.Mesh(geo, leafMat);
      cone.position.y = baseY + tierHeight * 0.4;
      group.add(cone);
      baseY += tierHeight * 0.62;
    }
  } else if (archetype === "spreading") {
    const clumps = 3 + Math.floor(rand() * 2);
    for (let i = 0; i < clumps; i++) {
      const scale = 1.4 + rand() * 1.0;
      const geo = new THREE.IcosahedronGeometry(scale, getGraphicsSettings().decorationDetail);
      // Squash vertically for a flatter, wider canopy silhouette than the
      // round archetype's ball-shaped clumps.
      const pos = geo.attributes.position;
      for (let v = 0; v < pos.count; v++) pos.setY(v, pos.getY(v) * 0.55);
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      applyVerticalGradient(geo, leafLow, leafHigh);
      const foliage = new THREE.Mesh(geo, leafMat);
      const angle = rand() * Math.PI * 2, dist = 0.5 + rand() * 1.3;
      foliage.position.set(Math.cos(angle) * dist, h * (0.8 + rand() * 0.15), Math.sin(angle) * dist);
      group.add(foliage);
    }
  } else {
    // "round" — the original bushy-clump look, now one of three options
    // instead of the only one, and with the per-tree color + gradient
    // applied like the other two archetypes.
    const clumps = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < clumps; i++) {
      const scale = 1.1 + rand() * 1.1;
      const geo = new THREE.IcosahedronGeometry(scale, getGraphicsSettings().decorationDetail);
      applyVerticalGradient(geo, leafLow, leafHigh);
      const foliage = new THREE.Mesh(geo, leafMat);
      const angle = rand() * Math.PI * 2, dist = rand() * 0.9;
      foliage.position.set(Math.cos(angle) * dist, h * (0.78 + rand() * 0.22), Math.sin(angle) * dist);
      group.add(foliage);
    }
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

export { createDecoration, updateDecoration, createEmberFire };
