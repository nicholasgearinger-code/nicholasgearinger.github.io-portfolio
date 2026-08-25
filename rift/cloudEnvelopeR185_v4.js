import * as THREE from "three";

// r185 mobile cumulus macro envelope v4.
//
// V1.6 proved the scalloped-shape idea works, but the field became too sparse:
// the player could drift through long mostly-clear regions after seeing clouds at
// startup. V4 keeps the same stable CPU-authored approach while distributing more
// medium cloud families across the tile, softening the subtractive carvers, and
// preserving scalloped edges. The result should stay scattered without vanishing.

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function smooth01(v) { const t = clamp01(v); return t * t * (3 - 2 * t); }

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function torusDelta(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
}

function hash2(x, y, seed) {
  let h = Math.imul((x + seed * 31) | 0, 374761393)
    ^ Math.imul((y + seed * 47) | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise(u, v, cells, seed) {
  const x = u * cells;
  const y = v * cells;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth01(x - xi);
  const fy = smooth01(y - yi);
  const wrap = (n) => ((n % cells) + cells) % cells;
  const a = hash2(wrap(xi), wrap(yi), seed);
  const b = hash2(wrap(xi + 1), wrap(yi), seed);
  const c = hash2(wrap(xi), wrap(yi + 1), seed);
  const d = hash2(wrap(xi + 1), wrap(yi + 1), seed);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, fx),
    THREE.MathUtils.lerp(c, d, fx),
    fy,
  );
}

function ellipseWeight(u, v, lobe) {
  const dx = torusDelta(u, lobe.x) / Math.max(1e-4, lobe.rx);
  const dy = torusDelta(v, lobe.y) / Math.max(1e-4, lobe.ry);
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r >= 1) return 0;
  const t = smooth01(1 - r);
  return t * t * (3 - 2 * t);
}

function makeFamilies(seed) {
  const rand = mulberry32(seed);
  const positive = [];
  const carvers = [];

  // More, slightly smaller families keep the sky populated everywhere while
  // still leaving clean blue gaps between systems.
  const familyCount = 30;
  for (let family = 0; family < familyCount; family++) {
    const cx = rand();
    const cy = rand();
    const radius = THREE.MathUtils.lerp(0.038, 0.078, Math.pow(rand(), 0.72));
    const towerBias = THREE.MathUtils.lerp(0.30, 0.90, Math.pow(rand(), 0.72));
    const lobeCount = 4 + Math.floor(rand() * 5);

    positive.push({
      x: cx,
      y: cy,
      rx: radius * THREE.MathUtils.lerp(1.00, 1.35, rand()),
      ry: radius * THREE.MathUtils.lerp(0.78, 1.10, rand()),
      strength: THREE.MathUtils.lerp(0.48, 0.66, rand()),
      tower: towerBias * 0.50,
      type: 0.32,
    });

    for (let i = 0; i < lobeCount; i++) {
      const angle = rand() * Math.PI * 2;
      const radial = radius * THREE.MathUtils.lerp(0.10, 0.82, Math.sqrt(rand()));
      const r = radius * THREE.MathUtils.lerp(0.24, 0.52, rand());
      positive.push({
        x: (cx + Math.cos(angle) * radial + 1) % 1,
        y: (cy + Math.sin(angle) * radial + 1) % 1,
        rx: r * THREE.MathUtils.lerp(0.80, 1.24, rand()),
        ry: r * THREE.MathUtils.lerp(0.76, 1.20, rand()),
        strength: THREE.MathUtils.lerp(0.66, 0.96, rand()),
        tower: clamp01(towerBias + THREE.MathUtils.lerp(-0.18, 0.20, rand())),
        type: THREE.MathUtils.lerp(0.42, 0.86, rand()),
      });
    }

    const carveCount = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < carveCount; i++) {
      const angle = rand() * Math.PI * 2;
      const radial = radius * THREE.MathUtils.lerp(0.72, 1.02, rand());
      const r = radius * THREE.MathUtils.lerp(0.16, 0.30, rand());
      carvers.push({
        x: (cx + Math.cos(angle) * radial + 1) % 1,
        y: (cy + Math.sin(angle) * radial + 1) % 1,
        rx: r * THREE.MathUtils.lerp(0.82, 1.20, rand()),
        ry: r * THREE.MathUtils.lerp(0.78, 1.16, rand()),
        strength: THREE.MathUtils.lerp(0.10, 0.22, rand()),
      });
    }
  }

  return { positive, carvers };
}

export function createR185PersistentEnvelopeTexture(size = 160, seed = 0x185c10d) {
  const data = new Uint8Array(size * size * 4);
  const { positive, carvers } = makeFamilies(seed);
  let p = 0;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let body = 0;
      let tower = 0;
      let type = 0;

      for (const lobe of positive) {
        const w = ellipseWeight(u, v, lobe) * lobe.strength;
        if (w <= 0) continue;
        body = 1 - (1 - body) * (1 - w * 0.86);
        tower = Math.max(tower, w * lobe.tower);
        type = Math.max(type, w * lobe.type);
      }

      let carve = 0;
      for (const lobe of carvers) {
        carve = Math.max(carve, ellipseWeight(u, v, lobe) * lobe.strength);
      }

      const broad = valueNoise(u, v, 6, seed + 91);
      const breakup = valueNoise(u + 0.137, v - 0.211, 14, seed + 173);
      const shoulder = valueNoise(u - 0.281, v + 0.163, 9, seed + 311);
      const edge = 1 - smooth01((body - 0.20) / 0.56);

      body = clamp01(
        body * (0.92 + broad * 0.14)
        - carve * (0.55 + edge * 0.24)
        - (1 - breakup) * edge * 0.055
      );
      tower = clamp01(tower * (0.86 + shoulder * 0.26));

      // Lower threshold than v3: sparse parts of the tile now retain small
      // cumulus instead of collapsing to completely clear sky.
      const formed = smooth01((body - 0.028) / 0.64);
      const minHeight = clamp01(0.012 + breakup * 0.009);
      const maxHeight = clamp01(
        0.14
        + formed * 0.24
        + Math.pow(tower, 0.72) * 0.52
        + shoulder * formed * 0.035
      );
      const cloudType = clamp01(0.22 + type * 0.62 + tower * 0.12);
      const density = clamp01(
        formed * (0.90 + broad * 0.10)
        + tower * formed * 0.08
        - carve * edge * 0.05
      );

      data[p++] = Math.round(minHeight * 255);
      data[p++] = Math.round(Math.max(minHeight + 0.12, maxHeight) * 255);
      data[p++] = Math.round(cloudType * 255);
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

export function createR185PersistentEnvelopePair(size = 160) {
  return {
    a: createR185PersistentEnvelopeTexture(size, 0x185c10d),
    b: createR185PersistentEnvelopeTexture(size, 0x6a09e667),
  };
}
