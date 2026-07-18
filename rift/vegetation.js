import * as THREE from "three";

// -----------------------------------------------------------------------------
// SWAP POINT: ground-cover vegetation. Grass specifically uses
// THREE.InstancedMesh — thousands of blades as one draw call — since
// individual meshes per blade would be far too many objects for what's
// meant to be background texture, not a focal decoration (see
// decorations.js for those). Swap GRASS_STYLE for different biomes/colors,
// or the blade geometry itself, without touching placement or animation.
// -----------------------------------------------------------------------------

const GRASS_STYLE = {
  verdant: { count: 7000, colorA: 0x3a8f4a, colorB: 0x6fc76a, height: 1.1, bladeRadius: 0.16 },
  ashen: { count: 1400, colorA: 0x7a7261, colorB: 0x9a917c, height: 0.55, bladeRadius: 0.11 }, // sparse, dry, low — scrub clinging on in a dead lakebed, not a lawn
};

const dummy = new THREE.Object3D();

/**
 * Scatters an InstancedMesh of simple tapered-blade grass across a disc
 * around the origin, sampling the real terrain height at each blade so it
 * actually sits on the ground rather than floating/clipping.
 *
 * @param {THREE.Scene} scene
 * @param {string} biome
 * @param {(x:number, z:number) => number|null} sampleHeight
 * @param {number} radius  how far from center to scatter blades
 */
function createGrass(scene, biome, sampleHeight, radius) {
  const style = GRASS_STYLE[biome];
  if (!style) return null;

  // 0.05 previously — thin enough to be sub-pixel at normal viewing
  // distance, which is why grass wasn't actually reading as ground cover
  // despite thousands of instances existing. Width matters far more than
  // raw count for how "filled in" the ground looks.
  const bladeGeo = new THREE.ConeGeometry(style.bladeRadius, 1, 3);
  bladeGeo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true, side: THREE.DoubleSide });

  const mesh = new THREE.InstancedMesh(bladeGeo, mat, style.count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(style.count * 3), 3);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const baseColorA = new THREE.Color(style.colorA), baseColorB = new THREE.Color(style.colorB);
  const tmpColor = new THREE.Color();
  const swaySeeds = new Float32Array(style.count);
  let placed = 0;
  let attempts = 0;
  const maxAttempts = style.count * 3; // terrain height can return null near the very edge — retry a bounded number of times rather than looping forever
  while (placed < style.count && attempts < maxAttempts) {
    attempts++;
    const angle = Math.random() * Math.PI * 2, dist = Math.sqrt(Math.random()) * radius;
    const x = Math.cos(angle) * dist, z = Math.sin(angle) * dist;
    const y = sampleHeight(x, z);
    if (y === null) continue;

    const scale = (0.6 + Math.random() * 0.7) * style.height;
    dummy.position.set(x, y, z);
    dummy.rotation.y = Math.random() * Math.PI * 2;
    dummy.scale.set(1, scale, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);

    tmpColor.copy(baseColorA).lerp(baseColorB, Math.random());
    mesh.setColorAt(placed, tmpColor);
    swaySeeds[placed] = Math.random() * Math.PI * 2;
    placed++;
  }
  mesh.count = placed; // in case we hit maxAttempts before filling every instance
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  scene.add(mesh);
  return { mesh, swaySeeds, count: placed, baseMatrices: extractBaseTransforms(mesh, placed) };
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
    dummy.position.copy(t.pos);
    dummy.rotation.set(
      idleSway + Math.sin(windAngle) * windLean,
      swaySeeds[i],
      Math.cos(windAngle) * windLean
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

export { createGrass, updateGrass, disposeGrass };
