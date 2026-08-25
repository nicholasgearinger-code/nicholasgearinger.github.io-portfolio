import * as THREE from "three";
import {
  builtinShadowContext,
  cameraProjectionMatrixInverse,
  cameraWorldMatrix,
  diffuseColor,
  float,
  getViewPosition,
  metalness,
  mix,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  roughness,
  sample,
  screenUV,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
  velocity,
  unpackRGBToNormal,
} from "three/tsl";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import { sss } from "three/addons/tsl/display/SSSNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { ssgi } from "three/addons/tsl/display/SSGINode.js";
import { pass } from "three/tsl";

// -----------------------------------------------------------------------------
// Rift Lighting 2.0 — experimental hybrid WebGPU lighting stack for Three r185.
//
// The stable r185 branch remains untouched. This module deliberately uses the
// official Three.js WebGPU implementations for each job instead of continuing to
// mutate the legacy single directional shadow camera:
//   * CSMShadowNode : stable near/far sunlight shadows
//   * SSSNode       : short-range contact shadows
//   * GTAONode      : local grounding / crevice occlusion
//   * SSGINode      : screen-space indirect diffuse bounce + AO
//   * Model 2 cloud shadow texture : slow world-scale cloud illumination
//
// Every component has a URL kill switch so a mobile WebGPU regression can be
// isolated without rebuilding the branch. The default Mobile Low profile keeps
// SSGI off because r185's SSGINode has no resolutionScale; ?lightingAll=1 or
// ?forceSSGI=1 enables it for direct testing.
// -----------------------------------------------------------------------------

function boolParam(params, name) {
  const v = params.get(name);
  return v === "1" || v === "true" || v === "on";
}

function resolveConfig({ tier = "medium", isTouchDevice = false } = {}) {
  const params = typeof location !== "undefined"
    ? new URLSearchParams(location.search)
    : new URLSearchParams();

  const low = tier === "low";
  const high = tier === "high";
  const all = boolParam(params, "lightingAll");

  const csm = !boolParam(params, "noCSM");
  const sssEnabled = !boolParam(params, "noSSS") && (
    all || boolParam(params, "forceSSS") || !low
  );
  const ssgiEnabled = !boolParam(params, "noSSGI") && (
    all || boolParam(params, "forceSSGI") || (high && !isTouchDevice)
  );
  const gtaoEnabled = !boolParam(params, "noGTAO") && !ssgiEnabled;
  const cloudShadows = !boolParam(params, "noCloudShadows");

  return {
    tier,
    low,
    high,
    isTouchDevice,
    csm,
    sss: sssEnabled,
    gtao: gtaoEnabled,
    ssgi: ssgiEnabled,
    cloudShadows,
    all,

    csmCascades: high ? 3 : 2,
    csmMapSize: low ? 512 : 1024,
    csmMaxFar: low ? 86 : high ? 180 : 125,
    csmLightMargin: low ? 58 : high ? 100 : 76,

    sssResolutionScale: low ? 0.45 : 0.55,
    sssQuality: low ? 0.17 : high ? 0.42 : 0.28,
    sssMaxDistance: low ? 0.32 : high ? 0.72 : 0.50,
    sssThickness: low ? 0.040 : 0.030,
    sssIntensity: low ? 0.60 : 0.72,

    gtaoResolutionScale: low ? 0.50 : 0.62,
    gtaoSamples: low ? 5 : high ? 10 : 7,
    gtaoRadius: low ? 0.85 : high ? 1.45 : 1.10,
    gtaoScale: low ? 0.78 : high ? 1.0 : 0.90,
    gtaoThickness: low ? 0.70 : 0.85,

    // Full-resolution in r185. Keep this intentionally conservative. The query
    // flag exists so Mobile Low can still exercise the complete stack.
    ssgiSlices: low ? 1 : high ? 2 : 1,
    ssgiSteps: low ? 4 : high ? 8 : 6,
    ssgiRadius: low ? 4.5 : high ? 10 : 7,
    ssgiGI: low ? 2.2 : high ? 5.0 : 3.4,
    ssgiAO: low ? 0.78 : 1.0,
    ssgiThickness: low ? 0.90 : 1.15,

    cloudShadowStrength: low ? 0.33 : high ? 0.48 : 0.40,
  };
}

function makeWhiteTexture() {
  const data = new Uint8Array([255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function installCSM(config, sun, moonLight) {
  if (!config.csm || !sun?.shadow) return null;

  // CSM clones the source light's shadow settings once during node setup, so set
  // the r185/mobile budget before assigning the custom shadow node.
  sun.castShadow = true;
  if (moonLight && config.low) moonLight.castShadow = false;

  sun.shadow.mapSize.set(config.csmMapSize, config.csmMapSize);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = config.csmMaxFar + config.csmLightMargin * 2;
  sun.shadow.bias = -0.00024;
  sun.shadow.normalBias = 0.015;
  sun.shadow.radius = config.low ? 1.35 : 1.6;
  sun.shadow.autoUpdate = true;
  sun.shadow.needsUpdate = true;

  const csm = new CSMShadowNode(sun, {
    cascades: config.csmCascades,
    maxFar: config.csmMaxFar,
    lightMargin: config.csmLightMargin,
    mode: "custom",
    customSplitsCallback: (cascades, near, far, target) => {
      if (cascades <= 2) {
        // Spend most of the available texels in the part of the scene where a
        // phone actually notices palm trunks, rocks and the player's footing.
        target.push(config.low ? 0.23 : 0.20, 1.0);
      } else {
        target.push(0.12, 0.38, 1.0);
      }
    },
  });
  csm.fade = true;

  // r185's AnalyticLightNode explicitly honors light.shadow.shadowNode. This is
  // the supported WebGPU custom-shadow hook and avoids our failed hand-written
  // light-space shadow-camera surgery.
  sun.shadow.shadowNode = csm;
  return csm;
}

export function setupRiftLightingV20({
  scene,
  camera,
  renderer,
  sun,
  moonLight,
  scenePass,
  tier = "medium",
  isTouchDevice = false,
  needSSR = false,
} = {}) {
  if (!scene || !camera || !renderer || !sun || !scenePass) {
    throw new Error("[Rift Lighting 2.0] Missing required scene/camera/renderer/sun/scenePass");
  }

  const config = resolveConfig({ tier, isTouchDevice });
  const csm = installCSM(config, sun, moonLight);

  // One MRT layout services SSR and SSGI together. Low GTAO reconstructs normals
  // from depth and therefore avoids the extra normal-buffer bandwidth entirely.
  const mrtLayout = { output };
  if (needSSR || config.ssgi) mrtLayout.normal = packNormalToRGB(normalView);
  if (needSSR) mrtLayout.metalrough = vec2(metalness, roughness);
  if (config.ssgi) mrtLayout.diffuseColor = diffuseColor;

  if (needSSR || config.ssgi) scenePass.setMRT(mrt(mrtLayout));

  const sceneColor = scenePass.getTextureNode("output");
  const sceneDepth = scenePass.getTextureNode("depth");
  const normalPacked = (needSSR || config.ssgi)
    ? scenePass.getTextureNode("normal")
    : null;
  const sceneNormal = normalPacked
    ? sample((uvNode) => unpackRGBToNormal(normalPacked.sample(uvNode)))
    : null;
  const metalRough = needSSR ? scenePass.getTextureNode("metalrough") : null;
  const sceneDiffuse = config.ssgi ? scenePass.getTextureNode("diffuseColor") : null;

  // Bandwidth optimization used by Three's official SSGI/SSR examples.
  if (normalPacked) {
    const normalTexture = scenePass.getTexture("normal");
    if (normalTexture) normalTexture.type = THREE.UnsignedByteType;
  }
  if (metalRough) {
    const mrTexture = scenePass.getTexture("metalrough");
    if (mrTexture) mrTexture.type = THREE.UnsignedByteType;
  }
  if (sceneDiffuse) {
    const diffuseTexture = scenePass.getTexture("diffuseColor");
    if (diffuseTexture) diffuseTexture.type = THREE.UnsignedByteType;
  }

  // Short-range Screen-Space Shadows are injected into the lighting context so
  // they multiply the Sun contribution and naturally coexist with CSM.
  let prePass = null;
  let sssPass = null;
  if (config.sss) {
    prePass = pass(scene, camera);
    prePass.name = "Rift Lighting 2.0 SSS prepass";
    prePass.transparent = false;
    prePass.setMRT(mrt({ output: velocity }));
    const preDepth = prePass.getTextureNode("depth");

    sssPass = sss(preDepth, camera, sun);
    sssPass.resolutionScale = config.sssResolutionScale;
    sssPass.quality.value = config.sssQuality;
    sssPass.maxDistance.value = config.sssMaxDistance;
    sssPass.thickness.value = config.sssThickness;
    sssPass.shadowIntensity.value = config.sssIntensity;
    sssPass.useTemporalFiltering = false;

    const sssSample = sssPass.getTextureNode().sample(screenUV).r;
    scenePass.contextNode = builtinShadowContext(sssSample, sun);
  }

  let gtaoPass = null;
  let gtaoNode = null;
  if (config.gtao) {
    gtaoPass = ao(sceneDepth, sceneNormal, camera);
    gtaoPass.resolutionScale = config.gtaoResolutionScale;
    gtaoPass.samples.value = config.gtaoSamples;
    gtaoPass.radius.value = config.gtaoRadius;
    gtaoPass.scale.value = config.gtaoScale;
    gtaoPass.thickness.value = config.gtaoThickness;
    gtaoPass.useTemporalFiltering = false;
    gtaoNode = gtaoPass.getTextureNode();
  }

  let ssgiPass = null;
  let ssgiAO = null;
  let ssgiGI = null;
  if (config.ssgi) {
    ssgiPass = ssgi(sceneColor, sceneDepth, sceneNormal, camera);
    // r185 requires TRAA when temporal filtering is enabled. Keep this first
    // integration non-temporal so it cannot disturb Rift's existing cloud TAAU.
    ssgiPass.useTemporalFiltering = false;
    ssgiPass.sliceCount.value = config.ssgiSlices;
    ssgiPass.stepCount.value = config.ssgiSteps;
    ssgiPass.radius.value = config.ssgiRadius;
    ssgiPass.giIntensity.value = config.ssgiGI;
    ssgiPass.aoIntensity.value = config.ssgiAO;
    ssgiPass.thickness.value = config.ssgiThickness;
    ssgiPass.backfaceLighting.value = 0.12;
    ssgiPass.useScreenSpaceSampling.value = true;
    ssgiAO = ssgiPass.getAONode();
    ssgiGI = ssgiPass.getGINode();
  }

  // Cloud Model 2 already computes a cheap 128x128 world-space transmittance map
  // at about 8 Hz. Reconstruct world position from the scene depth and use that
  // field as a separate kilometer-scale illumination layer.
  const whiteTexture = makeWhiteTexture();
  const cloudTextureNode = texture(whiteTexture);
  const cloudWorldScale = uniform(0.004);
  const cloudStrength = uniform(config.cloudShadows ? config.cloudShadowStrength : 0);

  const depthAtPixel = sceneDepth.sample(screenUV).r;
  const viewPos = getViewPosition(screenUV, depthAtPixel, cameraProjectionMatrixInverse);
  const worldPos = cameraWorldMatrix.mul(vec4(viewPos, 1)).xyz;
  const cloudUV = vec2(worldPos.x, worldPos.z).mul(cloudWorldScale).fract();
  const cloudT = cloudTextureNode.sample(cloudUV).r;
  const geometryMask = float(1).sub(depthAtPixel.smoothstep(0.9975, 1.0));
  const cloudFactor = mix(
    float(1),
    cloudT.max(0.42),
    cloudStrength.mul(geometryMask),
  );

  function compose(baseOutput) {
    let result = baseOutput;

    if (ssgiPass && sceneDiffuse) {
      // Official SSGI composition: direct/beauty * AO + diffuse albedo * GI.
      result = vec4(
        result.rgb.mul(ssgiAO.r).add(sceneDiffuse.rgb.mul(ssgiGI.rgb)),
        result.a,
      );
    } else if (gtaoNode) {
      // Keep AO out of the sky and avoid crushing the already dark storm palette.
      const aoFactor = mix(float(1), gtaoNode.r, float(config.low ? 0.72 : 0.84));
      result = vec4(result.rgb.mul(aoFactor), result.a);
    }

    if (config.cloudShadows) {
      result = vec4(result.rgb.mul(cloudFactor), result.a);
    }

    return result;
  }

  const baseGIIntensity = ssgiPass ? config.ssgiGI : 0;
  const baseSSSIntensity = sssPass ? config.sssIntensity : 0;

  function update(dt = 0, isSubmerged = false) {
    const cloudState = globalThis.__riftCloudShadowState;
    if (config.cloudShadows && cloudState?.texture) {
      cloudTextureNode.value = cloudState.texture;
      cloudWorldScale.value = Math.max(0.000001, Number(cloudState.worldScale) || 0.004);
      cloudStrength.value = isSubmerged ? 0 : config.cloudShadowStrength;
    } else {
      cloudStrength.value = 0;
    }

    if (sssPass) {
      sssPass.shadowIntensity.value = isSubmerged ? 0 : baseSSSIntensity;
    }
    if (ssgiPass) {
      ssgiPass.giIntensity.value = isSubmerged ? baseGIIntensity * 0.38 : baseGIIntensity;
    }

    if (globalThis.__riftLightingV20) {
      globalThis.__riftLightingV20.submerged = !!isSubmerged;
      globalThis.__riftLightingV20.cloudShadowTextureReady = !!cloudState?.texture;
      globalThis.__riftLightingV20.cloudShadowAverage = Number(cloudState?.averageTransmittance) || 1;
      globalThis.__riftLightingV20.dt = Number(dt) || 0;
    }
  }

  function dispose() {
    if (sun?.shadow?.shadowNode === csm) delete sun.shadow.shadowNode;
    csm?.dispose?.();
    sssPass?.dispose?.();
    gtaoPass?.dispose?.();
    ssgiPass?.dispose?.();
    prePass?.dispose?.();
    whiteTexture.dispose();
    delete globalThis.__riftLightingV20;
  }

  globalThis.__riftLightingV20 = {
    active: true,
    revision: THREE.REVISION,
    tier: config.tier,
    CSM: !!csm,
    cascades: config.csmCascades,
    mapSize: config.csmMapSize,
    SSS: !!sssPass,
    GTAO: !!gtaoPass,
    SSGI: !!ssgiPass,
    cloudShadows: config.cloudShadows,
    fullStackRequested: config.all,
  };

  return {
    config,
    sceneColor,
    sceneDepth,
    sceneNormal,
    metalRough,
    sceneDiffuse,
    csm,
    sssPass,
    gtaoPass,
    ssgiPass,
    compose,
    update,
    dispose,
  };
}
