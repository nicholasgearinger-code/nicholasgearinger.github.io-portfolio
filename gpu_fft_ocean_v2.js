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

// Dedicated underside palette. The old top-surface Fresnel was also being used
// from below, which made the low-frequency FFT normal lobes read as soft purple
// circles/ovals instead of a continuous moving water ceiling. Underwater now has
// its own restrained transmission/reflection balance instead of reusing the sky
// palette verbatim.
const UNDER_SURFACE_DAY = new THREE.Color(0x58c8d7);
const UNDER_SURFACE_NIGHT = new THREE.Color(0x315f7a);
const UNDER_DEEP_DAY = new THREE.Color(0x17647b);
const UNDER_DEEP_NIGHT = new THREE.Color(0x172f48);
const UNDER_GRAZING_DAY = new THREE.Color(0x245a70);
const UNDER_GRAZING_NIGHT = new THREE.Color(0x162b43);

function installProductionWaterNodes(handle, size) {
  if (!handle?.gpuFFT || handle.productionWaterNodesInstalled) return;

  const material = handle.mesh.material;
  const depthT = attribute("fftDepth", "float");

  handle.skyReflectionTint = uniform(SKY_BIAS.clone());
  handle.horizonTint = uniform(HORIZON_FALLBACK.clone());
  handle.foamVisualTint = uniform(DAY_FOAM.clone());
  handle.underwaterAmount = uniform(0.0);
  handle.waterLevelNode = uniform(handle.waterY ?? handle.mesh.position.y ?? 0);
  handle.underSurfaceTint = uniform(UNDER_SURFACE_DAY.clone());
  handle.underDeepTint = uniform(UNDER_DEEP_DAY.clone());
  handle.underGrazingTint = uniform(UNDER_GRAZING_DAY.clone());

  // Keep the actual FFT-derived normal. Extra procedural normal layers were
  // intentionally removed in the previous mobile pass after the iPhone frame
  // rate showed they were not worth the per-pixel trigonometric cost.
  const viewDir = cameraPosition.sub(positionWorld).normalize();

  // IMPORTANT underwater fix: use the absolute view/normal angle. With a
  // DoubleSide water material the camera can see the same geometry from below;
  // clamping a negative back-face dot product directly to zero made virtually
  // the whole underside look like a 100% grazing Fresnel reflection. That is the
  // source of the broad circular/oval FFT-lobe artifacts seen in testing.
  const ndv = clamp(abs(normalWorld.dot(viewDir)), 0, 1);
  const grazing = float(1).sub(ndv);
  const g2 = grazing.mul(grazing);
  const g4 = g2.mul(g2);
  const fresnel = float(0.035).add(g4.mul(grazing).mul(0.965));

  // Fade earlier than v2. At night even a thin strip of finite ocean geometry
  // reads as a black horizon wall, so the surface now merges into atmospheric
  // color well before the square plane edge becomes visible. This fade is used
  // only for ABOVE-water viewing; underwater keeps the ceiling opaque enough to
  // avoid revealing the finite plane as a bright cyan strip.
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

  // Narrow, broken shoreline foam. Night foam is deliberately dimmer so the
  // beach does not turn into one broad self-illuminated white rail. Foam is also
  // strongly suppressed from below — a diver should mostly see a moving water
  // ceiling, not the top-face shoreline mask painted through the surface.
  const shallowMask = clamp(float(0.075).sub(depthT).mul(13.3333), 0, 1);
  const foamWave = sin(
    positionWorld.x.mul(0.20)
      .add(positionWorld.z.mul(0.145))
      .add(time.mul(0.72)),
  ).mul(0.5).add(0.5);
  const foamBreakup = clamp(foamWave.sub(0.38).mul(1.62), 0, 1);
  const foamDayVisibility = mix(float(0.38), float(1.0), handle.dayAmount);
  const foamUnderVisibility = float(1).sub(handle.underwaterAmount.mul(0.90));
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

    // Slightly stronger sky/Fresnel contribution at night helps the dark water
    // retain readable wave shape while the real moon DirectionalLight supplies
    // the broken silver-blue specular path.
    const fresnelStrength = mix(float(0.78), float(0.70), handle.dayAmount);
    const skyAtAngle = mix(handle.skyReflectionTint, handle.horizonTint, horizonFade);
    const reflectedWater = mix(depthColor, skyAtAngle, fresnel.mul(fresnelStrength));

    // Far-water atmospheric match is stronger at night, eliminating the black
    // ocean/sky divider without simply brightening the entire water surface.
    const horizonStrength = mix(float(0.88), float(0.72), handle.dayAmount);
    const horizonWater = mix(reflectedWater, handle.horizonTint, horizonFade.mul(horizonStrength));
    const topWater = mix(horizonWater, handle.foamVisualTint, shoreFoam);

    // -----------------------------------------------------------------------
    // Underwater wave ceiling
    // -----------------------------------------------------------------------
    // Looking almost straight up should transmit the brightest cyan-blue light;
    // grazing angles trend toward darker total-internal-reflection color. This
    // is a cheap Snell-window approximation and avoids sampling another texture.
    const underFacing = mix(handle.underDeepTint, handle.underSurfaceTint, ndv);
    const underFresnel = mix(
      underFacing,
      handle.underGrazingTint,
      clamp(fresnel.mul(0.80), 0, 1),
    );

    // Use the REAL FFT normal slope and displaced crest height for fine wave
    // readability from below. No new sin/noise field is added: the existing GPU
    // simulation already paid for this information. Steeper facets become a bit
    // darker while crests catch a restrained amount of extra transmitted light.
    const slope = clamp(float(1).sub(abs(normalWorld.y)), 0, 1);
    const crest = clamp(
      positionWorld.y.sub(handle.waterLevelNode).mul(0.55).add(0.5),
      0,
      1,
    );
    const slopeDarkened = mix(underFresnel, handle.underDeepTint, slope.mul(0.42));
    const crestLit = mix(slopeDarkened, handle.underSurfaceTint, crest.mul(0.16));

    // Distance underwater should become atmospheric WATER color, not transparent
    // sky. This removes the flat pale strip previously exposed by opacity fading.
    const underwaterFar = mix(crestLit, handle.underDeepTint, horizonFade.mul(0.30));

    return mix(topWater, underwaterFar, handle.underwaterAmount);
  })();

  // Night water needs a broader, softer highlight than bright-day water. This
  // directly attacks the narrow vertical orange/silver streak seen in testing:
  // higher roughness broadens and lowers the standard PBR specular lobe instead
  // of layering a fake screen-space blur over it.
  const nightAmount = float(1).sub(handle.dayAmount);
  const baseRoughness = float(0.115)
    .add(handle.stormAmount.mul(0.05))
    .add(nightAmount.mul(0.075));
  const grazingRoughness = mix(float(0.078), float(0.045), handle.dayAmount);
  const topRoughness = mix(baseRoughness, grazingRoughness, fresnel);
  const underwaterRoughness = float(0.17)
    .add(handle.stormAmount.mul(0.045))
    .add(nightAmount.mul(0.035));
  material.roughnessNode = mix(topRoughness, underwaterRoughness, handle.underwaterAmount);
  material.metalnessNode = float(0.01);

  // Above water: fade almost completely before the plane edge. Underwater: keep
  // the water ceiling largely opaque so the finite plane cannot show up as the
  // bright flat cyan band seen in the previous screenshot.
  const topOpacity = mix(float(0.94), float(0.02), horizonFade);
  const underwaterOpacity = mix(float(0.90), float(0.82), horizonFade);
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

  // Keep amplitude restrained enough that the 128x128 mobile FFT surface does
  // not read as stacked horizontal ribbons at grazing view angles.
  handle.waveScale.value = 1.45;
  handle.mesh.scale.y = 1.05;

  handle.deepTint.value.copy(DEEP_BASE);
  handle.shallowTint.value.copy(SHALLOW_BASE);

  console.info("[gpu-fft-ocean] mobile production water pass v4 + underwater ceiling active");
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
  // Full underwater shading engages once the camera is roughly half a meter
  // below the nominal water level, preventing a hard pop while diving/surfacing.
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

  // Base updater still owns simulation weather uniforms, but its default palette
  // is replaced each frame with Crystal's tropical day palette.
  handle.deepTint.value.copy(DEEP_BASE);
  handle.shallowTint.value.copy(SHALLOW_BASE);

  if (skyColor?.isColor) {
    handle.deepTint.value.lerp(skyColor, 0.055);
    handle.shallowTint.value.lerp(skyColor, 0.09);
    handle.skyReflectionTint.value.copy(SKY_BIAS).lerp(skyColor, 0.58);
  } else {
    handle.skyReflectionTint.value.copy(SKY_BIAS);
  }

  // At night, force a small cool component back into the reflected sky so dark
  // clouds/sky do not collapse the whole ocean to featureless black.
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

  // Underwater palette follows the same day/night cycle but stays physically
  // restrained: bright tropical cyan by day, muted blue-gray at night.
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
