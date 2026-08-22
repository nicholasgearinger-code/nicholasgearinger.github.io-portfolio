import * as THREE from "three";

const TOUCH_DEVICE = typeof window !== "undefined" && (
  "ontouchstart" in window ||
  (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
);

const TARGET_SEGMENTS = TOUCH_DEVICE ? 96 : 144;
const LAND_SAMPLE_DISTANCE = 3.0;
const SEA_SAMPLE_DISTANCE = 2.4;

const DAY_WASH = new THREE.Color(0x8fe8dd);
const NIGHT_WASH = new THREE.Color(0x356d75);
const DAY_FOAM = new THREE.Color(0xfffdf7);
const NIGHT_FOAM = new THREE.Color(0xa7b9bc);

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function hash01(x, z, seed = 0) {
  const n = Math.sin(x * 12.9898 + z * 78.233 + seed * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

function makeFoamAlphaTexture(seed = 0) {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  if (!ctx) return null;

  const image = ctx.createImageData(canvas.width, canvas.height);
  const data = image.data;

  for (let y = 0; y < canvas.height; y++) {
    const yn = y / (canvas.height - 1);
    const across = Math.pow(Math.max(0, Math.sin(Math.PI * yn)), 0.62);

    for (let x = 0; x < canvas.width; x++) {
      const a = Math.sin(x * 0.091 + Math.sin(y * 0.20 + seed) * 1.8 + seed * 2.1);
      const b = Math.sin(x * 0.047 - y * 0.31 + seed * 4.3);
      const c = Math.sin(x * 0.173 + y * 0.13 + Math.sin(x * 0.019) * 2.0 + seed);
      const d = Math.sin(x * 0.029 + y * 0.67 + seed * 7.2);
      const field = a * 0.36 + b * 0.26 + c * 0.24 + d * 0.14;
      const wisps = smooth01((field + 0.62) / 1.18);
      const holes = 0.64 + 0.36 * smooth01((Math.sin(x * 0.31 + y * 0.51 + seed * 9.1) + 1) * 0.5);
      const value = clamp01(across * wisps * holes);
      const v = Math.round(value * 255);
      const i = (y * canvas.width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(14, 1);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function shorelineCount(shoreline) {
  if (!Array.isArray(shoreline)) return 0;
  let count = shoreline.length;
  if (count > 2) {
    const a = shoreline[0];
    const b = shoreline[count - 1];
    if (a && b && Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.z ?? 0) - (b.z ?? 0)) < 0.001) count--;
  }
  return count;
}

function interpolateShore(shoreline, u, centerX, centerZ) {
  const count = shorelineCount(shoreline);
  if (count <= 0) return null;

  const f = (((u % 1) + 1) % 1) * count;
  const i0 = Math.floor(f) % count;
  const i1 = (i0 + 1) % count;
  const t = f - Math.floor(f);
  const a = shoreline[i0];
  const b = shoreline[i1];
  if (!a || !b) return null;

  const x = THREE.MathUtils.lerp(Number(a.x) || 0, Number(b.x) || 0, t);
  const z = THREE.MathUtils.lerp(Number(a.z) || 0, Number(b.z) || 0, t);
  let outwardX = THREE.MathUtils.lerp(Number(a.outwardX) || 0, Number(b.outwardX) || 0, t);
  let outwardZ = THREE.MathUtils.lerp(Number(a.outwardZ) || 0, Number(b.outwardZ) || 0, t);

  let len = Math.hypot(outwardX, outwardZ);
  if (len < 1e-5) {
    outwardX = x - centerX;
    outwardZ = z - centerZ;
    len = Math.hypot(outwardX, outwardZ) || 1;
  }
  outwardX /= len;
  outwardZ /= len;
  return { x, z, outwardX, outwardZ };
}

function safeSampleHeight(sampleHeight, x, z, fallback) {
  if (typeof sampleHeight !== "function") return fallback;
  const y = sampleHeight(x, z);
  return Number.isFinite(y) ? y : fallback;
}

function buildSamples(shoreline, sampleHeight, waterY) {
  const rawCount = shorelineCount(shoreline);
  if (rawCount < 3) return [];

  let centerX = 0;
  let centerZ = 0;
  for (let i = 0; i < rawCount; i++) {
    centerX += Number(shoreline[i]?.x) || 0;
    centerZ += Number(shoreline[i]?.z) || 0;
  }
  centerX /= rawCount;
  centerZ /= rawCount;

  const count = Math.max(24, Math.min(TARGET_SEGMENTS, rawCount));
  const samples = [];
  for (let i = 0; i < count; i++) {
    const p = interpolateShore(shoreline, i / count, centerX, centerZ);
    if (!p) continue;

    const shoreY = safeSampleHeight(sampleHeight, p.x, p.z, waterY);
    const landX = p.x - p.outwardX * LAND_SAMPLE_DISTANCE;
    const landZ = p.z - p.outwardZ * LAND_SAMPLE_DISTANCE;
    const seaX = p.x + p.outwardX * SEA_SAMPLE_DISTANCE;
    const seaZ = p.z + p.outwardZ * SEA_SAMPLE_DISTANCE;

    samples.push({
      ...p,
      shoreY,
      landY: safeSampleHeight(sampleHeight, landX, landZ, shoreY + 0.7),
      seaY: safeSampleHeight(sampleHeight, seaX, seaZ, waterY - 1.0),
      phase: hash01(p.x, p.z, 1) * Math.PI * 2,
      widthRand: 0.82 + hash01(p.x, p.z, 2) * 0.36,
      liftRand: hash01(p.x, p.z, 3),
    });
  }
  return samples;
}

function estimateGround(sample, radial) {
  if (radial < 0) {
    return THREE.MathUtils.lerp(sample.shoreY, sample.landY, clamp01(-radial / LAND_SAMPLE_DISTANCE));
  }
  return THREE.MathUtils.lerp(sample.shoreY, sample.seaY, clamp01(radial / SEA_SAMPLE_DISTANCE));
}

function buildRibbonGeometry(sampleCount) {
  const rows = sampleCount + 1;
  const positions = new Float32Array(rows * 2 * 3);
  const uvs = new Float32Array(rows * 2 * 2);
  const indices = new Uint32Array(sampleCount * 6);

  for (let i = 0; i < rows; i++) {
    const u = i / sampleCount;
    const v0 = i * 2;
    uvs[v0 * 2] = u;
    uvs[v0 * 2 + 1] = 0;
    uvs[(v0 + 1) * 2] = u;
    uvs[(v0 + 1) * 2 + 1] = 1;
  }

  let q = 0;
  for (let i = 0; i < sampleCount; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = (i + 1) * 2;
    const d = c + 1;
    indices[q++] = a; indices[q++] = c; indices[q++] = b;
    indices[q++] = b; indices[q++] = c; indices[q++] = d;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

function makeLayer(samples, kind) {
  const geometry = buildRibbonGeometry(samples.length);
  let material;

  if (kind === "wash") {
    material = new THREE.MeshStandardMaterial({
      color: DAY_WASH,
      transparent: true,
      opacity: 0.24,
      roughness: 0.10,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    material.envMapIntensity = 0.82;
  } else {
    const alphaMap = makeFoamAlphaTexture(kind === "body" ? 2.7 : 7.3);
    if (alphaMap) alphaMap.repeat.set(kind === "body" ? 11 : 18, 1);
    material = new THREE.MeshStandardMaterial({
      color: DAY_FOAM,
      transparent: true,
      opacity: kind === "body" ? 0.66 : 0.86,
      roughness: kind === "body" ? 0.52 : 0.68,
      metalness: 0,
      alphaMap,
      alphaTest: 0.025,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    material.envMapIntensity = 0.24;
    material.emissive = new THREE.Color(0xf8fbf5);
    material.emissiveIntensity = kind === "body" ? 0.012 : 0.020;
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = kind === "wash" ? 10 : kind === "body" ? 11 : 12;
  return { kind, mesh, geometry, material, samples };
}

function writeVertex(array, vertexIndex, sample, radial, waterY, elapsed, lift) {
  const x = sample.x + sample.outwardX * radial;
  const z = sample.z + sample.outwardZ * radial;
  const groundY = estimateGround(sample, radial);
  const ripple = Math.sin(elapsed * 1.17 + sample.phase + radial * 0.57) * 0.018;
  const y = Math.max(groundY + 0.022 + lift, waterY + ripple + lift * 0.55);
  const o = vertexIndex * 3;
  array[o] = x;
  array[o + 1] = y;
  array[o + 2] = z;
}

function updateRibbon(layer, elapsed, storm, day, waterY) {
  const stormT = clamp01(storm);
  const dayT = clamp01(day);
  const positions = layer.geometry.attributes.position.array;
  const count = layer.samples.length;

  const globalWave =
    Math.sin(elapsed * 0.54 + 0.4) * 0.52 +
    Math.sin(elapsed * 0.83 + 2.1) * 0.30 +
    Math.sin(elapsed * 1.21 + 4.5) * 0.18;
  const globalSurge = clamp01(0.50 + globalWave * 0.36);

  for (let i = 0; i <= count; i++) {
    const s = layer.samples[i % count];
    const localWave =
      Math.sin(elapsed * 0.39 + s.phase) * 0.60 +
      Math.sin(elapsed * 0.71 + s.phase * 1.73 + 1.4) * 0.28 +
      Math.sin(elapsed * 1.07 + s.phase * 0.51 + 4.0) * 0.12;
    const surge = clamp01(globalSurge + localWave * 0.13);
    const front = -0.24 - surge * (1.42 + stormT * 0.68) - localWave * 0.10;
    const v0 = i * 2;

    if (layer.kind === "wash") {
      const landEdge = front - 0.12 * s.widthRand;
      const seaEdge = 1.28 - surge * 0.16 + localWave * 0.10;
      writeVertex(positions, v0, s, seaEdge, waterY, elapsed, 0.012);
      writeVertex(positions, v0 + 1, s, landEdge, waterY, elapsed, 0.016);
    } else if (layer.kind === "body") {
      const width = (0.62 + surge * 0.42 + stormT * 0.18) * s.widthRand;
      const landEdge = front + 0.10 + localWave * 0.05;
      const seaEdge = landEdge + width;
      writeVertex(positions, v0, s, seaEdge, waterY, elapsed, 0.052 + surge * 0.030);
      writeVertex(positions, v0 + 1, s, landEdge, waterY, elapsed, 0.032 + surge * 0.018);
    } else {
      const width = (0.20 + surge * 0.17 + stormT * 0.07) * s.widthRand;
      const landEdge = front - 0.04 + Math.sin(elapsed * 0.66 + s.phase * 1.3) * 0.06;
      const seaEdge = landEdge + width;
      writeVertex(positions, v0, s, seaEdge, waterY, elapsed, 0.090 + surge * 0.040 + s.liftRand * 0.016);
      writeVertex(positions, v0 + 1, s, landEdge, waterY, elapsed, 0.046 + surge * 0.020);
    }
  }

  layer.geometry.attributes.position.needsUpdate = true;
  layer.geometry.computeBoundingSphere();

  if (layer.kind === "wash") {
    layer.material.color.copy(NIGHT_WASH).lerp(DAY_WASH, dayT);
    layer.material.opacity = 0.14 + dayT * 0.10 + stormT * 0.035;
    layer.material.roughness = 0.08 + stormT * 0.05;
  } else {
    layer.material.color.copy(NIGHT_FOAM).lerp(DAY_FOAM, dayT);
    const base = layer.kind === "body" ? 0.46 : 0.66;
    layer.material.opacity = base + dayT * 0.16 + stormT * 0.05;
    if (layer.material.alphaMap) {
      layer.material.alphaMap.offset.x = (elapsed * (layer.kind === "body" ? -0.016 : 0.026)) % 1;
      layer.material.alphaMap.offset.y = Math.sin(elapsed * 0.09) * 0.035;
    }
  }
}

export function installShoreFoamLayers(scene, surfHandle, sampleHeight, waterY) {
  if (!scene || !surfHandle?.gpuSurfSystem || surfHandle.__riftShoreFoamLayers) {
    return surfHandle?.__riftShoreFoamLayers ?? null;
  }

  const samples = buildSamples(surfHandle.shoreline, sampleHeight, waterY);
  if (samples.length < 8) return null;

  if (surfHandle.fluidSwash?.mesh) surfHandle.fluidSwash.mesh.visible = false;

  const group = new THREE.Group();
  group.name = "rift-shore-foam-layers";
  const layers = [makeLayer(samples, "wash"), makeLayer(samples, "body"), makeLayer(samples, "edge")];
  for (const layer of layers) group.add(layer.mesh);
  scene.add(group);

  const handle = { group, layers, waterY, samples };
  surfHandle.__riftShoreFoamLayers = handle;
  return handle;
}

export function updateShoreFoamLayers(surfHandle, elapsed, cameraY, storm = 0, day = 1) {
  const handle = surfHandle?.__riftShoreFoamLayers;
  if (!handle) return;
  if (surfHandle.fluidSwash?.mesh) surfHandle.fluidSwash.mesh.visible = false;

  const underwater = Number.isFinite(cameraY) && cameraY < handle.waterY - 0.10;
  handle.group.visible = !underwater;
  if (underwater) return;

  const t = Number.isFinite(elapsed) ? elapsed : 0;
  for (const layer of handle.layers) updateRibbon(layer, t, storm, day, handle.waterY);
}

export function disposeShoreFoamLayers(scene, surfHandle) {
  const handle = surfHandle?.__riftShoreFoamLayers;
  if (!handle) return;

  scene?.remove(handle.group);
  for (const layer of handle.layers ?? []) {
    try { layer.geometry?.dispose?.(); } catch (_) {}
    try { layer.material?.alphaMap?.dispose?.(); } catch (_) {}
    try { layer.material?.dispose?.(); } catch (_) {}
  }
  surfHandle.__riftShoreFoamLayers = null;
}
