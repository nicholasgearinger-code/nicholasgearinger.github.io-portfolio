import * as THREE from "three";
import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  updateGPUFFTOceanRipples as updateBaseRipples,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean_v6.js";

const DAY_BODY = new THREE.Color(0x287f8f);
const DAY_SHALLOW = new THREE.Color(0x72d9cf);
const DAY_CREST = new THREE.Color(0xe6f5ef);
const DAY_FOAM = new THREE.Color(0xfbfcf8);
const NIGHT_BODY = new THREE.Color(0x071a22);
const STORM_BODY = new THREE.Color(0x183b42);

function tuneCoastalOptics(handle, elapsed = 0, cameraY = Infinity, storm = 0, day = 1) {
  if (!handle?.gpuFFT) return;

  const t = Number.isFinite(elapsed) ? elapsed : 0;
  const stormT = THREE.MathUtils.clamp(storm, 0, 1);
  const dayT = THREE.MathUtils.clamp(day, 0, 1);
  const reduced = typeof window !== "undefined" && window.__riftReducedEffects === true;
  const underwater = Number.isFinite(cameraY) && cameraY < (handle.waterY ?? 0) - 0.08;

  // Preserve the physical FFT field, but make the two cascades read as swell +
  // short coastal chop. The modulation frequencies are deliberately unrelated,
  // avoiding an obvious repeating sea-state envelope.
  const swellBreath =
    Math.sin(t * 0.043 + 0.8) * 0.52 +
    Math.sin(t * 0.019 + 2.7) * 0.31;
  const chopBreath =
    Math.sin(t * 0.163 + 1.1) * 0.70 +
    Math.sin(t * 0.271 + 3.4) * 0.42 +
    Math.sin(t * 0.397 + 0.3) * 0.21;

  if (handle.waveScale) handle.waveScale.value = 24.2 + swellBreath + stormT * 5.7;
  if (handle.fftDetailHandle?.waveScale) {
    handle.fftDetailHandle.waveScale.value = 23.4 + chopBreath + stormT * 6.0;
  }
  if (handle.fftFoamStrength) handle.fftFoamStrength.value = 0.52 + stormT * 0.74;

  if (handle.fftSurfaceColor?.value) {
    handle.fftSurfaceColor.value.copy(NIGHT_BODY)
      .lerp(DAY_BODY, dayT)
      .lerp(STORM_BODY, stormT * 0.58);
  }
  if (handle.fftCrestColor?.value) {
    handle.fftCrestColor.value.set(0x738f98).lerp(DAY_CREST, dayT);
  }
  if (handle.fftFoamColor?.value) {
    handle.fftFoamColor.value.set(0x91a0a3).lerp(DAY_FOAM, dayT);
  }
  if (handle.fftOpticalShallowTint?.value) {
    handle.fftOpticalShallowTint.value.set(0x2c6068).lerp(DAY_SHALLOW, dayT);
  }
  if (handle.fftOpticalTransmissionTint?.value) {
    handle.fftOpticalTransmissionTint.value.set(0x5b7e83).lerp(new THREE.Color(0xc9f0e5), dayT);
  }
  if (handle.fftOpticalSparkleTint?.value) {
    handle.fftOpticalSparkleTint.value.set(0xaec7da).lerp(new THREE.Color(0xffe8bf), dayT);
  }

  const physical = handle.fftPhysicalMaterial;
  if (!physical) return;

  physical.ior = 1.333;
  physical.transparent = false;
  physical.opacity = 1;

  if (underwater) {
    physical.transmission = 0.96;
    physical.thickness = 0.055;
    physical.attenuationDistance = 105;
    physical.attenuationColor.set(0xc4e8e4);
    physical.specularIntensity = 0.84;
    physical.roughness = 0.024;
    physical.clearcoat = 0.06;
    physical.clearcoatRoughness = 0.075;
  } else {
    // Clear tropical shallows: slightly more transmission and a longer
    // attenuation distance let the pale seabed show through near shore while
    // deeper water still keeps the FFT body's saturated cyan-blue color.
    physical.transmission = reduced ? 0 : 0.70 - stormT * 0.11;
    physical.thickness = reduced ? 0.08 : 0.24;
    physical.attenuationDistance = 48;
    physical.attenuationColor.set(0x98d8d1);
    physical.specularIntensity = 0.96;
    physical.roughness = (reduced ? 0.058 : 0.032) + stormT * 0.030;
    physical.clearcoat = reduced ? 0.28 : 0.58;
    physical.clearcoatRoughness = (reduced ? 0.11 : 0.068) + stormT * 0.034;
  }
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle?.gpuFFT) return handle;
  tuneCoastalOptics(handle, 0, Infinity, 0, 1);
  console.info("[gpu-fft-ocean] ACTIVE v7: coastal spectral optics + surf v8 + swash v5");
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  return updateBaseOcean(handle, renderer, elapsedTime);
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
  updateBaseVisuals(
    handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon,
    reflectionTexture, reflectionMatrix, refractionTexture, resolution,
    storm, day,
  );
  tuneCoastalOptics(handle, elapsed, cameraY, storm, day);
}

export function updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt = 1 / 60) {
  return updateBaseRipples(handle, playerPos, cameraY, dt);
}

export function disposeGPUFFTOcean(scene, handle) {
  return disposeBaseOcean(scene, handle);
}
