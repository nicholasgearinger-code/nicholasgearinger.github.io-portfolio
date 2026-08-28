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

// Hybrid 2.5D free-surface solver.
//
// The persistent state is physical rather than animated:
//   - scalar free-surface displacement h(x,z)
//   - horizontal water velocity u(x,z)
//   - advected foam/aeration
//   - divergence / pressure / vorticity work fields
//
// Each frame runs semi-Lagrangian advection, shallow-water gravity, vorticity,
// divergence, Jacobi pressure ping-pong, pressure projection and nonlinear
// continuity. Impacts inject a *volume-conserving-looking* crater + crown shape
// plus radial momentum directly into the fields, so expanding rings and rebounds
// are produced by the solver instead of by an overlay animation.

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
    this.heightDissipation = uniform(0.9990);
    this.foamDissipation = uniform(0.982);

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
      radialImpulse: uniform(0),
      ringRadius: uniform(0),
      ringWidth: uniform(0.4),
      ringStrength: uniform(0),
      foam: uniform(0),
    }));

    this._buildComputeGraph();
    this.initialized = false;
    this.frame = 0;
  }

  queueSplat({
    x,
    z,
    vx = 0,
    vz = 0,
    strength = 1,
    radius = 1.2,
    radialImpulse = 0,
    ringRadius = 0,
    ringWidth = 0.4,
    ringStrength = 0,
    foam = 0,
  } = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.splatQueue.push({
      x,
      z,
      vx: Number.isFinite(vx) ? vx : 0,
      vz: Number.isFinite(vz) ? vz : 0,
      strength: THREE.MathUtils.clamp(Number(strength) || 0, -4, 4),
      radius: THREE.MathUtils.clamp(Number(radius) || 1.2, 0.22, 5),
      radialImpulse: THREE.MathUtils.clamp(Number(radialImpulse) || 0, -8, 8),
      ringRadius: THREE.MathUtils.clamp(Number(ringRadius) || 0, 0, 6),
      ringWidth: THREE.MathUtils.clamp(Number(ringWidth) || 0.4, 0.12, 2.5),
      ringStrength: THREE.MathUtils.clamp(Number(ringStrength) || 0, -4, 4),
      foam: THREE.MathUtils.clamp(Number(foam) || 0, 0, 2),
    });
    if (this.splatQueue.length > 32) this.splatQueue.splice(0, this.splatQueue.length - 32);
  }

  // A rigid-body impact removes water from the footprint and deposits it in a
  // crown around the body while adding outward radial momentum. The solver then
  // evolves that disturbed free surface into the rebound and travelling waves.
  queueImpact({
    x,
    z,
    radius = 0.7,
    verticalSpeed = 3,
    vx = 0,
    vz = 0,
    displacedVolume = 1,
  } = {}) {
    const r = THREE.MathUtils.clamp(radius, 0.25, 2.6);
    const speed = THREE.MathUtils.clamp(Math.abs(verticalSpeed), 0, 16);
    const volume = THREE.MathUtils.clamp(displacedVolume, 0.05, 12);
    const depression = -THREE.MathUtils.clamp(0.24 + speed * 0.19 + volume * 0.045, 0.25, 3.0);
    const crown = THREE.MathUtils.clamp(0.16 + speed * 0.145 + volume * 0.035, 0.15, 2.4);
    const radial = THREE.MathUtils.clamp(0.45 + speed * 0.46 + volume * 0.06, 0.45, 7.5);

    this.queueSplat({
      x,
      z,
      vx: vx * 0.24,
      vz: vz * 0.24,
      strength: depression,
      radius: r * 1.08,
      radialImpulse: radial,
      ringRadius: r * 1.48,
      ringWidth: Math.max(this.cellWorldSize * 1.35, r * 0.46),
      ringStrength: crown,
      foam: THREE.MathUtils.clamp(0.25 + speed * 0.12, 0.2, 1.5),
    });
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

    this.renderer.compute(this.computeAdvectAndSplat);
    this.renderer.compute(this.computeCurl);
    this.renderer.compute(this.computeForces);
    this.renderer.compute(this.computeDivergence);

    for (let i = 0; i < this.pressureIterations; i += 2) {
      this.renderer.compute(this.computePressureB);
      this.renderer.compute(this.computePressureA);
    }

    this.renderer.compute(this.computeProjectAndHeight);
    this.renderer.compute(this.computeCommitVelocity);
    this.frame++;
  }

  _flushSplats() {
    const selected = this.splatQueue.splice(Math.max(0, this.splatQueue.length - MAX_SPLATS));

    for (let i = 0; i < MAX_SPLATS; i++) {
      const target = this.splats[i];
      const source = selected[i];
      if (!source) {
        target.strength.value = 0;
        target.impulse.value.set(0, 0);
        target.position.value.set(1e5, 1e5);
        target.radialImpulse.value = 0;
        target.ringRadius.value = 0;
        target.ringStrength.value = 0;
        target.foam.value = 0;
        continue;
      }
      target.position.value.set(source.x, source.z);
      target.impulse.value.set(source.vx, source.vz);
      target.strength.value = source.strength;
      target.radius.value = source.radius;
      target.radialImpulse.value = source.radialImpulse;
      target.ringRadius.value = source.ringRadius;
      target.ringWidth.value = source.ringWidth;
      target.ringStrength.value = source.ringStrength;
      target.foam.value = source.foam;
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
        const dist = sqrt(distSq.add(0.000001));
        const core = clamp(float(1).sub(dist.div(splat.radius)), 0, 1);
        const coreShape = core.mul(core).mul(float(3).sub(core.mul(2)));

        const ringDistance = abs(dist.sub(splat.ringRadius));
        const ring = float(1).sub(smoothstep(0, splat.ringWidth, ringDistance));
        const radialDir = vec2(dx, dz).div(dist.add(0.001));
        const radialMask = max(core.mul(0.32), ring);

        heightImpulse = heightImpulse
          .add(coreShape.mul(splat.strength).mul(0.34))
          .add(ring.mul(splat.ringStrength).mul(0.31));

        velocityImpulse = velocityImpulse
          .add(splat.impulse.mul(coreShape).mul(0.46))
          .add(radialDir.mul(splat.radialImpulse).mul(radialMask));

        foamImpulse = foamImpulse
          .add(abs(coreShape.mul(splat.strength)).mul(0.18))
          .add(abs(ring.mul(splat.ringStrength)).mul(0.42))
          .add(ring.mul(splat.foam).mul(0.55));
      }

      this.heightB.element(i).assign(clamp(advectedHeight.add(heightImpulse), -2.8, 2.8));
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

      const hC = this.heightB.element(i);
      const hL = this.heightB.element(n.left);
      const hR = this.heightB.element(n.right);
      const hU = this.heightB.element(n.up);
      const hD = this.heightB.element(n.down);
      const gradH = vec2(hR.sub(hL), hD.sub(hU)).mul(0.5 / cellWorldSize);

      // Nonlinear shallow-water continuity:
      //   dh/dt + u·grad(h) + (H+h) div(u) = 0
      // This makes object-sized depressions/crowns transport actual free-surface
      // volume instead of simply fading as a scalar ripple animation.
      const effectiveDepth = clamp(this.meanDepth.add(hC), 0.08, 3.2);
      const transport = dot(projected, gradH).add(effectiveDepth.mul(this.divergence.element(i)));
      const nextHeight = hC.sub(transport.mul(this.dt)).mul(this.heightDissipation);
      this.heightA.element(i).assign(clamp(nextHeight, -2.8, 2.8));

      const div = this.divergence.element(i);
      const speedSq = dot(projected, projected);
      const energy = abs(this.curl.element(i)).mul(0.085)
        .add(abs(div).mul(0.42))
        .add(abs(nextHeight).mul(0.16))
        .add(speedSq.mul(0.018));
      const generated = smoothstep(0.16, 0.92, energy);
      const nextFoam = max(this.foamB.element(i).mul(this.foamDissipation), generated);
      this.foamA.element(i).assign(clamp(nextFoam, 0, 1));
    })().compute(this.cellCount);

    this.computeCommitVelocity = Fn(() => {
      const i = instanceIndex;
      this.velocityA.element(i).assign(this.velocityB.element(i));
    })().compute(this.cellCount);
  }
}
