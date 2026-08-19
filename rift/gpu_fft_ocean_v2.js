import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean.js";

// Photographic tuning layered over the working 128x128 GPU FFT simulation.
// The geometry remains 100% FFT-driven; this wrapper only calibrates resolved
// displacement and changes the optical response for above/below-water views.

function disableArtifactProneFragmentShading(handle) {
  const material = handle?.mesh?.material;
  if (!material || handle.fftBandingFixApplied) return;

  // The base material currently derives normal/foam in the fragment stage by
  // converting an interpolated float fftIndex back to uint and then indexing
  // storage buffers. Across a triangle that creates discontinuous integer
  // lookups and visible stripe/banding artifacts. Keep the real FFT geometry,
  // but temporarily fall back to the material's ordinary smooth shading until
  // these values are rebuilt as proper vertex-stage varyings.
  material.normalNode = null;
  material.colorNode = null;
  material.needsUpdate = true;
  handle.fftBandingFixApplied = true;
}

function applyPhotographicOceanLook(handle, underwater = false, day = 1, storm = 0) {
  if (!handle?.gpuFFT) return;

  const dayT = Math.max(0, Math.min(1, day));
  const stormT = Math.max(0, Math.min(1, storm));

  if (underwater) {
    if (handle.deepTint?.value) handle.deepTint.value.set(0x0b5e70);
    if (handle.shallowTint?.value) handle.shallowTint.value.set(0x4fd7df);

    if (handle.mesh?.material) {
      handle.mesh.material.color?.set?.(0x168da0);
      handle.mesh.material.roughness = 0.065;
      handle.mesh.material.metalness = 0.0;
      handle.mesh.material.opacity = 0.72;
      if (handle.mesh.material.emissive?.set) handle.mesh.material.emissive.set(0x0d5967);
      handle.mesh.material.emissiveIntensity = 0.18 + dayT * 0.22;
    }
    return;
  }

  if (handle.deepTint?.value) handle.deepTint.value.set(stormT > 0.45 ? 0x07191d : 0x082a31);
  if (handle.shallowTint?.value) handle.shallowTint.value.set(stormT > 0.45 ? 0x183b40 : 0x14535c);

  if (handle.mesh?.material) {
    handle.mesh.material.color?.set?.(0x0b3138);
    handle.mesh.material.roughness = 0.095 + stormT * 0.045;
    handle.mesh.material.metalness = 0.012;
    handle.mesh.material.opacity = 0.965;
    if (handle.mesh.material.emissive?.set) handle.mesh.material.emissive.set(0x000000);
    handle.mesh.material.emissiveIntensity = 0.0;
  }
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle) return handle;

  handle.waveScale.value = 47.0;
  handle.mesh.scale.y = 1.12;
  handle.fftVisualBoost = true;
  handle.fftUnderwater = false;

  disableArtifactProneFragmentShading(handle);
  applyPhotographicOceanLook(handle, false, 1, 0);

  console.info("[gpu-fft-ocean] ACTIVE: photographic FFT with banding fix");
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
  if (!handle?.gpuFFT) return;

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

  // Base visuals may touch node-driven color inputs, so keep the temporary
  // artifact-safe shading path enforced until the vertex-varying rewrite.
  disableArtifactProneFragmentShading(handle);

  const stormT = Math.max(0, Math.min(1, storm));
  const underwater = Number.isFinite(cameraY) && cameraY < handle.waterY - 0.12;

  const longSet = Math.sin(elapsed * 0.071 + 0.4) * 3.4;
  const shortSet = Math.sin(elapsed * 0.193 + 2.1) * 1.7;

  handle.waveScale.value = 47.0 + longSet + shortSet + stormT * 15.0;
  handle.mesh.scale.y = 1.12 + stormT * 0.11;

  if (handle.fftUnderwater !== underwater) handle.fftUnderwater = underwater;
  applyPhotographicOceanLook(handle, underwater, day, storm);
}

export function disposeGPUFFTOcean(scene, handle) {
  return disposeBaseOcean(scene, handle);
}
