import * as THREE from "three";
import * as oceanV9 from "./gpu_fft_ocean_v9.js";

// -----------------------------------------------------------------------------
// Water Pro v12 — Safari-safe optics pass.
//
// Keep v9's proven WebGPU compute graph and TSL node graph completely intact.
// v11's extra geometry sampling and mobile SSR both proved capable of poisoning
// Safari's command encoder. v12 changes only existing uniform/material values
// after v9 has finished its normal update, so there are no new buffers,
// pipelines, compute dispatches, MRT attachments, or positionNode changes.
// -----------------------------------------------------------------------------

function tuneSafeOptics(handle, storm = 0, day = 1) {
  if (!handle?.gpuFFT) return;

  const stormT = THREE.MathUtils.clamp(Number(storm) || 0, 0, 1);
  const dayT = THREE.MathUtils.clamp(Number(day) || 0, 0, 1);

  // Richer tropical depth palette using v9's existing uniforms.
  if (handle.fftV9ShallowColor?.value) {
    handle.fftV9ShallowColor.value.set(0x68e6da);
  }
  if (handle.fftV9MidColor?.value) {
    handle.fftV9MidColor.value.set(0x1389a4);
  }
  if (handle.fftV9DeepColor?.value) {
    handle.fftV9DeepColor.value.set(0x052f49);
  }

  // Brighter aligned solar sparkle and clearer turquoise wave tips. These are
  // existing v9 uniforms, so changing them does not rebuild the shader graph.
  if (handle.fftV9SunColor?.value) {
    handle.fftV9SunColor.value
      .set(0xa9d3ec)
      .lerp(new THREE.Color(0xfff3d8), dayT);
  }
  if (handle.fftV9CrestColor?.value) {
    handle.fftV9CrestColor.value
      .set(0x62acbe)
      .lerp(new THREE.Color(0xbdf8e8), dayT);
  }
  if (handle.fftFoamColor?.value) {
    handle.fftFoamColor.value.set(0xfffdf6);
  }

  // Make the two existing FFT cascades a little more legible without adding a
  // third compute cascade. Only the already-existing waveScale uniforms change.
  if (handle.waveScale) {
    handle.waveScale.value = 26.0 + stormT * 6.8;
  }
  if (handle.fftDetailHandle?.waveScale) {
    handle.fftDetailHandle.waveScale.value = 25.3 + stormT * 7.4;
  }

  const physical = handle.fftPhysicalMaterial;
  if (physical) {
    physical.ior = 1.333;
    physical.attenuationDistance = 58;
    physical.attenuationColor.set(0x91d3ca);
    physical.clearcoat = 0.40;
    physical.clearcoatRoughness = 0.085 + stormT * 0.055;

    // Environment reflection remains the mobile reflection path. No SSR/MRT.
    // Keep enough energy for sky/shore reflections without the old planar pass.
    if (physical.envMapIntensity > 0) {
      physical.envMapIntensity = Math.max(1.08, physical.envMapIntensity);
    }
  }

  handle.__riftWaterProBackend = "v9-two-fft + v12-safe-optics";
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = oceanV9.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
  tuneSafeOptics(handle, 0, 1);
  if (handle?.gpuFFT) {
    console.info("[rift-water] Water Pro v12: stable v9 FFT + safe optics; mobile SSR off");
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
  tuneSafeOptics(handle, storm, day);
}

export function updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt = 1 / 60) {
  return oceanV9.updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt);
}

export function disposeGPUFFTOcean(scene, handle) {
  return oceanV9.disposeGPUFFTOcean(scene, handle);
}
