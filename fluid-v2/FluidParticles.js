import * as THREE from "three";

// Secondary liquid is deliberately separate from the heightfield. Large-scale
// water stays cheap and continuous; only detached spray pays for 3D particles.
// Droplets are instanced transmissive geometry and impact rings use one additive
// InstancedMesh, keeping the visual splash richer without exploding draw calls.
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

    // A single expanding ring mesh makes impact ripples readable immediately.
    // Black instance colors contribute nothing under additive blending, so the
    // rings can fade independently without a custom shader or many materials.
    this.ringCount = 24;
    this.ringCursor = 0;
    this.rings = Array.from({ length: this.ringCount }, () => ({
      active: false,
      age: 0,
      life: 0.7,
      x: 0,
      z: 0,
      strength: 1,
    }));

    const ringGeometry = new THREE.RingGeometry(0.84, 1.0, 56);
    ringGeometry.rotateX(-Math.PI / 2);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.76,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ringMesh = new THREE.InstancedMesh(ringGeometry, ringMaterial, this.ringCount);
    this.ringMesh.name = "FluidImpactRippleRings";
    this.ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ringMesh.frustumCulled = false;
    this.ringMesh.renderOrder = 3;
    scene.add(this.ringMesh);

    this._matrix = new THREE.Matrix4();
    this._scale = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._color = new THREE.Color();
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

    for (let i = 0; i < this.ringCount; i++) {
      this._matrix.compose(
        this._hiddenPosition,
        this._quat,
        new THREE.Vector3(0, 0, 0),
      );
      this.ringMesh.setMatrixAt(i, this._matrix);
      this.ringMesh.setColorAt(i, new THREE.Color(0x000000));
    }
    this.ringMesh.instanceMatrix.needsUpdate = true;
    if (this.ringMesh.instanceColor) this.ringMesh.instanceColor.needsUpdate = true;
  }

  emitRing(x, z, strength = 1) {
    const ring = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.ringCount;
    ring.active = true;
    ring.age = 0;
    ring.life = 0.58 + THREE.MathUtils.clamp(Math.abs(strength), 0, 1.8) * 0.18;
    ring.x = x;
    ring.z = z;
    ring.strength = THREE.MathUtils.clamp(Math.abs(strength), 0.2, 1.8);
  }

  emit(x, z, strength = 1, sourceVelocity = null) {
    this.emitRing(x, z, strength);

    const energy = THREE.MathUtils.clamp(Math.abs(strength), 0.15, 1.8);
    const burst = THREE.MathUtils.clamp(Math.round(6 + energy * 12), 6, 24);
    const baseVx = sourceVelocity?.x || 0;
    const baseVz = sourceVelocity?.z || 0;

    for (let n = 0; n < burst; n++) {
      const state = this.states[this.cursor];
      this.cursor = (this.cursor + 1) % this.count;

      const angle = Math.random() * Math.PI * 2;
      const radial = 0.75 + Math.random() * (2.2 + energy * 1.8);
      const upward = 2.5 + Math.random() * 5.6 + energy * 2.3;
      const fineSpray = Math.random() < 0.44;

      state.active = true;
      state.life = (fineSpray ? 0.48 : 0.72) + Math.random() * (fineSpray ? 0.72 : 1.35);
      state.radius = fineSpray
        ? 0.028 + Math.random() * 0.055
        : 0.06 + Math.random() * 0.14;
      state.position.set(
        x + Math.cos(angle) * Math.random() * 0.32,
        0.08 + Math.random() * 0.18,
        z + Math.sin(angle) * Math.random() * 0.32,
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

      const insidePool = Math.abs(state.position.x) < halfWorld && Math.abs(state.position.z) < halfWorld;
      if (state.position.y <= 0 && state.velocity.y < 0 && insidePool) {
        // Droplet rejoins the Eulerian surface and returns its momentum to the
        // height/velocity fields. Secondary impacts also create a small ring.
        const returnStrength = THREE.MathUtils.clamp(-state.velocity.y * 0.05, 0.06, 0.45);
        this.solver.queueSplat({
          x: state.position.x,
          z: state.position.z,
          vx: state.velocity.x * 0.18,
          vz: state.velocity.z * 0.18,
          strength: -returnStrength,
          radius: 0.28 + state.radius * 2.0,
        });
        if (returnStrength > 0.16) this.emitRing(state.position.x, state.position.z, returnStrength * 0.55);
        state.active = false;
      }

      if (state.life <= 0 || state.position.y < -5) state.active = false;

      if (state.active) {
        const speed = state.velocity.length();
        const stretch = THREE.MathUtils.clamp(1 + speed * 0.045, 1, 1.75);
        this._scale.set(state.radius * 0.88, state.radius * stretch, state.radius * 0.88);
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

    let ringsChanged = false;
    for (let i = 0; i < this.ringCount; i++) {
      const ring = this.rings[i];
      if (!ring.active) continue;
      ringsChanged = true;
      ring.age += safeDt;
      const t = THREE.MathUtils.clamp(ring.age / ring.life, 0, 1);
      if (t >= 1) ring.active = false;

      if (ring.active) {
        const radius = 0.22 + t * (1.7 + ring.strength * 1.25);
        const flatten = 1 + t * 0.16;
        this._scale.set(radius, flatten, radius);
        this._matrix.compose(
          new THREE.Vector3(ring.x, 0.035, ring.z),
          this._quat,
          this._scale,
        );
        const fade = (1 - t) * (1 - t) * THREE.MathUtils.clamp(0.48 + ring.strength * 0.34, 0, 1);
        this._color.setRGB(fade * 0.58, fade * 0.92, fade);
      } else {
        this._matrix.compose(
          this._hiddenPosition,
          this._quat,
          new THREE.Vector3(0, 0, 0),
        );
        this._color.setRGB(0, 0, 0);
      }
      this.ringMesh.setMatrixAt(i, this._matrix);
      this.ringMesh.setColorAt(i, this._color);
    }

    if (ringsChanged) {
      this.ringMesh.instanceMatrix.needsUpdate = true;
      if (this.ringMesh.instanceColor) this.ringMesh.instanceColor.needsUpdate = true;
    }
  }
}
