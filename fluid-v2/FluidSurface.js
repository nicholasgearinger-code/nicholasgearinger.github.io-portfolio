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
  sin,
  cos,
} from "three/tsl";

// Renders the GPU height/foam storage buffers directly. No CPU vertex upload is
// performed after construction: vertex displacement, normals, foam color,
// roughness and transmission all read the live simulation buffers.
//
// The macro water shape remains fully simulation-driven. A tiny analytic
// capillary layer is added only to the rendered displacement/normal so smooth
// areas still carry realistic reflection breakup without making the pressure
// solver pay for a much denser grid.
export class FluidSurface {
  constructor(solver) {
    this.solver = solver;
    this.time = uniform(0);
    this.mesh = this._buildMesh();
  }

  update(dt) {
    this.time.value += Math.min(Number(dt) || 0, 1 / 24);
  }

  _buildMesh() {
    const { size, worldSize, cellWorldSize, heightA, foamA } = this.solver;
    const waveTime = this.time;

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
      color: 0x0a7189,
      roughness: 0.038,
      metalness: 0,
      transmission: 0.96,
      ior: 1.333,
      thickness: 1.55,
      attenuationDistance: 12,
      attenuationColor: new THREE.Color(0x2a9aaf),
      clearcoat: 0.04,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.35,
      side: THREE.DoubleSide,
    });

    const microWaveHeight = Fn(() => {
      const p = positionLocal;
      const phaseA = p.x.mul(0.72).add(p.z.mul(0.31)).add(waveTime.mul(1.42));
      const phaseB = p.x.mul(-0.48).add(p.z.mul(0.91)).sub(waveTime.mul(1.08));
      const phaseC = p.x.mul(1.84).add(p.z.mul(-1.27)).add(waveTime.mul(2.65));
      return sin(phaseA).mul(0.034)
        .add(sin(phaseB).mul(0.022))
        .add(sin(phaseC).mul(0.009));
    });

    material.positionNode = Fn(() => {
      const h = heightA.element(cellIndex);
      const micro = microWaveHeight();
      return positionLocal.add(vec3(0, h.add(micro), 0));
    })();

    // Finite-difference normals are evaluated in the vertex stage from the same
    // storage field that displaced the surface. Analytic derivatives of the
    // capillary waves are added so reflections retain crisp small ripples even
    // though the physical grid remains mobile-friendly.
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

      let dhdx = heightA.element(idxR).sub(heightA.element(idxL))
        .div(2 * cellWorldSize);
      let dhdz = heightA.element(idxD).sub(heightA.element(idxU))
        .div(2 * cellWorldSize);

      const p = positionLocal;
      const phaseA = p.x.mul(0.72).add(p.z.mul(0.31)).add(waveTime.mul(1.42));
      const phaseB = p.x.mul(-0.48).add(p.z.mul(0.91)).sub(waveTime.mul(1.08));
      const phaseC = p.x.mul(1.84).add(p.z.mul(-1.27)).add(waveTime.mul(2.65));

      dhdx = dhdx
        .add(cos(phaseA).mul(0.034 * 0.72))
        .add(cos(phaseB).mul(0.022 * -0.48))
        .add(cos(phaseC).mul(0.009 * 1.84));
      dhdz = dhdz
        .add(cos(phaseA).mul(0.034 * 0.31))
        .add(cos(phaseB).mul(0.022 * 0.91))
        .add(cos(phaseC).mul(0.009 * -1.27));

      return vec3(dhdx.mul(-1), 1, dhdz.mul(-1)).normalize();
    })();

    material.normalNode = vertexStage(
      highpModelNormalViewMatrix.mul(localSurfaceNormal),
    ).normalize();

    const foam = vertexStage(foamA.element(cellIndex));
    const foamMask = clamp(foam.mul(1.42), 0, 1);

    material.colorNode = mix(
      color(0x087087),
      color(0xf2feff),
      foamMask,
    );
    material.roughnessNode = mix(float(0.035), float(0.48), foamMask);
    material.transmissionNode = mix(float(0.965), float(0.05), foamMask);
    material.thicknessNode = mix(float(1.58), float(0.16), foamMask);

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

  // A few submerged forms make transmission/refraction and caustic motion easy
  // to judge during review without requiring external model assets.
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
