import * as THREE from "three";
import * as base from "./horizonSilhouettes.js";

export * from "./horizonSilhouettes.js";

// Static horizon optimizer. The original horizon deliberately builds many
// different cone/valley geometries, all with the same simple vertex-color basic
// material. BatchedMesh is the appropriate draw-call reducer for that pattern.
// If any compatibility check fails we leave the proven original hierarchy alone.
// Use ?perfLegacy=1 to force the original path.

const params = typeof location !== "undefined"
  ? new URLSearchParams(location.search)
  : null;
const PERF_LEGACY = params?.has("perfLegacy") === true;

function geometrySignature(mesh) {
  const g = mesh.geometry;
  const attrs = Object.entries(g.attributes || {})
    .map(([name, attr]) => `${name}:${attr.itemSize}:${attr.normalized ? 1 : 0}`)
    .sort()
    .join("|");
  return `${mesh.material.side}|${g.index ? "indexed" : "nonindexed"}|${attrs}`;
}

function eligible(mesh) {
  const m = mesh?.material;
  return !!(
    mesh?.isMesh
    && !mesh.isBatchedMesh
    && mesh.geometry?.attributes?.position
    && m?.isMeshBasicMaterial
    && m.vertexColors === true
    && m.transparent !== true
    && !m.map
  );
}

function batchStaticHorizon(handle) {
  if (!handle?.group || PERF_LEGACY || !THREE.BatchedMesh) return handle;

  const root = handle.group;
  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();

  root.traverse((obj) => {
    if (!eligible(obj)) return;
    const key = geometrySignature(obj);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(obj);
  });

  const batches = [];
  const batchMaterials = [];
  const removedMaterials = new Set();
  let sourceMeshCount = 0;

  try {
    for (const meshes of groups.values()) {
      if (meshes.length < 2) continue;

      let totalVertices = 0;
      let totalIndices = 0;
      for (const mesh of meshes) {
        totalVertices += mesh.geometry.attributes.position.count;
        totalIndices += mesh.geometry.index?.count || 0;
      }

      const sourceMaterial = meshes[0].material;
      const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        fog: sourceMaterial.fog !== false,
        side: sourceMaterial.side,
        transparent: false,
        depthTest: sourceMaterial.depthTest,
        depthWrite: sourceMaterial.depthWrite,
      });
      material.color.copy(sourceMaterial.color);

      const batch = new THREE.BatchedMesh(
        meshes.length,
        Math.max(1, totalVertices),
        Math.max(1, totalIndices || totalVertices * 2),
        material,
      );
      batch.name = `rift-horizon-batch-${batches.length}`;
      batch.perObjectFrustumCulled = true;
      batch.sortObjects = true;
      batch.castShadow = false;
      batch.receiveShadow = false;

      for (const mesh of meshes) {
        mesh.updateMatrixWorld(true);
        const geometryId = batch.addGeometry(mesh.geometry);
        const instanceId = batch.addInstance(geometryId);
        const localMatrix = new THREE.Matrix4()
          .multiplyMatrices(rootInverse, mesh.matrixWorld);
        batch.setMatrixAt(instanceId, localMatrix);
      }

      batch.computeBoundingBox();
      batch.computeBoundingSphere();
      root.add(batch);
      batches.push(batch);
      batchMaterials.push(material);

      for (const mesh of meshes) {
        sourceMeshCount++;
        removedMaterials.add(mesh.material);
        mesh.parent?.remove(mesh);
        // BatchedMesh has copied the attribute/index data into its own buffers.
        // These original static geometries are no longer rendered.
        mesh.geometry?.dispose?.();
      }
    }
  } catch (error) {
    console.warn("[rift-perf] Batched horizon conversion skipped:", error);
    // Conversion failures are rare and should never prevent the level loading.
    // If we already converted a subset, keep it; untouched groups remain valid.
  }

  for (const material of removedMaterials) material?.dispose?.();

  if (batches.length > 0) {
    // Night darkening operates on the batch materials exactly as it did on each
    // source MeshBasicMaterial before batching.
    handle.materials = [
      ...handle.materials.filter((m) => !removedMaterials.has(m)),
      ...batchMaterials,
    ];
    handle.__riftBatchedMeshes = batches;
    globalThis.__riftHorizonPerformance = {
      mode: "batched-static-horizon",
      sourceMeshes: sourceMeshCount,
      batches: batches.length,
      estimatedDrawCallReduction: Math.max(0, sourceMeshCount - batches.length),
    };
  }

  return handle;
}

export function createHorizonSilhouettes(...args) {
  return batchStaticHorizon(base.createHorizonSilhouettes(...args));
}

export function updateHorizonSilhouettes(...args) {
  return base.updateHorizonSilhouettes(...args);
}

export function disposeHorizonSilhouettes(scene, handle) {
  if (!handle?.__riftBatchedMeshes?.length) {
    return base.disposeHorizonSilhouettes(scene, handle);
  }

  scene.remove(handle.group);
  const batches = new Set(handle.__riftBatchedMeshes);
  handle.group.traverse((obj) => {
    if (batches.has(obj)) return;
    obj.geometry?.dispose?.();
    obj.material?.dispose?.();
  });
  for (const batch of batches) {
    batch.dispose?.();
    batch.material?.dispose?.();
  }
}
