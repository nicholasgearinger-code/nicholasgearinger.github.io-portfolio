import * as THREE from "three";
import * as oceanV20 from "./gpu_fft_ocean_r185_v20.js";

// -----------------------------------------------------------------------------
// Water Pro r185 v21 — sunrise/sunset optical response.
//
// The FFT simulation/compute graph remains untouched. This layer only retunes
// existing v9 optical uniforms/material properties from the shared solar state:
// warmer/brighter glint, reflected-sky tint, slightly smoother clear-water
// response, and warm back-lit crests when a richer solar state is available.
// -----------------------------------------------------------------------------

const TMP_SKY = new THREE.Color();
const TMP_SUN = new THREE.Color();
const TMP_CREST = new THREE.Color();
const BASE_CREST = new THREE.Color(0xb7f4ef);
const GOLD_CREST = new THREE.Color(0xffddaa);

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function applySunsetOceanOptics(handle, stormAmount = 0) {
  if (!handle?.gpuFFT) return;

  const sunset = globalThis.__riftSunsetAtmosphereV8 || globalThis.__riftSunsetAtmosphereV9;
  const atmosphere = globalThis.__riftReferenceAtmosphere;
  const solar = globalThis.__riftSolarLightingV7 || globalThis.__riftSolarLightingV6;
  if (!sunset && !atmosphere && !solar) return;

  const storm = clamp01(stormAmount ?? sunset?.storm ?? solar?.storm ?? 0);
  const clear = 1 - storm;
  const golden = clamp01(sunset?.goldenHour ?? solar?.goldenHour ?? 0) * clear;
  const fire = clamp01(sunset?.horizonFire ?? 0) * clear;
  const lowSun = Math.max(golden, fire);
  const cloudT = clamp01(sunset?.cloudTransmittance ?? solar?.cloudTransmittance ?? 1);

  if (handle.fftV9SkyColor?.value?.isColor) {
    if (sunset) {
      TMP_SKY.copy(sunset.horizonColor)
        .lerp(sunset.upperMidColor, THREE.MathUtils.lerp(0.22, 0.34, sunset.highSun || 0));
      handle.fftV9SkyColor.value.copy(TMP_SKY);
    } else if (atmosphere?.horizonColor?.isColor) {
      handle.fftV9SkyColor.value.copy(atmosphere.horizonColor)
        .lerp(atmosphere.zenithColor, 0.34);
    }
  }

  if (handle.fftV9SunColor?.value?.isColor) {
    TMP_SUN.copy(
      sunset?.waterSunTint
      || sunset?.directLightColor
      || solar?.sunColor
      || new THREE.Color(0xffedd0),
    );

    const solarEnergy = clamp01((solar?.directSunIntensity ?? 4.5) / 6.5);
    const glintEnergy = THREE.MathUtils.lerp(0.88, 1.34, solarEnergy)
      * THREE.MathUtils.lerp(1.0, 1.48, lowSun)
      * THREE.MathUtils.lerp(0.46, 1.0, Math.pow(cloudT, 0.42));
    handle.fftV9SunColor.value.copy(TMP_SUN).multiplyScalar(glintEnergy);
  }

  if (handle.fftV9CrestColor?.value?.isColor) {
    TMP_CREST.copy(BASE_CREST).lerp(GOLD_CREST, lowSun * 0.34);
    TMP_CREST.lerp(BASE_CREST, storm * 0.72);
    handle.fftV9CrestColor.value.copy(TMP_CREST);
  }

  const physical = handle.fftPhysicalMaterial;
  if (physical) {
    physical.clearcoat = THREE.MathUtils.lerp(0.40, 0.50, lowSun * clear);
    physical.clearcoatRoughness = THREE.MathUtils.lerp(
      0.13 + storm * 0.05,
      0.085 + storm * 0.045,
      lowSun * clear,
    );
    if ((Number(physical.envMapIntensity) || 0) > 0) {
      physical.envMapIntensity = Math.max(
        Number(physical.envMapIntensity) || 0,
        THREE.MathUtils.lerp(1.0 - storm * 0.12, 1.38 - storm * 0.20, lowSun),
      );
    }
  }

  globalThis.__riftWaterSunsetV21 = {
    goldenHour: golden,
    horizonFire: fire,
    lowSun,
    storm,
    cloudTransmittance: cloudT,
    glintColor: handle.fftV9SunColor?.value?.clone?.() ?? null,
    envMapIntensity: Number(physical?.envMapIntensity) || 0,
    clearcoatRoughness: Number(physical?.clearcoatRoughness) || 0,
  };
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = oceanV20.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
  if (handle?.gpuFFT) {
    handle.__riftWaterSunsetV21 = true;
    applySunsetOceanOptics(handle, 0);
  }
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  return oceanV20.updateGPUFFTOcean(handle, renderer, elapsedTime);
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
  oceanV20.updateGPUFFTOceanVisuals(
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
  applySunsetOceanOptics(handle, storm);
}

export function updateGPUFFTOceanRipples(...args) {
  return oceanV20.updateGPUFFTOceanRipples(...args);
}

export function disposeGPUFFTOcean(...args) {
  delete globalThis.__riftWaterSunsetV21;
  return oceanV20.disposeGPUFFTOcean(...args);
}
