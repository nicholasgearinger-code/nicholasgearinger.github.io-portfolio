import * as base from "./dayNightCycle_celestial_physical_v14.js";

export * from "./dayNightCycle_celestial_physical_v14.js";

// Celestial v15 — iOS/WebGPU stability hotfix.
//
// v14 added a tiny hidden sprite whose onBeforeRender callback moved the flare
// sprites while WebGPU was already encoding the frame. That is unnecessary and
// is the only new render-pass-time mutation introduced by the celestial upgrade.
// On touch devices, remove that capture sprite entirely. This preserves v14's
// east->west Sun/Moon motion, phase-consistent lunar ephemeris, moon phases,
// atmospheric lighting and god-ray state while taking the risky flare hook out
// of the iOS render path. Desktop keeps the v14 flare path for comparison.

const isTouch = typeof window !== "undefined" && (
  "ontouchstart" in window ||
  (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
);

const diagnosedDevices = new WeakSet();

function attachRealDeviceDiagnostics() {
  const device = globalThis.__riftRuntimePreloader?.renderer?.backend?.device;
  if (!device || diagnosedDevices.has(device) || typeof device.addEventListener !== "function") return;
  diagnosedDevices.add(device);

  device.addEventListener("uncapturederror", (event) => {
    const error = event?.error;
    const message = error?.message || String(error || "Unknown WebGPU device error");
    const payload = {
      type: error?.constructor?.name || "GPUError",
      message,
      time: performance.now(),
    };
    if (!globalThis.__riftFirstGPUDeviceError) globalThis.__riftFirstGPUDeviceError = payload;
    globalThis.__riftLastGPUDeviceError = payload;
    console.error("[rift-v15] real GPUDevice uncaptured error:", error || event);
  });

  if (device.lost?.then) {
    device.lost.then((info) => {
      globalThis.__riftGPUDeviceLost = {
        reason: info?.reason || "unknown",
        message: info?.message || "",
        time: performance.now(),
      };
      console.error("[rift-v15] GPUDevice lost:", info);
    }).catch(() => {});
  }
}

function applyMobileStabilityGuard(cycle) {
  attachRealDeviceDiagnostics();
  if (!isTouch || !cycle || cycle.__riftCelestialV15Guarded) return cycle;

  const state = cycle.__riftLensOpticsV14;
  const capture = state?.capture;
  if (capture) {
    capture.onBeforeRender = null;
    if (capture.parent) capture.parent.remove(capture);
    capture.material?.dispose?.();
    state.capture = null;
  }

  // Keep the flare group allocated but fully dormant on mobile. This gives us
  // a clean A/B test while avoiding any render-time scene mutation on iOS.
  if (state?.elements) {
    for (const element of state.elements) {
      if (element?.sprite?.material) element.sprite.material.opacity = 0;
      if (element?.sprite) element.sprite.visible = false;
    }
  }
  if (state?.group) state.group.visible = false;
  if (state?.publicState) {
    state.publicState.flareStrength = 0;
    state.publicState.flareVisible = false;
    state.publicState.mobileGuard = true;
  }

  cycle.__riftCelestialV15Guarded = true;
  globalThis.__riftCelestialV15 = {
    active: true,
    touchGuard: true,
    reason: "disable render-time flare hook on iOS/WebGPU",
  };
  return cycle;
}

export function createDayNightCycle(...args) {
  const cycle = base.createDayNightCycle(...args);
  attachRealDeviceDiagnostics();
  return applyMobileStabilityGuard(cycle);
}

export function updateDayNightCycle(cycle, dt, ...rest) {
  attachRealDeviceDiagnostics();
  const result = base.updateDayNightCycle(cycle, dt, ...rest);
  applyMobileStabilityGuard(cycle);
  return result;
}
