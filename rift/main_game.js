// Model 4.5.1 mobile backlit-cloud + custom cloud-godray runtime wrapper.
//
// 4.4.2 proved the stable iPhone path: keep Three r185's native GodraysNode off
// on touch devices. The first 4.5 build widened the native-pass update block to
// run on touch, which allowed later native-pass code to execute with a null
// riftGodraysPass. 4.5.1 instead computes ONLY the scalar custom-ray strength in
// a separate mobile block and leaves the entire native GodraysNode block guarded
// by `if (riftGodraysPass)` exactly as before.

const moduleUrl = import.meta.url;
const pinned441Url =
  "https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/b5847124358473476880710fcf9f754528c51b47/rift/main_game.js";

const response = await fetch(pinned441Url, { cache: "no-store" });
if (!response.ok) {
  throw new Error(`[rift-model451-mobile-rays] Failed to load pinned 4.4.1 entry: HTTP ${response.status}`);
}

let source = await response.text();

function replaceExactlyOnce(sourceText, from, to, label) {
  const count = sourceText.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`[rift-model451-mobile-rays] Expected one ${label} fragment, found ${count}`);
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

// Inject Model 4.5.1 into the nested runtime-rewrite stage. The actual game
// source is one layer deeper than this wrapper.
const sourceMapMarker = 'source += "\\n//# sourceURL=rift/main_game_model41_hotfix.runtime.js\\n";';
const nestedModel451Patch = `// Model 4.5.1: native r185 GodraysNode remains disabled on touch.\nsource = replaceFirst(\n  source,\n  \`const riftGodraysEnabled =\\n  renderer.shadowMap.enabled &&\\n  !new URLSearchParams(location.search).has("godraysOff");\`,\n  \`const riftGodraysEnabled =\\n  !isTouchDevice &&\\n  renderer.shadowMap.enabled &&\\n  !new URLSearchParams(location.search).has("godraysOff");\`,\n  "Model 4.5.1 disable native GodraysNode on touch",\n);\n\n// Compute mobile cloud-ray strength independently. Do NOT widen the native\n// riftGodraysPass block: that object is intentionally null on touch devices.\nsource = replaceFirst(\n  source,\n  \`  if (riftGodraysPass) {\\n    const celestial =\`,\n  \`  if (!riftGodraysPass && isTouchDevice) {\\n    const mobileCelestial =\\n      globalThis.__riftCelestialModel35 ||\\n      globalThis.__riftCelestialModel34 ||\\n      {};\\n    const mobileWeather = globalThis.__riftProceduralWeatherState || {};\\n    const mobileAltitudeDeg = Number(mobileCelestial.altitudeDeg) || -90;\\n    const mobileDaylight = THREE.MathUtils.clamp(\\n      Number(mobileCelestial.daylight ?? 0), 0, 1\\n    );\\n    const mobileStorm = THREE.MathUtils.clamp(\\n      Number(mobileWeather.stormIntensity ?? mobileCelestial.storm ?? 0), 0, 1\\n    );\\n    const mobileCloudT = THREE.MathUtils.clamp(\\n      Number(\\n        mobileCelestial.cloudTransmittance ??\\n        globalThis.__riftCloudShadowState?.averageTransmittance ??\\n        1\\n      ),\\n      0,\\n      1\\n    );\\n    const mobileBrokenCloud =\\n      1 - Math.min(1, Math.abs(mobileCloudT * 2 - 1));\\n    const mobileGolden = THREE.MathUtils.clamp(\\n      Number(mobileCelestial.goldenHour ?? mobileCelestial.sunsetStrength ?? 0),\\n      0,\\n      1\\n    );\\n    const mobileLowSun = THREE.MathUtils.clamp(\\n      1 - Math.abs(mobileAltitudeDeg - 5) / 18,\\n      0,\\n      1\\n    );\\n    const mobileHorizonVisible = THREE.MathUtils.clamp(\\n      (mobileAltitudeDeg + 3) / 8,\\n      0,\\n      1\\n    );\\n    const mobileShaftStrength =\\n      mobileDaylight *\\n      mobileHorizonVisible *\\n      (0.16 + 0.84 * Math.max(mobileGolden, mobileLowSun * 0.58)) *\\n      (0.26 + 0.74 * mobileBrokenCloud) *\\n      (0.38 + 0.62 * (1 - mobileStorm));\\n\\n    riftGodrayStrength.value = THREE.MathUtils.clamp(\\n      mobileShaftStrength * 1.18,\\n      0,\\n      1.18\\n    );\\n  }\\n\\n  if (riftGodraysPass) {\\n    const celestial =\`,\n  "Model 4.5.1 isolated mobile cloud-ray strength",\n);\n\n// 4.1 already created the cloud-only radial scattering energy. Increase that\n// independent term on touch so visible shafts survive the mobile tone map while\n// remaining restrained on desktop. No native GodraysNode texture is required.\nsource = replaceExactly(\n  source,\n  \`    .mul(float(0.26));\`,\n  \`    .mul(float(isTouchDevice ? 0.48 : 0.30));\`,\n  "Model 4.5.1 cloud-only ray energy",\n  2,\n);\n\n// Report the stable mobile path separately from the legacy native-pass debug.\nsource = replaceFirst(\n  source,\n  \`globalThis.__riftGodraysModel35 = {\`,\n  \`globalThis.__riftGodraysModel45 = {\\n  active: true,\\n  version: "4.5.1-cloud-transmittance-radial-rays",\\n  mobileCloudOnly: isTouchDevice,\\n  nativePassOnTouch: false,\\n};\\n\\nglobalThis.__riftGodraysModel35 = {\`,\n  "Model 4.5.1 godray debug marker",\n);\n\n${sourceMapMarker}`;

source = replaceExactlyOnce(
  source,
  sourceMapMarker,
  nestedModel451Patch,
  "nested 4.4.1 source-map insertion point",
);

source += "\n;globalThis.__riftModel45Runtime={active:true,version:'4.5.1',nativeGodraysDisabledOnTouch:true,customCloudRaysOnTouch:true,threeTarget:'0.185.1'};\n";
source += "\n//# sourceURL=rift/main_game_model451_mobile_cloud_rays.runtime.js\n";

const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
