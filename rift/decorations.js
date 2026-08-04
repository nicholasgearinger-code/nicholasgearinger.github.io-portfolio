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
function createTreeSprite(tex, glowTex, width, height, rand) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, side: THREE.DoubleSide, roughness: 0.9,
    emissiveMap: glowTex, emissive: 0xffffff, emissiveIntensity: 3.5,
  });
  // Segmented plane (was a single flat quad, 2 triangles) with per-vertex
  // forward/back jitter on the upper portion — substantially raises the
  // poly count and gives the canopy genuine 3D bulk/depth instead of a
  // perfectly flat card. Jitter strength fades toward the base (t*t) so
  // the trunk stays straight and structurally clean rather than
  // wobbling.
  const segsX = 6, segsY = 10;
  const geo = new THREE.PlaneGeometry(width, height, segsX, segsY);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const localY = pos.getY(i) + height / 2; // 0 at base, height at top
    const t = localY / height;
    const jitterStrength = t * t;
    pos.setZ(i, pos.getZ(i) + (rand() - 0.5) * width * 0.35 * jitterStrength);
  }
  geo.computeVertexNormals();
  // A fixed 2-plane cross (0°/90°) has a real, visible flaw: its
  // silhouette changes noticeably as the viewer walks around it —
  // worst right at the angles between the two planes, where you see a
  // thin combined sliver instead of a full canopy. True per-frame
  // camera-facing billboarding would fix this completely, but at real
  // ongoing cost across every tree on screen (hundreds, for Verdant's
  // filler forest) — this project doesn't do that anywhere. More static
  // planes, spread evenly across 180° (each is already DoubleSide, so a
  // full "cross" only needs to span half a circle), is the standard
  // cheaper fix: no per-frame work, just a more consistent silhouette
  // from more angles. Palm fronds specifically are a directional,
  // asymmetric fan shape (unlike a round bushy conifer canopy), so the
  // 2-plane artifact read far worse there — but this benefits every
  // tree type using this function. Scaled by the existing
  // decorationDetail knob (organic-shape detail, per graphicsSettings.js's
  // own art-style rule) rather than a new setting.
  const detail = getGraphicsSettings().decorationDetail;
  const planeCount = detail >= 3 ? 4 : detail >= 1 ? 3 : 2;
  for (let i = 0; i < planeCount; i++) {
    const plane = new THREE.Mesh(geo, mat);
    plane.position.y = height / 2;
    plane.rotation.y = (Math.PI / planeCount) * i;
    group.add(plane);
  }
  return group;
}

function createDecoration(biome, colorHex, seedRand, worldX, worldZ) {
  // Rare oversized "foreground framing" variant — rolled BEFORE anything
  // else below so it doesn't skew the existing per-biome prop-mix odds.
  // Every decoration currently sits at roughly the same on-screen scale
  // no matter how close the player walks up to it; occasionally letting
  // one loom far larger means passing near it fills the frame the way a
  // real foreground element would, a classic illustrated-environment
  // depth cue that costs nothing extra to build (same geometry, just
  // scaled up on the group).
  const isGiant = seedRand() < 0.035;
  const handle = buildBaseDecoration(biome, colorHex, seedRand, worldX, worldZ);
  if (handle && isGiant) {
    handle.group.scale.setScalar(2.4 + seedRand() * 1.4);
  }
  return handle;
}

function buildBaseDecoration(biome, colorHex, seedRand, worldX, worldZ) {
  const roll = seedRand();
  const highDetail = getGraphicsSettings().decorationDetail >= 2;
  // Coral Shallows' emergent island (see terrain.js's Math.max-guaranteed
  // dome near the landmark position) needs entirely different dressing
  // from the surrounding reef — palm trees and open sand, not coral/rock/
  // clams, which would make no sense sitting on dry land. worldX/worldZ
  // are only ever passed for crystal's own seeds (see main.js's call
  // site), so this is a no-op for every other biome.
  // Position updated to (30, -30) — landmarks.js moved LANDMARK_POSITION
  // there from (55, -70) per explicit "expand the map constraints"
  // follow-up (more edge clearance for the island's own radius). Radius
  // threshold (37) left as an approximation, NOT re-verified against
  // terrain.js's current CORE/BLEND (38/48, changed in an earlier round)
  // — doesn't matter functionally right now since the onIsland branch
  // just returns null unconditionally below (island decorations were
  // removed entirely per a separate earlier request), so this variable
  // has no visible effect either way at the moment. Worth recomputing
  // properly if island decorations are ever reintroduced.
  // Position updated to (0, -30) — landmarks.js moved LANDMARK_POSITION
  // there again from (30, -30) per explicit "stretch the coastline"
  // follow-up (X centered at 0 for full symmetric clearance). Radius
  // threshold (37) still not re-verified against terrain.js's current
  // elongated/stretched shape — doesn't matter functionally right now
  // since the onIsland branch just returns null unconditionally below.
  const onIsland = biome === "crystal" && worldX !== undefined && worldZ !== undefined && Math.hypot(worldX - 0, worldZ + 30) < 37;
  // High-tier-exclusive signature piece per biome — not just "more
  // polygons of the same prop," a genuinely different shape that only
  // High actually renders. Rolled first so it doesn't skew the existing
  // biome's usual prop-mix odds when High isn't active.
  if (highDetail && !onIsland && seedRand() < 0.22) {
    switch (biome) {
      case "ember": return createObsidianFormation(colorHex, seedRand);
      case "verdant": return createBloomingVine(colorHex, seedRand);
      // crystal's geode (a rock/clam formation) removed per explicit
      // "fully remove all trees, rocks, and coral" request.
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
      if (roll < 0.6) return createLivingTree(colorHex, seedRand); // bushes removed per explicit request — share redistributed to trees
      if (roll < 0.78) return createFloraStalk(colorHex, seedRand);
      if (roll < 0.88) return createBloomingVine(colorHex, seedRand); // vines given a real presence at EVERY graphics tier now, not just the small High-tier-exclusive roll below — a jungle reference needs vines to actually show up
      if (roll < 0.93) return createGlowFungus(colorHex, seedRand); // glowing bioluminescent ground clusters
      if (roll < 0.97) return createFallenLog(colorHex, seedRand); // moss-covered logs/stumps — ground-floor variety and an "aged forest" signal
      return createRockCluster(biome, colorHex, seedRand);
    case "crystal":
      // Trees, rocks, and coral removed entirely per explicit "fully
      // remove all trees, rocks, and coral" request — Coral Shallows
      // now spawns none of these as scattered decorations, on the
      // island or across the reef floor. This also sidesteps the
      // onIsland check's stale detection radius (see its own comment
      // above) — since this case is null unconditionally now, whether
      // that radius still matches the island's current elongated shape
      // no longer matters.
      return null;
    case "abyssal":
      if (roll < 0.25) return createCaveMouth(colorHex, seedRand, biome);
      if (roll < 0.72) return createDebris(colorHex, seedRand);
      return createRockCluster(biome, colorHex, seedRand);
    case "ashen": return roll < 0.62 ? createDeadTree(colorHex, seedRand) : createRockCluster(biome, colorHex, seedRand);
    case "frost":
      if (roll < 0.53) return createSpire(biome, colorHex, seedRand); // ice spikes — genuinely icy-colored now, was falling through to the rust-brown Ember gradient via the default case below
      return createRockCluster(biome, colorHex, seedRand); // frozen boulders
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
  } else if (biome === "frost") {
    const geo = new THREE.ConeGeometry(0.85 + rand() * 0.55, h, 6);
    // A real icy gradient — deep shadowed blue-grey base rising to a
    // near-white frosted tip — replacing what used to be Ember's
    // hardcoded rust-brown gradient falling through to every other
    // biome via the else-branch below. This is a genuine ice spike, not
    // a rock.
    applyVerticalGradient(geo, new THREE.Color(0x2a4a5e), new THREE.Color(0xe8f4fa));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1, flatShading: true });
    const spike = new THREE.Mesh(geo, mat);
    spike.position.y = h / 2;
    spike.rotation.y = rand() * Math.PI;
    group.add(spike);
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
  const baseScale = 0.4 + rand() * 0.5;
  const bladeCount = 5 + Math.floor(rand() * 4);
  for (let i = 0; i < bladeCount; i++) {
    // A flattened, elongated blade — a fern frond/broad tropical leaf,
    // not a round clump — this is what actually reads as tropical
    // undergrowth instead of a generic shrub ball.
    const length = baseScale * (1.2 + rand() * 0.9);
    const width = baseScale * (0.32 + rand() * 0.2);
    const geo = new THREE.ConeGeometry(width, length, 4, 1);
    geo.scale(1, 1, 0.22);
    geo.translate(0, length / 2, 0); // base at origin, tip up, so the rotation below pivots it from its own root
    applyVerticalGradient(geo, leafLow, leafHigh);
    const blade = new THREE.Mesh(geo, leafMat);
    const angle = rand() * Math.PI * 2;
    const outward = 0.35 + rand() * 0.55; // how far each blade leans outward from vertical, radiating from a shared base like a real fern cluster
    blade.position.set(Math.cos(angle) * baseScale * 0.15, 0, Math.sin(angle) * baseScale * 0.15);
    blade.rotation.y = angle; // yaw first
    blade.rotateX(outward); // then tilt outward via the incremental method, not the rotation.x property, so it leans away from the cluster's own center rather than a fixed world axis
    group.add(blade);
  }
  return { group, kind: "tree", bobAmplitude: 0.02, bobSeed: rand() * Math.PI * 2 };
}

// Small clusters of glowing bioluminescent mushroom caps — genuinely
// emissive (not just a bright diffuse color), so they read as a real
// light source scattered on the forest floor, especially once the night
// itself goes near-black. A soft, dim PointLight adds a small halo of
// actual light spilling onto the nearby ground, matching the same
// "glowing prop lights its own surroundings a little" idea as Ember's
// createEmberFire/emberVent.
const FUNGUS_GLOW_COLORS = [0xb87cff, 0xc98fff, 0xa855f7, 0xd4a5ff]; // purple-dominant per explicit request — was green/cyan/yellow/purple
function createGlowFungus(colorHex, rand) {
  const group = new THREE.Group();
  const glowColor = new THREE.Color(FUNGUS_GLOW_COLORS[Math.floor(rand() * FUNGUS_GLOW_COLORS.length)]);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.8, flatShading: true });
  const capMat = new THREE.MeshStandardMaterial({
    color: glowColor, roughness: 0.6, flatShading: true,
    emissive: glowColor, emissiveIntensity: 3.2,
  });
  const highDetailFungus = getGraphicsSettings().decorationDetail >= 3;
  const clusterCount = (highDetailFungus ? 4 : 2) + Math.floor(rand() * (highDetailFungus ? 5 : 3)); // denser clusters on High, matching the reference's thick mushroom growth
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

// A fallen, moss-covered log lying on the forest floor — ground-level
// decoration variety distinct from standing trees/bushes, and a real
// "aged forest" signal on its own (something died and is slowly being
// reclaimed). Small chance of being a short upright stump instead of a
// full lying log, for more variety from one function.
function createFallenLog(colorHex, rand) {
  const group = new THREE.Group();
  const barkColor = new THREE.Color(VERDANT_BARK_PALETTE[Math.floor(rand() * VERDANT_BARK_PALETTE.length)]);
  const isStump = rand() < 0.3;
  const barkMat = new THREE.MeshStandardMaterial({ color: barkColor, roughness: 0.95, flatShading: true });
  if (isStump) {
    const height = 0.5 + rand() * 0.6;
    const radius = 0.35 + rand() * 0.25;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.85, radius, height, 10), barkMat); // was 7 segments — bumped per explicit "higher poly count" request
    trunk.position.y = height / 2;
    group.add(trunk);
  } else {
    const length = 2.5 + rand() * 3;
    const radius = 0.3 + rand() * 0.25;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.85, length, 10), barkMat); // was 7 segments — bumped per explicit "higher poly count" request
    log.rotation.z = Math.PI / 2; // lying on its side
    log.rotation.y = rand() * Math.PI * 2;
    log.position.y = radius * 0.8; // sunk slightly into the ground, not perfectly balanced on top
    group.add(log);
  }
  // Moss patches — same technique as the rock clusters, since this is
  // exactly the kind of surface real moss actually colonizes. Genuinely
  // emissive (purple) and twinkles, per explicit request — not just a
  // colored surface.
  const mossColor = new THREE.Color(0x3a6b2a).lerp(new THREE.Color(0x5c9a3a), rand());
  const mossGlow = new THREE.Color(0xb87cff);
  const mossMat = new THREE.MeshStandardMaterial({ color: mossColor, roughness: 1, flatShading: true, emissive: mossGlow, emissiveIntensity: 0.4 });
  const patchCount = 3 + Math.floor(rand() * 4);
  const spread = isStump ? 0.4 : 1.6;
  for (let p = 0; p < patchCount; p++) {
    const patchGeo = new THREE.SphereGeometry(0.12 + rand() * 0.16, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5); // was 5,3 segments — bumped per explicit "higher poly count" request
    const patch = new THREE.Mesh(patchGeo, mossMat);
    patch.position.set((rand() - 0.5) * spread, isStump ? 0.4 + rand() * 0.3 : 0.25 + rand() * 0.15, (rand() - 0.5) * 0.5);
    group.add(patch);
  }
  group.rotation.y = rand() * Math.PI * 2;
  return { group, kind: "mossyProp", materials: [mossMat], bobSeed: rand() * Math.PI * 2 }; // "mossyProp" kind twinkles the moss materials — see updateDecoration
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

// Vivid tropical coral colors — picked independent of the biome's own
// colorHex (see note above) so the reef reads as genuinely tropical
// regardless of that leftover accent tint. Reused across every reef
// decoration below for a consistent, coordinated palette rather than each
// prop rolling its own unrelated colors.
const CORAL_PALETTE = [0xff6f9e, 0xff9d42, 0xb35cff, 0x3ce7ff, 0xffe066, 0xff5c5c, 0x6fd94a];

// Branching staghorn-coral cluster — same angular-shard construction the
// old crystal cluster used (octahedra fanned out from a base point), now
// in warm coral colors instead of a single cool crystalline tint, and
// each shard picking its own color from the palette so one cluster reads
// as several coral colonies growing together rather than one uniform
// crystal formation.
function createCrystalCluster(colorHex, rand) {
  const group = new THREE.Group();
  const count = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const scale = 0.7 + rand() * 1.4;
    const coral = CORAL_PALETTE[Math.floor(rand() * CORAL_PALETTE.length)];
    const geo = new THREE.OctahedronGeometry(scale, 0); // stays blocky on purpose, same low-poly rule as every other rock/crystal-family prop
    const mat = new THREE.MeshStandardMaterial({
      color: coral, emissive: coral, emissiveIntensity: 0.3,
      roughness: 0.35, metalness: 0.05, transparent: true, opacity: 0.95,
    });
    const shard = new THREE.Mesh(geo, mat);
    const angle = rand() * Math.PI * 2, dist = rand() * 1.4;
    shard.position.set(Math.cos(angle) * dist, scale * 0.65, Math.sin(angle) * dist);
    shard.rotation.set(rand() * 0.6, rand() * Math.PI * 2, rand() * 0.6);
    group.add(shard);
  }
  return { group, kind: "crystalCluster" };
}

// Irregular rock chunk that hovers and slowly drifts just above the ground
// — reads as unstable/anti-gravity, fitting the Abyssal Drift theme.
function createDebris(colorHex, rand) {
  const group = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(0.8 + rand() * 1.1, 0); // rock — stays blocky on purpose, per graphicsSettings.js's documented art-style rule (rocks/crystals excluded from decorationDetail smoothing at every tier) — reverted a previous round's mistaken bump to 1, made before that file's contents were available to check against
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
  const rockLow = biome === "crystal" ? new THREE.Color(0x3a5850) : new THREE.Color(0x2a2620); // algae-shadowed reef rock rather than dark volcanic rock
  const rockHigh = biome === "crystal"
    ? new THREE.Color(0xe8d9b8) // pale sun-bleached coral rubble, ignoring colorHex's leftover violet tint
    : new THREE.Color(colorHex).lerp(new THREE.Color(0xffffff), 0.15);
  const count = 2 + Math.floor(rand() * 3);
  const mossMaterials = []; // collected across every rock in this cluster that gets moss — see the verdant branch below
  for (let i = 0; i < count; i++) {
    const scale = 0.4 + rand() * 0.9;
    const geo = new THREE.IcosahedronGeometry(scale, 0); // rock — stays blocky on purpose, per graphicsSettings.js's documented art-style rule — reverted from a previous round's mistaken bump
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

    // Small moss patches on the rock's upper surface — Verdant only. A
    // genuine distinct growth, not just an overall color tint, is what
    // actually reads as "moss on a rock" rather than "greenish rock."
    // Genuinely emissive (purple) and twinkles, per explicit request.
    if (biome === "verdant") {
      const mossColor = new THREE.Color(0x3a6b2a).lerp(new THREE.Color(0x5c9a3a), rand());
      const mossGlow = new THREE.Color(0xb87cff);
      const mossMat = new THREE.MeshStandardMaterial({ color: mossColor, roughness: 1, flatShading: true, emissive: mossGlow, emissiveIntensity: 0.4 });
      mossMaterials.push(mossMat);
      const patchCount = 1 + Math.floor(rand() * 3);
      for (let p = 0; p < patchCount; p++) {
        const patchGeo = new THREE.SphereGeometry(scale * (0.15 + rand() * 0.18), 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5); // a flattened dome — a patch, not a full sphere growth. Was 5,3 segments — bumped per explicit "higher poly count" request
        const patch = new THREE.Mesh(patchGeo, mossMat);
        const pAngle = rand() * Math.PI * 2;
        const pDist = rand() * scale * 0.7;
        patch.position.set(
          rock.position.x + Math.cos(pAngle) * pDist,
          rock.position.y + scale * (0.35 + rand() * 0.3),
          rock.position.z + Math.sin(pAngle) * pDist
        );
        group.add(patch);
      }
    }
  }
  if (mossMaterials.length > 0) return { group, kind: "mossyProp", materials: mossMaterials, bobSeed: rand() * Math.PI * 2 }; // "mossyProp" kind twinkles the moss materials — see updateDecoration
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

// Paints a flat 2D conifer silhouette. All five archetypes are conifers
// drawn from a species chart, each a genuinely distinct silhouette family
// rather than a recolour of the same shape:
//   "spruce"   — classic tiered cone, drooping layers widening to a broad
//                base plus a thin leader spike (red/sitka spruce, noble
//                fir, sugar pine, deodar cedar)
//   "columnar" — tall narrow column that barely tapers; how LITTLE it
//                narrows is the whole silhouette (spartan juniper,
//                western larch)
//   "redwood"  — canopy confined to the upper half above a massive bare
//                trunk; that exposed bole is what reads as "giant"
//                (giant sequoia, california redwood, bald cypress)
//   "cedar"    — flat-topped and open, a few wide horizontal plates with
//                real air between them, crown widest near the TOP
//                (atlas cedar, red pine)
//   "yew"      — low dense rounded shrub on a stubby trunk, the only
//                archetype meant to read as undergrowth (hick's yew,
//                japanese yew)
// Each archetype has its own canvas width/height, trunk width, trunk
// start and world-space height multiplier — see the tables in this
// function and in createLivingTree, which must stay in agreement.
// Cedar is the one archetype with deliberate AIR between its canopy
// plates, so unlike the others its trunk has to be drawn all the way up
// through the crown — otherwise the plates have nothing behind them and
// read as separate discs floating in mid-air. Shared by both the
// trunkTop table and the cedar canopy code below so the two can never
// drift out of agreement.
const CEDAR_CANOPY_TOP = 0.12;

function createTreeTexture(seed, archetype, leafColorHex, capColorHex, barkColorHex) {
  const w = archetype === "columnar" ? 70 : archetype === "cedar" ? 180 : archetype === "yew" ? 140 : 150; // per-archetype canvas width — columnar is deliberately the narrowest and cedar the widest, since how broad each conifer is relative to its height IS its silhouette
  const h = archetype === "yew" ? 200 : archetype === "cedar" ? 360 : archetype === "columnar" ? 420 : archetype === "redwood" ? 560 : 460; // redwood tallest (sequoia/redwood are the giants of the chart), yew shortest (a low shrubby bush)
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
  // Cedar deliberately starts ABOVE its own topmost plate so the trunk
  // runs the full height of the open crown and visually connects every
  // plate. The others enclose their trunk in one continuous overlapping
  // canopy mass, so they only need a trunk below it.
  const trunkTop = archetype === "redwood" ? h * 0.45 : archetype === "columnar" ? h * 0.85 : archetype === "cedar" ? h * (CEDAR_CANOPY_TOP - 0.04) : archetype === "yew" ? h * 0.75 : h * 0.7; // redwood by far the lowest — its canopy stops near mid-height, leaving the huge bare bole that defines a sequoia
  // Every archetype here is a conifer, and conifer trunks are straight —
  // the old curved-trunk special case existed only for the removed palm.
  // Redwood/sequoia gets a far thicker trunk because its massive exposed
  // bole is the defining part of that silhouette.
  const trunkW = archetype === "redwood" ? w * 0.17 : archetype === "yew" ? w * 0.07 : w * 0.1;
  ctx.fillStyle = `#${new THREE.Color(barkColorHex).getHexString()}`;
  ctx.fillRect(w * 0.5 - trunkW, trunkTop, trunkW * 2, h - trunkTop);

  // Small moss patches on the lower trunk — real trees develop moss
  // near the base where it stays shaded/damp, and this is what actually
  // sells "living forest" rather than a uniformly clean painted trunk.
  const mossPatchCount = 2 + Math.floor((seed * 41) % 3);
  for (let m = 0; m < mossPatchCount; m++) {
    const my = h * (0.82 + ((seed * 17 + m) % 1) * 0.16);
    const mx = w * 0.5 + (((seed * 29 + m) % 1) - 0.5) * w * 0.16;
    const mr = w * (0.05 + ((seed * 13 + m) % 1) * 0.04);
    const grad = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
    grad.addColorStop(0, "#5c9a3a");
    grad.addColorStop(1, "rgba(92,154,58,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = `#${new THREE.Color(leafColorHex).getHexString()}`;

  if (archetype === "columnar") {
    // Spartan Juniper / Western Larch — a tall NARROW column of dense
    // short branchlets that barely tapers at all. How little it narrows
    // from base to tip is the entire silhouette; taper it like a spruce
    // and it stops being this tree.
    const tiers = 22;
    const topY = h * 0.04, bottomY = h * 0.9;
    const spacing = (bottomY - topY) / (tiers - 1);
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const y = topY + (bottomY - topY) * t;
      const hw = w * 0.5 * (0.22 + Math.pow(t, 0.7) * 0.62);
      const jx = (((seed * 17 + i * 5) % 1) - 0.5) * w * 0.05;
      // Overlapping ellipses (radius derived from spacing, so they always
      // overlap) rather than separate tiers — this tree reads as one
      // continuous dense column, not stacked layers.
      ctx.beginPath();
      ctx.ellipse(w * 0.5 + jx, y, hw, spacing * 1.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(w * 0.5, 0);
    ctx.lineTo(w * 0.5 + w * 0.07, topY + h * 0.06);
    ctx.lineTo(w * 0.5 - w * 0.07, topY + h * 0.06);
    ctx.closePath();
    ctx.fill();
  } else if (archetype === "redwood") {
    // Giant Sequoia / California Redwood / Bald Cypress — foliage is
    // confined to the UPPER portion above a massive bare trunk. That
    // huge exposed bole is what makes these read as giants rather than
    // just tall spruces, so the canopy deliberately stops around
    // mid-height (see the matching low trunkTop for this archetype).
    const topY = h * 0.05, bottomY = h * 0.55;
    const tiers = 12;
    const spacing = (bottomY - topY) / (tiers - 1);
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const y = topY + (bottomY - topY) * t;
      const hw = w * 0.5 * (0.12 + Math.pow(t, 1.1) * 0.86);
      const droop = spacing * (1.2 + t * 0.4) + h * 0.006; // > spacing, so tiers always overlap — same no-gap guarantee as spruce
      const jx = (((seed * 23 + i * 11) % 1) - 0.5) * w * 0.05;
      const cx = w * 0.5 + jx;
      ctx.beginPath();
      ctx.moveTo(cx, y - h * 0.008);
      ctx.quadraticCurveTo(cx + hw * 0.6, y + droop * 0.35, cx + hw, y + droop);
      ctx.quadraticCurveTo(cx + hw * 0.5, y + droop * 0.15, cx, y + h * 0.012);
      ctx.quadraticCurveTo(cx - hw * 0.5, y + droop * 0.15, cx - hw, y + droop);
      ctx.quadraticCurveTo(cx - hw * 0.6, y + droop * 0.35, cx, y - h * 0.008);
      ctx.closePath();
      ctx.fill();
    }
  } else if (archetype === "cedar") {
    // Atlas Cedar / Red Pine — FLAT-topped and open, built from a few
    // wide horizontal plates with real air between them rather than one
    // solid mass. Deliberately the one conifer here that does NOT use
    // the overlap guarantee: the visible gaps between plates are the
    // defining feature, so closing them would destroy the silhouette.
    const plates = 7 + Math.floor((seed % 1) * 4); // more, closer plates — a few widely-spaced discs read as floating objects rather than one open crown
    const topY = h * CEDAR_CANOPY_TOP, bottomY = h * 0.78;
    for (let i = 0; i < plates; i++) {
      const t = plates === 1 ? 0 : i / (plates - 1);
      const y = topY + (bottomY - topY) * t;
      // Widest in the upper third, tapering back in below — a cedar
      // crown spreads out on TOP, the opposite of a spruce's base-heavy
      // triangle.
      const hw = w * 0.5 * (0.35 + Math.sin((0.25 + t * 0.6) * Math.PI) * 0.63);
      const thick = h * (0.018 + (1 - t) * 0.012);
      const jx = (((seed * 29 + i * 13) % 1) - 0.5) * w * 0.06;
      ctx.beginPath();
      ctx.ellipse(w * 0.5 + jx, y, hw, thick, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (archetype === "yew") {
    // Hick's Yew / Japanese Yew — a dense, rounded, shrubby conifer on a
    // very short trunk. Broad and bushy rather than conical.
    const lobes = 6;
    const cyBase = h * 0.5;
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * Math.PI * 2 + seed * 3;
      const r = w * 0.26 * (0.8 + ((seed * 7 + i) % 1) * 0.5);
      ctx.beginPath();
      ctx.ellipse(w * 0.5 + Math.cos(a) * w * 0.17, cyBase + Math.sin(a) * h * 0.2, r, r * 1.15, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // A central mass so the ring of lobes reads as ONE dense bush rather
    // than separate blobs — same "guaranteed closing shape" idea used
    // across the other archetypes.
    ctx.beginPath();
    ctx.ellipse(w * 0.5, cyBase, w * 0.34, h * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Tall, narrow conifer built from many individually-drawn DROOPING
    // branch tiers — the defining detail of the reference's trees is
    // that you can read the separate layers, so this deliberately draws
    // each tier as its own swept shape (peak at the trunk, sagging down
    // and out to a point at each side) rather than one smooth cone,
    // which would lose exactly the quality that makes them recognizable.
    const tierCount = 14 + Math.floor((seed % 1) * 6);
    const topY = h * 0.03;
    const bottomY = h * 0.86; // not lower — the lowest tier's own droop extends past this, and going further would bury the trunk base entirely, losing the visible bare trunk the reference clearly shows
    const spacing = (bottomY - topY) / (tierCount - 1);
    for (let i = 0; i < tierCount; i++) {
      const t = i / (tierCount - 1); // 0 at the crown tip, 1 at the base
      const tierY = topY + (bottomY - topY) * t;
      // Strong taper: near-nothing at the crown widening to the full
      // half-width at the base. The high exponent is what actually makes
      // the upper tiers read as progressively SHORTER rather than merely
      // slightly narrower — a gentler curve leaves the top looking almost
      // as wide as the bottom.
      const halfWidth = w * 0.5 * (0.03 + Math.pow(t, 1.6) * 0.97);
      // Droop is DERIVED from the real tier spacing rather than being a
      // hand-tuned constant — because it's always greater than spacing,
      // each tier's drooping tip is guaranteed to reach past where the
      // next tier begins, so consecutive tiers always overlap and no gap
      // can open between them regardless of how tierCount happens to roll.
      const droop = spacing * (1.15 + t * 0.35) + h * 0.008;
      const jitter = (((seed * 31 + i * 7) % 1) - 0.5) * w * 0.04;
      const cx = w * 0.5 + jitter;
      ctx.beginPath();
      ctx.moveTo(cx, tierY - h * 0.012); // slight peak where the tier meets the trunk
      // Right side sweeping out and down to the drooping tip.
      ctx.quadraticCurveTo(cx + halfWidth * 0.6, tierY + droop * 0.35, cx + halfWidth, tierY + droop);
      // Underside sweeping back to the trunk, ending slightly below the
      // peak so the tier has real thickness instead of being a hairline.
      ctx.quadraticCurveTo(cx + halfWidth * 0.5, tierY + droop * 0.15, cx, tierY + h * 0.016);
      // Mirrored left side.
      ctx.quadraticCurveTo(cx - halfWidth * 0.5, tierY + droop * 0.15, cx - halfWidth, tierY + droop);
      ctx.quadraticCurveTo(cx - halfWidth * 0.6, tierY + droop * 0.35, cx, tierY - h * 0.012);
      ctx.closePath();
      ctx.fill();
    }
    // A narrow leader spike finishing the very top — real conifers come
    // to a thin point above the highest full tier, and without it the
    // silhouette ends bluntly.
    ctx.beginPath();
    ctx.moveTo(w * 0.5, 0);
    ctx.lineTo(w * 0.5 + w * 0.045, topY + h * 0.05);
    ctx.lineTo(w * 0.5 - w * 0.045, topY + h * 0.05);
    ctx.closePath();
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
const treeGlowTextureCache = new Map();
function createTreeGlowTexture(seed, archetype) {
  const w = archetype === "columnar" ? 70 : archetype === "cedar" ? 180 : archetype === "yew" ? 140 : 150; // per-archetype canvas width — columnar is deliberately the narrowest and cedar the widest, since how broad each conifer is relative to its height IS its silhouette
  const h = archetype === "yew" ? 200 : archetype === "cedar" ? 360 : archetype === "columnar" ? 420 : archetype === "redwood" ? 560 : 460; // redwood tallest (sequoia/redwood are the giants of the chart), yew shortest (a low shrubby bush)
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0d0616"; // near-black purple baseline — see the emissiveIntensity note where this material is built
  ctx.fillRect(0, 0, w, h);

  // A simple seeded pseudo-random helper, local to this function — the
  // recursive branch pattern below needs more random decisions per tree
  // than the old fixed spot-count loop did.
  let s = seed * 1000;
  function rnd() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  }

  // Glowing pink branch-like lines fanning up from the base into the
  // canopy — real forking structure (each segment splits into 2, angle
  // spread and length tapering with depth), not round dots. This is what
  // actually reads as "glowing branches" the way the reference image
  // does. Applies to every tree at every graphics tier — distinct from
  // the separate, High-tier-only 3D gnarled branch geometry added
  // earlier, which stays as-is alongside this.
  ctx.lineCap = "round";
  function drawBranch(x, y, angle, length, width, depth) {
    if (depth <= 0 || length < h * 0.02) return;
    const endX = x + Math.cos(angle) * length;
    const endY = y + Math.sin(angle) * length;
    const grad = ctx.createLinearGradient(x, y, endX, endY);
    grad.addColorStop(0, "rgba(60,240,255,0.95)");
    grad.addColorStop(1, "rgba(60,240,255,0.55)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    const forks = 2;
    for (let i = 0; i < forks; i++) {
      const spread = 0.35 + rnd() * 0.5;
      const newAngle = angle + (i === 0 ? -spread : spread);
      drawBranch(endX, endY, newAngle, length * (0.65 + rnd() * 0.15), width * 0.62, depth - 1);
    }
  }
  const trunkCount = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < trunkCount; i++) {
    const startX = w * (0.5 + (rnd() - 0.5) * 0.3);
    const startAngle = -Math.PI / 2 + (rnd() - 0.5) * 0.5; // roughly straight up (canvas Y grows downward), with some per-tree variance
    drawBranch(startX, h * 0.96, startAngle, h * 0.28, w * 0.045, 4);
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

// A palm tree — Coral Shallows' emergent island only. Genuinely distinct
// silhouette from Verdant's conifer family: a slender LEANING trunk
// (conifers stand straight) tapering to a crown of long drooping fronds
// radiating outward (conifers have a solid conical/columnar canopy, not
// separate blade shapes). Reuses createTreeSprite's proven jittered
// crossed-plane technique above, paired with a solid-black glow texture
// — palm trees don't need Verdant's bioluminescent glow-branch treatment,
// this is a bright sunlit beach.
let sharedPalmBlackTexture = null;
function getPalmBlackTexture() {
  if (sharedPalmBlackTexture) return sharedPalmBlackTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 2; canvas.height = 2;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, 2, 2);
  sharedPalmBlackTexture = new THREE.CanvasTexture(canvas);
  return sharedPalmBlackTexture;
}

function createPalmTexture(variantSeed, frondColorHex) {
  const w = 260, h = 420;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");

  // Trunk — a real lean (direction/amount varies per variant), tapering
  // from base to crown, with a few dark bark rings.
  const leanX = w * 0.16 * Math.sin(variantSeed * 6.2);
  const baseX = w * 0.5, baseY = h * 0.98;
  const topX = baseX + leanX, topY = h * 0.42;
  const bottomW = w * 0.07, topW = w * 0.03;
  ctx.fillStyle = "#8a6a4a";
  ctx.beginPath();
  ctx.moveTo(baseX - bottomW, baseY);
  ctx.quadraticCurveTo(baseX - bottomW * 0.5 + leanX * 0.5, h * 0.65, topX - topW, topY);
  ctx.lineTo(topX + topW, topY);
  ctx.quadraticCurveTo(baseX + bottomW * 0.5 + leanX * 0.5, h * 0.65, baseX + bottomW, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 2;
  for (let i = 1; i < 7; i++) {
    const ty = baseY - (baseY - topY) * (i / 7);
    const tx = baseX + leanX * (i / 7);
    const tw = bottomW + (topW - bottomW) * (i / 7);
    ctx.beginPath();
    ctx.moveTo(tx - tw, ty);
    ctx.lineTo(tx + tw, ty);
    ctx.stroke();
  }

  // Crown — long drooping fronds radiating from the top of the trunk,
  // each a tapered leaf shape (not a straight line) with a gradient from
  // a darker base to the fully-lit tip color.
  const frondCount = 7;
  for (let i = 0; i < frondCount; i++) {
    const angle = (i / frondCount) * Math.PI * 2 + variantSeed * 3;
    const droop = 0.35 + 0.25 * Math.abs(Math.sin(angle * 1.7 + variantSeed));
    const length = w * (0.42 + 0.1 * Math.sin(angle * 2.3));
    const dirX = Math.cos(angle), dirY = -Math.abs(Math.sin(angle)) * 0.3 - 0.55; // fans outward/up from the crown
    const endX = topX + dirX * length, endY = topY + dirY * length + length * droop; // droop pulls the tip back down
    const midX = topX + dirX * length * 0.55, midY = topY + dirY * length * 0.55 - length * 0.12;
    const grad = ctx.createLinearGradient(topX, topY, endX, endY);
    grad.addColorStop(0, "#2f7a38");
    grad.addColorStop(1, frondColorHex);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(midX - dirY * 8, midY + dirX * 8, endX, endY);
    ctx.quadraticCurveTo(midX + dirY * 8, midY - dirX * 8, topX, topY);
    ctx.closePath();
    ctx.fill();
  }

  // A few coconuts clustered under the crown.
  ctx.fillStyle = "#4a3320";
  for (let i = 0; i < 3; i++) {
    const a = variantSeed * 5 + i * 2.1;
    const cx = topX + Math.cos(a) * w * 0.05, cy = topY + h * 0.03 + Math.sin(a) * h * 0.02;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.02, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const PALM_TEXTURE_VARIANTS = 3;
const palmTextureCache = new Map();
function getPalmTexture(rand) {
  const frondColors = [0x3fae4a, 0x4fc25a, 0x2f9a3e];
  const frondColor = frondColors[Math.floor(rand() * frondColors.length)];
  let variants = palmTextureCache.get(frondColor);
  if (!variants) {
    variants = [];
    const frondHex = `#${frondColor.toString(16).padStart(6, "0")}`;
    for (let i = 0; i < PALM_TEXTURE_VARIANTS; i++) {
      variants.push(createPalmTexture((i + 1) / (PALM_TEXTURE_VARIANTS + 1), frondHex));
    }
    palmTextureCache.set(frondColor, variants);
  }
  return variants[Math.floor(rand() * variants.length)];
}

function createPalmTree(rand) {
  const tex = getPalmTexture(rand);
  const glowTex = getPalmBlackTexture();
  const height = 6 + rand() * 3.5;
  const width = height * (260 / 420); // matches createPalmTexture's own canvas aspect ratio
  const spriteGroup = createTreeSprite(tex, glowTex, width, height, rand);
  return {
    group: spriteGroup, kind: "tree", bobAmplitude: 0.03, bobSeed: rand() * Math.PI * 2, // reuses the same sway/shimmer animation createLivingTree gets — the glow-breathing part of that animation is a harmless no-op here since the glow texture is solid black
    material: spriteGroup.children[0].material,
  };
}

// A small cluster of fallen coconuts resting on the sand — the island's
// own ground clutter, distinct from the coconuts already painted into
// each palm tree's own canopy texture (those only read from a distance
// up in the crown; these are close-up detail on the beach itself).
function createCoconut(rand) {
  const group = new THREE.Group();
  const coconutMat = new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 0.85, flatShading: true });
  const count = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const s = 0.22 + rand() * 0.1;
    const coconut = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), coconutMat);
    const angle = rand() * Math.PI * 2, dist = rand() * 0.4;
    coconut.position.set(Math.cos(angle) * dist, s * 0.7, Math.sin(angle) * dist);
    coconut.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
    group.add(coconut);
  }
  return { group, kind: "rockCluster" }; // static prop, no animation needed — same inert kind rockCluster/geode already use
}

function createLivingTree(colorHex, rand) {
  const archetypeRoll = rand();
  // ALL-CONIFER mix matching the reference chart. Every tropical
  // archetype (palm/umbrella/banana/round/spreading) has been removed
  // outright — this is now five distinct conifer silhouette families
  // drawn from the chart: classic tiered cone (spruce/fir/sugar pine),
  // narrow column (juniper/larch), giant bare-boled tree (sequoia/
  // redwood/bald cypress), flat-topped open crown (atlas cedar/red
  // pine), and low dense shrub (yew).
  const archetype = archetypeRoll < 0.42 ? "spruce" : archetypeRoll < 0.62 ? "columnar" : archetypeRoll < 0.78 ? "cedar" : archetypeRoll < 0.92 ? "yew" : "redwood";
  const bark = VERDANT_BARK_PALETTE[Math.floor(rand() * VERDANT_BARK_PALETTE.length)];
  const leaf = VERDANT_LEAF_PALETTE[Math.floor(rand() * VERDANT_LEAF_PALETTE.length)];
  const cap = 0xd8f06a; // same vivid yellow-green highlight used elsewhere for Verdant foliage
  const tex = getTreeTexture(archetype, leaf, cap, bark, rand);
  const glowTex = getTreeGlowTexture(archetype, rand);

  const height = (4.5 + rand() * 8) * (archetype === "redwood" ? 2.4 : archetype === "spruce" ? 1.75 : archetype === "columnar" ? 1.5 : archetype === "cedar" ? 1.3 : archetype === "yew" ? 0.55 : 1); // redwood towers over everything (it is the giant of the chart); yew is deliberately low and shrubby, the only archetype meant to read as undergrowth
  // Width matches the canvas's own aspect ratio per archetype (see the w/h
  // values in createTreeTexture) so the painted silhouette doesn't stretch.
  const aspect = archetype === "yew" ? 140 / 200 : archetype === "cedar" ? 180 / 360 : archetype === "columnar" ? 70 / 420 : archetype === "redwood" ? 150 / 560 : 150 / 460; // each entry MUST equal that archetype's own w/h from createTreeTexture — any mismatch stretches or squashes the painted silhouette
  const width = height * aspect;

  const spriteGroup = createTreeSprite(tex, glowTex, width, height, rand);
  return {
    group: spriteGroup, kind: "tree", bobAmplitude: 0.02, bobSeed: rand() * Math.PI * 2,
    material: spriteGroup.children[0].material, // both crossed planes share one material — grabbing it here lets updateDecoration animate a subtle canopy shimmer without createRockSprite itself needing to expose it
  };
}

// A dark opening set into a rock outcrop, implying a cave system beneath
// Abyssal Drift's chasms without needing actual walkable interior
// geometry — the rock silhouette plus an unlit dark "hole" mesh in front
// of it is the standard cheap way to sell a cave mouth.
// A rock/ice wall with a genuine recessed opening the player can walk
// into — was previously a small round rock with a flat dark circle
// painted on its face, which is exactly why it read as "just a black
// rock" rather than a cave. Decorations have NO collision in this
// engine (confirmed: main.js's physics call only ever references the
// single terrain mesh, nothing decoration-related), so the player can
// already walk straight into whatever interior space this builds —
// this is a real explorable alcove, not an illusion, though it's a
// fixed-depth alcove rather than a true winding underground tunnel
// network, which would need a fundamentally different interior-level
// system to build convincingly.
function createCaveMouth(colorHex, rand, biome) {
  const group = new THREE.Group();
  const isFrost = biome === "frost";
  const wallColor = isFrost ? 0x3a5a68 : 0x2e2b38;
  const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: isFrost ? 0.3 : 0.9, metalness: isFrost ? 0.1 : 0, flatShading: true });

  // The wall face itself, built from several irregular blocks with a gap
  // left in the middle ones for the opening — reads as a genuine WALL
  // with a hole in it, not a boulder with a smudge.
  const wallWidth = 6 + rand() * 2, wallHeight = 5 + rand() * 1.5;
  const blockCount = 5;
  for (let i = 0; i < blockCount; i++) {
    const bx = (i / (blockCount - 1) - 0.5) * wallWidth * 1.1;
    if (Math.abs(bx) < wallWidth * 0.22) continue; // leave the middle blocks out for the opening
    const bw = (wallWidth / blockCount) * 1.4, bh = wallHeight * (0.8 + rand() * 0.4);
    const block = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 1.4 + rand() * 0.6), wallMat);
    block.position.set(bx, bh / 2, 0);
    block.rotation.y = (rand() - 0.5) * 0.15;
    group.add(block);
  }
  // A lintel spanning the top of the opening, so it reads as a proper
  // archway rather than just missing blocks.
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(wallWidth * 0.5, wallHeight * 0.35, 1.6), wallMat);
  lintel.position.set(0, wallHeight * 0.85, 0);
  group.add(lintel);

  // The actual recessed interior — real depth via a back wall several
  // units in, plus a floor and side walls, not a flat dark circle.
  const depth = 5 + rand() * 2;
  const interiorMat = new THREE.MeshStandardMaterial({ color: isFrost ? 0x0a1a24 : 0x0a0810, roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(wallWidth * 0.6, wallHeight * 0.8), interiorMat);
  backWall.position.set(0, wallHeight * 0.4, -depth);
  group.add(backWall);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(wallWidth * 0.55, depth), interiorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.02, -depth / 2);
  group.add(floor);
  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(depth, wallHeight * 0.8), interiorMat);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-wallWidth * 0.28, wallHeight * 0.4, -depth / 2);
  group.add(leftWall);
  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(depth, wallHeight * 0.8), interiorMat);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(wallWidth * 0.28, wallHeight * 0.4, -depth / 2);
  group.add(rightWall);

  // Stalagmites (rock) scattered on the cave floor for every biome, plus
  // hanging icicles from the entrance lintel for frost specifically —
  // real geometry the player walks among, not just a texture detail.
  const spikeMat = new THREE.MeshStandardMaterial({ color: isFrost ? 0xcfe8f2 : 0x4a4550, roughness: isFrost ? 0.15 : 0.85, metalness: isFrost ? 0.15 : 0, flatShading: true });
  const spikeCount = 5 + Math.floor(rand() * 4);
  for (let i = 0; i < spikeCount; i++) {
    const sx = (rand() - 0.5) * wallWidth * 0.45;
    const sz = -0.8 - rand() * (depth - 1.2);
    const sh = 0.6 + rand() * 1.4;
    const sr = 0.12 + rand() * 0.15;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(sr, sh, 6), spikeMat);
    spike.position.set(sx, sh / 2, sz);
    group.add(spike);
    if (isFrost && rand() < 0.5) {
      const ich = 0.5 + rand() * 1.0;
      const icicle = new THREE.Mesh(new THREE.ConeGeometry(sr * 0.8, ich, 6), spikeMat);
      icicle.position.set(sx, wallHeight * 0.85 - ich / 2, sz);
      icicle.rotation.x = Math.PI; // points downward, hanging from the lintel
      group.add(icicle);
    }
  }

  // A colored glow further back in the cavity, drawing the eye into the
  // depth rather than lighting the entrance itself.
  const light = new THREE.PointLight(colorHex, 0.5, 8);
  light.position.set(0, wallHeight * 0.4, -depth * 0.6);
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

function updateDecoration(handle, elapsed, dayAmount = 0) {
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
      // A slow, smooth breathing pulse on the canopy's own glow spots —
      // gradual in/out, not a sharp flash like the fireflies/moss/fungus
      // twinkle, so the whole tree reads as slowly "breathing" rather
      // than blinking. Breathing was already here but shallow (a
      // 2.4..4.8 swing, only 2:1), so it read as a steady glow rather
      // than something alive. Widened to roughly 5:1 so the pulse is
      // actually legible.
      //
      // Per-tree SPEED is varied here too, not just phase — a shared
      // speed with only a phase offset (bobSeed) keeps every tree locked
      // to the exact same rhythm forever, which can still read as one
      // coordinated wave sweeping through the forest rather than
      // independent trees. A second, differently-transformed use of
      // bobSeed (sin(bobSeed*7.3), decorrelated from the *1.3 used for
      // phase below) gives each tree its own breathing rate too, so they
      // drift in and out of sync with each other over time.
      const breatheSpeed = 0.45 + (Math.sin(handle.bobSeed * 7.3) * 0.5 + 0.5) * 0.35; // 0.45..0.80, per tree
      const breathe = 0.5 + 0.5 * Math.sin(elapsed * breatheSpeed + handle.bobSeed * 1.3); // 0..1
      // Glow is NIGHT-ONLY: fully off in daylight, ramping in as dusk falls.
      // Multiplying rather than adding a floor means it reaches genuine
      // zero both by day AND at the bottom of each breath — previously
      // `0.8 + breathe*3.6` had a floor that kept the glow always at
      // LEAST dim, which is exactly why the pulse was hard to notice:
      // it was breathing between "moderately bright" and "brighter,"
      // never OFF. Now it's `breathe * 5.5` with no floor at all, so
      // each tree genuinely turns off, then back on, once per cycle.
      // Note this also zeroes the glow map's near-black purple baseline
      // for that instant (it's painted into the same emissive map, so it
      // scales with the same intensity, not separately) — that's exactly
      // the intended "off" state, not a bug: real breathing has a bottom.
      const nightAmount = 1 - Math.min(1, Math.max(0, dayAmount / 0.3));
      handle.material.emissiveIntensity = nightAmount * breathe * 5.5;
    }
  } else if (handle.kind === "mossyProp") {
    // Same sharp on/off twinkle character as glowFungus — mostly dim,
    // briefly bright. All patches on one prop share a phase (so a given
    // rock/log's moss twinkles together), but different props each get
    // their own random bobSeed, so across the whole forest it reads as
    // many independent points twinkling asynchronously, like fireflies.
    const twinkle = Math.pow(Math.max(0, Math.sin(elapsed * 1.4 + handle.bobSeed)), 6);
    const intensity = 0.15 + twinkle * 3.5;
    for (const mat of handle.materials || []) mat.emissiveIntensity = intensity;
  } else if (handle.kind === "glowFungus") {
    // A genuine on/off TWINKLE — mostly dim, briefly bright — rather
    // than a smooth continuous breathing pulse. Raising sine to a high
    // power (clamped to positive first) produces sharp brief peaks with
    // long dim valleys between them, which is what actually reads as
    // "twinkling like fireflies" instead of slow organic glowing.
    const twinkle = Math.pow(Math.max(0, Math.sin(elapsed * 1.6 + handle.bobSeed)), 6);
    if (handle.material) handle.material.emissiveIntensity = 0.4 + twinkle * 4.2;
    if (handle.light) handle.light.intensity = 0.08 + twinkle * 1.3;
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

// Crystal (now the reef): a giant clam with a cluster of anemone
// tentacles inside its open shell — same split-shell-plus-nested-shards
// construction the old geode used, now a pearlescent shell instead of
// dull rock and colorful tentacles instead of crystal shards, distinct
// from the coral cluster's bare branching shards with no shell context.
function createGeode(colorHex, rand) {
  const group = new THREE.Group();
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xd8ccc0, roughness: 0.6, flatShading: true, side: THREE.DoubleSide, emissive: 0x6a5f52, emissiveIntensity: 0.08 });
  const shellR = 1.1 + rand() * 0.7;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(shellR, 8, 6, 0, Math.PI * 1.5), shellMat);
  shell.rotation.x = Math.PI * 0.15;
  shell.rotation.y = rand() * Math.PI * 2;
  shell.position.y = shellR * 0.4;
  group.add(shell);

  const tentacleColor = CORAL_PALETTE[Math.floor(rand() * CORAL_PALETTE.length)];
  const tentacleMat = new THREE.MeshStandardMaterial({
    color: tentacleColor, emissive: tentacleColor, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.9,
  });
  const tentacleCount = 4 + Math.floor(rand() * 4);
  for (let i = 0; i < tentacleCount; i++) {
    const s = shellR * (0.25 + rand() * 0.35);
    const tentacle = new THREE.Mesh(new THREE.OctahedronGeometry(s, 0), tentacleMat);
    const angle = rand() * Math.PI * 2, dist = rand() * shellR * 0.5;
    tentacle.position.set(Math.cos(angle) * dist, shellR * 0.3 + rand() * shellR * 0.4, Math.sin(angle) * dist);
    tentacle.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
    group.add(tentacle);
  }
  const light = new THREE.PointLight(tentacleColor, 0.4, 5);
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

function createUnderwaterLightShaft(x, z, groundY, waterY, rand) {
  const mat = new THREE.SpriteMaterial({
    map: getLightShaftTexture(), color: 0xbfe8ff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
    rotation: (rand() - 0.5) * 0.3,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.center.set(0.5, 1); // anchored at the top — the water surface — extending down toward the floor, not "canopy height" like the green forest version above
  const depth = Math.max(1, waterY - groundY);
  const length = Math.min(depth, 6 + rand() * 6); // real sunbeams fade out well before infinite depth — capped, and never longer than the actual local depth so it doesn't visibly poke through the sand
  sprite.scale.set(length * 0.32, length, 1);
  sprite.position.set(x, waterY, z);
  return { sprite, baseOpacity: 0.22 + rand() * 0.2 };
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

export { createDecoration, updateDecoration, createEmberFire, createLivingTree, createLightShaft, createUnderwaterLightShaft, updateLightShafts, disposeLightShafts, createRockCluster, createCaveMouth, applyVerticalGradient, createPalmTree };
