// Rift Islands — continuous offshore ocean and bathymetry streaming.
// One lightweight far-water draw and one re-centered seabed draw. The original
// 2000-unit FFT water and 480-unit island mesh are intentionally untouched.
// Ocean geometry, not the FFT storage buffers, is streamed on coarse cells.
import * as THREE from "three";
import { uniform, float, sin, clamp, mix, color, vec3, positionLocal, positionWorld } from "three/tsl";

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
  // MeshBasicNodeMaterial prevents costly extra PBR lights/shadows in the
  // distance. Two travelling wave bands; no new FFT, textures or render passes.
  const material = new THREE.MeshBasicNodeMaterial();
  const t = uniform(0);
  const waveX = positionLocal.x.mul(0.010).add(positionLocal.z.mul(0.005));
  const waveZ = positionLocal.z.mul(0.018).sub(positionLocal.x.mul(0.006));
  const rolling = sin(waveX.add(t.mul(0.43))).mul(0.52)
    .add(sin(waveZ.sub(t.mul(0.31))).mul(0.22));
  material.positionNode = positionLocal.add(vec3(float(0), rolling, float(0)));
  const sparkle = clamp(sin(waveX.mul(1.9).sub(t.mul(0.49)))
    .mul(sin(waveZ.mul(1.7).add(t.mul(0.38))))
    .mul(0.11).add(0.17), 0, 0.32);
  // Match the dark ocean beyond the existing FFT boundary; keep the
  // highlight subtle, without strong uniform stripes or cheap white foam.
  material.colorNode = mix(color(0x083d6b), color(0x176b8d), sparkle);
  material.side = THREE.DoubleSide;
  material.depthWrite = true;
  material.fog = true;
  material.transparent = false;
  material.userData.riftTime = t;
  return material;
}

export function createInfiniteOceanStream(scene, waterY, sampleHeight, options = {}) {
  const deferredDispose = typeof options.deferDispose === "function"
    ? options.deferDispose : fn => fn();
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
          const blue = smooth((depth - 12) / 58);
          out.set(0xc5c5b2).lerp(new THREE.Color(0x234b62), blue * 0.93);
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
