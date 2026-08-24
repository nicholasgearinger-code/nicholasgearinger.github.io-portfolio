import * as THREE from "three";

// -----------------------------------------------------------------------------
// Nubis-inspired 2D cloud envelope field.
//
// The linked three-volumetric-clouds experiment separates cloud *shape* from
// high-frequency 3D noise with an envelope texture containing minimum height,
// maximum height, cloud type and density. Rift uses the same architecture, but
// generates a tileable world-scale envelope on the CPU once at startup.
//
// RGBA channels:
//   R = normalized cloud-base offset inside the global cloud slab
//   G = normalized local cloud top
//   B = cloud type: 0=stratus, ~0.55=cumulus, 1=cumulonimbus
//   A = macro density / formation strength
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

function hash2(x, y, seed = 0) {
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
  const ab = a + (b - a) * xf;
  const cd = c + (d - c) * xf;
  return ab + (cd - ab) * yf;
}

function fbm(u, v, seed) {
  const freqs = [2, 4, 8, 16];
  const amps = [0.52, 0.27, 0.14, 0.07];
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    sum += valueNoise(f, u * f, v * f, seed + i * 19) * amps[i];
    norm += amps[i];
  }
  return sum / norm;
}

export function createNubisEnvelopeTexture(size = 128, seed = 0x4e554249) {
  const data = new Uint8Array(size * size * 4);
  let p = 0;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;

      // Broad weather organization, tower potential, and an independent type
      // field. Keeping these on very low frequencies produces large cloud
      // systems rather than hundreds of similarly-sized noise blobs.
      const macro = fbm(u, v, seed + 11);
      const towers = fbm(u + 0.217, v - 0.143, seed + 101);
      const typeNoise = fbm(u - 0.361, v + 0.284, seed + 211);
      const breakup = fbm(u + macro * 0.08, v - macro * 0.06, seed + 307);

      const formation = smooth01((macro - 0.27) / 0.58);
      const towerPotential = smooth01((towers - 0.43) / 0.42);
      const stormCell = smooth01((macro * 0.54 + towerPotential * 0.46 - 0.62) / 0.28);

      // Fair-weather sky is predominantly cumulus. Lower type values create
      // occasional stratocumulus regions, while strong macro+tower cells can
      // grow into cumulonimbus once the runtime storm/convection state rises.
      let type = 0.48 + (typeNoise - 0.5) * 0.34 + towerPotential * 0.18 + stormCell * 0.24;
      type = clamp01(type);

      // Nearly-flat cloud bases are a defining cumulus cue. Tops vary much more
      // strongly than bases, which gives the 3D Perlin-Worley field room to form
      // tall cauliflower towers instead of thin floating pancakes.
      const minHeight = clamp01(0.025 + breakup * 0.045 + (1 - type) * 0.025);
      const topGrowth = 0.50 + formation * 0.20 + towerPotential * 0.20 + stormCell * 0.10;
      const maxHeight = clamp01(Math.max(minHeight + 0.28, minHeight + topGrowth));
      const density = clamp01(0.42 + formation * 0.38 + breakup * 0.12 + towerPotential * 0.08);

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
