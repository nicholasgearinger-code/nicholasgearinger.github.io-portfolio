import * as THREE from "three";

// Broad, shell-like cloud organization inspired by the public Sky Pro API model.
// The important distinction from the older Nubis envelope is that local cloud
// bases/tops stay nearly constant. The 3D Perlin-Worley field is therefore free
// to create the visible top silhouette instead of the 2D envelope stamping a
// stack of horizontal height bands into every cloud.

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function mod(n, m) {
  return ((n % m) + m) % m;
}

function hash2(x, y, seed) {
  let h = (Math.imul((x + seed * 31) | 0, 374761393) + Math.imul((y + seed * 47) | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise(cells, x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf0 = x - xi;
  const yf0 = y - yi;
  const xf = xf0 * xf0 * (3 - 2 * xf0);
  const yf = yf0 * yf0 * (3 - 2 * yf0);
  const wrap = (n) => mod(n, cells);
  const a = hash2(wrap(xi), wrap(yi), seed);
  const b = hash2(wrap(xi + 1), wrap(yi), seed);
  const c = hash2(wrap(xi), wrap(yi + 1), seed);
  const d = hash2(wrap(xi + 1), wrap(yi + 1), seed);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, xf),
    THREE.MathUtils.lerp(c, d, xf),
    yf,
  );
}

function fbm(u, v, seed) {
  const freqs = [2, 4, 8, 16];
  const amps = [0.56, 0.26, 0.12, 0.06];
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    sum += valueNoise(f, u * f, v * f, seed + i * 37) * amps[i];
    norm += amps[i];
  }
  return sum / Math.max(0.001, norm);
}

export function createProgressiveEnvelopeTexture(size = 128, seed = 0x51a7c10d) {
  const data = new Uint8Array(size * size * 4);
  let p = 0;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;

      // Very broad organization with a little independent breakup. This channel
      // only decides where cloud systems prefer to exist; it does not prescribe
      // their local height silhouette.
      const macro = fbm(u, v, seed + 11);
      const towers = fbm(u + 0.173, v - 0.231, seed + 101);
      const breakup = fbm(u - 0.284 + macro * 0.06, v + 0.149 - macro * 0.04, seed + 211);
      const formation = smooth01((macro - 0.30) / 0.50);
      const towerPotential = smooth01((towers - 0.40) / 0.46);

      // Keep the shell floor almost flat. Tiny variation avoids a ruler-straight
      // base while remaining too small to produce the old visible layer cake.
      const minHeight = clamp01(0.020 + breakup * 0.015);

      // Keep the local top high and nearly uniform. The 3D density field now owns
      // the rounded cauliflower top instead of a 2D height mask clipping it.
      const maxHeight = clamp01(0.88 + towerPotential * 0.07 + formation * 0.03);

      // Predominantly cumulus. Storm/runtime convection can still push this
      // toward cumulonimbus through the existing shader logic.
      const type = clamp01(0.56 + towerPotential * 0.18 + (breakup - 0.5) * 0.08);

      // Strong low-frequency coverage contrast gives large blue gaps and large
      // connected cloud masses rather than hundreds of little identical blobs.
      const density = clamp01(0.14 + formation * 0.70 + towerPotential * 0.12 + breakup * 0.04);

      data[p++] = Math.round(minHeight * 255);
      data[p++] = Math.round(maxHeight * 255);
      data[p++] = Math.round(type * 255);
      data[p++] = Math.round(density * 255);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createProgressiveEnvelopePair(size = 128) {
  return {
    a: createProgressiveEnvelopeTexture(size, 0x51a7c10d),
    b: createProgressiveEnvelopeTexture(size, 0x2ea9f365),
  };
}
