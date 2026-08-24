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
  If,
  positionWorld,
  cameraPosition,
  max as tslMax,
  min as tslMin,
} from "three/tsl";
import {
  createVolumetricClouds as createPerlinWorleyClouds,
  updateVolumetricClouds as updatePerlinWorleyClouds,
  disposeVolumetricClouds as disposePerlinWorleyClouds,
} from "./volumetricClouds_perlinWorley_v2.js";
import { createNubisEnvelopePair } from "./cloudEnvelopeNubis_v2.js";

// -----------------------------------------------------------------------------
// Nubis v2: animated, rounded, continuously evolving production clouds.
//
// Improvements over v1:
//   * two independently moving macro envelopes cross-fade over time;
//   * 5-tap envelope filtering removes square/blocky macro boundaries;
//   * a minimum prevailing wind keeps clouds moving even in calm weather;
//   * macro, Perlin-Worley mass, warp and detail erosion advect separately;
//   * low-frequency 3D domain warping rounds/rolls the broad cloud mass;
//   * height-dependent shear and vertical noise compression build cumulus towers;
//   * animated high-frequency erosion makes edges boil/dissolve naturally;
//   * frame-varying jitter gives temporal accumulation new sub-samples each frame;
//   * Low uses 14 adaptive view samples while retaining empty-space skipping.
// -----------------------------------------------------------------------------

const TAU = Math.PI * 2;
const TEMPORAL_JITTER = [0.5, 0.25, 0.75, 0.125, 0.625, 0.375, 0.875, 0.0625];

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function qualityForNubis(handle) {
  const inherited = Number(handle?.__riftPWQuality?.viewSteps ?? handle?.quality?.raySteps) || 10;
  if (inherited <= 10) return { viewSteps: 14, lightSteps: 2, envelopeSize: 128 };
  if (inherited <= 14) return { viewSteps: 18, lightSteps: 3, envelopeSize: 160 };
  return { viewSteps: 24, lightSteps: 4, envelopeSize: 192 };
}

function installNubisUniforms(handle) {
  if (!handle?.uniforms || handle.__riftNubisV2UniformsInstalled) return;
  const u = handle.uniforms;
  u.nubisEnvelopeOffsetA = uniform(new THREE.Vector2());
  u.nubisEnvelopeOffsetB = uniform(new THREE.Vector2());
  u.nubisMorphBlend = uniform(0);
  u.nubisBaseOffset = uniform(new THREE.Vector3());
  u.nubisDetailOffset = uniform(new THREE.Vector3());
  u.nubisWarpOffset = uniform(new THREE.Vector3());
  u.nubisShear = uniform(new THREE.Vector2());
  u.nubisFrameJitter = uniform(0.5);
  u.nubisEnvelopeStrength = uniform(0.94);
  u.nubisEdgeErosion = uniform(0.32);
  u.nubisDensityScale = uniform(1.06);
  u.nubisAmbientBoost = uniform(0.74);
  u.nubisMultiScatter = uniform(0.34);
  u.nubisLightExtinction = uniform(0.54);
  u.nubisDomainWarp = uniform(0.055);
  u.nubisVerticalStretch = uniform(0.72);
  handle.__riftNubisV2UniformsInstalled = true;
}

function installNubisShader(handle) {
  if (
    !handle?.material ||
    !handle?.__riftPWVolumes ||
    !handle?.__riftNubisEnvelopes?.a ||
    !handle?.__riftNubisEnvelopes?.b ||
    handle.__riftNubisV2ShaderInstalled
  ) return;

  installNubisUniforms(handle);

  const u = handle.uniforms;
  const baseTex = handle.__riftPWVolumes.baseTexture;
  const detailTex = handle.__riftPWVolumes.detailTexture;
  const weatherTex = handle.weatherTexture;
  const envelopeA = handle.__riftNubisEnvelopes.a;
  const envelopeB = handle.__riftNubisEnvelopes.b;
  const config = handle.__riftNubisV2Quality;
  const RAY_STEPS = config.viewSteps;
  const LIGHT_STEPS = config.lightSteps;
  const TILE_SCALE = float(handle.quality.tileScale);
  const WEATHER_SCALE = float(handle.quality.weatherScale);
  const ENVELOPE_SCALE = float(0.00050);
  const ENVELOPE_TEXEL = float(1 / config.envelopeSize);
  const MAX_DISTANCE = float(handle.quality.maxRayDistance);

  // Bilinear filtering already softens one texel. Five weighted taps make the
  // macro field circular/organic instead of exposing axis-aligned envelope cells.
  const sampleEnvelope5 = (tex, uvNode) => {
    const dx = vec2(ENVELOPE_TEXEL, float(0));
    const dz = vec2(float(0), ENVELOPE_TEXEL);
    return texture(tex, uvNode).mul(0.36)
      .add(texture(tex, uvNode.add(dx).fract()).mul(0.16))
      .add(texture(tex, uvNode.sub(dx).fract()).mul(0.16))
      .add(texture(tex, uvNode.add(dz).fract()).mul(0.16))
      .add(texture(tex, uvNode.sub(dz).fract()).mul(0.16));
  };

  const sampleEnvelopePair = (uvNode, smooth = true) => {
    const uvA = uvNode.add(u.nubisEnvelopeOffsetA).fract();
    const uvB = uvNode.add(u.nubisEnvelopeOffsetB).fract();
    const a = smooth ? sampleEnvelope5(envelopeA, uvA) : texture(envelopeA, uvA);
    const b = smooth ? sampleEnvelope5(envelopeB, uvB) : texture(envelopeB, uvB);
    return mix(a, b, u.nubisMorphBlend);
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

    const nominalStep = marchLength.div(float(RAY_STEPS).mul(0.84)).toVar();
    const spatialJitterUV = vec2(positionWorld.x, positionWorld.z)
      .mul(0.0117)
      .add(u.weatherOffset.mul(2.09))
      .fract();
    const spatialJitter = texture(weatherTex, spatialJitterUV).g;
    const jitter = spatialJitter.mul(0.60)
      .add(u.nubisFrameJitter.mul(0.32))
      .add(0.04);
    const t = tStart.add(nominalStep.mul(jitter)).toVar();
    const transmittance = float(1).toVar();
    const scattered = vec3(0, 0, 0).toVar();

    // Dual-lobe Henyey-Greenstein approximation, followed by two cheaper
    // scattering orders. Bright forward scattering produces silver linings.
    const mu = clamp(dot(rayDir, u.sunDir), -1, 1);
    const fDenom = float(1.4225).sub(mu.mul(1.30)).max(0.045);
    const bDenom = float(1.04).add(mu.mul(0.40)).max(0.08);
    const phaseForward = float(0.5775).div(pow(fDenom, 1.5));
    const phaseBackward = float(0.96).div(pow(bDenom, 1.5));
    const phase0 = phaseForward.mul(0.80).add(phaseBackward.mul(0.20)).mul(0.30).add(0.075);
    const phase1 = phase0.mul(0.72).add(0.075);
    const phase2 = phase0.mul(0.48).add(0.12);

    Loop(RAY_STEPS, () => {
      If(t.lessThan(tEnd), () => {
        const pos = rayOrigin.add(rayDir.mul(t));
        const slabThickness = u.cloudTopY.sub(u.cloudBaseY).max(1);
        const height01 = clamp(pos.y.sub(u.cloudBaseY).div(slabThickness), 0, 1);

        const weatherUV = vec2(pos.x, pos.z)
          .mul(WEATHER_SCALE)
          .add(u.weatherOffset)
          .fract();
        const weatherSample = texture(weatherTex, weatherUV);

        const envelopeUV = vec2(pos.x, pos.z).mul(ENVELOPE_SCALE).fract();
        const envelope = sampleEnvelopePair(envelopeUV, true);
        const storm = u.stormDarken;

        // Flat-ish cumulus bases and strongly varying tops. The cross-faded
        // envelope means these local base/top/type values evolve over time.
        const localBase = envelope.r.mul(mix(float(1.0), float(0.67), storm));
        const stormLift = storm.mul(float(1).sub(envelope.g)).mul(0.80);
        const convLift = weatherSample.g.mul(u.convection).mul(0.15);
        const localTop = envelope.g.add(stormLift).add(convLift).min(0.998)
          .max(localBase.add(0.20));
        const localHeight = clamp(
          height01.sub(localBase).div(localTop.sub(localBase).max(0.04)),
          0,
          1,
        );
        const cloudType = clamp(
          envelope.b.add(storm.mul(0.28)).add(weatherSample.g.mul(u.convection).mul(0.12)),
          0,
          1,
        );

        const stratusProfile = smoothstep(float(0.00), float(0.055), localHeight)
          .mul(float(1).sub(smoothstep(float(0.46), float(0.90), localHeight)));
        const cumulusProfile = smoothstep(float(0.00), float(0.035), localHeight)
          .mul(float(1).sub(smoothstep(float(0.66), float(0.997), localHeight)));
        const towerProfile = smoothstep(float(0.00), float(0.020), localHeight)
          .mul(float(1).sub(smoothstep(float(0.86), float(0.999), localHeight)));
        const stratusWeight = float(1).sub(smoothstep(float(0.24), float(0.46), cloudType));
        const towerWeight = smoothstep(float(0.58), float(0.88), cloudType)
          .mul(mix(float(0.55), float(1.0), u.convection));
        const fairProfile = mix(cumulusProfile, stratusProfile, stratusWeight);
        const verticalProfile = mix(fairProfile, towerProfile, towerWeight);

        const weatherField = mix(weatherSample.r, envelope.a, u.nubisEnvelopeStrength.mul(0.38));
        const coverageThreshold = float(1).sub(u.coverage);
        const coverageMask = smoothstep(
          coverageThreshold.sub(0.19),
          coverageThreshold.add(0.19),
          weatherField,
        );
        const dimensionalProfile = verticalProfile
          .mul(coverageMask)
          .mul(mix(float(0.74), float(1.15), envelope.a));

        // Upper portions of convective clouds lean with the prevailing flow.
        // Bases remain nearly stationary/flat while the tops shear and billow.
        const shearHeight = smoothstep(float(0.24), float(0.96), localHeight)
          .mul(towerWeight.mul(0.72).add(0.28));
        const shearedPos = pos.add(vec3(
          u.nubisShear.x.mul(shearHeight),
          float(0),
          u.nubisShear.y.mul(shearHeight),
        ));

        // Compress noise vertically for cumulus/towers, stretching individual
        // Perlin-Worley lobes upward into cauliflower-shaped convective stacks.
        const verticalCompression = mix(
          float(0.94),
          u.nubisVerticalStretch,
          smoothstep(float(0.32), float(0.88), cloudType).mul(u.convection),
        );
        const densityY = u.cloudBaseY.add(
          shearedPos.y.sub(u.cloudBaseY).mul(verticalCompression),
        );
        const densityPos = vec3(shearedPos.x, densityY, shearedPos.z);

        // Low-frequency 3D domain warp bends the broad density coordinates.
        // This removes remaining axis-aligned/square structure from the macro
        // envelope and creates rounded rolling cloud lobes.
        const warpUV = densityPos
          .mul(TILE_SCALE.mul(u.pwBaseScale).mul(0.34))
          .add(u.nubisWarpOffset)
          .fract();
        const warpNoise = texture3D(baseTex, warpUV);
        const warpVector = vec3(warpNoise.g, warpNoise.b, warpNoise.a)
          .sub(0.5)
          .mul(u.nubisDomainWarp);

        const baseUV = densityPos
          .mul(TILE_SCALE.mul(u.pwBaseScale))
          .add(u.nubisBaseOffset)
          .add(warpVector)
          .fract();
        const baseNoise = texture3D(baseTex, baseUV);
        const worleyFbm = baseNoise.g.mul(0.625)
          .add(baseNoise.b.mul(0.25))
          .add(baseNoise.a.mul(0.125));
        const broadSignal = baseNoise.r.mul(0.87).add(worleyFbm.mul(0.13));

        const coarseDensity = clamp(
          broadSignal
            .sub(float(1).sub(dimensionalProfile))
            .mul(2.05)
            .add(u.pwDensityBias)
            .mul(u.nubisDensityScale),
          0,
          1,
        ).mul(u.density);

        const hitWeight = smoothstep(float(0.006), float(0.070), coarseDensity);
        const adaptiveAdvance = mix(
          nominalStep.mul(1.90),
          nominalStep.mul(0.68),
          hitWeight,
        ).toVar();

        If(coarseDensity.greaterThan(0.0045), () => {
          const detailUV = densityPos
            .mul(TILE_SCALE.mul(u.pwDetailScale))
            .add(u.nubisDetailOffset)
            .add(warpVector.mul(1.35))
            .fract();
          const detail = texture3D(detailTex, detailUV);
          const detailFbm = detail.r.mul(0.625)
            .add(detail.g.mul(0.25))
            .add(detail.b.mul(0.125));
          const edgeBand = float(1).sub(coarseDensity).mul(coarseDensity).mul(4.0);
          const erosionSignal = float(1).sub(detailFbm);
          const localDensity = clamp(
            coarseDensity.sub(
              erosionSignal
                .mul(u.nubisEdgeErosion)
                .mul(u.erosion)
                .mul(edgeBand),
            ),
            0,
            1,
          ).mul(mix(float(0.82), float(1.19), u.humidity.mul(weatherSample.b)));

          const opticalDepth = float(0).toVar();
          Loop(LIGHT_STEPS, ({ i }) => {
            const lightDistance = float(15).mul(float(i).add(1));
            const lp = pos.add(u.sunDir.mul(lightDistance));
            const lh = clamp(lp.y.sub(u.cloudBaseY).div(slabThickness), 0, 1);
            const lwuv = vec2(lp.x, lp.z)
              .mul(WEATHER_SCALE)
              .add(u.weatherOffset)
              .fract();
            const lw = texture(weatherTex, lwuv);
            const leuv = vec2(lp.x, lp.z).mul(ENVELOPE_SCALE).fract();
            // Light march uses the same evolving pair but skips the 5-tap filter
            // to keep the extra directional samples affordable on mobile.
            const le = sampleEnvelopePair(leuv, false);
            const lbaseH = le.r.mul(mix(float(1.0), float(0.67), storm));
            const ltopH = le.g
              .add(storm.mul(float(1).sub(le.g)).mul(0.80))
              .add(lw.g.mul(u.convection).mul(0.15))
              .min(0.998)
              .max(lbaseH.add(0.20));
            const lhLocal = clamp(lh.sub(lbaseH).div(ltopH.sub(lbaseH).max(0.04)), 0, 1);
            const lprofile = smoothstep(float(0.00), float(0.040), lhLocal)
              .mul(float(1).sub(smoothstep(float(0.74), float(0.999), lhLocal)));
            const lweatherField = mix(lw.r, le.a, u.nubisEnvelopeStrength.mul(0.38));
            const lcoverage = smoothstep(
              coverageThreshold.sub(0.19),
              coverageThreshold.add(0.19),
              lweatherField,
            );
            const ldimensional = lprofile
              .mul(lcoverage)
              .mul(mix(float(0.74), float(1.15), le.a));

            const lwarp = texture3D(
              baseTex,
              lp.mul(TILE_SCALE.mul(u.pwBaseScale).mul(0.34))
                .add(u.nubisWarpOffset)
                .fract(),
            );
            const lwarpVec = vec3(lwarp.g, lwarp.b, lwarp.a)
              .sub(0.5)
              .mul(u.nubisDomainWarp);
            const lbaseNoise = texture3D(
              baseTex,
              lp.mul(TILE_SCALE.mul(u.pwBaseScale))
                .add(u.nubisBaseOffset)
                .add(lwarpVec)
                .fract(),
            );
            const lcoarse = clamp(
              lbaseNoise.r
                .sub(float(1).sub(ldimensional))
                .mul(2.02)
                .mul(u.density),
              0,
              1,
            );
            opticalDepth.addAssign(lcoarse);
          });

          const lightDepth = opticalDepth.mul(u.nubisLightExtinction);
          const beer0 = exp(lightDepth.negate());
          const beer1 = exp(lightDepth.mul(-0.50));
          const beer2 = exp(lightDepth.mul(-0.25));
          const multiScatter = beer0.mul(phase0)
            .add(beer1.mul(phase1).mul(0.50))
            .add(beer2.mul(phase2).mul(0.25))
            .add(u.nubisMultiScatter.mul(0.10));

          const refStrength = u.referencePaletteStrength.mul(0.48);
          const highlight = mix(u.sunColor, u.referenceHighlight, refStrength);
          const ambient = mix(u.ambientColor, u.referenceAmbient, refStrength.mul(0.58));
          const shadow = mix(u.ambientColor.mul(0.80), u.referenceShadow, refStrength.mul(0.62));
          const powder = float(1).sub(exp(localDensity.mul(-2.3)));
          const heightLight = smoothstep(float(0.05), float(0.78), localHeight);
          const ambientLight = mix(
            shadow,
            ambient,
            heightLight.mul(0.60).add(powder.mul(0.24)),
          ).mul(u.nubisAmbientBoost);
          const directLight = highlight
            .mul(multiScatter)
            .mul(float(0.92).add(heightLight.mul(0.44)));
          const silverEdge = highlight
            .mul(pow(float(1).sub(coarseDensity), 2.0))
            .mul(phase0)
            .mul(0.30)
            .mul(float(1).sub(storm.mul(0.58)));
          const stormShade = mix(
            ambientLight.add(directLight).add(silverEdge),
            shadow.mul(0.84).add(directLight.mul(0.60)),
            storm.mul(0.66),
          );
          const flash = u.lightningColor
            .mul(u.lightningFlash)
            .mul(float(0.55).add(localDensity.mul(1.35)));

          const extinction = mix(float(0.034), float(0.066), storm);
          const sampleAlpha = float(1).sub(
            exp(localDensity.mul(adaptiveAdvance).mul(extinction).negate()),
          );
          scattered.addAssign(
            stormShade.add(flash).mul(sampleAlpha).mul(transmittance),
          );
          transmittance.mulAssign(float(1).sub(sampleAlpha));
        });

        t.addAssign(adaptiveAdvance);
      });
    });

    const skyward = smoothstep(float(0.001), float(0.040), rayDir.y);
    const horizonFade = smoothstep(float(0.004), float(0.038), rayDir.y.abs());
    const alpha = float(1).sub(transmittance).mul(skyward).mul(horizonFade);
    return vec4(scattered, alpha);
  })();

  handle.material.needsUpdate = true;
  handle.__riftNubisV2ShaderInstalled = true;

  globalThis.__riftNubisCloudDebug = {
    active: true,
    architecture: "dual evolving envelope + 5-tap smoothing + domain-warped Perlin-Worley + adaptive multiscattering",
    viewSteps: RAY_STEPS,
    lightSteps: LIGHT_STEPS,
    envelopeSize: config.envelopeSize,
    backend: "TSL->WGSL/WebGPU",
  };

  console.info(`[clouds] Nubis v2 WebGPU cloud raymarch active (${RAY_STEPS} adaptive view / ${LIGHT_STEPS} light samples)`);
}

function tuneNubisWeather(handle, dt, windX, windZ, rainIntensity) {
  const u = handle?.uniforms;
  if (!u) return;

  const state = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(state?.stormIntensity ?? rainIntensity);
  const safeDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
  const convection = clamp01(state?.convection ?? u.convection?.value ?? 0.78);
  const wx = Number(windX) || 0;
  const wz = Number(windZ) || 0;

  // A gentle prevailing trade wind guarantees visible motion even when the
  // weather controller reports calm conditions. Weather wind is layered on top.
  const prevailingX = 0.72;
  const prevailingZ = 0.24;
  const envVX = prevailingX + wx * 0.65;
  const envVZ = prevailingZ + wz * 0.65;
  const baseVX = prevailingX * 1.08 + wx;
  const baseVZ = prevailingZ * 1.08 + wz;
  const detailVX = prevailingX * 1.45 + wx * 1.25;
  const detailVZ = prevailingZ * 1.45 + wz * 1.25;

  handle.__riftNubisClock += safeDt;
  handle.__riftNubisMorphPhase = (handle.__riftNubisMorphPhase + safeDt * THREE.MathUtils.lerp(1 / 52, 1 / 30, storm)) % 1;

  // Envelope B travels at a slightly different speed/direction. Cross-fading
  // between A and B therefore grows/dissolves cells rather than fading between
  // two perfectly registered masks.
  handle.__riftNubisEnvelopeAX += envVX * safeDt * 0.00050;
  handle.__riftNubisEnvelopeAY += envVZ * safeDt * 0.00050;
  handle.__riftNubisEnvelopeBX += (envVX * 0.87 - envVZ * 0.10) * safeDt * 0.00047;
  handle.__riftNubisEnvelopeBY += (envVZ * 0.91 + envVX * 0.08) * safeDt * 0.00047;

  // The 3D mass, warp field and erosion travel independently. This is the main
  // reason silhouettes now change instead of behaving like one rigid texture.
  handle.__riftNubisBaseX += baseVX * safeDt * 0.00072;
  handle.__riftNubisBaseZ += baseVZ * safeDt * 0.00072;
  handle.__riftNubisBaseY += safeDt * (0.000050 + convection * 0.000060);
  handle.__riftNubisDetailX += detailVX * safeDt * 0.00170;
  handle.__riftNubisDetailZ += detailVZ * safeDt * 0.00170;
  handle.__riftNubisDetailY += safeDt * (0.00016 + convection * 0.00018);
  handle.__riftNubisWarpX += (prevailingX * 0.44 + wx * 0.32) * safeDt * 0.00030;
  handle.__riftNubisWarpZ += (prevailingZ * 0.44 + wz * 0.32) * safeDt * 0.00030;
  handle.__riftNubisWarpY += safeDt * 0.000025;

  const rawMorph = 0.5 - 0.5 * Math.cos(TAU * handle.__riftNubisMorphPhase);
  const morphBlend = smooth01(rawMorph);
  u.nubisEnvelopeOffsetA.value.set(handle.__riftNubisEnvelopeAX, handle.__riftNubisEnvelopeAY);
  u.nubisEnvelopeOffsetB.value.set(handle.__riftNubisEnvelopeBX, handle.__riftNubisEnvelopeBY);
  u.nubisMorphBlend.value = morphBlend;
  u.nubisBaseOffset.value.set(handle.__riftNubisBaseX, handle.__riftNubisBaseY, handle.__riftNubisBaseZ);
  u.nubisDetailOffset.value.set(handle.__riftNubisDetailX, handle.__riftNubisDetailY, handle.__riftNubisDetailZ);
  u.nubisWarpOffset.value.set(handle.__riftNubisWarpX, handle.__riftNubisWarpY, handle.__riftNubisWarpZ);

  // Upper-level wind shear changes slowly, making towers lean and peel apart.
  const age = handle.__riftNubisClock;
  u.nubisShear.value.set(
    11 + wx * 2.6 + Math.sin(age * 0.085) * 5.5,
    4.5 + wz * 2.6 + Math.cos(age * 0.072) * 4.0,
  );

  handle.__riftNubisJitterIndex = (handle.__riftNubisJitterIndex + 1) % TEMPORAL_JITTER.length;
  u.nubisFrameJitter.value = TEMPORAL_JITTER[handle.__riftNubisJitterIndex];

  // Large tropical cumulus by default. Storms make deeper, denser systems.
  if (u.pwBaseScale) u.pwBaseScale.value = THREE.MathUtils.lerp(0.27, 0.36, storm);
  if (u.pwDetailScale) u.pwDetailScale.value = THREE.MathUtils.lerp(5.35, 4.45, storm);
  if (u.pwDensityBias) u.pwDensityBias.value = THREE.MathUtils.lerp(-0.085, -0.038, storm);
  if (u.coverage) u.coverage.value = clamp01(Math.max(Number(u.coverage.value) || 0, THREE.MathUtils.lerp(0.50, 0.82, storm)));
  if (u.density) u.density.value = clamp01(Math.max(Number(u.density.value) || 0, THREE.MathUtils.lerp(0.57, 0.79, storm)));
  if (u.humidity) u.humidity.value = clamp01(Math.max(Number(u.humidity.value) || 0, THREE.MathUtils.lerp(0.68, 0.92, storm)));
  if (u.convection) u.convection.value = clamp01(Math.max(Number(u.convection.value) || 0, THREE.MathUtils.lerp(0.80, 0.97, storm)));
  if (u.erosion) u.erosion.value = Math.min(Number(u.erosion.value) || 0.7, THREE.MathUtils.lerp(0.38, 0.27, storm));

  if (u.nubisEnvelopeStrength) u.nubisEnvelopeStrength.value = THREE.MathUtils.lerp(0.92, 1.0, storm);
  if (u.nubisEdgeErosion) u.nubisEdgeErosion.value = THREE.MathUtils.lerp(0.33, 0.25, storm);
  if (u.nubisDensityScale) u.nubisDensityScale.value = THREE.MathUtils.lerp(1.08, 1.17, storm);
  if (u.nubisAmbientBoost) u.nubisAmbientBoost.value = THREE.MathUtils.lerp(0.80, 0.60, storm);
  if (u.nubisMultiScatter) u.nubisMultiScatter.value = THREE.MathUtils.lerp(0.35, 0.24, storm);
  if (u.nubisLightExtinction) u.nubisLightExtinction.value = THREE.MathUtils.lerp(0.51, 0.70, storm);
  if (u.nubisDomainWarp) u.nubisDomainWarp.value = THREE.MathUtils.lerp(0.060, 0.044, storm);
  if (u.nubisVerticalStretch) u.nubisVerticalStretch.value = THREE.MathUtils.lerp(0.68, 0.61, storm);

  if (u.referenceGuideStrength) u.referenceGuideStrength.value = 0;
  if (u.referencePaletteStrength) u.referencePaletteStrength.value = THREE.MathUtils.lerp(0.14, 0.28, storm);

  const baseTarget = THREE.MathUtils.lerp(38, 29, storm);
  const topTarget = THREE.MathUtils.lerp(218, 265, storm);
  if (u.cloudBaseY) u.cloudBaseY.value = Math.min(Number(u.cloudBaseY.value) || 58, baseTarget);
  if (u.cloudTopY) u.cloudTopY.value = Math.max(Number(u.cloudTopY.value) || 108, topTarget);

  const baseY = Number(u.cloudBaseY?.value) || baseTarget;
  if (handle.mesh) handle.mesh.position.y = baseY;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;

  if (handle.__riftCirrus?.material) {
    handle.__riftCirrus.material.opacity = THREE.MathUtils.lerp(0.018, 0.006, storm);
  }
}

export function createVolumetricClouds(scene) {
  const handle = createPerlinWorleyClouds(scene);
  if (!handle) return handle;

  const config = qualityForNubis(handle);
  handle.__riftNubisV2Quality = config;
  handle.__riftNubisEnvelopes = createNubisEnvelopePair(config.envelopeSize);

  handle.__riftNubisEnvelopeAX = Math.random();
  handle.__riftNubisEnvelopeAY = Math.random();
  handle.__riftNubisEnvelopeBX = Math.random();
  handle.__riftNubisEnvelopeBY = Math.random();
  handle.__riftNubisBaseX = Math.random();
  handle.__riftNubisBaseY = Math.random();
  handle.__riftNubisBaseZ = Math.random();
  handle.__riftNubisDetailX = Math.random();
  handle.__riftNubisDetailY = Math.random();
  handle.__riftNubisDetailZ = Math.random();
  handle.__riftNubisWarpX = Math.random();
  handle.__riftNubisWarpY = Math.random();
  handle.__riftNubisWarpZ = Math.random();
  handle.__riftNubisClock = 0;
  handle.__riftNubisMorphPhase = Math.random();
  handle.__riftNubisJitterIndex = 0;

  installNubisUniforms(handle);
  handle.__riftNubisV2ShaderInstalled = false;
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
  updatePerlinWorleyClouds(
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
  installNubisShader(handle);
  tuneNubisWeather(handle, dt, windX, windZ, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  handle?.__riftNubisEnvelopes?.a?.dispose?.();
  handle?.__riftNubisEnvelopes?.b?.dispose?.();
  if (handle) {
    handle.__riftNubisEnvelopes = null;
    handle.__riftNubisV2Quality = null;
  }
  delete globalThis.__riftNubisCloudDebug;
  return disposePerlinWorleyClouds(handle);
}
