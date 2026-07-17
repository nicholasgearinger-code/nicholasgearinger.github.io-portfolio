import * as THREE from "three";

// -----------------------------------------------------------------------------
// SWAP POINT: this is the entire terrain-shaping algorithm for islands. It
// takes a smooth icosahedron and displaces each vertex with deterministic 3D
// noise so every client renders the exact same rugged shape for a given
// island — no extra network traffic needed, since the noise is a pure
// function of the island's own id/radius (already sent by the server).
//
// Swap buildIslandGeometry() for anything else (a heightmap, an actual
// digital-elevation dataset, wave-function-collapse chunks, hand sculpted
// meshes) as long as it keeps returning a THREE.BufferGeometry.
// -----------------------------------------------------------------------------

function hashStringToSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h >>> 0) / 4294967296; // 0..1
}

// Deterministic hash of a 3D lattice point + seed -> pseudo-random [0,1).
// Standard "sin/fract" shader hash. Not cryptographic — just needs to be
// cheap, deterministic, and look reasonably random for terrain purposes.
function hash3(x, y, z, seed) {
  const n = x * 127.1 + y * 311.7 + z * 74.7 + seed * 999.9;
  const s = Math.sin(n) * 43758.5453123;
  return s - Math.floor(s);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smooth(t) {
  return t * t * (3 - 2 * t); // smoothstep, avoids visible lattice creases
}

// Trilinear-interpolated 3D value noise, returns roughly [-1, 1].
function valueNoise3(x, y, z, seed) {
  const x0 = Math.floor(x), x1 = x0 + 1;
  const y0 = Math.floor(y), y1 = y0 + 1;
  const z0 = Math.floor(z), z1 = z0 + 1;
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const tz = smooth(z - z0);

  const c000 = hash3(x0, y0, z0, seed);
  const c100 = hash3(x1, y0, z0, seed);
  const c010 = hash3(x0, y1, z0, seed);
  const c110 = hash3(x1, y1, z0, seed);
  const c001 = hash3(x0, y0, z1, seed);
  const c101 = hash3(x1, y0, z1, seed);
  const c011 = hash3(x0, y1, z1, seed);
  const c111 = hash3(x1, y1, z1, seed);

  const x00 = lerp(c000, c100, tx);
  const x10 = lerp(c010, c110, tx);
  const x01 = lerp(c001, c101, tx);
  const x11 = lerp(c011, c111, tx);
  const y0i = lerp(x00, x10, ty);
  const y1i = lerp(x01, x11, ty);
  const value = lerp(y0i, y1i, tz); // 0..1

  return value * 2 - 1; // -1..1
}

// Fractal sum (fBm) — a few octaves of the noise above for more natural,
// less lattice-y bumps than a single frequency would give.
function fbm3(x, y, z, seed, octaves = 3) {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let max = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise3(x * frequency, y * frequency, z * frequency, seed + i * 17.13) * amplitude;
    max += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / max;
}

const NOISE_FREQUENCY = 1.6; // how many bumps wrap around the island
const ROUGHNESS = 0.32; // displacement as a fraction of radius

/**
 * Builds a rugged, deterministic island shape from an icosahedron base.
 * @param {{id:string, radius:number, height:number}} island
 * @returns {THREE.BufferGeometry} geometry with position + color attributes
 */
function buildIslandGeometry(island) {
  const geo = new THREE.IcosahedronGeometry(island.radius, 3);
  // Squash into a rough island silhouette before adding surface detail.
  geo.scale(1, island.height / island.radius / 1.6, 1);

  const seed = hashStringToSeed(island.id) * 1000;
  const posAttr = geo.attributes.position;
  const displaced = new Float32Array(posAttr.count * 3);
  const dir = new THREE.Vector3();

  for (let i = 0; i < posAttr.count; i++) {
    dir.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    const radial = dir.clone().normalize();

    const noise = fbm3(
      radial.x * NOISE_FREQUENCY,
      radial.y * NOISE_FREQUENCY,
      radial.z * NOISE_FREQUENCY,
      seed
    );
    const displacement = 1 + noise * ROUGHNESS;

    displaced[i * 3] = dir.x * displacement;
    displaced[i * 3 + 1] = dir.y * displacement;
    displaced[i * 3 + 2] = dir.z * displacement;
  }

  geo.setAttribute("position", new THREE.BufferAttribute(displaced, 3));
  geo.computeVertexNormals();

  applyHeightShading(geo, island.color);

  return geo;
}

function applyHeightShading(geo, colorHex) {
  const posAttr = geo.attributes.position;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const range = Math.max(maxY - minY, 1e-6);

  const base = new THREE.Color(colorHex).multiplyScalar(0.32);
  const highlight = new THREE.Color(colorHex).lerp(new THREE.Color(0xffffff), 0.35);

  const colors = new Float32Array(posAttr.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    const t = (posAttr.getY(i) - minY) / range;
    tmp.copy(base).lerp(highlight, t);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

export { buildIslandGeometry };
