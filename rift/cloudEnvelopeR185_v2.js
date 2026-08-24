import * as THREE from "three";

// Clustered, seamless cumulus weather envelope for the r185 cloud path.
// The texture only controls macro placement / local cloud-top potential. The
// visible cauliflower silhouette is still produced by the 3D Perlin-Worley
// volume in volumetricClouds_r185_v2.js.

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

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
  const xf0 = x - xi;
  const yf0 = y - yi;
  const xf = smooth01(xf0);
  const yf = smooth01(yf0);
  const wrap = (n) => ((n % cells) + cells) % cells;
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

function makeLobes(seed) {
  const rand = mulberry32(seed);
  const lobes = [];
  const clusterCount = 15;

  for (let c = 0; c < clusterCount; c++) {
    const cx = rand();
    const cy = rand();
    const clusterRadius = THREE.MathUtils.lerp(0.065, 0.135, rand());
    const lobeCount = 3 + Math.floor(rand() * 5);
    const clusterTower = THREE.MathUtils.lerp(0.40, 0.92, Math.pow(rand(), 0.75));

    // Broad body lobe keeps each cloud family connected.
    lobes.push({
      x: cx,
      y: cy,
      rx: clusterRadius * THREE.MathUtils.lerp(1.05, 1.45, rand()),
      ry: clusterRadius * THREE.MathUtils.lerp(0.82, 1.18, rand()),
      strength: THREE.MathUtils.lerp(0.72, 0.94, rand()),
      tower: clusterTower * 0.72,
      type: THREE.MathUtils.lerp(0.30, 0.55, rand()),
    });

    for (let i = 0; i < lobeCount; i++) {
      const angle = rand() * Math.PI * 2;
      const radial = clusterRadius * THREE.MathUtils.lerp(0.10, 0.72, Math.sqrt(rand()));
      const radius = clusterRadius * THREE.MathUtils.lerp(0.30, 0.68, rand());
      lobes.push({
        x: (cx + Math.cos(angle) * radial + 1) % 1,
        y: (cy + Math.sin(angle) * radial + 1) % 1,
        rx: radius * THREE.MathUtils.lerp(0.78, 1.28, rand()),
        ry: radius * THREE.MathUtils.lerp(0.78, 1.28, rand()),
        strength: THREE.MathUtils.lerp(0.76, 1.0, rand()),
        tower: clamp01(clusterTower + THREE.MathUtils.lerp(-0.18, 0.18, rand())),
        type: THREE.MathUtils.lerp(0.42, 0.88, rand()),
      });
    }
  }

  return lobes;
}

export function createR185ClusteredEnvelopeTexture(size = 160, seed = 0x185c10d) {
  const data = new Uint8Array(size * size * 4);
  const lobes = makeLobes(seed);
  let p = 0;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let body = 0;
      let tower = 0;
      let cloudType = 0;

      for (const lobe of lobes) {
        const dx = torusDelta(u, lobe.x) / Math.max(1e-4, lobe.rx);
        const dy = torusDelta(v, lobe.y) / Math.max(1e-4, lobe.ry);
        const radial = Math.sqrt(dx * dx + dy * dy);
        if (radial >= 1) continue;

        // Quintic-ish smooth dome. Overlapping ellipses create broad cloud
        // families with many rounded shoulders instead of one giant extrusion.
        const w = smooth01(1 - radial);
        const dense = w * w * (3 - 2 * w) * lobe.strength;
        if (dense > body) body = dense;
        tower = Math.max(tower, dense * lobe.tower);
        cloudType = Math.max(cloudType, dense * lobe.type);
      }

      const broadNoise = valueNoise(u, v, 5, seed + 91);
      const breakupNoise = valueNoise(u, v, 11, seed + 173);
      const shoulderNoise = valueNoise(u + 0.173, v - 0.219, 7, seed + 311);

      body = clamp01(body * (0.86 + broadNoise * 0.18) - (1 - breakupNoise) * 0.035);
      tower = clamp01(tower * (0.86 + shoulderNoise * 0.24));

      // Nearly flat lifted condensation base. Fine bottom breakup is left to the
      // 3D density field, preventing the old stacked/shelf appearance.
      const minHeight = clamp01(0.014 + breakupNoise * 0.010);

      // Local top height collapses naturally at the edge of every macro lobe and
      // rises only around tower centers. This prevents column-shaped cloud walls.
      const maxHeight = clamp01(
        0.18
        + body * 0.30
        + Math.pow(tower, 0.72) * 0.48
        + shoulderNoise * body * 0.035
      );

      const type = clamp01(0.24 + cloudType * 0.64 + tower * 0.10);
      const density = clamp01(
        body * 0.91
        + tower * 0.10
        + (broadNoise - 0.5) * 0.055
      );

      data[p++] = Math.round(minHeight * 255);
      data[p++] = Math.round(Math.max(minHeight + 0.16, maxHeight) * 255);
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

export function createR185ClusteredEnvelopePair(size = 160) {
  return {
    a: createR185ClusteredEnvelopeTexture(size, 0x185c10d),
    b: createR185ClusteredEnvelopeTexture(size, 0x6a09e667),
  };
}
