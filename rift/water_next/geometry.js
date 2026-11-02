// Experimental GPU geometry binding using the shared FFT wave field.
// The existing game water mesh is never modified unless apply() is invoked.
// Uses the existing FFT buffers; no extra GPU dispatches or CPU readbacks.
import { positionLocal, vec2, vec3, float } from "three/tsl";

export function createWaterGeometryAdapter({ mesh, field }) {
  if (!mesh?.isMesh || !field?.sampleDisplacement || !field?.sampleNormal) {
    throw new TypeError("FFT mesh and functional wave field required");
  }
  const material = mesh.material;
  const savedPositionNode = material.positionNode;
  const savedNormalNode = material.normalNode;
  const position = positionLocal;
  const sampleXZ = vec2(position.x, position.z);
  // Preserve mesh local coordinates. This adapter assumes the original
  // fixed, origin-centered ocean mesh, and is intentionally opt-in until
  // shoreline/depth blending is carried across.
  const displacement = field.sampleDisplacement(sampleXZ);
  const heightNode = position.add(vec3(displacement.x, displacement.y, displacement.z));
  const normalNode = field.sampleNormal(sampleXZ);
  let active = false;

  return {
    mesh, field, positionNode: heightNode, normalNode,
    get active() { return active; },
    apply() {
      if (active) return;
      material.positionNode = heightNode;
      material.normalNode = normalNode;
      material.needsUpdate = true;
      active = true;
    },
    update() { return active; },
    restore() {
      if (!active) return;
      material.positionNode = savedPositionNode ?? null;
      material.normalNode = savedNormalNode ?? null;
      material.needsUpdate = true;
      active = false;
    },
    dispose() { this.restore(); },
  };
}
