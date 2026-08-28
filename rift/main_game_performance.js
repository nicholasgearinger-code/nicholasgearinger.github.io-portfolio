// Rift Islands Environment Performance 1.1 loader.
//
// Safe A/B wrapper around the current known-good main_game.js loader.
// Normal Rift stays byte-for-byte on the stable runtime. Enable the staged
// optimization pass with ?perfPreview=1. ?perfLegacy=1 always forces stable.

const baseModuleUrl = new URL("./main_game.js", import.meta.url);
const moduleBaseUrl = new URL("./", import.meta.url);
const params = typeof location !== "undefined"
  ? new URLSearchParams(location.search)
  : null;
const PERF_PREVIEW = params?.has("perfPreview") === true
  && params?.has("perfLegacy") !== true;

function replaceExactlyOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`[rift-perf] Missing source fragment: ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`[rift-perf] Source fragment is not unique: ${label}`);
  }
  return source.slice(0, first) + to + source.slice(first + from.length);
}

if (!PERF_PREVIEW) {
  globalThis.__riftEnvironmentPerformance = {
    enabled: false,
    version: "1.1-30fps-preview",
    reason: params?.has("perfLegacy") ? "perfLegacy" : "preview-not-requested",
  };
  await import(baseModuleUrl);
} else {
  const response = await fetch(baseModuleUrl, { cache: "reload" });
  if (!response.ok) throw new Error(`[rift-perf] Failed to load known-good game loader: HTTP ${response.status}`);
  let source = await response.text();

  const injectionMarker = '\n];\n\nconst injectedEditLines = extraEdits';
  if (!source.includes(injectionMarker)) {
    throw new Error("[rift-perf] main_game.js extraEdits marker changed unexpectedly");
  }

  const perfEdits = [
    [
      'import { createGrass, updateGrass, disposeGrass, createFlowers, updateFlowers, disposeFlowers, createFootstepGlowSystem, spawnFootstepGlow, updateFootstepGlowSystem, disposeFootstepGlowSystem } from "./vegetation.js";',
      'import { createGrass, updateGrass, disposeGrass, createFlowers, updateFlowers, disposeFlowers, createFootstepGlowSystem, spawnFootstepGlow, updateFootstepGlowSystem, disposeFootstepGlowSystem } from "./vegetation_performance.js";',
      "mobile instanced vegetation update optimization",
    ],
    [
      'import { createHorizonSilhouettes, updateHorizonSilhouettes, disposeHorizonSilhouettes } from "./horizonSilhouettes.js";',
      'import { createHorizonSilhouettes, updateHorizonSilhouettes, disposeHorizonSilhouettes } from "./horizonSilhouettes_batched.js";',
      "static horizon BatchedMesh optimization",
    ],
    [
      'import { createVolumetricClouds, updateVolumetricClouds } from "./volumetricClouds_reference_v2.js";',
      'import { createVolumetricClouds, updateVolumetricClouds } from "./volumetricClouds_performance.js";',
      "mobile lower-resolution Model 3.7 volumetric clouds",
    ],
    [
      'import { getGraphicsSettings, getGraphicsTier, setGraphicsTier, listGraphicsTiers, getEffectiveValue, setOverride, resetOverrides, getTierRawSettings } from "./graphicsSettings.js";',
      'import { getGraphicsSettings, getGraphicsTier, setGraphicsTier, listGraphicsTiers, getEffectiveValue, setOverride, resetOverrides, getTierRawSettings } from "./graphicsSettings_performance.js";\nimport { getRiftInitialPixelRatio, updateRiftPerformanceGovernor, updateRiftShadowPerformance, setRiftPerformanceResizeHandler } from "./performanceGovernor.js";',
      "mobile 30fps graphics and governor import",
    ],
    [
      'renderer.setSize(viewport.clientWidth, viewport.clientHeight);\nrenderer.setPixelRatio(Math.min(window.devicePixelRatio, getGraphicsSettings().pixelRatioCap));',
      'renderer.setSize(viewport.clientWidth, viewport.clientHeight);\nrenderer.setPixelRatio(getRiftInitialPixelRatio(getGraphicsSettings()));',
      "mobile adaptive initial pixel ratio",
    ],
    [
      '    renderer.setPixelRatio(Math.min(window.devicePixelRatio, getGraphicsSettings().pixelRatioCap));',
      '    const adaptivePixelRatio = Number(globalThis.__riftPerformanceGovernor?.pixelRatio);\n    renderer.setPixelRatio(Number.isFinite(adaptivePixelRatio) ? adaptivePixelRatio : Math.min(window.devicePixelRatio, getGraphicsSettings().pixelRatioCap));',
      "keep adaptive DPR inside existing resize pipeline",
    ],
    [
      'new ResizeObserver(resizeToViewport).observe(viewport);',
      'setRiftPerformanceResizeHandler(resizeToViewport);\nnew ResizeObserver(resizeToViewport).observe(viewport);',
      "register synchronized adaptive resize handler",
    ],
    [
      'const dt = Math.min(clock.getDelta(), 0.1);',
      'const dt = Math.min(clock.getDelta(), 0.1);\n  updateRiftPerformanceGovernor(renderer, dt, viewport, getGraphicsSettings(), resolutionOverride);',
      "mobile adaptive resolution frame governor",
    ],
    [
      'let dayNight;\n  for (let i = 0; i < debugTimeScale; i++) {\n    dayNight = updateDayNightCycle(dayNightCycle, dt);\n  }',
      'let dayNight;\n  for (let i = 0; i < debugTimeScale; i++) {\n    dayNight = updateDayNightCycle(dayNightCycle, dt);\n  }\n  updateRiftShadowPerformance(sun, moonLight);',
      "mobile shadow map refresh cadence",
    ],
  ];

  const injected = perfEdits
    .map(([from, to, label]) => `  [${JSON.stringify(from)}, ${JSON.stringify(to)}, ${JSON.stringify(label)}],`)
    .join("\n");
  source = source.replace(
    injectionMarker,
    `\n${injected}\n];\n\nconst injectedEditLines = extraEdits`,
  );

  // main_game.js is about to execute from a Blob URL. Rewrite the real two-line
  // bootstrap as one uniquely-identifiable block. The moduleBaseUrl declaration
  // also appears later inside main_game.js as source-code text for its own nested
  // loader, which is why matching that single line by itself was ambiguous.
  const loaderBootstrap = [
    'const tunedLoaderUrl = new URL("./main_game_underwater_base.js", import.meta.url);',
    'const moduleBaseUrl = new URL("./", import.meta.url);',
  ].join("\n");
  const resolvedBootstrap = [
    `const tunedLoaderUrl = new URL("./main_game_underwater_base.js", ${JSON.stringify(moduleBaseUrl.href)});`,
    `const moduleBaseUrl = new URL("./", ${JSON.stringify(moduleBaseUrl.href)});`,
  ].join("\n");

  source = replaceExactlyOnce(source, loaderBootstrap, resolvedBootstrap, "known-good loader bootstrap");
  source += "\n//# sourceURL=rift/main_game_performance.runtime.js\n";

  globalThis.__riftEnvironmentPerformance = {
    enabled: true,
    version: "1.1-30fps-preview",
    targetFps: 30,
    dynamicResolution: true,
    cloudInternalScale: 0.24,
    shadowRefreshCadence: true,
    lowShadowMap256: true,
    staticHighCountGrass: true,
    batchedHorizon: true,
    textureCompression: "prepared-not-active",
  };

  const blob = new Blob([source], { type: "text/javascript" });
  const blobUrl = URL.createObjectURL(blob);
  try {
    await import(blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
