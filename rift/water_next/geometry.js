import { createAdaptiveOceanMesh } from "./adaptive_mesh.js";
// Experimental combined FFT/shallow-water vertex binding. Opt-in only.
// Uses existing GPU buffers; does not allocate or dispatch a new solver.
import { positionLocal, attribute, vec2, vec3, float, uint, floor, min, mix, smoothstep, clamp } from "three/tsl";

function sampleShallowHeight(buffer, coord, n = 256) {
  // Clamp before conversion to unsigned indices: finite-difference normals
  // deliberately sample on both sides of the current vertex.
  const bounded = clamp(coord, vec2(0, 0), vec2(n - 1, n - 1));
  const x0 = floor(bounded.x);
  const y0 = floor(bounded.y);
  const x1 = min(x0.add(1), float(n - 1));
  const y1 = min(y0.add(1), float(n - 1));
  const tx = bounded.x.sub(x0);
  const ty = bounded.y.sub(y0);
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
  let normalNode;
  if (hasShore) {
    const coord = attribute("shallowCoord", "vec2");
    const coverage = attribute("shallowCoverage", "float");
    const depth = attribute("fftDepthWorld", "float");
    const shore = attribute("fftShoreDense", "float");
    const depthBlend = float(1).sub(smoothstep(float(6.5), float(15), depth));
    const transfer = depthBlend.mul(coverage).mul(0.48 * 0.82);
    const chopFade = float(1).sub(transfer.mul(0.98));
    const shallowHeight = sampleShallowHeight(shoreSolver.state, coord);
    const fftHeight = mix(displacement.y, shallowHeight, transfer);
    heightNode = position.add(vec3(displacement.x.mul(chopFade),
      fftHeight, displacement.z.mul(chopFade)).mul(shore));

    // Calculate the gradient of the SAME blended height used for displacement,
    // including local shallow-water variation. Do not rely on triangle-face
    // derivatives or the offshore-only FFT normal near the shoreline.
    // Transfer, coverage and wetness are treated as locally constant: their
    // per-vertex gradients require terrain sampling and are not available in
    // this GPU adapter yet. This is a first-order surface normal.
    const dx = float(field.domain / field.resolution);
    const shallowCell = float(256 / 360).mul(dx);
    const xStep = vec2(dx, 0);
    const zStep = vec2(0, dx);
    const sampleHeight = (xz, sc) => mix(
      field.sampleDisplacement(xz).y,
      sampleShallowHeight(shoreSolver.state, sc),
      transfer
    );
    const hl = sampleHeight(sampleXZ.sub(xStep), coord.sub(vec2(shallowCell, 0)));
    const hr = sampleHeight(sampleXZ.add(xStep), coord.add(vec2(shallowCell, 0)));
    const hd = sampleHeight(sampleXZ.sub(zStep), coord.sub(vec2(0, shallowCell)));
    const hu = sampleHeight(sampleXZ.add(zStep), coord.add(vec2(0, shallowCell)));
    const inv2dx = float(0.5).div(dx);
    const slopeX = hr.sub(hl).mul(inv2dx).mul(shore);
    const slopeZ = hu.sub(hd).mul(inv2dx).mul(shore);
    normalNode = vec3(slopeX.negate(), float(1), slopeZ.negate()).normalize();
  } else {
    heightNode = position.add(displacement);
    normalNode = field.sampleNormal(sampleXZ);
  }
  const adaptive = createAdaptiveOceanMesh(mesh);
  let active = false;
  return {
    mesh, field, positionNode: heightNode, normalNode,
    get active() { return active; },
    get coupledShoreline() { return hasShore; },
    get adaptiveMeshEnabled() { return Boolean(adaptive?.enabled); },
    apply() {
      if (active) return;
      material.positionNode = heightNode;
      if (normalNode) material.normalNode = normalNode;
      material.needsUpdate = true;
      adaptive?.enable();
      active = true;
    },
    update({ camera } = {}) { if(active) adaptive?.update(camera); return active; },
    restore() {
      if (!active) return;
      adaptive?.restore();
      material.positionNode = savedPositionNode ?? null;
      material.normalNode = savedNormalNode ?? null;
      material.needsUpdate = true;
      active = false;
    },
    dispose() { this.restore(); },
  };
}
