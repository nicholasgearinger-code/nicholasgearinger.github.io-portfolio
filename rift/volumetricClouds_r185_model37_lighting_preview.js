import * as base from "./volumetricClouds_r185_model37.js";

export * from "./volumetricClouds_r185_model37.js";

// -----------------------------------------------------------------------------
// MODEL 3.7 LIGHTING COUPLING v4
//
// Still uses the proven Model 3.7 render graph. No new render pass, texture,
// sampler, TSL graph, compute dispatch, or render-time callback. This layer only:
//   1) probes the already-resident CPU atlas through the Sun column plus a tiny
//      four-ray neighborhood around it;
//   2) drives Model 3.7's existing scalar lighting controls;
//   3) boosts the existing density-weighted lightning emission scalar.
//
// The local neighborhood is important: clear Sun + clouds elsewhere must not
// create crepuscular rays. Rays/rims become eligible only when cloud is actually
// crossing the Sun and a nearby opening still lets direct light escape.
// -----------------------------------------------------------------------------

function clamp01(v) {
  v = Number(v) || 0;
  return Math.max(0, Math.min(1, v));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function smoothRange(a, b, x) {
  return smooth01((x - a) / Math.max(1e-6, b - a));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function fract(v) {
  return v - Math.floor(v);
}

function normalizedDot(ax, ay, az, bx, by, bz) {
  const al = Math.hypot(ax, ay, az) || 1;
  const bl = Math.hypot(bx, by, bz) || 1;
  return (ax * bx + ay * by + az * bz) / (al * bl);
}

function normalize3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

function sampleAtlasNearest(handle, u, v, w) {
  const atlas = handle?.__riftModel3Atlas;
  const image = atlas?.texture?.image;
  const data = image?.data;
  const width = Number(atlas?.width || image?.width) || 0;
  const height = Number(atlas?.height || image?.height) || 0;
  const depth = Number(atlas?.depth || image?.depth) || 0;
  if (!data || width < 1 || height < 1 || depth < 1) return 0;

  const x = Math.floor(fract(u) * width) % width;
  const y = Math.min(height - 1, Math.max(0, Math.floor(clamp01(v) * height)));
  const z = Math.floor(fract(w) * depth) % depth;
  const idx = (x + width * (y + height * z)) * 4;
  const weights = handle.uniforms?.m3ReferenceWeights?.value;
  const wr = Number(weights?.x) || 0;
  const wg = Number(weights?.y) || 0;
  const wb = Number(weights?.z) || 0;
  const wa = Number(weights?.w) || 0;

  return clamp01(
    (data[idx] / 255) * wr
      + (data[idx + 1] / 255) * wg
      + (data[idx + 2] / 255) * wb
      + (data[idx + 3] / 255) * wa,
  );
}

function macroDensityAt(handle, x, y, z) {
  const u = handle?.uniforms;
  if (!u?.m3ReferenceOffset?.value || !u?.m3ReferenceWorldScale) return 0;

  const baseY = Number(u.cloudBaseY?.value) || 50;
  const topY = Number(u.cloudTopY?.value) || 220;
  if (y <= baseY || y >= topY) return 0;

  const h = clamp01((y - baseY) / Math.max(1, topY - baseY));
  const scale = Number(u.m3ReferenceWorldScale.value) || (1 / 1080);
  const off = u.m3ReferenceOffset.value;
  const raw = sampleAtlasNearest(handle, x * scale + off.x, h, z * scale + off.y);
  const coverage = clamp01(u.coverage?.value ?? 0.5);
  const threshold = lerp(0.47, 0.12, coverage);
  return smoothRange(threshold, threshold + 0.205, raw);
}

function probeSunOcclusion(handle, camera, direction) {
  const u = handle?.uniforms;
  const origin = camera?.position;
  const dir = direction ? normalize3(
    Number(direction.x) || 0,
    Number(direction.y) || 0,
    Number(direction.z) || 0,
  ) : null;
  if (!u || !origin || !dir || dir.y <= 0.012) return 0;

  const baseY = Number(u.cloudBaseY?.value) || 50;
  const topY = Number(u.cloudTopY?.value) || 220;
  const t0 = (baseY - origin.y) / dir.y;
  const t1 = (topY - origin.y) / dir.y;
  const start = Math.max(0, Math.min(t0, t1));
  const end = Math.max(t0, t1);
  if (!(end > start)) return 0;

  // 13 scalar atlas reads per probe. Five probes below are still only 65
  // nearest-neighbor CPU reads per frame and never alter the WebGPU command graph.
  const samples = 13;
  let optical = 0;
  for (let i = 0; i < samples; i++) {
    const f = (i + 0.5) / samples;
    const t = lerp(start, end, f);
    optical += macroDensityAt(
      handle,
      origin.x + dir.x * t,
      origin.y + dir.y * t,
      origin.z + dir.z * t,
    );
  }

  optical /= samples;
  const density = Number(u.m2DensityScale?.value) || 1;
  return clamp01(1 - Math.exp(-optical * density * 8.6));
}

function probeSunNeighborhood(handle, camera, sunDirection) {
  const s = normalize3(
    Number(sunDirection?.x) || 0,
    Number(sunDirection?.y) || 0,
    Number(sunDirection?.z) || 0,
  );

  // Build a stable orthonormal basis around the solar ray without importing THREE.
  const refX = Math.abs(s.y) > 0.92 ? 1 : 0;
  const refY = Math.abs(s.y) > 0.92 ? 0 : 1;
  const refZ = 0;
  const right = normalize3(
    refY * s.z - refZ * s.y,
    refZ * s.x - refX * s.z,
    refX * s.y - refY * s.x,
  );
  const up = normalize3(
    s.y * right.z - s.z * right.y,
    s.z * right.x - s.x * right.z,
    s.x * right.y - s.y * right.x,
  );

  // Roughly a few degrees around the disc: enough to detect a cloud edge/gap,
  // but local enough that unrelated clouds elsewhere in the frame do not count.
  const cone = 0.050;
  const offsets = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const values = [];

  for (const [ox, oy] of offsets) {
    const d = normalize3(
      s.x + right.x * ox * cone + up.x * oy * cone,
      s.y + right.y * ox * cone + up.y * oy * cone,
      s.z + right.z * ox * cone + up.z * oy * cone,
    );
    values.push(probeSunOcclusion(handle, camera, d));
  }

  const center = values[0] || 0;
  const ring = values.slice(1);
  const ringAverage = ring.reduce((a, b) => a + b, 0) / Math.max(1, ring.length);
  const ringMin = Math.min(...ring);
  const ringMax = Math.max(...ring);
  const localMin = Math.min(center, ringMin);
  const localMax = Math.max(center, ringMax);

  return {
    center,
    ringAverage,
    ringMin,
    ringMax,
    edgeContrast: clamp01(localMax - localMin),
  };
}

function boostedLightningFlash(lightningFlash) {
  const input = clamp01(lightningFlash);
  if (input <= 0.0001) return 0;
  // The Model 3 shader already emits lightning from dense cloud voxels. Give the
  // return stroke a short HDR-capable punch while reusing that exact code path.
  return Math.min(2.20, Math.pow(input, 0.62) * 1.42 + input * 0.72);
}

function applyCoupledLighting(handle, camera, sunDirection, lightningIn, lightningOut) {
  const u = handle?.uniforms;
  const e = camera?.matrixWorld?.elements;
  if (!u || !e || !sunDirection) return null;

  // Three.js cameras look down local -Z.
  const viewX = -e[8];
  const viewY = -e[9];
  const viewZ = -e[10];

  const sx = Number(sunDirection.x) || 0;
  const sy = Number(sunDirection.y) || 0;
  const sz = Number(sunDirection.z) || 0;
  const sunFacing = smoothRange(0.12, 0.89, normalizedDot(viewX, viewY, viewZ, sx, sy, sz));
  const sunAbove = smoothRange(-0.02, 0.10, sy);
  const lowSun = sunAbove * (1 - smoothRange(0.20, 0.62, sy));

  const neighborhood = probeSunNeighborhood(handle, camera, sunDirection);
  const inheritedSunOcc = clamp01(globalThis.__riftSunDiskOcclusion || 0);

  // The dedicated center probe dominates. The inherited Model 3.7 signal is kept
  // as a conservative backup, but is not allowed to manufacture a local edge.
  const opticalSunOcc = Math.max(neighborhood.center, inheritedSunOcc * 0.72);
  const visualSunOcc = opticalSunOcc <= 0.0015
    ? 0
    : smoothRange(0.010, 0.46, opticalSunOcc);

  globalThis.__riftSunDiskOcclusion = visualSunOcc;
  globalThis.__riftLocalSunCloudOcclusion = visualSunOcc;
  if (globalThis.__riftCelestialOpticsV14) {
    globalThis.__riftCelestialOpticsV14.sunDiskOcclusion = visualSunOcc;
  }

  const cloudT = clamp01(globalThis.__riftCloudShadowState?.averageTransmittance ?? 0.75);
  const partialOcc = clamp01(4 * visualSunOcc * (1 - visualSunOcc));

  // Require the Sun itself to be entering cloud AND at least one adjacent solar
  // probe to remain more open. This is the actual cloud-boundary condition that
  // produces a silver lining / escaped crepuscular shaft.
  const centerBehind = smoothRange(0.055, 0.24, visualSunOcc);
  const adjacentCloud = smoothRange(0.05, 0.34, neighborhood.ringMax);
  const adjacentOpening = 1 - smoothRange(0.46, 0.90, neighborhood.ringMin);
  const edgeStructure = clamp01(
    adjacentCloud
      * adjacentOpening
      * (0.44 + neighborhood.edgeContrast * 0.82),
  );

  const rimWindow = clamp01(
    centerBehind
      * edgeStructure
      * (0.68 + partialOcc * 0.48),
  );
  const rim = clamp01(
    sunAbove
      * sunFacing
      * rimWindow
      * (1.10 + lowSun * 0.82),
  );

  // Model 3.7 already uses these as cloud-lighting terms. Stronger silver/crown
  // energy plus slightly darker body fill makes the backlit edge read locally
  // instead of turning the whole cloud into a white card.
  if (u.m2SilverStrength) {
    const current = Number(u.m2SilverStrength.value) || 0.58;
    const target = Math.min(2.20, current * (1 + rim * 1.05));
    u.m2SilverStrength.value = lerp(current, target, 0.66);
  }

  if (u.m31CrownLightBoost) {
    const current = Number(u.m31CrownLightBoost.value) || 1.18;
    const target = Math.min(2.38, current * (1 + rim * 0.34));
    u.m31CrownLightBoost.value = lerp(current, target, 0.58);
  }

  if (u.m31SelfShadow) {
    const current = Number(u.m31SelfShadow.value) || 1.02;
    const target = Math.min(1.72, current + rim * 0.19 + lowSun * 0.045);
    u.m31SelfShadow.value = lerp(current, target, 0.48);
  }

  if (u.m31BaseDarkening) {
    const current = Number(u.m31BaseDarkening.value) || 0.58;
    const target = Math.min(1.02, current + rim * 0.14 + lowSun * 0.035);
    u.m31BaseDarkening.value = lerp(current, target, 0.46);
  }

  if (u.m2AmbientStrength) {
    const current = Number(u.m2AmbientStrength.value) || 0.56;
    const lightningFill = clamp01((Number(lightningOut) || 0) / 2.0) * 0.16;
    const target = Math.max(
      0.27,
      current * (1 - rim * 0.17) + lightningFill,
    );
    u.m2AmbientStrength.value = lerp(current, target, lightningFill > 0 ? 0.72 : 0.44);
  }

  // main_game 4.6.4 consumes diagnostic.visualSunOcclusion. Feed it a synthetic
  // "ray gate occlusion": 1 means closed/no rays. Only a genuine local cloud edge
  // gets a partial value, so clear sky and solid overcast both force zero rays.
  const rayEligibility = clamp01(
    sunAbove
      * sunFacing
      * centerBehind
      * edgeStructure,
  );
  const rayGateSunOcclusion = rayEligibility > 0.045
    ? lerp(0.34, 0.50, clamp01(visualSunOcc * 1.15))
    : 1;

  const diagnostic = {
    version: "3.7-coupled-lighting-v4",
    enabled: true,
    production: true,
    rim,
    rimWindow,
    rayEligibility,
    sunFacing,
    sunAbove,
    lowSun,
    inheritedSunOcclusion: inheritedSunOcc,
    sampledSunOcclusion: neighborhood.center,
    opticalSunOcclusion: opticalSunOcc,
    actualVisualSunOcclusion: visualSunOcc,
    visualSunOcclusion: rayGateSunOcclusion,
    neighborhoodRingAverage: neighborhood.ringAverage,
    neighborhoodRingMin: neighborhood.ringMin,
    neighborhoodRingMax: neighborhood.ringMax,
    neighborhoodEdgeContrast: neighborhood.edgeContrast,
    cloudTransmittance: cloudT,
    partialOcclusion: partialOcc,
    lightningFlashIn: clamp01(lightningIn),
    lightningFlashOut: Number(lightningOut) || 0,
    silverStrength: Number(u.m2SilverStrength?.value) || 0,
    crownBoost: Number(u.m31CrownLightBoost?.value) || 0,
    selfShadow: Number(u.m31SelfShadow?.value) || 0,
    baseDarkening: Number(u.m31BaseDarkening?.value) || 0,
    ambientStrength: Number(u.m2AmbientStrength?.value) || 0,
  };

  globalThis.__riftCloudSafeLightingPreview = diagnostic;
  globalThis.__riftLightningSceneFlash = clamp01((Number(lightningOut) || 0) / 1.55);
  return diagnostic;
}

export function createVolumetricClouds(scene) {
  return base.createVolumetricClouds(scene);
}

export function updateVolumetricClouds(
  handle,
  dt,
  camera,
  sunDirection,
  sunColor,
  ambientColor,
  lightningFlash,
  lightningColor,
  windX = 0,
  windZ = 0,
  rainIntensity = 0,
  currentBiome = "default",
) {
  const cloudLightning = boostedLightningFlash(lightningFlash);

  base.updateVolumetricClouds(
    handle,
    dt,
    camera,
    sunDirection,
    sunColor,
    ambientColor,
    cloudLightning,
    lightningColor,
    windX,
    windZ,
    rainIntensity,
    currentBiome,
  );

  if (!handle || !camera) return;
  applyCoupledLighting(handle, camera, sunDirection, lightningFlash, cloudLightning);
}

export function disposeVolumetricClouds(handle) {
  delete globalThis.__riftCloudSafeLightingPreview;
  delete globalThis.__riftLocalSunCloudOcclusion;
  delete globalThis.__riftLightningSceneFlash;
  return base.disposeVolumetricClouds(handle);
}
