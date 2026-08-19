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
  badge.textContent = "GPU FFT OCEAN ACTIVE · 128²";
  badge.style.cssText = [
    "position:fixed",
    "top:12px",
    "right:12px",
    "z-index:100000",
    "padding:8px 11px",
    "border:1px solid rgba(112,255,235,.75)",
    "border-radius:7px",
    "background:rgba(2,18,28,.86)",
    "color:#8ffff0",
    "font:700 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace",
    "letter-spacing:.08em",
    "box-shadow:0 0 18px rgba(60,255,225,.24)",
    "pointer-events:none",
  ].join(";");
  document.body.appendChild(badge);
  return badge;
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle) return handle;

  // Make the spectral surface unmistakably different from the legacy
  // Gerstner ocean while keeping the underlying FFT implementation intact.
  // waveScale affects the evolved complex spectrum before the IFFT, so both
  // vertical height and horizontal displacement gain energy coherently.
  handle.waveScale.value = 1.85;
  handle.mesh.scale.y = 1.18;
  handle.mesh.material.roughness = 0.035;
  handle.mesh.material.opacity = 0.94;
  handle.fftVisualBoost = true;
  handle.fftBadge = ensureActiveBadge();

  console.info("[gpu-fft-ocean] ACTIVE: 128x128 spectral FFT ocean, visual boost v2");
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

  // The base implementation deliberately used a conservative calm scale of
  // 1.0. Raise the calm sea to 1.85 and let storms drive it toward 3.0 so
  // the FFT's broad spectrum, cross-wave interference, peaks, and troughs
  // are immediately visible instead of resembling the previous calm surface.
  const stormT = Math.max(0, Math.min(1, storm));
  handle.waveScale.value = 1.85 + stormT * 1.15;

  // A subtle independent vertical breathing term makes the resolved spectrum
  // easier to read at normal player eye height without changing FFT frequency
  // content or introducing another procedural wave model.
  handle.mesh.scale.y = 1.18 + Math.sin(elapsed * 0.22) * 0.035;

  if (!handle.fftBadge || !handle.fftBadge.isConnected) {
    handle.fftBadge = ensureActiveBadge();
  }
}

export function disposeGPUFFTOcean(scene, handle) {
  if (handle?.fftBadge?.isConnected) handle.fftBadge.remove();
  return disposeBaseOcean(scene, handle);
}
