// Model 4.0 review loader hotfix.
//
// The Model 3.5b godray patch is layered on top of the rain/underwater tuning
// loader. That lower loader first changes the lens glint multiplier from 0.9 to
// 0.35, so the later godray edit must look for the already-tuned 0.35 fragment.
// The previous review loader still searched for 0.9 and aborted before Rift
// could boot. Keep the known Model 4 loader pinned below, patch only that ordering
// mismatch, then execute it with this deployed module URL as its base.

const moduleUrl = import.meta.url;
const pinnedLoaderUrl =
  "https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/fb9f117130e09650a3330baa0a0c4123ebe1b7dd/rift/main_game.js";

const response = await fetch(pinnedLoaderUrl, { cache: "no-store" });
if (!response.ok) {
  throw new Error(`[rift-model4-hotfix] Failed to load pinned Model 4 runtime loader: HTTP ${response.status}`);
}

let source = await response.text();

function replaceExactly(sourceText, from, to, label, expectedCount = 1) {
  const count = sourceText.split(from).length - 1;
  if (count !== expectedCount) {
    throw new Error(`[rift-model4-hotfix] Expected ${expectedCount} ${label} fragment(s), found ${count}`);
  }
  return sourceText.split(from).join(to);
}

function replaceFirst(sourceText, from, to, label) {
  const index = sourceText.indexOf(from);
  if (index < 0) {
    throw new Error(`[rift-model4-hotfix] Missing ${label} fragment`);
  }
  return sourceText.slice(0, index) + to + sourceText.slice(index + from.length);
}

// The original loader contains this expression twice: once in the match string
// and once in the replacement string for the godray compositor edit. Preserve
// the underwater lens tuning (0.35) in both places so the ordered edit chain is
// internally consistent.
source = replaceExactly(
  source,
  "sunGlintColor.mul(0.9).mul(lensIntensityUniform)",
  "sunGlintColor.mul(0.35).mul(lensIntensityUniform)",
  "Model 3.5b lens/glint godray",
  2,
);

// A Blob module has a blob: import.meta.url. Re-anchor only the *first* actual
// top-level base-URL expressions to this deployed file. The pinned loader also
// contains the same moduleBaseUrl text inside a generated replacement string,
// so counting/replacing every occurrence corrupts the edit chain.
source = replaceFirst(
  source,
  `const tunedLoaderUrl = new URL(\n  "./main_game_underwater_base.js",\n  import.meta.url,\n);`,
  `const tunedLoaderUrl = new URL(\n  "./main_game_underwater_base.js",\n  ${JSON.stringify(moduleUrl)},\n);`,
  "tuned loader base URL",
);
source = replaceFirst(
  source,
  `const moduleBaseUrl = new URL("./", import.meta.url);`,
  `const moduleBaseUrl = new URL("./", ${JSON.stringify(moduleUrl)});`,
  "module base URL",
);

source += "\n//# sourceURL=rift/main_game_model4_hotfix.runtime.js\n";

const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
