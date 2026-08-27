// Rift Islands runtime loader — Model 4.6.4 safe cloud-gated sprite god rays.
// Keeps the proven Water Pro / r185 migration path, then re-enables the
// existing scene sprites as depth-tested crepuscular rays. No extra render
// targets, no depth-texture sampling, and no post-process god-ray pass.

const tunedLoaderUrl = new URL("./main_game_underwater_base.js", import.meta.url);
const moduleBaseUrl = new URL("./", import.meta.url);

const response = await fetch(tunedLoaderUrl, { cache: "reload" });
if (!response.ok) {
  throw new Error(`[rift-water-pro] Failed to load tuned runtime loader: HTTP ${response.status}`);
}

let source = await response.text();

const lines = source.split("\n");
const badEditLabel = '"seafloor caustic brightness"';
const matchingLines = lines.filter((line) => line.includes(badEditLabel));
if (matchingLines.length !== 1) {
  throw new Error(`[rift-water-pro] Expected exactly one caustic tuning entry, found ${matchingLines.length}`);
}
source = lines.filter((line) => !line.includes(badEditLabel)).join("\n");

const editsLoopMarker =
  '\n];\n\nfor (const [from, to, label] of edits) source = replaceExactlyOnce(source, from, to, label);';

if (!source.includes(editsLoopMarker)) {
  throw new Error("[rift-water-pro] Tuned loader edit loop changed unexpectedly");
}

const godRaySetup = `
const dayNightCycle = createDayNightCycle(scene, sun, ambientLight, starfieldPoints, undefined, moonLight);

// Model 4.6.4: safe scene-space crepuscular rays.
// Reuses the old sun-beam sprites instead of adding another WebGPU pass.
// Because these are ordinary transparent scene objects with depthTest=true,
// opaque foreground geometry naturally cuts them into visible shafts.
const riftGodRayWarm = new THREE.Color(0xffd8a0);
const riftGodRaySprites = (() => {
  const group = dayNightCycle?.sunBeams?.group;
  const sprites = dayNightCycle?.sunBeams?.sprites;
  if (!group || !Array.isArray(sprites) || sprites.length === 0) return [];

  const original = sprites.slice();
  const targetCount = isTouchDevice ? 6 : Math.max(10, sprites.length);

  while (sprites.length < targetCount) {
    const sourceSprite = original[sprites.length % original.length];
    const clone = sourceSprite.clone();
    clone.material = sourceSprite.material.clone();
    group.add(clone);
    sprites.push(clone);
  }

  const count = sprites.length;
  for (let i = 0; i < count; i++) {
    const sprite = sprites[i];

    // Existing sprites may share materials; give every ray independent opacity
    // and rotation so the fan can be shaped without cross-talk.
    if (original.includes(sprite)) sprite.material = sprite.material.clone();

    const material = sprite.material;
    material.transparent = true;
    material.depthTest = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.fog = true;
    material.toneMapped = false;
    material.opacity = 0;

    // Fan primarily below/around the low Sun instead of a full 360-degree star.
    const u = count <= 1 ? 0.5 : i / (count - 1);
    const fanAngle = THREE.MathUtils.lerp(-1.02, 1.02, u);
    const jitter = Math.sin((i + 1) * 12.9898) * 0.085;
    material.rotation = fanAngle + jitter;

    sprite.center.set(0.5, 1.0);
    const length = (isTouchDevice ? 310 : 345) + (i % 4) * 24;
    const widthRatio = 0.105 + (i % 3) * 0.024;
    sprite.scale.set(length * widthRatio, length, 1);
    sprite.renderOrder = -90;
  }

  return sprites;
})();
`;

const godRayUpdate = `
{
  const riftRayDay = THREE.MathUtils.clamp(Number(dayNight.dayAmount) || 0, 0, 1);
  const riftRayRise = THREE.MathUtils.smoothstep(riftRayDay, 0.015, 0.10);
  const riftRayNoonFade = 1 - THREE.MathUtils.smoothstep(riftRayDay, 0.48, 0.88);
  const riftRayAltitude = riftRayRise * riftRayNoonFade;

  const riftShadowT = Number(globalThis.__riftCloudShadowState?.averageTransmittance);
  const riftOcclusion = THREE.MathUtils.clamp(
    Number(globalThis.__riftProceduralCloudOcclusion) || 0,
    0,
    1,
  );
  const riftCloudTransmission = Number.isFinite(riftShadowT)
    ? THREE.MathUtils.clamp(riftShadowT, 0, 1)
    : 1 - riftOcclusion;

  const riftLightingPreview = globalThis.__riftCloudSafeLightingPreview?.enabled === true;
  const riftPreviewSunOcc = THREE.MathUtils.clamp(
    Number(globalThis.__riftCloudSafeLightingPreview?.visualSunOcclusion ?? riftOcclusion) || 0,
    0,
    1,
  );

  let riftRayStrength = 0;
  let riftGapGate = 0;

  if (riftLightingPreview) {
    // Preview v2: real crepuscular-ray gating. Clear sky has no cloud edge to
    // sculpt a shaft, and fully opaque cloud has no direct solar opening. Rays
    // peak in the physically interesting middle state: broken/partial cloud with
    // some direct Sun still escaping through/around the local cloud column.
    const riftCloudPresence = THREE.MathUtils.clamp(1 - riftCloudTransmission, 0, 1);
    const riftCloudOpening = THREE.MathUtils.clamp(riftCloudTransmission, 0, 1);
    const riftPresenceGate = THREE.MathUtils.smoothstep(riftCloudPresence, 0.06, 0.26);
    const riftOpeningGate = THREE.MathUtils.smoothstep(riftCloudOpening, 0.06, 0.30);
    const riftBrokenWindow = riftPresenceGate * riftOpeningGate;
    const riftLocalPartial = THREE.MathUtils.clamp(
      4 * riftPreviewSunOcc * (1 - riftPreviewSunOcc),
      0,
      1,
    );
    const riftDirectOpening = 1 - riftPreviewSunOcc;

    riftGapGate = THREE.MathUtils.clamp(
      (riftLocalPartial * 0.78 + riftBrokenWindow * 0.62) * riftDirectOpening,
      0,
      1,
    );

    riftRayStrength =
      riftRayAltitude *
      riftGapGate *
      (isTouchDevice ? 0.18 : 0.15);
  } else {
    // Preserve the known-good production behavior byte-for-byte when the preview
    // flag is absent.
    const riftPartialCloud = 1 - Math.min(
      1,
      Math.abs(riftCloudTransmission - 0.58) / 0.58,
    );
    const riftCloudSculpt = 0.58 + 0.42 * riftPartialCloud;
    const riftSourceVisibility = 0.28 + 0.72 * riftCloudTransmission;
    riftRayStrength =
      riftRayAltitude *
      riftCloudSculpt *
      riftSourceVisibility *
      (isTouchDevice ? 0.12 : 0.10);
  }

  const riftLowSunWarmth = 1 - THREE.MathUtils.smoothstep(riftRayDay, 0.30, 0.72);
  const riftTime = performance.now() * 0.001;

  for (let i = 0; i < riftGodRaySprites.length; i++) {
    const sprite = riftGodRaySprites[i];
    const material = sprite.material;
    const variation = 0.76 + (i % 4) * 0.095;
    const breathe = 0.94 + Math.sin(riftTime * 0.22 + i * 1.71) * 0.06;

    material.color.copy(sun.color).lerp(riftGodRayWarm, riftLowSunWarmth * 0.28);
    material.opacity = riftRayStrength * variation * breathe;
    sprite.visible = material.opacity > 0.0015;
  }

  globalThis.__riftGodRays463 = {
    active: riftRayStrength > 0.0015,
    mode: riftLightingPreview
      ? "cloud-gap-gated-depth-tested-sprites"
      : "depth-tested-scene-sprites",
    strength: riftRayStrength,
    cloudTransmittance: riftCloudTransmission,
    localSunOcclusion: riftPreviewSunOcc,
    gapGate: riftGapGate,
    lightingPreview: riftLightingPreview,
    count: riftGodRaySprites.length,
  };
}
`;

const extraEdits = [
  [
    'import { createVolumetricClouds, updateVolumetricClouds } from "./volumetricClouds.js";',
    'import { createVolumetricClouds, updateVolumetricClouds } from "./volumetricClouds_reference_v2.js";',
    "progressive low-resolution volumetric cloud renderer import",
  ],
  [
    'import { createDayNightCycle, updateDayNightCycle, CYCLE_SECONDS } from "./dayNightCycle.js";',
    'import { createDayNightCycle, updateDayNightCycle, CYCLE_SECONDS } from "./dayNightCycle_celestial_physical_v8.js";',
    "photographic sunrise sunset global solar lighting v8 import",
  ],
  [
    "sceneBackgroundColor.copy(dayNight.skyHorizon).lerp(dayNight.skyZenith, 0.5);",
    "sceneBackgroundColor.copy(dayNight.skyHorizon).lerp(dayNight.skyZenith, 0.5);\n    if (globalThis.__riftReferenceAtmosphere) renderer.toneMappingExposure = globalThis.__riftReferenceAtmosphere.exposure ?? 0.98;",
    "reference atmosphere dynamic exposure",
  ],
  [
    "tempWaterGlintDir.copy(moonLight.position).lerp(sun.position, dayNight.dayAmount);",
    'tempWaterGlintDir.copy(sun.intensity >= moonLight.intensity ? sun.position : moonLight.position).sub(camera.position).normalize();',
    "camera-relative celestial glint alignment",
  ],
  [
    'import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";',
    'import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";\nimport { mrt, output, normalView, metalness, roughness, sample, packNormalToRGB, unpackRGBToNormal } from "three/tsl";\nimport { ssr } from "three/addons/tsl/display/SSRNode.js";',
    "r185 Water Pro SSR imports",
  ],
  [
    `const postProcessing = new THREE.PostProcessing(renderer);
const scenePass = pass(scene, camera);
const scenePassColor = scenePass.getTextureNode("output");`,
    `const postProcessing = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);
const riftSSRTier = getGraphicsTier();
const riftWaterProfile = globalThis.__riftWaterTestMode === "desktop"
  ? "desktop"
  : globalThis.__riftWaterTestMode === "mobile"
    ? "mobile"
    : (isTouchDevice ? "mobile" : "desktop");
const riftSSRIsMobile = riftWaterProfile === "mobile";
const riftForcedDesktopWater = globalThis.__riftWaterTestForced === true && riftWaterProfile === "desktop";
const riftSSRQualityTier = riftForcedDesktopWater && riftSSRTier === "low" ? "medium" : riftSSRTier;
const riftSSREnabled = riftWaterProfile === "desktop" && riftSSRQualityTier !== "low" && getEffectiveValue("reflectionEnabled") !== false;
let riftSSRPass = null;
let riftSSRBaseIntensity = 0;
if (riftSSREnabled) {
  scenePass.setMRT(mrt({
    output: output,
    normal: packNormalToRGB(normalView),
    metalrough: vec2(metalness, roughness),
  }));
}
const scenePassColor = scenePass.getTextureNode("output");
if (riftSSREnabled) {
  const riftSceneNormalPacked = scenePass.getTextureNode("normal");
  const riftSceneDepth = scenePass.getTextureNode("depth");
  const riftSceneMetalRough = scenePass.getTextureNode("metalrough");
  const riftNormalTexture = scenePass.getTexture("normal");
  const riftMetalRoughTexture = scenePass.getTexture("metalrough");
  riftNormalTexture.type = THREE.UnsignedByteType;
  riftMetalRoughTexture.type = THREE.UnsignedByteType;
  const riftSceneNormal = sample((uvNode) => unpackRGBToNormal(riftSceneNormalPacked.sample(uvNode)));
  riftSSRPass = ssr(scenePassColor, riftSceneDepth, riftSceneNormal, {
    metalnessNode: riftSceneMetalRough.r,
    roughnessNode: riftSceneMetalRough.g,
  });
  if (riftSSRIsMobile) {
    riftSSRBaseIntensity = 0.30;
    riftSSRPass.resolutionScale = 0.30;
    riftSSRPass.quality.value = 0.14;
    riftSSRPass.blurQuality = 1;
    riftSSRPass.maxDistance.value = 0.30;
    riftSSRPass.intensity.value = riftSSRBaseIntensity;
    riftSSRPass.thickness.value = 0.036;
  } else {
    riftSSRBaseIntensity = riftSSRQualityTier === "high" ? 0.82 : 0.58;
    riftSSRPass.quality.value = riftSSRQualityTier === "high" ? 0.48 : 0.28;
    riftSSRPass.blurQuality = riftSSRQualityTier === "high" ? 2 : 1;
    riftSSRPass.maxDistance.value = riftSSRQualityTier === "high" ? 0.72 : 0.48;
    riftSSRPass.intensity.value = riftSSRBaseIntensity;
    riftSSRPass.thickness.value = riftSSRQualityTier === "high" ? 0.020 : 0.026;
  }
}`,
    "r185 Water Pro WebGPU SSR setup",
  ],
  [
    'postProcessing.outputNode = (getGraphicsSettings().lensEffectEnabled !== false) ? lensDistortedOutput : scenePass;',
    `const riftBasePostOutput = (getGraphicsSettings().lensEffectEnabled !== false) ? lensDistortedOutput : scenePassColor;
// r183+ SSRNode returns premultiplied reflection color. Add RGB to the beauty
// pass instead of using the old blendColor() path.
postProcessing.outputNode = (riftSSREnabled && riftSSRPass) ? riftBasePostOutput.add(riftSSRPass.rgb) : riftBasePostOutput;`,
    "r185 Water Pro additive SSR composition",
  ],
  [
    "const isFullySubmerged = submergedState;",
    `const isFullySubmerged = submergedState;
  if (riftSSRPass) riftSSRPass.intensity.value = isFullySubmerged ? 0 : riftSSRBaseIntensity;`,
    "disable SSR while submerged",
  ],
  [
    "const clock = new THREE.Clock();",
    `const clock = new THREE.Timer();
clock.connect(document);`,
    "r185 Timer migration",
  ],
  [
    `function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);`,
    `function animate(timestamp) {
  requestAnimationFrame(animate);
  clock.update(timestamp);
  const dt = Math.min(clock.getDelta(), 0.1);`,
    "r185 Timer frame update",
  ],
  [
    "const dayNightCycle = createDayNightCycle(scene, sun, ambientLight, starfieldPoints, undefined, moonLight);",
    godRaySetup.trim(),
    "Model 4.6.4 depth-tested sprite god-ray setup",
  ],
  [
    "for (const sprite of dayNightCycle.sunBeams.sprites) sprite.material.opacity = 0;",
    godRayUpdate.trim(),
    "Model 4.6.4 cloud-gated scene-space god rays",
  ],
];

const injectedEditLines = extraEdits
  .map(([from, to, label]) => `  [${JSON.stringify(from)}, ${JSON.stringify(to)}, ${JSON.stringify(label)}],`)
  .join("\n");

source = source.replace(
  editsLoopMarker,
  `\n${injectedEditLines}\n];\n\nfor (const [from, to, label] of edits) source = replaceExactlyOnce(source, from, to, label);`,
);

const loaderBaseLine =
  'const baseModuleUrl = new URL("./main_game_rain_base.js", import.meta.url);';
const loaderModuleLine =
  'const moduleBaseUrl = new URL("./", import.meta.url);';
const resolvedBaseLine =
  `const baseModuleUrl = new URL("./main_game_rain_base.js", ${JSON.stringify(moduleBaseUrl.href)});`;
const resolvedModuleLine =
  `const moduleBaseUrl = new URL("./", ${JSON.stringify(moduleBaseUrl.href)});`;

if (!source.includes(loaderBaseLine) || !source.includes(loaderModuleLine)) {
  throw new Error("[rift-water-pro] Tuned loader URL bootstrap changed unexpectedly");
}
source = source.replace(loaderBaseLine, resolvedBaseLine);
source = source.replace(loaderModuleLine, resolvedModuleLine);
source += "\n//# sourceURL=rift/main_game_water_pro.loader.js\n";

const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
