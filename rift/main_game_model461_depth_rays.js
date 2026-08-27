// Model 4.6.1 depth-occlusion god rays.
// Starts from the proven 4.5.1 iPhone build and changes only the custom radial
// occlusion mask: current cloud alpha + scene depth, never scene color.

const moduleUrl = import.meta.url;
const stable451Url =
  "https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/cf43bc91ef243933908964c3f5dfd86fc713f1a3/rift/main_game.js";

const response = await fetch(stable451Url, { cache: "no-store" });
if (!response.ok) {
  throw new Error(`[rift-model461-depth-rays] Failed to load stable 4.5.1: HTTP ${response.status}`);
}

let source = await response.text();

function replaceOnce(text, from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`[rift-model461-depth-rays] Expected one ${label}, found ${count}`);
  }
  return text.replace(from, to);
}

// Keep all relative runtime URLs anchored to this branch rather than the Blob.
source = replaceOnce(
  source,
  "const moduleUrl = import.meta.url;",
  `const moduleUrl = ${JSON.stringify(moduleUrl)};`,
  "module URL anchor",
);

const injectionAnchor =
  '  "Model 4.5.1 godray debug marker",\\n);\\n\\n${sourceMapMarker}';

const depthPatch = `  "Model 4.5.1 godray debug marker",\n);\n\n// Model 4.6.1: replace cloud-only visibility with cloud + scene-depth visibility.\n// All samples are unconditional and the mask never samples scenePassColor.\nsource = replaceFirst(\n  source,\n  \`const riftCloudShaftSamples = isTouchDevice ? 4 : 6;\\nconst riftCloudShaftMask = Fn(([sampleUV]) => {\\n  const localAlpha = texture(riftGodrayCloudMask, sampleUV).a;\\n  const localClear = float(1).sub(smoothstep(float(0.10), float(0.82), localAlpha));\\n  const toSun = lensSunScreenPos.sub(sampleUV);\\n  const rayLength = toSun.length();\\n  const pathClear = float(0).toVar();\\n\\n  If(riftGodrayStrength.greaterThan(float(0.005)), () => {\\n    Loop(riftCloudShaftSamples, ({ i }) => {\\n      const tap = float(i).add(float(1)).div(float(riftCloudShaftSamples + 1));\\n      const tapUV = clamp(sampleUV.add(toSun.mul(tap.mul(float(0.90)))), float(0), float(1));\\n      const tapAlpha = texture(riftGodrayCloudMask, tapUV).a;\\n      pathClear.addAssign(\\n        float(1).sub(smoothstep(float(0.08), float(0.88), tapAlpha))\\n      );\\n    });\\n  });\\n\\n  const pathTransmission = pathClear.div(float(riftCloudShaftSamples));\\n  const mixedPath = smoothstep(float(0.06), float(0.48), pathTransmission)\\n    .mul(float(1).sub(smoothstep(float(0.62), float(0.98), pathTransmission)));\\n  const sunReach = float(1).sub(smoothstep(float(0.14), float(1.08), rayLength));\\n  return localClear\\n    .mul(float(0.08).add(mixedPath.mul(float(0.92))))\\n    .mul(float(0.34).add(sunReach.mul(float(0.66))));\\n});\`,\n  \`const riftCloudShaftSamples = isTouchDevice ? 5 : 8;\\nconst riftCloudShaftMask = Fn(([sampleUV]) => {\\n  const localAlpha = texture(riftGodrayCloudMask, sampleUV).a;\\n  const localCloudClear = float(1).sub(smoothstep(float(0.10), float(0.82), localAlpha));\\n  const toSun = lensSunScreenPos.sub(sampleUV);\\n  const rayLength = toSun.length();\\n  const pathVisibility = float(0).toVar();\\n\\n  Loop(riftCloudShaftSamples, ({ i }) => {\\n    const tap = float(i).add(float(1)).div(float(riftCloudShaftSamples + 1));\\n    const sunBiasedTap = tap.pow(float(1.35));\\n    const tapUV = clamp(\\n      sampleUV.add(toSun.mul(sunBiasedTap.mul(float(0.965)))),\\n      float(0),\\n      float(1)\\n    );\\n    const tapAlpha = texture(riftGodrayCloudMask, tapUV).a;\\n    const tapCloudClear = float(1).sub(smoothstep(float(0.08), float(0.88), tapAlpha));\\n    const tapDepth = riftSceneDepth.sample(tapUV).r;\\n    const tapSceneOpen = smoothstep(float(0.9984), float(0.99997), tapDepth);\\n    pathVisibility.addAssign(tapCloudClear.mul(tapSceneOpen));\\n  });\\n\\n  const pathTransmission = pathVisibility.div(float(riftCloudShaftSamples));\\n  const mixedPath = smoothstep(float(0.08), float(0.52), pathTransmission)\\n    .mul(float(1).sub(smoothstep(float(0.70), float(0.995), pathTransmission)));\\n  const sunReach = float(1).sub(smoothstep(float(0.13), float(1.10), rayLength));\\n  return localCloudClear\\n    .mul(float(0.045).add(mixedPath.mul(float(0.955))))\\n    .mul(float(0.48).add(sunReach.mul(float(0.52))));\\n});\`,\n  "Model 4.6.1 depth + cloud shaft mask",\n);\n\nsource = replaceExactly(\n  source,\n  \`    .mul(float(isTouchDevice ? 0.48 : 0.30));\`,\n  \`    .mul(float(isTouchDevice ? 0.62 : 0.30));\`,\n  "Model 4.6.1 depth/cloud ray energy",\n  2,\n);\n\nglobalThis.__riftGodraysModel461 = {\n  active: true,\n  version: "4.6.1-depth-cloud-radial-rays",\n  nativePassOnTouch: false,\n  samples: isTouchDevice ? 5 : 8,\n  readsSceneColorInMask: false,\n};\n\n\${sourceMapMarker}`;

source = replaceOnce(
  source,
  injectionAnchor,
  depthPatch,
  "4.5.1 nested patch insertion point",
);

source += "\n;globalThis.__riftModel461Runtime={active:true,version:'4.6.1',depthCloudRays:true,sceneColorFeedback:false,threeTarget:'0.185.1'};\n";
source += "\n//# sourceURL=rift/main_game_model461_depth_cloud_rays.runtime.js\n";

const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
