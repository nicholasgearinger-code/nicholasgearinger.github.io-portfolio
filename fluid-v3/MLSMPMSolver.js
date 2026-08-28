import * as THREE from "three/webgpu";
import {
  Fn, If, Return, Loop,
  instancedArray, instanceIndex, uniform, storage, struct,
  atomicStore, atomicAdd, atomicLoad,
  int, ivec3, float, vec3, vec4, mat3, array,
  clamp, max, pow, cross, step,
} from "three/tsl";

// True volumetric MLS-MPM liquid solver adapted to Three.js' current
// webgpu_compute_particles_fluid reference implementation.
//
// State lives in 3D particles + a 3D Eulerian transfer grid. There is no
// heightfield: particles can pass above/below one another, form jets, crowns,
// sheets and detached droplets, and wrap around 3D colliders.
export class MLSMPMSolver {
  constructor(renderer, {
    particleCount = 8192,
    maxParticles = 16384,
    gridResolution = 40,
    dt = 1 / 90,
    stiffness = 48,
    restDensity = 1.55,
    viscosity = 0.10,
    gravity = 9.81,
  } = {}) {
    this.renderer = renderer;
    this.particleCount = Math.min(particleCount, maxParticles);
    this.maxParticles = maxParticles;
    this.gridResolution = gridResolution;
    this.gridSize = new THREE.Vector3(gridResolution, gridResolution, gridResolution);
    this.cellCount = gridResolution ** 3;
    this.fixedPointMultiplier = 1e7;

    this.particleCountUniform = uniform(this.particleCount, 'uint');
    this.gridSizeUniform = uniform(this.gridSize);
    this.dtUniform = uniform(dt);
    this.stiffnessUniform = uniform(stiffness);
    this.restDensityUniform = uniform(restDensity);
    this.dynamicViscosityUniform = uniform(viscosity);
    this.gravityUniform = uniform(new THREE.Vector3(0, -(gravity * gravity), 0));

    // Interactive spherical collider (normalized solver coordinates).
    this.colliderCenter = uniform(new THREE.Vector3(0.52, 0.78, 0.50));
    this.colliderVelocity = uniform(new THREE.Vector3());
    this.colliderRadius = uniform(0.09);
    this.colliderEnabled = uniform(0);

    // Pointer force is a 3D ray so interaction is volumetric rather than a
    // surface-only splat.
    this.pointerRayOrigin = uniform(new THREE.Vector3());
    this.pointerRayDirection = uniform(new THREE.Vector3(0, -1, 0));
    this.pointerForce = uniform(new THREE.Vector3());
    this.pointerRadius = uniform(0.075);

    this._setupBuffers();
    this._setupKernels();
  }

  _setupBuffers() {
    const particleStruct = struct({
      position: { type: 'vec3' },
      velocity: { type: 'vec3' },
      C: { type: 'mat3' },
    });
    const strideFloats = 20; // WebGPU vec3/mat3 alignment.
    const particleArray = new Float32Array(this.maxParticles * strideFloats);

    // Dam-break style volume: a genuinely three-dimensional block of liquid.
    const n = this.particleCount;
    const sx = Math.ceil(Math.cbrt(n * 1.7));
    const sy = Math.ceil(Math.cbrt(n));
    const sz = Math.ceil(n / (sx * sy));
    let p = 0;
    for (let z = 0; z < sz && p < n; z++) {
      for (let y = 0; y < sy && p < n; y++) {
        for (let x = 0; x < sx && p < n; x++, p++) {
          const i = p * strideFloats;
          particleArray[i] = 0.13 + (x + 0.35 + Math.random() * 0.3) / sx * 0.44;
          particleArray[i + 1] = 0.09 + (y + 0.35 + Math.random() * 0.3) / sy * 0.57;
          particleArray[i + 2] = 0.16 + (z + 0.35 + Math.random() * 0.3) / Math.max(1, sz) * 0.68;
        }
      }
    }

    // Park unused particles outside the useful domain.
    for (; p < this.maxParticles; p++) {
      const i = p * strideFloats;
      particleArray[i] = 0.05;
      particleArray[i + 1] = 0.05;
      particleArray[i + 2] = 0.05;
    }

    this.particleBuffer = instancedArray(particleArray, particleStruct);

    const cellStruct = struct({
      x: { type: 'int', atomic: true },
      y: { type: 'int', atomic: true },
      z: { type: 'int', atomic: true },
      mass: { type: 'int', atomic: true },
    });
    this.cellBuffer = instancedArray(this.cellCount, cellStruct);
    this.cellBufferFloat = instancedArray(this.cellCount, 'vec4');
  }

  _setupKernels() {
    const grid = this.gridSize;
    const gridUniform = this.gridSizeUniform;
    const fixed = this.fixedPointMultiplier;
    const particleBuffer = this.particleBuffer;
    const cellBuffer = this.cellBuffer;
    const cellBufferFloat = this.cellBufferFloat;

    const encode = (f) => int(f.mul(fixed));
    const decode = (i) => float(i).div(fixed);

    this.clearGridKernel = Fn(() => {
      const cell = cellBuffer.element(instanceIndex);
      atomicStore(cell.get('x'), 0);
      atomicStore(cell.get('y'), 0);
      atomicStore(cell.get('z'), 0);
      atomicStore(cell.get('mass'), 0);
      cellBufferFloat.element(instanceIndex).assign(vec4(0));
    })().compute(this.cellCount, [64, 1, 1]).setName('V3 Clear Grid');

    this.p2g1Kernel = Fn(() => {
      const particlePosition = particleBuffer.element(instanceIndex).get('position').toConst();
      const particleVelocity = particleBuffer.element(instanceIndex).get('velocity').toConst();
      const C = particleBuffer.element(instanceIndex).get('C').toConst();
      const gridPosition = particlePosition.mul(gridUniform).toVar();
      const cellIndex = ivec3(gridPosition).sub(1).toConst();
      const cellDiff = gridPosition.fract().sub(0.5).toConst();
      const w0 = float(0.5).mul(float(0.5).sub(cellDiff)).mul(float(0.5).sub(cellDiff));
      const w1 = float(0.75).sub(cellDiff.mul(cellDiff));
      const w2 = float(0.5).mul(float(0.5).add(cellDiff)).mul(float(0.5).add(cellDiff));
      const weights = array([w0, w1, w2]).toConst();

      Loop({ start: 0, end: 3, type: 'int', name: 'gx', condition: '<' }, ({ gx }) => {
        Loop({ start: 0, end: 3, type: 'int', name: 'gy', condition: '<' }, ({ gy }) => {
          Loop({ start: 0, end: 3, type: 'int', name: 'gz', condition: '<' }, ({ gz }) => {
            const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
            const cellX = cellIndex.add(ivec3(gx, gy, gz)).toConst();
            const cellDist = vec3(cellX).add(0.5).sub(gridPosition).toConst();
            const Q = C.mul(cellDist);
            const massContrib = weight;
            const velContrib = massContrib.mul(particleVelocity.add(Q)).toConst();
            const ptr = cellX.x.mul(int(grid.y * grid.z)).add(cellX.y.mul(int(grid.z))).add(cellX.z).toConst();
            const cell = cellBuffer.element(ptr);
            atomicAdd(cell.get('x'), encode(velContrib.x));
            atomicAdd(cell.get('y'), encode(velContrib.y));
            atomicAdd(cell.get('z'), encode(velContrib.z));
            atomicAdd(cell.get('mass'), encode(massContrib));
          });
        });
      });
    })().compute(this.particleCount, [64, 1, 1]).setName('V3 Particle To Grid Momentum');

    this.p2g2Kernel = Fn(() => {
      const particlePosition = particleBuffer.element(instanceIndex).get('position').toConst();
      const gridPosition = particlePosition.mul(gridUniform).toVar();
      const cellIndex = ivec3(gridPosition).sub(1).toConst();
      const cellDiff = gridPosition.fract().sub(0.5).toConst();
      const w0 = float(0.5).mul(float(0.5).sub(cellDiff)).mul(float(0.5).sub(cellDiff));
      const w1 = float(0.75).sub(cellDiff.mul(cellDiff));
      const w2 = float(0.5).mul(float(0.5).add(cellDiff)).mul(float(0.5).add(cellDiff));
      const weights = array([w0, w1, w2]).toConst();
      const density = float(0).toVar();

      Loop({ start: 0, end: 3, type: 'int', name: 'gx', condition: '<' }, ({ gx }) => {
        Loop({ start: 0, end: 3, type: 'int', name: 'gy', condition: '<' }, ({ gy }) => {
          Loop({ start: 0, end: 3, type: 'int', name: 'gz', condition: '<' }, ({ gz }) => {
            const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
            const cellX = cellIndex.add(ivec3(gx, gy, gz)).toConst();
            const ptr = cellX.x.mul(int(grid.y * grid.z)).add(cellX.y.mul(int(grid.z))).add(cellX.z).toConst();
            density.addAssign(decode(atomicLoad(cellBuffer.element(ptr).get('mass'))).mul(weight));
          });
        });
      });

      const volume = float(1).div(max(density, 0.0001));
      const pressure = max(0.0, pow(density.div(this.restDensityUniform), 5.0).sub(1).mul(this.stiffnessUniform)).toConst();
      const stress = mat3(-pressure, 0, 0, 0, -pressure, 0, 0, 0, -pressure).toVar();
      const dudv = particleBuffer.element(instanceIndex).get('C').toConst();
      const strain = dudv.add(dudv.transpose());
      stress.addAssign(strain.mul(this.dynamicViscosityUniform));
      const stressTerm = volume.mul(-4).mul(stress).mul(this.dtUniform);

      Loop({ start: 0, end: 3, type: 'int', name: 'gx2', condition: '<' }, ({ gx2 }) => {
        Loop({ start: 0, end: 3, type: 'int', name: 'gy2', condition: '<' }, ({ gy2 }) => {
          Loop({ start: 0, end: 3, type: 'int', name: 'gz2', condition: '<' }, ({ gz2 }) => {
            const weight = weights.element(gx2).x.mul(weights.element(gy2).y).mul(weights.element(gz2).z);
            const cellX = cellIndex.add(ivec3(gx2, gy2, gz2)).toConst();
            const cellDist = vec3(cellX).add(0.5).sub(gridPosition).toConst();
            const momentum = stressTerm.mul(weight).mul(cellDist).toConst();
            const ptr = cellX.x.mul(int(grid.y * grid.z)).add(cellX.y.mul(int(grid.z))).add(cellX.z).toConst();
            const cell = cellBuffer.element(ptr);
            atomicAdd(cell.get('x'), encode(momentum.x));
            atomicAdd(cell.get('y'), encode(momentum.y));
            atomicAdd(cell.get('z'), encode(momentum.z));
          });
        });
      });
    })().compute(this.particleCount, [64, 1, 1]).setName('V3 Particle To Grid Stress');

    this.updateGridKernel = Fn(() => {
      const cell = cellBuffer.element(instanceIndex);
      const mass = decode(atomicLoad(cell.get('mass'))).toConst();
      If(mass.lessThanEqual(0), () => { Return(); });

      const vx = decode(atomicLoad(cell.get('x'))).div(mass).toVar();
      const vy = decode(atomicLoad(cell.get('y'))).div(mass).toVar();
      const vz = decode(atomicLoad(cell.get('z'))).div(mass).toVar();
      const x = int(instanceIndex).div(int(grid.z * grid.y));
      const y = int(instanceIndex).div(int(grid.z)).mod(int(grid.y));
      const z = int(instanceIndex).mod(int(grid.z));
      If(x.lessThan(2).or(x.greaterThan(int(grid.x - 3))), () => { vx.assign(0); });
      If(y.lessThan(2).or(y.greaterThan(int(grid.y - 3))), () => { vy.assign(0); });
      If(z.lessThan(2).or(z.greaterThan(int(grid.z - 3))), () => { vz.assign(0); });
      cellBufferFloat.element(instanceIndex).assign(vec4(vx, vy, vz, mass));
    })().compute(this.cellCount, [64, 1, 1]).setName('V3 Update Grid');

    this.g2pKernel = Fn(() => {
      const particlePosition = particleBuffer.element(instanceIndex).get('position').toVar();
      const gridPosition = particlePosition.mul(gridUniform).toVar();
      const particleVelocity = vec3(0).toVar();
      const cellIndex = ivec3(gridPosition).sub(1).toConst();
      const cellDiff = gridPosition.fract().sub(0.5).toConst();
      const w0 = float(0.5).mul(float(0.5).sub(cellDiff)).mul(float(0.5).sub(cellDiff));
      const w1 = float(0.75).sub(cellDiff.mul(cellDiff));
      const w2 = float(0.5).mul(float(0.5).add(cellDiff)).mul(float(0.5).add(cellDiff));
      const weights = array([w0, w1, w2]).toConst();
      const B = mat3(0).toVar();

      Loop({ start: 0, end: 3, type: 'int', name: 'gx3', condition: '<' }, ({ gx3 }) => {
        Loop({ start: 0, end: 3, type: 'int', name: 'gy3', condition: '<' }, ({ gy3 }) => {
          Loop({ start: 0, end: 3, type: 'int', name: 'gz3', condition: '<' }, ({ gz3 }) => {
            const weight = weights.element(gx3).x.mul(weights.element(gy3).y).mul(weights.element(gz3).z);
            const cellX = cellIndex.add(ivec3(gx3, gy3, gz3)).toConst();
            const cellDist = vec3(cellX).add(0.5).sub(gridPosition).toConst();
            const ptr = cellX.x.mul(int(grid.y * grid.z)).add(cellX.y.mul(int(grid.z))).add(cellX.z).toConst();
            const weightedVelocity = cellBufferFloat.element(ptr).xyz.mul(weight).toConst();
            B.addAssign(mat3(
              weightedVelocity.mul(cellDist.x),
              weightedVelocity.mul(cellDist.y),
              weightedVelocity.mul(cellDist.z),
            ));
            particleVelocity.addAssign(weightedVelocity);
          });
        });
      });

      particleBuffer.element(instanceIndex).get('C').assign(B.mul(4));
      particleVelocity.addAssign(this.gravityUniform.mul(this.dtUniform));
      particleVelocity.divAssign(gridUniform);

      // Volumetric pointer push: distance from each particle to an interaction ray.
      const rayDist = cross(this.pointerRayDirection, particlePosition.sub(this.pointerRayOrigin)).length();
      const pointerWeight = rayDist.div(this.pointerRadius).oneMinus().max(0).pow(2);
      particleVelocity.addAssign(this.pointerForce.mul(pointerWeight));

      // Move particle in normalized domain.
      particlePosition.addAssign(particleVelocity.mul(this.dtUniform));

      // 3D moving spherical obstacle. It physically displaces the particle cloud.
      If(this.colliderEnabled.greaterThan(0.5), () => {
        const delta = particlePosition.sub(this.colliderCenter);
        const dist = delta.length().toVar();
        If(dist.lessThan(this.colliderRadius), () => {
          const n = delta.div(max(dist, 0.0001));
          particlePosition.assign(this.colliderCenter.add(n.mul(this.colliderRadius)));
          const colliderVelNorm = this.colliderVelocity.div(gridUniform);
          const normalVelocity = n.mul(particleVelocity.sub(colliderVelNorm).dot(n));
          particleVelocity.subAssign(normalVelocity.mul(1.65));
          particleVelocity.addAssign(colliderVelNorm.mul(0.32));
        });
      });

      const lo = vec3(2).div(gridUniform);
      const hi = vec3(grid).sub(2).div(gridUniform);
      particlePosition.assign(clamp(particlePosition, lo, hi));
      particleVelocity.mulAssign(gridUniform);

      particleBuffer.element(instanceIndex).get('position').assign(particlePosition);
      particleBuffer.element(instanceIndex).get('velocity').assign(particleVelocity);
    })().compute(this.particleCount, [64, 1, 1]).setName('V3 Grid To Particle');
  }

  async compile() {
    if (typeof this.renderer.compileComputeAsync === 'function') {
      await this.renderer.compileComputeAsync([
        this.clearGridKernel,
        this.p2g1Kernel,
        this.p2g2Kernel,
        this.updateGridKernel,
        this.g2pKernel,
      ]);
    }
  }

  step(substeps = 1) {
    for (let i = 0; i < substeps; i++) {
      this.renderer.compute(this.clearGridKernel);
      this.renderer.compute(this.p2g1Kernel);
      this.renderer.compute(this.p2g2Kernel);
      this.renderer.compute(this.updateGridKernel);
      this.renderer.compute(this.g2pKernel);
    }
  }

  setPointerRay(origin, direction, force) {
    this.pointerRayOrigin.value.copy(origin);
    this.pointerRayDirection.value.copy(direction).normalize();
    this.pointerForce.value.copy(force);
  }

  clearPointerForce() {
    this.pointerForce.value.set(0, 0, 0);
  }

  setCollider(center, radius, velocity = null, enabled = true) {
    this.colliderCenter.value.copy(center);
    this.colliderRadius.value = radius;
    this.colliderVelocity.value.copy(velocity || new THREE.Vector3());
    this.colliderEnabled.value = enabled ? 1 : 0;
  }
}
