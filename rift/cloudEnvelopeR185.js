import * as THREE from "three";

// -----------------------------------------------------------------------------
// r185 cumulus weather envelope.
//
// The previous progressive envelope intentionally kept almost every cloud top at
// the same height. That removed one source of terracing, but it also turned the
// 2D coverage field into tall extruded columns: once a cloud existed at X/Z it
// tended to occupy nearly the full cloud layer. This envelope restores LARGE,
// smooth variation in cloud-top potential while keeping the cloud base almost
// flat. The existing 3D Perlin-Worley field still owns all fine silhouette
// detail; this texture only says where a cell exists and roughly how strongly it
// can convect upward.
// -----------------------------------------------------------------------------

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

function fbm(u, v, seed, biasX = 0, biasY = 0) {
  const freqs = [2, 4, 8, 16];
  const amps = [0.58, 0.25, 0.11, 0.06];
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    sum += valueNoise(
      f,
      (u + biasX) * f,
      (v + biasY) * f,
      seed + i * 41,
    ) * amps[i];
    norm += amps[i];
  }
  return sum / Math.max(0.001, norm);
}

export function createR185CumulusEnvelopeTexture(size = 160, seed = 0x185c10d) {
  const data = new Uint8Array(size * size * 4);
  let p = 0;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;

      // Broad cloud-system placement. These fields intentionally move at
      // different phases so a cloud can have a broad body plus localized towers
      // instead of becoming one uniformly tall extrusion.
      const macro = fbm(u, v, seed + 11);
      const tower = fbm(u, v, seed + 101, 0.173, -0.231);
      const breakup = fbm(u, v, seed + 211, -0.284, 0.149);
      const shoulder = fbm(u, v, seed + 307, 0.391, 0.287);

      const formation = smooth01((macro - 0.30) / 0.52);
      const towerPotential = smooth01(((tower * 0.68 + macro * 0.32) - 0.34) / 0.52);
      const shoulderPotential = smooth01(((shoulder * 0.62 + breakup * 0.38) - 0.36) / 0.50);

      // Cumulus bases remain essentially flat. A 1-3% perturbation is enough to
      // avoid a ruler line without creating separate horizontal shelves.
      const minHeight = clamp01(0.018 + breakup * 0.014);

      // This is the key change from cloudEnvelopeProgressive.js. Top height now
      // spans roughly the lower third to the top of the layer, but only through
      // very low-frequency smooth fields. Fine cauliflower detail still comes
      // exclusively from the 3D density volume.
      const maxHeight = clamp01(
        0.30
        + Math.pow(towerPotential, 0.82) * 0.48
        + formation * 0.13
        + shoulderPotential * 0.07
      );

      // Predominantly fair-weather cumulus with a smooth transition toward
      // deeper convective cells. Runtime storm logic can still push this higher.
      const type = clamp01(
        0.30
        + towerPotential * 0.46
        + formation * 0.12
        + (breakup - 0.5) * 0.06
      );

      // Coverage remains broad and connected, but the tower field is NOT allowed
      // to independently create a full cloud column where the macro system is
      // absent. This correlation is important for natural isolated cumulus.
      const density = clamp01(
        0.08
        + formation * 0.76
        + towerPotential * formation * 0.11
        + shoulderPotential * formation * 0.05
      );

      data[p++] = Math.round(minHeight * 255);
      data[p++] = Math.round(Math.max(minHeight + 0.24, maxHeight) * 255);
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

export function createR185CumulusEnvelopePair(size = 160) {
  return {
    a: createR185CumulusEnvelopeTexture(size, 0x185c10d),
    b: createR185CumulusEnvelopeTexture(size, 0x6a09e667),
  };
}
