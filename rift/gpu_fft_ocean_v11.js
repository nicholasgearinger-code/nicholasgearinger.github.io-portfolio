import * as THREE from "three";
import {
  Fn, float, uint, vec2, vec3,
  positionLocal, positionView,
  attribute, floor, min, mix, smoothstep,
  dFdx, dFdy, cross,
} from "three/tsl";
import * as oceanV9 from "./gpu_fft_ocean_v9.js";

// -----------------------------------------------------------------------------
// Water Pro v11 — mobile three-band geometry without extra compute.
//
// The standalone mobile micro FFT in v10 could invalidate Safari's WebGPU
// command encoder. v11 keeps the proven v9 compute graph untouched and derives
// a third, shorter-scale spatial band by re-sampling the existing 128x128 detail
// FFT at a rotated/tighter world scale. This adds wave layering without another
// storage buffer, compute pipeline, or dispatch.
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

const MOBILE_PROFILE = readWaterProfile() === "mobile";
const EXTRA_N = 128;
const EXTRA_DOMAIN = 46;
const EXTRA_ROTATION = 0.71;

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

function addExtraDetailCoordinates(handle) {
  const geometry = handle?.mesh?.geometry;
  const position = geometry?.getAttribute?.("position");
  if (!geometry || !position || geometry.getAttribute("fftCoordMobileExtra")) return;

  const c = Math.cos(EXTRA_ROTATION);
  const s = Math.sin(EXTRA_ROTATION);
  const coords = new Float32Array(position.count * 2);

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const rx = x * c - z * s;
    const rz = x * s + z * c;
    coords[i * 2] = positiveFract(rx / EXTRA_DOMAIN + 0.5) * EXTRA_N;
    coords[i * 2 + 1] = positiveFract(rz / EXTRA_DOMAIN + 0.5) * EXTRA_N;
  }

  geometry.setAttribute("fftCoordMobileExtra", new THREE.Float32BufferAttribute(coords, 2));
}

function installMobileThreeBandDisplacement(handle) {
  if (!MOBILE_PROFILE || !handle?.gpuFFT || handle.fftMobileThreeBandInstalled) return;

  const material = handle.mesh?.material;
  const geometry = handle.mesh?.geometry;
  const shallow = handle.fftShallowHandle;
  const detail = handle.fftDetailHandle;
  if (!material || !geometry || !shallow?.gpuShallowWater || !detail?.gpuFFT) return;

  addExtraDetailCoordinates(handle);
  if (!geometry.getAttribute("fftCoordMobileExtra")) return;

  const longA = handle.resources?.[8];
  const longB = handle.resources?.[9];
  const detailA = detail.resources?.[8];
  const detailB = detail.resources?.[9];
  if (!longA || !longB || !detailA || !detailB) return;

  const longCoord = attribute("fftCoordLong", "vec2");
  const detailCoord = attribute("fftCoordDetail", "vec2");
  const extraCoord = attribute("fftCoordMobileExtra", "vec2");
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
    const extraSample = sampleWrapVec4(detailA, extraCoord, EXTRA_N);
    const extraDz = sampleWrapScalar(detailB, extraCoord, EXTRA_N, "x");
    const shallowSample = sampleClampVec4(shallowState, shallowCoord, shallowN);

    const longAmp = smoothstep(float(2.4), float(11.0), depth);
    const detailAmp = smoothstep(float(5.0), float(15.0), depth);
    const extraAmp = smoothstep(float(3.2), float(10.0), depth);
    const shallowBlend = float(1).sub(smoothstep(float(6.0), float(14.0), depth)).mul(coverage);

    const fftX = longSample.z.mul(longAmp).mul(0.40)
      .add(detailSample.z.mul(detailAmp).mul(0.15))
      .add(extraSample.z.mul(extraAmp).mul(0.024));
    const fftY = longSample.x.mul(longAmp).mul(1.02)
      .add(detailSample.x.mul(detailAmp).mul(0.47))
      .add(extraSample.x.mul(extraAmp).mul(0.085));
    const fftZ = longDz.mul(longAmp).mul(0.40)
      .add(detailDz.mul(detailAmp).mul(0.15))
      .add(extraDz.mul(extraAmp).mul(0.024));

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
  handle.fftMobileThreeBandInstalled = true;
  handle.__riftWaterProBackend = "v7-two-fft + resampled third band";
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = oceanV9.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
  if (!handle?.gpuFFT) return handle;

  if (MOBILE_PROFILE) {
    installMobileThreeBandDisplacement(handle);
    console.info("[rift-water] Water Pro v11 mobile: stable 2x128 FFT compute + resampled third wave band + fixed mobile SSR");
  } else {
    console.info("[rift-water] Water Pro v11 desktop: preserving v9 desktop three-cascade path");
  }

  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  return oceanV9.updateGPUFFTOcean(handle, renderer, elapsedTime);
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
  return oceanV9.updateGPUFFTOceanVisuals(
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
}

export function updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt = 1 / 60) {
  return oceanV9.updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt);
}

export function disposeGPUFFTOcean(scene, handle) {
  return oceanV9.disposeGPUFFTOcean(scene, handle);
}
