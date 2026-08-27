// Model 4.6.1 depth-occlusion god rays — flattened wrapper.
//
// This version starts from the proven Model 4.4.1 integration point and injects
// the stable 4.5.1 mobile path plus the depth/cloud shaft changes in ONE nested
// rewrite stage. Keeping this to one generated-runtime layer avoids the malformed
// nested template that produced Safari's "Unexpected keyword const" syntax error.

const moduleUrl = import.meta.url;
const pinned441Url =
  "https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/b5847124358473476880710fcf9f754528c51b47/rift/main_game.js";

const response = await fetch(pinned441Url, { cache: "no-store" });
if (!response.ok) {
  throw new Error(`[rift-model461-depth-rays] Failed to load pinned 4.4.1 entry: HTTP ${response.status}`);
}

let source = await response.text();

function replaceExactlyOnce(sourceText, from, to, label) {
  const count = sourceText.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`[rift-model461-depth-rays] Expected one ${label} fragment, found ${count}`);
  }
  return sourceText.replace(from, to);
}

// Preserve the branch HTTP base when the 4.4.1 wrapper executes from this Blob.
// The same text also occurs inside generated templates, so replace only the real
// first declaration instead of enforcing a global count.
const moduleAnchor = "const moduleUrl = import.meta.url;";
const moduleAnchorIndex = source.indexOf(moduleAnchor);
if (moduleAnchorIndex < 0) {
  throw new Error("[rift-model461-depth-rays] Missing module URL anchor");
}
source =
  source.slice(0, moduleAnchorIndex) +
  `const moduleUrl = ${JSON.stringify(moduleUrl)};` +
  source.slice(moduleAnchorIndex + moduleAnchor.length);

// Inject all mobile stability + depth-ray edits directly into the 4.4.1 runtime
// rewrite stage. This is the same proven insertion point used by Model 4.5.1.
const sourceMapMarker = 'source += "\\n//# sourceURL=rift/main_game_model41_hotfix.runtime.js\\n";';
const nestedModel461Patch = `// Model 4.6.1: keep native r185 GodraysNode disabled on touch.\nsource = replaceFirst(\n  source,\n  \`const riftGodraysEnabled =\\n  renderer.shadowMap.enabled &&\\n  !new URLSearchParams(location.search).has("godraysOff");\`,\n  \`const riftGodraysEnabled =\\n  !isTouchDevice &&\\n  renderer.shadowMap.enabled &&\\n  !new URLSearchParams(location.search).has("godraysOff");\`,\n  "Model 4.6.1 disable native GodraysNode on touch",\n);\n\n// Compute mobile custom-ray strength without touching the null native pass.\nsource = replaceFirst(\n  source,\n  \`  if (riftGodraysPass) {\\n    const celestial =\`,\n  \`  if (!riftGodraysPass && isTouchDevice) {\\n    const mobileCelestial =\\n      globalThis.__riftCelestialModel35 ||\\n      globalThis.__riftCelestialModel34 ||\\n      {};\\n    const mobileWeather = globalThis.__riftProceduralWeatherState || {};\\n    const mobileAltitudeDeg = Number(mobileCelestial.altitudeDeg) || -90;\\n    const mobileDaylight = THREE.MathUtils.clamp(\\n      Number(mobileCelestial.daylight ?? 0), 0, 1\\n    );\\n    const mobileStorm = THREE.MathUtils.clamp(\\n      Number(mobileWeather.stormIntensity ?? mobileCelestial.storm ?? 0), 0, 1\\n    );\\n    const mobileCloudT = THREE.MathUtils.clamp(\\n      Number(\\n        mobileCelestial.cloudTransmittance ??\\n        globalThis.__riftCloudShadowState?.averageTransmittance ??\\n        1\\n      ),\\n      0,\\n      1\\n    );\\n    const mobileBrokenCloud =\\n      1 - Math.min(1, Math.abs(mobileCloudT * 2 - 1));\\n    const mobileGolden = THREE.MathUtils.clamp(\\n      Number(mobileCelestial.goldenHour ?? mobileCelestial.sunsetStrength ?? 0),\\n      0,\\n      1\\n    );\\n    const mobileLowSun = THREE.MathUtils.clamp(\\n      1 - Math.abs(mobileAltitudeDeg - 5) / 18,\\n      0,\\n      1\\n    );\\n    const mobileHorizonVisible = THREE.MathUtils.clamp(\\n      (mobileAltitudeDeg + 3) / 8,\\n      0,\\n      1\\n    );\\n    const mobileShaftStrength =\\n      mobileDaylight *\\n      mobileHorizonVisible *\\n      (0.16 + 0.84 * Math.max(mobileGolden, mobileLowSun * 0.58)) *\\n      (0.26 + 0.74 * mobileBrokenCloud) *\\n      (0.38 + 0.62 * (1 - mobileStorm));\\n\\n    riftGodrayStrength.value = THREE.MathUtils.clamp(\\n      mobileShaftStrength * 1.18,\\n      0,\\n      1.18\\n    );\\n  }\\n\\n  if (riftGodraysPass) {\\n    const celestial =\`,\n  "Model 4.6.1 isolated mobile shaft strength",\n);\n\n// First preserve the 4.5.1 cloud-only mobile energy boost.\nsource = replaceExactly(\n  source,\n  \`    .mul(float(0.26));\`,\n  \`    .mul(float(isTouchDevice ? 0.48 : 0.30));\`,\n  "Model 4.6.1 base mobile ray energy",\n  2,\n);\n\n// Replace the cloud-only path mask with cloud transparency + scene depth.\n// All texture reads are unconditional and scenePassColor is never sampled here.\nsource = replaceFirst(\n  source,\n  \`const riftCloudShaftSamples = isTouchDevice ? 4 : 6;\\nconst riftCloudShaftMask = Fn(([sampleUV]) => {\\n  const localAlpha = texture(riftGodrayCloudMask, sampleUV).a;\\n  const localClear = float(1).sub(smoothstep(float(0.10), float(0.82), localAlpha));\\n  const toSun = lensSunScreenPos.sub(sampleUV);\\n  const rayLength = toSun.length();\\n  const pathClear = float(0).toVar();\\n\\n  If(riftGodrayStrength.greaterThan(float(0.005)), () => {\\n    Loop(riftCloudShaftSamples, ({ i }) => {\\n      const tap = float(i).add(float(1)).div(float(riftCloudShaftSamples + 1));\\n      const tapUV = clamp(sampleUV.add(toSun.mul(tap.mul(float(0.90)))), float(0), float(1));\\n      const tapAlpha = texture(riftGodrayCloudMask, tapUV).a;\\n      pathClear.addAssign(\\n        float(1).sub(smoothstep(float(0.08), float(0.88), tapAlpha))\\n      );\\n    });\\n  });\\n\\n  const pathTransmission = pathClear.div(float(riftCloudShaftSamples));\\n  const mixedPath = smoothstep(float(0.06), float(0.48), pathTransmission)\\n    .mul(float(1).sub(smoothstep(float(0.62), float(0.98), pathTransmission)));\\n  const sunReach = float(1).sub(smoothstep(float(0.14), float(1.08), rayLength));\\n  return localClear\\n    .mul(float(0.08).add(mixedPath.mul(float(0.92))))\\n    .mul(float(0.34).add(sunReach.mul(float(0.66))));\\n});\`,\n  \`const riftCloudShaftSamples = isTouchDevice ? 5 : 8;\\nconst riftCloudShaftMask = Fn(([sampleUV]) => {\\n  const localAlpha = texture(riftGodrayCloudMask, sampleUV).a;\\n  const localCloudClear = float(1).sub(smoothstep(float(0.10), float(0.82), localAlpha));\\n  const toSun = lensSunScreenPos.sub(sampleUV);\\n  const rayLength = toSun.length();\\n  const pathVisibility = float(0).toVar();\\n\\n  Loop(riftCloudShaftSamples, ({ i }) => {\\n    const tap = float(i).add(float(1)).div(float(riftCloudShaftSamples + 1));\\n    const sunBiasedTap = tap.pow(float(1.35));\\n    const tapUV = clamp(\\n      sampleUV.add(toSun.mul(sunBiasedTap.mul(float(0.965)))),\\n      float(0),\\n      float(1)\\n    );\\n    const tapAlpha = texture(riftGodrayCloudMask, tapUV).a;\\n    const tapCloudClear = float(1).sub(smoothstep(float(0.08), float(0.88), tapAlpha));\\n    const tapDepth = riftSceneDepth.sample(tapUV).r;\\n    const tapSceneOpen = smoothstep(float(0.9984), float(0.99997), tapDepth);\\n    pathVisibility.addAssign(tapCloudClear.mul(tapSceneOpen));\\n  });\\n\\n  const pathTransmission = pathVisibility.div(float(riftCloudShaftSamples));\\n  const mixedPath = smoothstep(float(0.08), float(0.52), pathTransmission)\\n    .mul(float(1).sub(smoothstep(float(0.70), float(0.995), pathTransmission)));\\n  const sunReach = float(1).sub(smoothstep(float(0.13), float(1.10), rayLength));\\n  return localCloudClear\\n    .mul(float(0.045).add(mixedPath.mul(float(0.955))))\\n    .mul(float(0.48).add(sunReach.mul(float(0.52))));\\n});\`,\n  "Model 4.6.1 depth + cloud shaft mask",\n);\n\n// Slightly stronger custom shafts on touch now that scene geometry contributes.\nsource = replaceExactly(\n  source,\n  \`    .mul(float(isTouchDevice ? 0.48 : 0.30));\`,\n  \`    .mul(float(isTouchDevice ? 0.62 : 0.30));\`,\n  "Model 4.6.1 depth/cloud ray energy",\n  2,\n);\n\n// Report both the stable mobile path and the depth-ray revision.\nsource = replaceFirst(\n  source,\n  \`globalThis.__riftGodraysModel35 = {\`,\n  \`globalThis.__riftGodraysModel461 = {\\n  active: true,\\n  version: "4.6.1-depth-cloud-radial-rays",\\n  mobileCloudOnly: false,\\n  nativePassOnTouch: false,\\n  samples: isTouchDevice ? 5 : 8,\\n  readsSceneColorInMask: false,\\n};\\n\\nglobalThis.__riftGodraysModel35 = {\`,\n  "Model 4.6.1 godray debug marker",\n);\n\n${sourceMapMarker}`;

source = replaceExactlyOnce(
  source,
  sourceMapMarker,
  nestedModel461Patch,
  "nested 4.4.1 source-map insertion point",
);

source += "\n;globalThis.__riftModel461Runtime={active:true,version:'4.6.1',depthCloudRays:true,sceneColorFeedback:false,nativeGodraysDisabledOnTouch:true,threeTarget:'0.185.1'};\n";
source += "\n//# sourceURL=rift/main_game_model461_depth_cloud_rays.runtime.js\n";

const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
