import * as THREE from "three";
import {
  Fn,
  abs,
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
  vec3,
} from "three/tsl";
import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean.js";

// Mobile production wrapper for the GPU FFT ocean.
// Keep the FFT simulation/normal field from gpu_fft_ocean.js, while handling
// Fresnel, depth color, broken shore foam, atmosphere and day/night roughness in
// one lightweight material pass. The real sun/moon specular response comes from
// the scene's DirectionalLights; this shader deliberately does not add a second
// fake glitter calculation on top of the PBR lighting.
const SKY_BIAS = new THREE.Color(0xc4eaf0);
const HORIZON_FALLBACK = new THREE.Color(0xa6d6df);
const NIGHT_HORIZON = new THREE.Color(0x2b405b);
const NIGHT_SKY_REFLECTION = new THREE.Color(0x20364e);
const DAY_FOAM = new THREE.Color(0xdff8f4);
const NIGHT_FOAM = new THREE.Color(0x7f9fac);
const DEEP_BASE = new THREE.Color(0x0a4a58);
const SHALLOW_BASE = new THREE.Color(0x55c9c3);

// Dedicated underside palette. Underwater deliberately uses a calmer,
// transmission-heavy palette than the top face. From below, large low-frequency
// FFT normals should read as the shape of the ceiling, not as giant colored
// Fresnel blobs painted onto it.
const UNDER_SURFACE_DAY = new THREE.Color(0x62ced8);
const UNDER_SURFACE_NIGHT = new THREE.Color(0x315f7a);
const UNDER_DEEP_DAY = new THREE.Color(0x1b6b80);
const UNDER_DEEP_NIGHT = new THREE.Color(0x172f48);
const UNDER_GRAZING_DAY = new THREE.Color(0x2b6576);
const UNDER_GRAZING_NIGHT = new THREE.Color(0x162b43);

function installProductionWaterNodes(handle, size) {
  if (!handle?.gpuFFT || handle.productionWaterNodesInstalled) return;

  const material = handle.mesh.material;
  const depthT = attribute("fftDepth", "float");
  const baseNormalNode = material.normalNode;

  handle.skyReflectionTint = uniform(SKY_BIAS.clone());
  handle.horizonTint = uniform(HORIZON_FALLBACK.clone());
  handle.foamVisualTint = uniform(DAY_FOAM.clone());
  handle.underwaterAmount = uniform(0.0);
  handle.waterLevelNode = uniform(handle.waterY ?? handle.mesh.position.y ?? 0);
  handle.underSurfaceTint = uniform(UNDER_SURFACE_DAY.clone());
  handle.underDeepTint = uniform(UNDER_DEEP_DAY.clone());
  handle.underGrazingTint = uniform(UNDER_GRAZING_DAY.clone());

  const viewDir = cameraPosition.sub(positionWorld).normalize();

  // Two inexpensive, directional micro-ripple bands. These do NOT replace the
  // FFT displacement; they only break up the broad underwater lighting lobes.
  // The actual surface silhouette and large swell remain driven by the GPU FFT.
  const microRippleA = sin(
    positionWorld.x.mul(0.92)
      .add(positionWorld.z.mul(1.31))
      .add(time.mul(1.45)),
  );
  const microRippleB = sin(
    positionWorld.x.mul(-1.47)
      .add(positionWorld.z.mul(0.58))
      .sub(time.mul(1.12)),
  );

  // This is the key shallow-water artifact fix. The base FFT normal is correct
  // for the top face, but from below its largest low-frequency lobes were being
  // amplified by PBR lighting into rows of obvious oval/circular patches. Keep
  // only ~30% of that broad tilt underwater and add much smaller directional
  // ripples on top. Geometry still moves with the full FFT; only the underside
  // lighting normal is stabilized.
  const underwaterNormal = vec3(
    baseNormalNode.x.mul(0.30).add(microRippleA.mul(0.055)),
    abs(baseNormalNode.y).mul(0.35).add(0.88),
    baseNormalNode.z.mul(0.30).add(microRippleB.mul(0.055)),
  ).normalize();
  material.normalNode = mix(baseNormalNode, underwaterNormal, handle.underwaterAmount);

  // Double-sided water must use a symmetric view angle. A negative back-face dot
  // cannot simply clamp to zero or the whole underside becomes grazing Fresnel.
  const ndv = clamp(abs(normalWorld.dot(viewDir)), 0, 1);
  const grazing = float(1).sub(ndv);
  const g2 = grazing.mul(grazing);
  const g4 = g2.mul(g2);
  const fresnel = float(0.035).add(g4.mul(grazing).mul(0.965));

  // Above-water distance fade. Underwater keeps a substantially opaque ceiling
  // so the finite plane edge cannot become a bright sky-colored strip.
  const dx = positionWorld.x.sub(cameraPosition.x);
  const dz = positionWorld.z.sub(cameraPosition.z);
  const distSq = dx.mul(dx).add(dz.mul(dz));
  const fogNear = size * 0.26;
  const fogFar = size * 0.44;
  const fogNearSq = fogNear * fogNear;
  const fogFarSq = fogFar * fogFar;
  const horizonFade = clamp(
    distSq.sub(fogNearSq).div(Math.max(1, fogFarSq - fogNearSq)),
    0,
    1,
  );

  // Narrow, broken shoreline foam. Foam is heavily suppressed from below.
  const shallowMask = clamp(float(0.075).sub(depthT).mul(13.3333), 0, 1);
  const foamWave = sin(
    positionWorld.x.mul(0.20)
      .add(positionWorld.z.mul(0.145))
      .add(time.mul(0.72)),
  ).mul(0.5).add(0.5);
  const foamBreakup = clamp(foamWave.sub(0.38).mul(1.62), 0, 1);
  const foamDayVisibility = mix(float(0.38), float(1.0), handle.dayAmount);
  const foamUnderVisibility = float(1).sub(handle.underwaterAmount.mul(0.92));
  const shoreFoam = shallowMask
    .mul(foamBreakup)
    .mul(float(0.20).add(handle.stormAmount.mul(0.16)))
    .mul(foamDayVisibility)
    .mul(foamUnderVisibility);

  material.colorNode = Fn(() => {
    const cleanBase = mix(handle.shallowTint, handle.deepTint, depthT);

    // Cheap Beer-Lambert-style absorption approximation for the top surface.
    const absorption = mix(float(1.05), float(0.80), depthT);
    const depthColor = cleanBase.mul(absorption);

    const fresnelStrength = mix(float(0.78), float(0.70), handle.dayAmount);
    const skyAtAngle = mix(handle.skyReflectionTint, handle.horizonTint, horizonFade);
    const reflectedWater = mix(depthColor, skyAtAngle, fresnel.mul(fresnelStrength));

    const horizonStrength = mix(float(0.88), float(0.72), handle.dayAmount);
    const horizonWater = mix(reflectedWater, handle.horizonTint, horizonFade.mul(horizonStrength));
    const topWater = mix(horizonWater, handle.foamVisualTint, shoreFoam);

    // -----------------------------------------------------------------------
    // Underwater shallow-wave ceiling
    // -----------------------------------------------------------------------
    // Previous v4 still used the large FFT slope and view-angle response as the
    // dominant color modulation. That was enough to preserve the same giant oval
    // lobes even after the original back-face Fresnel bug was fixed. v5 keeps
    // those low-frequency terms deliberately subtle and lets two finer moving
    // ripple bands provide most of the visible underwater surface variation.
    const crest = clamp(
      positionWorld.y.sub(handle.waterLevelNode).mul(0.48).add(0.5),
      0,
      1,
    );
    const rippleA01 = microRippleA.mul(0.5).add(0.5);
    const rippleB01 = microRippleB.mul(0.5).add(0.5);
    const microShimmer = rippleA01.mul(0.56).add(rippleB01.mul(0.44));

    const transmission = clamp(
      float(0.61)
        .add(crest.mul(0.16))
        .add(microShimmer.sub(0.5).mul(0.13)),
      0.42,
      0.84,
    );
    const underBase = mix(handle.underDeepTint, handle.underSurfaceTint, transmission);

    // Real total-internal-reflection still darkens grazing views, but only very
    // gently now. It is no longer allowed to draw the FFT's broad lobe pattern.
    const underView = mix(
      underBase,
      handle.underGrazingTint,
      grazing.mul(0.11),
    );

    // Distance becomes underwater atmospheric color rather than transparent sky.
    const underwaterFar = mix(underView, handle.underDeepTint, horizonFade.mul(0.28));

    return mix(topWater, underwaterFar, handle.underwaterAmount);
  })();

  const nightAmount = float(1).sub(handle.dayAmount);
  const baseRoughness = float(0.115)
    .add(handle.stormAmount.mul(0.05))
    .add(nightAmount.mul(0.075));
  const grazingRoughness = mix(float(0.078), float(0.045), handle.dayAmount);
  const topRoughness = mix(baseRoughness, grazingRoughness, fresnel);

  // Slightly rougher underwater than v4. Combined with the stabilized normal,
  // this keeps individual PBR highlights from turning into another set of large
  // smooth discs while still allowing moving light to read on the ceiling.
  const underwaterRoughness = float(0.205)
    .add(handle.stormAmount.mul(0.04))
    .add(nightAmount.mul(0.03));
  material.roughnessNode = mix(topRoughness, underwaterRoughness, handle.underwaterAmount);
  material.metalnessNode = float(0.01);

  const topOpacity = mix(float(0.94), float(0.02), horizonFade);
  const underwaterOpacity = mix(float(0.96), float(0.91), horizonFade);
  material.opacityNode = mix(topOpacity, underwaterOpacity, handle.underwaterAmount);
  material.transparent = true;
  material.depthWrite = false;
  material.needsUpdate = true;

  handle.productionWaterNodesInstalled = true;
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle) return handle;

  installProductionWaterNodes(handle, size);

  // Keep the real FFT amplitude, but restrained enough for the 128x128 mobile
  // mesh. Shallow-water attenuation itself is already handled by fftShore in the
  // base simulation, so we do not fake a second amplitude reduction here.
  handle.waveScale.value = 1.45;
  handle.mesh.scale.y = 1.05;

  handle.deepTint.value.copy(DEEP_BASE);
  handle.shallowTint.value.copy(SHALLOW_BASE);

  console.info("[gpu-fft-ocean] mobile production water pass v5 + shallow underwater ripples active");
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
  const dayT = THREE.MathUtils.clamp(day, 0, 1);
  const nightT = 1 - dayT;

  // Smooth transition through the surface instead of a binary material switch.
  if (handle.underwaterAmount) {
    const rawUnder = Number.isFinite(cameraY) && Number.isFinite(handle.waterY)
      ? THREE.MathUtils.clamp((handle.waterY + 0.12 - cameraY) / 0.55, 0, 1)
      : 0;
    handle.underwaterAmount.value = THREE.MathUtils.lerp(
      handle.underwaterAmount.value,
      rawUnder,
      0.22,
    );
  }
  if (handle.waterLevelNode) handle.waterLevelNode.value = handle.waterY;

  handle.deepTint.value.copy(DEEP_BASE);
  handle.shallowTint.value.copy(SHALLOW_BASE);

  if (skyColor?.isColor) {
    handle.deepTint.value.lerp(skyColor, 0.055);
    handle.shallowTint.value.lerp(skyColor, 0.09);
    handle.skyReflectionTint.value.copy(SKY_BIAS).lerp(skyColor, 0.58);
  } else {
    handle.skyReflectionTint.value.copy(SKY_BIAS);
  }

  if (nightT > 0) {
    handle.skyReflectionTint.value.lerp(NIGHT_SKY_REFLECTION, nightT * 0.28);
  }

  if (skyHorizon?.isColor) {
    handle.horizonTint.value.copy(skyHorizon);
  } else if (skyColor?.isColor) {
    handle.horizonTint.value.copy(skyColor).lerp(HORIZON_FALLBACK, 0.32);
  } else {
    handle.horizonTint.value.copy(HORIZON_FALLBACK);
  }
  if (nightT > 0) {
    handle.horizonTint.value.lerp(NIGHT_HORIZON, nightT * 0.34);
  }

  handle.foamVisualTint.value.copy(DAY_FOAM).lerp(NIGHT_FOAM, nightT * 0.72);

  if (handle.underSurfaceTint) {
    handle.underSurfaceTint.value.copy(UNDER_SURFACE_DAY).lerp(UNDER_SURFACE_NIGHT, nightT * 0.88);
    handle.underDeepTint.value.copy(UNDER_DEEP_DAY).lerp(UNDER_DEEP_NIGHT, nightT * 0.90);
    handle.underGrazingTint.value.copy(UNDER_GRAZING_DAY).lerp(UNDER_GRAZING_NIGHT, nightT * 0.92);
    if (stormT > 0) {
      handle.underSurfaceTint.value.lerp(UNDER_DEEP_DAY, stormT * 0.30);
      handle.underDeepTint.value.lerp(UNDER_GRAZING_DAY, stormT * 0.28);
    }
  }

  handle.waveScale.value = 1.45 + stormT * 0.62;
  handle.mesh.scale.y = 1.05 + Math.sin(elapsed * 0.20) * 0.015 + stormT * 0.055;
}

export function disposeGPUFFTOcean(scene, handle) {
  return disposeBaseOcean(scene, handle);
}
