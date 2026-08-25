// Runtime tuning wrapper for rain/underwater presentation plus Water Pro v9.
// The large stable game source remains preserved in main_game_rain_base.js;
// this layer only appends uniquely-validated source edits to the existing tuned
// loader before it executes.
//
// r185 migration note:
// This wrapper now translates the preserved r182-era source to the current
// r185 WebGPU APIs at load time: RenderPipeline, Timer, the updated SSRNode,
// and the isolated Rift Lighting 2.0 hybrid WebGPU lighting experiment.

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
    'import { createDayNightCycle, updateDayNightCycle, CYCLE_SECONDS } from "./dayNightCycle_lighting_v20.js";',
    "Rift Lighting 2.0 photographic celestial path without legacy shadow scheduler",
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
    `import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";\nimport { ssr } from "three/addons/tsl/display/SSRNode.js";\nimport { setupRiftLightingV20 } from "./riftLightingV20.js";`,
    "r185 Water Pro SSR and Rift Lighting 2.0 imports",
  ],
  [
    `const postProcessing = new THREE.PostProcessing(renderer);\nconst scenePass = pass(scene, camera);\nconst scenePassColor = scenePass.getTextureNode("output");`,
    `const postProcessing = new THREE.RenderPipeline(renderer);\nconst scenePass = pass(scene, camera);\nconst riftSSRTier = getGraphicsTier();\nconst riftWaterProfile = globalThis.__riftWaterTestMode === "desktop"\n  ? "desktop"\n  : globalThis.__riftWaterTestMode === "mobile"\n    ? "mobile"\n    : (isTouchDevice ? "mobile" : "desktop");\nconst riftSSRIsMobile = riftWaterProfile === "mobile";\nconst riftForcedDesktopWater = globalThis.__riftWaterTestForced === true && riftWaterProfile === "desktop";\nconst riftSSRQualityTier = riftForcedDesktopWater && riftSSRTier === "low" ? "medium" : riftSSRTier;\nconst riftSSREnabled = riftWaterProfile === "desktop" && riftSSRQualityTier !== "low" && getEffectiveValue("reflectionEnabled") !== false;\nconst riftLighting = setupRiftLightingV20({\n  scene, camera, renderer, sun, moonLight, scenePass,\n  tier: riftSSRTier,\n  isTouchDevice,\n  needSSR: riftSSREnabled,\n});\nconst scenePassColor = riftLighting.sceneColor;\nlet riftSSRPass = null;\nlet riftSSRBaseIntensity = 0;\nif (riftSSREnabled) {\n  riftSSRPass = ssr(scenePassColor, riftLighting.sceneDepth, riftLighting.sceneNormal, {\n    metalnessNode: riftLighting.metalRough.r,\n    roughnessNode: riftLighting.metalRough.g,\n  });\n  if (riftSSRIsMobile) {\n    riftSSRBaseIntensity = 0.30;\n    riftSSRPass.resolutionScale = 0.30;\n    riftSSRPass.quality.value = 0.14;\n    riftSSRPass.blurQuality = 1;\n    riftSSRPass.maxDistance.value = 0.30;\n    riftSSRPass.intensity.value = riftSSRBaseIntensity;\n    riftSSRPass.thickness.value = 0.036;\n  } else {\n    riftSSRBaseIntensity = riftSSRQualityTier === "high" ? 0.82 : 0.58;\n    riftSSRPass.quality.value = riftSSRQualityTier === "high" ? 0.48 : 0.28;\n    riftSSRPass.blurQuality = riftSSRQualityTier === "high" ? 2 : 1;\n    riftSSRPass.maxDistance.value = riftSSRQualityTier === "high" ? 0.72 : 0.48;\n    riftSSRPass.intensity.value = riftSSRBaseIntensity;\n    riftSSRPass.thickness.value = riftSSRQualityTier === "high" ? 0.020 : 0.026;\n  }\n}`,
    "r185 Water Pro plus Rift Lighting 2.0 post setup",
  ],
  [
    'postProcessing.outputNode = (getGraphicsSettings().lensEffectEnabled !== false) ? lensDistortedOutput : scenePass;',
    `const riftBasePostOutput = (getGraphicsSettings().lensEffectEnabled !== false) ? lensDistortedOutput : scenePassColor;\nconst riftLightingPostOutput = riftLighting.compose(riftBasePostOutput);\n// Keep reflections above diffuse AO/GI; SSS/CSM are already integrated into the\n// scene's direct-lighting context before this post composition.\npostProcessing.outputNode = (riftSSREnabled && riftSSRPass) ? riftLightingPostOutput.add(riftSSRPass.rgb) : riftLightingPostOutput;`,
    "Rift Lighting 2.0 composition plus additive SSR",
  ],
  [
    "const isFullySubmerged = submergedState;",
    `const isFullySubmerged = submergedState;\n  riftLighting.update(dt, isFullySubmerged);\n  if (riftSSRPass) riftSSRPass.intensity.value = isFullySubmerged ? 0 : riftSSRBaseIntensity;`,
    "update Rift Lighting 2.0 and disable SSR while submerged",
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
