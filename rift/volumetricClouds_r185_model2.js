import * as THREE from "three";
import {
  Fn,
  If,
  Loop,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  mix,
  normalize,
  positionWorld,
  pow,
  smoothstep,
  texture,
  texture3D,
  uniform,
  vec2,
  vec3,
  vec4,
  max as tslMax,
  min as tslMin,
} from "three/tsl";
import {
  createVolumetricClouds as createTemporalClouds,
  updateVolumetricClouds as updateTemporalClouds,
  disposeVolumetricClouds as disposeTemporalClouds,
} from "./volumetricClouds_temporal_v4.js";
import { createPerlinWorleyCloudVolumes } from "./cloudNoisePerlinWorley.js";
import { createRiftCloudWeatherPair } from "./cloudWeatherModel2.js";
import { createRiftCloudShadowMap } from "./cloudShadowModel2.js";
import {
  installRiftCloudTAAU,
  syncRiftCloudTAAU,
  disposeRiftCloudTAAU,
} from "./cloudTAAUModel2.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 2.0 — r185-native volumetric atmosphere.
//
// Design goals:
//   * meteorological weather map controls coverage/type/humidity/storm potential,
//     never a stamped cloud silhouette or per-column top height;
//   * true 3D Perlin-Worley broad mass + independent Worley erosion volume;
//   * distinct stratocumulus, fair-weather cumulus and towering-cumulus height
//     profiles blended continuously by the weather field;
//   * height-dependent convection/domain warp creates cauliflower crowns without
//     stretching every noise cell into a vertical cylinder;
//   * erosion is concentrated at cloud boundaries so dense cores survive;
//   * adaptive empty-space stepping spends ray samples inside visible cloud;
//   * Beer-Lambert Sun march + three-order scattering approximation + cool sky
//     ambient gives white crowns, gray-blue interiors and darker undersides;
//   * r185 TAAU reconstructs a low-resolution cloud pass to full resolution;
//   * a coarse 128x128 cloud-shadow map updates at ~8 Hz for terrain/ocean use.
// -----------------------------------------------------------------------------

const TAU = Math.PI * 2;

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function qualityForModel2(handle) {
  const inherited = Number(handle?.quality?.raySteps) || 8;
  if (inherited <= 8) {
    return {
      label: "mobile-low",
      renderScale: 0.33,
      viewSteps: 18,
      lightSteps: 3,
      baseSize: 48,
      detailSize: 28,
      weatherSize: 192,
      shadowSize: 128,
    };
  }
  if (inherited <= 12) {
    return {
      label: "medium",
      renderScale: 0.40,
      viewSteps: 22,
      lightSteps: 3,
      baseSize: 56,
      detailSize: 32,
      weatherSize: 224,
      shadowSize: 128,
    };
  }
  return {
    label: "high",
    renderScale: 0.50,
    viewSteps: 28,
    lightSteps: 4,
    baseSize: 64,
    detailSize: 32,
    weatherSize: 256,
    shadowSize: 160,
  };
}

function installModel2Uniforms(handle) {
  if (!handle?.uniforms || handle.__riftModel2UniformsInstalled) return;
  const u = handle.uniforms;

  u.m2WeatherOffsetA = uniform(new THREE.Vector2());
  u.m2WeatherOffsetB = uniform(new THREE.Vector2());
  u.m2WeatherBlend = uniform(0);
  u.m2BaseOffset = uniform(new THREE.Vector3());
  u.m2DetailOffset = uniform(new THREE.Vector3());
  u.m2WarpOffset = uniform(new THREE.Vector3());
  u.m2Time = uniform(0);

  u.m2BaseScale = uniform(0.50);
  u.m2DetailScale = uniform(6.1);
  u.m2DomainWarp = uniform(0.072);
  u.m2EdgeErosion = uniform(0.48);
  u.m2DensityBias = uniform(-0.045);
  u.m2DensityScale = uniform(1.05);
  u.m2LightExtinction = uniform(0.66);
  u.m2MultiScatter = uniform(0.24);
  u.m2AmbientStrength = uniform(0.58);
  u.m2SilverStrength = uniform(0.42);

  handle.__riftModel2UniformsInstalled = true;
}

function installModel2Shader(handle) {
  if (
    !handle?.material ||
    !handle?.__riftModel2Volumes?.baseTexture ||
    !handle?.__riftModel2Volumes?.detailTexture ||
    !handle?.__riftModel2WeatherPair?.a ||
    !handle?.__riftModel2WeatherPair?.b ||
    handle.__riftModel2ShaderInstalled
  ) return;

  installModel2Uniforms(handle);

  const u = handle.uniforms;
  const baseTex = handle.__riftModel2Volumes.baseTexture;
  const detailTex = handle.__riftModel2Volumes.detailTexture;
  const weatherA = handle.__riftModel2WeatherPair.a;
  const weatherB = handle.__riftModel2WeatherPair.b;
  const config = handle.__riftModel2Quality;

  const RAY_STEPS = config.viewSteps;
  const LIGHT_STEPS = config.lightSteps;
  const TILE_SCALE = float(handle.quality.tileScale);
  // Broader than the original procedural weather field. The map describes
  // synoptic/mesoscale conditions, while 3D noise makes the visible silhouette.
  const WEATHER_SCALE = float(handle.quality.weatherScale * 0.72);
  const WEATHER_TEXEL = float(1 / config.weatherSize);
  const MAX_DISTANCE = float(handle.quality.maxRayDistance);

  const sampleWeather5 = (tex, uvNode) => {
    const dx = vec2(WEATHER_TEXEL, float(0));
    const dz = vec2(float(0), WEATHER_TEXEL);
    return texture(tex, uvNode).mul(0.44)
      .add(texture(tex, uvNode.add(dx).fract()).mul(0.14))
      .add(texture(tex, uvNode.sub(dx).fract()).mul(0.14))
      .add(texture(tex, uvNode.add(dz).fract()).mul(0.14))
      .add(texture(tex, uvNode.sub(dz).fract()).mul(0.14));
  };

  const sampleWeatherPair = (uvNode, smooth = true) => {
    const uvA = uvNode.add(u.m2WeatherOffsetA).fract();
    const uvB = uvNode.add(u.m2WeatherOffsetB).fract();
    const a = smooth ? sampleWeather5(weatherA, uvA) : texture(weatherA, uvA);
    const b = smooth ? sampleWeather5(weatherB, uvB) : texture(weatherB, uvB);
    return mix(a, b, u.m2WeatherBlend);
  };

  handle.material.colorNode = Fn(() => {
    const rayOrigin = cameraPosition;
    const rayDir = normalize(positionWorld.sub(cameraPosition));
    const t0Raw = u.cloudBaseY.sub(rayOrigin.y).div(rayDir.y);
    const t1Raw = u.cloudTopY.sub(rayOrigin.y).div(rayDir.y);
    const tNear = tslMin(t0Raw, t1Raw);
    const tFar = tslMax(t0Raw, t1Raw);
    const tStart = tslMax(tNear, float(0));
    const tEnd = tslMin(tFar, tStart.add(MAX_DISTANCE));
    const marchLength = tslMax(tEnd.sub(tStart), float(0));

    // Adaptive marching deliberately defines a nominal step smaller than a plain
    // N-step march. Empty space advances 2.5x; dense cloud advances ~0.72x.
    const nominalStep = marchLength.div(float(RAY_STEPS).mul(0.88)).toVar();

    // Stable spatial jitter only. r185 TAAU owns temporal subpixel jitter, so the
    // cloud density itself no longer hops between different offsets every frame.
    const jitterUV = vec2(positionWorld.x, positionWorld.z)
      .mul(0.0109)
      .add(u.m2WeatherOffsetA.mul(1.73))
      .fract();
    const jitterSeed = texture(weatherA, jitterUV).b;
    const t = tStart.add(nominalStep.mul(float(0.08).add(jitterSeed.mul(0.82)))).toVar();
    const transmittance = float(1).toVar();
    const scattered = vec3(0).toVar();

    // Dual-lobe HG approximation plus two broad multiple-scattering orders.
    const mu = clamp(dot(rayDir, u.sunDir), -1, 1);
    const forwardDenom = float(1.4225).sub(mu.mul(1.30)).max(0.045);
    const backwardDenom = float(1.04).add(mu.mul(0.40)).max(0.08);
    const phaseForward = float(0.5775).div(pow(forwardDenom, 1.5));
    const phaseBackward = float(0.96).div(pow(backwardDenom, 1.5));
    const phase0 = phaseForward.mul(0.82).add(phaseBackward.mul(0.18)).mul(0.31).add(0.075);
    const phase1 = phase0.mul(0.70).add(0.085);
    const phase2 = phase0.mul(0.46).add(0.13);

    Loop(RAY_STEPS, () => {
      If(t.lessThan(tEnd), () => {
        const pos = rayOrigin.add(rayDir.mul(t));
        const slabThickness = u.cloudTopY.sub(u.cloudBaseY).max(1);
        const height01 = clamp(pos.y.sub(u.cloudBaseY).div(slabThickness), 0, 1);

        const weatherUV = vec2(pos.x, pos.z)
          .mul(WEATHER_SCALE)
          .fract();
        const weather = sampleWeatherPair(weatherUV, true);
        const cloudType = clamp(weather.g, 0, 1);
        const humidityLocal = clamp(weather.b, 0, 1);
        const stormLocal = clamp(u.stormDarken.add(weather.a.mul(0.42)), 0, 1);
        const convectionLocal = clamp(
          u.convection
            .mul(float(0.54).add(cloudType.mul(0.66)))
            .add(weather.a.mul(0.26)),
          0,
          1,
        );

        // Weather controls whether/what kind of cloud can form here. It does not
        // define per-column top height. All cloud types share a nearly flat
        // condensation base and the 3D density field creates the silhouette.
        const coverageThreshold = mix(float(0.72), float(0.40), u.coverage);
        const coverageMask = smoothstep(
          coverageThreshold.sub(0.13),
          coverageThreshold.add(0.14),
          weather.r,
        );

        // Three meteorological vertical profiles.
        const stratusProfile = smoothstep(float(0.010), float(0.070), height01)
          .mul(float(1).sub(smoothstep(float(0.34), float(0.61), height01)));

        const cumulusBase = smoothstep(float(0.010), float(0.055), height01);
        const cumulusTopStart = mix(float(0.58), float(0.79), convectionLocal);
        const cumulusTop = float(1).sub(
          smoothstep(cumulusTopStart, float(0.994), height01),
        );
        const cumulusBulge = smoothstep(float(0.12), float(0.36), height01)
          .mul(float(1).sub(smoothstep(float(0.57), float(0.90), height01)));
        const cumulusProfile = cumulusBase
          .mul(cumulusTop)
          .mul(float(0.82).add(cumulusBulge.mul(0.34)));

        const towerProfile = smoothstep(float(0.008), float(0.034), height01)
          .mul(float(1).sub(smoothstep(float(0.84), float(0.999), height01)));

        const stratusWeight = float(1).sub(
          smoothstep(float(0.26), float(0.48), cloudType),
        );
        const towerWeight = smoothstep(float(0.64), float(0.90), cloudType)
          .mul(convectionLocal)
          .mul(float(0.78).add(stormLocal.mul(0.22)));
        const fairProfile = mix(cumulusProfile, stratusProfile, stratusWeight);
        const verticalProfile = mix(fairProfile, towerProfile, clamp(towerWeight, 0, 1));

        // Height-dependent 3D convection warp. Lower cloud mass stays coherent;
        // the upper half progressively mushrooms/rolls into cauliflower lobes.
        const warpUV = pos
          .mul(TILE_SCALE.mul(u.m2BaseScale).mul(0.31))
          .add(u.m2WarpOffset)
          .fract();
        const warpNoise = texture3D(baseTex, warpUV);
        const warpVector = vec3(warpNoise.g, warpNoise.b, warpNoise.a).sub(0.5);
        const crownWarp = smoothstep(float(0.18), float(0.96), height01)
          .mul(convectionLocal);
        const warpStrength = u.m2DomainWarp
          .mul(float(0.48).add(crownWarp.mul(1.52)));
        const densityPos = pos.add(vec3(
          warpVector.x.mul(warpStrength),
          warpVector.y.mul(warpStrength).mul(0.28),
          warpVector.z.mul(warpStrength),
        ));

        const baseUV = densityPos
          .mul(TILE_SCALE.mul(u.m2BaseScale))
          .add(u.m2BaseOffset)
          .fract();
        const baseNoise = texture3D(baseTex, baseUV);
        const worleyFbm = baseNoise.g.mul(0.625)
          .add(baseNoise.b.mul(0.25))
          .add(baseNoise.a.mul(0.125));
        const broadSignal = baseNoise.r.mul(0.78).add(worleyFbm.mul(0.22));

        const densityThreshold = mix(float(0.63), float(0.35), u.density)
          .add(u.m2DensityBias);
        const broadMass = smoothstep(
          densityThreshold,
          densityThreshold.add(0.235),
          broadSignal,
        );

        // Upper convective regions expose more individual Worley lobes, breaking
        // one smooth dome into a family of cauliflower crowns.
        const crownLobeSignal = baseNoise.g.mul(0.58)
          .add(baseNoise.b.mul(0.30))
          .add(baseNoise.a.mul(0.12));
        const crownMod = mix(
          float(1),
          float(0.72).add(crownLobeSignal.mul(0.42)),
          crownWarp,
        );

        const weatherMass = coverageMask
          .mul(verticalProfile)
          .mul(mix(float(0.82), float(1.16), humidityLocal));
        const coarseDensity = clamp(
          broadMass
            .mul(weatherMass)
            .mul(crownMod)
            .mul(u.m2DensityScale),
          0,
          1,
        );

        const hitWeight = smoothstep(float(0.0035), float(0.080), coarseDensity);
        const adaptiveAdvance = mix(
          nominalStep.mul(2.55),
          nominalStep.mul(0.72),
          hitWeight,
        ).toVar();

        If(coarseDensity.greaterThan(0.0035), () => {
          const detailUV = densityPos
            .mul(TILE_SCALE.mul(u.m2DetailScale))
            .add(u.m2DetailOffset)
            .add(warpVector.mul(0.37))
            .fract();
          const detail = texture3D(detailTex, detailUV);
          const detailFbm = detail.r.mul(0.625)
            .add(detail.g.mul(0.25))
            .add(detail.b.mul(0.125));

          // Boundary-only erosion: dense cores remain solid; only the transition
          // shell receives strong high-frequency Worley breakup.
          const edgeEnter = smoothstep(float(0.010), float(0.22), coarseDensity);
          const edgeExit = float(1).sub(
            smoothstep(float(0.52), float(0.93), coarseDensity),
          );
          const edgeBand = edgeEnter.mul(edgeExit);
          const erosionSignal = float(1).sub(detailFbm);
          const erosionAmount = erosionSignal
            .mul(u.m2EdgeErosion)
            .mul(u.erosion)
            .mul(edgeBand)
            .mul(mix(float(1.0), float(0.66), stormLocal));

          const moistureBoost = mix(
            float(0.82),
            float(1.18),
            u.humidity.mul(humidityLocal),
          );
          const localDensity = clamp(
            coarseDensity.sub(erosionAmount),
            0,
            1,
          ).mul(moistureBoost);

          // Coarse directional optical-depth march. It intentionally skips detail
          // erosion, matching NVIDIA-style separation of visual density and cheap
          // shadow/light grids.
          const opticalDepth = float(0).toVar();
          Loop(LIGHT_STEPS, ({ i }) => {
            const lightDistance = float(16).mul(float(i).add(1));
            const lp = pos.add(u.sunDir.mul(lightDistance));
            const lh = clamp(lp.y.sub(u.cloudBaseY).div(slabThickness), 0, 1);
            const lwuv = vec2(lp.x, lp.z).mul(WEATHER_SCALE).fract();
            const lw = sampleWeatherPair(lwuv, false);
            const lc = smoothstep(
              coverageThreshold.sub(0.13),
              coverageThreshold.add(0.14),
              lw.r,
            );
            const lprofile = smoothstep(float(0.010), float(0.060), lh)
              .mul(float(1).sub(smoothstep(float(0.76), float(0.997), lh)));
            const lbase = texture3D(
              baseTex,
              lp.mul(TILE_SCALE.mul(u.m2BaseScale))
                .add(u.m2BaseOffset)
                .fract(),
            );
            const lworley = lbase.g.mul(0.625)
              .add(lbase.b.mul(0.25))
              .add(lbase.a.mul(0.125));
            const lsignal = lbase.r.mul(0.80).add(lworley.mul(0.20));
            const lmass = smoothstep(
              densityThreshold,
              densityThreshold.add(0.235),
              lsignal,
            );
            opticalDepth.addAssign(
              lmass
                .mul(lc)
                .mul(lprofile)
                .mul(mix(float(0.78), float(1.18), lw.b))
                .mul(u.density),
            );
          });

          const lightDepth = opticalDepth.mul(u.m2LightExtinction);
          const beer0 = exp(lightDepth.negate());
          const beer1 = exp(lightDepth.mul(-0.50));
          const beer2 = exp(lightDepth.mul(-0.25));
          const multiScatter = beer0.mul(phase0)
            .add(beer1.mul(phase1).mul(0.50))
            .add(beer2.mul(phase2).mul(0.25))
            .add(u.m2MultiScatter.mul(0.085));

          const powder = float(1).sub(exp(localDensity.mul(-2.35)));
          const heightLight = smoothstep(float(0.04), float(0.79), height01);

          // Cool sky illumination penetrates the cloud from the hemisphere. Direct
          // sunlight remains spectrally warm/white, producing the desired white
          // crown -> gray-blue interior -> darker underside hierarchy.
          const coolAmbient = u.ambientColor
            .mul(vec3(0.72, 0.83, 1.00));
          const shadowAmbient = u.ambientColor
            .mul(vec3(0.46, 0.56, 0.73));
          const ambientMix = mix(
            shadowAmbient,
            coolAmbient,
            heightLight.mul(0.62).add(powder.mul(0.20)),
          ).mul(u.m2AmbientStrength);

          const directLight = u.sunColor
            .mul(multiScatter)
            .mul(float(0.84).add(heightLight.mul(0.48)));
          const silverEdge = u.sunColor
            .mul(pow(float(1).sub(coarseDensity), 2.55))
            .mul(phase0)
            .mul(u.m2SilverStrength)
            .mul(float(1).sub(stormLocal.mul(0.58)));

          const litClear = ambientMix.add(directLight).add(silverEdge);
          const lit = mix(
            litClear,
            shadowAmbient.mul(0.78).add(directLight.mul(0.56)),
            stormLocal.mul(0.72),
          );
          const flash = u.lightningColor
            .mul(u.lightningFlash)
            .mul(float(0.55).add(localDensity.mul(1.35)));

          const extinction = mix(float(0.036), float(0.071), stormLocal);
          const sampleAlpha = float(1).sub(
            exp(localDensity.mul(adaptiveAdvance).mul(extinction).negate()),
          );
          scattered.addAssign(
            lit.add(flash).mul(sampleAlpha).mul(transmittance),
          );
          transmittance.mulAssign(float(1).sub(sampleAlpha));
        });

        t.addAssign(adaptiveAdvance);
      });
    });

    const skyward = smoothstep(float(0.001), float(0.035), rayDir.y);
    const horizonFade = smoothstep(float(0.005), float(0.050), rayDir.y.abs());
    const alpha = float(1).sub(transmittance).mul(skyward).mul(horizonFade);
    return vec4(scattered, alpha);
  })();

  handle.material.needsUpdate = true;
  handle.__riftModel2ShaderInstalled = true;

  // The original procedural density texture is no longer referenced after the
  // Model 2 shader is installed. Reclaim it once, after the preserved base system
  // has completed its first update/setup.
  if (
    handle.__riftModel2OriginalShapeTexture &&
    handle.__riftModel2OriginalShapeTexture !== handle.shapeTexture
  ) {
    handle.__riftModel2OriginalShapeTexture.dispose?.();
    handle.__riftModel2OriginalShapeTexture = null;
  }
  if (
    handle.__riftModel2OriginalWeatherTexture &&
    handle.__riftModel2OriginalWeatherTexture !== handle.weatherTexture
  ) {
    handle.__riftModel2OriginalWeatherTexture.dispose?.();
    handle.__riftModel2OriginalWeatherTexture = null;
  }

  console.info(
    `[clouds] Rift Cloud Model 2 density active (${RAY_STEPS} adaptive view / ${LIGHT_STEPS} Sun samples, ${config.baseSize}^3 + ${config.detailSize}^3)`,
  );
}

function tuneModel2(handle, dt, sunDirection, windX, windZ, rainIntensity) {
  const u = handle?.uniforms;
  if (!u) return;

  const weatherState = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(weatherState?.stormIntensity ?? rainIntensity);
  const requestedCoverage = clamp01(weatherState?.cloudCoverage ?? 0.44);
  const requestedHumidity = clamp01(weatherState?.humidity ?? 0.72);
  const requestedConvection = clamp01(weatherState?.convection ?? 0.78);
  const safeDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
  const wx = Number(windX) || 0;
  const wz = Number(windZ) || 0;

  handle.__riftModel2Age += safeDt;
  handle.__riftModel2MorphPhase = (
    handle.__riftModel2MorphPhase
    + safeDt * THREE.MathUtils.lerp(1 / 82, 1 / 42, storm)
  ) % 1;

  // Trade wind + weather wind. The two weather maps and the three 3D fields move
  // at different speeds, giving evolution rather than rigid translation.
  const prevailingX = 0.62;
  const prevailingZ = 0.18;
  const envVX = prevailingX + wx * 0.55;
  const envVZ = prevailingZ + wz * 0.55;
  const baseVX = prevailingX * 1.04 + wx * 0.85;
  const baseVZ = prevailingZ * 1.04 + wz * 0.85;
  const detailVX = prevailingX * 1.52 + wx * 1.18;
  const detailVZ = prevailingZ * 1.52 + wz * 1.18;

  handle.__riftModel2WeatherAX += envVX * safeDt * 0.00034;
  handle.__riftModel2WeatherAY += envVZ * safeDt * 0.00034;
  handle.__riftModel2WeatherBX += (envVX * 0.86 - envVZ * 0.10) * safeDt * 0.00031;
  handle.__riftModel2WeatherBY += (envVZ * 0.90 + envVX * 0.08) * safeDt * 0.00031;

  handle.__riftModel2BaseX += baseVX * safeDt * 0.00058;
  handle.__riftModel2BaseZ += baseVZ * safeDt * 0.00058;
  handle.__riftModel2BaseY += safeDt * (0.000035 + requestedConvection * 0.000045);
  handle.__riftModel2DetailX += detailVX * safeDt * 0.00145;
  handle.__riftModel2DetailZ += detailVZ * safeDt * 0.00145;
  handle.__riftModel2DetailY += safeDt * (0.00011 + requestedConvection * 0.00014);
  handle.__riftModel2WarpX += (prevailingX * 0.42 + wx * 0.30) * safeDt * 0.00027;
  handle.__riftModel2WarpZ += (prevailingZ * 0.42 + wz * 0.30) * safeDt * 0.00027;
  handle.__riftModel2WarpY += safeDt * 0.000020;

  const rawMorph = 0.5 - 0.5 * Math.cos(TAU * handle.__riftModel2MorphPhase);
  const morph = smooth01(rawMorph);
  u.m2WeatherOffsetA.value.set(handle.__riftModel2WeatherAX, handle.__riftModel2WeatherAY);
  u.m2WeatherOffsetB.value.set(handle.__riftModel2WeatherBX, handle.__riftModel2WeatherBY);
  u.m2WeatherBlend.value = morph;
  u.m2BaseOffset.value.set(handle.__riftModel2BaseX, handle.__riftModel2BaseY, handle.__riftModel2BaseZ);
  u.m2DetailOffset.value.set(handle.__riftModel2DetailX, handle.__riftModel2DetailY, handle.__riftModel2DetailZ);
  u.m2WarpOffset.value.set(handle.__riftModel2WarpX, handle.__riftModel2WarpY, handle.__riftModel2WarpZ);
  u.m2Time.value = handle.__riftModel2Age;

  // Persistent fair-weather cumulus baseline. Weather can still open the sky, but
  // it cannot collapse the entire Model 2 field to nothing for long stretches.
  if (u.coverage) {
    const fair = THREE.MathUtils.clamp(requestedCoverage, 0.38, 0.54);
    u.coverage.value = THREE.MathUtils.lerp(fair, 0.83, storm);
  }
  if (u.density) u.density.value = THREE.MathUtils.lerp(0.56, 0.82, storm);
  if (u.humidity) u.humidity.value = THREE.MathUtils.lerp(Math.max(0.68, requestedHumidity), 0.95, storm);
  if (u.convection) u.convection.value = THREE.MathUtils.lerp(Math.max(0.72, requestedConvection), 0.99, storm);
  if (u.erosion) u.erosion.value = THREE.MathUtils.lerp(0.48, 0.31, storm);

  u.m2BaseScale.value = THREE.MathUtils.lerp(0.48, 0.42, storm);
  u.m2DetailScale.value = THREE.MathUtils.lerp(6.2, 4.9, storm);
  u.m2DomainWarp.value = THREE.MathUtils.lerp(0.074, 0.060, storm);
  u.m2EdgeErosion.value = THREE.MathUtils.lerp(0.50, 0.33, storm);
  u.m2DensityBias.value = THREE.MathUtils.lerp(-0.046, -0.018, storm);
  u.m2DensityScale.value = THREE.MathUtils.lerp(1.06, 1.18, storm);
  u.m2LightExtinction.value = THREE.MathUtils.lerp(0.64, 0.82, storm);
  u.m2MultiScatter.value = THREE.MathUtils.lerp(0.25, 0.20, storm);
  u.m2AmbientStrength.value = THREE.MathUtils.lerp(0.59, 0.45, storm);
  u.m2SilverStrength.value = THREE.MathUtils.lerp(0.44, 0.22, storm);

  const baseTarget = THREE.MathUtils.lerp(50, 31, storm);
  const topTarget = THREE.MathUtils.lerp(190, 282, storm);
  if (u.cloudBaseY) u.cloudBaseY.value = baseTarget;
  if (u.cloudTopY) u.cloudTopY.value = topTarget;

  const baseY = Number(u.cloudBaseY?.value) || baseTarget;
  if (handle.mesh) handle.mesh.position.y = baseY;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;

  if (handle.__riftCirrus?.material) {
    handle.__riftCirrus.material.opacity = THREE.MathUtils.lerp(0.016, 0.006, storm);
  }

  // Coarse shadow projection. Consumers can sample globalThis.__riftCloudShadowTexture
  // without invoking the expensive cloud raymarch again.
  handle.__riftModel2Shadow?.update?.(safeDt, {
    weatherPair: handle.__riftModel2WeatherPair,
    offsetA: u.m2WeatherOffsetA.value,
    offsetB: u.m2WeatherOffsetB.value,
    morph,
    sunDirection,
    coverage: u.coverage?.value,
    density: u.density?.value,
    storm,
  });

  if (handle.__riftModel2Shadow) {
    globalThis.__riftCloudShadowTexture = handle.__riftModel2Shadow.texture;
    globalThis.__riftCloudShadowState = {
      texture: handle.__riftModel2Shadow.texture,
      averageTransmittance: handle.__riftModel2Shadow.averageTransmittance,
      updateHz: Math.round(1 / handle.__riftModel2Shadow.updateInterval),
      worldScale: handle.quality.weatherScale * 0.72,
      offsetA: u.m2WeatherOffsetA.value,
      offsetB: u.m2WeatherOffsetB.value,
      morph,
    };
  }

  globalThis.__riftCloudModel2Debug = {
    active: true,
    version: "2.0",
    threeRevision: THREE.REVISION,
    quality: handle.__riftModel2Quality?.label,
    architecture: "weather meteorology + 3D Perlin-Worley + cloud-type profiles + convective warp + boundary erosion + Beer-Lambert/multiscatter + r185 TAAU",
    renderScale: handle.__riftModel2Quality?.renderScale,
    viewSteps: handle.__riftModel2Quality?.viewSteps,
    lightSteps: handle.__riftModel2Quality?.lightSteps,
    baseVolume: handle.__riftModel2Quality?.baseSize,
    detailVolume: handle.__riftModel2Quality?.detailSize,
    weatherSize: handle.__riftModel2Quality?.weatherSize,
    coverage: Number(u.coverage?.value) || 0,
    density: Number(u.density?.value) || 0,
    humidity: Number(u.humidity?.value) || 0,
    convection: Number(u.convection?.value) || 0,
    base: Number(u.cloudBaseY?.value) || 0,
    top: Number(u.cloudTopY?.value) || 0,
    shadowTransmittance: handle.__riftModel2Shadow?.averageTransmittance ?? 1,
    storm,
  };
}

export function createVolumetricClouds(scene) {
  const handle = createTemporalClouds(scene);
  if (!handle) return handle;

  const quality = qualityForModel2(handle);
  handle.__riftModel2Quality = quality;

  // Replace the old shape/weather assets before the preserved base renderer gets
  // its first update. This avoids ever compiling the final frame against the old
  // procedural noise model.
  handle.__riftModel2OriginalShapeTexture = handle.shapeTexture;
  handle.__riftModel2OriginalWeatherTexture = handle.weatherTexture;

  handle.__riftModel2Volumes = createPerlinWorleyCloudVolumes({
    baseSize: quality.baseSize,
    detailSize: quality.detailSize,
    seed: 0x52494654,
  });
  handle.shapeTexture = handle.__riftModel2Volumes.baseTexture;

  handle.__riftModel2WeatherPair = createRiftCloudWeatherPair(quality.weatherSize);
  handle.weatherTexture = handle.__riftModel2WeatherPair.a;
  handle.__riftModel2Shadow = createRiftCloudShadowMap(quality.shadowSize);

  handle.quality.raySteps = quality.viewSteps;
  handle.quality.shadowSteps = quality.lightSteps;

  installModel2Uniforms(handle);
  handle.__riftModel2ShaderInstalled = false;

  handle.__riftModel2Age = 0;
  handle.__riftModel2MorphPhase = Math.random();
  handle.__riftModel2WeatherAX = Math.random();
  handle.__riftModel2WeatherAY = Math.random();
  handle.__riftModel2WeatherBX = Math.random();
  handle.__riftModel2WeatherBY = Math.random();
  handle.__riftModel2BaseX = Math.random();
  handle.__riftModel2BaseY = Math.random();
  handle.__riftModel2BaseZ = Math.random();
  handle.__riftModel2DetailX = Math.random();
  handle.__riftModel2DetailY = Math.random();
  handle.__riftModel2DetailZ = Math.random();
  handle.__riftModel2WarpX = Math.random();
  handle.__riftModel2WarpY = Math.random();
  handle.__riftModel2WarpZ = Math.random();

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
  updateTemporalClouds(
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

  if (!handle || !camera) return;

  installModel2Shader(handle);
  tuneModel2(handle, dt, sunDirection, windX, windZ, rainIntensity);

  const disableTAAU = typeof location !== "undefined"
    && new URLSearchParams(location.search).has("noCloudTAAU");

  if (!disableTAAU) {
    installRiftCloudTAAU(handle, camera, handle.__riftModel2Quality.renderScale);
    syncRiftCloudTAAU(handle, camera, handle.__riftModel2Quality.renderScale);
  } else {
    // Debug fallback: retain the current-frame cloud pass at a conservative
    // quarter-ish resolution if a browser/backend exposes a TAAU regression.
    const temporal = handle.__riftTemporalCloudState;
    temporal?.cloudPass?.setResolutionScale?.(0.38);
    if (temporal) temporal.resolutionScale = 0.38;
  }
}

export function disposeVolumetricClouds(handle) {
  disposeRiftCloudTAAU(handle);

  handle?.__riftModel2Shadow?.dispose?.();
  // The base texture is handle.shapeTexture and will be disposed by the preserved
  // cloud disposer. Dispose only the independent detail volume here.
  handle?.__riftModel2Volumes?.detailTexture?.dispose?.();
  // Weather A is handle.weatherTexture and is disposed by the preserved cloud
  // system. Weather B is Model 2-only.
  handle?.__riftModel2WeatherPair?.b?.dispose?.();

  if (handle) {
    handle.__riftModel2Volumes = null;
    handle.__riftModel2WeatherPair = null;
    handle.__riftModel2Shadow = null;
    handle.__riftModel2Quality = null;
  }

  delete globalThis.__riftCloudModel2Debug;
  delete globalThis.__riftCloudShadowTexture;
  delete globalThis.__riftCloudShadowState;

  return disposeTemporalClouds(handle);
}
