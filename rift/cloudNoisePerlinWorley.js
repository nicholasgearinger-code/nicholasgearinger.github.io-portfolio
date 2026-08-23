import * as THREE from "three";

// -----------------------------------------------------------------------------
// True tileable 3D Perlin-Worley cloud noise.
//
// Base volume RGBA:
//   R = Perlin-Worley broad cloud mass
//   G = Worley F1 octave 1
//   B = Worley F1 octave 2
//   A = Worley F1 octave 3
//
// Detail volume RGBA:
//   R/G/B = progressively finer inverted Worley octaves
//   A     = their weighted FBM
//
// Everything is generated once on the CPU and uploaded as Data3DTexture. The
// renderer only samples these volumes; there is no per-frame CPU noise work.
// -----------------------------------------------------------------------------

const GRADIENTS = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function mod(n, m) {
  return ((n % m) + m) % m;
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hash32(x, y, z, seed = 0) {
  let h = (Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(y | 0, 0x5f356495) ^ Math.imul(z | 0, 0x2c1b3c6d) ^ Math.imul(seed | 0, 0x27d4eb2d)) | 0;
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
  const wx = mod(ix, period);
  const wy = mod(iy, period);
  const wz = mod(iz, period);
  const g = GRADIENTS[hash32(wx, wy, wz, seed) % GRADIENTS.length];
  return g[0] * (x - ix) + g[1] * (y - iy) + g[2] * (z - iz);
}

function perlinPeriodic(x, y, z, period, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;
  const u = fade(x - x0);
  const v = fade(y - y0);
  const w = fade(z - z0);

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
  const nxy0 = lerp(nx00, nx10, v);
  const nxy1 = lerp(nx01, nx11, v);
  // Gradient set has length sqrt(2); 0.707 approximately normalizes to [-1,1].
  return Math.max(-1, Math.min(1, lerp(nxy0, nxy1, w) * 0.70710678));
}

function perlinFbm(u, v, w, seed) {
  const frequencies = [2, 4, 8, 16];
  const amplitudes = [0.50, 0.25, 0.15, 0.10];
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < frequencies.length; i++) {
    const f = frequencies[i];
    sum += (perlinPeriodic(u * f, v * f, w * f, f, seed + i * 17) * 0.5 + 0.5) * amplitudes[i];
    norm += amplitudes[i];
  }
  return clamp01(sum / norm);
}

function worleyF1(u, v, w, cells, seed) {
  const px = u * cells;
  const py = v * cells;
  const pz = w * cells;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const iz = Math.floor(pz);
  let minDistSq = 1e9;

  for (let oz = -1; oz <= 1; oz++) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cxUnwrapped = ix + ox;
        const cyUnwrapped = iy + oy;
        const czUnwrapped = iz + oz;
        const cx = mod(cxUnwrapped, cells);
        const cy = mod(cyUnwrapped, cells);
        const cz = mod(czUnwrapped, cells);
        const fx = hash01(cx, cy, cz, seed + 11);
        const fy = hash01(cx, cy, cz, seed + 29);
        const fz = hash01(cx, cy, cz, seed + 47);
        const dx = cxUnwrapped + fx - px;
        const dy = cyUnwrapped + fy - py;
        const dz = czUnwrapped + fz - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < minDistSq) minDistSq = d2;
      }
    }
  }

  // F1 is a distance; invert it so cell centers are dense/white. sqrt(3) is
  // the maximum useful local-cell scale and keeps the channel normalized.
  return clamp01(1 - Math.sqrt(minDistSq) / 1.7320508);
}

function remap(value, oldMin, oldMax, newMin = 0, newMax = 1) {
  const t = (value - oldMin) / Math.max(1e-5, oldMax - oldMin);
  return newMin + clamp01(t) * (newMax - newMin);
}

function create3DTexture(data, size) {
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

function buildBaseVolume(size, seed) {
  const data = new Uint8Array(size * size * size * 4);
  let p = 0;
  for (let z = 0; z < size; z++) {
    const w = z / size;
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const perlin = perlinFbm(u, v, w, seed + 101);
        const w4 = worleyF1(u, v, w, 4, seed + 211);
        const w8 = worleyF1(u, v, w, 8, seed + 307);
        const w16 = worleyF1(u, v, w, 16, seed + 401);
        const worleyFbm = w4 * 0.625 + w8 * 0.25 + w16 * 0.125;

        // Classic Perlin-Worley construction: Perlin provides coherent broad
        // mass, while the Worley FBM remaps that mass into cauliflower lobes.
        const perlinWorley = remap(perlin, 1 - worleyFbm, 1, 0, 1);

        data[p++] = Math.round(clamp01(perlinWorley) * 255);
        data[p++] = Math.round(w4 * 255);
        data[p++] = Math.round(w8 * 255);
        data[p++] = Math.round(w16 * 255);
      }
    }
  }
  return create3DTexture(data, size);
}

function buildDetailVolume(size, seed) {
  const data = new Uint8Array(size * size * size * 4);
  let p = 0;
  for (let z = 0; z < size; z++) {
    const w = z / size;
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const d1 = worleyF1(u, v, w, 8, seed + 503);
        const d2 = worleyF1(u, v, w, 16, seed + 601);
        const d3 = worleyF1(u, v, w, Math.min(24, Math.max(12, Math.floor(size * 0.75))), seed + 701);
        const fbm = d1 * 0.625 + d2 * 0.25 + d3 * 0.125;
        data[p++] = Math.round(d1 * 255);
        data[p++] = Math.round(d2 * 255);
        data[p++] = Math.round(d3 * 255);
        data[p++] = Math.round(fbm * 255);
      }
    }
  }
  return create3DTexture(data, size);
}

export function createPerlinWorleyCloudVolumes({ baseSize = 32, detailSize = 24, seed = 0x52494654 } = {}) {
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const baseTexture = buildBaseVolume(baseSize, seed);
  const detailTexture = buildDetailVolume(detailSize, seed ^ 0x9e3779b9);
  const elapsed = typeof performance !== "undefined" ? performance.now() - t0 : 0;

  console.info(`[clouds] true Perlin-Worley volumes generated: ${baseSize}^3 base + ${detailSize}^3 detail (${elapsed.toFixed(1)} ms)`);

  return {
    baseTexture,
    detailTexture,
    baseSize,
    detailSize,
    dispose() {
      baseTexture.dispose();
      detailTexture.dispose();
    },
  };
}
