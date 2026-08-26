// Runtime tuning wrapper for rain/underwater presentation plus Water Pro v9.
// The large stable game source remains preserved in main_game_rain_base.js;
// this layer only appends uniquely-validated source edits to the existing tuned
// loader before it executes.
//
// r185 migration note:
// This wrapper now translates the preserved r182-era source to the current
// r185 WebGPU APIs at load time: RenderPipeline, Timer, the updated SSRNode,
// and the native r185 GodraysNode. Keeping the migration here lets the stable
// base remain an exact rollback point while the review branch is validated.

const tunedLoaderUrl = new URL(
  "./main_game_underwater_base.js",
  import.meta.url,
);
const moduleBaseUrl = new URL("./", import.meta.url);

const response = await fetch(tunedLoaderUrl, { cache: "reload" });
if (!response.ok) {
  throw new Error(
    `[rift-water-pro] Failed to load tuned runtime loader: HTTP ${response.status}`,
  );
}

let source = await response.text();

const lines = source.split("\n");
const badEditLabel = '"seafloor caustic brightness"';
const matchingLines = lines.filter((line) => line.includes(badEditLabel));
if (matchingLines.length !== 1) {
  throw new Error(
    `[rift-water-pro] Expected exactly one caustic tuning entry, found ${matchingLines.length}`,
  );
}
source = lines.filter((line) => !line.includes(badEditLabel)).join("\n");

const editsLoopMarker =
  '\n];\n\nfor (const [from, to, label] of edits) source = replaceExactlyOnce(source, from, to, label);';

if (!source.includes(editsLoopMarker)) {
  throw new Error(
    "[rift-water-pro] Tuned loader edit loop changed unexpectedly",
  );
}

const extraEdits = [
  [
    'import { createVolumetricClouds, updateVolumetricClouds } from "./volumetricClouds.js";',
    'import { createVolumetricClouds, updateVolumetricClouds } from "./volumetricClouds_reference_v2.js";',
    "progressive low-resolution volumetric cloud renderer import",
  ],
  [
    'import { createDayNightCycle, updateDayNightCycle, CYCLE_SECONDS } from "./dayNightCycle.js";',
    'import { createDayNightCycle, updateDayNightCycle, CYCLE_SECONDS } from "./dayNightCycle_celestial_physical_v15.js";',
    "solar radiance envelope v15 import",
  ],
  [
    "sceneBackgroundColor.copy(dayNight.skyHorizon).lerp(dayNight.skyZenith, 0.5);",
    "sceneBackgroundColor.copy(dayNight.skyHorizon).lerp(dayNight.skyZenith, 0.5);\n    if (globalThis.__riftReferenceAtmosphere) renderer.toneMappingExposure = globalThis.__riftReferenceAtmosphere.exposure ?? 0.98;",
    "reference atmosphere dynamic exposure",
  ],
  [
    "tempWaterGlintDir.copy(moonLight.position).lerp(sun.position, dayNight.dayAmount);",
    "tempWaterGlintDir.copy(sun.intensity >= moonLight.intensity ? sun.position : moonLight.position).sub(camera.position).normalize();",
    "camera-relative celestial glint alignment",
  ],
  [
    'import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";',
    `import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { mrt, output, normalView, metalness, roughness, sample, packNormalToRGB, unpackRGBToNormal, uniformTexture, Loop } from "three/tsl";
import { ssr } from "three/addons/tsl/display/SSRNode.js";
import { godrays } from "three/addons/tsl/display/GodraysNode.js";
import { bilateralBlur } from "three/addons/tsl/display/BilateralBlurNode.js";`,
    "r185 Water Pro SSR + cloud-aware Godrays imports",
  ],
  [
    `const postProcessing = new THREE.PostProcessing(renderer);
const scenePass = pass(scene, camera);
const scenePassColor = scenePass.getTextureNode("output");`,
    `const postProcessing = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);
const riftSSRTier = getGraphicsTier();
const riftWaterProfile = globalThis.__riftWaterTestMode === "desktop"
  ? "desktop"
  : globalThis.__riftWaterTestMode === "mobile"
    ? "mobile"
    : (isTouchDevice ? "mobile" : "desktop");
const riftSSRIsMobile = riftWaterProfile === "mobile";
const riftForcedDesktopWater = globalThis.__riftWaterTestForced === true && riftWaterProfile === "desktop";
const riftSSRQualityTier = riftForcedDesktopWater && riftSSRTier === "low" ? "medium" : riftSSRTier;
const riftSSREnabled = riftWaterProfile === "desktop" && riftSSRQualityTier !== "low" && getEffectiveValue("reflectionEnabled") !== false;
let riftSSRPass = null;
let riftSSRBaseIntensity = 0;
if (riftSSREnabled) {
  scenePass.setMRT(mrt({
    output: output,
    normal: packNormalToRGB(normalView),
    metalrough: vec2(metalness, roughness),
  }));
}
const scenePassColor = scenePass.getTextureNode("output");
const riftSceneDepth = scenePass.getTextureNode("depth");
if (riftSSREnabled) {
  const riftSceneNormalPacked = scenePass.getTextureNode("normal");
  const riftSceneMetalRough = scenePass.getTextureNode("metalrough");
  const riftNormalTexture = scenePass.getTexture("normal");
  const riftMetalRoughTexture = scenePass.getTexture("metalrough");
  riftNormalTexture.type = THREE.UnsignedByteType;
  riftMetalRoughTexture.type = THREE.UnsignedByteType;
  const riftSceneNormal = sample((uvNode) => unpackRGBToNormal(riftSceneNormalPacked.sample(uvNode)));
  riftSSRPass = ssr(scenePassColor, riftSceneDepth, riftSceneNormal, {
    metalnessNode: riftSceneMetalRough.r,
    roughnessNode: riftSceneMetalRough.g,
  });
  if (riftSSRIsMobile) {
    riftSSRBaseIntensity = 0.30;
    riftSSRPass.resolutionScale = 0.30;
    riftSSRPass.quality.value = 0.14;
    riftSSRPass.blurQuality = 1;
    riftSSRPass.maxDistance.value = 0.30;
    riftSSRPass.intensity.value = riftSSRBaseIntensity;
    riftSSRPass.thickness.value = 0.036;
  } else {
    riftSSRBaseIntensity = riftSSRQualityTier === "high" ? 0.82 : 0.58;
    riftSSRPass.quality.value = riftSSRQualityTier === "high" ? 0.48 : 0.28;
    riftSSRPass.blurQuality = riftSSRQualityTier === "high" ? 2 : 1;
    riftSSRPass.maxDistance.value = riftSSRQualityTier === "high" ? 0.72 : 0.48;
    riftSSRPass.intensity.value = riftSSRBaseIntensity;
    riftSSRPass.thickness.value = riftSSRQualityTier === "high" ? 0.020 : 0.026;
  }
}

// Model 3.5b: native r185 screen-space volumetric shafts, with the current
// volumetric cloud alpha bound as an occlusion texture. On iPhone the native
// light raymarch stays quarter-ish resolution and unblurred; desktop can afford
// the bilateral cleanup recommended by Three's official Godrays example.
const riftGodraysEnabled =
  renderer.shadowMap.enabled &&
  !new URLSearchParams(location.search).has("godraysOff");
const riftCloudMaskFallbackTexture = new THREE.DataTexture(
  new Uint8Array([0, 0, 0, 0]),
  1,
  1,
  THREE.RGBAFormat,
  THREE.UnsignedByteType,
);
riftCloudMaskFallbackTexture.needsUpdate = true;
riftCloudMaskFallbackTexture.minFilter = THREE.LinearFilter;
riftCloudMaskFallbackTexture.magFilter = THREE.LinearFilter;
const riftGodrayCloudMask = uniformTexture(riftCloudMaskFallbackTexture);
const riftGodrayStrength = uniform(0);
const riftGodrayColor = uniform(new THREE.Color(0xffc46b));
let riftGodraysPass = null;
let riftGodraysTexture = null;
let riftGodraysBlurPass = null;

if (riftGodraysEnabled) {
  riftGodraysPass = godrays(riftSceneDepth, camera, sun);
  riftGodraysPass.raymarchSteps.value = isTouchDevice ? 14 : (riftSSRTier === "high" ? 44 : 30);
  riftGodraysPass.resolutionScale = isTouchDevice ? 0.28 : (riftSSRTier === "high" ? 0.50 : 0.40);
  riftGodraysPass.density.value = 0.16;
  riftGodraysPass.maxDensity.value = isTouchDevice ? 0.30 : 0.44;
  riftGodraysPass.distanceAttenuation.value = 2.0;
  const riftGodraysRaw = riftGodraysPass.getTextureNode();
  if (!isTouchDevice && riftSSRTier === "high") {
    riftGodraysBlurPass = bilateralBlur(riftGodraysRaw);
    riftGodraysTexture = riftGodraysBlurPass.getTextureNode();
  } else {
    riftGodraysTexture = riftGodraysRaw;
  }
}

globalThis.__riftGodraysModel35 = {
  active: !!riftGodraysPass,
  version: "3.5b-native-godrays-cloud-mask",
  mobile: isTouchDevice,
  raymarchSteps: riftGodraysPass?.raymarchSteps?.value ?? 0,
  resolutionScale: riftGodraysPass?.resolutionScale ?? 0,
};`,
    "r185 Water Pro WebGPU SSR + Model 3.5b godrays setup",
  ],
  [
    `const VOLUMETRIC_CLOUDS_ENABLED = getGraphicsSettings().volumetricCloudsEnabled !== false;
const volumetricCloudsHandle = VOLUMETRIC_CLOUDS_ENABLED ? createVolumetricClouds(scene) : null;
const lensDistortedOutput = Fn(() => {`,
    `const VOLUMETRIC_CLOUDS_ENABLED = getGraphicsSettings().volumetricCloudsEnabled !== false;
const volumetricCloudsHandle = VOLUMETRIC_CLOUDS_ENABLED ? createVolumetricClouds(scene) : null;

// Cloud-shaped crepuscular mask. The native GodraysNode handles true scene
// shadow-map occlusion from terrain/trees; these few radial cloud-alpha taps
// make broken cloud openings carve the same shafts in screen space. Three taps
// on touch keeps the extra full-resolution cost small.
const riftCloudShaftSamples = isTouchDevice ? 3 : 5;
const riftCloudShaftMask = Fn(([sampleUV]) => {
  const localAlpha = texture(riftGodrayCloudMask, sampleUV).a;
  const localClear = float(1).sub(smoothstep(float(0.10), float(0.82), localAlpha));
  const toSun = lensSunScreenPos.sub(sampleUV);
  const rayLength = toSun.length();
  const pathClear = float(0).toVar();

  If(riftGodrayStrength.greaterThan(float(0.005)), () => {
    Loop(riftCloudShaftSamples, ({ i }) => {
      const tap = float(i).add(float(1)).div(float(riftCloudShaftSamples + 1));
      const tapUV = clamp(sampleUV.add(toSun.mul(tap.mul(float(0.90)))), float(0), float(1));
      const tapAlpha = texture(riftGodrayCloudMask, tapUV).a;
      pathClear.addAssign(
        float(1).sub(smoothstep(float(0.08), float(0.88), tapAlpha))
      );
    });
  });

  const pathTransmission = pathClear.div(float(riftCloudShaftSamples));
  const sunReach = float(1).sub(smoothstep(float(0.16), float(1.05), rayLength));
  return localClear
    .mul(pathTransmission)
    .mul(float(0.42).add(sunReach.mul(float(0.58))));
});

const lensDistortedOutput = Fn(() => {`,
    "Model 3.5b cloud radial shaft mask",
  ],
  [
    "  const sceneColor = texture(scenePassColor, distortedUV);",
    `  const sceneColor = texture(scenePassColor, distortedUV);
  const riftRaySample = riftGodraysTexture
    ? texture(riftGodraysTexture, distortedUV).r
    : float(0);
  const riftRayEnergy = riftRaySample
    .mul(riftGodrayStrength)
    .mul(riftCloudShaftMask(distortedUV));
  const riftGodrayAdd = riftGodrayColor.mul(riftRayEnergy);`,
    "sample Model 3.5b godrays in lens compositor",
  ],
  [
    "  const finalColor = sceneColor.rgb.add(vec3(lightBoost.mul(lensIntensityUniform))).add(sunGlintColor.mul(0.9).mul(lensIntensityUniform));",
    "  const finalColor = sceneColor.rgb.add(vec3(lightBoost.mul(lensIntensityUniform))).add(sunGlintColor.mul(0.9).mul(lensIntensityUniform)).add(riftGodrayAdd);",
    "add Model 3.5b godrays after lens distortion",
  ],
  [
    'postProcessing.outputNode = (getGraphicsSettings().lensEffectEnabled !== false) ? lensDistortedOutput : scenePass;',
    `const riftUnlensedGodrayOutput = Fn(() => {
  const screenUV = uv();
  const baseColor = texture(scenePassColor, screenUV);
  const raySample = riftGodraysTexture
    ? texture(riftGodraysTexture, screenUV).r
    : float(0);
  const rayEnergy = raySample
    .mul(riftGodrayStrength)
    .mul(riftCloudShaftMask(screenUV));
  return vec4(baseColor.rgb.add(riftGodrayColor.mul(rayEnergy)), baseColor.a);
})();

const riftBasePostOutput =
  (getGraphicsSettings().lensEffectEnabled !== false)
    ? lensDistortedOutput
    : riftUnlensedGodrayOutput;

// r183+ SSRNode returns premultiplied reflection color. Add RGB to the beauty
// pass after the godray/lens stage instead of using the old blendColor() path.
postProcessing.outputNode =
  (riftSSREnabled && riftSSRPass)
    ? riftBasePostOutput.add(riftSSRPass.rgb)
    : riftBasePostOutput;`,
    "r185 Water Pro additive SSR + Model 3.5b godray composition",
  ],
  [
    `    updateVolumetricClouds(
      volumetricCloudsHandle, dt, camera, tempSunDir, dayNightCycle.sun.color, tempCloudAmbient,
      weatherHandle ? weatherHandle.lightningFlash : 0,
      weatherHandle ? weatherHandle.lightningLight.color : null,
      wind.windX, wind.windZ, wind.rainIntensity, currentBiome
    );
  }

  // Rain is an above-surface effect — real rain doesn't fall underwater.`,
    `    updateVolumetricClouds(
      volumetricCloudsHandle, dt, camera, tempSunDir, dayNightCycle.sun.color, tempCloudAmbient,
      weatherHandle ? weatherHandle.lightningFlash : 0,
      weatherHandle ? weatherHandle.lightningLight.color : null,
      wind.windX, wind.windZ, wind.rainIntensity, currentBiome
    );

    // Bind the CURRENT straight-alpha cloud render to the post chain. Temporal
    // history remains responsible for visible cloud RGB, but current-frame alpha
    // is the correct occlusion signal for moving sun shafts.
    const riftCurrentCloudTexture =
      volumetricCloudsHandle.__riftTemporalCloudState?.cloudPass?.getTexture?.("output");
    if (riftCurrentCloudTexture && riftGodrayCloudMask.value !== riftCurrentCloudTexture) {
      riftGodrayCloudMask.value = riftCurrentCloudTexture;
    }
  }

  if (riftGodraysPass) {
    const celestial =
      globalThis.__riftCelestialModel35 ||
      globalThis.__riftCelestialModel34 ||
      {};
    const altitudeDeg = Number(celestial.altitudeDeg) || -90;
    const daylight = THREE.MathUtils.clamp(Number(celestial.daylight) || 0, 0, 1);
    const storm = THREE.MathUtils.clamp(
      Number(celestial.storm ?? wind.rainIntensity) || 0,
      0,
      1
    );
    const cloudTransmittance = THREE.MathUtils.clamp(
      Number(celestial.cloudTransmittance ?? 1),
      0,
      1
    );
    const brokenCloud =
      1 - Math.min(1, Math.abs(cloudTransmittance * 2 - 1));
    const golden = THREE.MathUtils.clamp(
      Number(celestial.goldenHour ?? celestial.sunsetStrength) || 0,
      0,
      1
    );
    const lowSun = THREE.MathUtils.clamp(
      1 - Math.max(0, altitudeDeg - 18) / 30,
      0,
      1
    );
    const horizonVisible = THREE.MathUtils.clamp(
      (altitudeDeg + 3) / 8,
      0,
      1
    );
    const clearWeather = 1 - storm;
    const shaftStrength =
      daylight *
      horizonVisible *
      (0.14 + 0.86 * Math.max(golden, lowSun * 0.46)) *
      (0.34 + 0.66 * brokenCloud) *
      (0.42 + 0.58 * clearWeather);

    riftGodrayStrength.value = THREE.MathUtils.clamp(
      shaftStrength * (isTouchDevice ? 0.68 : 0.82),
      0,
      0.82
    );
    riftGodraysPass.density.value = THREE.MathUtils.lerp(
      0.10,
      isTouchDevice ? 0.30 : 0.38,
      Math.max(golden, brokenCloud * lowSun)
    );
    riftGodraysPass.maxDensity.value = THREE.MathUtils.lerp(
      isTouchDevice ? 0.22 : 0.30,
      isTouchDevice ? 0.48 : 0.62,
      Math.max(golden, brokenCloud * 0.72)
    );
    riftGodraysPass.distanceAttenuation.value = THREE.MathUtils.lerp(
      2.45,
      1.15,
      Math.max(golden, lowSun * 0.72)
    );

    const rayColorSource =
      celestial.sunColor?.isColor
        ? celestial.sunColor
        : dayNightCycle.sun.color;
    riftGodrayColor.value.copy(rayColorSource);
    riftGodrayColor.value.lerp(
      new THREE.Color(0xffb14f),
      Math.max(golden, lowSun * 0.35) * 0.54
    );

    globalThis.__riftGodraysModel35 = {
      ...(globalThis.__riftGodraysModel35 || {}),
      active: true,
      version: "3.5b-native-godrays-cloud-mask",
      altitudeDeg,
      daylight,
      storm,
      cloudTransmittance,
      brokenCloud,
      golden,
      lowSun,
      strength: riftGodrayStrength.value,
      density: riftGodraysPass.density.value,
      maxDensity: riftGodraysPass.maxDensity.value,
      distanceAttenuation: riftGodraysPass.distanceAttenuation.value,
    };
  }

  // Rain is an above-surface effect — real rain doesn't fall underwater.`,
    "Model 3.5b dynamic cloud-occluded godray tuning",
  ],
  [
    "const isFullySubmerged = submergedState;",
    `const isFullySubmerged = submergedState;
  if (riftSSRPass) riftSSRPass.intensity.value = isFullySubmerged ? 0 : riftSSRBaseIntensity;
  if (riftGodraysPass && isFullySubmerged) riftGodrayStrength.value = 0;`,
    "disable SSR and godrays while submerged",
  ],
  [
    "const clock = new THREE.Clock();",
    "const clock = new THREE.Timer();\nclock.connect(document);",
    "r185 Timer migration",
  ],
  [
    "function animate() {\n  requestAnimationFrame(animate);\n  const dt = Math.min(clock.getDelta(), 0.1);",
    "function animate(timestamp) {\n  requestAnimationFrame(animate);\n  clock.update(timestamp);\n  const dt = Math.min(clock.getDelta(), 0.1);",
    "r185 Timer frame update",
  ],
];

const injectedEditLines = extraEdits
  .map(([from, to, label]) => `  [${JSON.stringify(from)}, ${JSON.stringify(to)}, ${JSON.stringify(label)}],`)
  .join("\n");

source = source.replace(
  editsLoopMarker,
  `\n${injectedEditLines}\n];\n\nfor (const [from, to, label] of edits) source = replaceExactlyOnce(source, from, to, label);`,
);

const loaderBaseLine =
  'const baseModuleUrl = new URL("./main_game_rain_base.js", import.meta.url);';
const loaderModuleLine =
  'const moduleBaseUrl = new URL("./", import.meta.url);';
const resolvedBaseLine =
  `const baseModuleUrl = new URL("./main_game_rain_base.js", ${JSON.stringify(moduleBaseUrl.href)});`;
const resolvedModuleLine =
  `const moduleBaseUrl = new URL("./", ${JSON.stringify(moduleBaseUrl.href)});`;

if (!source.includes(loaderBaseLine) || !source.includes(loaderModuleLine)) {
  throw new Error(
    "[rift-water-pro] Tuned loader URL bootstrap changed unexpectedly",
  );
}
source = source.replace(loaderBaseLine, resolvedBaseLine);
source = source.replace(loaderModuleLine, resolvedModuleLine);
source += "\n//# sourceURL=rift/main_game_water_pro.loader.js\n";

const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
