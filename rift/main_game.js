// Runtime tuning wrapper for rain/underwater presentation plus Water Pro.
// The large stable game source remains preserved in main_game_rain_base.js;
// this layer only appends uniquely-validated source edits to the existing tuned
// loader before it executes.

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

const coreEdits = [
  [
    'import { createVolumetricClouds, updateVolumetricClouds } from "./volumetricClouds.js";',
    'import { createVolumetricClouds, updateVolumetricClouds } from "./volumetricClouds_reference_v2.js";',
    "progressive low-resolution volumetric cloud renderer import",
  ],
  [
    'import { createDayNightCycle, updateDayNightCycle, CYCLE_SECONDS } from "./dayNightCycle.js";',
    'import { createDayNightCycle, updateDayNightCycle, CYCLE_SECONDS } from "./dayNightCycle_celestial_physical_v5.js";',
    "high-contrast physical sun and atmosphere v5 import",
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
];

// Safari/iOS must not even evaluate Three's SSR addon on the mobile backend.
// Previously the SSR import was injected unconditionally and only disabled at
// runtime. That still forced Safari to evaluate the desktop TSL/SSR module graph
// during the 95% "Loading Rift game module" step, which can fail before any of
// the riftSSREnabled guards run. Build the SSR source edits only for an actual
// desktop water boot; mobile keeps the stable FFT + physical-environment path.
const desktopSSRRequested = globalThis.__riftWaterTestMode === "desktop";

const desktopSSREdits = [
  [
    'import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";',
    `import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";\nimport { mrt, output, normalView, metalness, roughness, blendColor, sample, directionToColor, colorToDirection } from "three/tsl";\nimport { ssr } from "three/addons/tsl/display/SSRNode.js";`,
    "Water Pro SSR imports",
  ],
  [
    `const postProcessing = new THREE.PostProcessing(renderer);\nconst scenePass = pass(scene, camera);\nconst scenePassColor = scenePass.getTextureNode("output");`,
    `const postProcessing = new THREE.PostProcessing(renderer);\nconst scenePass = pass(scene, camera);\nconst riftSSRTier = getGraphicsTier();\nconst riftWaterProfile = globalThis.__riftWaterTestMode === "desktop"\n  ? "desktop"\n  : globalThis.__riftWaterTestMode === "mobile"\n    ? "mobile"\n    : (isTouchDevice ? "mobile" : "desktop");\nconst riftSSRIsMobile = riftWaterProfile === "mobile";\nconst riftForcedDesktopWater = globalThis.__riftWaterTestForced === true && riftWaterProfile === "desktop";\nconst riftSSRQualityTier = riftForcedDesktopWater && riftSSRTier === "low" ? "medium" : riftSSRTier;\nconst riftSSREnabled = riftWaterProfile === "desktop" && riftSSRQualityTier !== "low" && getEffectiveValue("reflectionEnabled") !== false;\nlet riftSSRPass = null;\nlet riftSSRBaseOpacity = 0;\nif (riftSSREnabled) {\n  scenePass.setMRT(mrt({\n    output: output,\n    normal: directionToColor(normalView),\n    metalrough: vec2(metalness, roughness),\n  }));\n}\nconst scenePassColor = scenePass.getTextureNode("output");\nif (riftSSREnabled) {\n  const riftSceneNormalPacked = scenePass.getTextureNode("normal");\n  const riftSceneDepth = scenePass.getTextureNode("depth");\n  const riftSceneMetalRough = scenePass.getTextureNode("metalrough");\n  const riftNormalTexture = scenePass.getTexture("normal");\n  const riftMetalRoughTexture = scenePass.getTexture("metalrough");\n  riftNormalTexture.type = THREE.UnsignedByteType;\n  riftMetalRoughTexture.type = THREE.UnsignedByteType;\n  const riftSceneNormal = sample((uvNode) => colorToDirection(riftSceneNormalPacked.sample(uvNode)));\n  const riftSmoothReflectivity = pow(float(1).sub(riftSceneMetalRough.g), float(3)).mul(0.82);\n  const riftReflectivity = tslMax(riftSceneMetalRough.r, riftSmoothReflectivity);\n  riftSSRPass = ssr(scenePassColor, riftSceneDepth, riftSceneNormal, riftReflectivity, riftSceneMetalRough.g);\n  if (riftSSRIsMobile) {\n    riftSSRBaseOpacity = 0.30;\n    riftSSRPass.resolutionScale = 0.30;\n    riftSSRPass.quality.value = 0.14;\n    riftSSRPass.blurQuality.value = 1;\n    riftSSRPass.maxDistance.value = 0.30;\n    riftSSRPass.opacity.value = riftSSRBaseOpacity;\n    riftSSRPass.thickness.value = 0.036;\n  } else {\n    riftSSRBaseOpacity = riftSSRQualityTier === "high" ? 0.82 : 0.58;\n    riftSSRPass.quality.value = riftSSRQualityTier === "high" ? 0.48 : 0.28;\n    riftSSRPass.blurQuality.value = riftSSRQualityTier === "high" ? 2 : 1;\n    riftSSRPass.maxDistance.value = riftSSRQualityTier === "high" ? 0.72 : 0.48;\n    riftSSRPass.opacity.value = riftSSRBaseOpacity;\n    riftSSRPass.thickness.value = riftSSRQualityTier === "high" ? 0.020 : 0.026;\n  }\n}`,
    "Water Pro WebGPU SSR setup",
  ],
  [
    'postProcessing.outputNode = (getGraphicsSettings().lensEffectEnabled !== false) ? lensDistortedOutput : scenePass;',
    `const riftBasePostOutput = (getGraphicsSettings().lensEffectEnabled !== false) ? lensDistortedOutput : scenePassColor;\npostProcessing.outputNode = (riftSSREnabled && riftSSRPass) ? blendColor(riftBasePostOutput, riftSSRPass) : riftBasePostOutput;`,
    "Water Pro SSR composition",
  ],
  [
    "const isFullySubmerged = submergedState;",
    `const isFullySubmerged = submergedState;\n  if (riftSSRPass) riftSSRPass.opacity.value = isFullySubmerged ? 0 : riftSSRBaseOpacity;`,
    "disable SSR while submerged",
  ],
];

const extraEdits = desktopSSRRequested
  ? [...coreEdits, ...desktopSSREdits]
  : coreEdits;

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
