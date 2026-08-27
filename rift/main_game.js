// Model 4.6.2 safety rollback entry.
// Depth-based post-process rays triggered WebGPU Invalid CommandEncoder on iPhone.
// Run the known-stable Model 4.5.1 entry from its pinned commit while preserving
// this branch as the module base for all relative runtime assets.

const moduleUrl = import.meta.url;
const stable451Url =
  "https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/cf43bc91ef243933908964c3f5dfd86fc713f1a3/rift/main_game.js";

const response = await fetch(stable451Url, { cache: "no-store" });
if (!response.ok) {
  throw new Error(`[rift-model462-rollback] Failed to load stable 4.5.1: HTTP ${response.status}`);
}

let source = await response.text();
const anchor = "const moduleUrl = import.meta.url;";
const anchorIndex = source.indexOf(anchor);
if (anchorIndex < 0) {
  throw new Error("[rift-model462-rollback] Missing stable 4.5.1 module URL anchor");
}
source =
  source.slice(0, anchorIndex) +
  `const moduleUrl = ${JSON.stringify(moduleUrl)};` +
  source.slice(anchorIndex + anchor.length);

source += "\n;globalThis.__riftModel462Rollback={active:true,version:'4.6.2-stable-451',depthRaysDisabled:true};\n";
source += "\n//# sourceURL=rift/main_game_model462_stable451.runtime.js\n";

const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
