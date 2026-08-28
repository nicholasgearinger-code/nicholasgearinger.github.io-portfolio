import * as THREE from "three";

// Secondary liquid is deliberately separate from the heightfield. Large-scale
// water stays cheap and continuous; only detached spray pays for 3D particles.
// The droplets are instanced transmissive spheres, so dozens of refractive
// particles still render as one draw call.
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
      color: 0x9fe9f4,
      roughness: 0.04,
      metalness: 0,
      transmission: 0.94,
      ior: 1.333,
      thickness: 0.22,
      attenuationDistance: 1.7,
      attenuationColor: 0x47b8c8,
      clearcoat: 0.18,
      clearcoatRoughness: 0.05,
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
    this._hideAll();
  }

  _hideAll() {
    for (let i = 0; i < this.count; i++) {
      this._matrix.compose(
        new THREE.Vector3(0, -100, 0),
        this._quat,
        new THREE.Vector3(0, 0, 0),
      );
      this.mesh.setMatrixAt(i, this._matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  emit(x, z, strength = 1, sourceVelocity = null) {
    const burst = THREE.MathUtils.clamp(Math.round(4 + Math.abs(strength) * 8), 4, 18);
    const baseVx = sourceVelocity?.x || 0;
    const baseVz = sourceVelocity?.z || 0;

    for (let n = 0; n < burst; n++) {
      const state = this.states[this.cursor];
      this.cursor = (this.cursor + 1) % this.count;

      const angle = Math.random() * Math.PI * 2;
      const radial = 0.5 + Math.random() * 2.4;
      const upward = 2.8 + Math.random() * 5.5 + Math.abs(strength) * 1.8;

      state.active = true;
      state.life = 0.7 + Math.random() * 1.3;
      state.radius = 0.055 + Math.random() * 0.13;
      state.position.set(
        x + Math.cos(angle) * Math.random() * 0.35,
        0.12 + Math.random() * 0.22,
        z + Math.sin(angle) * Math.random() * 0.35,
      );
      state.velocity.set(
        Math.cos(angle) * radial + baseVx * 0.18,
        upward,
        Math.sin(angle) * radial + baseVz * 0.18,
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
      state.velocity.multiplyScalar(Math.pow(0.992, safeDt * 60));
      state.position.addScaledVector(state.velocity, safeDt);

      const insidePool = Math.abs(state.position.x) < halfWorld && Math.abs(state.position.z) < halfWorld;
      if (state.position.y <= 0 && state.velocity.y < 0 && insidePool) {
        // Droplet rejoins the Eulerian surface and returns its momentum to the
        // height/velocity fields. This is cheap two-way secondary-liquid coupling.
        this.solver.queueSplat({
          x: state.position.x,
          z: state.position.z,
          vx: state.velocity.x * 0.16,
          vz: state.velocity.z * 0.16,
          strength: THREE.MathUtils.clamp(-state.velocity.y * 0.055, 0.08, 0.55),
          radius: 0.35 + state.radius * 2.2,
        });
        state.active = false;
      }

      if (state.life <= 0 || state.position.y < -5) state.active = false;

      if (state.active) {
        const stretch = THREE.MathUtils.clamp(1 + Math.abs(state.velocity.y) * 0.025, 1, 1.35);
        this._scale.set(state.radius, state.radius * stretch, state.radius);
        this._matrix.compose(state.position, this._quat, this._scale);
      } else {
        this._matrix.compose(
          new THREE.Vector3(0, -100, 0),
          this._quat,
          new THREE.Vector3(0, 0, 0),
        );
      }
      this.mesh.setMatrixAt(i, this._matrix);
    }

    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
