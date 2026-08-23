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
// The FFT remains responsible for real displacement + normals. This wrapper keeps
// the top face reflective and gives the underside a cheap transmission/Snell cue;
// broader underwater atmosphere lives in underwaterWorld.js.
const SKY_BIAS = new THREE.Color(0xc4eaf0);
const HORIZON_FALLBACK = new THREE.Color(0xa6d6df);
const NIGHT_HORIZON = new THREE.Color(0x2b405b);
const NIGHT_SKY_REFLECTION = new THREE.Color(0x20364e);
const DAY_FOAM = new THREE.Color(0xdff8f4);
const NIGHT_FOAM = new THREE.Color(0x7f9fac);
const DEEP_BASE = new THREE.Color(0x0a4a58);
const SHALLOW_BASE = new THREE.Color(0x55c9c3);

const UNDER_SURFACE_DAY = new THREE.Color(0x79dfe5);
const UNDER_SURFACE_NIGHT = new THREE.Color(0x365f7b);
const UNDER_DEEP_DAY = new THREE.Color(0x1a6178);
const UNDER_DEEP_NIGHT = new THREE.Color(0x162d45);
const UNDER_GRAZING_DAY = new THREE.Color(0x16445b);
const UNDER_GRAZING_NIGHT = new THREE.Color(0x102238);

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

  // Flatten only the underside SHADING normal. Real FFT geometry keeps its full
  // displacement/chop, while the broad low-frequency normal lobes no longer turn
  // into giant smooth discs when viewed from below.
  const underwaterNormal = vec3(
    baseNormalNode.x.mul(0.22),
    baseNormalNode.y,
    baseNormalNode.z.mul(0.22),
  ).normalize();
  material.normalNode = mix(baseNormalNode, underwaterNormal, handle.underwaterAmount);

  // Double-sided water needs a symmetric view angle.
  const ndv = clamp(abs(normalWorld.dot(viewDir)), 0, 1);
  const ndv2 = ndv.mul(ndv);
  const ndv4 = ndv2.mul(ndv2);
  const grazing = float(1).sub(ndv);
  const g2 = grazing.mul(grazing);
  const g4 = g2.mul(g2);
  const fresnel = float(0.035).add(g4.mul(grazing).mul(0.965));

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

  // Topside shoreline foam stays narrow and broken. From below it is almost
  // invisible; underwaterWorld.js supplies the water-column detail.
  const shallowMask = clamp(float(0.075).sub(depthT).mul(13.3333), 0, 1);
  const foamWave = sin(
    positionWorld.x.mul(0.20)
      .add(positionWorld.z.mul(0.145))
      .add(time.mul(0.72)),
  ).mul(0.5).add(0.5);
  const foamBreakup = clamp(foamWave.sub(0.38).mul(1.62), 0, 1);
  const foamDayVisibility = mix(float(0.38), float(1.0), handle.dayAmount);
  const foamUnderVisibility = float(1).sub(handle.underwaterAmount.mul(0.96));
  const shoreFoam = shallowMask
    .mul(foamBreakup)
    .mul(float(0.20).add(handle.stormAmount.mul(0.16)))
    .mul(foamDayVisibility)
    .mul(foamUnderVisibility);

  material.colorNode = Fn(() => {
    const cleanBase = mix(handle.shallowTint, handle.deepTint, depthT);
    const absorption = mix(float(1.05), float(0.80), depthT);
    const depthColor = cleanBase.mul(absorption);

    const fresnelStrength = mix(float(0.78), float(0.70), handle.dayAmount);
    const skyAtAngle = mix(handle.skyReflectionTint, handle.horizonTint, horizonFade);
    const reflectedWater = mix(depthColor, skyAtAngle, fresnel.mul(fresnelStrength));

    const horizonStrength = mix(float(0.88), float(0.72), handle.dayAmount);
    const horizonWater = mix(reflectedWater, handle.horizonTint, horizonFade.mul(horizonStrength));
    const topWater = mix(horizonWater, handle.foamVisualTint, shoreFoam);

    // Underwater transmission uses information the FFT has already produced —
    // displaced crest height + view angle — so there is no extra noise/texture
    // lookup. Nearly overhead facets transmit considerably more daylight, giving
    // the underside moving bright patches instead of one uniformly dark ceiling.
    const crest = clamp(
      positionWorld.y.sub(handle.waterLevelNode).mul(0.44).add(0.5),
      0,
      1,
    );
    const facingLight = clamp(ndv.mul(0.20).add(0.54), 0.48, 0.77);
    const transmission = clamp(
      facingLight.add(crest.sub(0.5).mul(0.14)),
      0.44,
      0.84,
    );
    const underBase = mix(handle.underDeepTint, handle.underSurfaceTint, transmission);

    // Cheap Snell-window cue: only the most head-on portion of the water ceiling
    // gets this extra pale transmission. ndv^4 gives a tight central response
    // using multiplies only — much cheaper than a screen-space refraction pass.
    const snellStrength = ndv4.mul(handle.dayAmount).mul(0.30);
    const underSnell = mix(underBase, handle.underSurfaceTint, snellStrength);

    // Total-internal-reflection cue at shallow angles remains deliberately small.
    const underView = mix(underSnell, handle.underGrazingTint, grazing.mul(0.065));
    const underwaterFar = mix(underView, handle.underDeepTint, horizonFade.mul(0.14));

    return mix(topWater, underwaterFar, handle.underwaterAmount);
  })();

  const nightAmount = float(1).sub(handle.dayAmount);
  const baseRoughness = float(0.115)
    .add(handle.stormAmount.mul(0.05))
    .add(nightAmount.mul(0.075));
  const grazingRoughness = mix(float(0.078), float(0.045), handle.dayAmount);
  const topRoughness = mix(baseRoughness, grazingRoughness, fresnel);
  const underwaterRoughness = float(0.235)
    .add(handle.stormAmount.mul(0.04))
    .add(nightAmount.mul(0.03));
  material.roughnessNode = mix(topRoughness, underwaterRoughness, handle.underwaterAmount);
  material.metalnessNode = float(0.01);

  // Do not fade the underwater ceiling transparent at distance. The dedicated
  // underwater horizon shell handles the finite-world background instead.
  const topOpacity = mix(float(0.94), float(0.02), horizonFade);
  const underwaterOpacity = float(0.98);
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

  handle.waveScale.value = 1.45;
  handle.mesh.scale.y = 1.05;
  handle.deepTint.value.copy(DEEP_BASE);
  handle.shallowTint.value.copy(SHALLOW_BASE);

  console.info("[gpu-fft-ocean] mobile production water pass v7 + transmitted underside active");
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
