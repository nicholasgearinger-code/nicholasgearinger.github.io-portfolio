import * as THREE from "three";
import {
  Fn,
  uniform,
  vec2,
  vec3,
  vec4,
  float,
  texture,
  texture3D,
  dot,
  mix,
  clamp,
  pow,
  exp,
  normalize,
  smoothstep,
  Loop,
  positionWorld,
  cameraPosition,
  max as tslMax,
  min as tslMin,
} from "three/tsl";
import {
  createVolumetricClouds as createReferenceClouds,
  updateVolumetricClouds as updateReferenceClouds,
  disposeVolumetricClouds as disposeReferenceClouds,
} from "./volumetricClouds_reference_guided.js";
import { createPerlinWorleyCloudVolumes } from "./cloudNoisePerlinWorley.js";

// -----------------------------------------------------------------------------
// Live WebGPU/TSL Perlin-Worley volumetric cloud renderer.
//
// Rift's renderer is WebGPU, so this TSL shader is the production equivalent of
// the GLSL raymarch shader stored in shaders/clouds_perlin_worley.frag.glsl.
// Three compiles these nodes to WGSL. The algorithm is intentionally the same:
//   * true 3D Perlin-Worley broad density
//   * separate high-frequency 3D Worley erosion
//   * weather-map coverage and cloud-type height profiles
//   * Beer-Lambert extinction
//   * dual-lobe HG phase scattering
//   * light-direction density march for Sun/Moon self-shadowing
//   * powder/multiple-scattering approximation
//   * temporal accumulation remains owned by the existing temporal wrapper
// -----------------------------------------------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function qualityFor(handle) {
  const inherited = Number(handle?.quality?.raySteps) || 8;
  if (inherited <= 8) {
    return { viewSteps: 10, lightSteps: 2, baseSize: 32, detailSize: 24, detailScale: 3.15 };
  }
  if (inherited <= 12) {
    return { viewSteps: 14, lightSteps: 3, baseSize: 40, detailSize: 28, detailScale: 3.35 };
  }
  return { viewSteps: 20, lightSteps: 4, baseSize: 48, detailSize: 32, detailScale: 3.55 };
}

function installPerlinWorleyUniforms(handle) {
  if (!handle?.uniforms || handle.__riftPWUniformsInstalled) return;
  const u = handle.uniforms;
  u.pwBaseScale = uniform(1.0);
  u.pwDetailScale = uniform(3.15);
  u.pwErosion = uniform(0.42);
  u.pwDensityBias = uniform(0.0);
  u.pwMultipleScatter = uniform(0.26);
  u.pwLightExtinction = uniform(0.62);
  handle.__riftPWUniformsInstalled = true;
}

function installPerlinWorleyShader(handle) {
  if (!handle?.material || !handle.__riftPWVolumes || handle.__riftPWShaderInstalled) return;
  installPerlinWorleyUniforms(handle);

  const u = handle.uniforms;
  const baseTex = handle.__riftPWVolumes.baseTexture;
  const detailTex = handle.__riftPWVolumes.detailTexture;
  const weatherTex = handle.weatherTexture;
  const guideTex = handle.__riftMacroGuide;
  const config = handle.__riftPWQuality;
  const RAY_STEPS = config.viewSteps;
  const LIGHT_STEPS = config.lightSteps;
  const TILE_SCALE = float(handle.quality.tileScale);
  const WEATHER_SCALE = float(handle.quality.weatherScale);
  const MAX_DISTANCE = float(handle.quality.maxRayDistance);
  const MACRO_SCALE = float(0.00072);

  handle.material.colorNode = Fn(() => {
    const rayOrigin = cameraPosition;
    const rayDir = normalize(positionWorld.sub(cameraPosition));
    const safeY = rayDir.y.abs().max(0.001);
    const signedY = rayDir.y.div(safeY);
    const t0Raw = u.cloudBaseY.sub(rayOrigin.y).div(rayDir.y);
    const t1Raw = u.cloudTopY.sub(rayOrigin.y).div(rayDir.y);
    const tNear = tslMin(t0Raw, t1Raw);
    const tFar = tslMax(t0Raw, t1Raw);
    const tStart = tslMax(tNear, float(0));
    const tEnd = tslMin(tFar, tStart.add(MAX_DISTANCE));
    const marchLength = tslMax(tEnd.sub(tStart), float(0));
    const stepSize = marchLength.div(RAY_STEPS).toVar();

    const jitterUV = vec2(positionWorld.x, positionWorld.z)
      .mul(0.0137)
      .add(u.weatherOffset.mul(2.37))
      .fract();
    const jitterSeed = texture(weatherTex, jitterUV).g;
    const t = tStart.add(stepSize.mul(float(0.06).add(jitterSeed.mul(0.88)))).toVar();
    const transmittance = float(1).toVar();
    const scattered = vec3(0, 0, 0).toVar();

    // Dual-lobe Henyey-Greenstein approximation. g≈0.65 forward + weak -0.2
    // backward lobe gives bright solar edges without making the opposite sky dead.
    const mu = clamp(dot(rayDir, u.sunDir), -1, 1);
    const forwardDenom = float(1.4225).sub(mu.mul(1.30)).max(0.045);
    const backwardDenom = float(1.04).add(mu.mul(0.40)).max(0.08);
    const phaseForward = float(0.5775).div(pow(forwardDenom, 1.5));
    const phaseBackward = float(0.96).div(pow(backwardDenom, 1.5));
    const phase = phaseForward.mul(0.80).add(phaseBackward.mul(0.20)).mul(0.33).add(0.10);

    Loop(RAY_STEPS, () => {
      const pos = rayOrigin.add(rayDir.mul(t));
      const layerThickness = u.cloudTopY.sub(u.cloudBaseY).max(1);
      const height01 = clamp(pos.y.sub(u.cloudBaseY).div(layerThickness), 0, 1);

      const weatherUV = vec2(pos.x, pos.z)
        .mul(WEATHER_SCALE)
        .add(u.weatherOffset)
        .fract();
      const weatherSample = texture(weatherTex, weatherUV);

      // Reference photo is only a very low-strength macro bias. Procedural weather
      // remains authoritative so no photographic repetition is visible.
      const macroUV = vec2(pos.x, pos.z)
        .mul(MACRO_SCALE)
        .add(u.referenceMacroOffset)
        .fract();
      const guide = texture(guideTex, macroUV);
      const guideLum = dot(guide.rgb, vec3(0.299, 0.587, 0.114)).mul(guide.a);
      const macroField = mix(weatherSample.r, guideLum, u.referenceGuideStrength);
      const coverageThreshold = float(1).sub(u.coverage);
      const coverageMask = smoothstep(
        coverageThreshold.sub(0.14),
        coverageThreshold.add(0.16),
        macroField,
      );

      // Distinct meteorological height profiles.
      const convectiveLocal = mix(float(0.30), float(1.18), weatherSample.g)
        .mul(u.convection);
      const cumulusBase = smoothstep(float(0.010), float(0.070), height01);
      const cumulusTopStart = mix(float(0.56), float(0.86), convectiveLocal);
      const cumulusTop = float(1).sub(smoothstep(cumulusTopStart, float(0.995), height01));
      const cumulusProfile = cumulusBase.mul(cumulusTop);

      const stratusBase = smoothstep(float(0.006), float(0.038), height01);
      const stratusTop = float(1).sub(smoothstep(float(0.38), float(0.67), height01));
      const stratusProfile = stratusBase.mul(stratusTop);

      const stormBase = smoothstep(float(0.004), float(0.032), height01);
      const stormTop = float(1).sub(smoothstep(float(0.88), float(0.999), height01));
      const stormProfile = stormBase.mul(stormTop);

      const stratiformWeight = clamp(
        u.coverage.mul(float(1).sub(u.convection.mul(0.62))).mul(0.62),
        0,
        0.55,
      );
      const fairProfile = mix(cumulusProfile, stratusProfile, stratiformWeight);
      const verticalProfile = mix(fairProfile, stormProfile, u.stormDarken.mul(0.90));

      // True Perlin-Worley mass. R is the remapped Perlin-Worley channel; GBA
      // carry Worley octaves useful for preserving cellular structure.
      const baseUV = pos
        .mul(TILE_SCALE.mul(u.pwBaseScale))
        .add(u.scrollOffset)
        .fract();
      const baseNoise = texture3D(baseTex, baseUV);
      const worleyFbm = baseNoise.g.mul(0.625)
        .add(baseNoise.b.mul(0.25))
        .add(baseNoise.a.mul(0.125));

      // High-frequency 3D detail is advected slightly faster than the broad mass,
      // creating real edge evolution rather than translating one frozen texture.
      const detailUV = pos
        .mul(TILE_SCALE.mul(u.pwDetailScale))
        .add(u.scrollOffset.mul(1.73))
        .add(vec3(0.17, 0.31, 0.09))
        .fract();
      const detailNoise = texture3D(detailTex, detailUV);
      const detailFbm = detailNoise.r.mul(0.625)
        .add(detailNoise.g.mul(0.25))
        .add(detailNoise.b.mul(0.125));

      const densityThreshold = mix(float(0.60), float(0.33), u.density)
        .add(u.pwDensityBias);
      const broadMass = smoothstep(
        densityThreshold,
        densityThreshold.add(0.24),
        baseNoise.r.mul(0.82).add(worleyFbm.mul(0.18)),
      );

      // Erode primarily at cloud boundaries. Dense cores stay smooth and solid;
      // edges get the cauliflower breakup expected from real cumulus.
      const edgeBand = float(1).sub(broadMass).mul(broadMass).mul(4.0);
      const erosionSignal = float(1).sub(detailFbm);
      const erosionStrength = u.pwErosion
        .mul(u.erosion)
        .mul(mix(float(1.0), float(0.54), u.stormDarken));
      const shapedMass = clamp(
        broadMass.sub(erosionSignal.mul(erosionStrength).mul(edgeBand)),
        0,
        1,
      );

      const moistureBoost = mix(
        float(0.76),
        float(1.20),
        u.humidity.mul(weatherSample.b),
      );
      const localDensity = shapedMass
        .mul(coverageMask)
        .mul(verticalProfile)
        .mul(moistureBoost)
        .mul(u.density);

      // Directional optical-depth march. For performance the light path samples
      // broad Perlin-Worley density (not high-frequency erosion), but it uses the
      // same weather coverage and vertical slab as the visible density.
      const opticalDepth = float(0).toVar();
      Loop(LIGHT_STEPS, ({ i }) => {
        const lightDistance = float(12).mul(float(i).add(1));
        const lp = pos.add(u.sunDir.mul(lightDistance));
        const lh = clamp(lp.y.sub(u.cloudBaseY).div(layerThickness), 0, 1);
        const lwuv = vec2(lp.x, lp.z)
          .mul(WEATHER_SCALE)
          .add(u.weatherOffset)
          .fract();
        const lw = texture(weatherTex, lwuv);
        const lc = smoothstep(
          coverageThreshold.sub(0.14),
          coverageThreshold.add(0.16),
          lw.r,
        );
        const lbase = texture3D(
          baseTex,
          lp.mul(TILE_SCALE.mul(u.pwBaseScale)).add(u.scrollOffset).fract(),
        );
        const lmass = smoothstep(
          densityThreshold,
          densityThreshold.add(0.25),
          lbase.r,
        );
        const lbaseFade = smoothstep(float(0.008), float(0.060), lh);
        const ltopFade = float(1).sub(smoothstep(float(0.70), float(0.995), lh));
        const lprofile = mix(lbaseFade.mul(ltopFade), stormProfile, u.stormDarken.mul(0.58));
        opticalDepth.addAssign(lmass.mul(lc).mul(lprofile).mul(u.density));
      });

      const directVisibility = exp(opticalDepth.mul(u.pwLightExtinction).negate());
      const powder = float(1).sub(exp(localDensity.mul(-2.45)));
      const multi = u.pwMultipleScatter.add(directVisibility.mul(float(1).sub(u.pwMultipleScatter)));

      const refStrength = u.referencePaletteStrength;
      const highlight = mix(u.sunColor, u.referenceHighlight, refStrength.mul(0.46));
      const ambient = mix(u.ambientColor, u.referenceAmbient, refStrength.mul(0.40));
      const shadow = mix(u.ambientColor.mul(0.72), u.referenceShadow, refStrength.mul(0.50));

      const heightLight = smoothstep(float(0.05), float(0.72), height01);
      const interior = mix(shadow, ambient, heightLight.mul(0.70).add(powder.mul(0.18)));
      const direct = highlight
        .mul(phase)
        .mul(multi)
        .mul(float(0.74).add(heightLight.mul(0.40)));
      const silver = highlight
        .mul(pow(float(1).sub(shapedMass), 2.35))
        .mul(phase)
        .mul(0.36)
        .mul(float(1).sub(u.stormDarken.mul(0.64)));

      let sampleLight = interior.add(direct).add(silver);
      sampleLight = mix(sampleLight, shadow.mul(0.82), u.stormDarken.mul(0.58));
      const flash = u.lightningColor
        .mul(u.lightningFlash)
        .mul(float(0.7).add(localDensity.mul(1.15)));

      const extinction = mix(float(0.036), float(0.070), u.stormDarken);
      const sampleAlpha = float(1).sub(
        exp(localDensity.mul(stepSize).mul(extinction).negate()),
      );
      scattered.addAssign(sampleLight.add(flash).mul(sampleAlpha).mul(transmittance));
      transmittance.mulAssign(float(1).sub(sampleAlpha));
      t.addAssign(stepSize);
    });

    const horizonFade = smoothstep(float(0.012), float(0.072), rayDir.y.abs());
    const alpha = float(1).sub(transmittance)
      .mul(signedY.abs())
      .mul(horizonFade);
    return vec4(scattered, alpha);
  })();

  handle.material.needsUpdate = true;
  handle.__riftPWShaderInstalled = true;

  if (handle.__riftOriginalShapeTexture && handle.__riftOriginalShapeTexture !== handle.__riftPWVolumes.baseTexture) {
    handle.__riftOriginalShapeTexture.dispose?.();
    handle.__riftOriginalShapeTexture = null;
  }

  globalThis.__riftPerlinWorleyCloudDebug = {
    active: true,
    viewSteps: RAY_STEPS,
    lightSteps: LIGHT_STEPS,
    baseVolume: handle.__riftPWVolumes.baseSize,
    detailVolume: handle.__riftPWVolumes.detailSize,
    backend: "TSL->WGSL/WebGPU",
  };

  console.info(`[clouds] Perlin-Worley WebGPU raymarch active (${RAY_STEPS} view / ${LIGHT_STEPS} light samples)`);
}

function rebalanceForPerlinWorley(handle, rainIntensity) {
  const u = handle?.uniforms;
  if (!u) return;
  const state = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(state?.stormIntensity ?? rainIntensity);

  // True Perlin-Worley already creates coherent masses, so it needs less forced
  // coverage than the previous procedural texture did.
  if (u.referenceGuideStrength) {
    u.referenceGuideStrength.value = Math.min(
      Number(u.referenceGuideStrength.value) || 0,
      THREE.MathUtils.lerp(0.045, 0.075, storm),
    );
  }
  if (u.coverage) {
    u.coverage.value = clamp01(Math.max(Number(u.coverage.value) || 0, THREE.MathUtils.lerp(0.44, 0.76, storm)));
  }
  if (u.density) {
    u.density.value = clamp01(Math.max(Number(u.density.value) || 0, THREE.MathUtils.lerp(0.43, 0.72, storm)));
  }
  if (u.humidity) {
    u.humidity.value = clamp01(Math.max(Number(u.humidity.value) || 0, THREE.MathUtils.lerp(0.54, 0.84, storm)));
  }
  if (u.erosion) {
    u.erosion.value = Math.min(Number(u.erosion.value) || 0.7, THREE.MathUtils.lerp(0.52, 0.30, storm));
  }

  if (u.pwErosion) u.pwErosion.value = THREE.MathUtils.lerp(0.44, 0.30, storm);
  if (u.pwMultipleScatter) u.pwMultipleScatter.value = THREE.MathUtils.lerp(0.30, 0.22, storm);
  if (u.pwLightExtinction) u.pwLightExtinction.value = THREE.MathUtils.lerp(0.58, 0.72, storm);

  // Keep photographic colors as a subtle calibration only.
  if (u.referencePaletteStrength) {
    u.referencePaletteStrength.value = THREE.MathUtils.lerp(0.42, 0.55, storm);
  }
}

export function createVolumetricClouds(scene) {
  const handle = createReferenceClouds(scene);
  if (!handle) return handle;

  const config = qualityFor(handle);
  handle.__riftPWQuality = config;
  handle.__riftOriginalShapeTexture = handle.shapeTexture;
  handle.__riftPWVolumes = createPerlinWorleyCloudVolumes({
    baseSize: config.baseSize,
    detailSize: config.detailSize,
  });
  handle.shapeTexture = handle.__riftPWVolumes.baseTexture;

  // The reference shader installs on first update and sees the new base texture;
  // our production PW shader then replaces it in the same update.
  handle.quality.raySteps = config.viewSteps;
  handle.quality.shadowSteps = config.lightSteps;
  installPerlinWorleyUniforms(handle);
  handle.uniforms.pwDetailScale.value = config.detailScale;
  handle.__riftPWShaderInstalled = false;
  return handle;
}

export function updateVolumetricClouds(
  handle,
  dt,
  camera,
  sunDirection,
  sunColor,
  ambientColor,
  lightningFlash,
  lightningColor,
  windX = 0,
  windZ = 0,
  rainIntensity = 0,
  currentBiome = "default",
) {
  updateReferenceClouds(
    handle,
    dt,
    camera,
    sunDirection,
    sunColor,
    ambientColor,
    lightningFlash,
    lightningColor,
    windX,
    windZ,
    rainIntensity,
    currentBiome,
  );

  if (!handle) return;
  installPerlinWorleyShader(handle);
  rebalanceForPerlinWorley(handle, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  const detail = handle?.__riftPWVolumes?.detailTexture;
  // Base volume becomes handle.shapeTexture and is disposed by the preserved
  // cloud disposer. Dispose only the extra detail volume here.
  detail?.dispose?.();
  if (handle) {
    handle.__riftPWVolumes = null;
    handle.__riftPWQuality = null;
  }
  delete globalThis.__riftPerlinWorleyCloudDebug;
  return disposeReferenceClouds(handle);
}
