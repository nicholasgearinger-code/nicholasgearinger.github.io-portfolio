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

  // Mobile sprite rays are screen-facing additive billboards; WebGPU can
  // composite them over foreground palm fronds and sand, bleaching pixels
  // white rather than producing real occluded light shafts. Keep the sun
  // disk, normal sunlight and underwater caustics; omit only these
  // above-water decorative beams on touch devices.
  if (isTouchDevice) riftRayStrength = 0;
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
  // This is the actual instanced GLTF palm placement loop (separate from
  // procedural filler trees); previously it could spawn enormous fronds
  // directly in front of the player at the fixed world-origin spawn.
  [
    "        const z = Math.sin(angle) * dist;\n        // reject candidates too close to an already-placed tree",
    `        const z = Math.sin(angle) * dist;
        if (Math.hypot(x, z) < 34) continue; // clear camera + palm canopy at origin
        // reject candidates too close to an already-placed tree`,
    "Keep GLTF palm canopies clear of Coral Shallows player spawn",
  ],
  // Startup-safe iOS path: the Experimental depth compositor is unverified
  // on mobile and uses the live scene depth buffer. Disable by default on
  // touch devices, but allow explicit ?riftDepth=on comparison.
  [
    '    return localStorage.getItem("riftWaterGraphicsMode") === "experimental" &&\n      debug !== "noexp" && debug !== "nodepth";',
    `    const mobileDepthOptIn = !isTouchDevice ||
      new URLSearchParams(location.search).get("riftDepth") === "on";
    return mobileDepthOptIn &&
      localStorage.getItem("riftWaterGraphicsMode") === "experimental" &&
      debug !== "noexp" && debug !== "nodepth";`,
    "Mobile-safe experimental scene-depth compositor default",
  ],
  // Lens diagnostic text was enabled unconditionally over the horizon.
  // Keep its underlying state, show text only in explicit ?riftDebug=lens.
  [
    'lensDiagEl.style.cssText = "position:fixed;top:56px;left:8px;z-index:9999;font:11px/1.4 monospace;color:#ffb37f;background:rgba(0,0,0,0.55);padding:3px 7px;border-radius:4px;pointer-events:none;";',
    `lensDiagEl.style.cssText = "position:fixed;top:56px;left:8px;z-index:9999;font:11px/1.4 monospace;color:#ffb37f;background:rgba(0,0,0,0.55);padding:3px 7px;border-radius:4px;pointer-events:none;display:" + (new URLSearchParams(location.search).get("riftDebug")==="lens" ? "block" : "none") + ";";`,
    "Hide lens developer diagnostics in normal gameplay",
  ],
  // Startup visibility: keep palm trunks and broad fronds outside the
  // immediate Coral Shallows spawn view, not merely 8 world units away.
  [
    "if (Math.hypot(x - layout.spawn.x, z - layout.spawn.z) < 8) continue;",
    `if (Math.hypot(x - layout.spawn.x, z - layout.spawn.z) <
        (level.biome === "crystal" ? 28 : 8)) continue;`,
    "Coral Shallows expanded tree-free spawn clearing",
  ],
  [
    "  spawnPosition = { x: layout.spawn.x, y: spawnGroundY + PLAYER_EYE_HEIGHT + 2, z: layout.spawn.z };\n  camera.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);\n  faceAwayFromLandmark(spawnPosition.x, spawnPosition.z);\n  playerPhysics.verticalVelocity = 0;",
    `  spawnPosition = { x: layout.spawn.x, y: spawnGroundY + PLAYER_EYE_HEIGHT + 2, z: layout.spawn.z };
  camera.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
  faceAwayFromLandmark(spawnPosition.x, spawnPosition.z);
  if (level.biome === "crystal") {
    // Start with a slightly downward, stable eye-level view instead of
    // looking through the nearest canopy or into the high sky.
    camera.rotation.x = -0.09;
    camera.rotation.z = 0;
  }
  playerPhysics.verticalVelocity = 0;`,
    "Coral Shallows stable initial camera pitch",
  ],
  // Diagnostic only: isolate cloud cost without changing saved quality settings.
  // ?riftPerfClouds=off keeps the rest of the scene and FFT identical.
  [
    "const VOLUMETRIC_CLOUDS_ENABLED = getGraphicsSettings().volumetricCloudsEnabled !== false;",
    `const VOLUMETRIC_CLOUDS_ENABLED =
  getGraphicsSettings().volumetricCloudsEnabled !== false &&
  new URLSearchParams(location.search).get("riftPerfClouds") !== "off";`,
    "Phase A A/B cloud GPU cost isolation",
  ],
  // Mobile GPU fill-rate: disable the multi-sampled WebGPU framebuffer.
  // Query ?riftMSAA=on restores the previous renderer for visual comparison.
  [
    "const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });",
    `const riftMobileMSAA = !isTouchDevice || new URLSearchParams(location.search).get("riftMSAA") === "on";
const renderer = new THREE.WebGPURenderer({ canvas, antialias: riftMobileMSAA });
globalThis.__riftMobileMSAA = riftMobileMSAA;`,
    "Phase A mobile MSAA fill-rate reduction",
  ],

  // Phase A safety: no adaptive renderer resize on WebGPU. The existing
  // runtime bootstrap adjusts water detail without touching swapchain textures.
  ["      const worldXZ = positionWorld.xz.mul(0.15);","      // Shared broad-wave warp for both existing caustic layers. Wave-phase\n      // drift moves their focus lines with the swell without extra samples.\n      const broadWaveWarp = vec2(\n        sin(positionWorld.z.mul(0.11).add(t.mul(0.31))),\n        cos(positionWorld.x.mul(0.097).sub(t.mul(0.27)))\n      ).mul(0.16);\n      const worldXZ = positionWorld.xz.mul(0.15).add(broadWaveWarp);","wave-coupled seabed caustic domain"],
  ["      const netPrimary = clamp(tslMin(s1, s2).mul(1.7).sub(0.55), 0, 1);","      const netPrimary = clamp(tslMin(s1, s2).mul(1.95).sub(0.67), 0, 1);","sharper surface-linked primary caustics"],
  ["      const netSecondary = clamp(tslMin(s3, s4).mul(1.6).sub(0.5), 0, 1);","      const netSecondary = clamp(tslMin(s3, s4).mul(1.8).sub(0.60), 0, 1);","sharper surface-linked secondary caustics"],
  ["      const focusMask = float(0.15).add(focusZone.mul(0.85));","      // Shallow tropical caustics remain faint offshore but gain a wider,\n      // more natural pool of light near the swimmer and sun focus. This\n      // reuses the same procedural caustic samples without extra passes.\n      const focusMask = float(0.24).add(focusZone.mul(0.76));","soften distant underwater caustic falloff"],
  ["      return color(0xfff8e0).mul(finalCaustic).mul(0.55);","      return color(0xe8fff5).mul(finalCaustic).mul(0.52);","soft cyan-white seabed caustics"],
  ["  dayNightCycle.sun.intensity *= Math.max(0.3, stormSunDim);","  dayNightCycle.sun.intensity *= Math.max(0.3, stormSunDim);\n  // Low iPhone uses unshadowed direct sunlight. Limit the resulting peak\n  // on bright textured sand/palm leaf materials to avoid hard white clipping,\n  // without affecting sun direction, cloud drift or the water optics.\n  if (isTouchDevice && getGraphicsTier() === \"low\") {\n    dayNightCycle.sun.intensity = Math.min(dayNightCycle.sun.intensity, 2.4);\n  }","cap unshadowed mobile Low sun intensity"],
  ["let elapsedTime = 0;","let elapsedTime = 0;\nlet riftSmoothedCloudSun = 1;","mobile atmospheric sunlight smoothing state"],
  ["    dayNightCycle.sun.intensity *= Math.max(0.35, sunOcclusion);","    // Mobile atmospheric shafts: modulate real directional sunlight smoothly\n    // rather than drawing additive billboards across palms and sand.\n    if (isTouchDevice) {\n      const targetSun = Math.max(0.50, sunOcclusion);\n      riftSmoothedCloudSun = THREE.MathUtils.damp(riftSmoothedCloudSun, targetSun, 2.2, dt);\n      dayNightCycle.sun.intensity *= riftSmoothedCloudSun;\n    } else {\n      dayNightCycle.sun.intensity *= Math.max(0.35, sunOcclusion);\n    }","mobile atmosphere without bleaching sun-ray sprites"],
  ["        const dist = rng() * (WORLD_BOUND_RADIUS - 8);", "        // Prefer near-shore reef pockets, while retaining an outer scatter\n        // and the existing instance count (no additional draw calls).\n        const reefPocket = rng() < 0.65;\n        const dist = reefPocket\n          ? (18 + Math.pow(rng(), 0.7) * 62)\n          : rng() * (WORLD_BOUND_RADIUS - 8);", "concentrate existing coral into shallow reef pockets"],
  ["  resetOverrides();\n  applyGraphicsSettings();\n  syncGraphicsUI();\n}", "  resetOverrides();\n  applyGraphicsSettings();\n  syncGraphicsUI();\n  // WebGPU buffers, shadow resources and compute encoders cannot safely\n  // change tier in place on iOS. Start a clean GPU device with the saved\n  // tier instead of leaving the previous quality running behind the UI.\n  if (/iPhone|iPad|iPod/i.test(navigator.userAgent || \"\")) {\n    window.location.reload();\n  }\n}", "reload WebGPU device after mobile tier switch"],
  ["  for (const fish of realFish) {\n    fish.mixer.update(dt);","  // Mobile Medium: update visibility less often than rendering. Distant\n  // animated wildlife contributes no visible detail but still costs CPU,\n  // skinning and draw calls. Do not alter instanced coral/tree batches here:\n  // changing visibility on an InstancedMesh hides every instance at once.\n  const mobileDistanceBudget = /iPhone|iPad|iPod/i.test(navigator.userAgent || \"\") && getGraphicsTier() === \"medium\";\n  if (mobileDistanceBudget && (Math.floor(elapsedTime * 4) !== Math.floor((elapsedTime - dt) * 4))) {\n    const cx = camera.position.x, cz = camera.position.z;\n    const fishVisibilitySq = 72 * 72;\n    const reefVisibilitySq = 105 * 105;\n    for (const fish of realFish) {\n      const dx = fish.wanderCenterX - cx, dz = fish.wanderCenterZ - cz;\n      fish.group.visible = dx * dx + dz * dz < fishVisibilitySq;\n    }\n    for (const school of realFishSchools) {\n      const dx = school.wanderCenterX - cx, dz = school.wanderCenterZ - cz;\n      school.group.visible = dx * dx + dz * dz < fishVisibilitySq;\n    }\n    for (const reef of realReefStructures) {\n      const dx = reef.position.x - cx, dz = reef.position.z - cz;\n      reef.visible = dx * dx + dz * dz < reefVisibilitySq;\n      // Keep the reef visible at medium distance but cast shadows only nearby.\n      reef.traverse(node => { if (node.isMesh) node.castShadow = reef.visible && dx * dx + dz * dz < 38 * 38; });\n    }\n  }\n  for (const fish of realFish) {\n    if (mobileDistanceBudget && !fish.group.visible) continue;\n    fish.mixer.update(dt);","iOS Medium distance-based animated wildlife and reef culling"],
  ["  for (const school of realFishSchools) {\n    school.mixer.update(dt);", "  for (const school of realFishSchools) {\n    if (mobileDistanceBudget && !school.group.visible) continue;\n    school.mixer.update(dt);", "iOS Medium skip invisible fish-school animation"],
  ["window.addEventListener(\"error\", (e) => showError(\"Uncaught error:\", e.error || e.message));", "window.addEventListener(\"error\", (e) => {\n    const message = String(e.message || \"\");\n    // Safari reports unrelated cross-origin failures simply as \"Script error.\"\n    // That opaque event has no stack, filename or usable diagnosis; it must\n    // not cover a functioning level menu with a false fatal overlay.\n    if (!e.error && (!message || message === \"Script error.\")) {\n      console.warn(\"[rift] Opaque browser script error (no actionable stack)\", e.filename || \"unknown source\");\n      return;\n    }\n    showError(\"Uncaught error:\", e.error || message);\n  });", "ignore opaque cross-origin browser errors in game overlay"],
  ["if (distFromCenter > WORLD_BOUND_RADIUS) {\n    const scale = WORLD_BOUND_RADIUS / distFromCenter;", "const activeWorldBound = currentLevelIdx >= 0 && LEVELS[currentLevelIdx].biome === \"crystal\" ? 205 : WORLD_BOUND_RADIUS;\n  if (distFromCenter > activeWorldBound) {\n    const scale = activeWorldBound / distFromCenter;", "Coral extended playable radius"],
  [
    'const reflectionEnabled = getGraphicsSettings().reflectionEnabled !== false;',
    'const reflectionEnabled = false; // WebGPU: legacy manual reflection/refraction renderer.render() passes invalidate command encoders; the r185 SSR pipeline remains available.',
    "disable legacy offscreen water passes on WebGPU",
  ],
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
// Scene-aware mobile reflections are a deliberately opt-in WebGPU trial.
// The earlier legacy mirror/refraction renderer.render() path caused encoder
// failures on iPhone; this uses the existing r185 scene pass SSR node instead.
// Enable: ?riftDebug=scenereflections  Disable: remove the parameter.
// Do not increase the default mobile GPU budget until on-device testing.
const riftMobileSSRTrial = (() => {
  try {
    return riftSSRIsMobile &&
      localStorage.getItem("riftWaterGraphicsMode") === "experimental" &&
      new URLSearchParams(location.search).get("riftDebug") === "scenereflections";
  } catch (_) { return false; }
})();
const riftSSREnabled = (
  (riftWaterProfile === "desktop" && riftSSRQualityTier !== "low" &&
    getEffectiveValue("reflectionEnabled") !== false) ||
  riftMobileSSRTrial
);
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
    // Conservative quarter-resolution SSR, short rays and minimal tracing
    // quality. Limited to above-water viewing by the existing submerged gate.
    riftSSRBaseIntensity = 0.20;
    riftSSRPass.resolutionScale = 0.25;
    riftSSRPass.quality.value = 0.10;
    riftSSRPass.blurQuality = 1;
    riftSSRPass.maxDistance.value = 0.22;
    riftSSRPass.intensity.value = riftSSRBaseIntensity;
    riftSSRPass.thickness.value = 0.032;
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
    `postProcessing.outputNode = oceanDepthPassEnabled
  ? underwaterDepthOutput
  : (lensOutputEnabled ? lensDistortedOutput : scenePass);`,
    `// Compose optional desktop SSR on top of the current scene output.
 // The Experimental underwater depth node is already part of this output;
 // do not replace it or recreate the old manual render-target path.
 const riftComposePostOutput = (base) => (riftSSREnabled && riftSSRPass)
   ? base.add(riftSSRPass.rgb) : base;
 const riftBasePostOutput = oceanDepthPassEnabled
   ? underwaterDepthOutput
   : (lensOutputEnabled ? lensDistortedOutput : underwaterCameraSceneOutput);
 postProcessing.outputNode = riftComposePostOutput(riftBasePostOutput);`,
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
// The final game is evaluated from a blob: URL, outside the /rift/ import-map
// scope registered by main.js. Resolve all Three.js bare imports to the SAME
// r185 release as Rift's WebGPU dependencies. Otherwise the blob silently
// falls back to index.html's global r182 mapping (two incompatible Three
// runtimes, especially problematic for RenderPipeline/TSL/WebGPU nodes).
// Rewrite only actual import declarations; never replace arbitrary strings.
const riftThreeBase = "https://cdn.jsdelivr.net/npm/three@0.185.1/";
const threeSpecifiers = {
  "three": riftThreeBase + "build/three.webgpu.js",
  "three/webgpu": riftThreeBase + "build/three.webgpu.js",
  "three/tsl": riftThreeBase + "build/three.tsl.js",
};
function resolveRiftThreeSpecifier(specifier) {
  if (threeSpecifiers[specifier]) return threeSpecifiers[specifier];
  if (specifier.startsWith("three/addons/")) {
    return riftThreeBase + "examples/jsm/" + specifier.slice("three/addons/".length);
  }
  return specifier;
}
source = source.replace(
  /(\bfrom\s*|\bimport\s*)(["'])(three(?:\/[^"']*)?)\2/g,
  (_, prefix, quote, specifier) =>
    prefix + quote + resolveRiftThreeSpecifier(specifier) + quote,
);

source += "\n//# sourceURL=rift/main_game_water_pro.loader.js\n";

const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
