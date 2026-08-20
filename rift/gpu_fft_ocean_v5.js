import * as THREE from "three";
import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  updateGPUFFTOceanRipples as updateBaseRipples,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean_v4.js";
import {
  createGPUSurfSystem,
  updateGPUSurfSystem,
  disposeGPUSurfSystem,
} from "./gpu_surf_system_v4.js";

const DAY_SURFACE = new THREE.Color(0x245b63);
const NIGHT_SURFACE = new THREE.Color(0x071a22);
const STORM_SURFACE = new THREE.Color(0x183a40);
const DAY_CREST = new THREE.Color(0xc7dedc);
const NIGHT_CREST = new THREE.Color(0x708c95);
const DAY_FOAM = new THREE.Color(0xf7f9f4);
const NIGHT_FOAM = new THREE.Color(0x91a1a4);

function tuneReferenceOcean(handle, elapsed = 0, cameraY = Infinity, storm = 0, day = 1) {
  if (!handle?.gpuFFT) return;

  const stormT = THREE.MathUtils.clamp(storm, 0, 1);
  const dayT = THREE.MathUtils.clamp(day, 0, 1);
  const t = Number.isFinite(elapsed) ? elapsed : 0;

  const longSet =
    Math.sin(t * 0.061 + 0.4) * 0.72 +
    Math.sin(t * 0.027 + 2.1) * 0.42;
  const detailSet =
    Math.sin(t * 0.181 + 1.3) * 0.76 +
    Math.sin(t * 0.307 + 0.6) * 0.46;

  // Slightly fuller offshore sea so the larger shore breakers grow out of an
  // already moving ocean, while staying well below the old unstable amplitudes.
  if (handle.waveScale) {
    handle.waveScale.value = 25.0 + longSet + stormT * 6.0;
  }
  if (handle.fftDetailHandle?.waveScale) {
    handle.fftDetailHandle.waveScale.value = 21.5 + detailSet + stormT * 6.4;
  }
  if (handle.mesh) {
    handle.mesh.scale.y = 1.01 + stormT * 0.05;
  }
  if (handle.fftFoamStrength) {
    handle.fftFoamStrength.value = 0.68 + stormT * 0.78;
  }

  if (handle.fftSurfaceColor?.value) {
    handle.fftSurfaceColor.value.copy(NIGHT_SURFACE)
      .lerp(DAY_SURFACE, dayT)
      .lerp(STORM_SURFACE, stormT * 0.55);
  }
  if (handle.fftCrestColor?.value) {
    handle.fftCrestColor.value.copy(NIGHT_CREST).lerp(DAY_CREST, dayT);
  }
  if (handle.fftFoamColor?.value) {
    handle.fftFoamColor.value.copy(NIGHT_FOAM).lerp(DAY_FOAM, dayT);
  }

  const physical = handle.fftPhysicalMaterial;
  const underwater = Number.isFinite(cameraY) && cameraY < (handle.waterY ?? 0) - 0.08;
  if (physical && !underwater) {
    physical.transmission = 0.66 - stormT * 0.08;
    physical.thickness = 0.30;
    physical.attenuationDistance = 28.0;
    physical.attenuationColor.set(0x72aeb2);
    physical.specularIntensity = 1.0;
    physical.roughness = 0.045 + stormT * 0.022;
    physical.clearcoat = 0.46;
    physical.clearcoatRoughness = 0.082 + stormT * 0.022;
  }
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle?.gpuFFT) return handle;

  handle.fftSurfSystem = createGPUSurfSystem(
    scene,
    sampleHeight,
    y,
    handle.fftShallowHandle,
  );

  tuneReferenceOcean(handle, 0, Infinity, 0, 1);

  if (handle.fftSurfSystem) {
    console.info("[gpu-fft-ocean] ACTIVE: larger rolling breakers + whitewater splash + swash");
  }
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

  tuneReferenceOcean(handle, elapsed, cameraY, storm, day);

  if (handle?.fftSurfSystem?.gpuSurfSystem) {
    updateGPUSurfSystem(handle.fftSurfSystem, elapsed, cameraY, storm, day, sunDir);
  }
}

export function updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt = 1 / 60) {
  return updateBaseRipples(handle, playerPos, cameraY, dt);
}

export function disposeGPUFFTOcean(scene, handle) {
  if (handle?.fftSurfSystem?.gpuSurfSystem) {
    disposeGPUSurfSystem(scene, handle.fftSurfSystem);
  }
  if (handle) handle.fftSurfSystem = null;
  return disposeBaseOcean(scene, handle);
}
