import * as base from "./volumetricClouds_r185_model37.js";

export * from "./volumetricClouds_r185_model37.js";

// -----------------------------------------------------------------------------
// SAFE LIGHTING PREVIEW
//
// This deliberately does NOT add a render pass, texture, sampler, node graph,
// compute dispatch, shader recompile hook, or new Three.js import. It only nudges
// scalar uniforms that Model 3.7 already owns and already updates every frame.
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

function normalizedDot(ax, ay, az, bx, by, bz) {
  const al = Math.hypot(ax, ay, az) || 1;
  const bl = Math.hypot(bx, by, bz) || 1;
  return (ax * bx + ay * by + az * bz) / (al * bl);
}

function applySafeRimPreview(handle, camera, sunDirection) {
  const u = handle?.uniforms;
  const e = camera?.matrixWorld?.elements;
  if (!u || !e || !sunDirection) return null;

  // Three.js cameras look down local -Z. Read the world-space forward vector
  // directly from matrixWorld so this preview needs no additional THREE import.
  const viewX = -e[8];
  const viewY = -e[9];
  const viewZ = -e[10];

  const sx = Number(sunDirection.x) || 0;
  const sy = Number(sunDirection.y) || 0;
  const sz = Number(sunDirection.z) || 0;
  const sunFacing = smoothRange(0.20, 0.93, normalizedDot(viewX, viewY, viewZ, sx, sy, sz));
  const sunAbove = smoothRange(-0.02, 0.10, sy);
  const lowSun = sunAbove * (1 - smoothRange(0.22, 0.62, sy));

  const sunOcc = clamp01(globalThis.__riftSunDiskOcclusion || 0);
  const partialOcc = 1 - Math.min(1, Math.abs(sunOcc - 0.5) / 0.5);
  const cloudT = clamp01(globalThis.__riftCloudShadowState?.averageTransmittance ?? 0.75);
  const brokenCloud = clamp01(1 - Math.abs(cloudT * 2 - 1));

  // Keep the first test deliberately conservative. Strongest effect requires:
  // 1) Sun above horizon, 2) camera looking toward it, and 3) broken/partial cloud.
  const rim = clamp01(
    sunAbove
      * sunFacing
      * (0.42 + partialOcc * 0.36 + brokenCloud * 0.22)
      * (0.82 + lowSun * 0.28),
  );

  // Only existing scalar uniforms are touched. Values are intentionally kept
  // close to Model 3.7's normal range to avoid destabilizing the WebGPU pipeline.
  if (u.m2SilverStrength) {
    const current = Number(u.m2SilverStrength.value) || 0.58;
    const target = Math.min(1.12, current * (1 + rim * 0.24));
    u.m2SilverStrength.value = lerp(current, target, 0.42);
  }

  if (u.m31CrownLightBoost) {
    const current = Number(u.m31CrownLightBoost.value) || 1.18;
    const target = Math.min(1.68, current * (1 + rim * 0.10));
    u.m31CrownLightBoost.value = lerp(current, target, 0.38);
  }

  if (u.m31SelfShadow) {
    const current = Number(u.m31SelfShadow.value) || 1.02;
    const target = Math.min(1.42, current + rim * 0.055 + lowSun * 0.025);
    u.m31SelfShadow.value = lerp(current, target, 0.32);
  }

  if (u.m31BaseDarkening) {
    const current = Number(u.m31BaseDarkening.value) || 0.58;
    const target = Math.min(0.86, current + rim * 0.035 + lowSun * 0.020);
    u.m31BaseDarkening.value = lerp(current, target, 0.30);
  }

  if (u.m2AmbientStrength) {
    const current = Number(u.m2AmbientStrength.value) || 0.56;
    const target = Math.max(0.36, current * (1 - rim * 0.045));
    u.m2AmbientStrength.value = lerp(current, target, 0.28);
  }

  const diagnostic = {
    version: "3.7-safe-rim-preview-1",
    enabled: true,
    rim,
    sunFacing,
    sunAbove,
    lowSun,
    sunOcclusion: sunOcc,
    partialOcclusion: partialOcc,
    cloudTransmittance: cloudT,
    silverStrength: Number(u.m2SilverStrength?.value) || 0,
    crownBoost: Number(u.m31CrownLightBoost?.value) || 0,
    selfShadow: Number(u.m31SelfShadow?.value) || 0,
    baseDarkening: Number(u.m31BaseDarkening?.value) || 0,
    ambientStrength: Number(u.m2AmbientStrength?.value) || 0,
  };
  globalThis.__riftCloudSafeLightingPreview = diagnostic;
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
  base.updateVolumetricClouds(
    handle,
    dt,
    camera,
    sunDirection,
    sunColor,
    ambientColor,
    lightningFlash,
    lightningColor,
    windX,
    windZ,
    rainIntensity,
    currentBiome,
  );

  if (!handle || !camera) return;
  applySafeRimPreview(handle, camera, sunDirection);
}

export function disposeVolumetricClouds(handle) {
  delete globalThis.__riftCloudSafeLightingPreview;
  return base.disposeVolumetricClouds(handle);
}
