// Runtime tuning wrapper for rain/underwater presentation plus Water Pro v9.
// The large stable game source remains preserved in main_game_rain_base.js;
// this layer only appends uniquely-validated source edits to the existing tuned
// loader before it executes.
//
// r185 migration note:
// This wrapper now translates the preserved r182-era source to the current
// r185 WebGPU APIs at load time: RenderPipeline, Timer, updated SSRNode, and the
// experimental Rift Lighting 2.0 CSM/SSS/GTAO/SSGI stack.

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
    'import { createDayNightCycle, updateDayNightCycle, CYCLE_SECONDS } from "./dayNightCycle_celestial_lighting_v2.js";',
    "Rift Lighting 2 cascaded solar lighting import",
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
    `import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";\nimport { mrt, output, normalView, metalness, roughness, diffuseColor, velocity, sample, packNormalToRGB, unpackRGBToNormal } from "three/tsl";\nimport { ssr } from "three/addons/tsl/display/SSRNode.js";\nimport { sss } from "three/addons/tsl/display/SSSNode.js";\nimport { ao as gtao } from "three/addons/tsl/display/GTAONode.js";\nimport { ssgi } from "three/addons/tsl/display/SSGINode.js";\nimport { traa } from "three/addons/tsl/display/TRAANode.js";`,
    "r185 Water Pro and Rift Lighting 2 imports",
  ],
  [
    `const postProcessing = new THREE.PostProcessing(renderer);\nconst scenePass = pass(scene, camera);\nconst scenePassColor = scenePass.getTextureNode("output");`,
    `const postProcessing = new THREE.RenderPipeline(renderer);\nconst scenePass = pass(scene, camera);\nconst riftSSRTier = getGraphicsTier();\nconst riftLightingTier = riftSSRTier;\nconst riftLighting2Enabled = new URLSearchParams(location.search).get("lighting2") !== "0";\nconst riftSSSEnabled = riftLighting2Enabled;\nconst riftGTAOEnabled = riftLighting2Enabled && riftLightingTier === "low";\nconst riftSSGIEnabled = riftLighting2Enabled && riftLightingTier !== "low" && new URLSearchParams(location.search).get("noSSGI") !== "1";\nconst riftWaterProfile = globalThis.__riftWaterTestMode === "desktop"\n  ? "desktop"\n  : globalThis.__riftWaterTestMode === "mobile"\n    ? "mobile"\n    : (isTouchDevice ? "mobile" : "desktop");\nconst riftSSRIsMobile = riftWaterProfile === "mobile";\nconst riftForcedDesktopWater = globalThis.__riftWaterTestForced === true && riftWaterProfile === "desktop";\nconst riftSSRQualityTier = riftForcedDesktopWater && riftSSRTier === "low" ? "medium" : riftSSRTier;\nconst riftSSREnabled = riftWaterProfile === "desktop" && riftSSRQualityTier !== "low" && getEffectiveValue("reflectionEnabled") !== false;\n\nconst riftNeedsMRT = riftLighting2Enabled || riftSSREnabled;\nif (riftNeedsMRT) {\n  const riftMRT = {\n    output: output,\n    normal: packNormalToRGB(normalView),\n    diffuseColor: diffuseColor,\n    velocity: velocity,\n  };\n  if (riftSSREnabled) riftMRT.metalrough = vec2(metalness, roughness);\n  scenePass.setMRT(mrt(riftMRT));\n}\n\nconst scenePassColor = scenePass.getTextureNode("output");\nconst riftSceneDepth = riftNeedsMRT ? scenePass.getTextureNode("depth") : null;\nconst riftSceneNormalPacked = riftNeedsMRT ? scenePass.getTextureNode("normal") : null;\nconst riftSceneDiffuse = riftNeedsMRT ? scenePass.getTextureNode("diffuseColor") : null;\nconst riftSceneVelocity = riftNeedsMRT ? scenePass.getTextureNode("velocity") : null;\nlet riftSceneNormal = null;\nif (riftNeedsMRT) {\n  const riftNormalTexture = scenePass.getTexture("normal");\n  const riftDiffuseTexture = scenePass.getTexture("diffuseColor");\n  riftNormalTexture.type = THREE.UnsignedByteType;\n  riftDiffuseTexture.type = THREE.UnsignedByteType;\n  riftSceneNormal = sample((uvNode) => unpackRGBToNormal(riftSceneNormalPacked.sample(uvNode)));\n}\n\nlet riftSSSPass = null;\nif (riftSSSEnabled) {\n  riftSSSPass = sss(riftSceneDepth, camera, sun);\n  riftSSSPass.resolutionScale = riftLightingTier === "low" ? 0.50 : riftLightingTier === "medium" ? 0.60 : 0.75;\n  riftSSSPass.quality.value = riftLightingTier === "low" ? 0.20 : riftLightingTier === "medium" ? 0.30 : 0.42;\n  riftSSSPass.maxDistance.value = riftLightingTier === "low" ? 0.55 : riftLightingTier === "medium" ? 0.72 : 0.90;\n  riftSSSPass.thickness.value = riftLightingTier === "low" ? 0.050 : 0.040;\n  riftSSSPass.shadowIntensity.value = riftLightingTier === "low" ? 0.32 : riftLightingTier === "medium" ? 0.38 : 0.44;\n  riftSSSPass.useTemporalFiltering = false;\n}\n\nlet riftGTAOPass = null;\nif (riftGTAOEnabled) {\n  riftGTAOPass = gtao(riftSceneDepth, riftSceneNormal, camera);\n  riftGTAOPass.resolutionScale = 0.50;\n  riftGTAOPass.samples.value = 6;\n  riftGTAOPass.radius.value = 1.15;\n  riftGTAOPass.scale.value = 0.82;\n  riftGTAOPass.thickness.value = 1.0;\n  riftGTAOPass.distanceExponent.value = 1.35;\n  riftGTAOPass.distanceFallOff.value = 0.72;\n  riftGTAOPass.useTemporalFiltering = false;\n}\n\nlet riftSSGIPass = null;\nif (riftSSGIEnabled) {\n  riftSSGIPass = ssgi(scenePassColor, riftSceneDepth, riftSceneNormal, camera);\n  riftSSGIPass.sliceCount.value = riftLightingTier === "high" ? 2 : 1;\n  riftSSGIPass.stepCount.value = riftLightingTier === "high" ? 8 : 6;\n  riftSSGIPass.radius.value = riftLightingTier === "high" ? 10 : 7;\n  riftSSGIPass.thickness.value = 0.85;\n  riftSSGIPass.aoIntensity.value = riftLightingTier === "high" ? 1.05 : 0.90;\n  riftSSGIPass.giIntensity.value = riftLightingTier === "high" ? 2.8 : 1.8;\n  riftSSGIPass.backfaceLighting.value = 0.18;\n  riftSSGIPass.useLinearThickness.value = true;\n  riftSSGIPass.useScreenSpaceSampling.value = true;\n  riftSSGIPass.useTemporalFiltering = true;\n}\n\nlet riftSSRPass = null;\nlet riftSSRBaseIntensity = 0;\nif (riftSSREnabled) {\n  const riftSceneMetalRough = scenePass.getTextureNode("metalrough");\n  const riftMetalRoughTexture = scenePass.getTexture("metalrough");\n  riftMetalRoughTexture.type = THREE.UnsignedByteType;\n  riftSSRPass = ssr(scenePassColor, riftSceneDepth, riftSceneNormal, {\n    metalnessNode: riftSceneMetalRough.r,\n    roughnessNode: riftSceneMetalRough.g,\n  });\n  if (riftSSRIsMobile) {\n    riftSSRBaseIntensity = 0.30;\n    riftSSRPass.resolutionScale = 0.30;\n    riftSSRPass.quality.value = 0.14;\n    riftSSRPass.blurQuality = 1;\n    riftSSRPass.maxDistance.value = 0.30;\n    riftSSRPass.intensity.value = riftSSRBaseIntensity;\n    riftSSRPass.thickness.value = 0.036;\n  } else {\n    riftSSRBaseIntensity = riftSSRQualityTier === "high" ? 0.82 : 0.58;\n    riftSSRPass.quality.value = riftSSRQualityTier === "high" ? 0.48 : 0.28;\n    riftSSRPass.blurQuality = riftSSRQualityTier === "high" ? 2 : 1;\n    riftSSRPass.maxDistance.value = riftSSRQualityTier === "high" ? 0.72 : 0.48;\n    riftSSRPass.intensity.value = riftSSRBaseIntensity;\n    riftSSRPass.thickness.value = riftSSRQualityTier === "high" ? 0.020 : 0.026;\n  }\n}\n\nglobalThis.__riftLighting2 = {\n  active: riftLighting2Enabled,\n  tier: riftLightingTier,\n  csm: true,\n  sss: !!riftSSSPass,\n  gtao: !!riftGTAOPass,\n  ssgi: !!riftSSGIPass,\n  ssr: !!riftSSRPass,\n};`,
    "Rift Lighting 2 WebGPU post stack",
  ],
  [
    'postProcessing.outputNode = (getGraphicsSettings().lensEffectEnabled !== false) ? lensDistortedOutput : scenePass;',
    `const riftBasePostOutput = (getGraphicsSettings().lensEffectEnabled !== false) ? lensDistortedOutput : scenePassColor;\nlet riftLightingOutput = riftBasePostOutput;\n\n// Screen-space contact shadows complement CSM without replacing its long sun\n// shadows. The SSS mask is 1 in lit pixels and approaches (1-intensity) where\n// a short screen-space ray finds an occluder.\nif (riftSSSPass) {\n  riftLightingOutput = vec4(riftLightingOutput.rgb.mul(riftSSSPass.r), riftLightingOutput.a);\n}\n\n// Mobile Low uses a very cheap half-resolution GTAO pass for grounding instead\n// of the much more expensive SSGI path.\nif (riftGTAOPass) {\n  const riftAO = riftGTAOPass.getTextureNode().r;\n  riftLightingOutput = vec4(riftLightingOutput.rgb.mul(riftAO), riftLightingOutput.a);\n}\n\n// Medium/High use SSGI's own AO plus indirect diffuse bounce. The GI term is\n// modulated by the diffuse buffer so metallic/specular surfaces are not treated\n// as diffuse emitters.\nif (riftSSGIPass) {\n  const riftSSGIAO = riftSSGIPass.getAONode();\n  const riftSSGIGI = riftSSGIPass.getGINode();\n  const riftGIColor = riftSceneDiffuse.rgb.mul(riftSSGIGI.rgb);\n  riftLightingOutput = vec4(riftLightingOutput.rgb.mul(riftSSGIAO).add(riftGIColor), riftLightingOutput.a);\n}\n\n// r183+ SSRNode returns premultiplied reflection color. Add RGB to the beauty\n// pass instead of using the old blendColor() path.\nif (riftSSREnabled && riftSSRPass) {\n  riftLightingOutput = riftLightingOutput.add(vec4(riftSSRPass.rgb, 0));\n}\n\n// SSGI's temporal mode expects TRAA around the final composite. Low deliberately\n// avoids this cost and uses non-temporal SSS/GTAO only.\npostProcessing.outputNode = (riftSSGIPass && riftSSGIPass.useTemporalFiltering)\n  ? traa(riftLightingOutput, riftSceneDepth, riftSceneVelocity, camera)\n  : riftLightingOutput;`,
    "Rift Lighting 2 hybrid composition",
  ],
  [
    "const isFullySubmerged = submergedState;",
    `const isFullySubmerged = submergedState;\n  if (riftSSRPass) riftSSRPass.intensity.value = isFullySubmerged ? 0 : riftSSRBaseIntensity;\n  if (riftSSSPass) riftSSSPass.shadowIntensity.value = isFullySubmerged ? 0.08 : (riftLightingTier === "low" ? 0.32 : riftLightingTier === "medium" ? 0.38 : 0.44);\n  if (riftSSGIPass) riftSSGIPass.giIntensity.value = isFullySubmerged ? 0.55 : (riftLightingTier === "high" ? 2.8 : 1.8);`,
    "underwater screen-space lighting budget",
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
source += "\n//# sourceURL=rift/main_game_lighting_v2.loader.js\n";

const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
