// Model 4.4.2 mobile WebGPU stability wrapper.
//
// The previous 4.4.1 atlas fix proved the live Data3DTexture upload was not the
// source of the iPhone Invalid CommandEncoder failure. Three r185.1 has known
// WebGPU validation regressions involving shadow/godray-adjacent render passes,
// so this diagnostic/stability layer removes the native GodraysNode pass on
// touch devices while leaving the entire Model 4.4.1 desktop path unchanged.
//
// The underlying 4.4.1 entry is pinned by commit so this wrapper cannot recurse.

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

// The pinned 4.4.1 wrapper is executed from a Blob below. Preserve the real
// HTTP module base so its own relative-URL re-anchoring keeps working.
source = replaceExactlyOnce(
  source,
  "const moduleUrl = import.meta.url;",
  `const moduleUrl = ${JSON.stringify(moduleUrl)};`,
  "module URL anchor",
);

// r185.1 GodraysNode is shadow-map based. On iPhone/other touch devices remove
// that native pass entirely; desktop retains it unchanged. The existing cloud
// renderer, atmospheric Sun, lens pipeline, water and Model 4.4.1 atlas remain.
source = replaceExactlyOnce(
  source,
  `const riftGodraysEnabled =\n  renderer.shadowMap.enabled &&\n  !new URLSearchParams(location.search).has(\"godraysOff\");`,
  `const riftGodraysEnabled =\n  !isTouchDevice &&\n  renderer.shadowMap.enabled &&\n  !new URLSearchParams(location.search).has(\"godraysOff\");`,
  "native GodraysNode enable gate",
);

source += "\n;globalThis.__riftModel442MobileStability={active:true,nativeGodraysDisabledOnTouch:true,threeTarget:'0.185.1'};\n";
source += "\n//# sourceURL=rift/main_game_model442_mobile_stability.runtime.js\n";

const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
