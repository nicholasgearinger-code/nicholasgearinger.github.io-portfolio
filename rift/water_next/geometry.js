// Geometry adapter: no duplicate wave motion is generated here.
export function createWaterGeometryAdapter({ mesh, field }) {
  if (!mesh?.isMesh || !field?.source) throw new TypeError("mesh and wave field required");
  return {
    mesh, field,
    update({ camera } = {}) {
      // LOD and camera-centered rings will be implemented behind this adapter.
      // Existing production geometry stays active until validation.
      return Boolean(camera);
    },
    dispose() {},
  };
}
