import * as base from "./volumetricClouds_r185_model44.js";
import { createReferenceCloudAtlas } from "./cloudReferenceVolumeAtlas_v3.js";

export * from "./volumetricClouds_r185_model44.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 4.4.1 — mobile WebGPU stability isolation.
//
// Model 4 reconstructs its reference volume asynchronously, then replaces the
// byte payload of a Data3DTexture that may already be bound by the active WebGPU
// render graph. Desktop keeps that path. Touch/mobile instead swaps to the stable
// pre-baked reference atlas *before the first cloud shader update*, so the active
// 3D texture is uploaded once and remains immutable for the lifetime of the
// renderer. Model 4.4 shape variation, lighting, Sun and god-ray behavior remain
// otherwise unchanged.
// -----------------------------------------------------------------------------

function isTouchMobile() {
  const touchPoints = typeof navigator !== "undefined"
    ? Number(navigator.maxTouchPoints) || 0
    : 0;
  const coarse = typeof matchMedia === "function"
    ? matchMedia("(pointer: coarse)").matches
    : false;
  return touchPoints > 0 || coarse;
}

function atlasSizeFor(handle) {
  const label = handle?.__riftModel2Quality?.label;
  if (label === "mobile-low") return { width: 64, height: 46, depth: 64 };
  if (label === "medium") return { width: 80, height: 54, depth: 80 };
  return { width: 96, height: 62, depth: 96 };
}

function installStableMobileAtlas(handle) {
  if (!handle || !isTouchMobile() || handle.__riftModel441MobileSafe) return;

  // Model 4.0 starts the async photo-analysis atlas during create(). Replace it
  // before the first update installs/compiles the cloud shader. Disposing the old
  // texture prevents it from remaining part of the active WebGPU resource graph;
  // its async analysis may finish later, but that orphan is no longer sampled.
  const asyncAtlas = handle.__riftModel4Atlas;
  asyncAtlas?.dispose?.();

  const stableAtlas = createReferenceCloudAtlas(atlasSizeFor(handle));
  stableAtlas.ready = true;
  stableAtlas.mobileSafe = true;
  stableAtlas.source = "prebaked-reference-atlas-v3";
  stableAtlas.calibration = null;

  handle.__riftModel4Atlas = stableAtlas;
  handle.__riftModel3Atlas = stableAtlas;
  handle.__riftModel441MobileSafe = true;

  globalThis.__riftModel441Stability = {
    active: true,
    version: "4.4.1-mobile-stable-volume",
    mode: "mobile-prebaked-no-live-3d-reupload",
    width: stableAtlas.width,
    height: stableAtlas.height,
    depth: stableAtlas.depth,
    bytes: stableAtlas.bytes,
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  installStableMobileAtlas(handle);
  if (handle) handle.__riftModel441 = true;
  return handle;
}

export function updateVolumetricClouds(...args) {
  const handle = args[0];
  installStableMobileAtlas(handle);
  return base.updateVolumetricClouds(...args);
}

export function disposeVolumetricClouds(handle) {
  if (handle) {
    handle.__riftModel441 = false;
    handle.__riftModel441MobileSafe = false;
  }
  delete globalThis.__riftModel441Stability;
  return base.disposeVolumetricClouds(handle);
}
