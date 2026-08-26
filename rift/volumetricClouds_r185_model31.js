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
  texture3D,
  uniform,
  vec3,
  vec4,
  max as tslMax,
  min as tslMin,
} from "three/tsl";
import * as base from "./volumetricClouds_r185_model30.js";
import { createReferenceCloudAtlas } from "./cloudReferenceVolumeAtlas_v2.js";
import {
  computeReferenceCloudState,
} from "./cloudInstanceDirector_reference_v2.js";

export * from "./volumetricClouds_r185_model30.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 3.1 — crown structure + authored self-shadowing.
//
// 3.0 proved the reference-shaped architecture. 3.1 deliberately leaves the
// successful r185/TAAU path alone and improves the two weakest visual layers:
//   1) authored macro volumes now contain many more independent cauliflower crowns
//      and a less slab-like storm deck;
//   2) the same reference density that makes the visible silhouette now controls
//      directional optical depth, core shadow, darker flat bases and crown light.
//
// Perlin-Worley remains detail only. No extra full-screen pass and no additional
// 3D texture lookup is added to the view march versus Model 3.0.
// -----------------------------------------------------------------------------

function installModel31Uniforms(handle) {
  if (!handle?.uniforms || handle.__riftModel31UniformsInstalled) return;
  const u = handle.uniforms;
  u.m31CrownBreakup = uniform(0.9);
  u.m31SelfShadow = uniform(0.95);
  u.m31BaseDarkening = uniform(0.5);
  u.m31CrownLightBoost = uniform(1.12);
  handle.__riftModel31UniformsInstalled = true;
}

function installModel31Shader(handle) {
  if (
    !handle?.material ||
    !handle?.__riftModel3Atlas?.texture ||
    !handle?.__riftModel2Volumes?.baseTexture ||
    !handle?.__riftModel2Volumes?.detailTexture ||
    !handle?.uniforms ||
    handle.__riftModel31ShaderInstalled
  ) return;

  installModel31Uniforms(handle);

  const u = handle.uniforms;
  const referenceTex = handle.__riftModel3Atlas.texture;
  const baseTex = handle.__riftModel2Volumes.baseTexture;
  const detailTex = handle.__riftModel2Volumes.detailTexture;
  const config = handle.__riftModel2Quality;
  const RAY_STEPS = config?.viewSteps || 18;
  const LIGHT_STEPS = config?.lightSteps || 3;
  const TILE_SCALE = float(handle.quality.tileScale);
  const MAX_DISTANCE = float(handle.quality.maxRayDistance);

  const sampleReference = (p, height01) => {
    const refX = p.x.mul(u.m3ReferenceWorldScale)
      .add(u.m3ReferenceOffset.x)
      .fract();
    const refZ = p.z.mul(u.m3ReferenceWorldScale)
      .add(u.m3ReferenceOffset.y)
      .fract();
    const refUV = vec3(refX, clamp(height01, 0.001, 0.999), refZ);
    const atlas = texture3D(referenceTex, refUV);
    return clamp(
      atlas.r.mul(u.m3ReferenceWeights.x)
        .add(atlas.g.mul(u.m3ReferenceWeights.y))
        .add(atlas.b.mul(u.m3ReferenceWeights.z))
        .add(atlas.a.mul(u.m3ReferenceWeights.w)),
      0,
      1,
    );
  };

  handle.material.colorNode = Fn(() => {
    const rayOrigin = cameraPosition;
    const rayDir = normalize(positionWorld.sub(cameraPosition));
    const safeRayY = rayDir.y.abs().max(0.001);
    const signedRayY = rayDir.y.div(safeRayY);
    const t0Raw = u.cloudBaseY.sub(rayOrigin.y).div(rayDir.y);
    const t1Raw = u.cloudTopY.sub(rayOrigin.y).div(rayDir.y);
    const tNear = tslMin(t0Raw, t1Raw);
    const tFar = tslMax(t0Raw, t1Raw);
    const tStart = tslMax(tNear, float(0));
    const tEnd = tslMin(tFar, tStart.add(MAX_DISTANCE));
    const marchLength = tslMax(tEnd.sub(tStart), float(0));
    const nominalStep = marchLength.div(float(RAY_STEPS).mul(0.90)).toVar();

    const jitterUV = vec3(
      positionWorld.x.mul(0.0071).fract(),
      positionWorld.y.mul(0.0053).fract(),
      positionWorld.z.mul(0.0067).fract(),
    );
    const jitterSeed = texture3D(baseTex, jitterUV).b;
    const t = tStart
      .add(nominalStep.mul(float(0.08).add(jitterSeed.mul(0.82))))
      .toVar();
    const transmittance = float(1).toVar();
    const scattered = vec3(0).toVar();

    const mu = clamp(dot(rayDir, u.sunDir), -1, 1);
    const forwardDenom = float(1.4225).sub(mu.mul(1.30)).max(0.045);
    const backwardDenom = float(1.04).add(mu.mul(0.40)).max(0.08);
    const phaseForward = float(0.5775).div(pow(forwardDenom, 1.5));
    const phaseBackward = float(0.96).div(pow(backwardDenom, 1.5));
    const phase0 = phaseForward.mul(0.82)
      .add(phaseBackward.mul(0.18))
      .mul(0.31)
      .add(0.075);
    const phase1 = phase0.mul(0.70).add(0.085);
    const phase2 = phase0.mul(0.46).add(0.13);

    Loop(RAY_STEPS, () => {
      If(t.lessThan(tEnd), () => {
        const pos = rayOrigin.add(rayDir.mul(t));
        const slabThickness = u.cloudTopY.sub(u.cloudBaseY).max(1);
        const height01 = clamp(
          pos.y.sub(u.cloudBaseY).div(slabThickness),
          0,
          1,
        );

        const warpUV = pos
          .mul(TILE_SCALE.mul(u.m2BaseScale).mul(0.28))
          .add(u.m2WarpOffset)
          .fract();
        const warpNoise = texture3D(baseTex, warpUV);
        const warpVector = vec3(warpNoise.g, warpNoise.b, warpNoise.a).sub(0.5);
        const crownWarp = smoothstep(float(0.16), float(0.90), height01)
          .mul(u.convection);
        const warpStrength = u.m2DomainWarp
          .mul(float(0.24).add(crownWarp.mul(0.76)));
        const densityPos = pos.add(vec3(
          warpVector.x.mul(warpStrength),
          warpVector.y.mul(warpStrength).mul(0.17),
          warpVector.z.mul(warpStrength),
        ));

        const referenceRaw = sampleReference(densityPos, height01);
        const referenceThreshold = mix(float(0.47), float(0.12), u.coverage);
        const referenceMass = smoothstep(
          referenceThreshold,
          referenceThreshold.add(0.205),
          referenceRaw,
        );

        const baseUV = densityPos
          .mul(TILE_SCALE.mul(u.m2BaseScale))
          .add(u.m2BaseOffset)
          .fract();
        const baseNoise = texture3D(baseTex, baseUV);
        const worleyFbm = baseNoise.g.mul(0.625)
          .add(baseNoise.b.mul(0.25))
          .add(baseNoise.a.mul(0.125));
        const broadSignal = baseNoise.r.mul(0.76).add(worleyFbm.mul(0.24));
        const densityThreshold = mix(float(0.63), float(0.35), u.density)
          .add(u.m2DensityBias);
        const proceduralMass = smoothstep(
          densityThreshold,
          densityThreshold.add(0.235),
          broadSignal,
        );

        // Model 3.1 crown breakup: the authored atlas remains the silhouette, but
        // upper cloud mass exposes more of the existing broad Worley structure.
        // The flat condensation base is intentionally excluded from this modulation.
        const crownZone = smoothstep(float(0.20), float(0.72), height01)
          .mul(float(1).sub(u.stormDarken.mul(0.58)));
        const crownScallop = float(0.74)
          .add(baseNoise.g.mul(0.22))
          .add(baseNoise.b.mul(0.16));
        const crownMod = mix(
          float(1),
          crownScallop,
          crownZone.mul(u.m31CrownBreakup),
        );
        const interiorVariation = mix(float(0.86), float(1.10), broadSignal);
        const authoredMass = referenceMass
          .mul(interiorVariation)
          .mul(crownMod);
        const macroMass = mix(
          proceduralMass,
          authoredMass,
          u.m3ReferenceStrength,
        );

        const moistureBoost = float(0.84).add(u.humidity.mul(0.24));
        const coarseDensity = clamp(
          macroMass
            .mul(moistureBoost)
            .mul(u.m2DensityScale),
          0,
          1,
        );

        const hitWeight = smoothstep(float(0.0035), float(0.080), coarseDensity);
        const adaptiveAdvance = mix(
          nominalStep.mul(2.50),
          nominalStep.mul(0.69),
          hitWeight,
        ).toVar();

        If(coarseDensity.greaterThan(0.0035), () => {
          const detailUV = densityPos
            .mul(TILE_SCALE.mul(u.m2DetailScale))
            .add(u.m2DetailOffset)
            .add(warpVector.mul(0.31))
            .fract();
          const detail = texture3D(detailTex, detailUV);
          const detailFbm = detail.r.mul(0.625)
            .add(detail.g.mul(0.25))
            .add(detail.b.mul(0.125));

          const edgeEnter = smoothstep(float(0.010), float(0.21), coarseDensity);
          const edgeExit = float(1).sub(
            smoothstep(float(0.50), float(0.92), coarseDensity),
          );
          const edgeBand = edgeEnter.mul(edgeExit);
          const crownErosion = mix(
            float(1),
            float(1.42),
            crownZone.mul(u.m31CrownBreakup),
          );
          const erosionSignal = float(1).sub(detailFbm);
          const erosionAmount = erosionSignal
            .mul(u.m2EdgeErosion)
            .mul(u.erosion)
            .mul(edgeBand)
            .mul(crownErosion)
            .mul(float(1).sub(u.stormDarken.mul(0.34)));
          const localDensity = clamp(
            coarseDensity.sub(erosionAmount),
            0,
            1,
          );

          // Reference-aware self shadow. The light march follows the authored
          // atlas at three distances, then a cheap local core term restores the
          // dense gray-blue interior without adding another texture lookup.
          const opticalDepth = float(0).toVar();
          Loop(LIGHT_STEPS, ({ i }) => {
            const lightDistance = float(11).add(float(i).mul(19));
            const lp = pos.add(u.sunDir.mul(lightDistance));
            const lh = clamp(lp.y.sub(u.cloudBaseY).div(slabThickness), 0, 1);
            const lref = sampleReference(lp, lh);
            const lshape = smoothstep(
              referenceThreshold,
              referenceThreshold.add(0.205),
              lref,
            );
            const lcore = lshape.mul(float(0.80).add(lref.mul(0.34)));
            const lowerOpticalWeight = mix(
              float(1.13),
              float(0.92),
              smoothstep(float(0.10), float(0.78), lh),
            );
            opticalDepth.addAssign(
              lcore
                .mul(lowerOpticalWeight)
                .mul(u.m2DensityScale)
                .mul(float(0.82).add(u.humidity.mul(0.18))),
            );
          });

          const authoredCore = smoothstep(float(0.38), float(0.88), referenceMass);
          const localCoreDepth = authoredCore
            .mul(u.m31SelfShadow)
            .mul(float(0.46));
          const lightDepth = opticalDepth
            .mul(u.m2LightExtinction)
            .mul(u.m31SelfShadow)
            .add(localCoreDepth);
          const beer0 = exp(lightDepth.negate());
          const beer1 = exp(lightDepth.mul(-0.50));
          const beer2 = exp(lightDepth.mul(-0.25));
          const multiScatter = beer0.mul(phase0)
            .add(beer1.mul(phase1).mul(0.50))
            .add(beer2.mul(phase2).mul(0.25))
            .add(u.m2MultiScatter.mul(0.080));

          const powder = float(1).sub(exp(localDensity.mul(-2.35)));
          const heightLight = smoothstep(float(0.035), float(0.78), height01);
          const underside = float(1).sub(
            smoothstep(float(0.055), float(0.30), height01),
          );
          const crownLight = smoothstep(float(0.35), float(0.82), height01)
            .mul(crownZone)
            .mul(u.m31CrownLightBoost);

          const coolAmbient = u.ambientColor.mul(vec3(0.70, 0.82, 1.00));
          const shadowAmbient = u.ambientColor.mul(vec3(0.43, 0.54, 0.72));
          const baseAmbient = shadowAmbient.mul(
            float(1).sub(underside.mul(u.m31BaseDarkening).mul(0.42)),
          );
          const ambientMix = mix(
            baseAmbient,
            coolAmbient,
            heightLight.mul(0.62).add(powder.mul(0.18)),
          ).mul(u.m2AmbientStrength);

          const directLight = u.sunColor
            .mul(multiScatter)
            .mul(float(0.78).add(heightLight.mul(0.48)).add(crownLight.mul(0.18)))
            .mul(float(1).sub(underside.mul(u.m31BaseDarkening).mul(0.34)));
          const silverEdge = u.sunColor
            .mul(pow(float(1).sub(referenceMass), 2.45))
            .mul(phase0)
            .mul(u.m2SilverStrength)
            .mul(float(1).sub(u.stormDarken.mul(0.62)));

          const litClear = ambientMix.add(directLight).add(silverEdge);
          const lit = mix(
            litClear,
            baseAmbient.mul(0.80).add(directLight.mul(0.48)),
            u.stormDarken.mul(0.76),
          );
          const flash = u.lightningColor
            .mul(u.lightningFlash)
            .mul(float(0.50).add(localDensity.mul(1.20)));

          const extinction = mix(float(0.036), float(0.076), u.stormDarken);
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
    const horizonFade = smoothstep(float(0.004), float(0.045), rayDir.y.abs());
    const alpha = float(1).sub(transmittance)
      .mul(skyward)
      .mul(horizonFade)
      .mul(signedRayY.abs());
    return vec4(scattered, alpha);
  })();

  handle.material.needsUpdate = true;
  handle.__riftModel31ShaderInstalled = true;
  console.info(
    `[clouds] Rift Cloud Model 3.1 active (${RAY_STEPS} view / ${LIGHT_STEPS} authored self-shadow samples; atlas ${handle.__riftModel3Atlas.width}x${handle.__riftModel3Atlas.height}x${handle.__riftModel3Atlas.depth})`,
  );
}

function tuneModel31(handle, sunDirection, rainIntensity) {
  if (!handle?.uniforms) return null;
  const u = handle.uniforms;
  const state = computeReferenceCloudState({
    sunDirection,
    rainIntensity,
  });

  // Model 3.0 owns advection and the reference offset. 3.1 only replaces the
  // meteorological weights and visual/lighting controls after the base update.
  u.m3ReferenceWeights.value.set(...state.weights);
  u.m3ReferenceWorldScale.value = state.worldScale;
  u.m3ReferenceStrength.value = state.referenceStrength;
  u.m2EdgeErosion.value = state.edgeErosion;
  u.m2DetailScale.value = state.detailScale;
  u.m2DensityScale.value = state.densityScale;
  u.m2LightExtinction.value = state.extinction;
  u.m2AmbientStrength.value = state.ambientStrength;
  u.m2SilverStrength.value = state.silverStrength;
  u.m2MultiScatter.value = THREE.MathUtils.lerp(0.28, 0.19, state.storm);
  u.m31CrownBreakup.value = state.crownBreakup;
  u.m31SelfShadow.value = state.selfShadowStrength;
  u.m31BaseDarkening.value = state.baseDarkening;
  u.m31CrownLightBoost.value = state.crownLightBoost;

  // Keep fair-weather bases visually flat and give the new small crowns enough
  // vertical room without increasing the maximum storm slab from Model 3.0.
  const fairBase = THREE.MathUtils.lerp(56, 48, state.humidity);
  const baseY = THREE.MathUtils.lerp(fairBase, 33, state.storm);
  const fairTop = baseY + 168 + state.convection * 50;
  const topY = THREE.MathUtils.lerp(fairTop, baseY + 238, state.storm);
  u.cloudBaseY.value = baseY;
  u.cloudTopY.value = topY;

  if (handle.mesh) handle.mesh.position.y = baseY;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;

  if (handle.__riftCirrus?.material) {
    const cirrus = THREE.MathUtils.lerp(0.012, 0.0035, state.storm);
    handle.__riftCirrus.material.opacity = cirrus
      * THREE.MathUtils.lerp(1.0, 0.72, state.humidity);
  }

  const offset = u.m3ReferenceOffset?.value;
  globalThis.__riftCloudModel31Debug = {
    active: true,
    version: "3.1-crown-self-shadow",
    architecture: "reference archetype atlas v2 + crown-only shell breakup + authored directional self-shadow + r185 TAAU",
    atlas: {
      width: handle.__riftModel3Atlas?.width,
      height: handle.__riftModel3Atlas?.height,
      depth: handle.__riftModel3Atlas?.depth,
      bytes: handle.__riftModel3Atlas?.bytes,
    },
    weights: [...state.weights],
    referenceStrength: state.referenceStrength,
    worldScale: state.worldScale,
    offset: offset ? [offset.x, offset.y] : [0, 0],
    baseY,
    topY,
    crownBreakup: state.crownBreakup,
    selfShadowStrength: state.selfShadowStrength,
    baseDarkening: state.baseDarkening,
    crownLightBoost: state.crownLightBoost,
    storm: state.storm,
    humidity: state.humidity,
    convection: state.convection,
    daylight: state.daylight,
    lowSun: state.lowSun,
    night: state.night,
    threeRevision: THREE.REVISION,
  };

  return state;
}

function atlasSizeFor(handle) {
  const label = handle?.__riftModel2Quality?.label;
  if (label === "mobile-low") return { width: 64, height: 44, depth: 64 };
  if (label === "medium") return { width: 80, height: 52, depth: 80 };
  return { width: 96, height: 60, depth: 96 };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (!handle) return handle;

  // Replace Model 3.0's first-generation atlas before either Model 3 shader is
  // compiled. The v2 atlas has more crown lobes and a sharper flat base.
  handle.__riftModel3Atlas?.dispose?.();
  handle.__riftModel3Atlas = createReferenceCloudAtlas(atlasSizeFor(handle));
  installModel31Uniforms(handle);
  handle.__riftModel31ShaderInstalled = false;
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
  base.updateVolumetricClouds(
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
  installModel31Shader(handle);
  tuneModel31(handle, sunDirection, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  if (handle) {
    handle.__riftModel31ShaderInstalled = false;
    handle.__riftModel31UniformsInstalled = false;
  }
  delete globalThis.__riftCloudModel31Debug;
  return base.disposeVolumetricClouds(handle);
}
