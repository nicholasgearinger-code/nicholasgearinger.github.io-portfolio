// Model 4.4.2 mobile WebGPU stability wrapper — corrected nested patch.
//
// The pinned 4.4.1 entry is itself a source-rewriting wrapper. The first 4.4.2
// attempt searched that wrapper for the final riftGodraysEnabled declaration,
// but that declaration exists one layer deeper in the runtime source it fetches.
// This version injects the mobile Godrays disable into the 4.4.1 wrapper's own
// patch sequence, so it is applied at the correct layer.

const moduleUrl = import.meta.url;
const pinned441Url =
  "https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/b5847124358473476880710fcf9f754528c51b47/rift/main_game.js";

const response = await fetch(pinned441Url, { cache: "no-store" });
if (!response.ok) {
  throw new Error(`[rift-model442-mobile-stability] Failed to load pinned 4.4.1 entry: HTTP ${response.status}`);
}

let source = await response.text();

function replaceExactlyOnce(sourceText, from, to, label) {
  const count = sourceText.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`[rift-model442-mobile-stability] Expected one ${label} fragment, found ${count}`);
  }
  return sourceText.replace(from, to);
}

// Preserve the branch HTTP base when the 4.4.1 wrapper runs from this Blob.
source = replaceExactlyOnce(
  source,
  "const moduleUrl = import.meta.url;",
  `const moduleUrl = ${JSON.stringify(moduleUrl)};`,
  "module URL anchor",
);

// Inject one extra replacement into the nested 4.4.1 runtime rewriter. This is
// where riftGodraysEnabled actually exists.
const sourceMapMarker = 'source += "\\n//# sourceURL=rift/main_game_model41_hotfix.runtime.js\\n";';
const nestedMobilePatch = `source = replaceFirst(\n  source,\n  \`const riftGodraysEnabled =\\n  renderer.shadowMap.enabled &&\\n  !new URLSearchParams(location.search).has("godraysOff");\`,\n  \`const riftGodraysEnabled =\\n  !isTouchDevice &&\\n  renderer.shadowMap.enabled &&\\n  !new URLSearchParams(location.search).has("godraysOff");\`,\n  "Model 4.4.2 disable native GodraysNode on touch",\n);\n\n${sourceMapMarker}`;

source = replaceExactlyOnce(
  source,
  sourceMapMarker,
  nestedMobilePatch,
  "nested 4.4.1 source-map insertion point",
);

source += "\n;globalThis.__riftModel442MobileStability={active:true,nativeGodraysDisabledOnTouch:true,threeTarget:'0.185.1',nestedPatch:true};\n";
source += "\n//# sourceURL=rift/main_game_model442_mobile_stability.runtime.js\n";

const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
