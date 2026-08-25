// Rift Lighting 2.0 experimental runtime wrapper.
//
// The known-good r185 main_game.js stays byte-for-byte untouched. This layer
// appends CSM/SSS/GTAO/SSGI edits to that proven wrapper, then executes it. If
// this experiment misbehaves we can switch the launcher back to main_game.js
// without disturbing the stable migration branch.

const stableWrapperUrl = new URL("./main_game.js", import.meta.url);
const moduleBaseUrl = new URL("./", import.meta.url);

const response = await fetch(stableWrapperUrl, { cache: "reload" });
if (!response.ok) {
  throw new Error(`[rift-lighting2] Failed to load stable r185 wrapper: HTTP ${response.status}`);
}
let source = await response.text();

const arrayMarker = "\n];\n\nconst injectedEditLines = extraEdits";
if (!source.includes(arrayMarker)) {
  throw new Error("[rift-lighting2] Stable wrapper edit array changed unexpectedly");
}

const lightingEdits = [
  [
    'import { createDayNightCycle, updateDayNightCycle, CYCLE_SECONDS } from "./dayNightCycle_celestial_physical_v8.js";',
    'import { createDayNightCycle, updateDayNightCycle, CYCLE_SECONDS } from "./dayNightCycle_celestial_physical_v12.js";',
    "Rift Lighting 2 official CSM celestial path",
  ],
  [
    'import { mrt, output, normalView, metalness, roughness, sample, packNormalToRGB, unpackRGBToNormal } from "three/tsl";\nimport { ssr } from "three/addons/tsl/display/SSRNode.js";',
    'import { mrt, output, normalView, diffuseColor, metalness, roughness, sample, packNormalToRGB, unpackRGBToNormal } from "three/tsl";\nimport { ssr } from "three/addons/tsl/display/SSRNode.js";\nimport { sss } from "three/addons/tsl/display/SSSNode.js";\nimport { ao } from "three/addons/tsl/display/GTAONode.js";\nimport { ssgi } from "three/addons/tsl/display/SSGINode.js";',
    "Rift Lighting 2 SSS GTAO SSGI imports",
  ],
  [
    `const riftSSREnabled = riftWaterProfile === "desktop" && riftSSRQualityTier !== "low" && getEffectiveValue("reflectionEnabled") !== false;\nlet riftSSRPass = null;`,
    `const riftSSREnabled = riftWaterProfile === "desktop" && riftSSRQualityTier !== "low" && getEffectiveValue("reflectionEnabled") !== false;\nconst riftLighting2Tier = getGraphicsTier();\nconst riftLighting2Params = new URLSearchParams(location.search);\nconst riftLighting2ForceSSGI = riftLighting2Params.get("ssgi") === "1";\nconst riftLighting2SSSEnabled = riftLighting2Params.get("noSSS") !== "1";\nconst riftLighting2GTAOEnabled = riftLighting2Params.get("noGTAO") !== "1";\nconst riftLighting2SSGISupported = typeof renderer.hasFeature === "function" ? renderer.hasFeature("rg11b10ufloat-renderable") : false;\nconst riftLighting2SSGIEnabled = riftLighting2Params.get("noSSGI") !== "1" && riftLighting2SSGISupported && (riftLighting2Tier !== "low" || riftLighting2ForceSSGI);\nconst riftLighting2NeedsMRT = riftLighting2GTAOEnabled || riftLighting2SSGIEnabled || riftSSREnabled;\nconst riftLighting2SurfaceWeight = uniform(1);\nlet riftSSRPass = null;`,
    "Rift Lighting 2 feature policy",
  ],
  [
    `if (riftSSREnabled) {\n  scenePass.setMRT(mrt({\n    output: output,\n    normal: packNormalToRGB(normalView),\n    metalrough: vec2(metalness, roughness),\n  }));\n}`,
    `if (riftLighting2NeedsMRT) {\n  const riftMRT = {\n    output: output,\n    normal: packNormalToRGB(normalView),\n    diffuse: diffuseColor,\n  };\n  if (riftSSREnabled) riftMRT.metalrough = vec2(metalness, roughness);\n  scenePass.setMRT(mrt(riftMRT));\n}`,
    "Rift Lighting 2 MRT normals and diffuse",
  ],
  [
    `const lensTimeUniform = uniform(0);`,
    `const riftLighting2Depth = scenePass.getTextureNode("depth");\nlet riftLighting2Normal = null;\nlet riftLighting2Diffuse = null;\nif (riftLighting2NeedsMRT) {\n  const packedNormal = scenePass.getTextureNode("normal");\n  const normalTexture = scenePass.getTexture("normal");\n  normalTexture.type = THREE.UnsignedByteType;\n  riftLighting2Normal = sample((uvNode) => unpackRGBToNormal(packedNormal.sample(uvNode)));\n  riftLighting2Diffuse = scenePass.getTextureNode("diffuse");\n  const diffuseTexture = scenePass.getTexture("diffuse");\n  diffuseTexture.type = THREE.UnsignedByteType;\n}\n\nlet riftLighting2SSS = null;\nif (riftLighting2SSSEnabled) {\n  riftLighting2SSS = sss(riftLighting2Depth, camera, sun);\n  riftLighting2SSS.useTemporalFiltering = false;\n  riftLighting2SSS.resolutionScale = riftLighting2Tier === "low" ? 0.50 : (riftLighting2Tier === "medium" ? 0.66 : 0.82);\n  riftLighting2SSS.maxDistance.value = riftLighting2Tier === "low" ? 0.55 : (riftLighting2Tier === "medium" ? 0.72 : 0.90);\n  riftLighting2SSS.thickness.value = riftLighting2Tier === "low" ? 0.035 : 0.028;\n  riftLighting2SSS.shadowIntensity.value = riftLighting2Tier === "low" ? 0.48 : 0.58;\n  riftLighting2SSS.quality.value = riftLighting2Tier === "low" ? 0.18 : (riftLighting2Tier === "medium" ? 0.28 : 0.40);\n}\n\nlet riftLighting2GTAO = null;\nif (riftLighting2GTAOEnabled) {\n  riftLighting2GTAO = ao(riftLighting2Depth, riftLighting2Normal, camera);\n  riftLighting2GTAO.useTemporalFiltering = false;\n  riftLighting2GTAO.resolutionScale = riftLighting2Tier === "low" ? 0.50 : (riftLighting2Tier === "medium" ? 0.66 : 0.80);\n  riftLighting2GTAO.samples.value = riftLighting2Tier === "low" ? 6 : (riftLighting2Tier === "medium" ? 10 : 16);\n  riftLighting2GTAO.radius.value = riftLighting2Tier === "low" ? 0.42 : (riftLighting2Tier === "medium" ? 0.55 : 0.70);\n  riftLighting2GTAO.thickness.value = riftLighting2Tier === "low" ? 0.75 : 0.90;\n  riftLighting2GTAO.distanceExponent.value = 1.55;\n  riftLighting2GTAO.distanceFallOff.value = 0.82;\n  riftLighting2GTAO.scale.value = riftLighting2Tier === "low" ? 0.78 : 0.90;\n}\n\nlet riftLighting2SSGI = null;\nif (riftLighting2SSGIEnabled && riftLighting2Normal && riftLighting2Diffuse) {\n  riftLighting2SSGI = ssgi(scenePassColor, riftLighting2Depth, riftLighting2Normal, camera);\n  // No global TRAA is installed in Rift yet, so keep SSGI spatial and conservative.\n  riftLighting2SSGI.useTemporalFiltering = false;\n  riftLighting2SSGI.sliceCount.value = riftLighting2Tier === "high" ? 2 : 1;\n  riftLighting2SSGI.stepCount.value = riftLighting2Tier === "high" ? 8 : 6;\n  riftLighting2SSGI.radius.value = riftLighting2Tier === "high" ? 10 : 7;\n  riftLighting2SSGI.expFactor.value = 2.0;\n  riftLighting2SSGI.thickness.value = 0.75;\n  riftLighting2SSGI.aoIntensity.value = riftLighting2Tier === "high" ? 0.92 : 0.72;\n  riftLighting2SSGI.giIntensity.value = riftLighting2Tier === "high" ? 6.0 : 3.8;\n  riftLighting2SSGI.backfaceLighting.value = 0.08;\n}\n\nglobalThis.__riftLighting2Post = {\n  active: true,\n  tier: riftLighting2Tier,\n  sss: !!riftLighting2SSS,\n  gtao: !!riftLighting2GTAO,\n  ssgi: !!riftLighting2SSGI,\n  ssgiSupported: riftLighting2SSGISupported,\n  forceSSGI: riftLighting2ForceSSGI,\n};\n\nconst lensTimeUniform = uniform(0);`,
    "Rift Lighting 2 post nodes",
  ],
  [
    `const riftBasePostOutput = (getGraphicsSettings().lensEffectEnabled !== false) ? lensDistortedOutput : scenePassColor;\n// r183+ SSRNode returns premultiplied reflection color. Add RGB to the beauty\n// pass instead of using the old blendColor() path.\npostProcessing.outputNode = (riftSSREnabled && riftSSRPass) ? riftBasePostOutput.add(riftSSRPass.rgb) : riftBasePostOutput;`,
    `let riftLighting2Output = (getGraphicsSettings().lensEffectEnabled !== false) ? lensDistortedOutput : scenePassColor;\n\nif (riftLighting2GTAO) {\n  const gtaoValue = riftLighting2GTAO.getTextureNode().r;\n  const gtaoStrength = riftLighting2Tier === "low" ? 0.46 : 0.56;\n  const gtaoFactor = mix(float(1), gtaoValue, float(gtaoStrength).mul(riftLighting2SurfaceWeight));\n  riftLighting2Output = vec4(riftLighting2Output.rgb.mul(gtaoFactor), riftLighting2Output.a);\n}\n\nif (riftLighting2SSS) {\n  const sssValue = riftLighting2SSS.getTextureNode().r;\n  const sssFactor = mix(float(1), sssValue, float(0.62).mul(riftLighting2SurfaceWeight));\n  riftLighting2Output = vec4(riftLighting2Output.rgb.mul(sssFactor), riftLighting2Output.a);\n}\n\nif (riftLighting2SSGI) {\n  const ssgiAO = riftLighting2SSGI.getAONode().r;\n  const ssgiGI = riftLighting2SSGI.getGINode().rgb;\n  const giWeight = float(riftLighting2Tier === "high" ? 0.34 : 0.22).mul(riftLighting2SurfaceWeight);\n  const aoWeight = float(riftLighting2Tier === "high" ? 0.36 : 0.26).mul(riftLighting2SurfaceWeight);\n  const ssgiAOFactor = mix(float(1), ssgiAO, aoWeight);\n  const bounced = riftLighting2Diffuse.rgb.mul(ssgiGI).mul(giWeight);\n  riftLighting2Output = vec4(riftLighting2Output.rgb.mul(ssgiAOFactor).add(bounced), riftLighting2Output.a);\n}\n\n// r183+ SSRNode returns premultiplied reflection color. Add RGB after the\n// diffuse/contact/GI lighting composite so water reflections remain energetic.\nif (riftSSREnabled && riftSSRPass) riftLighting2Output = riftLighting2Output.add(riftSSRPass.rgb);\npostProcessing.outputNode = riftLighting2Output;`,
    "Rift Lighting 2 composite",
  ],
  [
    `const isFullySubmerged = submergedState;\n  if (riftSSRPass) riftSSRPass.intensity.value = isFullySubmerged ? 0 : riftSSRBaseIntensity;`,
    `const isFullySubmerged = submergedState;\n  riftLighting2SurfaceWeight.value = isFullySubmerged ? 0 : 1;\n  if (riftSSRPass) riftSSRPass.intensity.value = isFullySubmerged ? 0 : riftSSRBaseIntensity;`,
    "disable surface screen-space lighting underwater",
  ],
];

const injected = lightingEdits
  .map(([from, to, label]) => `  [${JSON.stringify(from)}, ${JSON.stringify(to)}, ${JSON.stringify(label)}],`)
  .join("\n");

source = source.replace(
  arrayMarker,
  `\n${injected}\n];\n\nconst injectedEditLines = extraEdits`,
);

// The stable wrapper normally resolves these from its own import.meta.url. Since
// it is being executed from a Blob here, pin only the two live URL definitions to
// the real Rift directory while leaving its validation string literals unchanged.
const urlBootstrap = `const tunedLoaderUrl = new URL(\n  "./main_game_underwater_base.js",\n  import.meta.url,\n);\nconst moduleBaseUrl = new URL("./", import.meta.url);`;
const resolvedBootstrap = `const tunedLoaderUrl = new URL(${JSON.stringify(new URL("./main_game_underwater_base.js", moduleBaseUrl).href)});\nconst moduleBaseUrl = new URL(${JSON.stringify(moduleBaseUrl.href)});`;
if (!source.includes(urlBootstrap)) {
  throw new Error("[rift-lighting2] Stable wrapper URL bootstrap changed unexpectedly");
}
source = source.replace(urlBootstrap, resolvedBootstrap);
source += "\n//# sourceURL=rift/main_game_lighting2.wrapper.js\n";

const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
