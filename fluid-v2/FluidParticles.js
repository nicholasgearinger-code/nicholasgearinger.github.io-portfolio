import * as THREE from "three";

// Detached spray is the part of the liquid that cannot be represented by a
// single-valued heightfield. It remains ballistic/particle-based, but every
// droplet that rejoins the pool deposits momentum and a small crown into the
// physical GPU surface instead of spawning a cosmetic ripple sprite.
export class FluidParticles {
  constructor(scene, solver, { count = 96 } = {}) {
    this.solver = solver;
    this.count = count;
    this.cursor = 0;
    this.states = Array.from({ length: count }, () => ({
      active: false,
      life: 0,
      position: new THREE.Vector3(0, -100, 0),
      velocity: new THREE.Vector3(),
      radius: 0.08,
    }));

    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xa9eff8,
      roughness: 0.025,
      metalness: 0,
      transmission: 0.97,
      ior: 1.333,
      thickness: 0.18,
      attenuationDistance: 1.6,
      attenuationColor: 0x57c8d4,
      clearcoat: 0.05,
      clearcoatRoughness: 0.04,
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.name = "FluidSplashDroplets";
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    this._matrix = new THREE.Matrix4();
    this._scale = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._hiddenPosition = new THREE.Vector3(0, -100, 0);
    this._hideAll();
  }

  _hideAll() {
    for (let i = 0; i < this.count; i++) {
      this._matrix.compose(
        this._hiddenPosition,
        this._quat,
        new THREE.Vector3(0, 0, 0),
      );
      this.mesh.setMatrixAt(i, this._matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  emit(x, z, strength = 1, sourceVelocity = null) {
    const energy = THREE.MathUtils.clamp(Math.abs(strength), 0.15, 2.0);
    const burst = THREE.MathUtils.clamp(Math.round(7 + energy * 14), 7, 28);
    const baseVx = sourceVelocity?.x || 0;
    const baseVz = sourceVelocity?.z || 0;

    for (let n = 0; n < burst; n++) {
      const state = this.states[this.cursor];
      this.cursor = (this.cursor + 1) % this.count;

      const angle = Math.random() * Math.PI * 2;
      const radial = 0.75 + Math.random() * (2.4 + energy * 1.9);
      const upward = 2.6 + Math.random() * 5.8 + energy * 2.4;
      const fineSpray = Math.random() < 0.5;

      state.active = true;
      state.life = (fineSpray ? 0.44 : 0.7) + Math.random() * (fineSpray ? 0.68 : 1.3);
      state.radius = fineSpray
        ? 0.024 + Math.random() * 0.052
        : 0.055 + Math.random() * 0.14;
      state.position.set(
        x + Math.cos(angle) * Math.random() * 0.34,
        0.08 + Math.random() * 0.2,
        z + Math.sin(angle) * Math.random() * 0.34,
      );
      state.velocity.set(
        Math.cos(angle) * radial + baseVx * 0.22,
        upward,
        Math.sin(angle) * radial + baseVz * 0.22,
      );
    }
  }

  update(dt) {
    const safeDt = Math.min(dt, 1 / 30);
    const halfWorld = this.solver.worldSize * 0.5;
    let changed = false;

    for (let i = 0; i < this.count; i++) {
      const state = this.states[i];
      if (!state.active) continue;
      changed = true;

      state.life -= safeDt;
      state.velocity.y -= 9.81 * safeDt;
      state.velocity.multiplyScalar(Math.pow(0.991, safeDt * 60));
      state.position.addScaledVector(state.velocity, safeDt);

      const insidePool = Math.abs(state.position.x) < halfWorld
        && Math.abs(state.position.z) < halfWorld;

      if (state.position.y <= 0 && state.velocity.y < 0 && insidePool) {
        const impactSpeed = THREE.MathUtils.clamp(-state.velocity.y, 0.5, 8);
        const r = Math.max(0.18, state.radius * 2.4);
        this.solver.queueSplat({
          x: state.position.x,
          z: state.position.z,
          vx: state.velocity.x * 0.16,
          vz: state.velocity.z * 0.16,
          strength: -THREE.MathUtils.clamp(impactSpeed * 0.018, 0.025, 0.16),
          radius: r,
          radialImpulse: impactSpeed * 0.035,
          ringRadius: r * 1.35,
          ringWidth: Math.max(0.14, r * 0.45),
          ringStrength: THREE.MathUtils.clamp(impactSpeed * 0.012, 0.018, 0.11),
          foam: 0.12,
        });
        state.active = false;
      }

      if (state.life <= 0 || state.position.y < -5) state.active = false;

      if (state.active) {
        const speed = state.velocity.length();
        const stretch = THREE.MathUtils.clamp(1 + speed * 0.05, 1, 1.85);
        this._scale.set(state.radius * 0.86, state.radius * stretch, state.radius * 0.86);
        this._matrix.compose(state.position, this._quat, this._scale);
      } else {
        this._matrix.compose(
          this._hiddenPosition,
          this._quat,
          new THREE.Vector3(0, 0, 0),
        );
      }
      this.mesh.setMatrixAt(i, this._matrix);
    }

    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
