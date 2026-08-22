import * as THREE from "three";

// WaveWorks-inspired Stage 1 persistent foam field.
// CPU-side only: no WebGPU compute, storage buffers, MRT, SSR, or node-graph changes.
// Foam is generated near the breaker zone, advected up/down the beach, diffused,
// and decayed over time before being uploaded as a tiny alpha texture.

const TOUCH_DEVICE = typeof window !== "undefined" && (
  "ontouchstart" in window ||
  (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
);

const RADIAL_CELLS = TOUCH_DEVICE ? 24 : 32;
const LAND_RADIAL = -3.6;
const SEA_RADIAL = 1.9;
const FIXED_DT = 1 / 30;
const MAX_STEPS = 3;

const DAY_FOAM = new THREE.Color(0xfffffb);
const NIGHT_FOAM = new THREE.Color(0xb8c4c7);

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function hash01(a, b, seed = 0) {
  const n = Math.sin(a * 12.9898 + b * 78.233 + seed * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

function groundY(sample, radial) {
  if (radial < 0) {
    return THREE.MathUtils.lerp(sample.shoreY, sample.landY, clamp01(-radial / 3.0));
  }
  return THREE.MathUtils.lerp(sample.shoreY, sample.seaY, clamp01(radial / 2.4));
}

function makeFieldGeometry(samples, waterY) {
  const along = samples.length;
  const radial = RADIAL_CELLS;
  const cols = radial + 1;
  const rows = along + 1;
  const positions = new Float32Array(rows * cols * 3);
  const uvs = new Float32Array(rows * cols * 2);
  const indices = new Uint32Array(along * radial * 6);

  for (let i = 0; i <= along; i++) {
    const s = samples[i % along];
    const u = i / along;
    for (let j = 0; j <= radial; j++) {
      const v = j / radial;
      const r = THREE.MathUtils.lerp(LAND_RADIAL, SEA_RADIAL, v);
      const x = s.x + s.outwardX * r;
      const z = s.z + s.outwardZ * r;
      const gy = groundY(s, r);
      const y = r < 0 ? gy + 0.030 : Math.max(gy + 0.025, waterY + 0.018);
      const idx = i * cols + j;
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = z;
      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;
    }
  }

  let q = 0;
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = (i + 1) * cols + j;
      const d = c + 1;
      indices[q++] = a; indices[q++] = c; indices[q++] = b;
      indices[q++] = b; indices[q++] = c; indices[q++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeTexture(width, height) {
  const data = new Uint8Array(width * height * 4);
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return { data, texture };
}

function hideLegacyFoam(surfHandle) {
  const old = surfHandle?.__riftShoreFoamLayers;
  if (!old?.layers?.length) return;
  for (const layer of old.layers) {
    if (layer.kind !== "wash" && layer.mesh) layer.mesh.visible = false;
  }
  if (old.__riftBubbleOverlay?.mesh) old.__riftBubbleOverlay.mesh.visible = false;
  const wash = old.layers.find((layer) => layer.kind === "wash");
  if (wash?.material) {
    wash.material.opacity = Math.min(wash.material.opacity ?? 0.16, 0.16);
  }
}

function sampleField(field, along, radial, x, y) {
  const n = along;
  const m = radial;
  let fx = x % n;
  if (fx < 0) fx += n;
  const fy = Math.max(0, Math.min(m - 1.001, y));
  const x0 = Math.floor(fx);
  const x1 = (x0 + 1) % n;
  const y0 = Math.floor(fy);
  const y1 = Math.min(m - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = field[x0 * m + y0];
  const b = field[x1 * m + y0];
  const c = field[x0 * m + y1];
  const d = field[x1 * m + y1];
  const ab = a + (b - a) * tx;
  const cd = c + (d - c) * tx;
  return ab + (cd - ab) * ty;
}

function pulse01(p, center, halfWidth) {
  let d = Math.abs((((p - center) % 1) + 1) % 1);
  d = Math.min(d, 1 - d);
  return 1 - smooth01(d / Math.max(halfWidth, 1e-4));
}

function swashVelocity(simTime, storm) {
  const period = Math.max(4.4, 5.7 - storm * 1.0);
  const p = ((simTime / period) % 1 + 1) % 1;
  if (p < 0.22) {
    return -2.15 * smooth01(p / 0.22) * (1 + storm * 0.18);
  }
  if (p < 0.34) {
    return -2.15 * (1 - smooth01((p - 0.22) / 0.12)) * (1 + storm * 0.18);
  }
  return 0.78 * smooth01((p - 0.34) / 0.66) * (1 + storm * 0.16);
}

function breakerPulse(simTime, storm) {
  const period = Math.max(4.4, 5.7 - storm * 1.0);
  const p = ((simTime / period) % 1 + 1) % 1;
  const primary = pulse01(p, 0.10, 0.105);
  const secondary = pulse01(p, 0.56, 0.075) * 0.24;
  return clamp01(primary + secondary);
}

function stepPersistentField(handle, dt, storm, oceanHandle) {
  const n = handle.along;
  const m = handle.radial;
  const src = handle.foam;
  const dst = handle.next;
  const simTime = handle.simTime;
  const crossVel = swashVelocity(simTime, storm);
  const cellsPerMeter = (m - 1) / (SEA_RADIAL - LAND_RADIAL);
  const radialShift = crossVel * dt * cellsPerMeter;
  const alongVel = Math.sin(simTime * 0.19) * 0.23 + Math.sin(simTime * 0.071 + 1.7) * 0.12;
  const alongShift = alongVel * dt;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const adv = sampleField(src, n, m, i - alongShift, j - radialShift);
      const l = src[((i - 1 + n) % n) * m + j];
      const r = src[((i + 1) % n) * m + j];
      const d = src[i * m + Math.max(0, j - 1)];
      const u = src[i * m + Math.min(m - 1, j + 1)];
      const avg = (l + r + d + u) * 0.25;
      const v = j / (m - 1);
      const landness = 1 - v;
      const breakup = handle.breakup[i * m + j];
      const decayRate = 0.115 + landness * 0.075 + (crossVel > 0 ? 0.020 : 0) + breakup * 0.018;
      const mixed = adv + (avg - adv) * (0.085 + storm * 0.025);
      dst[i * m + j] = Math.max(0, mixed * Math.exp(-decayRate * dt));
    }
  }

  const pulse = breakerPulse(simTime, storm);
  const baseWave = Number(oceanHandle?.waveScale?.value) || 24;
  const detailWave = Number(oceanHandle?.fftDetailHandle?.waveScale?.value) || 23;
  const amplitudeFactor = THREE.MathUtils.clamp((baseWave + detailWave) / 48, 0.72, 1.45);

  for (let i = 0; i < n; i++) {
    const sample = handle.samples[i];
    const phase = sample.phase || 0;
    const alongEnergy = 0.74
      + Math.sin(simTime * 0.43 + phase * 0.33) * 0.13
      + Math.sin(simTime * 0.91 + phase * 0.77 + 1.9) * 0.09;
    const slope = clamp01(Math.max(0, sample.landY - sample.shoreY) / 1.15);
    const depth = clamp01(Math.max(0, handle.waterY - sample.seaY) / 1.65);
    const localBreak = Math.pow(Math.max(0, Math.sin(simTime * 1.64 + phase * 0.61 + 0.5)), 8) * 0.22;
    const energy = clamp01((pulse * alongEnergy + localBreak) * (0.76 + slope * 0.18 + depth * 0.12) * amplitudeFactor * (1 + storm * 0.55));

    if (energy <= 0.002) continue;
    const centerR = 0.58 + Math.sin(phase * 0.41) * 0.10;
    const centerJ = THREE.MathUtils.clamp(
      Math.round((centerR - LAND_RADIAL) / (SEA_RADIAL - LAND_RADIAL) * (m - 1)),
      0,
      m - 1,
    );
    const radius = storm > 0.55 ? 3 : 2;
    for (let dj = -radius; dj <= radius; dj++) {
      const j = Math.max(0, Math.min(m - 1, centerJ + dj));
      const w = Math.exp(-(dj * dj) / (radius * radius * 0.85 + 0.01));
      const idx = i * m + j;
      dst[idx] = Math.min(1.25, dst[idx] + energy * w * dt * (2.6 + storm * 1.6));
    }
  }

  const tmp = handle.foam;
  handle.foam = handle.next;
  handle.next = tmp;
}

function writeTextures(handle, day, storm) {
  const n = handle.along;
  const m = handle.radial;
  const foam = handle.foam;
  const foamData = handle.foamTextureData;
  const edgeData = handle.edgeTextureData;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const idx = i * m + j;
      const f = foam[idx];
      const porous = 0.76 + handle.breakup[idx] * 0.24;
      let alpha = smooth01((f * porous - 0.035) / 0.52);
      alpha = Math.pow(alpha, 0.72);

      const landNeighbor = foam[i * m + Math.max(0, j - 1)];
      const gradient = Math.max(0, f - landNeighbor);
      let edge = smooth01((gradient - 0.012) / 0.20) * smooth01((f - 0.04) / 0.42);
      edge = Math.pow(edge, 0.65);

      const a = Math.round(clamp01(alpha) * 255);
      const e = Math.round(clamp01(edge) * 255);
      const o = (j * n + i) * 4;
      foamData[o] = a; foamData[o + 1] = a; foamData[o + 2] = a; foamData[o + 3] = 255;
      edgeData[o] = e; edgeData[o + 1] = e; edgeData[o + 2] = e; edgeData[o + 3] = 255;
    }
  }

  handle.foamTexture.needsUpdate = true;
  handle.edgeTexture.needsUpdate = true;

  const dayT = clamp01(day);
  const stormT = clamp01(storm);
  handle.foamMaterial.color.copy(NIGHT_FOAM).lerp(DAY_FOAM, dayT);
  handle.foamMaterial.opacity = Math.min(0.985, 0.84 + dayT * 0.11 + stormT * 0.025);
  handle.edgeMaterial.color.copy(NIGHT_FOAM).lerp(DAY_FOAM, dayT);
  handle.edgeMaterial.opacity = Math.min(1, 0.92 + dayT * 0.07 + stormT * 0.02);
}

export function installPersistentShoreFoam(surfHandle) {
  if (!surfHandle?.gpuSurfSystem || surfHandle.__riftPersistentFoamField) {
    return surfHandle?.__riftPersistentFoamField ?? null;
  }

  const old = surfHandle.__riftShoreFoamLayers;
  const samples = old?.samples;
  if (!Array.isArray(samples) || samples.length < 8) return null;

  hideLegacyFoam(surfHandle);

  const along = samples.length;
  const radial = RADIAL_CELLS;
  const foam = new Float32Array(along * radial);
  const next = new Float32Array(along * radial);
  const breakup = new Float32Array(along * radial);
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < radial; j++) {
      breakup[i * radial + j] = hash01(i * 0.73, j * 1.17, 9);
    }
  }

  const foamTex = makeTexture(along, radial);
  const edgeTex = makeTexture(along, radial);
  const geometry = makeFieldGeometry(samples, surfHandle.waterY);

  const foamMaterial = new THREE.MeshStandardMaterial({
    color: DAY_FOAM,
    transparent: true,
    opacity: 0.95,
    roughness: 0.96,
    metalness: 0,
    alphaMap: foamTex.texture,
    alphaTest: 0.055,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  foamMaterial.envMapIntensity = 0.015;
  foamMaterial.emissive = new THREE.Color(0xffffff);
  foamMaterial.emissiveIntensity = 0.025;

  const edgeMaterial = new THREE.MeshStandardMaterial({
    color: DAY_FOAM,
    transparent: true,
    opacity: 0.99,
    roughness: 0.99,
    metalness: 0,
    alphaMap: edgeTex.texture,
    alphaTest: 0.045,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  edgeMaterial.envMapIntensity = 0.005;
  edgeMaterial.emissive = new THREE.Color(0xffffff);
  edgeMaterial.emissiveIntensity = 0.055;

  const foamMesh = new THREE.Mesh(geometry, foamMaterial);
  foamMesh.name = "rift-persistent-shore-foam";
  foamMesh.frustumCulled = false;
  foamMesh.renderOrder = 13;

  const edgeMesh = new THREE.Mesh(geometry, edgeMaterial);
  edgeMesh.name = "rift-persistent-shore-foam-edge";
  edgeMesh.frustumCulled = false;
  edgeMesh.renderOrder = 14;
  edgeMesh.position.y = 0.012;

  old.group.add(foamMesh);
  old.group.add(edgeMesh);

  const handle = {
    samples,
    along,
    radial,
    waterY: surfHandle.waterY,
    foam,
    next,
    breakup,
    foamMesh,
    edgeMesh,
    geometry,
    foamMaterial,
    edgeMaterial,
    foamTexture: foamTex.texture,
    edgeTexture: edgeTex.texture,
    foamTextureData: foamTex.data,
    edgeTextureData: edgeTex.data,
    lastTime: null,
    accumulator: 0,
    simTime: 0,
  };

  surfHandle.__riftPersistentFoamField = handle;
  writeTextures(handle, 1, 0);
  return handle;
}

export function updatePersistentShoreFoam(surfHandle, elapsed = 0, cameraY = Infinity, storm = 0, day = 1, oceanHandle = null) {
  const handle = surfHandle?.__riftPersistentFoamField;
  if (!handle) return;

  hideLegacyFoam(surfHandle);

  const underwater = Number.isFinite(cameraY) && cameraY < handle.waterY - 0.10;
  handle.foamMesh.visible = !underwater;
  handle.edgeMesh.visible = !underwater;
  if (underwater) return;

  const t = Number.isFinite(elapsed) ? elapsed : 0;
  if (handle.lastTime == null) handle.lastTime = t;
  const frameDt = Math.max(0, Math.min(0.10, t - handle.lastTime));
  handle.lastTime = t;
  handle.accumulator += frameDt;

  let steps = 0;
  const stormT = clamp01(storm);
  while (handle.accumulator >= FIXED_DT && steps < MAX_STEPS) {
    handle.simTime += FIXED_DT;
    stepPersistentField(handle, FIXED_DT, stormT, oceanHandle);
    handle.accumulator -= FIXED_DT;
    steps++;
  }

  if (steps > 0) writeTextures(handle, day, stormT);
}

export function disposePersistentShoreFoam(surfHandle) {
  const handle = surfHandle?.__riftPersistentFoamField;
  if (!handle) return;
  try { handle.foamMesh?.parent?.remove?.(handle.foamMesh); } catch (_) {}
  try { handle.edgeMesh?.parent?.remove?.(handle.edgeMesh); } catch (_) {}
  try { handle.geometry?.dispose?.(); } catch (_) {}
  try { handle.foamTexture?.dispose?.(); } catch (_) {}
  try { handle.edgeTexture?.dispose?.(); } catch (_) {}
  try { handle.foamMaterial?.dispose?.(); } catch (_) {}
  try { handle.edgeMaterial?.dispose?.(); } catch (_) {}
  surfHandle.__riftPersistentFoamField = null;
}
