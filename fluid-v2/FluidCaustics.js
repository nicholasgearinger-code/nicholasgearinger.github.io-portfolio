import * as THREE from "three";
import {
  Fn,
  attribute,
  positionLocal,
  vertexStage,
  vec3,
  float,
  color,
  clamp,
  smoothstep,
  abs,
  sqrt,
  dot,
  max,
  uniform,
} from "three/tsl";

// Realtime caustics projected from the *physical* heightfield.
//
// Every vertex represents a point on the water surface. We estimate its normal,
// refract the incoming sunlight from air (n≈1.0) into water (n≈1.333) using
// Snell's law, intersect that transmitted ray with the pool floor, then move the
// caustic receiver vertex to that hit point. Curvature supplies a lightweight
// local Jacobian/focusing estimate; overlapping/compressed triangles add more
// energy through additive blending.
export class FluidCaustics {
  constructor(solver, timeUniform, {
    resolution = 64,
    floorY = -3.535,
    lightDirection = new THREE.Vector3(14, -24, 8).normalize(),
  } = {}) {
    this.solver = solver;
    this.time = timeUniform;
    this.resolution = Math.max(24, Math.min(96, resolution | 0));
    this.floorY = floorY;
    this.lightDirection = uniform(lightDirection.clone().normalize());
    this.mesh = this._buildMesh();
  }

  setLightDirection(direction) {
    if (!direction) return;
    this.lightDirection.value.copy(direction).normalize();
  }

  _buildMesh() {
    const { size, worldSize, cellWorldSize, heightA, foamA } = this.solver;
    const res = this.resolution;
    const floorY = this.floorY;

    const geometry = new THREE.PlaneGeometry(
      worldSize,
      worldSize,
      res - 1,
      res - 1,
    );
    geometry.rotateX(-Math.PI / 2);

    const count = res * res;
    const indices = new Float32Array(count);
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const sx = Math.round((x / (res - 1)) * (size - 1));
        const sy = Math.round((y / (res - 1)) * (size - 1));
        indices[y * res + x] = sy * size + sx;
      }
    }
    geometry.setAttribute("fluidCell", new THREE.Float32BufferAttribute(indices, 1));

    const cellIndex = attribute("fluidCell", "float").toUint();
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const opticalState = Fn(() => {
      const x = cellIndex.mod(size).toFloat();
      const y = cellIndex.div(size).toFloat();
      const xm = x.sub(1).max(0);
      const xp = x.add(1).min(size - 1);
      const ym = y.sub(1).max(0);
      const yp = y.add(1).min(size - 1);

      const idxL = y.mul(size).add(xm).toUint();
      const idxR = y.mul(size).add(xp).toUint();
      const idxU = ym.mul(size).add(x).toUint();
      const idxD = yp.mul(size).add(x).toUint();

      const hC = heightA.element(cellIndex);
      const hL = heightA.element(idxL);
      const hR = heightA.element(idxR);
      const hU = heightA.element(idxU);
      const hD = heightA.element(idxD);

      const slopeX = hR.sub(hL).div(2 * cellWorldSize);
      const slopeZ = hD.sub(hU).div(2 * cellWorldSize);
      const normal = vec3(slopeX.mul(-1), 1, slopeZ.mul(-1)).normalize();

      // GLSL refract(I,N,eta) expanded explicitly for TSL. I points from the
      // light toward the water. eta = n_air / n_water.
      const I = this.lightDirection;
      const eta = float(1 / 1.333);
      const ndoti = dot(normal, I);
      const k = max(float(1).sub(eta.mul(eta).mul(float(1).sub(ndoti.mul(ndoti)))), 0);
      const transmitted = I.mul(eta)
        .sub(normal.mul(eta.mul(ndoti).add(sqrt(k))))
        .normalize();

      const waterToFloor = hC.sub(floorY);
      const travel = waterToFloor.div(max(transmitted.y.mul(-1), 0.08));
      const shiftX = transmitted.x.mul(travel);
      const shiftZ = transmitted.z.mul(travel);

      const curvature = hL.add(hR).add(hU).add(hD).sub(hC.mul(4))
        .div(cellWorldSize * cellWorldSize);
      const focusing = smoothstep(0.018, 0.34, abs(curvature));
      const incidence = clamp(ndoti.mul(-1), 0, 1);
      const foam = clamp(foamA.element(cellIndex).mul(1.55), 0, 1);
      const clearWater = float(1).sub(foam.mul(0.86));

      // A nonzero base means a smooth surface still transmits light; curvature
      // concentrates that energy into the dancing bright folds.
      const intensity = clamp(
        float(0.11)
          .add(focusing.mul(1.38))
          .mul(incidence)
          .mul(clearWater),
        0,
        1.65,
      );

      return vec3(shiftX, shiftZ, intensity);
    })();

    const varying = vertexStage(opticalState);

    material.positionNode = Fn(() => {
      const state = opticalState;
      return positionLocal.add(vec3(state.x, 0, state.y));
    })();

    material.colorNode = color(0xc9ffff).mul(varying.z);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "FluidSnellCaustics";
    mesh.position.y = floorY;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return mesh;
  }
}
