import * as THREE from "three";
import * as oceanV13 from "./gpu_fft_ocean_v13.js";

// -----------------------------------------------------------------------------
// Water Pro v14 — encoder-safe tropical polish.
//
// Safety contract for iOS/WebGPU:
// - no new TSL nodes or positionNode changes
// - no new storage buffers or compute dispatches
// - no SSR/MRT render targets
// - no extra FFT cascade
//
// This pass only retunes uniforms/material values that already exist in the
// proven v9/v12/v13 graph and presentation meshes.
// -----------------------------------------------------------------------------

const HARDWARE_TOUCH_DEVICE = typeof window !== "undefined" && (
  "ontouchstart" in window ||
  (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
);

const NIGHT_SPARKLE = new THREE.Color(0xa8c8dc);
const DAY_SPARKLE = new THREE.Color(0xffffe8);
const NIGHT_CREST = new THREE.Color(0x619bad);
const DAY_CREST = new THREE.Color(0xd4fff4);
const NIGHT_WET_SAND = new THREE.Color(0x66594a);
const DAY_WET_SAND = new THREE.Color(0xc7ad86);
const DAY_SHALLOW = new THREE.Color(0x83efe4);
const DAY_TRANSMISSION = new THREE.Color(0xe3faf2);
const DAY_SURFACE = new THREE.Color(0x2a8798);
const DAY_BREAKER = new THREE.Color(0xd8fff6);
const DAY_FOAM = new THREE.Color(0xfffdf8);

function readWaterProfile() {
  const forced = typeof globalThis !== "undefined" ? globalThis.__riftWaterTestMode : null;
  if (forced === "mobile" || forced === "desktop") return forced;
  try {
    const stored = localStorage.getItem("riftWaterTestMode");
    if (stored === "mobile" || stored === "desktop") return stored;
  } catch (_) {
    // Storage can be unavailable; hardware detection remains the fallback.
  }
  return HARDWARE_TOUCH_DEVICE ? "mobile" : "desktop";
}

function tuneEncoderSafeWater(handle, storm = 0, day = 1) {
  if (!handle?.gpuFFT) return;

  const stormT = THREE.MathUtils.clamp(Number(storm) || 0, 0, 1);
  const dayT = THREE.MathUtils.clamp(Number(day) || 0, 0, 1);
  const mobile = readWaterProfile() === "mobile";

  // Clearer tropical shallow water and stronger existing transmission tint.
  if (handle.fftOpticalShallowTint?.value) {
    handle.fftOpticalShallowTint.value
      .set(0x315f69)
      .lerp(DAY_SHALLOW, dayT);
  }
  if (handle.fftOpticalTransmissionTint?.value) {
    handle.fftOpticalTransmissionTint.value
      .set(0x71989d)
      .lerp(DAY_TRANSMISSION, dayT);
  }
  if (handle.fftOpticalSparkleTint?.value) {
    handle.fftOpticalSparkleTint.value
      .copy(NIGHT_SPARKLE)
      .lerp(DAY_SPARKLE, dayT);
  }

  // v9 depth/glitter/crest uniforms — values only, graph remains unchanged.
  if (handle.fftV9ShallowColor?.value) handle.fftV9ShallowColor.value.set(0x7ce9df);
  if (handle.fftV9MidColor?.value) handle.fftV9MidColor.value.set(0x11869f);
  if (handle.fftV9DeepColor?.value) handle.fftV9DeepColor.value.set(0x032d48);
  if (handle.fftV9SunColor?.value) {
    handle.fftV9SunColor.value.copy(NIGHT_SPARKLE).lerp(DAY_SPARKLE, dayT);
  }
  if (handle.fftV9CrestColor?.value) {
    handle.fftV9CrestColor.value.copy(NIGHT_CREST).lerp(DAY_CREST, dayT);
  }

  // Existing v7 color/foam uniforms still feed the v9 base color path.
  if (handle.fftSurfaceColor?.value) {
    handle.fftSurfaceColor.value
      .set(0x092733)
      .lerp(DAY_SURFACE, dayT)
      .lerp(new THREE.Color(0x183f47), stormT * 0.50);
  }
  if (handle.fftCrestColor?.value) {
    handle.fftCrestColor.value
      .set(0x6b909c)
      .lerp(DAY_BREAKER, dayT);
  }
  if (handle.fftFoamColor?.value) {
    handle.fftFoamColor.value.set(DAY_FOAM);
  }
  if (handle.fftFoamStrength) {
    handle.fftFoamStrength.value = 0.70 + stormT * 0.92;
  }

  // Stronger separation between the two already-existing FFT bands. No new
  // spectrum, buffer or dispatch is introduced.
  if (handle.waveScale) {
    handle.waveScale.value = (mobile ? 27.2 : 28.0) + stormT * 6.9;
  }
  if (handle.fftDetailHandle?.waveScale) {
    handle.fftDetailHandle.waveScale.value = (mobile ? 29.1 : 30.0) + stormT * 8.4;
  }

  const physical = handle.fftPhysicalMaterial;
  if (physical) {
    physical.ior = 1.333;
    physical.attenuationDistance = mobile ? 76 : 86;
    physical.attenuationColor.set(0xa6e5dc);
    physical.specularIntensity = mobile ? 0.96 : 1.0;
    physical.clearcoat = mobile ? 0.54 : 0.60;
    physical.clearcoatRoughness = 0.058 + stormT * 0.055;

    // These properties already exist on the physical material. If the v9 node
    // graph overrides a channel, changing the property is harmless; if it does
    // not, this increases shallow clarity without creating a new pipeline.
    if (Number.isFinite(physical.transmission)) {
      physical.transmission = Math.max(physical.transmission, 0.74 - stormT * 0.08);
    }
    if (Number.isFinite(physical.thickness)) {
      physical.thickness = Math.min(physical.thickness || 0.20, 0.20);
    }

    if (physical.envMapIntensity > 0) {
      const targetEnv = (mobile ? 1.34 : 1.46) + dayT * 0.08 - stormT * 0.06;
      physical.envMapIntensity = Math.max(targetEnv, physical.envMapIntensity);
    }
  }

  // Keep wet sand in the same pale-tan family as the beach, but darker and more
  // reflective while wet. This reuses the existing swash mesh/material only.
  const swash = handle.fftSurfSystem?.fluidSwash;
  const wetSand = swash?.wetSandColor?.value;
  if (wetSand?.isColor) {
    wetSand.copy(NIGHT_WET_SAND).lerp(DAY_WET_SAND, dayT);
  }
  if (swash?.foamColor?.value) {
    swash.foamColor.value.set(DAY_FOAM);
  }
  if (swash?.material && "envMapIntensity" in swash.material) {
    swash.material.envMapIntensity = 0.42 + dayT * 0.22;
  }

  // Existing breaker presentation uniforms/materials only.
  const surf = handle.fftSurfSystem;
  if (surf?.waves?.foamColor?.value) surf.waves.foamColor.value.set(DAY_FOAM);
  if (surf?.waves?.crestColor?.value) {
    surf.waves.crestColor.value.copy(NIGHT_CREST).lerp(DAY_CREST, dayT);
  }
  if (surf?.spray?.material) {
    surf.spray.material.opacity = Math.min(0.56, 0.30 + dayT * 0.15 + stormT * 0.11);
    surf.spray.material.size = 0.28 + stormT * 0.11;
  }
  if (surf?.mist?.material) {
    surf.mist.material.opacity = Math.min(0.20, 0.060 + dayT * 0.050 + stormT * 0.070);
    surf.mist.material.size = 0.60 + stormT * 0.18;
  }

  handle.__riftWaterProBackend = "v9-two-fft + v14-safe-tropical-polish";
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = oceanV13.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
  tuneEncoderSafeWater(handle, 0, 1);
  if (handle?.gpuFFT) {
    console.info("[rift-water] Water Pro v14: stronger safe reflections + transmission + foam");
  }
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  return oceanV13.updateGPUFFTOcean(handle, renderer, elapsedTime);
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
  oceanV13.updateGPUFFTOceanVisuals(
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
  return oceanV13.updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt);
}

export function disposeGPUFFTOcean(scene, handle) {
  return oceanV13.disposeGPUFFTOcean(scene, handle);
}
