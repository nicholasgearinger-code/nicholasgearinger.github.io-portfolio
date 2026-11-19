// Rift Islands — continuous offshore ocean and bathymetry streaming.
// One lightweight far-water draw and one re-centered seabed draw. The original
// 2000-unit FFT water and 480-unit island mesh are intentionally untouched.
// Ocean geometry, not the FFT storage buffers, is streamed on coarse cells.
import * as THREE from "three";
import { uniform, float, sin, clamp, mix, color, vec3, smoothstep, positionLocal } from "three/tsl";

const FLOOR_SIZE = 832;
const FLOOR_GRID = 52; // 17-ish world units per cell, ~2.7k vertices
const WATER_SIZE = 5888;
const WATER_GRID = 96; // distant visual geometry only, ~9.4k vertices
const ISLAND_MESH_HALF = 240;
const FFT_WATER_HALF = 1000;
const FLOOR_SNAP = 128;
const WATER_SNAP = 256;

const smooth = t => {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const snap = (v, step) => Math.round(v / step) * step;

function buildGrid(centerX, centerZ, size, segments, heightAt, omitCell, colorAt) {
  const positions = new Float32Array((segments + 1) ** 2 * 3);
  const colors = new Float32Array((segments + 1) ** 2 * 3);
  const gridStep = size / segments;
  const c = new THREE.Color();
  let vertex = 0;
  for (let iz = 0; iz <= segments; iz++) {
    const z = centerZ - size * 0.5 + iz * gridStep;
    for (let ix = 0; ix <= segments; ix++) {
      const x = centerX - size * 0.5 + ix * gridStep;
      const y = heightAt(x, z);
      positions[vertex * 3] = x;
      positions[vertex * 3 + 1] = y;
      positions[vertex * 3 + 2] = z;
      colorAt(c, x, z, y);
      colors[vertex * 3] = c.r;
      colors[vertex * 3 + 1] = c.g;
      colors[vertex * 3 + 2] = c.b;
      vertex++;
    }
  }
  const indices = [];
  const row = segments + 1;
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const midX = centerX - size * 0.5 + (ix + 0.5) * gridStep;
      const midZ = centerZ - size * 0.5 + (iz + 0.5) * gridStep;
      if (omitCell(midX, midZ)) continue;
      const a = iz * row + ix;
      const b = a + 1, d = a + row, e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createFarWaterMaterial() {
  // Cheap non-FFT far-field ocean: three irregular, long rolling swells in
  // the *vertex* stage, driven by distance offshore. No additional compute,
  // textures, screen captures or draw calls. Keep phase in world coordinates
  // so streamed cells do not visibly restart their motion.
  const material = new THREE.MeshBasicNodeMaterial();
  const t = uniform(0);
  const cameraDepth = uniform(0);
  const p = positionLocal;
  const radius2 = p.x.mul(p.x).add(p.z.mul(p.z));
  const offshore = smoothstep(float(210 * 210), float(1600 * 1600), radius2);
  const abyss = smoothstep(float(600 * 600), float(1600 * 1600), radius2);
  const a = p.x.mul(0.0062).add(p.z.mul(0.0031));
  const b = p.z.mul(0.0091).sub(p.x.mul(0.0047));
  const c = p.x.mul(0.0036).sub(p.z.mul(0.0067));
  const roll1 = sin(a.add(t.mul(0.28)))
    .mul(mix(float(0.40), float(2.35), offshore));
  const roll2 = sin(b.sub(t.mul(0.22)))
    .mul(mix(float(0.24), float(1.10), offshore));
  const roll3 = sin(c.add(t.mul(0.14)).add(sin(b.mul(0.31)).mul(0.8)))
    .mul(mix(float(0.13), float(0.78), offshore));
  const swell = roll1.add(roll2).add(roll3);
  material.positionNode = p.add(vec3(float(0), swell, float(0)));

  // Increasing blue-water light absorption follows the same staged
  // continental shelf as the seabed. Underwater camera depth further dims
  // the underside so the outer ocean no longer looks like a bright ceiling.
  const sea = mix(color(0x17668b), color(0x093b66), offshore);
  const abyssal = mix(sea, color(0x031c38), abyss.mul(0.82));
  const deepUnder = smoothstep(float(2), float(38), cameraDepth);
  const light = sin(a.mul(1.6).sub(t.mul(0.34)))
    .mul(sin(b.mul(1.42).add(t.mul(0.27))))
    .mul(0.08).add(0.08);
  const glint = clamp(light, 0, 0.17).mul(float(1).sub(abyss.mul(0.55)))
    .mul(float(1).sub(deepUnder.mul(0.9)));
  material.colorNode = mix(
    mix(abyssal, color(0x021327), deepUnder.mul(0.85)),
    color(0x6baabd), glint,
  );
  material.side = THREE.DoubleSide;
  material.depthWrite = true;
  material.fog = true;
  material.transparent = false;
  material.userData.riftTime = t;
  material.userData.riftCameraDepth = cameraDepth;
  return material;
}

export function createInfiniteOceanStream(scene, waterY, sampleHeight, options = {}) {
  const deferredDispose = typeof options.deferDispose === "function"
    ? options.deferDispose : fn => fn();
  const deepFloorColor = new THREE.Color(0x081f35);
  const floorMat = new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide, fog: true,
    depthWrite: true,
  });
  const waterMat = createFarWaterMaterial();
  const floorMesh = new THREE.Mesh(new THREE.BufferGeometry(), floorMat);
  const farMesh = new THREE.Mesh(new THREE.BufferGeometry(), waterMat);
  floorMesh.name = "rift-streaming-deep-seafloor";
  farMesh.name = "rift-streaming-distant-ocean";
  floorMesh.receiveShadow = false;
  floorMesh.castShadow = false;
  farMesh.receiveShadow = false;
  farMesh.castShadow = false;
  floorMesh.frustumCulled = false;
  farMesh.frustumCulled = false;
  floorMesh.renderOrder = -4;
  farMesh.renderOrder = 8; // original transparent FFT ocean renders at 10
  scene.add(floorMesh, farMesh);

  let lastFloorX = NaN, lastFloorZ = NaN;
  let lastWaterX = NaN, lastWaterZ = NaN;
  let floorBuilds = 0, waterBuilds = 0, disposed = false;

  const update = (playerPos, time) => {
    if (disposed || !playerPos) return;
    waterMat.userData.riftTime.value = Number.isFinite(time) ? time : 0;
    waterMat.userData.riftCameraDepth.value = Math.max(0, waterY - (playerPos.y ?? waterY));
    const fx = snap(playerPos.x, FLOOR_SNAP);
    const fz = snap(playerPos.z, FLOOR_SNAP);
    if (fx !== lastFloorX || fz !== lastFloorZ) {
      const geom = buildGrid(
        fx, fz, FLOOR_SIZE, FLOOR_GRID,
        (x, z) => sampleHeight(x, z) - 0.18,
        (x, z) => Math.abs(x) < ISLAND_MESH_HALF &&
          Math.abs(z) < ISLAND_MESH_HALF,
        (out, x, z, y) => {
          const depth = Math.max(0, waterY - y);
          // The seabed gently disappears into the abyss palette as
          // sunlight can no longer reach it. Colors are computed only when
          // a tile is regenerated, never per frame.
          const blue = smooth((depth - 14) / 88);
          out.set(0xc5c5b2).lerp(deepFloorColor, blue * 0.98);
        },
      );
      const previous = floorMesh.geometry;
      floorMesh.geometry = geom;
      if (previous) deferredDispose(() => previous.dispose());
      lastFloorX = fx; lastFloorZ = fz; floorBuilds++;
    }

    const wx = snap(playerPos.x, WATER_SNAP);
    const wz = snap(playerPos.z, WATER_SNAP);
    if (wx !== lastWaterX || wz !== lastWaterZ) {
      const geom = buildGrid(
        wx, wz, WATER_SIZE, WATER_GRID,
        () => waterY - 0.15,
        (x, z) => Math.abs(x) < FFT_WATER_HALF &&
          Math.abs(z) < FFT_WATER_HALF,
        out => out.set(0xffffff),
      );
      const previous = farMesh.geometry;
      farMesh.geometry = geom;
      if (previous) deferredDispose(() => previous.dispose());
      lastWaterX = wx; lastWaterZ = wz; waterBuilds++;
    }
    if (typeof globalThis !== "undefined") {
      globalThis.__riftOceanStream = {
        active: true, floorBuilds, waterBuilds,
        floorVertices: floorMesh.geometry.attributes.position?.count ?? 0,
        waterVertices: farMesh.geometry.attributes.position?.count ?? 0,
        distance: Math.round(Math.hypot(playerPos.x, playerPos.z)),
        mode: "streaming-two-meshes",
      };
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    scene.remove(floorMesh, farMesh);
    const floorGeo = floorMesh.geometry, farGeo = farMesh.geometry;
    deferredDispose(() => {
      floorGeo.dispose(); farGeo.dispose();
      floorMat.dispose(); waterMat.dispose();
    });
    if (typeof globalThis !== "undefined") delete globalThis.__riftOceanStream;
  };
  return { update, dispose };
}
