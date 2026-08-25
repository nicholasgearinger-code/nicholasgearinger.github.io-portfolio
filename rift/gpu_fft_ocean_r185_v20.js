import * as oceanV19 from "./gpu_fft_ocean_v19.js";

// Three.js r185 can submit an array of ComputeNodes in a single compute pass.
// Rift's FFT stack predates that API style and dispatches each butterfly kernel
// with an individual renderer.compute() call. On iOS/Safari r185 this can put
// heavy pressure on beginComputePass()/command submission during a frame. This
// compatibility layer detects the FFT computeFrame arrays already exposed on
// the ocean handles and batches each complete FFT sequence into one r185 compute
// group at the exact point its first kernel would have been submitted.

function collectComputeFrames(root) {
  const frames = [];
  const seen = new WeakSet();

  const visit = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 9 || seen.has(value)) return;
    seen.add(value);

    const frame = value.computeFrame;
    if (Array.isArray(frame) && frame.length > 1 && frame.every(Boolean)) {
      frames.push(frame);
    }

    // Avoid walking enormous/cyclic Three/TSL graphs. Simulation handles are
    // plain objects and expose their nested FFT/shallow/surf handles directly.
    if (
      value.isNode === true ||
      value.isObject3D === true ||
      value.isMaterial === true ||
      value.isBufferGeometry === true ||
      value.isBufferAttribute === true ||
      value.isTexture === true
    ) return;

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }

    for (const child of Object.values(value)) visit(child, depth + 1);
  };

  visit(root);
  return frames;
}

function runWithR185ComputeBatching(handle, renderer, callback) {
  if (!renderer || typeof renderer.compute !== "function") return callback();

  const frames = collectComputeFrames(handle);
  if (!frames.length) return callback();

  const frameByNode = new Map();
  for (const frame of frames) {
    for (const node of frame) frameByNode.set(node, frame);
  }

  const submitted = new WeakSet();
  const originalCompute = renderer.compute;
  let groupsSubmitted = 0;
  let legacyCallsSuppressed = 0;

  renderer.compute = function riftR185BatchedCompute(computeNodes, dispatchSize = null) {
    if (!Array.isArray(computeNodes)) {
      const frame = frameByNode.get(computeNodes);
      if (frame) {
        if (submitted.has(frame)) {
          legacyCallsSuppressed++;
          return;
        }

        submitted.add(frame);
        groupsSubmitted++;
        // Every ComputeNode already owns the count/workgroup setup created by
        // .compute(...). Passing the array is the r185-supported batching path.
        return originalCompute.call(this, frame);
      }
    }

    return originalCompute.call(this, computeNodes, dispatchSize);
  };

  try {
    return callback();
  } finally {
    renderer.compute = originalCompute;
    globalThis.__riftR185FFTComputeDebug = {
      enabled: true,
      threeRevision: globalThis.THREE?.REVISION ?? null,
      computeFramesFound: frames.length,
      groupsSubmitted,
      legacyCallsSuppressed,
      failed: false,
    };
  }
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = oceanV19.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
  if (handle?.gpuFFT) {
    handle.__riftR185ComputeBatching = true;
    handle.__riftR185ComputeFailureCount = 0;
    handle.__riftR185ComputeRetryAt = 0;
  }
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  if (!handle?.gpuFFT) return;

  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (handle.__riftR185ComputeRetryAt && now < handle.__riftR185ComputeRetryAt) return;

  try {
    const result = runWithR185ComputeBatching(
      handle,
      renderer,
      () => oceanV19.updateGPUFFTOcean(handle, renderer, elapsedTime),
    );
    handle.__riftR185ComputeFailureCount = 0;
    handle.__riftR185ComputeRetryAt = 0;
    return result;
  } catch (error) {
    // Do not take the entire game down because one native WebGPU compute pass
    // failed. Keep the most recent valid ocean buffers on screen, cool down, and
    // retry. This also leaves the cloud/atmosphere migration testable on-device.
    const failures = (Number(handle.__riftR185ComputeFailureCount) || 0) + 1;
    handle.__riftR185ComputeFailureCount = failures;
    handle.__riftR185ComputeRetryAt = now + Math.min(5000, 750 * failures);
    handle.fluidSimBroken = true;

    globalThis.__riftR185FFTComputeDebug = {
      ...(globalThis.__riftR185FFTComputeDebug || {}),
      enabled: true,
      failed: true,
      failureCount: failures,
      message: error?.message || String(error),
      retryAt: handle.__riftR185ComputeRetryAt,
    };

    console.error(
      `[gpu-fft-ocean:r185] batched compute failed (attempt ${failures}); keeping last valid ocean frame and retrying`,
      error,
    );
    return;
  }
}

export function updateGPUFFTOceanVisuals(...args) {
  return oceanV19.updateGPUFFTOceanVisuals(...args);
}

export function updateGPUFFTOceanRipples(...args) {
  return oceanV19.updateGPUFFTOceanRipples(...args);
}

export function disposeGPUFFTOcean(...args) {
  delete globalThis.__riftR185FFTComputeDebug;
  return oceanV19.disposeGPUFFTOcean(...args);
}
