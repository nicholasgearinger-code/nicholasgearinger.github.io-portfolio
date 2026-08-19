import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean.js";
import {
  Fn, uniform, color, float,
  positionView, positionWorld, positionViewDirection,
  dFdx, dFdy, cross, dot, abs, pow, mix, clamp, smoothstep,
} from "three/tsl";

// Photographic tuning layered over the working 128x128 GPU FFT simulation.
// Geometry remains entirely FFT-driven. Detail lighting and foam are rebuilt
// from the displaced surface itself rather than interpolated integer fftIndex
// lookups, avoiding the stripe/banding artifact while preserving wave detail.

function setupSmoothFFTLighting(handle) {
  const material = handle?.mesh?.material;
  if (!material || handle.fftSmoothLightingApplied) return;

  const surfaceColor = uniform(color(0x0b3138));
  const underwaterColor = uniform(color(0x168da0));
  const crestColor = uniform(color(0xb8e1df));
  const foamColor = uniform(color(0xe7f2ee));
  const underwaterMix = uniform(0.0);
  const waterLevel = uniform(handle.waterY ?? 0);
  const foamStrength = uniform(1.0);

  // The displaced FFT surface is already present in both positionView and
  // positionWorld. Screen-space derivatives give us continuous normals without
  // fragment-stage storage-buffer indexing, so there are no integer bands.
  const geometricNormal = Fn(() => {
    const dx = dFdx(positionView);
    const dy = dFdy(positionView);
    return cross(dx, dy).normalize();
  })();

  const worldNormal = Fn(() => {
    const dx = dFdx(positionWorld);
    const dy = dFdy(positionWorld);
    return cross(dx, dy).normalize();
  })();

  material.normalNode = geometricNormal;

  const fresnel = Fn(() => {
    const facing = clamp(abs(dot(geometricNormal, positionViewDirection)), 0, 1);
    return pow(float(1).sub(facing), float(4.2));
  })();

  const crest = smoothstep(
    waterLevel.add(0.45),
    waterLevel.add(2.6),
    positionWorld.y,
  );

  // Whitecaps are attached to the real FFT geometry: they need both height
  // and steepness, so broad flat high areas do not turn white. This is a
  // continuous screen-space approximation of crest breaking/compression and
  // deliberately avoids the old artifact-prone integer Jacobian lookup.
  const slope = clamp(float(1).sub(abs(worldNormal.y)), 0, 1);
  const steepCrest = smoothstep(float(0.08), float(0.34), slope)
    .mul(smoothstep(float(0.20), float(0.78), crest));
  const whitecap = clamp(
    steepCrest.mul(foamStrength).mul(float(1).sub(underwaterMix.mul(0.82))),
    0,
    1,
  );

  material.colorNode = Fn(() => {
    const base = mix(surfaceColor, underwaterColor, underwaterMix);
    const grazingLight = mix(base, crestColor, fresnel.mul(0.34));
    const crestLight = crest.mul(float(1).sub(underwaterMix)).mul(0.14);
    const litWater = mix(grazingLight, crestColor, crestLight);
    return mix(litWater, foamColor, whitecap.mul(0.88));
  })();

  // Wet water is smooth at grazing angles; foam is visibly rougher and more
  // diffuse. This lets whitecaps break up the mirror-like highlights naturally.
  const baseRoughness = mix(
    float(0.17),
    float(0.045),
    fresnel.mul(0.85).add(crest.mul(0.15)),
  );
  material.roughnessNode = mix(baseRoughness, float(0.38), whitecap.mul(0.92));

  // From below, retain a faint cyan radiance. Whitecap emissive contribution is
  // intentionally tiny so foam stays lit by the scene rather than glowing.
  material.emissiveNode = underwaterColor.mul(underwaterMix.mul(0.10))
    .add(foamColor.mul(whitecap.mul(0.015)));

  material.needsUpdate = true;

  handle.fftSurfaceColor = surfaceColor;
  handle.fftUnderwaterColor = underwaterColor;
  handle.fftCrestColor = crestColor;
  handle.fftFoamColor = foamColor;
  handle.fftUnderwaterMix = underwaterMix;
  handle.fftFoamStrength = foamStrength;
  handle.fftSmoothLightingApplied = true;
}

function applyPhotographicOceanLook(handle, underwater = false, day = 1, storm = 0) {
  if (!handle?.gpuFFT) return;

  const dayT = Math.max(0, Math.min(1, day));
  const stormT = Math.max(0, Math.min(1, storm));

  if (handle.fftUnderwaterMix) handle.fftUnderwaterMix.value = underwater ? 1 : 0;
  if (handle.fftFoamStrength) handle.fftFoamStrength.value = 0.92 + stormT * 0.72;

  if (underwater) {
    if (handle.deepTint?.value) handle.deepTint.value.set(0x0b5e70);
    if (handle.shallowTint?.value) handle.shallowTint.value.set(0x4fd7df);
    if (handle.fftUnderwaterColor?.value) handle.fftUnderwaterColor.value.set(0x168da0);
    if (handle.fftCrestColor?.value) handle.fftCrestColor.value.set(0x9fe8ec);
    if (handle.fftFoamColor?.value) handle.fftFoamColor.value.set(0xbfe7e5);

    if (handle.mesh?.material) {
      handle.mesh.material.opacity = 0.72;
      handle.mesh.material.metalness = 0.0;
    }
    return;
  }

  const deep = stormT > 0.45 ? 0x07191d : 0x082a31;
  const shallow = stormT > 0.45 ? 0x183b40 : 0x14535c;
  if (handle.deepTint?.value) handle.deepTint.value.set(deep);
  if (handle.shallowTint?.value) handle.shallowTint.value.set(shallow);
  if (handle.fftSurfaceColor?.value) handle.fftSurfaceColor.value.set(stormT > 0.45 ? 0x071d22 : 0x0b3138);
  if (handle.fftCrestColor?.value) handle.fftCrestColor.value.set(dayT > 0.35 ? 0xd0e4df : 0x71999c);
  if (handle.fftFoamColor?.value) handle.fftFoamColor.value.set(dayT > 0.30 ? 0xe7f2ee : 0x8ea9a8);

  if (handle.mesh?.material) {
    handle.mesh.material.opacity = 0.965;
    handle.mesh.material.metalness = 0.012;
  }
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle) return handle;

  handle.waveScale.value = 47.0;
  handle.mesh.scale.y = 1.12;
  handle.fftVisualBoost = true;
  handle.fftUnderwater = false;

  // Replace the old artifact-prone normal/color graph with continuous
  // derivative-based lighting and whitecaps before the first rendered frame.
  handle.mesh.material.normalNode = null;
  handle.mesh.material.colorNode = null;
  setupSmoothFFTLighting(handle);
  applyPhotographicOceanLook(handle, false, 1, 0);

  console.info("[gpu-fft-ocean] ACTIVE: smooth FFT lighting + crest whitecaps");
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

  setupSmoothFFTLighting(handle);

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
