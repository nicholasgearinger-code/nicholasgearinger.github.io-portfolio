import * as THREE from "three";
import * as oceanV12 from "./gpu_fft_ocean_v12.js";

// -----------------------------------------------------------------------------
// Water Pro v13 — encoder-safe mobile polish.
//
// This module deliberately does not create or replace any TSL nodes, storage
// buffers, compute passes, render targets, MRT attachments, or position nodes.
// It only adjusts uniforms/material properties that already exist in the proven
// v9/v12 graph, plus the already-existing swash wet-sand color uniform.
// -----------------------------------------------------------------------------

const HARDWARE_TOUCH_DEVICE = typeof window !== "undefined" && (
  "ontouchstart" in window ||
  (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
);

const NIGHT_SPARKLE = new THREE.Color(0xa9c9de);
const DAY_SPARKLE = new THREE.Color(0xfff8df);
const NIGHT_CREST = new THREE.Color(0x66a8ba);
const DAY_CREST = new THREE.Color(0xc9fff1);
const NIGHT_WET_SAND = new THREE.Color(0x574b41);
const DAY_WET_SAND = new THREE.Color(0xb99f7b);
const DAY_SHALLOW = new THREE.Color(0x79eadf);
const DAY_TRANSMISSION = new THREE.Color(0xd7f7ee);

function readWaterProfile() {
  const forced = typeof globalThis !== "undefined" ? globalThis.__riftWaterTestMode : null;
  if (forced === "mobile" || forced === "desktop") return forced;
  try {
    const stored = localStorage.getItem("riftWaterTestMode");
    if (stored === "mobile" || stored === "desktop") return stored;
  } catch (_) {
    // Private/embedded contexts can block storage; hardware detection remains.
  }
  return HARDWARE_TOUCH_DEVICE ? "mobile" : "desktop";
}

function tuneEncoderSafeWater(handle, storm = 0, day = 1) {
  if (!handle?.gpuFFT) return;

  const stormT = THREE.MathUtils.clamp(Number(storm) || 0, 0, 1);
  const dayT = THREE.MathUtils.clamp(Number(day) || 0, 0, 1);
  const mobile = readWaterProfile() === "mobile";

  if (handle.fftOpticalShallowTint?.value) {
    handle.fftOpticalShallowTint.value
      .set(0x356f79)
      .lerp(DAY_SHALLOW, dayT);
  }
  if (handle.fftOpticalTransmissionTint?.value) {
    handle.fftOpticalTransmissionTint.value
      .set(0x70979b)
      .lerp(DAY_TRANSMISSION, dayT);
  }
  if (handle.fftOpticalSparkleTint?.value) {
    handle.fftOpticalSparkleTint.value
      .copy(NIGHT_SPARKLE)
      .lerp(DAY_SPARKLE, dayT);
  }

  if (handle.fftV9ShallowColor?.value) handle.fftV9ShallowColor.value.set(0x72e7dc);
  if (handle.fftV9MidColor?.value) handle.fftV9MidColor.value.set(0x138aa3);
  if (handle.fftV9DeepColor?.value) handle.fftV9DeepColor.value.set(0x04324d);
  if (handle.fftV9SunColor?.value) {
    handle.fftV9SunColor.value.copy(NIGHT_SPARKLE).lerp(DAY_SPARKLE, dayT);
  }
  if (handle.fftV9CrestColor?.value) {
    handle.fftV9CrestColor.value.copy(NIGHT_CREST).lerp(DAY_CREST, dayT);
  }
  if (handle.fftFoamColor?.value) handle.fftFoamColor.value.set(0xfffdf6);

  if (handle.waveScale) {
    handle.waveScale.value = (mobile ? 26.4 : 27.0) + stormT * 6.7;
  }
  if (handle.fftDetailHandle?.waveScale) {
    handle.fftDetailHandle.waveScale.value = (mobile ? 27.1 : 28.0) + stormT * 7.8;
  }
  if (handle.fftFoamStrength) {
    handle.fftFoamStrength.value = 0.62 + stormT * 0.82;
  }

  const physical = handle.fftPhysicalMaterial;
  if (physical) {
    physical.ior = 1.333;
    physical.attenuationDistance = mobile ? 68 : 76;
    physical.attenuationColor.set(0x9bdcd3);
    physical.specularIntensity = mobile ? 0.90 : 0.94;
    physical.clearcoat = mobile ? 0.46 : 0.52;
    physical.clearcoatRoughness = 0.070 + stormT * 0.052;

    if (physical.envMapIntensity > 0) {
      physical.envMapIntensity = Math.max(
        mobile ? 1.20 : 1.30,
        physical.envMapIntensity,
      );
    }
  }

  const wetSand = handle.fftSurfSystem?.fluidSwash?.wetSandColor?.value;
  if (wetSand?.isColor) {
    wetSand.copy(NIGHT_WET_SAND).lerp(DAY_WET_SAND, dayT);
  }

  const surf = handle.fftSurfSystem;
  if (surf?.spray?.material) {
    surf.spray.material.opacity = Math.min(
      0.52,
      0.28 + dayT * 0.14 + stormT * 0.10,
    );
  }
  if (surf?.mist?.material) {
    surf.mist.material.opacity = Math.min(
      0.18,
      0.055 + dayT * 0.045 + stormT * 0.060,
    );
  }

  handle.__riftWaterProBackend = "v9-two-fft + v13-safe-polish";
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = oceanV12.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
  tuneEncoderSafeWater(handle, 0, 1);
  if (handle?.gpuFFT) {
    console.info("[rift-water] Water Pro v13: safe reflections + transmission + foam polish");
  }
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  return oceanV12.updateGPUFFTOcean(handle, renderer, elapsedTime);
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
  oceanV12.updateGPUFFTOceanVisuals(
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
  tuneEncoderSafeWater(handle, storm, day);
}

export function updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt = 1 / 60) {
  return oceanV12.updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt);
}

export function disposeGPUFFTOcean(scene, handle) {
  return oceanV12.disposeGPUFFTOcean(scene, handle);
}
