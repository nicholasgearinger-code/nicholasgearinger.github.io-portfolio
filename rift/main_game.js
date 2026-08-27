// Model 4.5 mobile backlit-cloud + custom cloud-godray runtime wrapper.
//
// 4.4.2 proved the stable iPhone path: keep Three r185's native GodraysNode off
// on touch devices. 4.5 preserves that decision, but re-enables the independent
// cloud-transmittance radial shaft term that already exists in the post chain.
// The cloud-only term does not use the native shadow-map GodraysNode and therefore
// avoids the mobile WebGPU CommandEncoder failure while still producing shafts
// through openings in the current volumetric-cloud alpha field.

const moduleUrl = import.meta.url;
const pinned441Url =
  "https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/b5847124358473476880710fcf9f754528c51b47/rift/main_game.js";

const response = await fetch(pinned441Url, { cache: "no-store" });
if (!response.ok) {
  throw new Error(`[rift-model45-mobile-rays] Failed to load pinned 4.4.1 entry: HTTP ${response.status}`);
}

let source = await response.text();

function replaceExactlyOnce(sourceText, from, to, label) {
  const count = sourceText.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`[rift-model45-mobile-rays] Expected one ${label} fragment, found ${count}`);
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

// Inject the Model 4.5 mobile edits into the nested runtime-rewrite stage. The
// final godray declarations live one layer deeper than this wrapper, so the edits
// must execute inside the pinned 4.4.1 source rewriter just before it launches.
const sourceMapMarker = 'source += "\\n//# sourceURL=rift/main_game_model41_hotfix.runtime.js\\n";';
const nestedModel45Patch = `// Model 4.5: native r185 GodraysNode remains disabled on touch.\nsource = replaceFirst(\n  source,\n  \`const riftGodraysEnabled =\\n  renderer.shadowMap.enabled &&\\n  !new URLSearchParams(location.search).has("godraysOff");\`,\n  \`const riftGodraysEnabled =\\n  !isTouchDevice &&\\n  renderer.shadowMap.enabled &&\\n  !new URLSearchParams(location.search).has("godraysOff");\`,\n  "Model 4.5 disable native GodraysNode on touch",\n);\n\n// The custom cloud-transmittance rays use riftGodrayStrength too. Let the\n// strength state update on touch even when the native GodraysNode object is null.\nsource = replaceFirst(\n  source,\n  \`  if (riftGodraysPass) {\\n    const celestial =\`,\n  \`  if (riftGodraysPass || isTouchDevice) {\\n    const celestial =\`,\n  "Model 4.5 update custom mobile godray strength without native pass",\n);\n\n// Native pass tuning must stay guarded because the pass intentionally does not\n// exist on touch. Desktop keeps the same native density/attenuation controls.\nsource = replaceFirst(\n  source,\n  \`    riftGodraysPass.density.value = THREE.MathUtils.lerp(\\n      0.10,\\n      isTouchDevice ? 0.30 : 0.38,\\n      Math.max(golden, brokenCloud * lowSun)\\n    );\\n    riftGodraysPass.maxDensity.value = THREE.MathUtils.lerp(\\n      isTouchDevice ? 0.22 : 0.30,\\n      isTouchDevice ? 0.48 : 0.62,\\n      Math.max(golden, brokenCloud * 0.72)\\n    );\\n    riftGodraysPass.distanceAttenuation.value = THREE.MathUtils.lerp(\\n      2.45,\\n      1.15,\\n      Math.max(golden, lowSun * 0.72)\\n    );\`,\n  \`    if (riftGodraysPass) {\\n      riftGodraysPass.density.value = THREE.MathUtils.lerp(\\n        0.10,\\n        0.38,\\n        Math.max(golden, brokenCloud * lowSun)\\n      );\\n      riftGodraysPass.maxDensity.value = THREE.MathUtils.lerp(\\n        0.30,\\n        0.62,\\n        Math.max(golden, brokenCloud * 0.72)\\n      );\\n      riftGodraysPass.distanceAttenuation.value = THREE.MathUtils.lerp(\\n        2.45,\\n        1.15,\\n        Math.max(golden, lowSun * 0.72)\\n      );\\n    }\`,\n  "Model 4.5 guard desktop native godray tuning",\n);\n\n// 4.1 already created the cloud-only radial scattering energy. Increase that\n// independent term on touch so visible shafts survive the mobile tone map while\n// remaining restrained on desktop. No native GodraysNode texture is required.\nsource = replaceExactly(\n  source,\n  \`    .mul(float(0.26));\`,\n  \`    .mul(float(isTouchDevice ? 0.48 : 0.30));\`,\n  "Model 4.5 cloud-only ray energy",\n  2,\n);\n\n// Report the stable mobile path separately from the legacy native-pass debug.\nsource = replaceFirst(\n  source,\n  \`globalThis.__riftGodraysModel35 = {\`,\n  \`globalThis.__riftGodraysModel45 = {\\n  active: true,\\n  version: "4.5-cloud-transmittance-radial-rays",\\n  mobileCloudOnly: isTouchDevice,\\n  nativePassOnTouch: false,\\n};\\n\\nglobalThis.__riftGodraysModel35 = {\`,\n  "Model 4.5 godray debug marker",\n);\n\n${sourceMapMarker}`;

source = replaceExactlyOnce(
  source,
  sourceMapMarker,
  nestedModel45Patch,
  "nested 4.4.1 source-map insertion point",
);

source += "\n;globalThis.__riftModel45Runtime={active:true,nativeGodraysDisabledOnTouch:true,customCloudRaysOnTouch:true,threeTarget:'0.185.1'};\n";
source += "\n//# sourceURL=rift/main_game_model45_mobile_cloud_rays.runtime.js\n";

const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
