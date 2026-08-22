import * as THREE from "three";
import {
  Fn, float, uint, vec2, vec3,
  positionLocal, positionView,
  attribute, floor, min, mix, smoothstep,
  dFdx, dFdy, cross,
} from "three/tsl";
import * as oceanV9 from "./gpu_fft_ocean_v9.js";
import {
  createOceanFFTCascade,
  updateOceanFFTCascade,
  disposeOceanFFTCascade,
} from "./ocean_fft_cascade.js";

// -----------------------------------------------------------------------------
// Water Pro v10 — Mobile Pro+.
//
// Desktop continues to use v9's existing v8 three-cascade ocean unchanged.
// Mobile keeps v9's stable two-cascade base, then adds a much smaller 32x32
// micro FFT as a third displacement band. The mobile micro FFT is updated at an
// adaptive cadence, while SSR quality/resolution are exposed through globals so
// the runtime post stack can scale them without resizing the WebGPU canvas.
// -----------------------------------------------------------------------------

const HARDWARE_TOUCH_DEVICE = typeof window !== "undefined" && (
  "ontouchstart" in window ||
  (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
);

function readWaterProfile() {
  const forced = typeof globalThis !== "undefined" ? globalThis.__riftWaterTestMode : null;
  if (forced === "mobile" || forced === "desktop") return forced;
  try {
    const stored = localStorage.getItem("riftWaterTestMode");
    if (stored === "mobile" || stored === "desktop") return stored;
  } catch (_) {
    // Storage may be unavailable in private/embedded contexts.
  }
  return HARDWARE_TOUCH_DEVICE ? "mobile" : "desktop";
}

const WATER_PROFILE = readWaterProfile();
const MOBILE_PRO = WATER_PROFILE === "mobile";
const MOBILE_MICRO_N = 32;
const MOBILE_MICRO_DOMAIN = 52;

function positiveFract(value) {
  return ((value % 1) + 1) % 1;
}

function smoothWeight(t) {
  return t.mul(t).mul(float(3).sub(t.mul(2)));
}

function sampleWrapVec4(buffer, coord, N) {
  const row = uint(N);
  const x0Raw = floor(coord.x);
  const z0Raw = floor(coord.y);
  const x0 = x0Raw.toUint().mod(row);
  const z0 = z0Raw.toUint().mod(row);
  const x1 = x0.add(uint(1)).mod(row);
  const z1 = z0.add(uint(1)).mod(row);
  const tx = smoothWeight(coord.x.sub(x0Raw));
  const tz = smoothWeight(coord.y.sub(z0Raw));
  const i00 = z0.mul(row).add(x0);
  const i10 = z0.mul(row).add(x1);
  const i01 = z1.mul(row).add(x0);
  const i11 = z1.mul(row).add(x1);
  return mix(
    mix(buffer.element(i00), buffer.element(i10), tx),
    mix(buffer.element(i01), buffer.element(i11), tx),
    tz,
  );
}

function sampleWrapScalar(buffer, coord, N, component = "x") {
  const row = uint(N);
  const x0Raw = floor(coord.x);
  const z0Raw = floor(coord.y);
  const x0 = x0Raw.toUint().mod(row);
  const z0 = z0Raw.toUint().mod(row);
  const x1 = x0.add(uint(1)).mod(row);
  const z1 = z0.add(uint(1)).mod(row);
  const tx = smoothWeight(coord.x.sub(x0Raw));
  const tz = smoothWeight(coord.y.sub(z0Raw));
  const i00 = z0.mul(row).add(x0);
  const i10 = z0.mul(row).add(x1);
  const i01 = z1.mul(row).add(x0);
  const i11 = z1.mul(row).add(x1);
  return mix(
    mix(buffer.element(i00)[component], buffer.element(i10)[component], tx),
    mix(buffer.element(i01)[component], buffer.element(i11)[component], tx),
    tz,
  );
}

function sampleClampVec4(buffer, coord, N) {
  const x0 = floor(coord.x);
  const z0 = floor(coord.y);
  const x1 = min(x0.add(1), float(N - 1));
  const z1 = min(z0.add(1), float(N - 1));
  const tx = smoothWeight(coord.x.sub(x0));
  const tz = smoothWeight(coord.y.sub(z0));
  const row = uint(N);
  const i00 = z0.toUint().mul(row).add(x0.toUint());
  const i10 = z0.toUint().mul(row).add(x1.toUint());
  const i01 = z1.toUint().mul(row).add(x0.toUint());
  const i11 = z1.toUint().mul(row).add(x1.toUint());
  return mix(
    mix(buffer.element(i00), buffer.element(i10), tx),
    mix(buffer.element(i01), buffer.element(i11), tx),
    tz,
  );
}

function addMobileMicroCoordinates(handle) {
  const geometry = handle?.mesh?.geometry;
  const position = geometry?.getAttribute?.("position");
  if (!geometry || !position || geometry.getAttribute("fftCoordMobileMicro")) return;

  const coords = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    coords[i * 2] = positiveFract(position.getX(i) / MOBILE_MICRO_DOMAIN + 0.5) * MOBILE_MICRO_N;
    coords[i * 2 + 1] = positiveFract(position.getZ(i) / MOBILE_MICRO_DOMAIN + 0.5) * MOBILE_MICRO_N;
  }
  geometry.setAttribute("fftCoordMobileMicro", new THREE.Float32BufferAttribute(coords, 2));
}

function installMobileThreeScaleDisplacement(handle) {
  const micro = handle?.fftMobileMicroHandle;
  if (!MOBILE_PRO || !handle?.gpuFFT || !micro?.gpuFFTStandalone || handle.fftMobileThreeScaleInstalled) return;

  const material = handle.mesh?.material;
  const geometry = handle.mesh?.geometry;
  const shallow = handle.fftShallowHandle;
  const detail = handle.fftDetailHandle;
  if (!material || !geometry || !shallow?.gpuShallowWater || !detail?.gpuFFT) return;

  addMobileMicroCoordinates(handle);
  if (!geometry.getAttribute("fftCoordMobileMicro")) return;

  const longA = handle.resources?.[8];
  const longB = handle.resources?.[9];
  const detailA = detail.resources?.[8];
  const detailB = detail.resources?.[9];
  const microA = micro.spatialA;
  const microB = micro.spatialB;
  if (!longA || !longB || !detailA || !detailB || !microA || !microB) return;

  const longCoord = attribute("fftCoordLong", "vec2");
  const detailCoord = attribute("fftCoordDetail", "vec2");
  const microCoord = attribute("fftCoordMobileMicro", "vec2");
  const shallowCoord = attribute("shallowCoord", "vec2");
  const coverage = attribute("shallowCoverage", "float");
  const shore = attribute("fftShoreDense", "float");
  const depth = attribute("fftDepthWorld", "float");
  const shallowState = shallow.state;
  const shallowN = shallow.N ?? 256;

  material.positionNode = Fn(() => {
    const longSample = sampleWrapVec4(longA, longCoord, 128);
    const longDz = sampleWrapScalar(longB, longCoord, 128, "x");
    const detailSample = sampleWrapVec4(detailA, detailCoord, 128);
    const detailDz = sampleWrapScalar(detailB, detailCoord, 128, "x");
    const microSample = sampleWrapVec4(microA, microCoord, MOBILE_MICRO_N);
    const microDz = sampleWrapScalar(microB, microCoord, MOBILE_MICRO_N, "x");
    const shallowSample = sampleClampVec4(shallowState, shallowCoord, shallowN);

    const longAmp = smoothstep(float(2.4), float(11.0), depth);
    const detailAmp = smoothstep(float(5.0), float(15.0), depth);
    const microAmp = smoothstep(float(3.5), float(10.5), depth);
    const shallowBlend = float(1).sub(smoothstep(float(6.0), float(14.0), depth)).mul(coverage);

    const fftX = longSample.z.mul(longAmp).mul(0.40)
      .add(detailSample.z.mul(detailAmp).mul(0.15))
      .add(microSample.z.mul(microAmp).mul(0.032));
    const fftY = longSample.x.mul(longAmp).mul(1.02)
      .add(detailSample.x.mul(detailAmp).mul(0.47))
      .add(microSample.x.mul(microAmp).mul(0.115));
    const fftZ = longDz.mul(longAmp).mul(0.40)
      .add(detailDz.mul(detailAmp).mul(0.15))
      .add(microDz.mul(microAmp).mul(0.032));

    const horizontalFade = float(1).sub(shallowBlend.mul(0.985));
    const yDisp = mix(fftY, shallowSample.x, shallowBlend);
    return positionLocal.add(vec3(
      fftX.mul(shore).mul(horizontalFade),
      yDisp.mul(shore),
      fftZ.mul(shore).mul(horizontalFade),
    ));
  })();

  material.normalNode = Fn(() => cross(dFdx(positionView), dFdy(positionView)).normalize())();
  material.needsUpdate = true;
  handle.fftMobileThreeScaleInstalled = true;
}

function setMobileBudget(level) {
  if (typeof globalThis === "undefined") return;

  const presets = {
    emergency: { ssrScale: 0.26, ssrQuality: 0.12, ssrOpacity: 0.28, microStride: 6 },
    low:       { ssrScale: 0.31, ssrQuality: 0.15, ssrOpacity: 0.33, microStride: 5 },
    balanced:  { ssrScale: 0.37, ssrQuality: 0.19, ssrOpacity: 0.39, microStride: 4 },
    quality:   { ssrScale: 0.43, ssrQuality: 0.23, ssrOpacity: 0.45, microStride: 3 },
  };
  const preset = presets[level] ?? presets.balanced;
  globalThis.__riftMobileWaterBudget = level;
  globalThis.__riftMobileSSRResolutionScale = preset.ssrScale;
  globalThis.__riftMobileSSRQuality = preset.ssrQuality;
  globalThis.__riftMobileSSROpacity = preset.ssrOpacity;
  globalThis.__riftWaterMicroStride = preset.microStride;
}

function updateMobileAdaptiveBudget(handle, elapsedTime) {
  if (!MOBILE_PRO || !Number.isFinite(elapsedTime)) return;

  const previous = handle.__riftMobilePerfLastElapsed;
  handle.__riftMobilePerfLastElapsed = elapsedTime;
  if (!Number.isFinite(previous)) return;

  const dt = elapsedTime - previous;
  if (!(dt > 0) || dt > 0.25) return;

  const oldEma = handle.__riftMobilePerfEma ?? dt;
  const ema = oldEma * 0.92 + dt * 0.08;
  handle.__riftMobilePerfEma = ema;

  const now = performance.now();
  if (now - (handle.__riftMobilePerfLastTune ?? 0) < 1600) return;
  handle.__riftMobilePerfLastTune = now;

  const fps = 1 / Math.max(1 / 120, ema);
  const current = globalThis.__riftMobileWaterBudget ?? "balanced";
  let target = current;

  if (fps < 16) target = "emergency";
  else if (fps < 21) target = "low";
  else if (fps < 28) target = "balanced";
  else if (fps > 34) target = "quality";

  if (target !== current) {
    setMobileBudget(target);
    console.info(`[rift-water] Mobile Water Pro+ budget ${target} (${fps.toFixed(1)} fps)`);
  }
}

function installMobileMicroFFT(handle) {
  if (!MOBILE_PRO || !handle?.gpuFFT || handle.fftMobileMicroHandle) return;

  try {
    handle.fftMobileMicroHandle = createOceanFFTCascade({
      N: MOBILE_MICRO_N,
      domain: MOBILE_MICRO_DOMAIN,
      seed: 91337,
      windSpeed: 10.4,
      windDirection: [1.0, 0.29],
      amplitude: 0.000105,
      highFrequencyDamping: 0.00078,
      choppiness: 1.42,
      waveScale: 8.8,
    });
    installMobileThreeScaleDisplacement(handle);
    handle.__riftWaterProBackend = "v7-two-fft + mobile-32-micro";
  } catch (error) {
    handle.fftMobileMicroHandle = null;
    console.warn("[rift-water] Mobile micro FFT unavailable; retaining stable v9 two-FFT path", error);
  }
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = oceanV9.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
  if (!handle?.gpuFFT) return handle;

  if (MOBILE_PRO) {
    if (!globalThis.__riftMobileWaterBudget) setMobileBudget("balanced");
    installMobileMicroFFT(handle);
    console.info("[rift-water] Water Pro v10 Mobile Pro+: 2x128 FFT + 32 micro FFT + adaptive mobile SSR");
  } else {
    console.info("[rift-water] Water Pro v10 desktop: preserving v9 three-cascade desktop path");
  }
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  const result = oceanV9.updateGPUFFTOcean(handle, renderer, elapsedTime);

  if (MOBILE_PRO && handle?.fftMobileMicroHandle?.gpuFFTStandalone) {
    updateMobileAdaptiveBudget(handle, elapsedTime);
    handle.__riftMobileMicroFrame = (handle.__riftMobileMicroFrame ?? 0) + 1;

    const baseStride = Math.max(
      3,
      Number(globalThis.__riftWaterMicroStride ?? globalThis.__riftWaterDetailStride ?? 4) || 4,
    );
    const submerged = globalThis.__riftWaterSubmerged === true;
    const stride = submerged ? Math.max(5, baseStride + 1) : baseStride;

    if (handle.__riftMobileMicroFrame % stride === 0) {
      try {
        updateOceanFFTCascade(handle.fftMobileMicroHandle, renderer, elapsedTime);
      } catch (error) {
        console.warn("[rift-water] Mobile micro FFT update disabled after error", error);
        disposeOceanFFTCascade(handle.fftMobileMicroHandle);
        handle.fftMobileMicroHandle = null;
      }
    }
  }

  return result;
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
  oceanV9.updateGPUFFTOceanVisuals(
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

  if (MOBILE_PRO && handle?.fftMobileMicroHandle?.waveScale) {
    const stormT = THREE.MathUtils.clamp(Number(storm) || 0, 0, 1);
    handle.fftMobileMicroHandle.waveScale.value = 8.8 + stormT * 2.6;
  }
}

export function updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt = 1 / 60) {
  return oceanV9.updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt);
}

export function disposeGPUFFTOcean(scene, handle) {
  if (handle?.fftMobileMicroHandle) {
    try {
      disposeOceanFFTCascade(handle.fftMobileMicroHandle);
    } catch (_) {
      // Best effort during level teardown.
    }
    handle.fftMobileMicroHandle = null;
  }
  return oceanV9.disposeGPUFFTOcean(scene, handle);
}
