// Experimental Coral Shallows terrain draw culling.
// Reuses the existing original mesh and vertex attributes: no terrain
// resampling, no topology changes, and no gameplay/collision replacement.
// Enable only with ?riftTerrainChunks=on for mobile A/B profiling.
import * as THREE from "three";

export function createTerrainRenderChunks(sourceMesh, scene, divisions = 4) {
  const source = sourceMesh?.geometry;
  const positions = source?.getAttribute("position");
  const srcIndex = source?.getIndex();
  if (!positions || !srcIndex || !sourceMesh?.material) return null;
  const bounds = source.boundingBox?.clone() ||
    new THREE.Box3().setFromBufferAttribute(positions);
  const minX = bounds.min.x, minZ = bounds.min.z;
  const spanX = Math.max(0.01, bounds.max.x - minX);
  const spanZ = Math.max(0.01, bounds.max.z - minZ);
  const bins = Array.from({ length: divisions * divisions }, () => []);
  const element = srcIndex.array;
  const xAt = i => positions.getX(i);
  const zAt = i => positions.getZ(i);
  const count = element.length;
  // Classify triangles into contiguous terrain tiles. Border triangles
  // retain their exact original vertices, so there are no terrain cracks.
  for (let i = 0; i + 2 < count; i += 3) {
    const ia = element[i], ib = element[i + 1], ic = element[i + 2];
    const cx = (xAt(ia) + xAt(ib) + xAt(ic)) / 3;
    const cz = (zAt(ia) + zAt(ib) + zAt(ic)) / 3;
    const col = THREE.MathUtils.clamp(Math.floor((cx - minX) / spanX * divisions), 0, divisions - 1);
    const row = THREE.MathUtils.clamp(Math.floor((cz - minZ) / spanZ * divisions), 0, divisions - 1);
    bins[row * divisions + col].push(ia, ib, ic);
  }
  const group = new THREE.Group();
  group.name = "rift-island-render-chunks";
  let triangleTotal = 0;
  const chunkMeshes = [];
  for (let n = 0; n < bins.length; n++) {
    const indices = bins[n];
    if (!indices.length) continue;
    const geometry = new THREE.BufferGeometry();
    for (const key of Object.keys(source.attributes)) {
      // Shared vertex buffers are retained by the original source mesh;
      // each tile owns only its lightweight index buffer and bounding box.
      geometry.setAttribute(key, source.getAttribute(key));
    }
    geometry.setIndex(indices);
    const box = new THREE.Box3();
    const unique = new Set(indices);
    for (const index of unique) {
      box.expandByPoint(new THREE.Vector3(
        positions.getX(index), positions.getY(index), positions.getZ(index)
      ));
    }
    geometry.boundingBox = box;
    geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    const tile = new THREE.Mesh(geometry, sourceMesh.material);
    tile.name = "rift-island-terrain-tile";
    tile.frustumCulled = true;
    tile.receiveShadow = sourceMesh.receiveShadow;
    tile.castShadow = sourceMesh.castShadow;
    group.add(tile);
    chunkMeshes.push(tile);
    triangleTotal += indices.length / 3;
  }
  if (!chunkMeshes.length) return null;
  scene.add(group);
  // Original retains exact geometry for sampling and player physics.
  // Three.js raycasting does not require the visual Mesh.visible flag.
  sourceMesh.visible = false;
  globalThis.__riftTerrainChunks = {
    active: true, tiles: chunkMeshes.length, triangles: triangleTotal,
    divisions, originalRetainedForPhysics: true,
  };
  return {
    group, chunkMeshes,
    dispose() {
      scene.remove(group);
      for (const tile of chunkMeshes) {
        tile.geometry.dispose(); // shared material/attributes belong to source
      }
      group.clear();
      sourceMesh.visible = true;
      delete globalThis.__riftTerrainChunks;
    },
  };
}
