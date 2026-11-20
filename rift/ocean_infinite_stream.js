// Rift Islands — continuous offshore ocean and bathymetry streaming.
// One lightweight far-water draw and one re-centered seabed draw. The original
// 2000-unit FFT water and 480-unit island mesh are intentionally untouched.
// Ocean geometry, not the FFT storage buffers, is streamed on coarse cells.
import * as THREE from "three";
import { uniform, float, sin, cos, clamp, mix, color, vec3, dot, smoothstep, positionLocal, positionWorld, cameraPosition } from "three/tsl";

const FLOOR_SIZE = 832;
const FLOOR_GRID = 52; // 17-ish world units per cell, ~2.7k vertices
const WATER_SIZE = 5888;
const WATER_GRID = 96; // distant visual geometry only, ~9.4k vertices
const ISLAND_MESH_HALF = 240;
const FFT_WATER_HALF = 1000;
const FLOOR_SNAP = 128;
const WATER_SNAP = 256;
// Structural abyss experiment: keep stable production sea untouched.
const ABYSS_TRIAL = typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("riftAbyss") === "on";

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
  // Warp phase by a second, incommensurate swell so distant ridges do
  // not form the three evenly spaced sine-wave rows visible underwater.
  // Vertex-only arithmetic; no textures, extra meshes or GPU dispatches.
  const irregular = ABYSS_TRIAL
    ? sin(c.mul(0.71).add(t.mul(0.083))).mul(0.78)
        .add(sin(b.mul(0.43).sub(t.mul(0.117))).mul(0.39))
    : float(0);
  const roll1 = sin(a.add(t.mul(0.28)).add(irregular))
    .mul(mix(float(0.40), float(2.35), offshore));
  const roll2 = sin(b.sub(t.mul(0.22)).sub(irregular.mul(0.66)))
    .mul(mix(float(0.24), float(1.10), offshore));
  const roll3 = sin(c.add(t.mul(0.14)).add(sin(b.mul(0.31)).mul(0.8))
    .add(irregular.mul(0.33)))
    .mul(mix(float(0.13), float(0.78), offshore));
  const swell = roll1.add(roll2).add(roll3);
  material.positionNode = p.add(vec3(float(0), swell, float(0)));

  // Increasing blue-water light absorption follows the same staged
  // continental shelf as the seabed. Underwater camera depth further dims
  // the underside so the outer ocean no longer looks like a bright ceiling.
  const sea = mix(color(0x17668b), color(0x093b66), offshore);
  const abyssal = mix(sea, color(ABYSS_TRIAL ? 0x021126 : 0x031c38),
    abyss.mul(ABYSS_TRIAL ? 0.94 : 0.82));
  const deepUnder = smoothstep(float(2), float(38), cameraDepth);
  // Reuse the moving long-wave phases for an approximate analytic normal.
  // This gives the distance sea broad slanted, light-catching faces rather
  // than a flat painted band. No extra texture lookups or compute passes.
  const slopeX = cos(a.add(t.mul(0.28))).mul(0.0062)
    .add(cos(b.sub(t.mul(0.22))).mul(-0.0047))
    .mul(mix(float(0.5), float(2.1), offshore));
  const slopeZ = cos(a.add(t.mul(0.28))).mul(0.0031)
    .add(cos(b.sub(t.mul(0.22))).mul(0.0091))
    .mul(mix(float(0.5), float(2.1), offshore));
  const facetNormal = vec3(slopeX.negate(), float(1), slopeZ.negate()).normalize();
  const towardCamera = cameraPosition.sub(positionWorld).normalize();
  const ndv = clamp(dot(facetNormal, towardCamera), 0, 1);
  const grazing = float(1).sub(ndv);
  const fresnel = grazing.mul(grazing).mul(grazing).mul(grazing);
  const light = sin(a.mul(1.6).sub(t.mul(0.34)))
    .mul(sin(b.mul(1.42).add(t.mul(0.27))))
    .mul(0.085).add(0.085);
  const glint = clamp(light, 0, 0.18)
    .mul(float(1).sub(abyss.mul(0.38)))
    .mul(float(1).sub(deepUnder.mul(0.94)));
  const waveFace = clamp(slopeX.mul(2.5).add(slopeZ.mul(1.9))
    .add(0.15), 0, 0.34);
  const reflectance = clamp(fresnel.mul(0.23)
    .add(waveFace.mul(0.09)).add(glint.mul(0.23)), 0, 0.25)
    .mul(float(1).sub(deepUnder.mul(0.95)));
  material.colorNode = mix(
    mix(abyssal, color(0x021327), deepUnder.mul(0.88)),
    color(0x79b7ce), reflectance,
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
        (x, z) => sampleHeight(x, z) - (ABYSS_TRIAL ? 0.65 : 0.18),
        // The coarse 16m streaming-floor cells previously cut away
        // everything whose *centre* landed within +/-240m, exposing a
        // geometric square seam at the fine island mesh edge. Under the
        // new profile overlap the edge by one cell instead (floor is
        // slightly lower to keep the fine terrain foremost).
        (x, z) => Math.abs(x) < (ABYSS_TRIAL ? ISLAND_MESH_HALF - 19 : ISLAND_MESH_HALF) &&
          Math.abs(z) < (ABYSS_TRIAL ? ISLAND_MESH_HALF - 19 : ISLAND_MESH_HALF),
        (out, x, z, y) => {
          const depth = Math.max(0, waterY - y);
          // The seabed gently disappears into the abyss palette as
          // sunlight can no longer reach it. Colors are computed only when
          // a tile is regenerated, never per frame.
          const blue = ABYSS_TRIAL
            ? smooth((depth - 5) / 48)
            : smooth((depth - 14) / 88);
          out.set(ABYSS_TRIAL ? 0x8fa89e : 0xc5c5b2)
            .lerp(deepFloorColor, blue * (ABYSS_TRIAL ? 1 : 0.98));
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
        mode: ABYSS_TRIAL ? "abyss-streaming-overlap" : "streaming-two-meshes",
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
