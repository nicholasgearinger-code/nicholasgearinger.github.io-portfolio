// Hotfix wrapper for the underwater realism tuning loader.
// The full tuned loader is preserved unchanged in main_game_underwater_base.js.
// One optional caustic-brightness edit used a non-unique search fragment and
// intentionally tripped the loader's safety check. Remove only that edit before
// executing the preserved loader; all other rain, lens, depth, fog and god-ray
// tuning remains unchanged.

const tunedLoaderUrl = new URL("./main_game_underwater_base.js", import.meta.url);
const moduleBaseUrl = new URL("./", import.meta.url);

const response = await fetch(tunedLoaderUrl, { cache: "reload" });
if (!response.ok) {
  throw new Error(`[rift-underwater-hotfix] Failed to load tuned runtime loader: HTTP ${response.status}`);
}

let source = await response.text();
const lines = source.split("\n");
const badEditLabel = '"seafloor caustic brightness"';
const matchingLines = lines.filter((line) => line.includes(badEditLabel));
if (matchingLines.length !== 1) {
  throw new Error(
    `[rift-underwater-hotfix] Expected exactly one caustic tuning entry, found ${matchingLines.length}`,
  );
}
source = lines.filter((line) => !line.includes(badEditLabel)).join("\n");

// The preserved loader is evaluated from a Blob URL. Rewrite only its two
// actual import.meta.url URL-construction lines. Do not globally replace the
// text, because the loader also contains the literal string "import.meta.url"
// as part of its own runtime-source rewrite step.
const loaderBaseLine = 'const baseModuleUrl = new URL("./main_game_rain_base.js", import.meta.url);';
const loaderModuleLine = 'const moduleBaseUrl = new URL("./", import.meta.url);';
const resolvedBaseLine = `const baseModuleUrl = new URL("./main_game_rain_base.js", ${JSON.stringify(moduleBaseUrl.href)});`;
const resolvedModuleLine = `const moduleBaseUrl = new URL("./", ${JSON.stringify(moduleBaseUrl.href)});`;

if (!source.includes(loaderBaseLine) || !source.includes(loaderModuleLine)) {
  throw new Error("[rift-underwater-hotfix] Tuned loader URL bootstrap changed unexpectedly");
}
source = source.replace(loaderBaseLine, resolvedBaseLine);
source = source.replace(loaderModuleLine, resolvedModuleLine);
source += "\n//# sourceURL=rift/main_game_underwater_hotfixed.loader.js\n";

const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
