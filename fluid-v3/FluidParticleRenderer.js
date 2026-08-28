import * as THREE from "three/webgpu";
import {
  Fn, attribute, instanceIndex, vec3, float, color, mix, clamp, smoothstep, max, dot, sqrt,
} from "three/tsl";

// First V3 surfacing stage: GPU ellipsoid splats rendered as overlapping
// physically based water volumes. Unlike V2's splash geometry, every visible
// blob is a real MLS-MPM simulation particle.
//
// This deliberately keeps the particle representation inspectable for the
// first review. A screen-space depth/thickness reconstruction pass can replace
// the visible ellipsoids later without changing the physics solver.
export class FluidParticleRenderer {
  constructor(solver, {
    domainSize = new THREE.Vector3(12, 8, 12),
    particleRadius = 0.115,
  } = {}) {
    this.solver = solver;
    this.domainSize = domainSize.clone();
    this.particleRadius = particleRadius;
    this.mesh = this._build();
  }

  _build() {
    const solver = this.solver;
    const geometry = new THREE.IcosahedronGeometry(this.particleRadius, 1);
    geometry.deleteAttribute('uv');

    const material = new THREE.MeshPhysicalNodeMaterial({
      color: 0x1a9fc3,
      roughness: 0.035,
      metalness: 0,
      transmission: 0.88,
      ior: 1.333,
      thickness: 0.32,
      attenuationDistance: 3.5,
      attenuationColor: new THREE.Color(0x1b7896),
      clearcoat: 0.05,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.45,
      side: THREE.FrontSide,
    });

    const domainScale = vec3(this.domainSize.x, this.domainSize.y, this.domainSize.z);
    const particle = solver.particleBuffer.element(instanceIndex);
    const simPosition = particle.get('position');
    const simVelocity = particle.get('velocity');

    material.positionNode = Fn(() => {
      const local = attribute('position');
      const velocityWorld = simVelocity.div(solver.gridSizeUniform).mul(domainScale);
      const speed = velocityWorld.length();
      const safeDir = velocityWorld.div(max(speed, 0.0001));

      // Velocity-aligned ellipsoid splatting. Fast jets stretch along their true
      // simulation velocity while cross-section shrinks to roughly preserve
      // volume. Slow particles remain close to spherical.
      const stretch = float(1).add(clamp(speed.mul(0.055), 0, 1.25));
      const crossScale = float(1).div(sqrt(stretch));
      const along = dot(local, safeDir);
      const deformed = local.mul(crossScale)
        .add(safeDir.mul(along.mul(stretch.sub(crossScale))));

      const worldPosition = simPosition.sub(0.5).mul(domainScale);
      return deformed.add(worldPosition);
    })();

    const velocityWorld = simVelocity.div(solver.gridSizeUniform).mul(domainScale);
    const speed = velocityWorld.length();
    const energetic = smoothstep(1.2, 5.5, speed);
    const surfaceHeight = simPosition.y;
    const spray = smoothstep(0.68, 0.94, surfaceHeight).mul(smoothstep(0.8, 4.0, speed));
    const aerated = clamp(energetic.mul(0.35).add(spray.mul(0.85)), 0, 1);

    material.colorNode = mix(color(0x0794b8), color(0xf1ffff), aerated);
    material.roughnessNode = mix(float(0.025), float(0.22), aerated);
    material.transmissionNode = mix(float(0.90), float(0.18), aerated);
    material.thicknessNode = mix(float(0.34), float(0.09), aerated);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'V3 MLS-MPM Water Particles';
    mesh.count = solver.particleCount;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

export function createV3Tank(domainSize) {
  const group = new THREE.Group();
  group.name = 'V3 Fluid Tank';

  const floorMat = new THREE.MeshStandardMaterial({ color: 0xd2c19b, roughness: 0.66, metalness: 0 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(domainSize.x + 1.2, 0.35, domainSize.z + 1.2), floorMat);
  floor.position.y = -domainSize.y * 0.5 - 0.18;
  floor.receiveShadow = true;
  group.add(floor);

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x344d57, roughness: 0.42, metalness: 0.12 });
  const t = 0.16;
  const h = domainSize.y;
  for (const x of [-domainSize.x / 2, domainSize.x / 2]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(t, h, domainSize.z), frameMat);
    wall.position.set(x, 0, 0);
    wall.receiveShadow = true;
    group.add(wall);
  }
  for (const z of [-domainSize.z / 2, domainSize.z / 2]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(domainSize.x, h, t), frameMat);
    wall.position.set(0, 0, z);
    wall.receiveShadow = true;
    group.add(wall);
  }

  return group;
}
