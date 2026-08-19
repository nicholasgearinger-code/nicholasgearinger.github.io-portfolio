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
// Geometry remains entirely FFT-driven. Detail lighting is rebuilt from the
// displaced surface itself rather than the old interpolated integer fftIndex,
// avoiding the stripe/banding artifact while restoring wave-shaped normals.

function setupSmoothFFTLighting(handle) {
  const material = handle?.mesh?.material;
  if (!material || handle.fftSmoothLightingApplied) return;

  const surfaceColor = uniform(color(0x0b3138));
  const underwaterColor = uniform(color(0x168da0));
  const crestColor = uniform(color(0xb8e1df));
  const underwaterMix = uniform(0.0);
  const waterLevel = uniform(handle.waterY ?? 0);

  // positionView already contains the FFT positionNode displacement. Taking
  // derivatives here produces a continuous per-pixel geometric normal from
  // the rendered wave surface, with no storage-buffer index lookup in the
  // fragment stage and therefore no integer interpolation bands.
  const geometricNormal = Fn(() => {
    const dx = dFdx(positionView);
    const dy = dFdy(positionView);
    return cross(dx, dy).normalize();
  })();

  material.normalNode = geometricNormal;

  const fresnel = Fn(() => {
    const facing = clamp(abs(dot(geometricNormal, positionViewDirection)), 0, 1);
    return pow(float(1).sub(facing), float(4.2));
  })();

  const crest = smoothstep(
    waterLevel.add(0.45),
    waterLevel.add(2.4),
    positionWorld.y,
  );

  material.colorNode = Fn(() => {
    const base = mix(surfaceColor, underwaterColor, underwaterMix);
    const grazingLight = mix(base, crestColor, fresnel.mul(0.34));
    const crestLight = crest.mul(float(1).sub(underwaterMix)).mul(0.16);
    return mix(grazingLight, crestColor, crestLight);
  })();

  // Smoother glancing angles give the surface the bright wet sheen visible in
  // rough-ocean photography while face-on portions stay a little rougher.
  material.roughnessNode = mix(
    float(0.17),
    float(0.045),
    fresnel.mul(0.85).add(crest.mul(0.15)),
  );

  // From below, let the wave ceiling retain a faint cyan radiance instead of
  // turning into a black opaque sheet. Existing scene lights still provide the
  // main illumination; this is only a subtle underwater fill.
  material.emissiveNode = underwaterColor.mul(underwaterMix.mul(0.10));
  material.needsUpdate = true;

  handle.fftSurfaceColor = surfaceColor;
  handle.fftUnderwaterColor = underwaterColor;
  handle.fftCrestColor = crestColor;
  handle.fftUnderwaterMix = underwaterMix;
  handle.fftSmoothLightingApplied = true;
}

function applyPhotographicOceanLook(handle, underwater = false, day = 1, storm = 0) {
  if (!handle?.gpuFFT) return;

  const dayT = Math.max(0, Math.min(1, day));
  const stormT = Math.max(0, Math.min(1, storm));

  if (handle.fftUnderwaterMix) handle.fftUnderwaterMix.value = underwater ? 1 : 0;

  if (underwater) {
    if (handle.deepTint?.value) handle.deepTint.value.set(0x0b5e70);
    if (handle.shallowTint?.value) handle.shallowTint.value.set(0x4fd7df);
    if (handle.fftUnderwaterColor?.value) handle.fftUnderwaterColor.value.set(0x168da0);
    if (handle.fftCrestColor?.value) handle.fftCrestColor.value.set(0x9fe8ec);

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
  // derivative-based lighting before the first rendered frame.
  handle.mesh.material.normalNode = null;
  handle.mesh.material.colorNode = null;
  setupSmoothFFTLighting(handle);
  applyPhotographicOceanLook(handle, false, 1, 0);

  console.info("[gpu-fft-ocean] ACTIVE: smooth FFT normals + Fresnel lighting");
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

  // Base visual updates may touch the old node inputs; keep our continuous
  // derivative-based graph installed for the FFT material.
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
