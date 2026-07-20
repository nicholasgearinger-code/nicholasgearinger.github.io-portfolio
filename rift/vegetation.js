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
    tuftCount: 6000, tuftSize: 5, baseColor: 0x2f7a3a, tipColor: 0x9ee86b,
    height: 0.42, heightVariance: 0.24, bladeRadius: 0.05, bladeWidth: 0.36,
  },
  ashen: {
    tuftCount: 500, tuftSize: 2, baseColor: 0x6f6552, tipColor: 0xb6a97e,
    height: 0.24, heightVariance: 0.12, bladeRadius: 0.035, bladeWidth: 0.22,
  }, // sparse, dry, low — scrub clinging on in a dead lakebed, not a lawn
};

// Small ground-level flowers scattered among the grass — each color gets
// its own InstancedMesh with a plain solid-color material rather than
// vertex/instance color, which is the simplest possible approach and
// guarantees the right color shows regardless of how any given renderer
// handles the fancier per-instance-color paths.
const FLOWER_STYLE = {
  verdant: {
    tuftCount: 700, colors: [0xff8fd6, 0xffd36e, 0xc9a0ff, 0xfff6e0], stemColor: 0x2d5a2a,
    height: 0.22, heightVariance: 0.08, headSize: 0.075,
  },
};

const dummy = new THREE.Object3D();

// A single blade's geometry, shared by every instance — a flattened cone
// reads as a blade of grass better than a perfectly round one does, and a
// real color gradient (dark base -> bright tip, baked once here) is what
// actually guarantees the grass reads as green regardless of how the
// renderer handles per-instance color.
function buildBladeGeometry(radialSegments, baseColor, tipColor) {
  const geo = new THREE.ConeGeometry(1, 1, radialSegments); // unit cone — actual radius/height applied per-instance via the transform matrix instead of baked into the geometry, so one shared geometry serves every blade size variant
  geo.translate(0, 0.5, 0); // base at y=0, tip at y=1, matching how the placement loop below expects to scale it
  geo.scale(1, 1, 0.35); // flatten one axis — a blade-like sliver instead of a perfectly round spike

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const base = new THREE.Color(baseColor), tip = new THREE.Color(tipColor), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i), 0, 1); // 0 at base, 1 at tip
    tmp.copy(base).lerp(tip, t);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
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

  const bladeGeo = buildBladeGeometry(gfx.grassBladeSegments, style.baseColor, style.tipColor);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true, side: THREE.DoubleSide });

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
      dummy.scale.set(w, h, w);
      dummy.updateMatrix();
      mesh.setMatrixAt(placedBlades, dummy.matrix);
      swaySeeds[placedBlades] = Math.random() * Math.PI * 2;
      placedBlades++;
    }
  }
  mesh.count = placedBlades; // in case we hit maxAttempts before filling every tuft
  mesh.instanceMatrix.needsUpdate = true;

  scene.add(mesh);
  return { mesh, swaySeeds, count: placedBlades, baseMatrices: extractBaseTransforms(mesh, placedBlades) };
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
    const mesh = new THREE.InstancedMesh(headGeo, mat, perColor);
    mesh.castShadow = true;
    scene.add(mesh);
    return { mesh, placed: 0 };
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

function updateGrass(handle, elapsed, windX = 0, windZ = 0) {
  if (!handle) return;
  const { mesh, swaySeeds, count, baseMatrices } = handle;
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

function disposeGrass(scene, handle) {
  if (!handle) return;
  scene.remove(handle.mesh);
  handle.mesh.geometry.dispose();
  handle.mesh.material.dispose();
}

export { createGrass, updateGrass, disposeGrass, createFlowers, disposeFlowers };
