import * as THREE from "three";

// Secondary splash sheets are driven by measured rigid-body impact energy.
// The primary crater/crown deformation lives in FluidSolver; this class only
// represents the thin sheet of liquid that leaves the single-valued heightfield
// after a sufficiently energetic impact.
export class FluidSplashCrowns {
  constructor(scene, solver, { count = 6, segments = 40 } = {}) {
    this.scene = scene;
    this.solver = solver;
    this.count = count;
    this.segments = segments;
    this.cursor = 0;
    this.states = [];

    for (let i = 0; i < count; i++) {
      const geometry = this._createGeometry();
      const material = new THREE.MeshPhysicalMaterial({
        color: 0xbfefff,
        roughness: 0.055,
        metalness: 0,
        transmission: 0.82,
        ior: 1.333,
        thickness: 0.08,
        attenuationDistance: 1.5,
        attenuationColor: 0x5fc7d6,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      scene.add(mesh);

      this.states.push({
        active: false,
        mesh,
        age: 0,
        life: 0.7,
        radius0: 0.7,
        radialSpeed: 2,
        verticalSpeed: 3,
        energy: 1,
        seed: Math.random() * 20,
      });
    }
  }

  _createGeometry() {
    const segments = this.segments;
    const positions = new Float32Array((segments + 1) * 2 * 3);
    const indices = [];
    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  emit(x, z, radius = 0.7, impactSpeed = 4) {
    const state = this.states[this.cursor];
    this.cursor = (this.cursor + 1) % this.count;

    const speed = THREE.MathUtils.clamp(Math.abs(impactSpeed), 0.5, 14);
    state.active = true;
    state.age = 0;
    state.radius0 = Math.max(0.3, radius * 0.9);
    state.radialSpeed = 1.5 + speed * 0.22;
    state.verticalSpeed = 2.3 + speed * 0.34;
    state.life = 0.48 + Math.min(0.48, speed * 0.034);
    state.energy = THREE.MathUtils.clamp(speed / 8, 0.2, 1.8);
    state.seed = Math.random() * 30;
    state.mesh.position.set(x, 0.015, z);
    state.mesh.visible = true;
    state.mesh.material.opacity = 0.62;
    this._updateGeometry(state, 0);
  }

  update(dt) {
    const safeDt = Math.min(Number(dt) || 0, 1 / 30);
    for (const state of this.states) {
      if (!state.active) continue;
      state.age += safeDt;
      const t = state.age;
      const normalized = t / state.life;
      if (normalized >= 1) {
        state.active = false;
        state.mesh.visible = false;
        continue;
      }

      this._updateGeometry(state, t);
      const fadeIn = Math.min(1, normalized * 6);
      const fadeOut = Math.max(0, 1 - normalized * normalized);
      state.mesh.material.opacity = 0.68 * fadeIn * fadeOut;
    }
  }

  _updateGeometry(state, t) {
    const positions = state.mesh.geometry.attributes.position.array;
    const segments = this.segments;
    const radius = state.radius0 + state.radialSpeed * t;
    const ballistic = Math.max(0, state.verticalSpeed * t - 0.5 * 9.81 * t * t);
    const baseLift = 0.015 + Math.min(0.08, t * 0.18);

    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      const angle = u * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const fingers = 0.74
        + 0.17 * Math.sin(angle * 7 + state.seed)
        + 0.09 * Math.sin(angle * 13 - state.seed * 0.7);
      const rimHeight = ballistic * Math.max(0.35, fingers);
      const rimKick = 0.08 * state.energy * Math.sin(angle * 5 + state.seed + t * 9);

      const base = i * 6;
      positions[base] = c * Math.max(0.1, radius - 0.18);
      positions[base + 1] = baseLift;
      positions[base + 2] = s * Math.max(0.1, radius - 0.18);

      positions[base + 3] = c * (radius + rimKick);
      positions[base + 4] = baseLift + rimHeight;
      positions[base + 5] = s * (radius + rimKick);
    }

    state.mesh.geometry.attributes.position.needsUpdate = true;
    state.mesh.geometry.computeVertexNormals();
  }

  clear() {
    for (const state of this.states) {
      state.active = false;
      state.mesh.visible = false;
    }
  }
}
