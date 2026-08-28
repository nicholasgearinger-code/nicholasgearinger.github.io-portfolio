import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

export class FluidPhysics {
  static async create(scene, solver, particles, crowns = null) {
    await RAPIER.init();
    return new FluidPhysics(scene, solver, particles, crowns);
  }

  constructor(scene, solver, particles, crowns) {
    this.scene = scene;
    this.solver = solver;
    this.particles = particles;
    this.crowns = crowns;
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
    this.entries.push({
      body,
      mesh,
      radius,
      displacedVolume: (4 / 3) * Math.PI * radius ** 3,
      previousY: 7.5,
      wakeCooldown: 0,
      impacted: false,
    });
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
    this.entries.push({
      body,
      mesh,
      radius: half * 1.15,
      displacedVolume: size ** 3,
      previousY: 8.5,
      wakeCooldown: 0,
      impacted: false,
    });
  }

  clear() {
    for (const entry of this.entries) {
      this.scene.remove(entry.mesh);
      this.world.removeRigidBody(entry.body);
    }
    this.entries.length = 0;
    this.crowns?.clear();
  }

  update(dt) {
    const safeDt = Math.min(dt, 1 / 30);

    // First apply buoyancy/drag and continuously displace the free surface where
    // moving bodies occupy water. This is deliberately separate from the one-off
    // impact impulse below: a floating object should keep making a trough/wake.
    for (const entry of this.entries) {
      const body = entry.body;
      const p = body.translation();
      const v = body.linvel();
      const submerged = THREE.MathUtils.clamp(
        (this.waterY + entry.radius - p.y) / (entry.radius * 2),
        0,
        1,
      );

      body.resetForces(true);
      body.resetTorques(true);

      if (submerged > 0) {
        const mass = Math.max(0.05, body.mass());
        const drag = 1.85 * submerged;
        body.addForce({
          x: -v.x * drag * mass,
          y: 9.81 * mass * 1.36 * submerged - v.y * drag * 0.48 * mass,
          z: -v.z * drag * mass,
        }, true);

        entry.wakeCooldown -= safeDt;
        const horizontalSpeed = Math.hypot(v.x, v.z);
        const downward = Math.max(0, -v.y);
        if (entry.wakeCooldown <= 0 && (horizontalSpeed > 0.25 || downward > 0.3)) {
          const trough = THREE.MathUtils.clamp(
            0.045 + submerged * 0.08 + horizontalSpeed * 0.012,
            0.045,
            0.24,
          );
          this.solver.queueSplat({
            x: p.x,
            z: p.z,
            vx: v.x * 0.34,
            vz: v.z * 0.34,
            strength: -trough,
            radius: entry.radius * (1.0 + submerged * 0.35),
            radialImpulse: downward * 0.14 + horizontalSpeed * 0.035,
            ringRadius: entry.radius * 1.25,
            ringWidth: entry.radius * 0.42,
            ringStrength: trough * 0.34,
            foam: horizontalSpeed * 0.025,
          });
          entry.wakeCooldown = 0.065;
        }
      }
    }

    this.world.timestep = safeDt;
    this.world.step();

    for (const entry of this.entries) {
      const p = entry.body.translation();
      const q = entry.body.rotation();
      const v = entry.body.linvel();

      // Detect the *bottom* of the object crossing the mean surface, not its
      // center. The measured vertical impact speed and approximate displaced
      // volume determine the crater, crown and radial flow injected into the GPU.
      const previousBottom = entry.previousY - entry.radius;
      const currentBottom = p.y - entry.radius;
      if (previousBottom > this.waterY && currentBottom <= this.waterY && v.y < -0.55) {
        const impactSpeed = Math.abs(v.y);
        this.solver.queueImpact({
          x: p.x,
          z: p.z,
          radius: entry.radius,
          verticalSpeed: impactSpeed,
          vx: v.x,
          vz: v.z,
          displacedVolume: entry.displacedVolume,
        });

        const sprayStrength = THREE.MathUtils.clamp(impactSpeed * 0.14, 0.35, 2.0);
        this.particles?.emit(p.x, p.z, sprayStrength, { x: v.x, z: v.z });
        this.crowns?.emit(p.x, p.z, entry.radius, impactSpeed);
        entry.impacted = true;
      }

      if (p.y - entry.radius > this.waterY + 0.35) entry.impacted = false;
      entry.previousY = p.y;
      entry.mesh.position.set(p.x, p.y, p.z);
      entry.mesh.quaternion.set(q.x, q.y, q.z, q.w);

      if (p.y < -12) {
        entry.body.setTranslation({ x: 0, y: 8, z: 0 }, true);
        entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        entry.previousY = 8;
        entry.impacted = false;
      }
    }
  }
}
