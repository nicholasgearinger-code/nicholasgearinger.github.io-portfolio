import * as THREE from "three";
import {
  Fn,
  attribute,
  cameraPosition,
  clamp,
  float,
  mix,
  normalWorld,
  positionWorld,
  sin,
  time,
  uniform,
} from "three/tsl";
import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean.js";

// Mobile production wrapper for the GPU FFT ocean.
// Keep the FFT simulation/normal field from gpu_fft_ocean.js, but use a much
// cheaper fragment treatment than the first production pass. The previous pass
// stacked several trigonometric ripple/glitter layers per pixel and cost too much
// on iPhone. This version spends only one animated sine on shoreline breakup.
const SKY_BIAS = new THREE.Color(0xc4eaf0);
const HORIZON_FALLBACK = new THREE.Color(0xa6d6df);
const DEEP_BASE = new THREE.Color(0x0a4a58);
const SHALLOW_BASE = new THREE.Color(0x55c9c3);

function installProductionWaterNodes(handle, size) {
  if (!handle?.gpuFFT || handle.productionWaterNodesInstalled) return;

  const material = handle.mesh.material;
  const depthT = attribute("fftDepth", "float");

  handle.skyReflectionTint = uniform(SKY_BIAS.clone());
  handle.horizonTint = uniform(HORIZON_FALLBACK.clone());
  handle.foamVisualTint = uniform(new THREE.Color(0xdff8f4));

  // Keep the actual FFT-derived normal. The first production pass overlaid
  // three procedural normal bands here; they were expensive on mobile and were
  // not buying enough visual detail to justify the frame-time hit.

  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const ndv = clamp(normalWorld.dot(viewDir), 0, 1);
  const grazing = float(1).sub(ndv);
  const g2 = grazing.mul(grazing);
  const g4 = g2.mul(g2);
  const fresnel = float(0.035).add(g4.mul(grazing).mul(0.965));

  // Fade BEFORE the finite plane edge. The old far distance was outside the
  // straight-ahead edge of the square ocean, so a dark silhouette remained.
  const dx = positionWorld.x.sub(cameraPosition.x);
  const dz = positionWorld.z.sub(cameraPosition.z);
  const distSq = dx.mul(dx).add(dz.mul(dz));
  const fogNear = size * 0.30;
  const fogFar = size * 0.475;
  const fogNearSq = fogNear * fogNear;
  const fogFarSq = fogFar * fogFar;
  const horizonFade = clamp(
    distSq.sub(fogNearSq).div(Math.max(1, fogFarSq - fogNearSq)),
    0,
    1,
  );

  // The base FFT shader mixes compression foam directly into its base color.
  // That was the source of the broad solid white "rail" visible at shore.
  // Build the water color directly from the depth tints instead, then add a
  // much narrower and weaker broken shore foam mask of our own.
  const shallowMask = clamp(float(0.085).sub(depthT).mul(11.7647), 0, 1);
  const foamWave = sin(
    positionWorld.x.mul(0.20)
      .add(positionWorld.z.mul(0.145))
      .add(time.mul(0.72)),
  ).mul(0.5).add(0.5);
  const foamBreakup = clamp(foamWave.sub(0.34).mul(1.52), 0, 1);
  const shoreFoam = shallowMask
    .mul(foamBreakup)
    .mul(float(0.24).add(handle.stormAmount.mul(0.18)));

  material.colorNode = Fn(() => {
    const cleanBase = mix(handle.shallowTint, handle.deepTint, depthT);

    // Approximate absorption without extra texture reads: shallow water stays
    // bright, deeper water loses energy and becomes more blue-green.
    const absorption = mix(float(1.05), float(0.80), depthT);
    const depthColor = cleanBase.mul(absorption);

    const skyAtAngle = mix(handle.skyReflectionTint, handle.horizonTint, horizonFade);
    const reflectedWater = mix(depthColor, skyAtAngle, fresnel.mul(0.70));

    // Stronger distant atmospheric match plus alpha fade below removes the
    // remaining black horizon line while preserving some surface structure.
    const horizonWater = mix(reflectedWater, handle.horizonTint, horizonFade.mul(0.72));
    return mix(horizonWater, handle.foamVisualTint, shoreFoam);
  })();

  material.roughnessNode = mix(
    float(0.115).add(handle.stormAmount.mul(0.05)),
    float(0.045),
    fresnel,
  );
  material.metalnessNode = float(0.01);

  // Per-pixel opacity reaches almost zero before the mesh edge, so the sky can
  // show through instead of revealing the finite square ocean silhouette.
  material.opacityNode = mix(float(0.94), float(0.035), horizonFade);
  material.transparent = true;
  material.depthWrite = false;
  material.needsUpdate = true;

  handle.productionWaterNodesInstalled = true;
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle) return handle;

  installProductionWaterNodes(handle, size);

  // The diagnostic/first production passes were over-amplified, which made the
  // 128x128 FFT surface read as stacked ribbons at grazing view angles.
  handle.waveScale.value = 1.45;
  handle.mesh.scale.y = 1.05;

  handle.deepTint.value.copy(DEEP_BASE);
  handle.shallowTint.value.copy(SHALLOW_BASE);

  console.info("[gpu-fft-ocean] mobile production water pass v2 active");
  return handle;
}

export async function updateGPUFFTOcean(handle, renderer) {
  return updateBaseOcean(handle, renderer);
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

  const stormT = THREE.MathUtils.clamp(storm, 0, 1);

  // Base updater still owns the simulation weather uniforms, but its default
  // palette is replaced each frame with the Crystal tropical palette.
  handle.deepTint.value.copy(DEEP_BASE);
  handle.shallowTint.value.copy(SHALLOW_BASE);

  if (skyColor?.isColor) {
    handle.deepTint.value.lerp(skyColor, 0.055);
    handle.shallowTint.value.lerp(skyColor, 0.09);
    handle.skyReflectionTint.value.copy(SKY_BIAS).lerp(skyColor, 0.58);
  } else {
    handle.skyReflectionTint.value.copy(SKY_BIAS);
  }

  if (skyHorizon?.isColor) {
    handle.horizonTint.value.copy(skyHorizon);
  } else if (skyColor?.isColor) {
    handle.horizonTint.value.copy(skyColor).lerp(HORIZON_FALLBACK, 0.32);
  } else {
    handle.horizonTint.value.copy(HORIZON_FALLBACK);
  }

  handle.waveScale.value = 1.45 + stormT * 0.62;
  handle.mesh.scale.y = 1.05 + Math.sin(elapsed * 0.20) * 0.015 + stormT * 0.055;
}

export function disposeGPUFFTOcean(scene, handle) {
  return disposeBaseOcean(scene, handle);
}
