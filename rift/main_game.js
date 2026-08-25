// Runtime tuning wrapper for the live Rift game.
// The large stable source remains preserved in main_game_rain_base.js; this
// layer applies uniquely-validated edits before executing it. The live Rift
// runtime now targets Three.js r185 while keeping desktop-only SSR out of the
// mobile module graph.

const tunedLoaderUrl = new URL(
  "./main_game_underwater_base.js",
  import.meta.url,
);
const moduleBaseUrl = new URL("./", import.meta.url);

const response = await fetch(tunedLoaderUrl, { cache: "reload" });
if (!response.ok) {
  throw new Error(
    `[rift-r185] Failed to load tuned runtime loader: HTTP ${response.status}`,
  );
}

let source = await response.text();

const lines = source.split("\n");
const badEditLabel = '"seafloor caustic brightness"';
const matchingLines = lines.filter((line) => line.includes(badEditLabel));
if (matchingLines.length !== 1) {
  throw new Error(
    `[rift-r185] Expected exactly one caustic tuning entry, found ${matchingLines.length}`,
  );
}
source = lines.filter((line) => !line.includes(badEditLabel)).join("\n");

const editsLoopMarker =
  '\n];\n\nfor (const [from, to, label] of edits) source = replaceExactlyOnce(source, from, to, label);';

if (!source.includes(editsLoopMarker)) {
  throw new Error(
    "[rift-r185] Tuned loader edit loop changed unexpectedly",
  );
}

const coreEdits = [
  [
    'import { createVolumetricClouds, updateVolumetricClouds } from "./volumetricClouds.js";',
    'import { createVolumetricClouds, updateVolumetricClouds } from "./volumetricClouds_reference_v2.js";',
    "photo-reference progressive volumetric cloud renderer import",
  ],
  [
    'import { createDayNightCycle, updateDayNightCycle, CYCLE_SECONDS } from "./dayNightCycle.js";',
    'import { createDayNightCycle, updateDayNightCycle, CYCLE_SECONDS } from "./dayNightCycle_celestial_physical_v5.js";',
    "stable physical sun and atmosphere import",
  ],
  [
    'import { createWeatherSystem, updateWeatherSystem, disposeWeatherSystem } from "./weather.js";',
    'import { createWeatherSystem, updateWeatherSystem, disposeWeatherSystem } from "./weather_stable_lighting.js";',
    "stable storm lighting import",
  ],
  [
    "const postProcessing = new THREE.PostProcessing(renderer);",
    "const postProcessing = new THREE.RenderPipeline(renderer);",
    "r185 RenderPipeline migration",
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
  [
    "moonLight.castShadow = true;",
    'moonLight.castShadow = getGraphicsTier() !== "low";',
    "single directional shadow pass on mobile low",
  ],
  [
    "sun.shadow.bias = -0.0015;",
    'sun.shadow.bias = getGraphicsTier() === "low" ? -0.00028 : -0.0015;',
    "r185 mobile sun shadow depth bias",
  ],
  [
    "sun.shadow.normalBias = 0.05;",
    'sun.shadow.normalBias = getGraphicsTier() === "low" ? 0.018 : 0.05;',
    "r185 mobile sun shadow normal bias",
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
    "const finalColor = sceneColor.rgb.add(vec3(lightBoost.mul(lensIntensityUniform))).add(sunGlintColor.mul(0.9).mul(lensIntensityUniform));",
    "const finalColor = sceneColor.rgb.add(sunGlintColor.mul(0.05).mul(lensIntensityUniform));",
    "remove additive rain-lens brightness flicker",
  ],
];

// Safari/iOS should never evaluate the desktop SSR addon unless Desktop water
// is explicitly requested. r185 fixes the FFT compute/storage path, but keeping
// desktop SSR out of Mobile still avoids unnecessary module and render cost.
const desktopSSRRequested = globalThis.__riftWaterTestMode === "desktop";

const desktopSSREdits = [
  [
    'import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";',
    `import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";\nimport { mrt, output, normalView, metalness, roughness, sample, packNormalToRGB, unpackRGBToNormal } from "three/tsl";\nimport { ssr } from "three/addons/tsl/display/SSRNode.js";`,
    "r185 desktop Water Pro SSR imports",
  ],
  [
    `const postProcessing = new THREE.RenderPipeline(renderer);\nconst scenePass = pass(scene, camera);\nconst scenePassColor = scenePass.getTextureNode("output");`,
    `const postProcessing = new THREE.RenderPipeline(renderer);\nconst scenePass = pass(scene, camera);\nconst riftSSRTier = getGraphicsTier();\nconst riftSSRQualityTier = riftSSRTier === "low" ? "medium" : riftSSRTier;\nconst riftSSREnabled = getEffectiveValue("reflectionEnabled") !== false;\nlet riftSSRPass = null;\nlet riftSSRBaseIntensity = 0;\nif (riftSSREnabled) {\n  scenePass.setMRT(mrt({\n    output: output,\n    normal: packNormalToRGB(normalView),\n    metalrough: vec2(metalness, roughness),\n  }));\n}\nconst scenePassColor = scenePass.getTextureNode("output");\nif (riftSSREnabled) {\n  const riftSceneNormalPacked = scenePass.getTextureNode("normal");\n  const riftSceneDepth = scenePass.getTextureNode("depth");\n  const riftSceneMetalRough = scenePass.getTextureNode("metalrough");\n  const riftNormalTexture = scenePass.getTexture("normal");\n  const riftMetalRoughTexture = scenePass.getTexture("metalrough");\n  riftNormalTexture.type = THREE.UnsignedByteType;\n  riftMetalRoughTexture.type = THREE.UnsignedByteType;\n  const riftSceneNormal = sample((uvNode) => unpackRGBToNormal(riftSceneNormalPacked.sample(uvNode)));\n  riftSSRPass = ssr(scenePassColor, riftSceneDepth, riftSceneNormal, {\n    metalnessNode: riftSceneMetalRough.r,\n    roughnessNode: riftSceneMetalRough.g,\n  });\n  riftSSRBaseIntensity = riftSSRQualityTier === "high" ? 0.82 : 0.58;\n  riftSSRPass.quality.value = riftSSRQualityTier === "high" ? 0.48 : 0.28;\n  riftSSRPass.blurQuality = riftSSRQualityTier === "high" ? 2 : 1;\n  riftSSRPass.maxDistance.value = riftSSRQualityTier === "high" ? 0.72 : 0.48;\n  riftSSRPass.intensity.value = riftSSRBaseIntensity;\n  riftSSRPass.thickness.value = riftSSRQualityTier === "high" ? 0.020 : 0.026;\n}`,
    "r185 desktop Water Pro SSR setup",
  ],
  [
    'postProcessing.outputNode = (getGraphicsSettings().lensEffectEnabled !== false) ? lensDistortedOutput : scenePass;',
    `const riftBasePostOutput = (getGraphicsSettings().lensEffectEnabled !== false) ? lensDistortedOutput : scenePassColor;\npostProcessing.outputNode = (riftSSREnabled && riftSSRPass) ? riftBasePostOutput.add(riftSSRPass.rgb) : riftBasePostOutput;`,
    "r185 additive SSR composition",
  ],
  [
    "const isFullySubmerged = submergedState;",
    `const isFullySubmerged = submergedState;\n  if (riftSSRPass) riftSSRPass.intensity.value = isFullySubmerged ? 0 : riftSSRBaseIntensity;`,
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
    "[rift-r185] Tuned loader URL bootstrap changed unexpectedly",
  );
}
source = source.replace(loaderBaseLine, resolvedBaseLine);
source = source.replace(loaderModuleLine, resolvedModuleLine);
source += "\n//# sourceURL=rift/main_game_r185_water_pro.loader.js\n";

const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
