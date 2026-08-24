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
import { createNubisEnvelopeTexture } from "./cloudEnvelopeNubis.js";

// -----------------------------------------------------------------------------
// Nubis-inspired production cloud renderer for Rift's WebGPU path.
//
// Conceptually follows the architecture demonstrated by Faraz Shaikh's
// three-volumetric-clouds experiment / Guerrilla's Nubis work:
//   1. a low-frequency 2D envelope defines base/top/type/density;
//   2. a true 3D Perlin-Worley volume supplies broad cloud mass;
//   3. a separate 3D Worley volume erodes only the cloud boundary;
//   4. empty-space samples advance farther than samples inside cloud;
//   5. light is marched through the same broad density field;
//   6. Beer-Lambert + dual-lobe HG + multi-scattering light the volume.
//
// This is an independent TSL/WebGPU implementation rather than copied source.
// The linked project is WebGL/ShaderMaterial; Rift remains WebGPU and Three.js
// compiles this TSL graph to WGSL.
// -----------------------------------------------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function qualityForNubis(handle) {
  const inherited = Number(handle?.__riftPWQuality?.viewSteps ?? handle?.quality?.raySteps) || 10;
  if (inherited <= 10) return { viewSteps: 12, lightSteps: 2, envelopeSize: 128 };
  if (inherited <= 14) return { viewSteps: 16, lightSteps: 3, envelopeSize: 160 };
  return { viewSteps: 22, lightSteps: 4, envelopeSize: 192 };
}

function installNubisUniforms(handle) {
  if (!handle?.uniforms || handle.__riftNubisUniformsInstalled) return;
  const u = handle.uniforms;
  u.nubisEnvelopeOffset = uniform(new THREE.Vector2());
  u.nubisEnvelopeStrength = uniform(0.94);
  u.nubisEdgeErosion = uniform(0.34);
  u.nubisDensityScale = uniform(1.06);
  u.nubisAmbientBoost = uniform(0.72);
  u.nubisMultiScatter = uniform(0.32);
  u.nubisLightExtinction = uniform(0.56);
  handle.__riftNubisUniformsInstalled = true;
}

function installNubisShader(handle) {
  if (!handle?.material || !handle?.__riftPWVolumes || !handle?.__riftNubisEnvelope || handle.__riftNubisShaderInstalled) return;
  installNubisUniforms(handle);

  const u = handle.uniforms;
  const baseTex = handle.__riftPWVolumes.baseTexture;
  const detailTex = handle.__riftPWVolumes.detailTexture;
  const weatherTex = handle.weatherTexture;
  const envelopeTex = handle.__riftNubisEnvelope;
  const config = handle.__riftNubisQuality;
  const RAY_STEPS = config.viewSteps;
  const LIGHT_STEPS = config.lightSteps;
  const TILE_SCALE = float(handle.quality.tileScale);
  const WEATHER_SCALE = float(handle.quality.weatherScale);
  const ENVELOPE_SCALE = float(0.00054);
  const MAX_DISTANCE = float(handle.quality.maxRayDistance);

  handle.material.colorNode = Fn(() => {
    const rayOrigin = cameraPosition;
    const rayDir = normalize(positionWorld.sub(cameraPosition));
    const safeY = rayDir.y.abs().max(0.001);
    const t0Raw = u.cloudBaseY.sub(rayOrigin.y).div(rayDir.y);
    const t1Raw = u.cloudTopY.sub(rayOrigin.y).div(rayDir.y);
    const tNear = tslMin(t0Raw, t1Raw);
    const tFar = tslMax(t0Raw, t1Raw);
    const tStart = tslMax(tNear, float(0));
    const tEnd = tslMin(tFar, tStart.add(MAX_DISTANCE));
    const marchLength = tslMax(tEnd.sub(tStart), float(0));

    // Nominal step is intentionally a little larger than a uniform RAY_STEPS
    // subdivision. Dense samples shrink to ~72%; empty samples expand to ~180%.
    // That approximates the source project's coarse-to-fine adaptive march while
    // keeping a compile-time loop count that is safe for WebGPU/TSL.
    const nominalStep = marchLength.div(float(RAY_STEPS).mul(0.82)).toVar();
    const jitterUV = vec2(positionWorld.x, positionWorld.z)
      .mul(0.0119)
      .add(u.weatherOffset.mul(2.13))
      .fract();
    const jitter = texture(weatherTex, jitterUV).g.mul(0.82).add(0.08);
    const t = tStart.add(nominalStep.mul(jitter)).toVar();
    const transmittance = float(1).toVar();
    const scattered = vec3(0, 0, 0).toVar();

    // Dual-lobe Henyey-Greenstein phase approximation. The forward lobe is what
    // creates bright silver cloud edges around the real Sun; a weak backward
    // lobe prevents the opposite side of the cloud from becoming dead gray.
    const mu = clamp(dot(rayDir, u.sunDir), -1, 1);
    const fDenom = float(1.4225).sub(mu.mul(1.30)).max(0.045); // g=+0.65
    const bDenom = float(1.04).add(mu.mul(0.40)).max(0.08);   // g=-0.20
    const phaseForward = float(0.5775).div(pow(fDenom, 1.5));
    const phaseBackward = float(0.96).div(pow(bDenom, 1.5));
    const phase0 = phaseForward.mul(0.79).add(phaseBackward.mul(0.21)).mul(0.30).add(0.075);
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

        // The independent envelope is the key architectural change from the
        // previous shader. It defines where a cloud is allowed to exist and how
        // tall that local formation may become before 3D noise erodes it.
        const envelopeUV = vec2(pos.x, pos.z)
          .mul(ENVELOPE_SCALE)
          .add(u.nubisEnvelopeOffset)
          .fract();
        const envelope = texture(envelopeTex, envelopeUV);
        const storm = u.stormDarken;
        const localBase = envelope.r.mul(mix(float(1.0), float(0.68), storm));
        const stormLift = storm.mul(float(1).sub(envelope.g)).mul(0.78);
        const convLift = weatherSample.g.mul(u.convection).mul(0.12);
        const localTop = envelope.g.add(stormLift).add(convLift).min(0.998)
          .max(localBase.add(0.18));
        const localHeight = clamp(
          height01.sub(localBase).div(localTop.sub(localBase).max(0.04)),
          0,
          1,
        );

        const cloudType = clamp(
          envelope.b.add(storm.mul(0.26)).add(weatherSample.g.mul(u.convection).mul(0.10)),
          0,
          1,
        );

        // Meteorological vertical profiles: flatter/shallow stratus, large
        // cauliflower cumulus, and deep convective towers. The envelope's local
        // base/top makes neighboring cells vary naturally instead of sharing one
        // global slab silhouette.
        const stratusProfile = smoothstep(float(0.00), float(0.055), localHeight)
          .mul(float(1).sub(smoothstep(float(0.48), float(0.92), localHeight)));
        const cumulusProfile = smoothstep(float(0.00), float(0.040), localHeight)
          .mul(float(1).sub(smoothstep(float(0.62), float(0.995), localHeight)));
        const towerProfile = smoothstep(float(0.00), float(0.025), localHeight)
          .mul(float(1).sub(smoothstep(float(0.82), float(0.999), localHeight)));
        const stratusWeight = float(1).sub(smoothstep(float(0.26), float(0.48), cloudType));
        const towerWeight = smoothstep(float(0.62), float(0.90), cloudType)
          .mul(mix(float(0.50), float(1.0), u.convection));
        const fairProfile = mix(cumulusProfile, stratusProfile, stratusWeight);
        const verticalProfile = mix(fairProfile, towerProfile, towerWeight);

        const weatherField = mix(weatherSample.r, envelope.a, u.nubisEnvelopeStrength.mul(0.34));
        const coverageThreshold = float(1).sub(u.coverage);
        const coverageMask = smoothstep(
          coverageThreshold.sub(0.16),
          coverageThreshold.add(0.16),
          weatherField,
        );
        const dimensionalProfile = verticalProfile
          .mul(coverageMask)
          .mul(mix(float(0.72), float(1.12), envelope.a));

        // Broad true 3D Perlin-Worley mass.
        const baseUV = pos
          .mul(TILE_SCALE.mul(u.pwBaseScale))
          .add(u.scrollOffset)
          .fract();
        const baseNoise = texture3D(baseTex, baseUV);
        const worleyFbm = baseNoise.g.mul(0.625)
          .add(baseNoise.b.mul(0.25))
          .add(baseNoise.a.mul(0.125));
        const broadSignal = baseNoise.r.mul(0.88).add(worleyFbm.mul(0.12));

        // Envelope erosion follows the source architecture: rather than merely
        // multiplying noise by a height mask, the envelope pushes the density
        // threshold inward. This is what gives convincing rounded cloud volumes.
        const coarseDensity = clamp(
          broadSignal
            .sub(float(1).sub(dimensionalProfile))
            .mul(2.15)
            .add(u.pwDensityBias)
            .mul(u.nubisDensityScale),
          0,
          1,
        ).mul(u.density);

        const hitWeight = smoothstep(float(0.008), float(0.075), coarseDensity);
        const adaptiveAdvance = mix(
          nominalStep.mul(1.82),
          nominalStep.mul(0.72),
          hitWeight,
        ).toVar();

        // Expensive detail and lighting are only evaluated when the coarse
        // envelope+Perlin-Worley field says the ray is inside/near cloud.
        If(coarseDensity.greaterThan(0.006), () => {
          const detailUV = pos
            .mul(TILE_SCALE.mul(u.pwDetailScale))
            .add(u.scrollOffset.mul(1.61))
            .add(vec3(0.173, 0.287, 0.091))
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
          ).mul(mix(float(0.82), float(1.18), u.humidity.mul(weatherSample.b)));

          const opticalDepth = float(0).toVar();
          Loop(LIGHT_STEPS, ({ i }) => {
            const lightDistance = float(14).mul(float(i).add(1));
            const lp = pos.add(u.sunDir.mul(lightDistance));
            const lh = clamp(lp.y.sub(u.cloudBaseY).div(slabThickness), 0, 1);
            const lwuv = vec2(lp.x, lp.z)
              .mul(WEATHER_SCALE)
              .add(u.weatherOffset)
              .fract();
            const leuv = vec2(lp.x, lp.z)
              .mul(ENVELOPE_SCALE)
              .add(u.nubisEnvelopeOffset)
              .fract();
            const lw = texture(weatherTex, lwuv);
            const le = texture(envelopeTex, leuv);
            const lbaseH = le.r.mul(mix(float(1.0), float(0.68), storm));
            const ltopH = le.g
              .add(storm.mul(float(1).sub(le.g)).mul(0.78))
              .add(lw.g.mul(u.convection).mul(0.12))
              .min(0.998)
              .max(lbaseH.add(0.18));
            const lhLocal = clamp(lh.sub(lbaseH).div(ltopH.sub(lbaseH).max(0.04)), 0, 1);
            const lprofile = smoothstep(float(0.00), float(0.045), lhLocal)
              .mul(float(1).sub(smoothstep(float(0.70), float(0.999), lhLocal)));
            const lweatherField = mix(lw.r, le.a, u.nubisEnvelopeStrength.mul(0.34));
            const lcoverage = smoothstep(
              coverageThreshold.sub(0.16),
              coverageThreshold.add(0.16),
              lweatherField,
            );
            const ldimensional = lprofile
              .mul(lcoverage)
              .mul(mix(float(0.72), float(1.12), le.a));
            const lbaseNoise = texture3D(
              baseTex,
              lp.mul(TILE_SCALE.mul(u.pwBaseScale)).add(u.scrollOffset).fract(),
            );
            const lcoarse = clamp(
              lbaseNoise.r
                .sub(float(1).sub(ldimensional))
                .mul(2.05)
                .mul(u.density),
              0,
              1,
            );
            opticalDepth.addAssign(lcoarse);
          });

          // Nubis-style approximate multiple scattering: subsequent scattering
          // octaves use lower extinction and a less anisotropic phase response.
          const lightDepth = opticalDepth.mul(u.nubisLightExtinction);
          const beer0 = exp(lightDepth.negate());
          const beer1 = exp(lightDepth.mul(-0.50));
          const beer2 = exp(lightDepth.mul(-0.25));
          const multiScatter = beer0.mul(phase0)
            .add(beer1.mul(phase1).mul(0.50))
            .add(beer2.mul(phase2).mul(0.25))
            .add(u.nubisMultiScatter.mul(0.10));

          const refStrength = u.referencePaletteStrength.mul(0.55);
          const highlight = mix(u.sunColor, u.referenceHighlight, refStrength);
          const ambient = mix(u.ambientColor, u.referenceAmbient, refStrength.mul(0.65));
          const shadow = mix(u.ambientColor.mul(0.78), u.referenceShadow, refStrength.mul(0.70));
          const powder = float(1).sub(exp(localDensity.mul(-2.2)));
          const heightLight = smoothstep(float(0.06), float(0.76), localHeight);
          const ambientLight = mix(shadow, ambient, heightLight.mul(0.58).add(powder.mul(0.22)))
            .mul(u.nubisAmbientBoost);
          const directLight = highlight
            .mul(multiScatter)
            .mul(float(0.90).add(heightLight.mul(0.42)));
          const silverEdge = highlight
            .mul(pow(float(1).sub(coarseDensity), 2.1))
            .mul(phase0)
            .mul(0.28)
            .mul(float(1).sub(storm.mul(0.60)));
          const stormShade = mix(
            ambientLight.add(directLight).add(silverEdge),
            shadow.mul(0.82).add(directLight.mul(0.58)),
            storm.mul(0.68),
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
  handle.__riftNubisShaderInstalled = true;

  globalThis.__riftNubisCloudDebug = {
    active: true,
    architecture: "envelope + Perlin-Worley + adaptive shading + multiscattering",
    viewSteps: RAY_STEPS,
    lightSteps: LIGHT_STEPS,
    envelopeSize: config.envelopeSize,
    backend: "TSL->WGSL/WebGPU",
  };

  console.info(`[clouds] Nubis-style WebGPU cloud raymarch active (${RAY_STEPS} adaptive view / ${LIGHT_STEPS} light samples)`);
}

function tuneNubisWeather(handle, dt, windX, windZ, rainIntensity) {
  const u = handle?.uniforms;
  if (!u) return;
  const state = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(state?.stormIntensity ?? rainIntensity);
  const safeDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);

  handle.__riftNubisEnvelopeX += (Number(windX) || 0) * safeDt * 0.000020;
  handle.__riftNubisEnvelopeY += (Number(windZ) || 0) * safeDt * 0.000020;
  u.nubisEnvelopeOffset.value.set(handle.__riftNubisEnvelopeX, handle.__riftNubisEnvelopeY);

  // Large tropical cumulus by default. Storms increase coverage/depth rather
  // than merely darkening the same fair-weather shapes.
  if (u.pwBaseScale) u.pwBaseScale.value = THREE.MathUtils.lerp(0.28, 0.38, storm);
  if (u.pwDetailScale) u.pwDetailScale.value = THREE.MathUtils.lerp(5.15, 4.35, storm);
  if (u.pwDensityBias) u.pwDensityBias.value = THREE.MathUtils.lerp(-0.075, -0.035, storm);
  if (u.coverage) u.coverage.value = clamp01(Math.max(Number(u.coverage.value) || 0, THREE.MathUtils.lerp(0.49, 0.82, storm)));
  if (u.density) u.density.value = clamp01(Math.max(Number(u.density.value) || 0, THREE.MathUtils.lerp(0.56, 0.78, storm)));
  if (u.humidity) u.humidity.value = clamp01(Math.max(Number(u.humidity.value) || 0, THREE.MathUtils.lerp(0.66, 0.91, storm)));
  if (u.convection) u.convection.value = clamp01(Math.max(Number(u.convection.value) || 0, THREE.MathUtils.lerp(0.78, 0.96, storm)));
  if (u.erosion) u.erosion.value = Math.min(Number(u.erosion.value) || 0.7, THREE.MathUtils.lerp(0.39, 0.27, storm));

  if (u.nubisEnvelopeStrength) u.nubisEnvelopeStrength.value = THREE.MathUtils.lerp(0.94, 1.0, storm);
  if (u.nubisEdgeErosion) u.nubisEdgeErosion.value = THREE.MathUtils.lerp(0.31, 0.25, storm);
  if (u.nubisDensityScale) u.nubisDensityScale.value = THREE.MathUtils.lerp(1.08, 1.16, storm);
  if (u.nubisAmbientBoost) u.nubisAmbientBoost.value = THREE.MathUtils.lerp(0.78, 0.58, storm);
  if (u.nubisMultiScatter) u.nubisMultiScatter.value = THREE.MathUtils.lerp(0.34, 0.24, storm);
  if (u.nubisLightExtinction) u.nubisLightExtinction.value = THREE.MathUtils.lerp(0.52, 0.70, storm);

  // Reference photographs now calibrate color only; they no longer shape cloud
  // distribution. This is deliberately weaker than previous iterations.
  if (u.referenceGuideStrength) u.referenceGuideStrength.value = 0;
  if (u.referencePaletteStrength) u.referencePaletteStrength.value = THREE.MathUtils.lerp(0.16, 0.30, storm);

  const baseTarget = THREE.MathUtils.lerp(38, 30, storm);
  const topTarget = THREE.MathUtils.lerp(205, 255, storm);
  if (u.cloudBaseY) u.cloudBaseY.value = Math.min(Number(u.cloudBaseY.value) || 58, baseTarget);
  if (u.cloudTopY) u.cloudTopY.value = Math.max(Number(u.cloudTopY.value) || 108, topTarget);

  const baseY = Number(u.cloudBaseY?.value) || baseTarget;
  if (handle.mesh) handle.mesh.position.y = baseY;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;

  if (handle.__riftCirrus?.material) {
    handle.__riftCirrus.material.opacity = THREE.MathUtils.lerp(0.020, 0.007, storm);
  }
}

export function createVolumetricClouds(scene) {
  const handle = createPerlinWorleyClouds(scene);
  if (!handle) return handle;

  const config = qualityForNubis(handle);
  handle.__riftNubisQuality = config;
  handle.__riftNubisEnvelope = createNubisEnvelopeTexture(config.envelopeSize);
  handle.__riftNubisEnvelopeX = Math.random();
  handle.__riftNubisEnvelopeY = Math.random();
  installNubisUniforms(handle);
  handle.__riftNubisShaderInstalled = false;
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
  handle?.__riftNubisEnvelope?.dispose?.();
  if (handle) {
    handle.__riftNubisEnvelope = null;
    handle.__riftNubisQuality = null;
  }
  delete globalThis.__riftNubisCloudDebug;
  return disposePerlinWorleyClouds(handle);
}
