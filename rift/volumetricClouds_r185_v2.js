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
  screenUV,
  screenSize,
  luminance,
  max as tslMax,
  min as tslMin,
} from "three/tsl";
import {
  createVolumetricClouds as createProgressiveClouds,
  updateVolumetricClouds as updateProgressiveClouds,
  disposeVolumetricClouds as disposeProgressiveClouds,
} from "./volumetricClouds_progressive_v1.js";
import { createR185ClusteredEnvelopePair } from "./cloudEnvelopeR185_v2.js";

// -----------------------------------------------------------------------------
// r185 cloud density v2.
//
// This is the first pass on the migration branch that replaces Nubis' visible
// density equation instead of only tuning it. Goals:
//   * clustered macro placement rather than giant continuous domes;
//   * a normalized local-height profile with a flat condensation base;
//   * 3D Worley channels carve the upper half into rounded cauliflower lobes;
//   * detail erosion acts mostly at the cloud boundary, not through the core;
//   * stable spatial/nonuniform march jitter breaks horizontal ray-step shelves;
//   * directional Beer-Lambert lighting keeps cloud interiors readable;
//   * a cheap five-tap spatial reconstruction softens quarter-res pixel columns.
//
// Temporal 4x4 history reconstruction comes after this shape pass is validated.
// Keeping the history problem separate makes failures easy to isolate on iOS.
// -----------------------------------------------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function installClusteredEnvelope(handle) {
  if (!handle || handle.__riftR185V2EnvelopeInstalled) return;
  const config = handle.__riftProgressiveQuality || handle.__riftNubisV2Quality;
  const size = Math.max(128, Number(config?.envelopeSize) || 160);

  handle.__riftNubisEnvelopes?.a?.dispose?.();
  handle.__riftNubisEnvelopes?.b?.dispose?.();
  handle.__riftNubisEnvelopes = createR185ClusteredEnvelopePair(size);
  handle.__riftR185V2EnvelopeInstalled = true;
}

function installR185V2Uniforms(handle) {
  const u = handle?.uniforms;
  if (!u || handle.__riftR185V2UniformsInstalled) return;

  u.r185MacroScale = uniform(0.00068);
  u.r185TopBillow = uniform(0.78);
  u.r185SideBillow = uniform(0.34);
  u.r185DensityContrast = uniform(2.62);
  u.r185SpatialDither = uniform(0.14);
  handle.__riftR185V2UniformsInstalled = true;
}

function installR185DensityShader(handle) {
  if (
    !handle?.material ||
    !handle?.__riftPWVolumes?.baseTexture ||
    !handle?.__riftPWVolumes?.detailTexture ||
    !handle?.__riftNubisEnvelopes?.a ||
    !handle?.__riftNubisEnvelopes?.b ||
    handle.__riftR185V2ShaderInstalled
  ) return;

  installR185V2Uniforms(handle);

  const u = handle.uniforms;
  const baseTex = handle.__riftPWVolumes.baseTexture;
  const detailTex = handle.__riftPWVolumes.detailTexture;
  const weatherTex = handle.weatherTexture;
  const envelopeA = handle.__riftNubisEnvelopes.a;
  const envelopeB = handle.__riftNubisEnvelopes.b;
  const config = handle.__riftProgressiveQuality || handle.__riftNubisV2Quality;
  const RAY_STEPS = Math.max(24, Number(config?.viewSteps) || 32);
  const LIGHT_STEPS = Math.max(2, Number(config?.lightSteps) || 3);
  const TILE_SCALE = float(handle.quality.tileScale);
  const WEATHER_SCALE = float(handle.quality.weatherScale);
  const ENVELOPE_TEXEL = float(1 / Math.max(128, Number(config?.envelopeSize) || 160));
  const MAX_DISTANCE = float(handle.quality.maxRayDistance);

  const sampleEnvelope5 = (tex, uvNode) => {
    const dx = vec2(ENVELOPE_TEXEL, float(0));
    const dz = vec2(float(0), ENVELOPE_TEXEL);
    return texture(tex, uvNode).mul(0.44)
      .add(texture(tex, uvNode.add(dx).fract()).mul(0.14))
      .add(texture(tex, uvNode.sub(dx).fract()).mul(0.14))
      .add(texture(tex, uvNode.add(dz).fract()).mul(0.14))
      .add(texture(tex, uvNode.sub(dz).fract()).mul(0.14));
  };

  const sampleEnvelopePair = (uvNode, filtered = true) => {
    const uvA = uvNode.add(u.nubisEnvelopeOffsetA).fract();
    const uvB = uvNode.add(u.nubisEnvelopeOffsetB).fract();
    const a = filtered ? sampleEnvelope5(envelopeA, uvA) : texture(envelopeA, uvA);
    const b = filtered ? sampleEnvelope5(envelopeB, uvB) : texture(envelopeB, uvB);
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

    // A stable spatial offset removes coherent step bands without the visible
    // frame-to-frame shimmer caused by animated whole-frame jitter.
    const nominalStep = marchLength.div(float(RAY_STEPS).mul(0.88)).toVar();
    const jitterUV = vec2(positionWorld.x, positionWorld.z)
      .mul(0.0137)
      .add(u.weatherOffset.mul(2.31))
      .fract();
    const jitterNoise = texture(weatherTex, jitterUV);
    const jitter = jitterNoise.g.mul(0.72).add(jitterNoise.b.mul(0.18)).add(0.05);
    const t = tStart.add(nominalStep.mul(jitter)).toVar();
    const transmittance = float(1).toVar();
    const scattered = vec3(0, 0, 0).toVar();

    const mu = clamp(dot(rayDir, u.sunDir), -1, 1);
    const fDenom = float(1.4225).sub(mu.mul(1.30)).max(0.045);
    const bDenom = float(1.04).add(mu.mul(0.40)).max(0.08);
    const phaseForward = float(0.5775).div(pow(fDenom, 1.5));
    const phaseBackward = float(0.96).div(pow(bDenom, 1.5));
    const phase0 = phaseForward.mul(0.78).add(phaseBackward.mul(0.22)).mul(0.31).add(0.07);
    const phase1 = phase0.mul(0.68).add(0.085);
    const phase2 = phase0.mul(0.43).add(0.12);

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
        const envelopeUV = vec2(pos.x, pos.z).mul(u.r185MacroScale).fract();
        const envelope = sampleEnvelopePair(envelopeUV, true);
        const storm = u.stormDarken;

        // Macro height varies continuously through the clustered envelope. The
        // cloud base is deliberately almost flat; top potential collapses around
        // each lobe's edge and rises only at convective centers.
        const localBase = envelope.r.mul(mix(float(0.50), float(0.30), storm));
        const convLift = weatherSample.g.mul(u.convection).mul(mix(float(0.07), float(0.16), storm));
        const stormLift = storm.mul(float(1).sub(envelope.g)).mul(0.42);
        const localTop = envelope.g.add(convLift).add(stormLift)
          .min(0.995)
          .max(localBase.add(0.14));
        const localHeight = clamp(
          height01.sub(localBase).div(localTop.sub(localBase).max(0.035)),
          0,
          1,
        );
        const cloudType = clamp(
          envelope.b.add(weatherSample.g.mul(u.convection).mul(0.10)).add(storm.mul(0.20)),
          0,
          1,
        );

        const lowerProfile = smoothstep(float(0.006), float(0.060), localHeight);
        const topStart = mix(float(0.52), float(0.69), cloudType);
        const upperProfile = float(1).sub(
          smoothstep(topStart, float(0.995), localHeight),
        );
        const verticalProfile = lowerProfile.mul(upperProfile);

        const weatherField = weatherSample.r.mul(0.42).add(envelope.a.mul(0.58));
        const coverageThreshold = float(1).sub(u.coverage);
        const coverageMask = smoothstep(
          coverageThreshold.sub(0.13),
          coverageThreshold.add(0.12),
          weatherField,
        );

        // Only a very small upper shear remains. The previous large shear made
        // one cloud tower appear as a pile of offset horizontal shelves.
        const shearHeight = smoothstep(float(0.58), float(0.96), localHeight)
          .mul(cloudType)
          .mul(0.12);
        const densityPos = pos.add(vec3(
          u.nubisShear.x.mul(shearHeight),
          float(0),
          u.nubisShear.y.mul(shearHeight),
        ));

        // Isotropic 3D coordinates: do not vertically stretch every lobe. A mild
        // Y compression under storms is enough for deeper systems while clear
        // cumulus remains rounded.
        const yCompression = mix(float(1.0), float(0.82), storm.mul(cloudType));
        const shapedPos = vec3(
          densityPos.x,
          u.cloudBaseY.add(densityPos.y.sub(u.cloudBaseY).mul(yCompression)),
          densityPos.z,
        );

        const warpUV = shapedPos
          .mul(TILE_SCALE.mul(u.pwBaseScale).mul(0.31))
          .add(u.nubisWarpOffset)
          .fract();
        const warpNoise = texture3D(baseTex, warpUV);
        const warpVector = vec3(warpNoise.g, warpNoise.b, warpNoise.a)
          .sub(0.5)
          .mul(u.nubisDomainWarp);

        const baseUV = shapedPos
          .mul(TILE_SCALE.mul(u.pwBaseScale))
          .add(u.nubisBaseOffset)
          .add(warpVector)
          .fract();
        const baseNoise = texture3D(baseTex, baseUV);
        const worleyFbm = baseNoise.g.mul(0.625)
          .add(baseNoise.b.mul(0.25))
          .add(baseNoise.a.mul(0.125));
        const broadSignal = baseNoise.r.mul(0.80).add(worleyFbm.mul(0.20));

        // Key r185 v2 shape change: upper portions are modulated by the actual
        // 3D Worley cells. Instead of a smooth 2D dome, cloud crowns resolve into
        // multiple rounded lobes/shoulders while the lower body stays coherent.
        const topAmount = smoothstep(float(0.34), float(0.94), localHeight);
        const topCells = smoothstep(float(0.38), float(0.84), worleyFbm);
        const billowMask = mix(
          float(1),
          topCells.mul(float(0.78)).add(0.22),
          topAmount.mul(u.r185TopBillow),
        );
        const sideCells = smoothstep(float(0.28), float(0.76), baseNoise.g);
        const sideAmount = smoothstep(float(0.16), float(0.72), localHeight)
          .mul(float(1).sub(topAmount.mul(0.55)));
        const sideBillowMask = mix(
          float(1),
          sideCells.mul(0.70).add(0.30),
          sideAmount.mul(u.r185SideBillow),
        );

        const dimensionalProfile = verticalProfile
          .mul(coverageMask)
          .mul(billowMask)
          .mul(sideBillowMask)
          .mul(mix(float(0.76), float(1.13), envelope.a));

        const coarseDensity = clamp(
          broadSignal
            .sub(float(1).sub(dimensionalProfile))
            .mul(u.r185DensityContrast)
            .add(u.pwDensityBias)
            .mul(u.nubisDensityScale),
          0,
          1,
        ).mul(u.density);

        const hitWeight = smoothstep(float(0.006), float(0.070), coarseDensity);
        let adaptiveAdvance = mix(
          nominalStep.mul(1.78),
          nominalStep.mul(0.70),
          hitWeight,
        );
        // Sample-dependent step modulation destroys coherent ray-depth shelves
        // while remaining temporally stable for a fixed cloud field.
        adaptiveAdvance = adaptiveAdvance.mul(
          mix(float(0.94), float(1.06), baseNoise.a.mul(u.r185SpatialDither).add(0.43)),
        ).toVar();

        If(coarseDensity.greaterThan(0.004), () => {
          const detailUV = shapedPos
            .mul(TILE_SCALE.mul(u.pwDetailScale))
            .add(u.nubisDetailOffset)
            .add(warpVector.mul(1.28))
            .fract();
          const detail = texture3D(detailTex, detailUV);
          const detailFbm = detail.a.mul(0.64)
            .add(detail.r.mul(0.22))
            .add(detail.g.mul(0.14));
          const edgeBand = float(1).sub(coarseDensity).mul(coarseDensity).mul(4.0);
          const upperErosion = float(1).add(topAmount.mul(0.34));
          const erosionSignal = float(1).sub(detailFbm);
          const localDensity = clamp(
            coarseDensity.sub(
              erosionSignal
                .mul(u.nubisEdgeErosion)
                .mul(u.erosion)
                .mul(edgeBand)
                .mul(upperErosion),
            ),
            0,
            1,
          ).mul(mix(float(0.88), float(1.12), u.humidity.mul(weatherSample.b)));

          const opticalDepth = float(0).toVar();
          Loop(LIGHT_STEPS, ({ i }) => {
            const lightDistance = float(13).mul(float(i).add(1));
            const lp = pos.add(u.sunDir.mul(lightDistance));
            const lh = clamp(lp.y.sub(u.cloudBaseY).div(slabThickness), 0, 1);
            const leuv = vec2(lp.x, lp.z).mul(u.r185MacroScale).fract();
            const le = sampleEnvelopePair(leuv, false);
            const lbaseH = le.r.mul(0.45);
            const ltopH = le.g.add(storm.mul(float(1).sub(le.g)).mul(0.42))
              .min(0.995)
              .max(lbaseH.add(0.14));
            const lhLocal = clamp(lh.sub(lbaseH).div(ltopH.sub(lbaseH).max(0.035)), 0, 1);
            const lprofile = smoothstep(float(0.006), float(0.060), lhLocal)
              .mul(float(1).sub(smoothstep(float(0.58), float(0.995), lhLocal)));
            const lbase = texture3D(
              baseTex,
              lp.mul(TILE_SCALE.mul(u.pwBaseScale))
                .add(u.nubisBaseOffset)
                .fract(),
            );
            const lworley = lbase.g.mul(0.625).add(lbase.b.mul(0.25)).add(lbase.a.mul(0.125));
            const lsignal = lbase.r.mul(0.82).add(lworley.mul(0.18));
            const ldim = lprofile.mul(mix(float(0.72), float(1.08), le.a));
            const lcoarse = clamp(
              lsignal.sub(float(1).sub(ldim)).mul(2.35).mul(u.density),
              0,
              1,
            );
            opticalDepth.addAssign(lcoarse);
          });

          const lightDepth = opticalDepth.mul(u.nubisLightExtinction);
          const beer0 = exp(lightDepth.negate());
          const beer1 = exp(lightDepth.mul(-0.50));
          const beer2 = exp(lightDepth.mul(-0.24));
          const multipleScatter = beer0.mul(phase0)
            .add(beer1.mul(phase1).mul(0.46))
            .add(beer2.mul(phase2).mul(0.20))
            .add(u.nubisMultiScatter.mul(0.08));

          const powder = float(1).sub(exp(localDensity.mul(-2.1)));
          const heightLight = smoothstep(float(0.03), float(0.80), localHeight);
          const ambientLight = u.ambientColor
            .mul(u.nubisAmbientBoost)
            .mul(float(0.58).add(heightLight.mul(0.28)).add(powder.mul(0.12)));
          const directLight = u.sunColor
            .mul(multipleScatter)
            .mul(float(0.86).add(heightLight.mul(0.46)));
          const silverEdge = u.sunColor
            .mul(pow(float(1).sub(coarseDensity), 2.2))
            .mul(phase0)
            .mul(0.24)
            .mul(float(1).sub(storm.mul(0.60)));
          const stormShade = mix(
            ambientLight.add(directLight).add(silverEdge),
            u.ambientColor.mul(0.42).add(directLight.mul(0.54)),
            storm.mul(0.66),
          );
          const flash = u.lightningColor
            .mul(u.lightningFlash)
            .mul(float(0.45).add(localDensity.mul(1.25)));

          const extinction = mix(float(0.038), float(0.068), storm);
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

    const skyward = smoothstep(float(0.001), float(0.036), rayDir.y);
    const horizonFade = smoothstep(float(0.003), float(0.030), rayDir.y.abs());
    const alpha = float(1).sub(transmittance).mul(skyward).mul(horizonFade);
    return vec4(scattered, alpha);
  })();

  handle.material.needsUpdate = true;
  handle.__riftR185V2ShaderInstalled = true;

  globalThis.__riftR185CloudShaderDebug = {
    enabled: true,
    version: 2,
    threeRevision: THREE.REVISION,
    architecture: "clustered envelope + normalized height + 3D upper billow + edge-only erosion",
    viewSteps: RAY_STEPS,
    lightSteps: LIGHT_STEPS,
  };

  console.info(
    `[clouds] r185 density v2 active (${RAY_STEPS} view / ${LIGHT_STEPS} light): clustered rounded cumulus`,
  );
}

function installSpatialReconstruction(handle) {
  const state = handle?.__riftTemporalCloudState;
  const config = handle?.__riftProgressiveQuality;
  if (!state || !config || state.__riftR185SpatialReconstructionInstalled) return;

  const cloudTextureNode = state.cloudPass?.getTextureNode?.("output");
  const displayMaterial = state.displayMaterial;
  if (!cloudTextureNode || !displayMaterial) return;

  const scale = float(Math.max(0.20, Number(config.resolutionScale) || 0.25));
  const invLowRes = vec2(
    float(1).div(screenSize.x.mul(scale)),
    float(1).div(screenSize.y.mul(scale)),
  );
  const dx = vec2(invLowRes.x, float(0));
  const dy = vec2(float(0), invLowRes.y);
  const center = cloudTextureNode.sample(screenUV);
  const left = cloudTextureNode.sample(screenUV.sub(dx));
  const right = cloudTextureNode.sample(screenUV.add(dx));
  const down = cloudTextureNode.sample(screenUV.sub(dy));
  const up = cloudTextureNode.sample(screenUV.add(dy));

  // Preserve most of the original bilinear center sample, then use neighboring
  // low-res texels only to remove obvious quarter-resolution columns/steps.
  const reconstructed = center.mul(0.72)
    .add(left.mul(0.07))
    .add(right.mul(0.07))
    .add(down.mul(0.07))
    .add(up.mul(0.07));
  const hasRadiance = smoothstep(
    float(0.00045),
    float(0.0075),
    luminance(reconstructed.rgb),
  );

  displayMaterial.colorNode = reconstructed.rgb;
  displayMaterial.opacityNode = reconstructed.a.mul(hasRadiance);
  displayMaterial.transparent = true;
  displayMaterial.blending = THREE.NormalBlending;
  displayMaterial.premultipliedAlpha = false;
  displayMaterial.depthWrite = false;
  displayMaterial.depthTest = true;
  displayMaterial.forceSinglePass = true;
  displayMaterial.toneMapped = false;
  displayMaterial.needsUpdate = true;

  state.__riftR185SpatialReconstructionInstalled = true;
  globalThis.__riftR185CloudReconstructionDebug = {
    enabled: true,
    threeRevision: THREE.REVISION,
    sourceScale: Number(config.resolutionScale) || 0.25,
    mode: "five-tap edge-preserving spatial",
    temporalHistory: false,
  };
}

function tuneR185V2(handle, rainIntensity) {
  const u = handle?.uniforms;
  if (!u) return;

  const weather = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(weather?.stormIntensity ?? rainIntensity);
  const requestedCoverage = clamp01(weather?.cloudCoverage ?? 0.30);

  // Fair-weather reference target: separated cloud families and plenty of blue
  // sky. Storms can still grow into a connected deck.
  if (u.coverage) {
    const fair = THREE.MathUtils.clamp(requestedCoverage, 0.21, 0.34);
    u.coverage.value = THREE.MathUtils.lerp(fair, 0.80, storm);
  }
  if (u.density) u.density.value = THREE.MathUtils.lerp(0.49, 0.80, storm);
  if (u.humidity) u.humidity.value = THREE.MathUtils.lerp(0.66, 0.93, storm);
  if (u.convection) u.convection.value = THREE.MathUtils.lerp(0.78, 0.98, storm);
  if (u.erosion) u.erosion.value = THREE.MathUtils.lerp(0.48, 0.29, storm);

  // Higher macro frequency than v1: multiple cloud lobes should fit in one
  // system instead of one featureless white dome filling the screen.
  if (u.pwBaseScale) u.pwBaseScale.value = THREE.MathUtils.lerp(0.50, 0.42, storm);
  if (u.pwDetailScale) u.pwDetailScale.value = THREE.MathUtils.lerp(5.9, 4.7, storm);
  if (u.pwDensityBias) u.pwDensityBias.value = THREE.MathUtils.lerp(-0.092, -0.030, storm);

  if (u.nubisEnvelopeStrength) u.nubisEnvelopeStrength.value = THREE.MathUtils.lerp(0.52, 0.90, storm);
  if (u.nubisEdgeErosion) u.nubisEdgeErosion.value = THREE.MathUtils.lerp(0.44, 0.28, storm);
  if (u.nubisDensityScale) u.nubisDensityScale.value = THREE.MathUtils.lerp(0.92, 1.14, storm);
  if (u.nubisDomainWarp) u.nubisDomainWarp.value = THREE.MathUtils.lerp(0.040, 0.048, storm);
  if (u.nubisAmbientBoost) u.nubisAmbientBoost.value = THREE.MathUtils.lerp(0.38, 0.43, storm);
  if (u.nubisMultiScatter) u.nubisMultiScatter.value = THREE.MathUtils.lerp(0.22, 0.24, storm);
  if (u.nubisLightExtinction) u.nubisLightExtinction.value = THREE.MathUtils.lerp(0.70, 0.78, storm);

  if (u.r185MacroScale) u.r185MacroScale.value = THREE.MathUtils.lerp(0.00078, 0.00058, storm);
  if (u.r185TopBillow) u.r185TopBillow.value = THREE.MathUtils.lerp(0.82, 0.68, storm);
  if (u.r185SideBillow) u.r185SideBillow.value = THREE.MathUtils.lerp(0.40, 0.30, storm);
  if (u.r185DensityContrast) u.r185DensityContrast.value = THREE.MathUtils.lerp(2.72, 2.48, storm);
  if (u.r185SpatialDither) u.r185SpatialDither.value = 0.14;

  // Stop the old Nubis frame-wide jitter and large shear from reappearing after
  // its weather updater runs. Motion comes from the independently advected 3D
  // fields, not from moving every ray sample each frame.
  if (u.nubisFrameJitter) u.nubisFrameJitter.value = 0.5;
  if (u.nubisShear?.value) {
    u.nubisShear.value.multiplyScalar(THREE.MathUtils.lerp(0.035, 0.14, storm));
  }
  if (u.referenceGuideStrength) u.referenceGuideStrength.value = 0;
  if (u.referencePaletteStrength) u.referencePaletteStrength.value = 0;

  const baseTarget = THREE.MathUtils.lerp(50, 32, storm);
  const topTarget = THREE.MathUtils.lerp(166, 246, storm);
  if (u.cloudBaseY) u.cloudBaseY.value = baseTarget;
  if (u.cloudTopY) u.cloudTopY.value = topTarget;

  const baseY = Number(u.cloudBaseY?.value) || baseTarget;
  if (handle.mesh) handle.mesh.position.y = baseY;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;

  if (handle.__riftCirrus?.material) {
    handle.__riftCirrus.material.opacity = THREE.MathUtils.lerp(0.008, 0.004, storm);
  }

  globalThis.__riftR185CloudDebug = {
    enabled: true,
    version: 2,
    threeRevision: THREE.REVISION,
    coverage: Number(u.coverage?.value) || 0,
    density: Number(u.density?.value) || 0,
    baseScale: Number(u.pwBaseScale?.value) || 0,
    erosion: Number(u.nubisEdgeErosion?.value) || 0,
    cloudBase: Number(u.cloudBaseY?.value) || 0,
    cloudTop: Number(u.cloudTopY?.value) || 0,
    reconstruction: globalThis.__riftR185CloudReconstructionDebug?.mode || "pending",
    storm,
  };
}

export function createVolumetricClouds(scene) {
  const handle = createProgressiveClouds(scene);
  if (!handle) return handle;
  installClusteredEnvelope(handle);
  installR185V2Uniforms(handle);
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
  updateProgressiveClouds(
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
  installR185DensityShader(handle);
  installSpatialReconstruction(handle);
  tuneR185V2(handle, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  if (handle) {
    handle.__riftR185V2EnvelopeInstalled = false;
    handle.__riftR185V2UniformsInstalled = false;
    handle.__riftR185V2ShaderInstalled = false;
  }
  delete globalThis.__riftR185CloudDebug;
  delete globalThis.__riftR185CloudShaderDebug;
  delete globalThis.__riftR185CloudReconstructionDebug;
  return disposeProgressiveClouds(handle);
}
