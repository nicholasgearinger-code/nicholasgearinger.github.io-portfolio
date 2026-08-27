import * as oceanV21 from "./gpu_fft_ocean_r185_v21.js";
import * as oceanV19 from "./gpu_fft_ocean_v19.js";
import { disposeOceanFFTCascade } from "./ocean_fft_cascade.js";

// -----------------------------------------------------------------------------
// Water Pro r185 v22 — iOS/WebKit safe FFT submission.
//
// r185's array form renderer.compute([node0, node1, ...]) is useful on desktop,
// but on iOS/WebKit it can invalidate the native command encoder when a long FFT
// sequence with many storage-buffer bindings is submitted as one batch. Once the
// encoder is invalid, Safari/Chrome-on-iOS can surface GPUValidationError,
// RangeError (buffer offset/length out of bounds), then lose the GPU device.
//
// iOS therefore uses the proven sequential two-cascade FFT submission path from
// v19. The optional 32x32 mobile micro FFT is removed because the earlier v9
// mobile path already documented that an additional standalone FFT could
// invalidate Safari's WebGPU command encoder. Visual optics remain v21.
// Desktop/non-iOS keeps v21 unchanged.
// -----------------------------------------------------------------------------

const IOS_WEBKIT = typeof navigator !== "undefined" && (
  /iPad|iPhone|iPod/i.test(navigator.userAgent || "") ||
  ((navigator.platform || "") === "MacIntel" && (navigator.maxTouchPoints || 0) > 1)
);

const IOS_FFT_MIN_INTERVAL = 1 / 30;

function disableUnsafeMobileMicroFFT(handle) {
  const micro = handle?.fftMobileMicroHandle;
  if (!micro) return false;

  try {
    disposeOceanFFTCascade(micro);
  } catch (_) {
    // Disposal is best-effort; nulling the handle prevents future dispatches.
  }

  handle.fftMobileMicroHandle = null;
  handle.fftMobileThreeScaleInstalled = false;
  handle.__riftIOSMicroFFTDisabled = true;
  return true;
}

function installIOSSafeState(handle) {
  if (!IOS_WEBKIT || !handle?.gpuFFT || handle.__riftIOSFFTSafeV22) return;

  const removedMicroFFT = disableUnsafeMobileMicroFFT(handle);
  handle.__riftIOSFFTSafeV22 = true;
  handle.__riftIOSFFTLastTime = -Infinity;
  handle.__riftIOSFFTFailureCount = 0;
  handle.__riftIOSFFTDisabled = false;
  handle.__riftR185ComputeBatching = false;

  globalThis.__riftIOSFFTSafeV22 = {
    active: true,
    sequentialSubmission: true,
    targetHz: 30,
    removedMicroFFT,
    waterBackend: handle.__riftWaterProBackend ?? null,
  };

  console.info(
    `[gpu-fft-ocean:r185:v22] iOS safe FFT active: sequential two-cascade submission @ <=30 Hz${removedMicroFFT ? "; mobile micro FFT removed" : ""}`,
  );
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = oceanV21.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
  installIOSSafeState(handle);
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  if (!IOS_WEBKIT) {
    return oceanV21.updateGPUFFTOcean(handle, renderer, elapsedTime);
  }
  if (!handle?.gpuFFT || handle.__riftIOSFFTDisabled) return;

  installIOSSafeState(handle);

  const t = Number.isFinite(elapsedTime) ? elapsedTime : 0;
  const last = Number(handle.__riftIOSFFTLastTime);
  if (Number.isFinite(last) && t >= last && (t - last) < IOS_FFT_MIN_INTERVAL) return;
  handle.__riftIOSFFTLastTime = t;

  try {
    // IMPORTANT: call v19 directly so r185 v20's renderer.compute([...]) monkey
    // patch is bypassed on iOS. v19 ultimately submits each FFT kernel through
    // renderer.compute(node), which is the older stable mobile path.
    const result = oceanV19.updateGPUFFTOcean(handle, renderer, t);
    handle.__riftIOSFFTFailureCount = 0;
    return result;
  } catch (error) {
    const failures = (Number(handle.__riftIOSFFTFailureCount) || 0) + 1;
    handle.__riftIOSFFTFailureCount = failures;

    // An invalid WebGPU command encoder cannot be repaired by immediately
    // submitting more work. Stop ocean compute after the first native failure so
    // the rest of the scene can keep rendering instead of producing an endless
    // validation/device-loss loop. A reload recreates the renderer/device and
    // retries the now-safe sequential path from a clean state.
    handle.__riftIOSFFTDisabled = true;
    handle.fluidSimBroken = true;

    globalThis.__riftIOSFFTSafeV22 = {
      ...(globalThis.__riftIOSFFTSafeV22 || {}),
      active: true,
      failed: true,
      failureCount: failures,
      message: error?.message || String(error),
      computeDisabledForSession: true,
    };

    console.error(
      "[gpu-fft-ocean:r185:v22] iOS sequential FFT failed; ocean compute disabled for this session to protect the WebGPU device",
      error,
    );
    return;
  }
}

export function updateGPUFFTOceanVisuals(...args) {
  return oceanV21.updateGPUFFTOceanVisuals(...args);
}

export function updateGPUFFTOceanRipples(...args) {
  return oceanV21.updateGPUFFTOceanRipples(...args);
}

export function disposeGPUFFTOcean(...args) {
  delete globalThis.__riftIOSFFTSafeV22;
  return oceanV21.disposeGPUFFTOcean(...args);
}
