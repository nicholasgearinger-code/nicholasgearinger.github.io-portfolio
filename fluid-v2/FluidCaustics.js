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
  sin,
} from "three/tsl";

// Lightweight realtime caustics for the hybrid heightfield.
//
// Each caustic vertex samples the live water height field, estimates slope and
// curvature, then projects that vertex across the pool floor as if the surface
// normal had refracted a vertical sun ray. Compressed/curved parts of the water
// brighten while flat water contributes almost nothing. A very small analytic
// capillary component matches the micro-ripples used by FluidSurface so the
// caustics retain fine dancing structure even when the macro heightfield is calm.
export class FluidCaustics {
  constructor(solver, timeUniform, { resolution = 64 } = {}) {
    this.solver = solver;
    this.time = timeUniform;
    this.resolution = Math.max(24, Math.min(96, resolution | 0));
    this.mesh = this._buildMesh();
  }

  _buildMesh() {
    const { size, worldSize, cellWorldSize, heightA, foamA } = this.solver;
    const res = this.resolution;

    const geometry = new THREE.PlaneGeometry(
      worldSize,
      worldSize,
      res - 1,
      res - 1,
    );
    geometry.rotateX(-Math.PI / 2);

    // Map the cheaper caustic mesh to the nearest cells of the full simulation.
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
      opacity: 0.72,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const causticField = Fn(() => {
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
      const curvature = hL.add(hR).add(hU).add(hD).sub(hC.mul(4))
        .div(cellWorldSize * cellWorldSize);

      // Curvature is the useful focusing cue: flat water has nearly zero
      // caustic energy while converging/diverging wavelets create bright lines.
      const macroFocus = smoothstep(0.025, 0.42, abs(curvature));
      const slopeEnergy = smoothstep(0.03, 0.55, abs(slopeX).add(abs(slopeZ)));

      const worldX = x.div(size - 1).sub(0.5).mul(worldSize);
      const worldZ = y.div(size - 1).sub(0.5).mul(worldSize);

      // Analytic capillary wavelengths shared conceptually with FluidSurface.
      // Their product forms narrow moving folds instead of a scrolling bitmap.
      const m1 = sin(worldX.mul(1.55).add(worldZ.mul(0.82)).add(this.time.mul(2.35)));
      const m2 = sin(worldX.mul(-0.93).add(worldZ.mul(1.72)).sub(this.time.mul(1.78)));
      const microFold = smoothstep(0.72, 0.985, abs(m1.mul(m2)));

      const foam = clamp(foamA.element(cellIndex).mul(1.7), 0, 1);
      const clearWater = float(1).sub(foam.mul(0.78));

      const intensity = clamp(
        macroFocus.mul(1.25)
          .add(slopeEnergy.mul(0.28))
          .add(microFold.mul(0.72))
          .mul(clearWater),
        0,
        1.75,
      );

      return vec3(slopeX, slopeZ, intensity);
    })();

    const causticVarying = vertexStage(causticField);

    // Approximate refraction displacement on the receiver. This is intentionally
    // conservative: the visible intensity comes from actual live curvature,
    // while the X/Z shift makes the bands slide/focus with the surface normals.
    material.positionNode = Fn(() => {
      const slopeX = causticField.x;
      const slopeZ = causticField.y;
      const refractDistance = float(1.55);
      return positionLocal.add(vec3(
        slopeX.mul(refractDistance).mul(-1),
        0,
        slopeZ.mul(refractDistance).mul(-1),
      ));
    })();

    material.colorNode = color(0xb8fbff).mul(causticVarying.z);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "FluidRealtimeCaustics";
    mesh.position.y = -3.535;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return mesh;
  }
}
