import * as THREE from "three";
import {
  Fn,
  attribute,
  cameraPosition,
  clamp,
  float,
  max,
  mix,
  normalWorld,
  positionLocal,
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

// Production visual pass layered on top of the GPU FFT simulation.
// The expensive spectral displacement stays in gpu_fft_ocean.js; this file
// adds mobile-friendly water shading without another render target or texture.
const SKY_BIAS = new THREE.Color(0xb9e7ee);
const HORIZON_FALLBACK = new THREE.Color(0x9bcfd8);
const DEEP_BASE = new THREE.Color(0x073846);
const SHALLOW_BASE = new THREE.Color(0x4fc7c5);

function installProductionWaterNodes(handle, size) {
  if (!handle?.gpuFFT || handle.productionWaterNodesInstalled) return;

  const material = handle.mesh.material;
  const baseNormalNode = material.normalNode;
  const baseColorNode = material.colorNode;
  const depthT = attribute("fftDepth", "float");

  handle.skyReflectionTint = uniform(SKY_BIAS.clone());
  handle.horizonTint = uniform(HORIZON_FALLBACK.clone());
  handle.sunVisualDirection = uniform(new THREE.Vector3(0.35, 0.88, 0.28).normalize());
  handle.sunGlintTint = uniform(new THREE.Color(0xfff4dc));
  handle.foamVisualTint = uniform(new THREE.Color(0xe9fbff));

  // Layer three cheap procedural ripple bands over the FFT normal. This fixes
  // the broad, laminated look of a 128x128 ocean mesh without increasing FFT N.
  material.normalNode = Fn(() => {
    const p = positionLocal;
    const r1 = sin(p.x.mul(0.27).add(p.z.mul(0.19)).add(time.mul(1.05)));
    const r2 = sin(p.x.mul(-0.16).add(p.z.mul(0.33)).sub(time.mul(0.82)));
    const r3 = sin(p.x.mul(0.61).sub(p.z.mul(0.54)).add(time.mul(1.55)));

    const rippleX = r1.mul(0.070).add(r3.mul(0.032));
    const rippleZ = r2.mul(0.070).sub(r3.mul(0.028));

    return vec3(
      baseNormalNode.x.add(rippleX),
      baseNormalNode.y.add(0.018),
      baseNormalNode.z.add(rippleZ),
    ).normalize();
  })();

  // True view-angle Fresnel factor. We use it both to tint toward the live sky
  // and to lower roughness at grazing angles, which gives a much stronger water
  // read while preserving the standard PBR lighting path.
  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const ndv = clamp(normalWorld.dot(viewDir), 0, 1);
  const grazing = float(1).sub(ndv);
  const grazing2 = grazing.mul(grazing);
  const grazing4 = grazing2.mul(grazing2);
  const fresnel = float(0.035).add(grazing4.mul(grazing).mul(0.965));

  // Distance-only atmospheric blend. Squared XZ distance avoids a sqrt and
  // softens the hard dark line at the far edge of the ocean plane.
  const dx = positionWorld.x.sub(cameraPosition.x);
  const dz = positionWorld.z.sub(cameraPosition.z);
  const distSq = dx.mul(dx).add(dz.mul(dz));
  const fogNear = size * 0.28;
  const fogFar = size * 0.62;
  const fogNearSq = fogNear * fogNear;
  const fogFarSq = fogFar * fogFar;
  const horizonFade = clamp(
    distSq.sub(fogNearSq).div(Math.max(1, fogFarSq - fogNearSq)),
    0,
    1,
  );

  // Fine shoreline breakup. The FFT base material already creates crest foam
  // from Jacobian compression; this adds depth-aware surf without the old solid
  // white shoreline stripe.
  const shallowMask = clamp(float(0.18).sub(depthT).mul(5.5556), 0, 1);
  const foamA = sin(positionWorld.x.mul(0.23).add(positionWorld.z.mul(0.17)).add(time.mul(0.85)));
  const foamB = sin(positionWorld.x.mul(-0.11).add(positionWorld.z.mul(0.31)).sub(time.mul(0.63)));
  const foamC = sin(positionWorld.x.mul(0.47).sub(positionWorld.z.mul(0.21)).add(time.mul(1.18)));
  const foamBreakup = clamp(
    foamA.mul(0.38).add(foamB.mul(0.34)).add(foamC.mul(0.28)).add(0.42),
    0,
    1,
  );
  const shoreFoam = shallowMask
    .mul(foamBreakup)
    .mul(float(0.50).add(handle.stormAmount.mul(0.28)));

  // Sun glitter uses a very tight, inexpensive Blinn-style lobe. We test both
  // signs of sunDir so this remains correct regardless of whether main.js passes
  // the vector toward the sun or the light's travel direction.
  const halfA = viewDir.add(handle.sunVisualDirection).normalize();
  const halfB = viewDir.sub(handle.sunVisualDirection).normalize();
  const sunDot = max(
    clamp(normalWorld.dot(halfA), 0, 1),
    clamp(normalWorld.dot(halfB), 0, 1),
  );
  const s2 = sunDot.mul(sunDot);
  const s4 = s2.mul(s2);
  const s8 = s4.mul(s4);
  const s16 = s8.mul(s8);
  const s32 = s16.mul(s16);
  const glitterNoise = sin(
    positionWorld.x.mul(0.74)
      .add(positionWorld.z.mul(0.53))
      .add(time.mul(1.9)),
  ).mul(0.5).add(0.5);
  const sparkle = s32
    .mul(glitterNoise.mul(0.55).add(0.45))
    .mul(handle.dayAmount)
    .mul(float(1).sub(handle.stormAmount.mul(0.35)));

  material.colorNode = Fn(() => {
    // Beer-Lambert-style visual approximation: shallow water stays bright and
    // tropical while deeper water loses energy and becomes darker blue-green.
    const absorption = mix(float(1.06), float(0.76), depthT);
    const depthColor = baseColorNode.mul(absorption);

    const reflectionMix = clamp(
      fresnel.mul(0.25).add(horizonFade.mul(0.75)),
      0,
      1,
    );
    const reflectedSky = mix(handle.skyReflectionTint, handle.horizonTint, reflectionMix);
    const reflectedWater = mix(depthColor, reflectedSky, fresnel.mul(0.80));

    // Atmospheric horizon fade is deliberately partial so distant water still
    // has structure instead of disappearing into a flat sky-colored strip.
    const horizonWater = mix(reflectedWater, handle.horizonTint, horizonFade.mul(0.42));
    const foamed = mix(horizonWater, handle.foamVisualTint, shoreFoam);

    return foamed.add(handle.sunGlintTint.mul(sparkle.mul(0.85)));
  })();

  material.roughnessNode = mix(
    float(0.12).add(handle.stormAmount.mul(0.055)),
    float(0.035),
    fresnel,
  );
  material.metalnessNode = float(0.015);
  material.opacity = 0.94;
  material.transparent = true;
  material.needsUpdate = true;

  handle.productionWaterNodesInstalled = true;
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle) return handle;

  installProductionWaterNodes(handle, size);

  // Keep the spectral displacement clearly visible, but below the exaggerated
  // diagnostic boost used during the earlier magenta routing test.
  handle.waveScale.value = 1.90;
  handle.mesh.scale.y = 1.18;

  // Tropical palette tuned for Crystal's shallow reef biome.
  handle.deepTint.value.copy(DEEP_BASE);
  handle.shallowTint.value.copy(SHALLOW_BASE);

  console.info("[gpu-fft-ocean] production water shading active");
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

  // Reapply the production palette after the base visual updater so the older
  // default blue colors cannot overwrite the new tropical tuning each frame.
  handle.deepTint.value.copy(DEEP_BASE);
  handle.shallowTint.value.copy(SHALLOW_BASE);
  if (skyColor?.isColor) {
    handle.deepTint.value.lerp(skyColor, 0.07);
    handle.shallowTint.value.lerp(skyColor, 0.10);
    handle.skyReflectionTint.value.copy(SKY_BIAS).lerp(skyColor, 0.62);
  } else {
    handle.skyReflectionTint.value.copy(SKY_BIAS);
  }

  if (skyHorizon?.isColor) {
    handle.horizonTint.value.copy(skyHorizon);
  } else if (skyColor?.isColor) {
    handle.horizonTint.value.copy(skyColor).lerp(HORIZON_FALLBACK, 0.28);
  } else {
    handle.horizonTint.value.copy(HORIZON_FALLBACK);
  }

  if (sunDir?.isVector3) {
    handle.sunVisualDirection.value.copy(sunDir);
    if (handle.sunVisualDirection.value.lengthSq() > 1e-8) {
      handle.sunVisualDirection.value.normalize();
    }
  }

  handle.waveScale.value = 1.90 + stormT * 0.95;
  handle.mesh.scale.y = 1.18 + Math.sin(elapsed * 0.22) * 0.025 + stormT * 0.08;
  handle.sunGlintTint.value.set(dayT > 0.15 ? 0xfff4dc : 0xbad8ff);
}

export function disposeGPUFFTOcean(scene, handle) {
  return disposeBaseOcean(scene, handle);
}
