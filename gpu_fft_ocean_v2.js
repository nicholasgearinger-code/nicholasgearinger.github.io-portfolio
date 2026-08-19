import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean.js";

const ACTIVE_BADGE_ID = "gpu-fft-ocean-active";

function ensureActiveBadge() {
  if (typeof document === "undefined") return null;
  let badge = document.getElementById(ACTIVE_BADGE_ID);
  if (badge) return badge;
  badge = document.createElement("div");
  badge.id = ACTIVE_BADGE_ID;
  badge.textContent = "GPU FFT OCEAN ACTIVE · MAGENTA TEST";
  badge.style.cssText = [
    "position:fixed",
    "top:12px",
    "right:12px",
    "z-index:100000",
    "padding:8px 11px",
    "border:1px solid rgba(255,80,255,.9)",
    "border-radius:7px",
    "background:rgba(35,0,35,.9)",
    "color:#ff9cff",
    "font:700 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace",
    "letter-spacing:.08em",
    "box-shadow:0 0 18px rgba(255,0,255,.35)",
    "pointer-events:none",
  ].join(";");
  document.body.appendChild(badge);
  return badge;
}

function forceMagenta(handle) {
  if (!handle?.gpuFFT) return;
  if (handle.deepTint?.value) handle.deepTint.value.set(0xff00ff);
  if (handle.shallowTint?.value) handle.shallowTint.value.set(0xff66ff);
  if (handle.mesh?.material) {
    handle.mesh.material.color?.set?.(0xff00ff);
    handle.mesh.material.roughness = 0.025;
    handle.mesh.material.opacity = 0.97;
  }
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle) return handle;

  handle.waveScale.value = 2.35;
  handle.mesh.scale.y = 1.3;
  handle.fftVisualBoost = true;
  handle.fftBadge = ensureActiveBadge();
  forceMagenta(handle);

  console.info("[gpu-fft-ocean] ACTIVE: MAGENTA FFT diagnostic mode");
  return handle;
}

export async function updateGPUFFTOcean(handle, renderer) {
  return updateBaseOcean(handle, renderer);
}

export function updateGPUFFTOceanVisuals(
  handle,
  elapsed,
  skyColor,
  cameraY,
  playerPos,
  sunDir,
  skyHorizon,
  reflectionTexture,
  reflectionMatrix,
  refractionTexture,
  resolution,
  storm = 0,
  day = 1,
) {
  if (!handle?.gpuFFT) return;

  updateBaseVisuals(
    handle,
    elapsed,
    skyColor,
    cameraY,
    playerPos,
    sunDir,
    skyHorizon,
    reflectionTexture,
    reflectionMatrix,
    refractionTexture,
    resolution,
    storm,
    day,
  );

  const stormT = Math.max(0, Math.min(1, storm));
  handle.waveScale.value = 2.35 + stormT * 1.4;
  handle.mesh.scale.y = 1.3 + Math.sin(elapsed * 0.22) * 0.05;
  forceMagenta(handle);

  if (!handle.fftBadge || !handle.fftBadge.isConnected) {
    handle.fftBadge = ensureActiveBadge();
  }
}

export function disposeGPUFFTOcean(scene, handle) {
  if (handle?.fftBadge?.isConnected) handle.fftBadge.remove();
  return disposeBaseOcean(scene, handle);
}
