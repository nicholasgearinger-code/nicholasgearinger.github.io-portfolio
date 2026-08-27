// Rift Islands Environment Performance 1.0 loader.
//
// Wraps the current known-good main_game.js loader and adds only CPU/draw-call/
// pixel-cost optimizations. The cloud, celestial and Water Pro render graphs are
// left untouched. ?perfLegacy=1 keeps the original behavior.

const baseModuleUrl = new URL("./main_game.js", import.meta.url);
const moduleBaseUrl = new URL("./", import.meta.url);

function replaceExactlyOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`[rift-perf] Missing source fragment: ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`[rift-perf] Source fragment is not unique: ${label}`);
  }
  return source.slice(0, first) + to + source.slice(first + from.length);
}

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
    'import { getGraphicsSettings, getGraphicsTier, setGraphicsTier, listGraphicsTiers, getEffectiveValue, setOverride, resetOverrides, getTierRawSettings } from "./graphicsSettings.js";',
    'import { getGraphicsSettings, getGraphicsTier, setGraphicsTier, listGraphicsTiers, getEffectiveValue, setOverride, resetOverrides, getTierRawSettings } from "./graphicsSettings.js";\nimport { getRiftInitialPixelRatio, updateRiftPerformanceGovernor } from "./performanceGovernor.js";',
    "mobile adaptive resolution governor import",
  ],
  [
    'renderer.setSize(viewport.clientWidth, viewport.clientHeight);\nrenderer.setPixelRatio(Math.min(window.devicePixelRatio, getGraphicsSettings().pixelRatioCap));',
    'renderer.setSize(viewport.clientWidth, viewport.clientHeight);\nrenderer.setPixelRatio(getRiftInitialPixelRatio(getGraphicsSettings()));',
    "mobile adaptive initial pixel ratio",
  ],
  [
    'const dt = Math.min(clock.getDelta(), 0.1);',
    'const dt = Math.min(clock.getDelta(), 0.1);\n  updateRiftPerformanceGovernor(renderer, dt, viewport, getGraphicsSettings());',
    "mobile adaptive resolution frame governor",
  ],
];

const injected = perfEdits
  .map(([from, to, label]) => `  [${JSON.stringify(from)}, ${JSON.stringify(to)}, ${JSON.stringify(label)}],`)
  .join("\n");
source = source.replace(
  injectionMarker,
  `\n${injected}\n];\n\nconst injectedEditLines = extraEdits`,
);

// main_game.js is about to execute from a Blob URL. Resolve the two bootstrap
// URLs against this real module directory first so its nested loader still finds
// the same stable source files.
const loaderBaseLine =
  'const tunedLoaderUrl = new URL("./main_game_underwater_base.js", import.meta.url);';
const loaderModuleLine =
  'const moduleBaseUrl = new URL("./", import.meta.url);';
const resolvedBaseLine =
  `const tunedLoaderUrl = new URL("./main_game_underwater_base.js", ${JSON.stringify(moduleBaseUrl.href)});`;
const resolvedModuleLine =
  `const moduleBaseUrl = new URL("./", ${JSON.stringify(moduleBaseUrl.href)});`;

source = replaceExactlyOnce(source, loaderBaseLine, resolvedBaseLine, "known-good loader URL");
source = replaceExactlyOnce(source, loaderModuleLine, resolvedModuleLine, "known-good module base URL");
source += "\n//# sourceURL=rift/main_game_performance.runtime.js\n";

const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
