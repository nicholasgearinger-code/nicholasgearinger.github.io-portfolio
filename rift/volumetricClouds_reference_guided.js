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
  createVolumetricClouds as createTemporalCloudsV4,
  updateVolumetricClouds as updateTemporalCloudsV4,
  disposeVolumetricClouds as disposeTemporalCloudsV4,
} from "./volumetricClouds_temporal_v4.js";

// -----------------------------------------------------------------------------
// Reference-guided physical cloud model.
//
// The old Rift sky photographs are NOT rendered as backgrounds here. Instead:
//   * sky_clouds.png contributes only low-frequency macro cloud placement;
//   * day/dusk/moon/storm photographs are sampled once at tiny resolution to
//     calibrate cloud highlight, shadow and ambient scattering colors;
//   * all visible cloud structure still comes from the real 3D density field;
//   * Sun/Moon direction still drives phase scattering and self-shadowing;
//   * weather state still controls coverage, humidity, convection and storms.
//
// The goal is to retain the photographic proportions/palette that worked in the
// old HDRI-style skies while keeping the clouds dynamic and volumetric.
// -----------------------------------------------------------------------------

const REF_URL = (name) => new URL(`./textures/${name}`, import.meta.url).href;

const REFERENCE_IMAGES = {
  macro: "sky_clouds.png",
  dayA: "sky_day_1.png",
  dayB: "sky_day_2.png",
  dusk: "sky_dusk_3.png",
  moon: "sky_moonlit_sea.png",
  storm: "sky_storm.png",
};

const DEFAULT_PALETTES = {
  day: {
    highlight: new THREE.Color(0xf7fbff),
    shadow: new THREE.Color(0x9fb4c8),
    ambient: new THREE.Color(0xb9cee0),
  },
  dusk: {
    highlight: new THREE.Color(0xffc28b),
    shadow: new THREE.Color(0x84788f),
    ambient: new THREE.Color(0xb88c9d),
  },
  night: {
    highlight: new THREE.Color(0xb8c9e4),
    shadow: new THREE.Color(0x34445e),
    ambient: new THREE.Color(0x596b86),
  },
  storm: {
    highlight: new THREE.Color(0xb7bec7),
    shadow: new THREE.Color(0x343d49),
    ambient: new THREE.Color(0x6a7581),
  },
};

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function smooth01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function clonePalette(p) {
  return {
    highlight: p.highlight.clone(),
    shadow: p.shadow.clone(),
    ambient: p.ambient.clone(),
  };
}

function blendPalette(a, b, t) {
  return {
    highlight: a.highlight.clone().lerp(b.highlight, t),
    shadow: a.shadow.clone().lerp(b.shadow, t),
    ambient: a.ambient.clone().lerp(b.ambient, t),
  };
}

function averageColors(entries, startFrac, endFrac) {
  const start = Math.max(0, Math.floor(entries.length * startFrac));
  const end = Math.min(entries.length, Math.max(start + 1, Math.ceil(entries.length * endFrac)));
  const color = new THREE.Color(0, 0, 0);
  let count = 0;
  for (let i = start; i < end; i++) {
    color.r += entries[i].r;
    color.g += entries[i].g;
    color.b += entries[i].b;
    count++;
  }
  if (count > 0) color.multiplyScalar(1 / count);
  return color;
}

async function sampleReferencePalette(filename, fallback) {
  if (typeof document === "undefined" || typeof Image === "undefined") return clonePalette(fallback);

  try {
    const image = new Image();
    image.decoding = "async";
    image.src = REF_URL(filename);
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 12;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return clonePalette(fallback);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const entries = [];

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      if (a < 0.05) continue;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
      entries.push({ r, g, b, l });
    }
    if (entries.length < 8) return clonePalette(fallback);

    entries.sort((a, b) => a.l - b.l);
    const measured = {
      shadow: averageColors(entries, 0.22, 0.43),
      ambient: averageColors(entries, 0.48, 0.69),
      highlight: averageColors(entries, 0.84, 0.97),
    };

    // Photographs calibrate the palette, but the conservative defaults prevent
    // a bright Sun pixel or very dark ocean pixel from dominating cloud color.
    return {
      highlight: fallback.highlight.clone().lerp(measured.highlight, 0.42),
      shadow: fallback.shadow.clone().lerp(measured.shadow, 0.34),
      ambient: fallback.ambient.clone().lerp(measured.ambient, 0.36),
    };
  } catch (error) {
    console.warn(`[clouds] reference palette unavailable: ${filename}`, error);
    return clonePalette(fallback);
  }
}

function averagePalette(a, b) {
  return {
    highlight: a.highlight.clone().lerp(b.highlight, 0.5),
    shadow: a.shadow.clone().lerp(b.shadow, 0.5),
    ambient: a.ambient.clone().lerp(b.ambient, 0.5),
  };
}

function loadReferencePalettes(handle) {
  handle.__riftReferencePalettes = {
    day: clonePalette(DEFAULT_PALETTES.day),
    dusk: clonePalette(DEFAULT_PALETTES.dusk),
    night: clonePalette(DEFAULT_PALETTES.night),
    storm: clonePalette(DEFAULT_PALETTES.storm),
    ready: false,
  };

  (async () => {
    // Load sequentially to avoid decoding several ~1 MB sky PNGs at once on iOS.
    const dayA = await sampleReferencePalette(REFERENCE_IMAGES.dayA, DEFAULT_PALETTES.day);
    const dayB = await sampleReferencePalette(REFERENCE_IMAGES.dayB, DEFAULT_PALETTES.day);
    const dusk = await sampleReferencePalette(REFERENCE_IMAGES.dusk, DEFAULT_PALETTES.dusk);
    const night = await sampleReferencePalette(REFERENCE_IMAGES.moon, DEFAULT_PALETTES.night);
    const storm = await sampleReferencePalette(REFERENCE_IMAGES.storm, DEFAULT_PALETTES.storm);
    if (!handle?.__riftReferencePalettes) return;

    handle.__riftReferencePalettes.day = averagePalette(dayA, dayB);
    handle.__riftReferencePalettes.dusk = dusk;
    handle.__riftReferencePalettes.night = night;
    handle.__riftReferencePalettes.storm = storm;
    handle.__riftReferencePalettes.ready = true;
    console.info("[clouds] photographic reference palettes calibrated from Rift sky textures");
  })();
}

function createMacroGuide(handle) {
  const loader = new THREE.TextureLoader();
  const guide = loader.load(
    REF_URL(REFERENCE_IMAGES.macro),
    () => {
      if (handle?.uniforms?.referenceGuideStrength) {
        handle.uniforms.referenceGuideStrength.value = 0.28;
      }
      console.info("[clouds] sky_clouds.png active as macro density guidance");
    },
    undefined,
    () => {
      if (handle?.uniforms?.referenceGuideStrength) {
        handle.uniforms.referenceGuideStrength.value = 0;
      }
    },
  );
  guide.wrapS = THREE.RepeatWrapping;
  guide.wrapT = THREE.RepeatWrapping;
  guide.minFilter = THREE.LinearFilter;
  guide.magFilter = THREE.LinearFilter;
  guide.colorSpace = THREE.NoColorSpace;
  return guide;
}

function installReferenceUniforms(handle) {
  if (!handle?.uniforms || handle.__riftReferenceUniformsInstalled) return;
  const u = handle.uniforms;
  u.referenceGuideStrength = uniform(0);
  u.referenceMacroOffset = uniform(new THREE.Vector2());
  u.referenceHighlight = uniform(DEFAULT_PALETTES.day.highlight.clone());
  u.referenceShadow = uniform(DEFAULT_PALETTES.day.shadow.clone());
  u.referenceAmbient = uniform(DEFAULT_PALETTES.day.ambient.clone());
  u.referencePaletteStrength = uniform(0.72);
  u.referenceDayAmount = uniform(1);
  u.referenceHorizonWarmth = uniform(0);
  u.referenceMoonAmount = uniform(0);
  handle.__riftReferenceUniformsInstalled = true;
}

function installReferenceGuidedShader(handle) {
  if (!handle?.material || handle.__riftReferenceGuidedShaderInstalled) return;
  installReferenceUniforms(handle);

  const u = handle.uniforms;
  const shapeTex = handle.shapeTexture;
  const weatherTex = handle.weatherTexture;
  const guideTex = handle.__riftMacroGuide;
  const RAY_STEPS = handle.quality.raySteps;
  const LIGHT_STEPS = Math.max(2, Number(handle.quality.shadowSteps) || 1);
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

    // Stable spatial jitter: temporal history sees different density intervals
    // without the obvious horizontal shelves of evenly spaced samples.
    const jitterUV = vec2(positionWorld.x, positionWorld.z)
      .mul(0.0129)
      .add(u.weatherOffset.mul(2.73))
      .fract();
    const jitterSeed = texture(weatherTex, jitterUV).g;
    const t = tStart.add(stepSize.mul(float(0.08).add(jitterSeed.mul(0.84)))).toVar();
    const transmittance = float(1).toVar();
    const scattered = vec3(0, 0, 0).toVar();

    // Dual-lobe Henyey-Greenstein approximation. The strong forward lobe creates
    // luminous cloud edges around the Sun/Moon; the weak backward lobe prevents
    // the opposite side of the sky from looking dead and flat.
    const mu = clamp(dot(rayDir, u.sunDir), -1, 1);
    const forwardDenom = float(1.4225).sub(mu.mul(1.30)).max(0.045);
    const backwardDenom = float(1.04).add(mu.mul(0.40)).max(0.08);
    const phaseForward = float(0.5775).div(pow(forwardDenom, 1.5));
    const phaseBackward = float(0.96).div(pow(backwardDenom, 1.5));
    const phase = phaseForward.mul(0.78).add(phaseBackward.mul(0.22)).mul(0.34).add(0.10);

    Loop(RAY_STEPS, () => {
      const pos = rayOrigin.add(rayDir.mul(t));
      const height01 = clamp(
        pos.y.sub(u.cloudBaseY).div(u.cloudTopY.sub(u.cloudBaseY).max(1)),
        0,
        1,
      );

      const weatherUV = vec2(pos.x, pos.z)
        .mul(WEATHER_SCALE)
        .add(u.weatherOffset)
        .fract();
      const weatherSample = texture(weatherTex, weatherUV);

      // The old photographic cloud layer is used only as a broad organization
      // field. Two differently oriented samples keep it from becoming a repeated
      // photograph while preserving its realistic spacing and cluster scales.
      const macroUV = vec2(pos.x, pos.z)
        .mul(MACRO_SCALE)
        .add(u.referenceMacroOffset)
        .fract();
      const guideA = texture(guideTex, macroUV);
      const guideB = texture(
        guideTex,
        vec2(macroUV.y.negate(), macroUV.x).mul(0.73).add(vec2(0.37, 0.19)).fract(),
      );
      const guideLumA = dot(guideA.rgb, vec3(0.299, 0.587, 0.114)).mul(guideA.a);
      const guideLumB = dot(guideB.rgb, vec3(0.299, 0.587, 0.114)).mul(guideB.a);
      const guideField = mix(guideLumA, guideLumB, 0.34);
      const macroField = mix(weatherSample.r, guideField, u.referenceGuideStrength);

      const coverageThreshold = float(1).sub(u.coverage);
      const coverageMask = smoothstep(
        coverageThreshold.sub(0.12),
        coverageThreshold.add(0.15),
        macroField,
      );

      // Meteorological profiles: fair-weather cumulus, flatter stratiform cloud
      // and deep storm towers. Weather smoothly blends between the three rather
      // than vertically stretching one generic cloud shape for every condition.
      const convectiveLocal = mix(float(0.35), float(1.15), weatherSample.g)
        .mul(u.convection);
      const cumulusBase = smoothstep(float(0.012), float(0.075), height01);
      const cumulusTopStart = mix(float(0.58), float(0.84), convectiveLocal);
      const cumulusTop = float(1).sub(smoothstep(cumulusTopStart, float(0.995), height01));
      const cumulusProfile = cumulusBase.mul(cumulusTop);

      const stratusBase = smoothstep(float(0.008), float(0.045), height01);
      const stratusTop = float(1).sub(smoothstep(float(0.48), float(0.76), height01));
      const stratusProfile = stratusBase.mul(stratusTop);

      const stormBase = smoothstep(float(0.004), float(0.038), height01);
      const stormTop = float(1).sub(smoothstep(float(0.83), float(0.998), height01));
      const stormProfile = stormBase.mul(stormTop);

      const overcastWeight = clamp(u.coverage.mul(float(1).sub(u.convection.mul(0.55))).mul(0.72), 0, 0.62);
      const fairProfile = mix(cumulusProfile, stratusProfile, overcastWeight);
      const verticalProfile = mix(fairProfile, stormProfile, u.stormDarken.mul(0.86));

      const baseShapeUV = pos.mul(TILE_SCALE).add(u.scrollOffset).fract();
      const shape = texture3D(shapeTex, baseShapeUV);
      const detailShape = texture3D(
        shapeTex,
        baseShapeUV.mul(1.91).add(vec3(0.17, 0.31, 0.09)).fract(),
      );

      // Broad Perlin/Worley mass with higher-frequency erosion only near edges.
      // This gives cauliflower lobes without turning the entire body into noise.
      const baseThreshold = mix(float(0.66), float(0.42), u.density);
      const broadMass = smoothstep(baseThreshold, baseThreshold.add(0.26), shape.r);
      const edgeAmount = float(1).sub(broadMass).mul(broadMass).mul(4.0);
      const erosionStrength = u.erosion.mul(mix(float(0.34), float(0.14), u.stormDarken));
      const erodedMass = clamp(
        broadMass
          .sub(detailShape.g.mul(erosionStrength).mul(edgeAmount))
          .add(detailShape.b.mul(0.055).mul(edgeAmount)),
        0,
        1,
      );

      const moistureBoost = mix(
        float(0.78),
        float(1.18),
        u.humidity.mul(weatherSample.b),
      );
      const localDensity = erodedMass
        .mul(coverageMask)
        .mul(verticalProfile)
        .mul(moistureBoost)
        .mul(u.density);

      // Self-shadow against approximately the SAME final density field instead
      // of raw shape noise. This is the key difference between a dark blob and a
      // cloud whose Sun-facing edge/tops are actually illuminated.
      const opticalDepthToLight = float(0).toVar();
      Loop(LIGHT_STEPS, ({ i }) => {
        const shadowDist = float(10).mul(float(i).add(1));
        const shadowPos = pos.add(u.sunDir.mul(shadowDist));
        const shadowHeight = clamp(
          shadowPos.y.sub(u.cloudBaseY).div(u.cloudTopY.sub(u.cloudBaseY).max(1)),
          0,
          1,
        );
        const shadowWeatherUV = vec2(shadowPos.x, shadowPos.z)
          .mul(WEATHER_SCALE)
          .add(u.weatherOffset)
          .fract();
        const shadowWeather = texture(weatherTex, shadowWeatherUV);
        const shadowMacroUV = vec2(shadowPos.x, shadowPos.z)
          .mul(MACRO_SCALE)
          .add(u.referenceMacroOffset)
          .fract();
        const shadowGuide = texture(guideTex, shadowMacroUV);
        const shadowGuideLum = dot(shadowGuide.rgb, vec3(0.299, 0.587, 0.114)).mul(shadowGuide.a);
        const shadowField = mix(shadowWeather.r, shadowGuideLum, u.referenceGuideStrength);
        const shadowCoverage = smoothstep(
          coverageThreshold.sub(0.12),
          coverageThreshold.add(0.15),
          shadowField,
        );
        const shadowShape = texture3D(
          shapeTex,
          shadowPos.mul(TILE_SCALE).add(u.scrollOffset).fract(),
        );
        const shadowMass = smoothstep(baseThreshold, baseThreshold.add(0.27), shadowShape.r);
        const shadowBase = smoothstep(float(0.01), float(0.065), shadowHeight);
        const shadowTop = float(1).sub(smoothstep(float(0.70), float(0.995), shadowHeight));
        const shadowProfile = mix(shadowBase.mul(shadowTop), stormProfile, u.stormDarken.mul(0.55));
        const shadowDensity = shadowMass
          .mul(shadowCoverage)
          .mul(shadowProfile)
          .mul(u.density);
        opticalDepthToLight.addAssign(shadowDensity.mul(0.72));
      });

      const directVisibility = exp(opticalDepthToLight.mul(-0.58));
      // A non-zero scattering floor approximates higher-order multiple bounce;
      // cloud interiors should be gray/blue, not black, even when direct Sun is
      // heavily attenuated.
      const multipleScatter = float(0.20).add(directVisibility.mul(0.80));
      const powder = float(1).sub(exp(localDensity.mul(-2.2)));

      const refStrength = u.referencePaletteStrength;
      const cloudHighlight = mix(u.sunColor, u.referenceHighlight, refStrength.mul(0.58));
      const cloudAmbient = mix(u.ambientColor, u.referenceAmbient, refStrength.mul(0.52));
      const cloudShadow = mix(u.ambientColor.mul(0.62), u.referenceShadow, refStrength.mul(0.74));

      const underside = smoothstep(float(0.04), float(0.58), height01);
      const interior = mix(cloudShadow, cloudAmbient, underside.mul(0.72).add(powder.mul(0.18)));
      const direct = cloudHighlight
        .mul(phase)
        .mul(multipleScatter)
        .mul(float(0.72).add(underside.mul(0.42)));
      const silver = cloudHighlight
        .mul(pow(float(1).sub(erodedMass), 2.2))
        .mul(phase)
        .mul(0.42)
        .mul(float(1).sub(u.stormDarken.mul(0.62)));

      let sampleLight = interior.add(direct).add(silver);
      sampleLight = mix(sampleLight, u.referenceShadow.mul(0.72), u.stormDarken.mul(0.62));
      const flash = u.lightningColor
        .mul(u.lightningFlash)
        .mul(float(0.72).add(localDensity.mul(0.95)));

      const extinctionScale = mix(float(0.038), float(0.072), u.stormDarken);
      const sampleAlpha = float(1).sub(
        exp(localDensity.mul(stepSize).mul(extinctionScale).negate()),
      );
      scattered.addAssign(sampleLight.add(flash).mul(sampleAlpha).mul(transmittance));
      transmittance.mulAssign(float(1).sub(sampleAlpha));
      t.addAssign(stepSize);
    });

    const horizonFade = smoothstep(float(0.014), float(0.080), rayDir.y.abs());
    const alpha = float(1).sub(transmittance)
      .mul(signedY.abs())
      .mul(horizonFade);
    return vec4(scattered, alpha);
  })();

  handle.material.needsUpdate = true;
  handle.__riftReferenceGuidedShaderInstalled = true;

  globalThis.__riftReferenceCloudDebug = {
    active: true,
    raySteps: RAY_STEPS,
    lightSteps: LIGHT_STEPS,
    macroReference: REFERENCE_IMAGES.macro,
    visiblePhotographicBackdrop: false,
  };

  console.info(`[clouds] reference-guided physical shader active (${RAY_STEPS} view / ${LIGHT_STEPS} light samples)`);
}

function updateReferencePalette(handle, sunDirection, rainIntensity, windX, windZ, dt) {
  if (!handle?.uniforms || !handle.__riftReferencePalettes) return;
  const palettes = handle.__riftReferencePalettes;
  const u = handle.uniforms;
  const sunY = clamp01((Number(sunDirection?.y) || 0) * 0.5 + 0.5) * 2 - 1;
  const daylight = smooth01((sunY + 0.08) / 0.32);
  const horizonWarmth = smooth01(1 - Math.abs(sunY) / 0.34) * smooth01((sunY + 0.12) / 0.18);
  const nightAmount = smooth01((-sunY + 0.02) / 0.22);
  const storm = clamp01(globalThis.__riftProceduralWeatherState?.stormIntensity ?? rainIntensity);

  let palette = blendPalette(palettes.night, palettes.day, daylight);
  palette = blendPalette(palette, palettes.dusk, horizonWarmth * (1 - nightAmount * 0.45));
  palette = blendPalette(palette, palettes.storm, storm * 0.78);

  u.referenceHighlight.value.copy(palette.highlight);
  u.referenceShadow.value.copy(palette.shadow);
  u.referenceAmbient.value.copy(palette.ambient);
  u.referenceDayAmount.value = daylight;
  u.referenceHorizonWarmth.value = horizonWarmth;
  u.referenceMoonAmount.value = nightAmount;
  u.referencePaletteStrength.value = palettes.ready ? 0.78 : 0.58;

  const safeDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
  handle.__riftReferenceMacroX = (handle.__riftReferenceMacroX || 0) + (windX + 0.19) * safeDt * 0.000035;
  handle.__riftReferenceMacroY = (handle.__riftReferenceMacroY || 0) + (windZ + 0.07) * safeDt * 0.000028;
  u.referenceMacroOffset.value.set(handle.__riftReferenceMacroX, handle.__riftReferenceMacroY);

  if (globalThis.__riftReferenceCloudDebug) {
    globalThis.__riftReferenceCloudDebug.paletteReady = palettes.ready;
    globalThis.__riftReferenceCloudDebug.daylight = daylight;
    globalThis.__riftReferenceCloudDebug.horizonWarmth = horizonWarmth;
    globalThis.__riftReferenceCloudDebug.storm = storm;
  }
}

export function createVolumetricClouds(scene) {
  const handle = createTemporalCloudsV4(scene);
  if (!handle) return handle;

  installReferenceUniforms(handle);
  handle.__riftMacroGuide = createMacroGuide(handle);
  loadReferencePalettes(handle);
  handle.__riftReferenceGuidedShaderInstalled = false;
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
  updateTemporalCloudsV4(
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
  installReferenceGuidedShader(handle);
  updateReferencePalette(handle, sunDirection, rainIntensity, windX, windZ, dt);
}

export function disposeVolumetricClouds(handle) {
  handle?.__riftMacroGuide?.dispose?.();
  if (handle) {
    handle.__riftReferencePalettes = null;
    handle.__riftMacroGuide = null;
  }
  delete globalThis.__riftReferenceCloudDebug;
  return disposeTemporalCloudsV4(handle);
}
