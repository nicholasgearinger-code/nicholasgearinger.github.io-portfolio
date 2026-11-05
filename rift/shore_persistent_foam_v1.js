import * as THREE from "three";
import { attribute, float, mix } from "three/tsl";

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
const SEA_RADIAL = 3.8; // Give animated surf a wider offshore approach.
const FIXED_DT = 1 / 30;
// Dynamic geometry and normal rebuilds are CPU-bound on older iPhones.
const BREAKER_GEOMETRY_HZ = TOUCH_DEVICE ? 12 : 30;
// Preserves the existing breaker shape/material when ?riftCrestReflect=off.
// On mobile the same sparse mesh is still updated only at 12 Hz.
const REFLECTIVE_CRESTS = typeof location === "undefined" ||
  new URLSearchParams(location.search).get("riftCrestReflect") !== "off";
const MAX_STEPS = 3;
const SHALLOW_START = 3.4;
const SHALLOW_PEAK = 0.35;

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
    // Avoid the opaque gray ribbon visible from low camera angles.
    wash.material.opacity = Math.min(wash.material.opacity ?? 0.16, 0.09);
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

function surfPhase(t, storm, offset = 0) {
  // Short, spilling shorebreak rather than long cinematic tube sets.
  return ((t / Math.max(3.7, 4.8 - storm * 0.7) + offset) % 1 + 1) % 1;
}
function surfSet(t) {
  return THREE.MathUtils.clamp(0.73 + 0.19 * Math.sin(t * 0.11) +
    0.11 * Math.sin(t * 0.047 + 1.9), 0.4, 1.03);
}
function shoal(sample, waterY) {
  const depth = Math.max(0, waterY - sample.seaY);
  const shallow = 1 - smooth01((depth - SHALLOW_PEAK) /
    (SHALLOW_START - SHALLOW_PEAK));
  const slope = clamp01(Math.max(0, sample.landY - sample.seaY) / 4);
  return 0.22 + shallow * 0.65 + slope * 0.13;
}
function swashVelocity(simTime, storm) {
  const p = surfPhase(simTime, storm);
  if (p < 0.22) {
    return -2.15 * smooth01(p / 0.22) * (1 + storm * 0.18);
  }
  if (p < 0.34) {
    return -2.15 * (1 - smooth01((p - 0.22) / 0.12)) * (1 + storm * 0.18);
  }
  return 0.78 * smooth01((p - 0.34) / 0.66) * (1 + storm * 0.16);
}

function breakerPulse(simTime, storm) {
  const p = surfPhase(simTime, storm);
  const primary = pulse01(p, 0.16, 0.14);
  const secondary = pulse01(p, 0.51, 0.13) * 0.64;
  const third = pulse01(p, 0.80, 0.085) * 0.28;
  return clamp01((primary + secondary + third) * surfSet(simTime));
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
      // Aerated foam drains relatively quickly on the upper sand; an older
      // low-decay field was building a solid opaque white shoreline carpet.
      const decayRate = 0.20 + landness * 0.17 +
        (crossVel > 0 ? 0.045 : 0) + breakup * 0.07;
      const mixed = adv + (avg - adv) * (0.045 + storm * 0.018);
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
    const localBreak = Math.pow(Math.max(0, Math.sin(simTime * 1.64 + phase * 0.61 + 0.5)), 6) * 0.28;
    const progress = surfPhase(simTime, storm, phase * 0.009);
    // Crest collapse continues generating whitewater after the initial pulse.
    const spill = smooth01((progress - 0.30) / 0.19) *
      (1 - smooth01((progress - 0.76) / 0.22));
    const fragmented = 0.70 + 0.17 * Math.sin(phase * 0.37 + simTime * 1.11) +
      0.13 * Math.sin(phase * 0.89 - simTime * 0.63);
    const energy = clamp01((pulse * alongEnergy * 0.78 +
      spill * fragmented * 0.88 + localBreak * 0.65) *
      (0.40 + shoal(sample, handle.waterY) * 0.85 + slope * 0.10 + depth * 0.05) *
      amplitudeFactor * (1 + storm * 0.42));

    if (energy <= 0.002) continue;
    const centerR = 3.1 - surfPhase(simTime, storm, phase * 0.009) * 4.35 + Math.sin(phase * 0.41 + simTime * 0.18) * 0.23;
    const centerJ = THREE.MathUtils.clamp(
      Math.round((centerR - LAND_RADIAL) / (SEA_RADIAL - LAND_RADIAL) * (m - 1)),
      0,
      m - 1,
    );
    const radius = storm > 0.55 ? 5 : 4;
    for (let dj = -radius; dj <= radius; dj++) {
      const j = Math.max(0, Math.min(m - 1, centerJ + dj));
      const w = Math.exp(-(dj * dj) / (radius * radius * 0.90 + 0.01));
      const idx = i * m + j;
      // Aerated body lingers shoreward; offshore leading edge stays narrow.
      const bodyBehind = dj < 0 ? 1.0 : 0.35;
      dst[idx] = Math.min(1.05, dst[idx] + energy * w * bodyBehind *
        dt * (3.5 + storm * 1.5));
    }
  }

  const tmp = handle.foam;
  handle.foam = handle.next;
  handle.next = tmp;
}


/**
 * Animate the EXISTING shoreline foam mesh into a low, forward-pitching
 * breaker ridge. This deliberately reuses both foam draw calls and their
 * shared geometry; no FFT/compute nodes, extra textures or render passes.
 * Geometry is updated at a capped rate on iOS to protect the GPU budget.
 */
function updateBreakerGeometry(handle) {
  const attribute = handle.geometry.getAttribute("position");
  const base = handle.basePositions;
  const positions = attribute.array;
  const columns = handle.radial + 1;
  const n = handle.along;
  const t = handle.simTime;
  const storm = handle.currentStorm || 0;
  for (let i = 0; i <= n; i++) {
    const sample = handle.samples[i % n];
    const phase = sample.phase || 0;
    const along = i / Math.max(1, n);
    const energyDepth = shoal(sample, handle.waterY);
    const modulation = Math.sin(t * 0.59 + phase * 0.33) * 0.19 +
      Math.sin(along * 31.4 - t * 0.37) * 0.12;
    const cycle = surfPhase(t, storm, phase * 0.009);
    for (let j = 0; j <= handle.radial; j++) {
      const radial = LAND_RADIAL + (SEA_RADIAL - LAND_RADIAL) * j / handle.radial;
      let lift = 0;
      let pitch = 0;
      for (let train = 0; train < 2; train++) {
        const progress = (cycle + train * 0.49) % 1;
        const front = 3.3 - progress * 4.2 + modulation;
        const d = (radial - front) / (0.48 + progress * 0.13);
        // Gentle shallow-water spill: low rising shoulder, short steep lip.
        // Break its continuity alongshore rather than raising a long ribbon.
        const shoulder = Math.exp(-Math.pow(Math.min(d, 0) * 1.15, 2) * 1.8);
        const lip = Math.exp(-Math.pow(Math.max(d, 0) * 2.5, 2) * 3.2);
        const profile = d < 0 ? shoulder * 0.58 : lip;
        const growth = Math.max(0, Math.sin(Math.PI * Math.min(1, progress * 1.16)));
        const collapse = 1 - smooth01((progress - 0.64) / 0.32);
        const alongBreak = 0.79 + 0.12 * Math.sin(along * 29.3 + t * 0.78) +
          0.09 * Math.sin(along * 63.1 - t * 0.51);
        const energy = growth * collapse * surfSet(t) *
          (0.35 + energyDepth * 0.65) * alongBreak *
          (train === 0 ? 1 : 0.52);
        lift += profile * energy * (0.53 + storm * 0.34);
        pitch += Math.exp(-d * d * 5) * energy *
          smooth01((progress - 0.28) / 0.43) * 0.11;
      }
      const vertex = (i * columns + j) * 3;
      positions[vertex] = base[vertex] - sample.outwardX * pitch;
      positions[vertex + 1] = base[vertex + 1] + lift;
      positions[vertex + 2] = base[vertex + 2] - sample.outwardZ * pitch;
    }
  }
  attribute.needsUpdate = true;
  // Both foam meshes are intentionally frustumCulled=false, so repeated
  // CPU bounding-sphere reconstruction buys nothing on the mobile path.
}


/**
 * Low-cost explicit curling breaker wall. The existing wash sheet remains
 * responsible for foam and wet sand; this mesh provides the missing visible
 * water face/lip. A single dynamic draw call, no GPU compute or offscreen pass.
 * A sparse alongshore grid avoids duplicating the heavy FFT mesh on iOS.
 */
function createCurlingFace(samples, waterY, parent, trainOffset = 0) {
  const along = Math.min(TOUCH_DEVICE ? 64 : 96, samples.length);
  const rows = TOUCH_DEVICE ? 7 : 10;
  const positions = new Float32Array((along + 1) * (rows + 1) * 3);
  const uvs = new Float32Array((along + 1) * (rows + 1) * 2);
  const colors = new Float32Array((along + 1) * (rows + 1) * 3);
  colors.fill(0.75);
  const indices = [];
  for (let i = 0; i <= along; i++) {
    for (let j = 0; j <= rows; j++) {
      const k = i * (rows + 1) + j;
      uvs[k * 2] = i / along;
      uvs[k * 2 + 1] = j / rows;
      if (i < along && j < rows) {
        const a = k, b = a + rows + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  // Per-vertex aeration: light foam is matte; the green/blue wave face is
  // glassy. Both responses share this existing dynamic wave mesh/draw call.
  const aeration = new Float32Array((along + 1) * (rows + 1));
  if (REFLECTIVE_CRESTS) {
    geometry.setAttribute("riftBreakerAeration",
      new THREE.BufferAttribute(aeration, 1));
  }
  geometry.setIndex(indices);
  // Physical translucency from ordinary alpha blending: no screen capture,
  // true volumetric refraction, or expensive transmission render path.
  const materialOptions = {
    color: 0xffffff,
    vertexColors: true,
    emissive: 0x062c32,
    emissiveIntensity: 0.055,
    transparent: true,
    opacity: TOUCH_DEVICE ? 0.66 : 0.77,
    roughness: REFLECTIVE_CRESTS ? 0.075 : 0.21,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  };
  const nodeSupported = REFLECTIVE_CRESTS &&
    typeof THREE.MeshStandardNodeMaterial === "function";
  const material = nodeSupported
    ? new THREE.MeshStandardNodeMaterial(materialOptions)
    : new THREE.MeshStandardMaterial(materialOptions);
  if (nodeSupported) {
    // r185 TSL AttributeNode interpolates this geometry float across each
    // face. A single material now changes roughness from smooth refracting
    // wave face to matte aerated foam at the rolling lip.
    material.roughnessNode = mix(float(0.070), float(0.90),
      attribute("riftBreakerAeration", "float"));
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = trainOffset ? "rift-animated-secondary-breaker" : "rift-animated-curling-breaker";
  mesh.renderOrder = 12;
  mesh.frustumCulled = false;
  parent.add(mesh);
  return { mesh, geometry, material, along, rows, samples, waterY,
    trainOffset, aeration };
}

function updateCurlingFace(face, t, storm, day, oceanHandle) {
  if (!face) return;
  const { along, rows, samples, geometry, waterY } = face;
  const pos = geometry.getAttribute("position");
  const array = pos.array;
  const colors = geometry.getAttribute("color");
  const rgb = colors.array;
  const aeration = geometry.getAttribute("riftBreakerAeration");
  const set = surfSet(t);
  // Use the same sun vector and tropical palette that drive the FFT water.
  // No texture captures, extra shader variants, or mobile transmission pass.
  const sun = oceanHandle?.fftLightDirection?.value;
  const sunY = sun ? clamp01(Math.max(0, sun.y)) : 0.7;
  const sunlight = clamp01(day) * (0.32 + 0.68 * sunY) * (1 - storm * 0.48);
  const shallow = oceanHandle?.fftV9ShallowColor?.value;
  const waterR = shallow?.isColor ? shallow.r : 0.22;
  const waterG = shallow?.isColor ? shallow.g : 0.69;
  const waterB = shallow?.isColor ? shallow.b : 0.68;
  let totalBreak = 0;
  for (let i = 0; i <= along; i++) {
    const index = Math.floor((i % along) * samples.length / along);
    const sample = samples[index];
    const localPhase = surfPhase(t, storm, (sample.phase || 0) * 0.009 + face.trainOffset);
    const shoaling = shoal(sample, waterY);
    const modulation = Math.sin(t * 0.59 + (sample.phase || 0) * 0.33) * 0.19 +
      Math.sin(i / along * 31.4 - t * 0.37) * 0.12;
    const front = 3.3 - localPhase * 4.2 + modulation;
    // Separate staggered set: secondary wave is lower and becomes foam later.
    const trainStrength = face.trainOffset ? 0.57 : 1.0;
    const growth = Math.max(0, Math.sin(Math.PI * Math.min(1, localPhase * 1.16)));
    const collapse = 1 - smooth01((localPhase - 0.64) / 0.32);
    const alongHeight = 0.82 +
      0.11 * Math.sin(i * 0.33 + t * 0.55) +
      0.07 * Math.sin(i * 0.87 - t * 0.32);
    const height = (0.49 + storm * 0.19) * trainStrength * set *
      (0.43 + shoaling * 0.66) * growth * collapse * alongHeight;
    const breaking = smooth01((localPhase - 0.28) / 0.16) *
      (1 - smooth01((localPhase - 0.79) / 0.19));
    totalBreak += breaking * height;
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      // A connected wave face bends inward at its top, then spills
      // shoreward as the lip pitches. It stays above the water plane.
      const curl = smooth01((v - 0.58) / 0.42) *
        smooth01((localPhase - 0.24) / 0.34);
      // A small falling lip rather than an exaggerated breaking tube.
      const radial = front + (1 - v) * 0.48 - curl * height *
        (REFLECTIVE_CRESTS ? 0.54 : 0.38);
      const k = (i * (rows + 1) + j) * 3;
      array[k] = sample.x + sample.outwardX * radial;
      array[k + 1] = waterY + 0.018 + height * v;
      array[k + 2] = sample.z + sample.outwardZ * radial;
      // Thin backlit crest -> turquoise; collapsing lip -> scattering foam.
      // The breakup field is already calculated for the persistent foam mesh.
      const lip = smooth01((v - 0.66) / 0.34);
      const foamIndex = (index % samples.length) * face.foamRadial +
        Math.max(0, Math.min(face.foamRadial - 1,
          Math.round((radial - LAND_RADIAL) /
            (SEA_RADIAL - LAND_RADIAL) * (face.foamRadial - 1))));
      const foam = clamp01(face.foamField?.[foamIndex] || 0);
      // Broken bands are fragmented alongshore rather than a uniform white
      // stripe. Vertex colors remain GPU-interpolated and require no texture.
      const fragments = clamp01(0.58 +
        0.20 * Math.sin(i * 0.73 + t * 1.5) +
        0.14 * Math.sin(i * 1.61 - t * 0.97) +
        0.08 * Math.sin(i * 2.47 + t * 0.63));
      // The crest spills downward over time: the upper lip whitens first,
      // then thin froth reaches the mid-face, leaving green water beneath.
      const spill = smooth01((localPhase - 0.32) / 0.15) *
        (1 - smooth01((localPhase - 0.81) / 0.16));
      const spillingEdge = smooth01((v - (0.84 - spill * 0.37)) / 0.17);
      const scatter = clamp01((breaking * lip *
        (REFLECTIVE_CRESTS ? 0.72 : 0.55) +
        foam * lip * 0.30 + spill * spillingEdge *
        (REFLECTIVE_CRESTS ? 1.05 : 0.86)) *
        (0.58 + fragments * 0.42));
      if (aeration) aeration.array[k / 3] = scatter;
      const transmission = sunlight * (0.22 + lip * 0.53) * (1 - scatter);
      const trough = 0.79 + 0.21 * smooth01(v * 1.4);
      const shade = (0.65 + sunlight * 0.30 + v * 0.12) * trough;
      const warmGlint = sunlight * Math.pow(Math.max(0, sunY), 2) *
        (0.03 + lip * 0.07) * (1 - scatter);
      rgb[k] = Math.min(1, waterR * shade + transmission * 0.13 +
        warmGlint * 0.95 + scatter * 0.91);
      rgb[k + 1] = Math.min(1, waterG * shade + transmission * 0.42 +
        warmGlint * 0.72 + scatter * 0.95);
      rgb[k + 2] = Math.min(1, waterB * shade + transmission * 0.34 +
        warmGlint * 0.47 + scatter * 0.96);
    }
  }
  pos.needsUpdate = true;
  colors.needsUpdate = true;
  if (aeration) aeration.needsUpdate = true;
  // The breaker curls and pitches EVERY update. On iPhone normals used to
  // be frozen after the first frame: even correct specular BRDFs then failed
  // to reflect the motion. Rebuild normals only at the existing 12 Hz
  // geometry update cadence (this sparse mesh is ~455 vertices on mobile).
  if (REFLECTIVE_CRESTS || !TOUCH_DEVICE || !face.normalsInitialized) {
    geometry.computeVertexNormals();
    face.normalsInitialized = true;
  }
  // This mesh is frustumCulled=false; skip unnecessary bounding recompute.
  const foamFactor = clamp01(totalBreak / Math.max(1, along));
  if (!face.material.isMeshStandardNodeMaterial) {
    face.material.roughness = REFLECTIVE_CRESTS
      ? THREE.MathUtils.lerp(0.09, 0.60, foamFactor)
      : THREE.MathUtils.lerp(0.21, 0.49, foamFactor);
  }
  face.material.opacity = (TOUCH_DEVICE ? 0.66 : 0.77) *
    (0.38 + 0.62 * clamp01(day));
}

function writeTextures(handle, day, storm) {
  const n = handle.along;
  const m = handle.radial;
  const foam = handle.foam;
  const foamData = handle.foamTextureData;
  const edgeData = handle.edgeTextureData;

  // Each wave deposits uneven sheets, bubbles and threadlike foam streaks.
  // Compute the tiny radial modulation once per update (24 cells on iPhone),
  // not a trigonometric function for every foam texel.
  const radialLace = handle.radialLace ||
    (handle.radialLace = new Float32Array(m));
  for (let j = 0; j < m; j++) {
    radialLace[j] = 0.86 + 0.14 *
      Math.sin(j * 0.91 - handle.simTime * 0.44);
  }

  for (let i = 0; i < n; i++) {
    const alongStreak = 0.89
      + 0.13 * Math.sin(i * 0.31 + handle.simTime * 0.67)
      + 0.10 * Math.sin(i * 0.79 - handle.simTime * 0.36);
    for (let j = 0; j < m; j++) {
      const idx = i * m + j;
      const f = foam[idx];
      const localBreakup = handle.breakup[idx];
      const laceMask = clamp01(alongStreak * radialLace[j] *
        (0.77 + localBreakup * 0.37));
      // Multi-scale perforations and a shoreline falloff keep whitewater
      // lacy even when the simulation deposits several waves in succession.
      const laceHoles = smooth01((laceMask - 0.51) / 0.42);
      const radialMeters = LAND_RADIAL +
        (SEA_RADIAL - LAND_RADIAL) * j / Math.max(1, m - 1);
      const beachFade = smooth01((radialMeters + 3.0) / 1.25);
      const porous = 0.64 + localBreakup * 0.36;
      let alpha = smooth01((f * porous - 0.037) / 0.47);
      alpha = Math.pow(alpha, 0.88) * laceHoles * beachFade;

      const landNeighbor = foam[i * m + Math.max(0, j - 1)];
      const gradient = Math.max(0, f - landNeighbor);
      let edge = smooth01((gradient - 0.006) / 0.105) *
        smooth01((f - 0.025) / 0.28);
      edge = Math.pow(edge, 0.65) *
        (0.31 + 0.69 * laceHoles) *
        (0.70 + localBreakup * 0.30) * beachFade;

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
  handle.foamMaterial.opacity = Math.min(1, 0.88 + dayT * 0.10 + stormT * 0.02);
  handle.edgeMaterial.color.copy(NIGHT_FOAM).lerp(DAY_FOAM, dayT);
  handle.edgeMaterial.opacity = Math.min(1, 0.94 + dayT * 0.06 + stormT * 0.02);
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
  const basePositions = geometry.getAttribute("position").array.slice();

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
  const curlingFace = createCurlingFace(samples, surfHandle.waterY, old.group);
  // One face on touch devices: the second transparent overdraw and per-frame
  // normal reconstruction was too expensive on mobile. Foam still carries
  // several independent breaker pulses; desktop retains the second face.
  const secondaryFace = TOUCH_DEVICE ? null :
    createCurlingFace(samples, surfHandle.waterY, old.group, 0.49);

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
    curlingFace,
    secondaryFace,
    geometry,
    basePositions,
    lastGeometryTime: -Infinity,
    currentStorm: 0,
    foamMaterial,
    edgeMaterial,
    foamTexture: foamTex.texture,
    edgeTexture: edgeTex.texture,
    foamTextureData: foamTex.data,
    edgeTextureData: edgeTex.data,
    lastTime: null,
    accumulator: 0,
    simTime: 0,
    breakerState: { phase: 0, set: 0.73, front: 3.3, pulse: 0, strength: 0 },
  };

  // Reuse the foam simulation buffer for whitewater development on the lip.
  for (const face of [curlingFace, secondaryFace]) {
    if (!face) continue;
    face.foamField = foam;
    face.foamRadial = radial;
  }
  surfHandle.__riftPersistentFoamField = handle;
  writeTextures(handle, 1, 0);
  return handle;
}

export function updatePersistentShoreFoam(surfHandle, elapsed = 0, cameraY = Infinity, storm = 0, day = 1, oceanHandle = null) {
  const handle = surfHandle?.__riftPersistentFoamField;
  if (!handle) return;

  hideLegacyFoam(surfHandle);

  const t = Number.isFinite(elapsed) ? elapsed : 0;
  // One authoritative surf clock for the foam, pitching geometry and the
  // FFT material uniforms. Keep advancing even while the camera is submerged.
  handle.simTime = t;
  const stormT = clamp01(storm);
  const phase = surfPhase(t, stormT);
  const set = surfSet(t);
  const pulse = breakerPulse(t, stormT);
  const state = handle.breakerState;
  state.phase = phase;
  state.set = set;
  state.front = 3.3 - phase * 4.2;
  state.pulse = pulse;
  state.strength = clamp01(set * (0.55 + pulse * 0.45) * (1 + stormT * 0.25));
  if (oceanHandle) oceanHandle.__riftBreakerState = state;

  const underwater = Number.isFinite(cameraY) && cameraY < handle.waterY - 0.10;
  handle.foamMesh.visible = !underwater;
  handle.edgeMesh.visible = !underwater;
  if (handle.curlingFace) handle.curlingFace.mesh.visible = !underwater;
  if (handle.secondaryFace) handle.secondaryFace.mesh.visible = !underwater;
  if (underwater) {
    // Avoid a huge catch-up after surfacing; still publish the active clock.
    handle.lastTime = t;
    handle.accumulator = 0;
    return;
  }

  if (handle.lastTime == null) handle.lastTime = t;
  const frameDt = Math.max(0, Math.min(0.10, t - handle.lastTime));
  handle.lastTime = t;
  handle.accumulator += frameDt;

  let steps = 0;
  while (handle.accumulator >= FIXED_DT && steps < MAX_STEPS) {
    stepPersistentField(handle, FIXED_DT, stormT, oceanHandle);
    handle.accumulator -= FIXED_DT;
    steps++;
  }

  handle.currentStorm = stormT;
  if (steps > 0) writeTextures(handle, day, stormT);
  if (steps > 0 && t - handle.lastGeometryTime >= 1 / BREAKER_GEOMETRY_HZ) {
    updateBreakerGeometry(handle);
    for (const face of [handle.curlingFace, handle.secondaryFace]) {
      if (!face) continue;
      face.foamField = handle.foam; // field ping-pongs each solver step
      updateCurlingFace(face, t, stormT, day, oceanHandle);
    }
    handle.lastGeometryTime = t;
  }
}

export function disposePersistentShoreFoam(surfHandle) {
  const handle = surfHandle?.__riftPersistentFoamField;
  if (!handle) return;
  try { handle.foamMesh?.parent?.remove?.(handle.foamMesh); } catch (_) {}
  try { handle.edgeMesh?.parent?.remove?.(handle.edgeMesh); } catch (_) {}
  try { handle.curlingFace?.mesh?.parent?.remove?.(handle.curlingFace.mesh); } catch (_) {}
  try { handle.curlingFace?.geometry?.dispose?.(); } catch (_) {}
  try { handle.curlingFace?.material?.dispose?.(); } catch (_) {}
  try { handle.secondaryFace?.mesh?.parent?.remove?.(handle.secondaryFace.mesh); } catch (_) {}
  try { handle.secondaryFace?.geometry?.dispose?.(); } catch (_) {}
  try { handle.secondaryFace?.material?.dispose?.(); } catch (_) {}
  try { handle.geometry?.dispose?.(); } catch (_) {}
  try { handle.foamTexture?.dispose?.(); } catch (_) {}
  try { handle.edgeTexture?.dispose?.(); } catch (_) {}
  try { handle.foamMaterial?.dispose?.(); } catch (_) {}
  try { handle.edgeMaterial?.dispose?.(); } catch (_) {}
  surfHandle.__riftPersistentFoamField = null;
}
