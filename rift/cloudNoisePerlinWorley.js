import * as THREE from "three";

// Tileable 3D Perlin-Worley cloud noise — mobile-startup revision.
// The channel contract is unchanged, but Worley feature points are precomputed
// once per octave instead of re-hashing 27 neighbours for every voxel. On touch
// devices the requested Model 2 volumes are conservatively capped at 40^3/24^3;
// TAAU and continuous texture filtering hide the size difference while startup
// CPU work and temporary memory fall substantially. Successful generations are
// cached for the current browser session so reloads avoid regeneration entirely.

const GRADIENTS = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

const TOUCH_DEVICE = typeof window !== "undefined" && (
  "ontouchstart" in window ||
  (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
);

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function mod(n, m) { return ((n % m) + m) % m; }
function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + (b - a) * t; }

function hash32(x, y, z, seed = 0) {
  let h = (Math.imul(x | 0, 0x1f123bb5)
    ^ Math.imul(y | 0, 0x5f356495)
    ^ Math.imul(z | 0, 0x2c1b3c6d)
    ^ Math.imul(seed | 0, 0x27d4eb2d)) | 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function hash01(x, y, z, seed = 0) {
  return hash32(x, y, z, seed) / 4294967295;
}

function gradientDot(ix, iy, iz, x, y, z, period, seed) {
  const g = GRADIENTS[
    hash32(mod(ix, period), mod(iy, period), mod(iz, period), seed) % GRADIENTS.length
  ];
  return g[0] * (x - ix) + g[1] * (y - iy) + g[2] * (z - iz);
}

function perlinPeriodic(x, y, z, period, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const x1 = x0 + 1, y1 = y0 + 1, z1 = z0 + 1;
  const u = fade(x - x0), v = fade(y - y0), w = fade(z - z0);
  const n000 = gradientDot(x0, y0, z0, x, y, z, period, seed);
  const n100 = gradientDot(x1, y0, z0, x, y, z, period, seed);
  const n010 = gradientDot(x0, y1, z0, x, y, z, period, seed);
  const n110 = gradientDot(x1, y1, z0, x, y, z, period, seed);
  const n001 = gradientDot(x0, y0, z1, x, y, z, period, seed);
  const n101 = gradientDot(x1, y0, z1, x, y, z, period, seed);
  const n011 = gradientDot(x0, y1, z1, x, y, z, period, seed);
  const n111 = gradientDot(x1, y1, z1, x, y, z, period, seed);
  const nx00 = lerp(n000, n100, u);
  const nx10 = lerp(n010, n110, u);
  const nx01 = lerp(n001, n101, u);
  const nx11 = lerp(n011, n111, u);
  return Math.max(-1, Math.min(1,
    lerp(lerp(nx00, nx10, v), lerp(nx01, nx11, v), w) * 0.70710678,
  ));
}

function perlinFbm(u, v, w, seed) {
  const frequencies = [2, 4, 8, 16];
  const amplitudes = [0.50, 0.25, 0.15, 0.10];
  let sum = 0;
  for (let i = 0; i < frequencies.length; i++) {
    const f = frequencies[i];
    sum += (perlinPeriodic(u * f, v * f, w * f, f, seed + i * 17) * 0.5 + 0.5)
      * amplitudes[i];
  }
  return clamp01(sum);
}

function createWorleyFeatures(cells, seed) {
  const data = new Float32Array(cells * cells * cells * 3);
  let p = 0;
  for (let z = 0; z < cells; z++) {
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        data[p++] = hash01(x, y, z, seed + 11);
        data[p++] = hash01(x, y, z, seed + 29);
        data[p++] = hash01(x, y, z, seed + 47);
      }
    }
  }
  return { cells, data };
}

function worleyPrepared(u, v, w, prepared) {
  const cells = prepared.cells;
  const features = prepared.data;
  const px = u * cells, py = v * cells, pz = w * cells;
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  let minDistSq = 1e9;

  for (let oz = -1; oz <= 1; oz++) {
    const uz = iz + oz;
    const wz = mod(uz, cells);
    for (let oy = -1; oy <= 1; oy++) {
      const uy = iy + oy;
      const wy = mod(uy, cells);
      for (let ox = -1; ox <= 1; ox++) {
        const ux = ix + ox;
        const wx = mod(ux, cells);
        const i = (wx + wy * cells + wz * cells * cells) * 3;
        const dx = ux + features[i] - px;
        const dy = uy + features[i + 1] - py;
        const dz = uz + features[i + 2] - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < minDistSq) minDistSq = d2;
      }
    }
  }
  return clamp01(1 - Math.sqrt(minDistSq) / 1.7320508);
}

function remap(value, oldMin, oldMax) {
  return clamp01((value - oldMin) / Math.max(1e-5, oldMax - oldMin));
}

function makeTexture(data, size) {
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.wrapR = THREE.RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function buildBaseData(size, seed) {
  const data = new Uint8Array(size * size * size * 4);
  const f4 = createWorleyFeatures(4, seed + 211);
  const f8 = createWorleyFeatures(8, seed + 307);
  const f16 = createWorleyFeatures(16, seed + 401);
  let p = 0;
  for (let z = 0; z < size; z++) {
    const w = z / size;
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const perlin = perlinFbm(u, v, w, seed + 101);
        const w4 = worleyPrepared(u, v, w, f4);
        const w8 = worleyPrepared(u, v, w, f8);
        const w16 = worleyPrepared(u, v, w, f16);
        const wf = w4 * 0.625 + w8 * 0.25 + w16 * 0.125;
        const pw = remap(perlin, 1 - wf, 1);
        data[p++] = Math.round(pw * 255);
        data[p++] = Math.round(w4 * 255);
        data[p++] = Math.round(w8 * 255);
        data[p++] = Math.round(w16 * 255);
      }
    }
  }
  return data;
}

function buildDetailData(size, seed) {
  const cells3 = Math.min(24, Math.max(12, Math.floor(size * 0.75)));
  const f8 = createWorleyFeatures(8, seed + 503);
  const f16 = createWorleyFeatures(16, seed + 601);
  const f3 = createWorleyFeatures(cells3, seed + 701);
  const data = new Uint8Array(size * size * size * 4);
  let p = 0;
  for (let z = 0; z < size; z++) {
    const w = z / size;
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const d1 = worleyPrepared(u, v, w, f8);
        const d2 = worleyPrepared(u, v, w, f16);
        const d3 = worleyPrepared(u, v, w, f3);
        const fbm = d1 * 0.625 + d2 * 0.25 + d3 * 0.125;
        data[p++] = Math.round(d1 * 255);
        data[p++] = Math.round(d2 * 255);
        data[p++] = Math.round(d3 * 255);
        data[p++] = Math.round(fbm * 255);
      }
    }
  }
  return data;
}

function bytesToBase64(bytes) {
  if (typeof btoa !== "function") return null;
  let binary = "";
  const CHUNK = 0x4000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(text) {
  if (!text || typeof atob !== "function") return null;
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readCache(key) {
  if (!TOUCH_DEVICE) return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const base = base64ToBytes(parsed.base);
    const detail = base64ToBytes(parsed.detail);
    if (!base || !detail) return null;
    return { base, detail };
  } catch (_) {
    return null;
  }
}

function writeCache(key, base, detail) {
  if (!TOUCH_DEVICE) return;
  try {
    const b = bytesToBase64(base);
    const d = bytesToBase64(detail);
    if (b && d) sessionStorage.setItem(key, JSON.stringify({ base: b, detail: d }));
  } catch (_) {
    // Storage is optional. Private mode/quota failures must never block startup.
  }
}

export function createPerlinWorleyCloudVolumes({
  baseSize = 32,
  detailSize = 24,
  seed = 0x52494654,
} = {}) {
  const requestedBase = baseSize;
  const requestedDetail = detailSize;
  if (TOUCH_DEVICE) {
    baseSize = Math.min(baseSize, 40);
    detailSize = Math.min(detailSize, 24);
  }

  const key = `rift-pw-v2:${baseSize}:${detailSize}:${seed >>> 0}`;
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  let cached = readCache(key);
  let baseData;
  let detailData;

  if (cached) {
    baseData = cached.base;
    detailData = cached.detail;
  } else {
    baseData = buildBaseData(baseSize, seed);
    detailData = buildDetailData(detailSize, seed ^ 0x9e3779b9);
    writeCache(key, baseData, detailData);
  }

  const baseTexture = makeTexture(baseData, baseSize);
  const detailTexture = makeTexture(detailData, detailSize);
  const elapsed = typeof performance !== "undefined" ? performance.now() - t0 : 0;

  console.info(
    `[clouds] Perlin-Worley ${cached ? "cache hit" : "generated"}: `
    + `${baseSize}^3 + ${detailSize}^3 (${elapsed.toFixed(1)} ms)`
    + (TOUCH_DEVICE && (baseSize !== requestedBase || detailSize !== requestedDetail)
      ? ` [mobile cap from ${requestedBase}^3/${requestedDetail}^3]`
      : ""),
  );

  return {
    baseTexture,
    detailTexture,
    baseSize,
    detailSize,
    requestedBaseSize: requestedBase,
    requestedDetailSize: requestedDetail,
    cached: !!cached,
    dispose() {
      baseTexture.dispose();
      detailTexture.dispose();
    },
  };
}
