import * as THREE from "three";

// Rift Cloud Model 2.0 weather field.
//
// The weather texture controls meteorology instead of drawing cloud silhouettes.
// Channels:
//   R = coverage potential
//   G = cloud type (0=stratiform, ~0.5=cumulus, 1=towering)
//   B = humidity / condensable moisture
//   A = storm / precipitation potential
//
// Two independent tileable fields are cross-faded and advected at different
// rates by the renderer so clouds can form and dissipate instead of behaving like
// one frozen mask sliding across the sky.

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function hash2(x, y, seed) {
  let h = Math.imul((x + seed * 29) | 0, 374761393)
    ^ Math.imul((y + seed * 43) | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise(u, v, cells, seed) {
  const x = u * cells;
  const y = v * cells;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smooth01(x - xi);
  const ty = smooth01(y - yi);
  const wrap = (n) => ((n % cells) + cells) % cells;

  const a = hash2(wrap(xi), wrap(yi), seed);
  const b = hash2(wrap(xi + 1), wrap(yi), seed);
  const c = hash2(wrap(xi), wrap(yi + 1), seed);
  const d = hash2(wrap(xi + 1), wrap(yi + 1), seed);

  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, tx),
    THREE.MathUtils.lerp(c, d, tx),
    ty,
  );
}

function fbm(u, v, seed, baseCells = 3, octaves = 5) {
  let value = 0;
  let weight = 0;
  let amp = 0.55;
  let cells = baseCells;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(u, v, cells, seed + i * 97) * amp;
    weight += amp;
    cells *= 2;
    amp *= 0.5;
  }
  return value / Math.max(1e-4, weight);
}

function torusDelta(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
}

function makeConvectiveCells(seed, count = 34) {
  const cells = [];
  let s = seed >>> 0;
  const rand = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = 0; i < count; i++) {
    cells.push({
      x: rand(),
      y: rand(),
      rx: THREE.MathUtils.lerp(0.035, 0.105, Math.pow(rand(), 0.75)),
      ry: THREE.MathUtils.lerp(0.030, 0.090, Math.pow(rand(), 0.80)),
      strength: THREE.MathUtils.lerp(0.45, 1.0, rand()),
      tower: THREE.MathUtils.lerp(0.28, 1.0, Math.pow(rand(), 0.65)),
    });
  }
  return cells;
}

function cellField(u, v, cells) {
  let union = 0;
  let tower = 0;
  for (const cell of cells) {
    const dx = torusDelta(u, cell.x) / cell.rx;
    const dy = torusDelta(v, cell.y) / cell.ry;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r >= 1) continue;
    const w = smooth01(1 - r) * cell.strength;
    union = 1 - (1 - union) * (1 - w * 0.82);
    tower = Math.max(tower, w * cell.tower);
  }
  return { union: clamp01(union), tower: clamp01(tower) };
}

function buildWeatherData(size, seed) {
  const data = new Uint8Array(size * size * 4);
  const cells = makeConvectiveCells(seed ^ 0x9e3779b9, 34);
  let p = 0;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;

      const synoptic = fbm(u, v, seed + 11, 2, 5);
      const mesoscale = fbm(u + 0.171, v - 0.233, seed + 211, 4, 4);
      const moistureNoise = fbm(u - 0.307, v + 0.119, seed + 409, 3, 5);
      const breakup = fbm(u + 0.421, v + 0.337, seed + 601, 8, 3);
      const convective = cellField(u, v, cells);

      // Weather coverage is intentionally broad and persistent. The 3D density
      // field will decide the actual cloud silhouette inside these regions.
      const coverage = clamp01(
        0.14
        + synoptic * 0.36
        + mesoscale * 0.18
        + convective.union * 0.40
        - (1 - breakup) * 0.08
      );

      // Low type values favor stratocumulus; middle values fair-weather cumulus;
      // high values allow taller convective profiles. Type never directly cuts a
      // cloud top — the 3D profile/noise still determines visible shape.
      const cloudType = clamp01(
        0.18
        + mesoscale * 0.28
        + convective.tower * 0.52
        + (coverage - 0.5) * 0.10
      );

      const humidity = clamp01(
        0.34
        + moistureNoise * 0.40
        + synoptic * 0.14
        + coverage * 0.18
      );

      const stormPotential = clamp01(
        Math.pow(Math.max(0, convective.tower - 0.50), 1.35) * 0.70
        + Math.max(0, humidity - 0.72) * 0.65
        + Math.max(0, coverage - 0.72) * 0.45
      );

      data[p++] = Math.round(coverage * 255);
      data[p++] = Math.round(cloudType * 255);
      data[p++] = Math.round(humidity * 255);
      data[p++] = Math.round(stormPotential * 255);
    }
  }

  return data;
}

function makeTexture(data, size) {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  texture.userData.riftWeatherCpu = { data, size };
  return texture;
}

export function createRiftCloudWeatherTexture(size = 192, seed = 0x52494654) {
  const data = buildWeatherData(size, seed);
  return makeTexture(data, size);
}

export function createRiftCloudWeatherPair(size = 192) {
  return {
    a: createRiftCloudWeatherTexture(size, 0x52494654),
    b: createRiftCloudWeatherTexture(size, 0x6a09e667),
    size,
    dispose() {
      this.a?.dispose?.();
      this.b?.dispose?.();
    },
  };
}

export function sampleWeatherCpu(texture, u, v) {
  const state = texture?.userData?.riftWeatherCpu;
  if (!state?.data || !state.size) return [0, 0.5, 0.5, 0];
  const size = state.size;
  const x = ((Math.floor(((u % 1) + 1) % 1 * size) % size) + size) % size;
  const y = ((Math.floor(((v % 1) + 1) % 1 * size) % size) + size) % size;
  const i = (x + y * size) * 4;
  return [
    state.data[i] / 255,
    state.data[i + 1] / 255,
    state.data[i + 2] / 255,
    state.data[i + 3] / 255,
  ];
}
