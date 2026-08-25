// Isolated launcher for Rift Lighting 2.0.
// It reuses the proven lazy-loading/UI controller but redirects only the heavy
// game-module import to main_game_lighting2.js. The stable launcher stays intact.

const moduleBaseUrl = new URL("./", import.meta.url);
const stableLauncherUrl = new URL("./main.js", moduleBaseUrl);
const response = await fetch(stableLauncherUrl, { cache: "reload" });
if (!response.ok) throw new Error(`[rift-lighting2-launcher] HTTP ${response.status}`);
let source = await response.text();

function replaceOnce(from, to, label) {
  const first = source.indexOf(from);
  if (first < 0 || source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`[rift-lighting2-launcher] Expected one ${label}`);
  }
  source = source.slice(0, first) + to + source.slice(first + from.length);
}

replaceOnce(
  'const riftModuleScope = new URL("./", import.meta.url).href;',
  `const riftModuleScope = ${JSON.stringify(moduleBaseUrl.href)};`,
  "module scope",
);
replaceOnce(
  'import("./runtime_bootstrap_v3.js")',
  `import(${JSON.stringify(new URL("./runtime_bootstrap_v3.js", moduleBaseUrl).href)})`,
  "runtime bootstrap import",
);
replaceOnce(
  'import("./main_game.js")',
  `import(${JSON.stringify(new URL("./main_game_lighting2.js", moduleBaseUrl).href)})`,
  "Lighting 2 game import",
);

source += "\n//# sourceURL=rift/main_lighting2.launcher.js\n";
const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
