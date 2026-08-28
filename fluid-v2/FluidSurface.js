import * as THREE from "three";
import {
  Fn,
  attribute,
  positionLocal,
  vec3,
  float,
  color,
  mix,
  clamp,
  vertexStage,
  highpModelNormalViewMatrix,
  uniform,
  sqrt,
  dot,
  smoothstep,
} from "three/tsl";

// The visible geometry is now strictly simulation-driven. There are no analytic
// sine-wave displacements in positionNode: every crest, cavity, rebound and wake
// must exist in FluidSolver.heightA. That makes it possible to judge the actual
// physics rather than a cosmetic ripple overlay.
export class FluidSurface {
  constructor(solver) {
    this.solver = solver;
    this.time = uniform(0); // retained for review-tool compatibility
    this.mesh = this._buildMesh();
  }

  update(dt) {
    this.time.value += Math.min(Number(dt) || 0, 1 / 24);
  }

  _buildMesh() {
    const {
      size,
      worldSize,
      cellWorldSize,
      heightA,
      foamA,
      velocityA,
    } = this.solver;

    const geometry = new THREE.PlaneGeometry(
      worldSize,
      worldSize,
      size - 1,
      size - 1,
    );
    geometry.rotateX(-Math.PI / 2);

    const indices = new Float32Array(size * size);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    geometry.setAttribute("fluidCell", new THREE.Float32BufferAttribute(indices, 1));

    const cellIndex = attribute("fluidCell", "float").toUint();

    const material = new THREE.MeshPhysicalNodeMaterial({
      color: 0x08758d,
      roughness: 0.032,
      metalness: 0,
      transmission: 0.965,
      ior: 1.333,
      thickness: 1.62,
      attenuationDistance: 12,
      attenuationColor: new THREE.Color(0x2697ad),
      clearcoat: 0.03,
      clearcoatRoughness: 0.045,
      envMapIntensity: 1.45,
      side: THREE.DoubleSide,
    });

    material.positionNode = Fn(() => {
      const h = heightA.element(cellIndex);
      return positionLocal.add(vec3(0, h, 0));
    })();

    const localSurfaceNormal = Fn(() => {
      const x = cellIndex.mod(size).toFloat();
      const y = cellIndex.div(size).toFloat();
      const xm = x.sub(1).max(0);
      const xp = x.add(1).min(size - 1);
      const ym = y.sub(1).max(0);
      const yp = y.add(1).min(size - 1);

      const idxL = y.mul(size).add(xm).toUint();
      const idxR = y.mul(size).add(xp).toUint();
      const idxU = ym.mul(size).add(x).toUint();
      const idxD = yp.mul(size).add(x).toUint();

      const dhdx = heightA.element(idxR).sub(heightA.element(idxL))
        .div(2 * cellWorldSize);
      const dhdz = heightA.element(idxD).sub(heightA.element(idxU))
        .div(2 * cellWorldSize);

      return vec3(dhdx.mul(-1), 1, dhdz.mul(-1)).normalize();
    })();

    material.normalNode = vertexStage(
      highpModelNormalViewMatrix.mul(localSurfaceNormal),
    ).normalize();

    const foam = vertexStage(foamA.element(cellIndex));
    const foamMask = clamp(foam.mul(1.55), 0, 1);
    const velocity = velocityA.element(cellIndex);
    const speed = vertexStage(sqrt(dot(velocity, velocity)));
    const turbulent = smoothstep(0.45, 4.5, speed);

    material.colorNode = mix(
      color(0x077087),
      color(0xf4ffff),
      foamMask,
    );
    material.roughnessNode = mix(
      mix(float(0.028), float(0.12), turbulent),
      float(0.56),
      foamMask,
    );
    material.transmissionNode = mix(float(0.97), float(0.035), foamMask);
    material.thicknessNode = mix(float(1.62), float(0.12), foamMask);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "HybridFluidHeightfield";
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    return mesh;
  }
}

export function createPoolEnvironment(worldSize) {
  const group = new THREE.Group();
  group.name = "FluidLabPool";

  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0xb8a682,
    roughness: 0.76,
    metalness: 0,
  });
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(worldSize + 6, 1.1, worldSize + 6),
    floorMaterial,
  );
  floor.position.y = -4.1;
  floor.receiveShadow = true;
  group.add(floor);

  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0x52646b,
    roughness: 0.42,
    metalness: 0.06,
  });
  const wallHeight = 3.6;
  const wallThickness = 0.65;
  const half = worldSize * 0.5 + wallThickness * 0.5;

  const wallX = new THREE.BoxGeometry(wallThickness, wallHeight, worldSize + wallThickness * 2);
  const wallZ = new THREE.BoxGeometry(worldSize + wallThickness * 2, wallHeight, wallThickness);

  for (const x of [-half, half]) {
    const wall = new THREE.Mesh(wallX, wallMaterial);
    wall.position.set(x, -1.85, 0);
    wall.receiveShadow = true;
    wall.castShadow = true;
    group.add(wall);
  }
  for (const z of [-half, half]) {
    const wall = new THREE.Mesh(wallZ, wallMaterial);
    wall.position.set(0, -1.85, z);
    wall.receiveShadow = true;
    wall.castShadow = true;
    group.add(wall);
  }

  const rockMaterial = new THREE.MeshStandardMaterial({
    color: 0x4d554f,
    roughness: 0.92,
  });
  const rocks = [
    [-7.5, -3.05, -4.2, 2.2],
    [6.4, -3.15, 5.2, 1.8],
    [2.0, -3.35, -7.7, 1.25],
  ];
  for (const [x, y, z, r] of rocks) {
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), rockMaterial);
    rock.position.set(x, y, z);
    rock.scale.y = 0.62;
    rock.rotation.set(Math.random() * 0.4, Math.random() * Math.PI, Math.random() * 0.3);
    rock.receiveShadow = true;
    rock.castShadow = true;
    group.add(rock);
  }

  return group;
}
