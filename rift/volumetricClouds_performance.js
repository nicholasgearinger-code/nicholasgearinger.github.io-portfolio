import * as base from "./volumetricClouds_reference_v2.js";

export * from "./volumetricClouds_reference_v2.js";

// Environment Performance 1.1 cloud wrapper.
// Keep the full Model 3.7 cloud feature/shader path, but render its expensive
// volumetric buffer at a smaller internal scale on Low touch devices. The existing
// TAAU reconstruction remains responsible for presenting the full-screen result.
// No raymarch feature is disabled and no additional GPU pass is introduced.

const params = typeof location !== "undefined"
  ? new URLSearchParams(location.search)
  : null;
const PERF_ACTIVE = params?.has("perfPreview") === true
  && params?.has("perfLegacy") !== true;
const IS_TOUCH = typeof window !== "undefined"
  && ("ontouchstart" in window || (typeof navigator !== "undefined" && (navigator.maxTouchPoints || 0) > 0));
const MOBILE_LOW_SCALE = 0.24;

function applyMobileScale(handle) {
  if (!PERF_ACTIVE || !IS_TOUCH || !handle) return;
  const quality = handle.__riftModel2Quality;
  if (quality?.label !== "mobile-low") return;

  quality.renderScale = MOBILE_LOW_SCALE;

  const temporal = handle.__riftTemporalCloudState;
  temporal?.cloudPass?.setResolutionScale?.(MOBILE_LOW_SCALE);
  if (temporal) temporal.resolutionScale = MOBILE_LOW_SCALE;

  const taau = handle.__riftModel2TAAUState;
  if (taau) {
    taau.resolutionScale = MOBILE_LOW_SCALE;
    if (taau.node) {
      // Slightly more history is useful when the input is only 24% scale, while
      // keeping enough current-frame weight to avoid the old smeared-cloud look.
      taau.node.currentFrameWeight = 0.16;
      taau.node.depthThreshold = 0.0024;
      taau.node.edgeDepthDiff = 0.0050;
      taau.node.maxVelocityLength = 38;
    }
  }

  globalThis.__riftCloudPerformance = {
    version: "1.1-30fps-preview",
    enabled: true,
    renderScale: MOBILE_LOW_SCALE,
    previousModelScale: 0.33,
    pixelFractionVsPrevious: Number(((MOBILE_LOW_SCALE * MOBILE_LOW_SCALE) / (0.33 * 0.33)).toFixed(3)),
    model: "3.7-reference-volumes",
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  applyMobileScale(handle);
  return handle;
}

export function updateVolumetricClouds(...args) {
  const result = base.updateVolumetricClouds(...args);
  // Model 2.6 in the preserved chain restores its own 0.33 Low scale each update,
  // so re-assert the performance scale after the complete Model 3.7 update.
  applyMobileScale(args[0]);
  return result;
}

export function disposeVolumetricClouds(handle) {
  delete globalThis.__riftCloudPerformance;
  return base.disposeVolumetricClouds(handle);
}
