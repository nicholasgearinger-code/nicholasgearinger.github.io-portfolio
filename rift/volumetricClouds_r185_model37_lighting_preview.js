import * as base from "./volumetricClouds_r185_model37.js";

export * from "./volumetricClouds_r185_model37.js";

// -----------------------------------------------------------------------------
// SAFE LIGHTING PREVIEW v3
//
// No new render pass, texture, sampler, TSL node graph, compute dispatch,
// shader rebuild hook, or extra Three.js import. This preview only:
//   1) performs a tiny CPU-side probe through Model 3's already-resident atlas
//      along the camera -> Sun ray so visually dense cloud can truly hide the Sun;
//   2) nudges scalar lighting uniforms Model 3.7 already owns;
//   3) amplifies the EXISTING lightning emission scalar already consumed by the
//      stable Model 3.1 cloud shader.
//
// Enable only with: ?cloudLightingPreview=1
// Normal production remains exact Model 3.7 behavior.
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

function probeSunOcclusion(handle, camera, sunDirection) {
  const u = handle?.uniforms;
  const origin = camera?.position;
  if (!u || !origin || !sunDirection || Number(sunDirection.y) <= 0.012) return 0;

  const baseY = Number(u.cloudBaseY?.value) || 50;
  const topY = Number(u.cloudTopY?.value) || 220;
  const dy = Number(sunDirection.y) || 0;
  const t0 = (baseY - origin.y) / dy;
  const t1 = (topY - origin.y) / dy;
  const start = Math.max(0, Math.min(t0, t1));
  const end = Math.max(t0, t1);
  if (!(end > start)) return 0;

  // Still CPU-only. A slightly denser 17-point probe makes the local solar
  // column react to authored Model 3 macro volume more like the visible cloud.
  const samples = 17;
  let optical = 0;
  for (let i = 0; i < samples; i++) {
    const f = (i + 0.5) / samples;
    const t = lerp(start, end, f);
    optical += macroDensityAt(
      handle,
      origin.x + Number(sunDirection.x) * t,
      origin.y + dy * t,
      origin.z + Number(sunDirection.z) * t,
    );
  }

  optical /= samples;
  const density = Number(u.m2DensityScale?.value) || 1;
  return clamp01(1 - Math.exp(-optical * density * 8.0));
}

function boostedLightningFlash(lightningFlash) {
  const input = clamp01(lightningFlash);
  if (input <= 0.0001) return 0;
  // Model 3.1 already adds lightningColor * lightningFlash inside the cloud
  // volume. Let that existing HDR-capable scalar peak above one for a very brief
  // internal flash without changing the shader graph or adding another light.
  return Math.min(1.65, Math.pow(input, 0.70) * 1.12 + input * 0.53);
}

function applySafeRimPreview(handle, camera, sunDirection, lightningIn, lightningOut) {
  const u = handle?.uniforms;
  const e = camera?.matrixWorld?.elements;
  if (!u || !e || !sunDirection) return null;

  // Three.js cameras look down local -Z. Read world-space forward directly from
  // matrixWorld so the preview does not need another THREE import.
  const viewX = -e[8];
  const viewY = -e[9];
  const viewZ = -e[10];

  const sx = Number(sunDirection.x) || 0;
  const sy = Number(sunDirection.y) || 0;
  const sz = Number(sunDirection.z) || 0;
  const sunFacing = smoothRange(0.16, 0.91, normalizedDot(viewX, viewY, viewZ, sx, sy, sz));
  const sunAbove = smoothRange(-0.02, 0.10, sy);
  const lowSun = sunAbove * (1 - smoothRange(0.20, 0.62, sy));

  const baseSunOcc = clamp01(globalThis.__riftSunDiskOcclusion || 0);
  const sampledSunOcc = probeSunOcclusion(handle, camera, sunDirection);
  const opticalSunOcc = Math.max(baseSunOcc, sampledSunOcc);

  // Hard sunlight should react much more decisively than the soft cloud body.
  // Clear remains exactly zero; a real cloud column ramps quickly toward opaque.
  const visualSunOcc = opticalSunOcc <= 0.002
    ? 0
    : smoothRange(0.018, 0.56, opticalSunOcc);

  // Celestial v16 reads this on its next update. Keep the LOCAL Sun-column
  // signal separate from the global weather/cloud-cover signal — the player can
  // have broken clouds elsewhere while the Sun itself is perfectly clear.
  globalThis.__riftSunDiskOcclusion = visualSunOcc;
  globalThis.__riftLocalSunCloudOcclusion = visualSunOcc;
  if (globalThis.__riftCelestialOpticsV14) {
    globalThis.__riftCelestialOpticsV14.sunDiskOcclusion = visualSunOcc;
  }

  const cloudT = clamp01(globalThis.__riftCloudShadowState?.averageTransmittance ?? 0.75);
  const partialOcc = clamp01(4 * visualSunOcc * (1 - visualSunOcc));
  const brokenCloud = clamp01(4 * cloudT * (1 - cloudT));

  // Backlighting is LOCAL to the Sun/cloud overlap. Global broken cloud can
  // modulate a rim that already exists, but can never create one by itself.
  const localPresence = smoothRange(0.035, 0.20, visualSunOcc);
  const localEscape = 1 - smoothRange(0.76, 0.985, visualSunOcc);
  const rimWindow = clamp01(
    localPresence
      * localEscape
      * (0.50 + partialOcc * 0.70)
      * (0.88 + brokenCloud * 0.12),
  );
  const rim = clamp01(
    sunAbove
      * sunFacing
      * rimWindow
      * (1.05 + lowSun * 0.72),
  );

  // Existing scalar uniforms only. These ranges stay within the stable Model 3
  // lighting model but make the backlit edge/interior contrast plainly visible.
  if (u.m2SilverStrength) {
    const current = Number(u.m2SilverStrength.value) || 0.58;
    const target = Math.min(1.72, current * (1 + rim * 0.72));
    u.m2SilverStrength.value = lerp(current, target, 0.58);
  }

  if (u.m31CrownLightBoost) {
    const current = Number(u.m31CrownLightBoost.value) || 1.18;
    const target = Math.min(2.05, current * (1 + rim * 0.25));
    u.m31CrownLightBoost.value = lerp(current, target, 0.50);
  }

  if (u.m31SelfShadow) {
    const current = Number(u.m31SelfShadow.value) || 1.02;
    const target = Math.min(1.56, current + rim * 0.13 + lowSun * 0.045);
    u.m31SelfShadow.value = lerp(current, target, 0.42);
  }

  if (u.m31BaseDarkening) {
    const current = Number(u.m31BaseDarkening.value) || 0.58;
    const target = Math.min(0.94, current + rim * 0.09 + lowSun * 0.035);
    u.m31BaseDarkening.value = lerp(current, target, 0.40);
  }

  if (u.m2AmbientStrength) {
    const current = Number(u.m2AmbientStrength.value) || 0.56;
    const target = Math.max(0.30, current * (1 - rim * 0.13));
    u.m2AmbientStrength.value = lerp(current, target, 0.38);
  }

  // main_game 4.6.4 currently uses diagnostic.visualSunOcclusion for its cheap
  // scene-sprite ray gate. For completely clear Sun, feed that gate the fully
  // closed state so the global broken-cloud term cannot invent rays elsewhere.
  // The REAL solar occlusion remains visualSunOcc in the dedicated globals above.
  const rayGateSunOcclusion = visualSunOcc < 0.075 ? 1 : visualSunOcc;

  const diagnostic = {
    version: "3.7-safe-rim-preview-3",
    enabled: true,
    rim,
    rimWindow,
    sunFacing,
    sunAbove,
    lowSun,
    baseSunOcclusion: baseSunOcc,
    sampledSunOcclusion: sampledSunOcc,
    opticalSunOcclusion: opticalSunOcc,
    actualVisualSunOcclusion: visualSunOcc,
    visualSunOcclusion: rayGateSunOcclusion,
    cloudTransmittance: cloudT,
    partialOcclusion: partialOcc,
    brokenCloud,
    lightningFlashIn: clamp01(lightningIn),
    lightningFlashOut: Number(lightningOut) || 0,
    silverStrength: Number(u.m2SilverStrength?.value) || 0,
    crownBoost: Number(u.m31CrownLightBoost?.value) || 0,
    selfShadow: Number(u.m31SelfShadow?.value) || 0,
    baseDarkening: Number(u.m31BaseDarkening?.value) || 0,
    ambientStrength: Number(u.m2AmbientStrength?.value) || 0,
  };

  globalThis.__riftCloudSafeLightingPreview = diagnostic;
  globalThis.__riftLightningSceneFlash = clamp01((Number(lightningOut) || 0) / 1.35);
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
  applySafeRimPreview(handle, camera, sunDirection, lightningFlash, cloudLightning);
}

export function disposeVolumetricClouds(handle) {
  delete globalThis.__riftCloudSafeLightingPreview;
  delete globalThis.__riftLocalSunCloudOcclusion;
  delete globalThis.__riftLightningSceneFlash;
  return base.disposeVolumetricClouds(handle);
}
