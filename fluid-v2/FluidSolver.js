import * as THREE from "three";
import {
  Fn,
  instanceIndex,
  instancedArray,
  uniform,
  uint,
  float,
  vec2,
  clamp,
  floor,
  fract,
  mix,
  min,
  max,
  abs,
  smoothstep,
  sqrt,
  dot,
} from "three/tsl";

// Hybrid 2.5D water solver.
//
// The old portfolio demo only evolved a scalar height field. This solver keeps
// a real horizontal velocity field and runs the same core stages used by
// stable-fluid solvers:
//   splat + semi-Lagrangian advection
//   curl / vorticity confinement
//   shallow-water gravity
//   divergence
//   Jacobi pressure ping-pong
//   pressure projection
//   continuity-driven height update + advected foam
//
// Storage stays entirely on the GPU. The CPU only updates uniforms and queues
// splats; there is no per-cell CPU readback in the frame loop.

const MAX_SPLATS = 4;

export class FluidSolver {
  constructor(renderer, {
    size = 128,
    worldSize = 34,
    pressureIterations = 10,
    gravity = 10.5,
    meanDepth = 0.72,
    vorticity = 3.2,
    projection = 0.82,
  } = {}) {
    this.renderer = renderer;
    this.size = size;
    this.cellCount = size * size;
    this.worldSize = worldSize;
    this.cellWorldSize = worldSize / Math.max(1, size - 1);
    this.pressureIterations = Math.max(2, pressureIterations + (pressureIterations % 2));

    this.dt = uniform(1 / 60);
    this.gravity = uniform(gravity);
    this.meanDepth = uniform(meanDepth);
    this.vorticityStrength = uniform(vorticity);
    this.projectionStrength = uniform(projection);
    this.velocityDissipation = uniform(0.995);
    this.heightDissipation = uniform(0.9992);
    this.foamDissipation = uniform(0.976);

    this.heightA = instancedArray(this.cellCount, "float");
    this.heightB = instancedArray(this.cellCount, "float");
    this.velocityA = instancedArray(this.cellCount, "vec2");
    this.velocityB = instancedArray(this.cellCount, "vec2");
    this.pressureA = instancedArray(this.cellCount, "float");
    this.pressureB = instancedArray(this.cellCount, "float");
    this.divergence = instancedArray(this.cellCount, "float");
    this.curl = instancedArray(this.cellCount, "float");
    this.foamA = instancedArray(this.cellCount, "float");
    this.foamB = instancedArray(this.cellCount, "float");

    this.splatQueue = [];
    this.splats = Array.from({ length: MAX_SPLATS }, () => ({
      position: uniform(new THREE.Vector2(1e5, 1e5)),
      impulse: uniform(new THREE.Vector2()),
      strength: uniform(0),
      radius: uniform(1),
    }));

    this._buildComputeGraph();
    this.initialized = false;
    this.frame = 0;
  }

  queueSplat({ x, z, vx = 0, vz = 0, strength = 1, radius = 1.2 } = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.splatQueue.push({
      x,
      z,
      vx: Number.isFinite(vx) ? vx : 0,
      vz: Number.isFinite(vz) ? vz : 0,
      strength: THREE.MathUtils.clamp(Number(strength) || 0, -4, 4),
      radius: THREE.MathUtils.clamp(Number(radius) || 1.2, 0.25, 5),
    });
    // Bound input work. Fast pointer movement can otherwise queue hundreds of
    // splats while the GPU is rendering one frame.
    if (this.splatQueue.length > 24) this.splatQueue.splice(0, this.splatQueue.length - 24);
  }

  setPressureIterations(value) {
    const rounded = Math.max(2, Math.round(value));
    this.pressureIterations = rounded + (rounded % 2);
  }

  async initialize() {
    if (this.initialized) return;
    if (typeof this.renderer.computeAsync === "function") {
      await this.renderer.computeAsync(this.computeInit);
    } else {
      this.renderer.compute(this.computeInit);
    }
    this.initialized = true;
  }

  reset() {
    this.splatQueue.length = 0;
    this.renderer.compute(this.computeInit);
  }

  step(dtSeconds) {
    if (!this.initialized) return;

    this.dt.value = THREE.MathUtils.clamp(dtSeconds || 1 / 60, 1 / 240, 1 / 30);
    this._flushSplats();

    // Each dispatch reads only settled buffers from an earlier stage and writes
    // a different buffer. This avoids same-dispatch read/write hazards.
    this.renderer.compute(this.computeAdvectAndSplat);
    this.renderer.compute(this.computeCurl);
    this.renderer.compute(this.computeForces);
    this.renderer.compute(this.computeDivergence);

    // Real pressure ping-pong. A -> B, then B -> A. An even iteration count
    // guarantees pressureA is always the final projected pressure field.
    for (let i = 0; i < this.pressureIterations; i += 2) {
      this.renderer.compute(this.computePressureB);
      this.renderer.compute(this.computePressureA);
    }

    this.renderer.compute(this.computeProjectAndHeight);

    // Projection writes velocityB because velocityA is still a source in that
    // pass. Copying B -> A is GPU-to-GPU and makes A canonical for next frame.
    this.renderer.copyBufferToBuffer(this.velocityB.value, this.velocityA.value);
    this.frame++;
  }

  _flushSplats() {
    // Prefer newest inputs so touch interaction remains responsive under load.
    const selected = this.splatQueue.splice(Math.max(0, this.splatQueue.length - MAX_SPLATS));

    for (let i = 0; i < MAX_SPLATS; i++) {
      const target = this.splats[i];
      const source = selected[i];
      if (!source) {
        target.strength.value = 0;
        target.impulse.value.set(0, 0);
        target.position.value.set(1e5, 1e5);
        continue;
      }
      target.position.value.set(source.x, source.z);
      target.impulse.value.set(source.vx, source.vz);
      target.strength.value = source.strength;
      target.radius.value = source.radius;
    }
  }

  _coords(i) {
    const x = i.mod(uint(this.size)).toFloat();
    const y = i.div(uint(this.size)).toFloat();
    return { x, y };
  }

  _neighbors(i) {
    const { x, y } = this._coords(i);
    const lo = float(0);
    const hi = float(this.size - 1);
    const xm = max(x.sub(1), lo);
    const xp = min(x.add(1), hi);
    const ym = max(y.sub(1), lo);
    const yp = min(y.add(1), hi);
    return {
      left: y.mul(this.size).add(xm).toUint(),
      right: y.mul(this.size).add(xp).toUint(),
      up: ym.mul(this.size).add(x).toUint(),
      down: yp.mul(this.size).add(x).toUint(),
      x,
      y,
    };
  }

  _sampleScalar(buffer, gx, gy) {
    // Semi-Lagrangian backtrace with bilinear reconstruction. Keeping a one-cell
    // guard band avoids sampling outside the storage grid at the pool walls.
    const sx = clamp(gx, float(1), float(this.size - 2));
    const sy = clamp(gy, float(1), float(this.size - 2));
    const x0 = floor(sx);
    const y0 = floor(sy);
    const x1 = x0.add(1);
    const y1 = y0.add(1);
    const tx = fract(sx);
    const ty = fract(sy);

    const i00 = y0.mul(this.size).add(x0).toUint();
    const i10 = y0.mul(this.size).add(x1).toUint();
    const i01 = y1.mul(this.size).add(x0).toUint();
    const i11 = y1.mul(this.size).add(x1).toUint();

    const a = mix(buffer.element(i00), buffer.element(i10), tx);
    const b = mix(buffer.element(i01), buffer.element(i11), tx);
    return mix(a, b, ty);
  }

  _sampleVec2(buffer, gx, gy) {
    const sx = clamp(gx, float(1), float(this.size - 2));
    const sy = clamp(gy, float(1), float(this.size - 2));
    const x0 = floor(sx);
    const y0 = floor(sy);
    const x1 = x0.add(1);
    const y1 = y0.add(1);
    const tx = fract(sx);
    const ty = fract(sy);

    const i00 = y0.mul(this.size).add(x0).toUint();
    const i10 = y0.mul(this.size).add(x1).toUint();
    const i01 = y1.mul(this.size).add(x0).toUint();
    const i11 = y1.mul(this.size).add(x1).toUint();

    const a = mix(buffer.element(i00), buffer.element(i10), tx);
    const b = mix(buffer.element(i01), buffer.element(i11), tx);
    return mix(a, b, ty);
  }

  _buildComputeGraph() {
    const size = this.size;
    const worldSize = this.worldSize;
    const cellWorldSize = this.cellWorldSize;

    this.computeInit = Fn(() => {
      const i = instanceIndex;
      this.heightA.element(i).assign(0);
      this.heightB.element(i).assign(0);
      this.velocityA.element(i).assign(vec2(0));
      this.velocityB.element(i).assign(vec2(0));
      this.pressureA.element(i).assign(0);
      this.pressureB.element(i).assign(0);
      this.divergence.element(i).assign(0);
      this.curl.element(i).assign(0);
      this.foamA.element(i).assign(0);
      this.foamB.element(i).assign(0);
    })().compute(this.cellCount);

    this.computeAdvectAndSplat = Fn(() => {
      const i = instanceIndex;
      const { x, y } = this._coords(i);
      const velocity = this.velocityA.element(i);

      // Convert world velocity to grid cells for the backtrace.
      const cellsPerWorld = float(1 / cellWorldSize);
      const backX = x.sub(velocity.x.mul(this.dt).mul(cellsPerWorld));
      const backY = y.sub(velocity.y.mul(this.dt).mul(cellsPerWorld));

      const advectedVelocity = this._sampleVec2(this.velocityA, backX, backY)
        .mul(this.velocityDissipation);
      const advectedHeight = this._sampleScalar(this.heightA, backX, backY)
        .mul(this.heightDissipation);
      const advectedFoam = this._sampleScalar(this.foamA, backX, backY)
        .mul(this.foamDissipation);

      const worldX = x.div(size - 1).sub(0.5).mul(worldSize);
      const worldZ = y.div(size - 1).sub(0.5).mul(worldSize);

      let heightImpulse = float(0);
      let velocityImpulse = vec2(0);
      let foamImpulse = float(0);

      for (const splat of this.splats) {
        const dx = worldX.sub(splat.position.x);
        const dz = worldZ.sub(splat.position.y);
        const distSq = dx.mul(dx).add(dz.mul(dz));
        const radiusSq = splat.radius.mul(splat.radius).add(0.0001);
        const radial = clamp(float(1).sub(distSq.div(radiusSq)), 0, 1);
        const shaped = radial.mul(radial).mul(splat.strength);

        heightImpulse = heightImpulse.add(shaped.mul(0.22));
        velocityImpulse = velocityImpulse.add(splat.impulse.mul(shaped.mul(0.42)));
        foamImpulse = foamImpulse.add(abs(shaped).mul(0.32));
      }

      this.heightB.element(i).assign(clamp(advectedHeight.add(heightImpulse), -2.4, 2.4));
      this.velocityB.element(i).assign(advectedVelocity.add(velocityImpulse));
      this.foamB.element(i).assign(clamp(max(advectedFoam, foamImpulse), 0, 1));
    })().compute(this.cellCount);

    this.computeCurl = Fn(() => {
      const i = instanceIndex;
      const n = this._neighbors(i);
      const vL = this.velocityB.element(n.left);
      const vR = this.velocityB.element(n.right);
      const vU = this.velocityB.element(n.up);
      const vD = this.velocityB.element(n.down);
      const omega = vR.y.sub(vL.y).sub(vD.x.sub(vU.x)).mul(0.5 / cellWorldSize);
      this.curl.element(i).assign(omega);
    })().compute(this.cellCount);

    this.computeForces = Fn(() => {
      const i = instanceIndex;
      const n = this._neighbors(i);
      const omega = this.curl.element(i);

      const cL = abs(this.curl.element(n.left));
      const cR = abs(this.curl.element(n.right));
      const cU = abs(this.curl.element(n.up));
      const cD = abs(this.curl.element(n.down));
      const gradCurl = vec2(cR.sub(cL), cD.sub(cU)).mul(0.5 / cellWorldSize);
      const gradLength = sqrt(dot(gradCurl, gradCurl)).add(0.0001);
      const normal = gradCurl.div(gradLength);
      const vortForce = vec2(normal.y, normal.x.mul(-1))
        .mul(omega)
        .mul(this.vorticityStrength);

      const hL = this.heightB.element(n.left);
      const hR = this.heightB.element(n.right);
      const hU = this.heightB.element(n.up);
      const hD = this.heightB.element(n.down);
      const gradH = vec2(hR.sub(hL), hD.sub(hU)).mul(0.5 / cellWorldSize);
      const gravityForce = gradH.mul(this.gravity).mul(-1);

      let nextVelocity = this.velocityB.element(i)
        .add(vortForce.add(gravityForce).mul(this.dt));

      // No-flow pool boundary. Velocity smoothly falls to zero in a three-cell
      // guard band instead of wrapping to the opposite side of the pool.
      const edgeDistance = min(
        min(n.x, float(size - 1).sub(n.x)),
        min(n.y, float(size - 1).sub(n.y)),
      );
      const wall = smoothstep(0, 3, edgeDistance);
      nextVelocity = nextVelocity.mul(wall);

      this.velocityA.element(i).assign(nextVelocity);
    })().compute(this.cellCount);

    this.computeDivergence = Fn(() => {
      const i = instanceIndex;
      const n = this._neighbors(i);
      const vL = this.velocityA.element(n.left);
      const vR = this.velocityA.element(n.right);
      const vU = this.velocityA.element(n.up);
      const vD = this.velocityA.element(n.down);
      const div = vR.x.sub(vL.x).add(vD.y.sub(vU.y)).mul(0.5 / cellWorldSize);
      this.divergence.element(i).assign(div);
    })().compute(this.cellCount);

    const pressureStep = (readBuffer, writeBuffer) => Fn(() => {
      const i = instanceIndex;
      const n = this._neighbors(i);
      const pL = readBuffer.element(n.left);
      const pR = readBuffer.element(n.right);
      const pU = readBuffer.element(n.up);
      const pD = readBuffer.element(n.down);
      const b = this.divergence.element(i).mul(cellWorldSize * cellWorldSize);
      writeBuffer.element(i).assign(pL.add(pR).add(pU).add(pD).sub(b).mul(0.25));
    })().compute(this.cellCount);

    this.computePressureB = pressureStep(this.pressureA, this.pressureB);
    this.computePressureA = pressureStep(this.pressureB, this.pressureA);

    this.computeProjectAndHeight = Fn(() => {
      const i = instanceIndex;
      const n = this._neighbors(i);
      const pL = this.pressureA.element(n.left);
      const pR = this.pressureA.element(n.right);
      const pU = this.pressureA.element(n.up);
      const pD = this.pressureA.element(n.down);
      const gradP = vec2(pR.sub(pL), pD.sub(pU)).mul(0.5 / cellWorldSize);

      const projected = this.velocityA.element(i)
        .sub(gradP.mul(this.projectionStrength));
      this.velocityB.element(i).assign(projected);

      // Shallow-water continuity. We intentionally use the pre-projection
      // divergence: pressure makes the horizontal flow well-behaved while the
      // free surface still rises/falls as water converges/diverges.
      const div = this.divergence.element(i);
      const nextHeight = this.heightB.element(i)
        .sub(div.mul(this.meanDepth).mul(this.dt))
        .mul(this.heightDissipation);
      this.heightA.element(i).assign(clamp(nextHeight, -2.4, 2.4));

      // Foam is an advected scalar generated by strong rotation, convergence,
      // and large free-surface excursions. It decays instead of disappearing
      // immediately, so backwash and wake streaks persist naturally.
      const energy = abs(this.curl.element(i)).mul(0.10)
        .add(abs(div).mul(0.34))
        .add(abs(nextHeight).mul(0.18));
      const generated = smoothstep(0.18, 0.95, energy);
      const nextFoam = max(this.foamB.element(i).mul(this.foamDissipation), generated);
      this.foamA.element(i).assign(clamp(nextFoam, 0, 1));
    })().compute(this.cellCount);
  }
}
