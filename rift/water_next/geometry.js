// Experimental combined FFT/shallow-water vertex binding. Opt-in only.
// Uses existing GPU buffers; does not allocate or dispatch a new solver.
import { positionLocal, attribute, vec2, vec3, float, uint, floor, min, mix, smoothstep, clamp } from "three/tsl";

function sampleShallowHeight(buffer, coord, n = 256) {
  const x0 = floor(coord.x);
  const y0 = floor(coord.y);
  const x1 = min(x0.add(1), float(n - 1));
  const y1 = min(y0.add(1), float(n - 1));
  const tx = coord.x.sub(x0);
  const ty = coord.y.sub(y0);
  const row = uint(n);
  const fetch = (x, y) => buffer.element(y.toUint().mul(row).add(x.toUint())).x;
  return mix(mix(fetch(x0, y0), fetch(x1, y0), tx),
    mix(fetch(x0, y1), fetch(x1, y1), tx), ty);
}
export function createWaterGeometryAdapter({ mesh, field, shoreSolver = null }) {
  if (!mesh?.isMesh || !field?.sampleDisplacement || !field?.sampleNormal) {
    throw new TypeError("FFT mesh and functional wave field required");
  }
  const material = mesh.material;
  const savedPositionNode = material.positionNode;
  const savedNormalNode = material.normalNode;
  const position = positionLocal;
  const sampleXZ = vec2(position.x, position.z);
  const displacement = field.sampleDisplacement(sampleXZ);
  const hasShore = Boolean(shoreSolver?.gpuShallowWater && shoreSolver?.state?.element &&
    mesh.geometry?.getAttribute?.("shallowCoord") &&
    mesh.geometry?.getAttribute?.("shallowCoverage") &&
    mesh.geometry?.getAttribute?.("fftDepthWorld") &&
    mesh.geometry?.getAttribute?.("fftShoreDense"));
  let heightNode;
  if (hasShore) {
    const coord = attribute("shallowCoord", "vec2");
    const coverage = attribute("shallowCoverage", "float");
    const depth = attribute("fftDepthWorld", "float");
    const shore = attribute("fftShoreDense", "float");
    const depthBlend = float(1).sub(smoothstep(float(6.5), float(15), depth));
    const transfer = depthBlend.mul(coverage).mul(0.48 * 0.82);
    const shallowHeight = sampleShallowHeight(shoreSolver.state, coord);
    const fftHeight = mix(displacement.y, shallowHeight, transfer);
    const chopFade = float(1).sub(transfer.mul(0.98));
    heightNode = position.add(vec3(displacement.x.mul(chopFade),
      fftHeight, displacement.z.mul(chopFade)).mul(shore));
  } else {
    heightNode = position.add(displacement);
  }
  // FFT normal is only an approximation in the shallow blending region.
  // Leave the established shader normal intact when the shoreline contributes.
  const normalNode = hasShore ? savedNormalNode : field.sampleNormal(sampleXZ);
  let active = false;
  return {
    mesh, field, positionNode: heightNode, normalNode,
    get active() { return active; },
    get coupledShoreline() { return hasShore; },
    apply() {
      if (active) return;
      material.positionNode = heightNode;
      if (normalNode) material.normalNode = normalNode;
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
