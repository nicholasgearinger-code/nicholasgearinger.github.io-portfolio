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
} from "three/tsl";

// Renders the GPU height/foam storage buffers directly. No CPU vertex upload is
// performed after construction: vertex displacement, normals, foam color,
// roughness and transmission all read the live simulation buffers.
export class FluidSurface {
  constructor(solver) {
    this.solver = solver;
    this.mesh = this._buildMesh();
  }

  _buildMesh() {
    const { size, worldSize, cellWorldSize, heightA, foamA } = this.solver;

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
      color: 0x0b6178,
      roughness: 0.065,
      metalness: 0,
      transmission: 0.9,
      ior: 1.333,
      thickness: 1.35,
      attenuationDistance: 14,
      attenuationColor: new THREE.Color(0x2c9bb0),
      clearcoat: 0.22,
      clearcoatRoughness: 0.08,
      side: THREE.DoubleSide,
    });

    material.positionNode = Fn(() => {
      const h = heightA.element(cellIndex);
      return positionLocal.add(vec3(0, h, 0));
    })();

    // Finite-difference normals are evaluated in the vertex stage from the same
    // storage field that displaced the surface. The varying is normalized again
    // in the fragment stage so highlights stay smooth across the grid.
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
    const foamMask = clamp(foam.mul(1.35), 0, 1);

    material.colorNode = mix(
      color(0x07566d),
      color(0xe9fbff),
      foamMask,
    );
    material.roughnessNode = mix(float(0.055), float(0.42), foamMask);
    material.transmissionNode = mix(float(0.92), float(0.08), foamMask);
    material.thicknessNode = mix(float(1.45), float(0.18), foamMask);

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
    color: 0x8d765a,
    roughness: 0.74,
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
    color: 0x485a62,
    roughness: 0.46,
    metalness: 0.08,
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

  // A few submerged forms make transmission/refraction easy to judge during
  // review without requiring external model assets.
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
