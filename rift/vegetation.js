import * as THREE from "three";
import { getGraphicsSettings } from "./graphicsSettings.js";

// -----------------------------------------------------------------------------
// SWAP POINT: ground-cover vegetation. Grass specifically uses
// THREE.InstancedMesh — thousands of blades as one draw call — since
// individual meshes per blade would be far too many objects for what's
// meant to be background texture, not a focal decoration (see
// decorations.js for those). Color is baked directly into the shared
// blade geometry as a real vertex-color gradient (dark at the base,
// bright toward the tip) — the same proven technique liquid.js already
// uses, rather than relying solely on InstancedMesh.instanceColor, which
// turned out not to reliably read as intended. Swap GRASS_STYLE for
// different biomes/colors, or the blade geometry itself, without touching
// placement or animation.
// -----------------------------------------------------------------------------

const GRASS_STYLE = {
  // Ankle-to-shin height, not the shoulder-height spikes this used to be —
  // a meadow you walk *through*, not a field of thin trees. tuftSize
  // clusters several blades per sampled ground point so it reads as a
  // dense clump rather than one lonely blade per patch of dirt.
  verdant: {
    tuftCount: 9500, tuftSize: 6, baseColor: 0x2f7a3a, tipColor: 0x9ee86b,
    height: 0.42, heightVariance: 0.24, bladeRadius: 0.05, bladeWidth: 0.36,
  },
  ashen: {
    tuftCount: 500, tuftSize: 2, baseColor: 0x6f6552, tipColor: 0xb6a97e,
    height: 0.24, heightVariance: 0.12, bladeRadius: 0.035, bladeWidth: 0.22,
  }, // sparse, dry, low — scrub clinging on in a dead lakebed, not a lawn
  // Crystal Spire, redesigned as a reef: the same swaying-blade system
  // reused as kelp/seaweed fronds instead of grass — much taller than any
  // land biome's grass and far sparser (a reef floor is sand and coral,
  // not solid ground cover), with a teal-to-bright-green gradient rather
  // than an ordinary meadow green.
  crystal: {
    tuftCount: 900, tuftSize: 4, baseColor: 0x0f5a52, tipColor: 0x6ffbb0,
    height: 1.3, heightVariance: 0.6, bladeRadius: 0.05, bladeWidth: 0.3,
  },
};

// Small ground-level flowers scattered among the grass — each color gets
// its own InstancedMesh with a plain solid-color material rather than
// vertex/instance color, which is the simplest possible approach and
// guarantees the right color shows regardless of how any given renderer
// handles the fancier per-instance-color paths.
const FLOWER_STYLE = {
  verdant: {
    tuftCount: 700, colors: [0xff8fd6, 0x8fc9ff, 0xc9a0ff, 0xffb3e6], stemColor: 0x2d5a2a, // pink/blue/purple — was pink/yellow/purple/cream
    height: 0.22, heightVariance: 0.08, headSize: 0.075,
    glowColors: [0xff8fd6, 0x8fc9ff, 0xc9a0ff], // 3 of the 4 colors now glow (was just 1) — a real pink/blue/purple bioluminescent presence, not a single accent color
  },
  // Crystal Spire, redesigned as a reef: small anemone/coral-polyp buds
  // scattered low among the kelp and coral clusters, reusing the same
  // instanced-octahedron-head system as Verdant's flowers. Every color
  // glows here (unlike Verdant's partial set) since a reef genuinely
  // reads as bioluminescent/vivid throughout, not just in a few accent
  // spots.
  crystal: {
    tuftCount: 550, colors: [0xff6f9e, 0xffe066, 0x3ce7ff, 0xb35cff], stemColor: 0x2a5a52,
    height: 0.18, heightVariance: 0.1, headSize: 0.09,
    glowColors: [0xff6f9e, 0xffe066, 0x3ce7ff, 0xb35cff],
  },
};

const dummy = new THREE.Object3D();

// A single blade's geometry, shared by every instance — a flattened cone
// reads as a blade of grass better than a perfectly round one does, and a
// real color gradient (dark base -> bright tip, baked once here) is what
// actually guarantees the grass reads as green regardless of how the
// renderer handles per-instance color.
// A painted 2D blade shape — a real tapered blade silhouette (narrow
// point at the tip, slightly wider base) with the base->tip color
// gradient baked directly into the pixels, rather than a 3D cone with a
// vertex-color gradient. This is what "2D grass" actually means in
// practice: a flat billboard card cut out via alpha instead of solid
// geometry — the same painted-canvas-texture technique already used
// throughout this project (landmarks.js's flame/vein textures,
// decorations.js's createFlameTexture) rather than a new one-off.
function buildBladeTexture(baseColorHex, tipColorHex) {
  const w = 28, h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");

  // A gentle curve rather than a perfectly straight blade — real grass
  // blades bow slightly, and a dead-straight silhouette reads as plastic.
  const bend = w * 0.22;
  ctx.beginPath();
  ctx.moveTo(w * 0.32, h);
  ctx.quadraticCurveTo(w * 0.5 + bend * 0.5, h * 0.45, w * 0.5 + bend, 0);
  ctx.lineTo(w * 0.5 + bend * 0.75, h * 0.06);
  ctx.quadraticCurveTo(w * 0.5 + bend * 0.35, h * 0.5, w * 0.68, h);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, `#${new THREE.Color(baseColorHex).getHexString()}`);
  grad.addColorStop(1, `#${new THREE.Color(tipColorHex).getHexString()}`);
  ctx.fillStyle = grad;
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; // required for painted canvas textures in this project or they render washed-out/pale
  return tex;
}

// Unit flat card — base at y=0, tip at y=1 (matching how the placement
// loop below scales it), centered on X so per-instance width scaling
// stays centered on the tuft point the way the old cone did.
function buildBladeGeometry() {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);
  return geo;
}

/**
 * Scatters an InstancedMesh of grass blades, clustered into small tufts
 * around sampled ground points rather than one blade per point, across
 * the landmass's actual square footprint. Samples the real terrain
 * height at each tuft so it actually sits on the ground rather than
 * floating/clipping.
 *
 * @param {THREE.Scene} scene
 * @param {string} biome
 * @param {(x:number, z:number) => number|null} sampleHeight
 * @param {number} radius  half the side length of the square area to cover (was a circular radius — the landmass itself is square, so a circular disc always left the corners bare no matter how dense the grass was)
 */
function createGrass(scene, biome, sampleHeight, radius) {
  const style = GRASS_STYLE[biome];
  if (!style) return null;
  const gfx = getGraphicsSettings();
  const tuftCount = Math.max(1, Math.round(style.tuftCount * gfx.grassMultiplier));
  const bladeCount = tuftCount * style.tuftSize;

  const bladeGeo = buildBladeGeometry();
  const bladeTex = buildBladeTexture(style.baseColor, style.tipColor);
  // alphaTest (not just transparent blending) cuts the blade shape out
  // hard rather than soft-blending it — avoids the sorting artifacts
  // InstancedMesh + alpha-blended transparency is prone to, and (unlike
  // pure alpha blending) still shadow-casts correctly to the cutout
  // shape rather than a full rectangular card.
  const mat = new THREE.MeshStandardMaterial({
    map: bladeTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.85,
    emissive: 0x000000, emissiveIntensity: 0, // starts off — updateGrass fades this in as a pink glow at night, since a diffuse color tint alone would be invisible under Verdant's crushed-dark night lighting
  });

  const mesh = new THREE.InstancedMesh(bladeGeo, mat, bladeCount);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const swaySeeds = new Float32Array(bladeCount);
  let placedBlades = 0;
  let attempts = 0;
  const maxAttempts = tuftCount * 3; // terrain height can return null near the very edge — retry a bounded number of times rather than looping forever
  let tuftsPlaced = 0;
  while (tuftsPlaced < tuftCount && attempts < maxAttempts) {
    attempts++;
    // Uniform over the square, not a circular disc — see the radius
    // param's doc comment above for why.
    const tuftX = (Math.random() * 2 - 1) * radius, tuftZ = (Math.random() * 2 - 1) * radius;
    const tuftY = sampleHeight(tuftX, tuftZ);
    if (tuftY === null) continue;
    tuftsPlaced++;

    for (let b = 0; b < style.tuftSize; b++) {
      const jitterR = Math.random() * 0.35;
      const jitterAngle = Math.random() * Math.PI * 2;
      const x = tuftX + Math.cos(jitterAngle) * jitterR;
      const z = tuftZ + Math.sin(jitterAngle) * jitterR;
      const h = style.height + (Math.random() - 0.5) * style.heightVariance;
      const w = style.bladeWidth * (0.8 + Math.random() * 0.4);

      dummy.position.set(x, tuftY, z);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      dummy.scale.set(w, h, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(placedBlades, dummy.matrix);
      swaySeeds[placedBlades] = Math.random() * Math.PI * 2;
      placedBlades++;
    }
  }
  mesh.count = placedBlades; // in case we hit maxAttempts before filling every tuft
  mesh.instanceMatrix.needsUpdate = true;

  scene.add(mesh);
  return { mesh, swaySeeds, count: placedBlades, baseMatrices: extractBaseTransforms(mesh, placedBlades), material: mat };
}

/**
 * Scatters small flower heads among the grass, one InstancedMesh per
 * color so each batch can use a plain solid-color material — deliberately
 * simpler than the grass blade's baked-gradient approach, since a flower
 * head is a single flat color, not a gradient.
 *
 * @param {THREE.Scene} scene
 * @param {string} biome
 * @param {(x:number, z:number) => number|null} sampleHeight
 * @param {number} radius  half the side length of the square area to cover (see createGrass's matching doc comment)
 */
function createFlowers(scene, biome, sampleHeight, radius) {
  const style = FLOWER_STYLE[biome];
  if (!style) return null;
  const gfx = getGraphicsSettings();
  const totalCount = Math.max(1, Math.round(style.tuftCount * gfx.grassMultiplier));
  const perColor = Math.max(1, Math.round(totalCount / style.colors.length));

  const headGeo = new THREE.OctahedronGeometry(style.headSize, 0);
  const batches = style.colors.map((colorHex) => {
    const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.5, flatShading: true });
    const isGlow = !!(style.glowColors && style.glowColors.includes(colorHex));
    if (isGlow) {
      mat.emissive = new THREE.Color(colorHex);
      mat.emissiveIntensity = 2.8;
    }
    const mesh = new THREE.InstancedMesh(headGeo, mat, perColor);
    mesh.castShadow = true;
    scene.add(mesh);
    return { mesh, placed: 0, material: mat, isGlow, phase: Math.random() * Math.PI * 2 };
  });

  let attempts = 0;
  const maxAttempts = totalCount * 3;
  let placedTotal = 0;
  while (placedTotal < totalCount && attempts < maxAttempts) {
    attempts++;
    const x = (Math.random() * 2 - 1) * radius, z = (Math.random() * 2 - 1) * radius;
    const y = sampleHeight(x, z);
    if (y === null) continue;

    const batch = batches[placedTotal % batches.length];
    if (batch.placed >= perColor) { placedTotal++; continue; } // this color's allotment is full — still counts toward the overall total so the loop terminates
    const h = style.height + (Math.random() - 0.5) * style.heightVariance;
    dummy.position.set(x, y + h, z); // sits just above where the grass tips would be, like a bloom peeking through
    dummy.rotation.set(Math.random() * 0.3, Math.random() * Math.PI * 2, Math.random() * 0.3);
    dummy.scale.setScalar(0.8 + Math.random() * 0.5);
    dummy.updateMatrix();
    batch.mesh.setMatrixAt(batch.placed, dummy.matrix);
    batch.placed++;
    placedTotal++;
  }
  for (const batch of batches) {
    batch.mesh.count = batch.placed;
    batch.mesh.instanceMatrix.needsUpdate = true;
  }

  return { batches };
}

function disposeFlowers(scene, handle) {
  if (!handle) return;
  for (const batch of handle.batches) {
    scene.remove(batch.mesh);
    batch.mesh.material.dispose();
  }
  handle.batches[0]?.mesh.geometry.dispose(); // shared geometry across every batch — dispose once
}

// Cached per-instance position/rotation/scale so the per-frame sway can
// recompute a fresh matrix each time without drifting (re-reading back out
// of the instance matrix every frame would accumulate floating-point
// error over a long session).
function extractBaseTransforms(mesh, count) {
  const transforms = [];
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    mesh.getMatrixAt(i, m);
    m.decompose(pos, quat, scale);
    transforms.push({ pos: pos.clone(), scale: scale.clone() });
  }
  return transforms;
}

function updateGrass(handle, elapsed, windX = 0, windZ = 0, dayAmount = 1) {
  if (!handle) return;
  const { mesh, swaySeeds, count, baseMatrices, material } = handle;
  // Fades toward a violet-blue bioluminescent tint/glow as night falls —
  // both the diffuse color (so it visibly reads as tinted even where some
  // ambient light still reaches it) AND real emissive glow (so it stays
  // visible at all under Verdant's crushed-dark night lighting, which
  // would otherwise swallow a diffuse-only tint into blackness).
  if (material) {
    const nightAmount = Math.max(0, Math.min(1, 1 - dayAmount / 0.3));
    material.color.setRGB(1, 1, 1).lerp(new THREE.Color(0x7050e8), nightAmount * 0.7);
    material.emissive.setHex(0x5a30d0);
    material.emissiveIntensity = nightAmount * 0.9;
  }
  const windLean = Math.min(0.5, Math.hypot(windX, windZ) * 0.15); // caps how far wind alone can bend a blade, idle sway still layers on top
  const windAngle = Math.atan2(windZ, windX);
  for (let i = 0; i < count; i++) {
    const t = baseMatrices[i];
    const idleSway = Math.sin(elapsed * 1.6 + swaySeeds[i]) * 0.12;
    const fixedLean = Math.sin(swaySeeds[i] * 3.7) * 0.12; // a slight per-blade natural tilt, not perfectly vertical — derived from the existing seed rather than needing separate storage
    dummy.position.copy(t.pos);
    dummy.rotation.set(
      idleSway + Math.sin(windAngle) * windLean,
      swaySeeds[i],
      fixedLean + Math.cos(windAngle) * windLean
    );
    dummy.scale.copy(t.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// A slow, smooth breathing pulse on each glowing flower color batch —
// gradual in/out, matching the same "breathing" character as the tree
// canopy glow (distinct from the sharp firefly-style twinkle used for
// moss/fungus/motes). Each color batch gets its own phase so pink/blue/
// purple flowers don't all breathe in perfect unison across the field.
function updateFlowers(handle, elapsed) {
  if (!handle) return;
  for (const batch of handle.batches) {
    if (!batch.isGlow) continue;
    const breathe = 0.5 + 0.5 * Math.sin(elapsed * 0.5 + batch.phase);
    batch.material.emissiveIntensity = 1.4 + breathe * 2.2;
  }
}

function disposeGrass(scene, handle) {
  if (!handle) return;
  scene.remove(handle.mesh);
  handle.mesh.geometry.dispose();
  handle.mesh.material.dispose();
}

// A soft round glow dot for the footstep points — without this, Points
// render as hard squares.
let sharedFootstepGlowTexture = null;
function getFootstepGlowTexture() {
  if (sharedFootstepGlowTexture) return sharedFootstepGlowTexture;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  sharedFootstepGlowTexture = new THREE.CanvasTexture(canvas);
  return sharedFootstepGlowTexture;
}

// A pooled ring buffer of glow points that appear at the player's feet
// on each footstep and fade out — makes the ground/grass visibly react
// to the player walking through it, not just glow ambiently on its own.
// Uses per-VERTEX color rather than per-point opacity (PointsMaterial
// only supports one opacity for the whole system) — with additive
// blending, a point whose color has faded to black contributes nothing
// to the final image, so it reads as fully invisible without needing a
// custom shader to fade points independently.
function createFootstepGlowSystem(scene, maxPoints) {
  const positions = new Float32Array(maxPoints * 3);
  const colors = new Float32Array(maxPoints * 3); // starts all black/invisible
  const life = new Float32Array(maxPoints);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    map: getFootstepGlowTexture(), vertexColors: true, size: 0.7, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  return { points, life, maxPoints, nextIndex: 0 };
}

function spawnFootstepGlow(handle, x, y, z) {
  if (!handle) return;
  const i = handle.nextIndex;
  handle.nextIndex = (handle.nextIndex + 1) % handle.maxPoints;
  const posAttr = handle.points.geometry.attributes.position;
  posAttr.setXYZ(i, x + (Math.random() - 0.5) * 0.5, y + 0.08, z + (Math.random() - 0.5) * 0.5);
  posAttr.needsUpdate = true;
  handle.life[i] = 1;
}

function updateFootstepGlowSystem(handle, dt) {
  if (!handle) return;
  const colorAttr = handle.points.geometry.attributes.color;
  let changed = false;
  for (let i = 0; i < handle.maxPoints; i++) {
    if (handle.life[i] > 0) {
      handle.life[i] = Math.max(0, handle.life[i] - dt * 1.1); // fades over roughly a second
      const b = handle.life[i];
      colorAttr.setXYZ(i, b * 1.0, b * 0.3, b * 0.75); // pink/magenta hue, dims to black (invisible under additive blending) as it fades
      changed = true;
    }
  }
  if (changed) colorAttr.needsUpdate = true;
}

function disposeFootstepGlowSystem(scene, handle) {
  if (!handle) return;
  scene.remove(handle.points);
  handle.points.geometry.dispose();
  handle.points.material.dispose();
}

// -----------------------------------------------------------------------------
// SUN CAUSTICS — the shifting mesh of bright light patches shallow water
// casts on a sand floor once sunlight passes through its rippling surface.
// Per an explicit reference photo where this is the single most visually
// defining feature of the scene (not the occasional mid-water sunbeam
// shafts weather.js already has — this is specifically FLOOR-projected
// light). Crystal (Coral Shallows) only — no other biome is a shallow lit
// seafloor. Built as one Points cloud with per-vertex animated color, the
// SAME proven technique createFootstepGlowSystem above already uses
// (explicitly NOT InstancedMesh.instanceColor, which this file's own
// top-of-file note already flags as unreliable here) — each patch needs
// its own independently flickering brightness, and a real BufferAttribute
// color channel is what reliably delivers that. Ground-hugging via the
// same sampleHeight placement technique flowers/grass already use, so it
// follows the actual sand/reef contour instead of floating at one fixed
// height across a landmass whose elevation varies a lot (sand troughs vs
// reef mounds).
// -----------------------------------------------------------------------------

// An irregular, soft-edged blotch — several overlapping radial blobs of
// decreasing size/opacity rather than one clean circle, since a real
// caustic cell has a webbed, organic outline, not a perfect disc.
let sharedCausticTexture = null;
function getCausticTexture() {
  if (sharedCausticTexture) return sharedCausticTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const blobs = [
    { x: 0.5, y: 0.5, r: 0.46, a: 0.9 },
    { x: 0.32, y: 0.4, r: 0.24, a: 0.6 },
    { x: 0.68, y: 0.42, r: 0.22, a: 0.55 },
    { x: 0.48, y: 0.68, r: 0.26, a: 0.6 },
  ];
  for (const b of blobs) {
    const grad = ctx.createRadialGradient(b.x * size, b.y * size, 0, b.x * size, b.y * size, b.r * size);
    grad.addColorStop(0, `rgba(255,255,255,${b.a})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(b.x * size, b.y * size, b.r * size, 0, Math.PI * 2);
    ctx.fill();
  }
  sharedCausticTexture = new THREE.CanvasTexture(canvas);
  return sharedCausticTexture;
}

/**
 * @param {THREE.Scene} scene
 * @param {string} biome
 * @param {(x:number, z:number) => number|null} sampleHeight
 * @param {number} radius
 */
function createCaustics(scene, biome, sampleHeight, radius) {
  if (biome !== "crystal") return null; // only Coral Shallows is a shallow lit seafloor
  const count = 260;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const speeds = new Float32Array(count);
  let placed = 0;
  let attempts = 0;
  const maxAttempts = count * 4;
  while (placed < count && attempts < maxAttempts) {
    attempts++;
    const x = (Math.random() * 2 - 1) * radius, z = (Math.random() * 2 - 1) * radius;
    const y = sampleHeight(x, z);
    if (y === null) continue;
    positions[placed * 3] = x;
    positions[placed * 3 + 1] = y + 0.05; // just above the actual sand/reef surface at this exact point — hugs the real contour rather than floating at one fixed height
    positions[placed * 3 + 2] = z;
    colors[placed * 3] = colors[placed * 3 + 1] = colors[placed * 3 + 2] = 1; // updateCaustics scales brightness via this each frame
    seeds[placed] = Math.random() * Math.PI * 2;
    speeds[placed] = 0.3 + Math.random() * 0.6; // independent flicker speeds so patches don't pulse in unison
    placed++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions.slice(0, placed * 3), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors.slice(0, placed * 3), 3));
  const mat = new THREE.PointsMaterial({
    map: getCausticTexture(), vertexColors: true, color: 0xeafffa, size: 4.2, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  return { points, seeds: seeds.slice(0, placed), speeds: speeds.slice(0, placed), count: placed };
}

function updateCaustics(handle, elapsed) {
  if (!handle) return;
  const colorAttr = handle.points.geometry.attributes.color;
  for (let i = 0; i < handle.count; i++) {
    // Flicker between dim and bright rather than fully off — real
    // caustic light never goes fully dark, it just concentrates
    // elsewhere for a moment.
    const flicker = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(elapsed * handle.speeds[i] + handle.seeds[i]));
    colorAttr.setXYZ(i, flicker, flicker, flicker);
  }
  colorAttr.needsUpdate = true;
}

function disposeCaustics(scene, handle) {
  if (!handle) return;
  scene.remove(handle.points);
  handle.points.geometry.dispose();
  handle.points.material.dispose();
}

export { createGrass, updateGrass, disposeGrass, createFlowers, updateFlowers, disposeFlowers, createFootstepGlowSystem, spawnFootstepGlow, updateFootstepGlowSystem, disposeFootstepGlowSystem, createCaustics, updateCaustics, disposeCaustics };
