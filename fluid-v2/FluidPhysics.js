import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

export class FluidPhysics {
  static async create(scene, solver, particles) {
    await RAPIER.init();
    return new FluidPhysics(scene, solver, particles);
  }

  constructor(scene, solver, particles) {
    this.scene = scene;
    this.solver = solver;
    this.particles = particles;
    this.waterY = 0;
    this.entries = [];
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this._addBounds();
  }

  _addBounds() {
    const half = this.solver.worldSize * 0.5;
    const fixed = (x, y, z, hx, hy, hz) => {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.6), body);
    };
    fixed(0, -4.0, 0, half + 2, 0.55, half + 2);
    fixed(half + 0.6, -1.8, 0, 0.6, 2.2, half + 1);
    fixed(-half - 0.6, -1.8, 0, 0.6, 2.2, half + 1);
    fixed(0, -1.8, half + 0.6, half + 1, 2.2, 0.6);
    fixed(0, -1.8, -half - 0.6, half + 1, 2.2, 0.6);
  }

  spawnBall(x = 0, z = 0) {
    const radius = 0.72;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 7.5, z).setLinearDamping(0.08).setAngularDamping(0.12),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(radius).setDensity(0.65).setRestitution(0.18).setFriction(0.32), body,
    );
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 28, 18),
      new THREE.MeshPhysicalMaterial({ color: 0xffb35a, roughness: 0.22, clearcoat: 0.5 }),
    );
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.entries.push({ body, mesh, radius, previousY: 7.5, wakeCooldown: 0 });
  }

  spawnCube(x = 0, z = 0) {
    const size = 1.3;
    const half = size * 0.5;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 8.5, z).setLinearDamping(0.09).setAngularDamping(0.15),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half, half, half).setDensity(0.52).setRestitution(0.12).setFriction(0.4), body,
    );
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size, size, size),
      new THREE.MeshPhysicalMaterial({ color: 0x70d6ff, roughness: 0.18, clearcoat: 0.4 }),
    );
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.entries.push({ body, mesh, radius: half * 1.15, previousY: 8.5, wakeCooldown: 0 });
  }

  clear() {
    for (const entry of this.entries) {
      this.scene.remove(entry.mesh);
      this.world.removeRigidBody(entry.body);
    }
    this.entries.length = 0;
  }

  update(dt) {
    const safeDt = Math.min(dt, 1 / 30);
    for (const entry of this.entries) {
      const body = entry.body;
      const p = body.translation();
      const v = body.linvel();
      const submerged = THREE.MathUtils.clamp((this.waterY + entry.radius - p.y) / (entry.radius * 2), 0, 1);
      body.resetForces(true);
      body.resetTorques(true);
      if (submerged > 0) {
        const mass = Math.max(0.05, body.mass());
        const drag = 1.8 * submerged;
        body.addForce({
          x: -v.x * drag * mass,
          y: 9.81 * mass * 1.34 * submerged - v.y * drag * 0.45 * mass,
          z: -v.z * drag * mass,
        }, true);

        // Moving bodies carve a shallow trough and push horizontal momentum
        // into the flow. A negative height splat reads more like displacement
        // than the old positive mound and naturally rebounds into wake ripples.
        entry.wakeCooldown -= safeDt;
        const speed = Math.hypot(v.x, v.z);
        if (entry.wakeCooldown <= 0 && speed > 0.45) {
          const wake = Math.min(0.34, 0.07 + speed * 0.028);
          this.solver.queueSplat({
            x: p.x,
            z: p.z,
            vx: v.x * 0.36,
            vz: v.z * 0.36,
            strength: -wake,
            radius: entry.radius * 1.35,
          });
          entry.wakeCooldown = 0.07;
        }
      }
    }

    this.world.timestep = safeDt;
    this.world.step();

    for (const entry of this.entries) {
      const p = entry.body.translation();
      const q = entry.body.rotation();
      const v = entry.body.linvel();
      if (entry.previousY > 0.12 && p.y <= 0.12 && v.y < -0.6) {
        const impact = THREE.MathUtils.clamp(Math.abs(v.y) * 0.135, 0.28, 1.8);
        this.solver.queueSplat({
          x: p.x,
          z: p.z,
          vx: v.x * 0.26,
          vz: v.z * 0.26,
          strength: -impact,
          radius: entry.radius * (1.65 + impact * 0.42),
        });
        this.particles?.emit(p.x, p.z, impact, { x: v.x, z: v.z });
      }
      entry.previousY = p.y;
      entry.mesh.position.set(p.x, p.y, p.z);
      entry.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      if (p.y < -12) {
        entry.body.setTranslation({ x: 0, y: 8, z: 0 }, true);
        entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        entry.previousY = 8;
      }
    }
  }
}
