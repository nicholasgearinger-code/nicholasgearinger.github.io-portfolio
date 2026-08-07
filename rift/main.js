import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { buildPlanetTerrain, terrainHeightAt, TERRAIN_SIZE, LIQUID_LEVEL, WATERFALL_Z, RIVER_WIDTH, POND_Z, POND_RADIUS, POND_LEVEL, RAMP_CENTER_X, RAMP_CENTER_Z, RAMP_LENGTH, RAMP_HALF_WIDTH, ROOM_FLOOR_Y, ROOM_WIDTH, ROOM_LENGTH, BRANCH_START_X, BRANCH_LENGTH, BRANCH_HALF_WIDTH, BRANCH_Z, CHAMBER_RADIUS } from "./terrain.js";
import { LEVELS, generateLevelLayout } from "./levels.js";
import { createCrystalMesh, updateCrystalMesh, disposeCrystalMesh, CRYSTAL_RADIUS } from "./crystals.js";
import { createDecoration, updateDecoration, createEmberFire, createLivingTree, createLightShaft, createUnderwaterLightShaft, updateLightShafts, disposeLightShafts, createRockCluster, createCaveMouth, applyVerticalGradient } from "./decorations.js";
import { createLiquidPlane, updateLiquidPlane, disposeLiquidPlane, createWaterfall, updateWaterfall, disposeWaterfall, createRiverCurrent, updateRiverCurrent, disposeRiverCurrent, createRiverFlowStrip, updateRiverFlowStrip, disposeRiverFlowStrip, createCliffWall, disposeCliffWall, createSourcePond, updateSourcePond, disposeSourcePond, createOceanSurfaceDetail, updateOceanSurfaceDetail, disposeOceanSurfaceDetail } from "./liquid.js";
import { createDayNightCycle, updateDayNightCycle } from "./dayNightCycle.js";
import { createAtmosphericParticles, updateAtmosphericParticles, disposeAtmosphericParticles } from "./atmosphericParticles.js";
import { createGrass, updateGrass, disposeGrass, createFlowers, updateFlowers, disposeFlowers, createFootstepGlowSystem, spawnFootstepGlow, updateFootstepGlowSystem, disposeFootstepGlowSystem } from "./vegetation.js";
import { createHorizonSilhouettes, updateHorizonSilhouettes, disposeHorizonSilhouettes } from "./horizonSilhouettes.js";
import { createWildlife, updateWildlife, disposeWildlife } from "./wildlife.js";
import { createLandmark, updateLandmark, disposeLandmark, LANDMARK_POSITION } from "./landmarks.js";
import { getGraphicsSettings, getGraphicsTier, setGraphicsTier, listGraphicsTiers } from "./graphicsSettings.js";
import { loadPalmTreeModel, loadAngelfishModel, loadReefModel, loadCoralModel, createRealPalmTree, createRealAngelfish, createRealReef, createRealCoral } from "./models.js";
import { createWeatherSystem, updateWeatherSystem, disposeWeatherSystem } from "./weather.js";
import { createClouds, updateClouds, disposeClouds, getCloudOcclusionFactor, createCloudLayer, updateCloudLayer, disposeCloudLayer, createRealisticCloudDome, updateRealisticCloudDome, disposeRealisticCloudDome } from "./clouds.js";
import {
  createBolt, updateBolt, disposeBolt,
  createMuzzleFlash, updateMuzzleFlash, disposeMuzzleFlash,
  createImpactBurst, updateImpactBurst, disposeImpactBurst,
} from "./effects.js";
import { initAudio, toggleMuted, playShoot, playShatter, playLoreChime, startAmbient, playFootstep, setEruptionIntensity, playEruptionBurst, updateFirePosition, updateListenerPosition, setAmbientDayAmount } from "./audio.js";
import { getIslandLore } from "./lore.js";
import { findClosestHit } from "./hitPrediction.js";
import { createTouchControls } from "./touchControls.js";
import { createPlayerPhysicsState, updatePlayerPhysics, sampleGroundHeight, WALK_SPEED, AIR_CONTROL, SWIM_SPEED_MULTIPLIER } from "./physics.js";
import { mulberry32, hashStringToSeed } from "./worldgen.js";

// ---------------------------------------------------------------------------
// World seed — fixed by default so every visitor explores the same curated
// levels rather than different random layouts each load.
// ---------------------------------------------------------------------------
// Per-biome underwater ambience — DEFAULT reproduces the exact values
// every biome used before this table existed (a murky river read), so
// Verdant's underwater look is provably unchanged. Crystal gets its own
// entry: the shared default fog was heavy/dark enough to crush the whole
// Coral Shallows reef redesign's bright tropical tuning into near-total
// darkness regardless of how bright the terrain/water/coral colors
// themselves were set — a shallow sunlit reef needs to actually stay
// visible, not read like a deep murky river.
const UNDERWATER_STYLE = {
  default: {
    fogColor: 0x0a2838, fogDensity: 0.14, sunColor: 0x1a4560, sunMult: 0.08,
    ambientColor: 0x14384f, ambientMult: 0.22, tint: [0.08, 0.28, 0.45], tintStrength: 0.18, causticStrength: 0, distortAmp: 0.01, volumeColor: 0x1a5a7a,
  },
  crystal: {
    fogColor: 0x2fa8b8, fogDensity: 0.028, sunColor: 0x8fe0e6, sunMult: 0.55,
    // causticStrength stays 0 — a screen-space full-screen overlay paints
    // every pixel identically regardless of view direction, so it
    // necessarily looked like "light everywhere" rather than concentrated
    // on the seafloor, per explicit follow-up. Real caustics-on-sand now
    // come from the terrain material's own onBeforeCompile shader
    // (terrainMat, set up in loadLevel below) — genuinely anchored to the
    // actual floor geometry, gated to submerged/upward-facing surfaces
    // only. The water surface's own ripple shading (liquid.js, anchored
    // to the real mesh at y=8) is the other correct view-dependent tool
    // for this; both stay untouched by this constant.
    ambientColor: 0x6fd8dc, ambientMult: 0.85, tint: [0.35, 0.78, 0.8], tintStrength: 0.1, causticStrength: 0, distortAmp: 0.005, volumeColor: 0x5fd0d8,
  },
};

const WORLD_SEED = "rift-islands-prime";
const PLAYER_EYE_HEIGHT = 1.6;
// Player can't walk past this radius from the terrain's center — keeps
// them off the soft falloff rim (see terrain.js) and away from the finite
// plane's actual edge, where there'd be no ground to sample at all.
const WORLD_BOUND_RADIUS = TERRAIN_SIZE / 2 * 0.93;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const canvas = document.getElementById("rift-scene");
const startOverlay = document.getElementById("rift-start-overlay");
const levelSelectEl = document.getElementById("rift-level-select");
const seedValueEl = document.getElementById("rift-seed-value");
const levelNameEl = document.getElementById("rift-level-name");
const resonanceValueEl = document.getElementById("rift-resonance-value");
const resonanceDot = document.getElementById("rift-resonance-dot");
const loreTicker = document.getElementById("rift-lore-ticker");
const discoveryLogEl = document.getElementById("rift-discovery-log");
const menuBtn = document.getElementById("rift-menu-btn");
const titleGate = document.getElementById("rift-title-gate");
const titlePlayBtn = document.getElementById("rift-title-play-btn");

// ---------------------------------------------------------------------------
// Input mode detection
// ---------------------------------------------------------------------------
const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
if (isTouchDevice) document.body.classList.add("rift-touch-mode");
let touchGameActive = false;

function isGameActive() {
  return isTouchDevice ? touchGameActive : controls.isLocked;
}

// ---------------------------------------------------------------------------
// Three.js scene — sized off #rift-viewport, see earlier notes in this file
// history; unchanged from the island-chain version.
// ---------------------------------------------------------------------------
const viewport = document.getElementById("rift-viewport");
const fullscreenBtn = document.getElementById("rift-fullscreen-btn");
const graphicsBtn = document.getElementById("rift-graphics-btn");
const graphicsPanel = document.getElementById("rift-graphics-panel");
const arrivalOverlay = document.getElementById("rift-arrival");
const arrivalNameEl = document.getElementById("rift-arrival-name");

// A real, live FPS counter — plain DOM overlay rather than rendering
// text into the 3D scene (far cheaper, and easier to read while judging
// exactly the kind of performance issue this exists to measure).
// Updated a few times a second, not every single frame — updating DOM
// text every frame would itself add overhead and the number would be
// too jittery to read anyway.
const fpsCounterEl = document.createElement("div");
fpsCounterEl.style.cssText = "position:fixed;top:8px;left:8px;z-index:9999;font:12px/1.4 monospace;color:#7fffa0;background:rgba(0,0,0,0.55);padding:3px 7px;border-radius:4px;pointer-events:none;";
fpsCounterEl.textContent = "-- fps";
viewport.appendChild(fpsCounterEl);
let fpsFrameCount = 0, fpsAccumTime = 0;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0e14, 0.0032);
// Solid-color fallback background, mutated in place each frame (see the
// animate loop) rather than reassigned — the vertex-colored gradient
// sky dome (dayNightCycle.js) was removed per explicit request (it was
// conflicting with the newer photo-textured cloud dome layered just
// inside it), which leaves nothing behind the cloud dome's own partial-
// alpha gaps. Without this, those gaps would show flat black voids
// instead of sky. A plain solid blend of the current zenith/horizon
// colors isn't as rich as the old dome's per-vertex banding, but it's
// real coverage — genuinely better than a black hole in the sky.
const sceneBackgroundColor = new THREE.Color(0x1a2a3a);
scene.background = sceneBackgroundColor;

// Realistic photo/render-based cloud dome — created ONCE here rather
// than per-level like createClouds/createCloudLayer below, since it's
// the same dome for every biome (no per-biome config) and teardownLevel
// only ever removes specific tracked objects individually, never a
// blanket scene clear, so this is safe to just persist untouched across
// every level transition.
const realisticCloudDomeHandle = createRealisticCloudDome(scene);

const camera = new THREE.PerspectiveCamera(70, viewport.clientWidth / viewport.clientHeight, 0.1, 2000);
camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, getGraphicsSettings().pixelRatioCap));
renderer.shadowMap.enabled = getGraphicsSettings().shadowsEnabled;
// REVERTED per "shadows look wrong, not showing true shading" — this is
// exactly the risk flagged when VSMShadowMap was first tried as a PCSS
// substitute: VSM is known to sometimes let light "bleed" through
// overlapping shadow-casters, and this palm tree's many overlapping
// frond planes are exactly the kind of geometry where that shows up.
// Back to the standard PCFSoftShadowMap — genuine directional shading
// instead of VSM's variance-based approximation, at the cost of giving
// up the smoother edges VSM offered.
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Real contact shadows (ambient occlusion) — per explicit "let's do it"
// follow-up. This is the project's first post-processing pipeline of any
// kind (everything else renders straight to the canvas or an offscreen
// target via plain renderer.render() calls) — genuinely new
// architecture, not a tuning change. SSAOPass darkens creases/contact
// points (where a tree trunk meets the sand, where terrain folds in on
// itself) based on actual nearby depth/normal data, independent of the
// sun's current direction — this is what a directional shadow alone can
// never give you: the sun can be on the far side of the sky and a tree's
// base will still darken slightly right where it touches the ground.
// REAL COST, tier-gated below (Low skips this pass entirely): SSAOPass
// renders the scene's depth+normals in an extra pass, then blurs/composes
// the AO term — genuine additional GPU work every frame, same category
// of cost this project already fought hard to control in the reflection/
// refraction throttling work.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ssaoPass = new SSAOPass(scene, camera, viewport.clientWidth, viewport.clientHeight);
// Tuned to THIS world's scale (player eye height 1.6, a tree trunk ~1-2
// units wide) rather than SSAOPass's own defaults, which assume a
// larger/different scene scale — the defaults read as either invisible
// (radius too small to reach neighboring geometry) or a heavy fog-like
// darkening over everything (radius too large) at this project's actual
// unit scale.
// Reduced from kernelRadius=4/maxDistance=0.12 per "something doesn't
// look right" — the palm tree canopy's dense, closely-overlapping frond
// planes were building up heavy AO darkening between themselves (SSAO
// naturally piles onto tightly-packed geometry like this), reading as an
// odd dark blotch through the canopy rather than a subtle ground-contact
// shadow. Smaller radius/distance keeps it scoped closer to genuine
// contact points.
ssaoPass.kernelRadius = 2.5;
ssaoPass.minDistance = 0.0005;
ssaoPass.maxDistance = 0.08;
composer.addPass(ssaoPass);
composer.addPass(new OutputPass());
function applySsaoTier() {
  ssaoPass.enabled = getGraphicsSettings().ssaoEnabled;
}
applySsaoTier();

// A real environment map for reflective materials (currently: the ocean
// water's clearcoat layer) to actually reflect, instead of the black a
// clearcoat/high-Fresnel surface renders at grazing angles with nothing
// to sample. Not a full scene capture (a live CubeCamera re-rendering
// the whole scene every frame would cost real GPU time this project
// deliberately avoids elsewhere) — a small 2-color vertical gradient
// canvas (zenith -> horizon, the same two colors the sky dome itself
// uses) run through PMREMGenerator once. Cheap enough to regenerate
// periodically as the day/night cycle changes those colors (see
// updateSkyEnvironment below, throttled and called from the crystal-only
// per-frame update), so reflections still track dawn/day/dusk/night
// convincingly without literally mirroring the scene.
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();
const skyGradientCanvas = document.createElement("canvas");
skyGradientCanvas.width = 4; skyGradientCanvas.height = 64;
const skyGradientCtx = skyGradientCanvas.getContext("2d");
const skyGradientTexture = new THREE.CanvasTexture(skyGradientCanvas);
skyGradientTexture.mapping = THREE.EquirectangularReflectionMapping;
skyGradientTexture.colorSpace = THREE.SRGBColorSpace;
let skyEnvRenderTarget = null;
let lastSkyEnvZenith = null, lastSkyEnvHorizon = null;
// Regenerates the env map from the given zenith/horizon colors — only
// actually does the (somewhat costly) PMREM pass when the colors have
// visibly changed since last time, not unconditionally every call.
function updateSkyEnvironment(zenithColor, horizonColor) {
  if (!zenithColor || !horizonColor) return;
  if (lastSkyEnvZenith && lastSkyEnvZenith.equals(zenithColor) && lastSkyEnvHorizon && lastSkyEnvHorizon.equals(horizonColor)) return;
  if (!lastSkyEnvZenith) lastSkyEnvZenith = zenithColor.clone(); else lastSkyEnvZenith.copy(zenithColor);
  if (!lastSkyEnvHorizon) lastSkyEnvHorizon = horizonColor.clone(); else lastSkyEnvHorizon.copy(horizonColor);
  const grad = skyGradientCtx.createLinearGradient(0, 0, 0, skyGradientCanvas.height);
  grad.addColorStop(0, `#${zenithColor.getHexString()}`);
  grad.addColorStop(1, `#${horizonColor.getHexString()}`);
  skyGradientCtx.fillStyle = grad;
  skyGradientCtx.fillRect(0, 0, skyGradientCanvas.width, skyGradientCanvas.height);
  skyGradientTexture.needsUpdate = true;
  const oldTarget = skyEnvRenderTarget;
  skyEnvRenderTarget = pmremGenerator.fromEquirectangular(skyGradientTexture);
  if (oldTarget) oldTarget.dispose(); // dispose the PREVIOUS target only, one frame after the new one exists — never disposes the one currently assigned to scene.environment
  scene.environment = skyEnvRenderTarget.texture;
}

// -----------------------------------------------------------------------------
// Real planar water reflection — Coral Shallows only. Renders the scene
// ONCE per frame from a camera reflected across the water's horizontal
// plane into an offscreen target, sampled DIRECTLY inside liquid.js's
// existing crystal fragment shader (uReflectionTex/uReflectionMatrix —
// see buildWaterMaterial's onBeforeCompile there). This replaced an
// earlier THREE.Water mirror-plane attempt that never fully resolved
// after many rounds of tuning — sampling onto the REAL wave-displaced
// mesh instead of a separate flat plane removes the structural mismatch
// that kept causing visible seams between the two.
//
// Resolution is deliberately well below the main render (this is a
// SECOND full scene render every frame it's active — genuinely
// expensive, more so than anything else added this session) — capped at
// 512 on the long axis, matching the same aspect-ratio-correction
// already learned to matter for the old mirror plane's own texture.
const REFLECTION_TEX_CAP = 512;
const reflectionAspect = viewport.clientWidth / viewport.clientHeight;
const reflectionTexW = reflectionAspect >= 1 ? REFLECTION_TEX_CAP : Math.max(64, Math.round(REFLECTION_TEX_CAP * reflectionAspect));
const reflectionTexH = reflectionAspect >= 1 ? Math.max(64, Math.round(REFLECTION_TEX_CAP / reflectionAspect)) : REFLECTION_TEX_CAP;
const reflectionRenderTarget = new THREE.WebGLRenderTarget(reflectionTexW, reflectionTexH);
const reflectedCamera = new THREE.PerspectiveCamera();
// Bias matrix — maps clip-space [-1,1] to texture-space [0,1], the same
// standard technique THREE.Water/Reflector use internally for projective
// texture sampling. Combined with the reflected camera's own view+
// projection matrices fresh each frame (see the animate loop below) to
// produce the final uReflectionMatrix passed into liquid.js.
const reflectionBiasMatrix = new THREE.Matrix4().set(
  0.5, 0.0, 0.0, 0.5,
  0.0, 0.5, 0.0, 0.5,
  0.0, 0.0, 0.5, 0.5,
  0.0, 0.0, 0.0, 1.0
);
const reflectionTextureMatrix = new THREE.Matrix4();
// Scratch objects reused every frame (avoid per-frame allocation in the
// render loop, same convention already used elsewhere in this file for
// per-frame vector math).
const reflectionForward = new THREE.Vector3();
const reflectionTargetPoint = new THREE.Vector3();
const reflectionCamUp = new THREE.Vector3();

// Renders the reflection pass for the given water height and pushes the
// resulting texture/matrix into the crystal water material. Called from
// the animate loop, crystal-biome-and-above-water only (see call site).
// Real, well-defined math for the SPECIAL CASE of a purely horizontal
// mirror plane (this project's water is always flat/horizontal, never
// tilted) — reflecting a point or direction across a horizontal plane at
// height H just negates its Y component relative to H, which is far
// simpler to verify by hand than the general oblique-plane reflection
// matrix THREE.js's own Reflector.js needs for an arbitrarily-oriented
// mirror.
function updateWaterReflection(waterY, liquidHandle) {
  if (!liquidHandle || !liquidHandle.mesh) return;
  const camPos = camera.position;
  camera.getWorldDirection(reflectionForward);
  const reflectedX = camPos.x, reflectedY = 2 * waterY - camPos.y, reflectedZ = camPos.z;
  reflectionTargetPoint.set(camPos.x + reflectionForward.x, 2 * waterY - (camPos.y + reflectionForward.y), camPos.z + reflectionForward.z);
  reflectionCamUp.copy(camera.up).applyQuaternion(camera.quaternion);
  reflectionCamUp.y *= -1;
  reflectedCamera.position.set(reflectedX, reflectedY, reflectedZ);
  reflectedCamera.up.copy(reflectionCamUp);
  reflectedCamera.lookAt(reflectionTargetPoint);
  reflectedCamera.fov = camera.fov;
  reflectedCamera.aspect = camera.aspect;
  reflectedCamera.near = camera.near;
  reflectedCamera.far = camera.far;
  reflectedCamera.updateProjectionMatrix();
  reflectedCamera.updateMatrixWorld();

  // The water mesh can't usefully reflect itself — hide it (and its
  // back-face twin) for just this one render, restore immediately after.
  const wasMeshVisible = liquidHandle.mesh.visible;
  const wasBackMeshVisible = liquidHandle.backMesh ? liquidHandle.backMesh.visible : null;
  liquidHandle.mesh.visible = false;
  if (liquidHandle.backMesh) liquidHandle.backMesh.visible = false;

  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(reflectionRenderTarget);
  renderer.render(scene, reflectedCamera);
  renderer.setRenderTarget(prevTarget);

  liquidHandle.mesh.visible = wasMeshVisible;
  if (liquidHandle.backMesh) liquidHandle.backMesh.visible = wasBackMeshVisible;

  reflectionTextureMatrix.copy(reflectionBiasMatrix);
  reflectionTextureMatrix.multiply(reflectedCamera.projectionMatrix);
  reflectionTextureMatrix.multiply(reflectedCamera.matrixWorldInverse);
}

// Real refraction — a THIRD full scene render every frame it's active
// (on top of the main render and the reflection above), rendered from
// the MAIN camera directly rather than a reflected one: "what this
// camera would see if the water weren't there." No projective-matrix
// math needed on the liquid.js side since it's already aligned with
// the current view — just screen-space UV. Kept at a lower resolution
// cap than the reflection (384 vs 512) to help offset the added cost
// of a third render pass, since refraction distortion is subtle/close-
// range rather than needing to resolve distant geometry the way the
// reflection does.
const REFRACTION_TEX_CAP = 384;
const refractionAspect = viewport.clientWidth / viewport.clientHeight;
const refractionTexW = refractionAspect >= 1 ? REFRACTION_TEX_CAP : Math.max(64, Math.round(REFRACTION_TEX_CAP * refractionAspect));
const refractionTexH = refractionAspect >= 1 ? Math.max(64, Math.round(REFRACTION_TEX_CAP / refractionAspect)) : REFRACTION_TEX_CAP;
const refractionRenderTarget = new THREE.WebGLRenderTarget(refractionTexW, refractionTexH);
// Actual current renderer resolution (NOT the refraction target's own,
// smaller resolution) — this feeds gl_FragCoord normalization in the
// shader, which needs to match the real screen the fragment is being
// rasterized at, independent of what resolution the sampled texture
// itself happens to be stored at.
const refractionResolution = new THREE.Vector2(1, 1);

// Renders the refraction pass and pushes the result into the crystal
// water material. Same "hide the water mesh, render, restore" pattern
// as updateWaterReflection above, just with the real camera instead of
// a reflected one.
function updateWaterRefraction(liquidHandle) {
  if (!liquidHandle || !liquidHandle.mesh) return;
  const wasMeshVisible = liquidHandle.mesh.visible;
  const wasBackMeshVisible = liquidHandle.backMesh ? liquidHandle.backMesh.visible : null;
  liquidHandle.mesh.visible = false;
  if (liquidHandle.backMesh) liquidHandle.backMesh.visible = false;

  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(refractionRenderTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(prevTarget);

  liquidHandle.mesh.visible = wasMeshVisible;
  if (liquidHandle.backMesh) liquidHandle.backMesh.visible = wasBackMeshVisible;

  renderer.getSize(refractionResolution);
}

function resizeToViewport() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (w === 0 || h === 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  ssaoPass.setSize(w, h);
  const pixelRatio = renderer.getPixelRatio();
  underwaterRenderTarget.setSize(w * pixelRatio, h * pixelRatio);
}
new ResizeObserver(resizeToViewport).observe(viewport);

// Underwater screen-space distortion — a real post-process pass, only
// ever used when the player is submerged. The scene renders to this
// offscreen target instead of the screen; a full-screen quad then draws
// that texture back out with a sine-distorted UV (the "wavy, looking
// through water" look) plus a blue tint. When NOT underwater, none of
// this is touched at all — the normal direct renderer.render(scene,
// camera) call further down stays completely unchanged, so this adds
// zero risk to the other ~99% of gameplay.
const underwaterRenderTarget = new THREE.WebGLRenderTarget(
  Math.max(1, viewport.clientWidth * renderer.getPixelRatio()),
  Math.max(1, viewport.clientHeight * renderer.getPixelRatio())
);
// A real depth attachment — resizing the render target (see
// resizeToViewport above) automatically resizes this alongside the color
// texture, no extra code needed there. This is what lets the fragment
// shader below compute genuine per-pixel distance instead of a single
// flat blend applied uniformly regardless of what's actually close vs.
// far in frame.
underwaterRenderTarget.depthTexture = new THREE.DepthTexture();
underwaterRenderTarget.depthTexture.type = THREE.UnsignedIntType;
const underwaterQuadScene = new THREE.Scene();
const underwaterQuadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const underwaterDistortionMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tDiffuse: { value: underwaterRenderTarget.texture }, tDepth: { value: underwaterRenderTarget.depthTexture }, time: { value: 0 },
    tintColor: { value: new THREE.Vector3(0.08, 0.28, 0.45) }, tintStrength: { value: 0.18 }, fogDensity: { value: 0.05 },
    causticStrength: { value: 0.0 }, distortAmp: { value: 0.01 },
    // The MAIN scene camera's near/far — not this quad's own orthographic
    // pass-through camera, which is irrelevant to the depth values
    // actually written into tDepth. Set once: this project's camera never
    // changes near/far after creation.
    cameraNear: { value: camera.near }, cameraFar: { value: camera.far },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform float time;
    uniform vec3 tintColor;
    uniform float tintStrength;
    uniform float fogDensity;
    uniform float causticStrength;
    uniform float distortAmp;
    uniform float cameraNear;
    uniform float cameraFar;
    varying vec2 vUv;

    // Perspective (nonlinear) depth-buffer value -> linear view-space
    // distance from the camera, using the MAIN scene camera's near/far.
    float linearDepth(float depth) {
      float viewZ = (cameraNear * cameraFar) / ((cameraFar - cameraNear) * depth - cameraFar);
      return -viewZ;
    }

    // Compact 2D Worley/Voronoi noise — the same technique the ocean
    // surface's own whitecap-foam shader (liquid.js) uses, reused here so
    // the caustic pattern reads as genuinely procedural light-net shapes
    // instead of a generic tiled sine grid, and so the two effects share
    // a consistent visual language.
    vec2 causticHash(vec2 p) {
      float n = sin(dot(p, vec2(41.0, 289.0)));
      return fract(vec2(262144.0, 32768.0) * n);
    }
    float causticVoronoi(vec2 p) {
      vec2 ip = floor(p);
      vec2 fp = fract(p);
      float minDist = 1.0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 neighbor = vec2(float(x), float(y));
          vec2 point = causticHash(ip + neighbor);
          minDist = min(minDist, length(neighbor + point - fp));
        }
      }
      return minDist;
    }

    void main() {
      vec2 distortedUv = vUv + vec2(
        sin(vUv.y * 14.0 + time * 1.6) * distortAmp,
        sin(vUv.x * 11.0 + time * 1.3) * distortAmp
      );
      vec4 color = texture2D(tDiffuse, distortedUv);
      float depth = linearDepth(texture2D(tDepth, distortedUv).x);

      // Real exponential fog — same falloff shape as this game's own
      // FogExp2 (1 - exp(-density * distance)), computed per-pixel from
      // actual scene depth instead of one flat blend strength applied
      // everywhere regardless of distance. Close objects stay clear;
      // distant ones fade into the blue-green tint the way light
      // actually attenuates through real water. tintStrength stays as a
      // per-biome overall-intensity multiplier on top of that falloff.
      float fogFactor = clamp(1.0 - exp(-fogDensity * depth), 0.0, 1.0) * tintStrength;
      color.rgb = mix(color.rgb, tintColor, fogFactor);

      // Procedural caustics — two Voronoi octaves at different scale and
      // drift speed, faded out with depth (real caustics are a
      // near-surface light phenomenon; they don't reach the floor of a
      // deep trench). causticStrength is 0 for every biome except
      // crystal, so this whole block is inert everywhere else.
      vec2 causticUv = distortedUv * 9.0 + vec2(time * 0.12, -time * 0.09);
      float c1 = causticVoronoi(causticUv);
      float c2 = causticVoronoi(causticUv * 1.7 - vec2(time * 0.07, time * 0.1));
      float causticPattern = (1.0 - smoothstep(0.0, 0.35, c1)) * 0.6 + (1.0 - smoothstep(0.0, 0.3, c2)) * 0.5;
      float depthFade = 1.0 - clamp(depth / 18.0, 0.0, 1.0);
      color.rgb += causticPattern * depthFade * causticStrength;

      gl_FragColor = color;
    }
  `,
});
underwaterQuadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), underwaterDistortionMaterial));

// A large sphere enclosing the camera, rendered from the inside
// (BackSide) with a translucent blue tint — the "volume that looks like
// water" the player is inside of, distinct from the screen-space
// distortion above. Follows the camera every frame; visibility toggled
// on/off with the underwater state.
const waterVolumeMesh = new THREE.Mesh(
  new THREE.SphereGeometry(3, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0x1a5a7a, transparent: true, opacity: 0.12, side: THREE.BackSide, depthWrite: false, fog: false })
);
waterVolumeMesh.visible = false;
scene.add(waterVolumeMesh);

// #rift-viewport's ancestor `.panel` uses a `transform` for its scroll-reveal
// animation — and CSS position:fixed resolves relative to the nearest
// transformed ancestor, not the real browser viewport, if one exists in the
// chain. Left alone, "fullscreen" would size itself against the .panel's
// own box instead of the screen (the canvas still fills 100% of whatever
// box it's given so it can look fine at a glance, but small
// absolutely-positioned UI like the menu/fullscreen buttons end up
// positioned against the wrong box entirely and can land off-screen).
// Reparenting to <body> while fullscreen sidesteps the whole problem —
// same fix already proven for Ghostwire's identical bug.
const viewportHome = { parent: viewport.parentNode, nextSibling: viewport.nextSibling };
let lockedScrollY = 0;

function enterFullscreen() {
  lockedScrollY = window.scrollY;
  document.body.appendChild(viewport);
  document.documentElement.style.overflow = "hidden";
  document.body.style.position = "fixed";
  document.body.style.top = `-${lockedScrollY}px`;
  document.body.style.left = "0";
  document.body.style.width = "100%";
  document.body.style.height = "100%";
  document.body.style.overflow = "hidden";
  viewport.classList.add("rift-fullscreen");
  fullscreenBtn?.classList.add("gfs-active");
  resizeToViewport();
}

function exitFullscreen() {
  viewport.classList.remove("rift-fullscreen");
  fullscreenBtn?.classList.remove("gfs-active");
  if (viewportHome.nextSibling) {
    viewportHome.parent.insertBefore(viewport, viewportHome.nextSibling);
  } else {
    viewportHome.parent.appendChild(viewport);
  }
  document.documentElement.style.overflow = "";
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.width = "";
  document.body.style.height = "";
  document.body.style.overflow = "";
  window.scrollTo(0, lockedScrollY);
  resizeToViewport();
}

if (fullscreenBtn) {
  fullscreenBtn.addEventListener("click", () => {
    if (viewport.classList.contains("rift-fullscreen")) exitFullscreen();
    else enterFullscreen();
  });
}
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && viewport.classList.contains("rift-fullscreen")) exitFullscreen();
});

const ambientLight = new THREE.AmbientLight(0x8899bb, 0.65);
scene.add(ambientLight);
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(60, 100, 40);
sun.castShadow = true;
// Shadow frustum sized to the terrain's own extent (see terrain.js's
// TERRAIN_SIZE) rather than Three.js's small default — otherwise most of
// the level would fall outside the shadow camera entirely. Resolution
// kept moderate; this is a single directional light so the cost is one
// shadow pass regardless, but a bigger map is still real GPU/memory cost
// on lower-end devices.
const SHADOW_EXTENT = 140;
sun.shadow.camera.left = -SHADOW_EXTENT;
sun.shadow.camera.right = SHADOW_EXTENT;
sun.shadow.camera.top = SHADOW_EXTENT;
sun.shadow.camera.bottom = -SHADOW_EXTENT;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 500;
sun.shadow.mapSize.set(getGraphicsSettings().shadowMapSize, getGraphicsSettings().shadowMapSize);
sun.shadow.bias = -0.0015;
// normalBias added alongside the existing depth bias, per "still no
// shadow under the trees" — a flat depth bias alone is a common cause of
// "peter-panning" (the shadow detaches from its caster enough to miss
// the actual contact point entirely) especially for THIN, mostly-
// vertical geometry like a tree trunk. normalBias offsets along the
// surface NORMAL instead of view depth, which scales more sensibly with
// the light's incidence angle and is the standard complement/fix for
// this specific failure mode.
sun.shadow.normalBias = 0.05;
// Per explicit "more realistic shadows" request: PCFSoftShadowMap
// (already the renderer's shadow type, set below) supports a `radius`
// property controlling edge softness — left at its default (1, a fairly
// tight/hard edge) until now. Real sunlight isn't a point source, so real
// shadows have a genuine soft penumbra, not a crisp cutout. This is a
// UNIFORM softness (doesn't get softer with distance from the caster the
// way a true penumbra physically would — that needs PCSS, a custom
// shader technique, not attempted here) but is a real, direct
// improvement over the previous hard edge with no added render cost.
sun.shadow.radius = 3;
// blurSamples removed — was VSM-specific, has no effect now that
// shadowMap.type is back to PCFSoftShadowMap.
scene.add(sun);

// Real moonlight — per explicit "shadows... during night" request.
// Previously the moon was purely decorative (a sprite, no THREE.Light at
// all — see dayNightCycle.js's moonBody), so once the sun set there was
// no light source left that could cast a shadow at all (ambient light
// doesn't). Dim on purpose (peak intensity 0.22, set per-frame in
// dayNightCycle.js — this is just the initial/structural setup) so it
// reads as a subtle real light, not a second sun. Shadow map kept at
// HALF the sun's own resolution — moonlit shadows are a soft, subtle
// nice-to-have, not worth doubling the shadow-pass cost for.
const moonLight = new THREE.DirectionalLight(0xaebedd, 0);
moonLight.castShadow = true;
moonLight.shadow.camera.left = -SHADOW_EXTENT;
moonLight.shadow.camera.right = SHADOW_EXTENT;
moonLight.shadow.camera.top = SHADOW_EXTENT;
moonLight.shadow.camera.bottom = -SHADOW_EXTENT;
moonLight.shadow.camera.near = 1;
moonLight.shadow.camera.far = 500;
moonLight.shadow.mapSize.set(getGraphicsSettings().shadowMapSize / 2, getGraphicsSettings().shadowMapSize / 2);
moonLight.shadow.bias = -0.0015;
moonLight.shadow.normalBias = 0.05;
moonLight.shadow.radius = 4; // slightly softer than the sun's own — a dim, diffuse moonlit shadow reads as even less crisp than a bright sunlit one
scene.add(moonLight);

let starfieldPoints = null;
{
  const starGeo = new THREE.BufferGeometry();
  const starCount = 1500;
  const positions = new Float32Array(starCount * 3);
  // Scattered on a thin spherical shell just inside the sky dome's own
  // radius (dayNightCycle.js's SKY_DOME_RADIUS = 900) instead of an
  // independent per-axis box — the old ±600 X/Z, 80-580 Y box sat well
  // inside that 900-radius dome, so its flat faces and corners were
  // visible as a "room" floating inside the round sky rather than stars
  // reading as infinitely distant. A sphere has no faces to show through.
  // Upper-hemisphere only (phi capped at PI/2), matching the old "kept
  // above the terrain" intent — acos of a uniform random value keeps the
  // distribution even across the hemisphere's solid angle rather than
  // clustering stars at the zenith.
  const STAR_SHELL_MIN = 820, STAR_SHELL_MAX = 880;
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random()); // 0 (straight up) .. PI/2 (horizon)
    const r = STAR_SHELL_MIN + Math.random() * (STAR_SHELL_MAX - STAR_SHELL_MIN);
    const sinPhi = Math.sin(phi);
    positions[i * 3] = r * sinPhi * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * sinPhi * Math.sin(theta);
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, sizeAttenuation: true, transparent: true, opacity: 1 });
  starfieldPoints = new THREE.Points(starGeo, starMat);
  // Per explicit "stars... showing in front of the background clouds"
  // report — had no explicit renderOrder at all (defaulted to 0), while
  // the cloud dome explicitly uses -95/-100 (clouds.js). Same fix as
  // dayNightCycle.js's sun/moon body and distant planet — -101 puts it
  // behind every cloud layer, consistent with stars being the farthest
  // background element, not painted on top of nearer cloud geometry.
  starfieldPoints.renderOrder = -101;
  scene.add(starfieldPoints);
}

const dayNightCycle = createDayNightCycle(scene, sun, ambientLight, starfieldPoints, undefined, moonLight);

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
const controls = new PointerLockControls(camera, document.body);

function showLevelSelect() {
  startOverlay.style.display = "flex";
  levelSelectEl.hidden = false;
  touchGameActive = false;
}
controls.addEventListener("unlock", showLevelSelect);

if (menuBtn) {
  menuBtn.addEventListener("click", () => {
    if (!isTouchDevice) controls.unlock();
    showLevelSelect();
  });
}

// The animated "RIFT ISLANDS" intro (title gate) is shown first, on top of
// the biome-select overlay (which starts hidden — see index.html). Play
// fades the gate out and reveals the biome menu via the same
// showLevelSelect() the in-game MENU button already uses, so entering a
// level from here works exactly like it always has.
if (titleGate && titlePlayBtn) {
  titlePlayBtn.addEventListener("click", () => {
    titleGate.classList.add("rift-title-gate-hidden");
    setTimeout(() => { titleGate.style.display = "none"; }, 650); // matches the CSS opacity transition — only removed from layout after it's fully faded
    showLevelSelect();
  });
}

const keys = { forward: false, back: false, left: false, right: false, up: false, down: false };
let jumpQueued = false;
const MOVE_KEYS = new Set(["KeyW", "KeyS", "KeyA", "KeyD", "Space", "ShiftLeft", "ShiftRight"]);

window.addEventListener("keydown", (e) => {
  if (isGameActive() && MOVE_KEYS.has(e.code)) e.preventDefault();
  if (e.code === "Space" && !e.repeat) jumpQueued = true;
  setKey(e.code, true);
});
window.addEventListener("keyup", (e) => setKey(e.code, false));

function setKey(code, value) {
  switch (code) {
    case "KeyW": keys.forward = value; break;
    case "KeyS": keys.back = value; break;
    case "KeyA": keys.left = value; break;
    case "KeyD": keys.right = value; break;
    // Held (not edge-triggered) state, specifically for continuous swim
    // control — see physics.js's swimming branch. Space ALSO still drives
    // the separate edge-triggered jumpQueued above for the on-land jump;
    // both readings come from the same key, same dual-purpose pattern
    // touchControls.js's up button now mirrors for touch.
    case "Space": keys.up = value; break;
    case "ShiftLeft": case "ShiftRight": keys.down = value; break;
  }
}

const velocity = new THREE.Vector3();
let footstepDistance = 0;
const FOOTSTEP_STRIDE = 2.4; // world units between footstep sounds — tied to distance actually covered, not a fixed timer, so sprinting/slow movement both sound right

function updateMovement(dt, grounded, swimming) {
  velocity.set(0, 0, 0);
  if (keys.forward) velocity.z -= 1;
  if (keys.back) velocity.z += 1;
  if (keys.left) velocity.x -= 1;
  if (keys.right) velocity.x += 1;
  const moving = velocity.lengthSq() > 0;
  if (moving) velocity.normalize();

  // Water resistance — per explicit "decreases the movement speed just
  // like moving in real water" request. Takes priority over the
  // grounded/airborne distinction below (swimming has its own multiplier
  // regardless of whether the seafloor happens to be right under the
  // player's feet at this exact instant).
  const speed = swimming ? WALK_SPEED * SWIM_SPEED_MULTIPLIER : WALK_SPEED * (grounded ? 1 : AIR_CONTROL);
  controls.moveRight(velocity.x * speed * dt);
  controls.moveForward(-velocity.z * speed * dt);

  if (moving && grounded) {
    footstepDistance += speed * dt;
    if (footstepDistance >= FOOTSTEP_STRIDE) {
      footstepDistance = 0;
      playFootstep(currentLevelIdx >= 0 ? LEVELS[currentLevelIdx].biome : "ember");
      if (footstepGlowHandle) {
        const groundY = terrainMesh ? (terrainHeightAt(LEVELS[currentLevelIdx], camera.position.x, camera.position.z, WORLD_SEED) ?? camera.position.y - PLAYER_EYE_HEIGHT) : camera.position.y - PLAYER_EYE_HEIGHT;
        spawnFootstepGlow(footstepGlowHandle, camera.position.x, groundY, camera.position.z);
      }
    }
  } else {
    footstepDistance = 0; // reset mid-stride rather than carrying a partial step into the next movement burst
  }

  // Soft world bounds — keeps the player off the terrain's falloff rim and
  // away from the finite plane's actual edge (see terrain.js/WORLD_BOUND_RADIUS
  // above), rather than needing to fall off into empty space to find out
  // there's a limit.
  const distFromCenter = Math.hypot(camera.position.x, camera.position.z);
  if (distFromCenter > WORLD_BOUND_RADIUS) {
    const scale = WORLD_BOUND_RADIUS / distFromCenter;
    camera.position.x *= scale;
    camera.position.z *= scale;
  }
}

// ---------------------------------------------------------------------------
// Level building — one continuous terrain per biome. Tearing down the
// previous level's terrain/decorations/crystals on every switch (including
// re-entering the same level, which always regenerates fresh) keeps this
// simple instead of diffing old vs new state.
// ---------------------------------------------------------------------------
let terrainMesh = null;
let liquidHandle = null;
let reflectionFrameCounter = 999; // starts high so the first eligible frame always renders immediately, not a blank/stale texture
// Real GLB model instances — Coral Shallows only (see models.js). Tracked
// separately from every other decoration/wildlife array since these load
// ASYNCHRONOUSLY and need their own teardown (mixer + geometry/material
// dispose) and their own per-frame update (AnimationMixer.update, for the
// fish).
let realPalmTrees = [];
let realFish = [];
let realReefStructures = [];
let realCoralPieces = [];
let waterfallHandle = null;
let oceanSurfaceDetailHandle = null;
let riverCurrentHandle = null;
let riverFlowStripHandle = null;
let cliffWallHandle = null;
let sourcePondHandle = null;
let caveFloorMeshes = []; // the collidable pieces of this underground network — passed into updatePlayerPhysics as extraMeshes; walls/ceiling/decoration are ordinary non-collidable scene objects. One per level for the main room; a second is added for the branch corridor + chamber.
let atmosphereHandle = null;
let grassHandle = null;
let flowersHandle = null;
let footstepGlowHandle = null;
let weatherHandle = null;
let cloudsHandle = null;
let submergedState = false; // persists across frames — see the hysteresis check below for why a fresh threshold comparison every frame isn't enough
let cloudLayerHandle = null;
let horizonHandle = null;
let wildlifeHandle = null;
let landmarkHandle = null;
const crystalHandles = new Map();
let allCrystals = [];
let crystalsTotal = 0;
let crystalsCollected = 0;
const decorationHandles = [];
let lightShaftHandles = [];
// Coral Shallows underwater light shafts — separate array from the
// Verdant canopy ones above so submersion-based visibility can be
// toggled independently without needing to tag/filter a shared array.
let underwaterShaftHandles = [];
let loreMarkers = []; // {id, x, z, y, shown}
let currentLevelIdx = -1;
let spawnPosition = { x: 0, y: 5, z: 0 };
const playerPhysics = createPlayerPhysicsState();

// ---------------------------------------------------------------------------
// Ember fire spawner — Ember Reach only. Fires that were placed as part of
// the fixed level layout (via decorations.js's buildBaseDecoration) burn
// forever; these are separate, dynamically spawned/despawned at runtime so
// the biome keeps feeling alive rather than a static one-time layout.
// ---------------------------------------------------------------------------
let fireSpawnTimer = 0;
let wasErupting = false; // edge-detects eruption start/stop for audio — see the animate loop
const MAX_DYNAMIC_FIRES = 10; // defensive cap so spawns can never outpace burnouts and pile up indefinitely

function teardownLevel() {
  if (scene.environment) {
    scene.environment = null;
    if (skyEnvRenderTarget) { skyEnvRenderTarget.dispose(); skyEnvRenderTarget = null; }
    lastSkyEnvZenith = null; lastSkyEnvHorizon = null; // forces a fresh regenerate next time crystal loads, rather than comparing against a stale color from the previous visit
  }
  if (terrainMesh) {
    scene.remove(terrainMesh);
    terrainMesh.geometry.dispose();
    // The sand normal-map texture (crystal-only, see buildLevel) is a
    // per-level CLONE — material.dispose() below does NOT automatically
    // dispose textures attached to it, so this needs its own explicit
    // call, same as every other per-instance texture clone in this
    // project (see liquid.js's rippleTexture/mirrorWater disposal).
    if (terrainMesh.material.normalMap) terrainMesh.material.normalMap.dispose();
    terrainMesh.material.dispose();
    terrainMesh = null;
  }
  disposeLiquidPlane(scene, liquidHandle);
  liquidHandle = null;
  disposeWaterfall(scene, waterfallHandle);
  waterfallHandle = null;
  disposeOceanSurfaceDetail(scene, oceanSurfaceDetailHandle);
  oceanSurfaceDetailHandle = null;
  disposeRiverCurrent(scene, riverCurrentHandle);
  riverCurrentHandle = null;
  disposeRiverFlowStrip(scene, riverFlowStripHandle);
  riverFlowStripHandle = null;
  disposeCliffWall(scene, cliffWallHandle);
  cliffWallHandle = null;
  disposeSourcePond(scene, sourcePondHandle);
  sourcePondHandle = null;
  for (const floorMesh of caveFloorMeshes) {
    scene.remove(floorMesh);
    floorMesh.geometry.dispose();
    floorMesh.material.dispose();
  }
  caveFloorMeshes = [];
  disposeAtmosphericParticles(scene, atmosphereHandle);
  atmosphereHandle = null;
  disposeGrass(scene, grassHandle);
  grassHandle = null;
  disposeFlowers(scene, flowersHandle);
  disposeFootstepGlowSystem(scene, footstepGlowHandle);
  footstepGlowHandle = null;
  flowersHandle = null;
  disposeWeatherSystem(scene, weatherHandle);
  weatherHandle = null;
  disposeClouds(scene, cloudsHandle);
  cloudsHandle = null;
  disposeCloudLayer(scene, cloudLayerHandle);
  cloudLayerHandle = null;
  disposeHorizonSilhouettes(scene, horizonHandle);
  horizonHandle = null;
  disposeWildlife(scene, wildlifeHandle);
  wildlifeHandle = null;
  disposeLandmark(scene, landmarkHandle);
  landmarkHandle = null;
  for (const [, handle] of crystalHandles) disposeCrystalMesh(scene, handle);
  crystalHandles.clear();
  allCrystals = [];
  for (const handle of decorationHandles) {
    scene.remove(handle.group);
    handle.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  }
  decorationHandles.length = 0;
  disposeLightShafts(scene, lightShaftHandles);
  lightShaftHandles = [];
  disposeLightShafts(scene, underwaterShaftHandles);
  underwaterShaftHandles = [];
  loreMarkers = [];
  // Real GLB instances (models.js) — remove from scene only. Deliberately
  // NOT disposing geometry/material here: these clones share the
  // underlying buffers with the module-level cached GLTF (palmTreeGLTF/
  // angelfishGLTF in models.js), so disposing would corrupt that shared
  // cache and break every future instance created from it, unlike the
  // procedural decorations above (which own unique geometry per instance
  // and correctly dispose it). Any in-flight load promise for a biome
  // being torn down is left to resolve naturally — its own levelIdx
  // guard (see buildLevel) makes it a no-op if the level has moved on.
  for (const group of realPalmTrees) scene.remove(group);
  realPalmTrees = [];
  for (const fish of realFish) scene.remove(fish.group);
  realFish = [];
  for (const reef of realReefStructures) scene.remove(reef);
  realReefStructures = [];
  for (const coral of realCoralPieces) scene.remove(coral);
  realCoralPieces = [];
}

// Orients the camera to face AWAY from the biome's landmark — that's the
// single biggest nearby structure (a full-size volcano/spire/arch/etc,
// see landmarks.js), so it's the most likely thing to fill the player's
// view immediately on spawn if they happen to be facing toward it. Facing
// away instead means they open their eyes looking out at open terrain and
// the horizon silhouettes in the distance. Three.js's camera looks down
// -Z by default; rotating that vector by rotation.y=theta gives
// (-sin(theta), 0, -cos(theta)), so solving for theta such that this
// points along (x - LANDMARK_POSITION.x, z - LANDMARK_POSITION.z) — i.e.
// away from the landmark — gives atan2(-dx, -dz) below.
function faceAwayFromLandmark(x, z) {
  const dx = x - LANDMARK_POSITION.x;
  const dz = z - LANDMARK_POSITION.z;
  camera.rotation.y = Math.atan2(-dx, -dz);
}

// Real photo-derived sand grain detail — Coral Shallows only. Three real
// textures from the same stock sand photo set (color/diffuse, bump,
// normal), all cached at module level and cloned per level load so each
// clone's own `.repeat` (set once, right after cloning) can't collide
// with any other consumer of the same underlying image — same
// established pattern as liquid.js's own texture clones.
let sandNormalTexture = null;
function getSandNormalTexture() {
  if (sandNormalTexture) return sandNormalTexture;
  const url = new URL("textures/sandnormals.jpg", import.meta.url).href;
  sandNormalTexture = new THREE.TextureLoader().load(
    url,
    () => console.log("[main] sand normal texture loaded:", url),
    undefined,
    (err) => console.error("[main] sand normal texture FAILED to load:", url, err)
  );
  sandNormalTexture.wrapS = sandNormalTexture.wrapT = THREE.RepeatWrapping;
  return sandNormalTexture;
}
let sandColorTexture = null;
function getSandColorTexture() {
  if (sandColorTexture) return sandColorTexture;
  const url = new URL("textures/sandcolor.jpg", import.meta.url).href;
  sandColorTexture = new THREE.TextureLoader().load(
    url,
    () => console.log("[main] sand color texture loaded:", url),
    undefined,
    (err) => console.error("[main] sand color texture FAILED to load:", url, err)
  );
  sandColorTexture.colorSpace = THREE.SRGBColorSpace; // this one carries real baked color (unlike normal/bump, which are data maps, not color) — needs the same colorSpace correction this project's other painted-color textures already use, or it renders washed out
  sandColorTexture.wrapS = sandColorTexture.wrapT = THREE.RepeatWrapping;
  return sandColorTexture;
}
let sandBumpTexture = null;
function getSandBumpTexture() {
  if (sandBumpTexture) return sandBumpTexture;
  const url = new URL("textures/sandbump.jpg", import.meta.url).href;
  sandBumpTexture = new THREE.TextureLoader().load(
    url,
    () => console.log("[main] sand bump texture loaded:", url),
    undefined,
    (err) => console.error("[main] sand bump texture FAILED to load:", url, err)
  );
  sandBumpTexture.wrapS = sandBumpTexture.wrapT = THREE.RepeatWrapping;
  return sandBumpTexture;
}

// Per explicit "let's add some sand to the seafloor" — a real, fuller PBR
// texture set (color + normal + roughness) replacing the older 3-texture
// setup above wherever it's actually used below. The normal map here is
// specifically the OpenGL-convention variant (three.js/WebGL's own
// convention) — the source pack also included a DirectX variant, which
// would render lighting inverted/wrong if used here by mistake. AO and
// height maps were also provided but deliberately NOT wired in: aoMap
// requires a second UV channel (uv2) this terrain geometry doesn't have,
// and true height-map displacement needs real vertex-shader work — both
// meaningfully riskier than a straightforward texture swap, so left out
// rather than attempted blind.
let seafloorSandColorTexture = null;
function getSeafloorSandColorTexture() {
  if (seafloorSandColorTexture) return seafloorSandColorTexture;
  const url = new URL("textures/seafloor_sand_color.jpg", import.meta.url).href;
  seafloorSandColorTexture = new THREE.TextureLoader().load(
    url,
    () => console.log("[main] seafloor sand color texture loaded:", url),
    undefined,
    (err) => console.error("[main] seafloor sand color texture FAILED to load:", url, err)
  );
  seafloorSandColorTexture.colorSpace = THREE.SRGBColorSpace; // real baked color, same correction the old sandColorTexture needed
  seafloorSandColorTexture.wrapS = seafloorSandColorTexture.wrapT = THREE.RepeatWrapping;
  return seafloorSandColorTexture;
}
let seafloorSandNormalTexture = null;
function getSeafloorSandNormalTexture() {
  if (seafloorSandNormalTexture) return seafloorSandNormalTexture;
  const url = new URL("textures/seafloor_sand_normal.jpg", import.meta.url).href;
  seafloorSandNormalTexture = new THREE.TextureLoader().load(
    url,
    () => console.log("[main] seafloor sand normal texture loaded:", url),
    undefined,
    (err) => console.error("[main] seafloor sand normal texture FAILED to load:", url, err)
  );
  seafloorSandNormalTexture.wrapS = seafloorSandNormalTexture.wrapT = THREE.RepeatWrapping;
  return seafloorSandNormalTexture;
}
let seafloorSandRoughnessTexture = null;
function getSeafloorSandRoughnessTexture() {
  if (seafloorSandRoughnessTexture) return seafloorSandRoughnessTexture;
  const url = new URL("textures/seafloor_sand_roughness.jpg", import.meta.url).href;
  seafloorSandRoughnessTexture = new THREE.TextureLoader().load(
    url,
    () => console.log("[main] seafloor sand roughness texture loaded:", url),
    undefined,
    (err) => console.error("[main] seafloor sand roughness texture FAILED to load:", url, err)
  );
  seafloorSandRoughnessTexture.wrapS = seafloorSandRoughnessTexture.wrapT = THREE.RepeatWrapping;
  return seafloorSandRoughnessTexture;
}

function buildLevel(levelIdx) {
  teardownLevel();
  currentLevelIdx = levelIdx;
  const level = LEVELS[levelIdx];
  // dayNightCycle is created once at boot (before any level/biome is known)
  // and persists across level switches, so its per-biome sky tint has to be
  // set here on each level load rather than passed once at construction.
  dayNightCycle.biome = level.biome;

  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0.05,
    emissive: level.color, emissiveIntensity: 0.04,
  });
  if (level.biome === "crystal") {
    // Real photo-derived sand detail — layered on top of the existing
    // vertexColors height-palette coloring, not replacing it. `map`
    // MULTIPLIES against vertexColors (three.js's standard behavior when
    // both are set) — the color texture was pre-brightened toward a
    // neutral ~0.72 average specifically so this multiply adds real
    // photographic grain/color variation without systematically
    // darkening or re-tinting the existing rock/grass/sand blending
    // logic (terrain.js) underneath it. normalMap + bumpMap both stack
    // on top for actual lighting-responsive surface detail — three.js's
    // built-in pipeline handles both simultaneously without conflict.
    // Applies across this biome's whole terrain (dry sand AND the
    // underwater reef floor) rather than being masked to dry sand
    // specifically — masking it would need the same kind of custom
    // shader work being deliberately avoided here, and the underwater
    // portion is already heavily dressed with the caustics/wave-wash
    // effect below, so the grain reads fine there too.
    const repeatCount = Math.max(6, Math.round(TERRAIN_SIZE / 6));
    const sandNormals = getSeafloorSandNormalTexture().clone();
    sandNormals.needsUpdate = true;
    sandNormals.repeat.set(repeatCount, repeatCount);
    terrainMat.normalMap = sandNormals;
    terrainMat.normalScale = new THREE.Vector2(0.55, 0.55);
    const sandColor = getSeafloorSandColorTexture().clone();
    sandColor.needsUpdate = true;
    sandColor.repeat.set(repeatCount, repeatCount);
    terrainMat.map = sandColor;
    // roughnessMap replaces the old bumpMap here — a real PBR roughness
    // channel (matte grit vs. smoother wet-looking patches) rather than
    // bump's cruder fake-height approximation, now that a genuine
    // roughness map is actually available. roughness stays set (0.9,
    // just above, from the base material definition) as the multiplier
    // this map's own values scale against, same as how map/vertexColors
    // multiply together.
    const sandRoughness = getSeafloorSandRoughnessTexture().clone();
    sandRoughness.needsUpdate = true;
    sandRoughness.repeat.set(repeatCount, repeatCount);
    terrainMat.roughnessMap = sandRoughness;
    // Real procedural caustics, anchored to the actual seafloor geometry
    // via onBeforeCompile — not a screen-space overlay (which paints
    // every pixel identically regardless of view direction or what's
    // actually being looked at, the exact reason UNDERWATER_STYLE.crystal
    // keeps causticStrength at 0 above) and not the old sparse floating-
    // points system (vegetation.js's now-unused createCaustics, only 260
    // soft blobs — nowhere near the dense rippling net a real shallow
    // reef floor shows). Two Voronoi F2-F1 "cell edge" layers (thin
    // bright lines tracing cell boundaries, not filled blobs — this is
    // what actually reads as a caustic net rather than a scatter of
    // dots) at different scale/drift, gated to only the actual submerged,
    // upward-facing sand — dry island terrain and any vertical rock face
    // stay untouched.
    terrainMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uWaterLevel = { value: LIQUID_LEVEL.crystal };
      // Real day/night-driven caustic brightness — per explicit
      // reference request ("bright, sunlight through the surface")
      // rather than the previous flat, time-of-day-independent
      // intensity. Fed from dayNight.dayAmount each frame, same
      // already-established 0..1 signal every other day/night-aware
      // system in this file already reads (grass wind, cloud opacity,
      // ambient light) — not a new/separate day concept.
      shader.uniforms.uDayAmount = { value: 0 };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>
varying vec3 vCausticWorldPos;
varying vec3 vCausticWorldNormal;
varying float vWaveHeight;
uniform float uTime;
uniform float uWaterLevel;
// Same Gerstner wave spectrum as the actual ocean surface mesh in
// liquid.js — duplicated here because vertex and fragment are separate
// compiled programs and can't share a GLSL function directly, even
// though both read the same uTime/uWaterLevel uniform values.
//
// REWORKED from a hand-picked 4-wave sum to a 10-wave GENERATED
// spectrum, kept in exact numeric sync with liquid.js's own generator
// (GERSTNER_WAVES_RAW) — same reasoning as that file's own comment:
// only 4 discrete components made the combined pattern fixed and
// exactly repeating, which read as synthetic at close range. These
// exact coefficients were computed by actually RUNNING the JS
// generator (not hand-derived), then transcribed here — direction
// vectors are already unit length (generated via cos/sin of an angle),
// so no normalize() needed the way the old 4-wave version required.
// Domain warping (gerstnerDomainWarp) is applied to the SAMPLE position
// before evaluating the sum, not the output height — same technique
// and reasoning as liquid.js's own version, translated to GLSL.
vec2 gerstnerDomainWarp(vec2 p, float t) {
  // Kept in exact numeric sync with liquid.js's own boosted magnitude
  // (was 4.5/2.5, now 16/9) — see that file's comment for why.
  float wx = sin(p.x * 0.016 + p.y * 0.009 + t * 0.05) * 16.0 + sin(p.x * 0.006 - p.y * 0.011 - t * 0.02) * 9.0;
  float wz = cos(p.x * 0.011 - p.y * 0.014 + t * 0.04) * 16.0 + cos(p.x * 0.008 + p.y * 0.007 - t * 0.018) * 9.0;
  return p + vec2(wx, wz);
}
float gerstnerHeightVert(vec2 xz, float t) {
  vec2 wxz = gerstnerDomainWarp(xz, t);
  float h = 0.0;
  h += 0.448603 * sin(0.149600 * dot(vec2(0.957826, 0.287348), wxz) - 1.900000 * t);
  h += 0.336999 * sin(0.199142 * dot(vec2(0.758192, 0.652032), wxz) - 1.646785 * t);
  h += 0.253161 * sin(0.265092 * dot(vec2(0.947277, -0.320417), wxz) - 1.427317 * t);
  h += 0.190179 * sin(0.352883 * dot(vec2(0.708455, 0.705756), wxz) - 1.237097 * t);
  h += 0.142866 * sin(0.469747 * dot(vec2(0.983218, 0.182437), wxz) - 1.072228 * t);
  h += 0.107324 * sin(0.625312 * dot(vec2(0.999147, -0.041303), wxz) - 0.929331 * t);
  h += 0.080624 * sin(0.832396 * dot(vec2(0.629256, 0.777198), wxz) - 0.805478 * t);
  h += 0.060566 * sin(1.108060 * dot(vec2(0.966708, -0.255883), wxz) - 0.698131 * t);
  h += 0.045498 * sin(1.475016 * dot(vec2(0.875590, 0.483054), wxz) - 0.605091 * t);
  h += 0.034179 * sin(1.963495 * dot(vec2(0.863805, 0.503827), wxz) - 0.524450 * t);
  return h;
}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>
{
  // Real foam relief — the same wave-reach model the fragment shader's
  // wave-wash color effect uses, but applied here as actual vertex
  // displacement, so the foam reads as a genuine raised, frothy ridge
  // advancing up the beach rather than a flat painted color. Small and
  // purely cosmetic (this GPU-side bump never touches the JS height
  // field player collision actually samples), so there's no physics
  // mismatch to worry about.
  float vWaveH = gerstnerHeightVert(transformed.xz, uTime);
  vWaveHeight = vWaveH; // read by the fragment shader below (caustics/wave-wash) instead of recomputing the same 4-term Gerstner sum a second time per-fragment — at High tier's dense 600-segment mesh, interpolation error across one triangle is negligible, so this is a real saving with no meaningful visual change
  // Normalization range corrected to match the ACTUAL total Gerstner
  // amplitude sum (1.71, after amplitudes were roughly doubled in a
  // prior round to fix an under-detailed ocean) — this literal was
  // still using the OLD sum (0.85/1.7) and had gone stale, silently
  // clamping wave-crest detection incorrectly ever since that change
  // (real wave height can now reach ~1.71, well past what a ±0.85 range
  // assumed). Found while working on caustic brightness, not something
  // that was reported directly — worth knowing this was quietly wrong
  // for a few rounds.
  float vWaveNorm = clamp((vWaveH + 1.7) / 3.4, 0.0, 1.0);
  float vShoreDist = transformed.y - uWaterLevel;
  float vReachHeight = 0.1 + vWaveNorm * 0.5;
  float vFoamZone = 1.0 - smoothstep(0.0, 0.4, abs(vShoreDist - vReachHeight));
  transformed.y += vFoamZone * 0.14;
  // Real wind-blown sand ripple relief — small parallel ripples on sand,
  // per explicit reference photo request ("doesn't appear flat"), later
  // widened to cover underwater sand too ("apply the same to the sand/
  // ground on the ocean floor"). Cosmetic GPU-only displacement, same
  // reasoning as the foam relief just above — doesn't touch the actual
  // collision heightfield physics.js samples, so no gameplay mismatch.
  // Active across the whole depth range up to a plausible "beach ends
  // here" upper cutoff — this project's exact HEIGHT_PALETTE sand/coral
  // boundary lives in terrain.js, not available this session, so that
  // upper bound (~7 units above the waterline) is a reasonable
  // approximation rather than a confirmed match to that palette; worth
  // checking the actual sand extent in-browser.
  float sandRippleZone = 1.0 - smoothstep(5.0, 8.0, vShoreDist);
  if (sandRippleZone > 0.001) {
    vec2 rippleDir = normalize(vec2(1.0, 0.35)); // dominant wind/ripple orientation
    float alongRipple = dot(transformed.xz, rippleDir);
    float acrossRipple = dot(transformed.xz, vec2(-rippleDir.y, rippleDir.x));
    // Meander — a slow, low-frequency perpendicular offset so the
    // ripple LINES aren't perfectly straight, matching how real wind
    // ripples wander rather than rule a perfect grid.
    float meander = sin(acrossRipple * 0.12 + sin(alongRipple * 0.05) * 2.0) * 0.6;
    // Two frequencies — a dominant ripple spacing plus a finer texture
    // riding on top, same "coarse + fine" layering this file already
    // uses for foam/caustics, so the sand doesn't read as one uniform
    // corrugation.
    float rippleShape = sin((alongRipple + meander) * 2.4) * 0.5 + sin((alongRipple + meander) * 5.1 + 1.7) * 0.18;
    transformed.y += rippleShape * 0.032 * sandRippleZone;
  }
}
vCausticWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`)
        .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvCausticWorldNormal = normalize(mat3(modelMatrix) * objectNormal);");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>
uniform float uTime;
uniform float uWaterLevel;
uniform float uDayAmount;
varying vec3 vCausticWorldPos;
varying vec3 vCausticWorldNormal;
varying float vWaveHeight;
vec2 causticHash(vec2 p) {
  float n = sin(dot(p, vec2(41.0, 289.0)));
  return fract(vec2(262144.0, 32768.0) * n);
}
// F1 (nearest feature point) AND F2 (second-nearest) — F2-F1 is near
// zero exactly at the boundary between two cells, which traces thin
// bright interlocking LINES rather than filled blob shapes. That edge
// pattern is what actually reads as a caustic net; F1 alone (used for
// the ocean surface's whitecap foam) reads as clustered dots instead,
// right for foam but wrong for this.
vec2 causticVoronoiF1F2(vec2 p) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float f1 = 8.0, f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 point = causticHash(ip + neighbor);
      float d = length(neighbor + point - fp);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return vec2(f1, f2);
}
// Carries the foam mask from the color_fragment injection below to the
// separate emissivemap_fragment injection further down this same
// shader — declared here (GLSL global scope, valid across the whole
// fragment shader's main()) rather than duplicating the whole foam
// computation a second time at the later injection point.
float gFoamMask = 0.0;`)
        .replace("#include <color_fragment>", `#include <color_fragment>
{
  float upwardFacing = clamp(vCausticWorldNormal.y, 0.0, 1.0);
  // Per explicit "visible caustics" request: this mask is entirely
  // WORLD-POSITION-based (is this sand vertex underwater), never gated by
  // camera position — caustics were already technically present in the
  // refraction render pass, which is what a player looking down through
  // the water surface from ABOVE actually sees (see liquid.js's
  // mix(refractionColor, diffuseColor, vReflectionFresnel), which favors
  // refraction heavily at anything close to a top-down viewing angle).
  // The real gap was that this mask needed real DEPTH before reaching
  // full strength (1.5 units) — most of Coral Shallows' reef is
  // genuinely shallow, so a lot of the most-commonly-viewed-from-above
  // area was never reaching full brightness. Narrowed to reach full
  // strength by 1 unit down, and the upper bound tightened to right at
  // the waterline itself (was +0.5, letting it start slightly ABOVE the
  // real surface).
  float underwaterMask = smoothstep(uWaterLevel, uWaterLevel - 1.0, vCausticWorldPos.y);
  // Real wave height, carried over from the vertex shader's own
  // computation via vWaveHeight (see the varying above) instead of
  // recomputing the same 4-term Gerstner sum again per-fragment — same
  // formula, same phase, as the actual ocean surface mesh either way.
  // This is what ties both the caustic pattern's drift AND its
  // brightness to the real wave motion (speed AND height) instead of
  // two independent things that only coincidentally looked similar.
  float waveH = vWaveHeight;
  float waveNorm = clamp((waveH + 1.7) / 3.4, 0.0, 1.0); // 0 at trough, 1 at crest — range matches the current 10-wave spectrum's exact total amplitude (deliberately kept equal to the prior 4-wave version's tuned total, see liquid.js's GERSTNER_TARGET_AMPLITUDE_SUM)
  // waveH's own multipliers halved (0.18->0.09, 0.12->0.06) — per
  // explicit "lacy caustics" follow-up. waveH's real range roughly
  // doubled when wave amplitude was doubled a few rounds back, so these
  // UV-distortion multipliers were pushing the caustic net's own
  // Voronoi sample roughly twice as far per-fragment as originally
  // tuned, smearing the fine cell-edge lines into something coarser.
  // Halving restores the original relative distortion magnitude.
  vec2 causticUv = vCausticWorldPos.xz * 0.4 + vec2(uTime * 0.05, -uTime * 0.04) + waveH * 0.09;
  vec2 v1 = causticVoronoiF1F2(causticUv);
  float edge1 = v1.y - v1.x;
  vec2 causticUv2 = vCausticWorldPos.xz * 0.4 * 1.6 - vec2(uTime * 0.03, uTime * 0.045) + vec2(37.0, 12.0) - waveH * 0.06;
  vec2 v2 = causticVoronoiF1F2(causticUv2);
  float edge2 = v2.y - v2.x;
  float net = (1.0 - smoothstep(0.0, 0.12, edge1)) * 0.75 + (1.0 - smoothstep(0.0, 0.09, edge2)) * 0.5;
  net = clamp(net, 0.0, 1.0);
  // Real caustic light concentrates more directly under a wave crest
  // (the crest briefly acts as a converging lens) than in a trough —
  // crestFocus brightens the whole pattern there instead of a flat
  // constant intensity everywhere regardless of the wave shape overhead.
  float crestFocus = smoothstep(0.5, 1.0, waveNorm);
  // Day-brightened, warm-toned caustic light — per explicit reference
  // photo request ("bright, sunlight through the surface, gold on the
  // sand"). Two real changes from the previous flat/neutral version:
  // (1) intensity now scales with uDayAmount, STRICTLY zero at night
  // (smoothstep floor, not the earlier 0.15-at-night version) — per
  // explicit "scoped to only during the day" follow-up: real caustics
  // need direct sunlight passing through the surface, genuinely absent
  // at night rather than just dim; (2) color shifted from neutral white
  // toward warm gold (1.0, 0.92, 0.72) instead of vec3(1.0) — sunlight
  // filtered through water and reflecting off sand reads warm/golden in
  // the reference, not a cold white shimmer. underwaterMask right below
  // already strictly scopes this to actually-submerged geometry (fades
  // to 0 above the waterline), so combined with this, caustics are now
  // zero unless BOTH underwater AND daytime.
  float dayCausticBoost = smoothstep(0.05, 0.4, uDayAmount) * 1.5;
  float causticIntensity = net * underwaterMask * upwardFacing * (0.44 + crestFocus * 0.42) * dayCausticBoost; // base boosted 0.32->0.44 for real visible punch through the water surface, not just underwater
  diffuseColor.rgb += vec3(1.0, 0.92, 0.72) * causticIntensity;

  // Shoreline wave-wash — real waves surge up the beach slope and
  // recede, leaving foam at the current edge and darker wet sand behind
  // it. shoreDist is height above (positive) or below (negative) the
  // mean waterline; reachHeight is how far above that mean the CURRENT
  // wave pushes, driven by the same real wave crest/trough (waveNorm)
  // already sampled above — so the wash rhythm matches the actual ocean
  // above instead of an unrelated clock.
  float shoreDist = vCausticWorldPos.y - uWaterLevel;
  float reachHeight = 0.1 + waveNorm * 0.5; // was 0.15 + waveNorm*0.9 (up to 1.05 above the waterline) — too far up the beach for a real wave's run-up
  // Edge jitter — a slow, large-scale (NOT time-animated, so it reads
  // as a fixed irregular coastline rather than flickering) Voronoi
  // sample perturbing the effective wash-line height per-fragment, so
  // the foam line itself is organic/wavy rather than tracing a
  // perfectly smooth height contour — real coastlines and wave-wash
  // lines are never that clean.
  vec2 jv = causticVoronoiF1F2(vCausticWorldPos.xz * 0.15);
  float jitteredReach = reachHeight + (jv.x - 0.5) * 0.12;
  // Foam needs real internal structure to read as liquid rather than a
  // glowing strip. A single Voronoi layer at one scale tiles into an
  // evenly-spaced grid of same-size circles — exactly the "disco ball"
  // look this had. Two overlapping octaves at different scale/drift
  // (mirroring the ocean surface's own whitecap foam technique in
  // liquid.js) breaks that regularity into overlapping bubble clusters
  // of varying size instead, and at a much smaller/finer scale than the
  // first attempt.
  vec2 foamUv1 = vCausticWorldPos.xz * 3.5 + vec2(uTime * 0.15, uTime * 0.11);
  vec2 foamUv2 = vCausticWorldPos.xz * 9.0 - vec2(uTime * 0.1, uTime * 0.08);
  vec2 fv1 = causticVoronoiF1F2(foamUv1);
  vec2 fv2 = causticVoronoiF1F2(foamUv2);
  float foamCell = (1.0 - smoothstep(0.0, 0.4, fv1.x)) * 0.6 + (1.0 - smoothstep(0.0, 0.32, fv2.x)) * 0.55;
  foamCell = clamp(foamCell, 0.0, 1.0);
  // Core wash line — NARROW band (was a 0.4 half-width wash reading as
  // a broad diffuse cloud, per explicit "should be a thin line like the
  // reference photo, not a wide wash" report) — this is what actually
  // gives a crisp, well-defined line right at the water's edge instead
  // of a soft blur.
  float coreZone = 1.0 - smoothstep(0.0, 0.1, abs(shoreDist - jitteredReach));
  float coreFoam = clamp(foamCell * coreZone, 0.0, 1.0);
  // Lacy tendrils — RE-ADDED per explicit follow-up (user liked the
  // underwater caustic net's lacy look and wants the same character on
  // the shore too). Thin BRANCHING LINES — the exact same Voronoi cell-
  // EDGE technique the caustic net above already uses (F2-F1 traces
  // thin lines along cell boundaries, not filled circles) — reaching a
  // bit further up the beach past the core line and fading out with
  // distance, rather than a hard-edged band.
  vec2 tendrilUv = vCausticWorldPos.xz * 2.2 + vec2(uTime * 0.06, uTime * 0.045);
  vec2 tv = causticVoronoiF1F2(tendrilUv);
  float tendrilLines = 1.0 - smoothstep(0.0, 0.06, tv.y - tv.x);
  float tendrilReach = 0.35; // how far past the core line tendrils can extend, same height units as shoreDist
  float beyondLine = max(0.0, shoreDist - jitteredReach); // only extends OUTWARD/up the beach, never back into the water
  float tendrilFalloff = 1.0 - smoothstep(0.0, tendrilReach, beyondLine);
  float tendrilFoam = clamp(tendrilLines * tendrilFalloff * step(beyondLine, tendrilReach), 0.0, 1.0);
  float foamMask = clamp(max(coreFoam, tendrilFoam * 0.85) * upwardFacing, 0.0, 1.0);
  gFoamMask = foamMask; // read by the emissivemap_fragment injection below, so foam stays visible even under night's dim lighting
  // Real sand right at the water's edge is ALWAYS wet — a permanent,
  // always-on dark band centered right at the mean waterline, not
  // dependent on the current wave's reach at all. Combined with the
  // dynamic, wave-driven wetMask below via max: the permanent band sets
  // a floor that's always present, and an active wave crest can push
  // the wet area further up the beach on top of it.
  float permanentWetBand = 1.0 - smoothstep(0.0, 0.55, abs(shoreDist - 0.1));
  // True per-pixel memory of "recently wet" would need an accumulation
  // buffer this project doesn't have (nothing here persists between
  // frames) — approximated instead with a slow-power envelope of the
  // same wave signal, so sand still reads as wet for a while after a
  // crest recedes rather than snapping back to dry the instant the foam
  // line passes.
  float wetEnvelope = pow(waveNorm, 0.4);
  float wetMask = (1.0 - smoothstep(reachHeight - 0.3, reachHeight + 0.5, shoreDist)) * wetEnvelope * upwardFacing;
  float totalWetMask = clamp(max(permanentWetBand * 0.75 * upwardFacing, wetMask), 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55, totalWetMask);
  // Mixed toward an off-white (not pure additive brightening, and not
  // pure white either) — this respects the scene's actual lighting
  // instead of blowing out brighter than everything around it, the same
  // technique the ocean surface's own whitecap foam already uses. This
  // alone isn't enough to stay visible at night (diffuseColor still gets
  // multiplied down by the scene's own dim night lighting afterward) —
  // the emissivemap_fragment injection below adds real glow on top of
  // this for that.
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.98, 1.0), foamMask * 0.85);
}`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
// Real foam is bright and highly light-scattering — it should stay
// clearly visible even under night's heavily dimmed sun/ambient light,
// which a pure diffuseColor tint (multiplied by whatever light actually
// reaches it) can't guarantee on its own. Adding directly to
// totalEmissiveRadiance makes it glow independent of scene lighting,
// the same way this project's other glowing elements (crystals,
// bioluminescent flora) already stay visible at night.
totalEmissiveRadiance += vec3(0.85, 0.95, 1.0) * gFoamMask * 0.9;`);
      terrainMat.userData.shader = shader; // so the animate loop can push uTime each frame
    };
  }
  terrainMesh = new THREE.Mesh(buildPlanetTerrain(level, WORLD_SEED), terrainMat);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true; // the terrain's own elevation (spires, ridges) can shadow other parts of itself
  scene.add(terrainMesh);

  if (LIQUID_LEVEL[level.biome] !== undefined) {
    // Crystal's water plane is sized much larger than the landmass
    // itself (2000, not TERRAIN_SIZE's 240) — per explicit "remove the
    // skirt completely and merge the near Gerstner waves with the far
    // ones" request, this used to be two separate planes (a detailed
    // near plane + a much larger, separate background "skirt" with its
    // own wave spectrum); now it's ONE plane covering both roles, with
    // BOTH wave spectra merged into liquid.js's own single GERSTNER_WAVES
    // (see its own comment there). Other biomes' small rivers/lava keep
    // their original TERRAIN_SIZE footprint — they were never meant to
    // extend to any horizon.
    // REAL TRADE-OFF, not fully mitigated: the vertex segment count
    // (getGraphicsSettings().liquidSegments, in graphicsSettings.js —
    // not available to edit this session) is unchanged, so the SAME
    // vertex budget that used to cover a 240-unit near plane now spans
    // 2000 units — near-shore triangles are measurably coarser than
    // before. Bumping liquidSegments up (in graphicsSettings.js) would
    // restore the old near-shore density if this reads too blocky
    // up close.
    const waterPlaneSize = level.biome === "crystal" ? 2000 : TERRAIN_SIZE;
    liquidHandle = createLiquidPlane(scene, level.biome, LIQUID_LEVEL[level.biome], waterPlaneSize, (x, z) => terrainHeightAt(level, x, z, WORLD_SEED));
  }

  if (level.biome === "crystal") {
    oceanSurfaceDetailHandle = createOceanSurfaceDetail(scene, LIQUID_LEVEL.crystal, TERRAIN_SIZE);

    // Real GLB models (models.js) — per explicit request, replacing
    // nothing that currently exists (dry-land decorations here were
    // deliberately emptied out a while back, see FU162) but adding
    // genuinely new content. Both loads are fire-and-forget async work
    // kicked off here and resolving whenever the browser finishes
    // fetching/parsing the model — NOT verified in-browser, this is the
    // first real external-asset loading in the project (everything else
    // is procedural). `spawnLevelIdx` guards against the player
    // switching away from this level before the load finishes — the
    // callback bails rather than adding trees/fish into whatever biome
    // is showing by the time it resolves.
    const spawnLevelIdx = levelIdx;
    loadPalmTreeModel().then(() => {
      if (currentLevelIdx !== spawnLevelIdx) return; // player already left this level — don't spawn into whatever's showing now
      const PALM_COUNT = 5;
      const palmSeed = hashStringToSeed(WORLD_SEED + "::realPalms");
      const rng = mulberry32(palmSeed);
      for (let i = 0; i < PALM_COUNT; i++) {
        const angle = rng() * Math.PI * 2;
        const dist = 8 + rng() * 14; // scattered around the landmark clearing, same rough footprint the old hardcoded palm spots used before FU162 removed them
        const x = LANDMARK_POSITION.x + Math.cos(angle) * dist;
        const z = LANDMARK_POSITION.z + Math.sin(angle) * dist;
        // Per "some trees appear to be floating": terrainHeightAt is the
        // pure ANALYTIC height function, which includes the fine sand-
        // ripple detail (terrain.js, ~0.8-unit wavelength) added a while
        // back — at Medium tier's segment spacing (TERRAIN_SIZE/segments
        // β‰ˆ0.8 units too), the RENDERED mesh can't fully resolve ripple
        // that fine, so the coarse triangulated surface at a given (x,z)
        // can sit measurably below/above what the smooth analytic
        // function returns for that exact point. A tree placed via the
        // analytic height could end up floating above (or sunk into)
        // what's actually visible. sampleGroundHeight raycasts the REAL
        // rendered terrainMesh instead — the exact same function the
        // player's own feet rest on — guaranteeing the tree base sits
        // precisely on the visible ground regardless of any analytic-vs-
        // mesh resolution mismatch.
        const y = sampleGroundHeight(x, z, terrainMesh);
        if (y === null || y < LIQUID_LEVEL.crystal + 0.5) continue; // stay on dry land, clear of the shoreline
        const tree = createRealPalmTree();
        if (!tree) continue;
        // Corrective scale, not decorative variety — this model's raw
        // geometry (the "Palm_2_Lit_0" mesh specifically, see models.js)
        // measures ~100 units tall as exported, verified directly against
        // its accessor bounds. Without this, the previous 0.8-1.3
        // "variety" multiplier left it roughly 100 units tall — a tree
        // 60x taller than the player, almost certainly the real reason
        // it didn't look right even though something was visibly
        // rendering. Target ~10-14 units (a tall but real-world-plausible
        // palm, player eye height is 1.6).
        // Bumped up further per direct "trees loaded tiny" feedback —
        // the 0.10-0.14 range was a correct proportional match to the
        // measured raw geometry, but read as too short/stubby in
        // practice; going taller/lusher rather than strictly
        // real-world-accurate.
        // Bumped again per direct "a little too small" follow-up (was
        // 0.16-0.22, targeting ~16-22 units) — going taller/lusher still,
        // not strictly real-world-accurate.
        const scale = 0.21 + rng() * 0.07;
        // REAL BUG FIX, per "some trees appear to be floating": this
        // mesh's local geometry is CENTERED on its own origin (Y spans
        // -50 to +50, verified directly against the raw glTF accessor
        // bounds), not based at the trunk's foot the way most placed
        // props are. Setting the group's own position.y directly to the
        // ground height (as before) put the mesh's MIDPOINT at ground
        // level — burying the bottom half and leaving the visible base
        // floating above the sand by 50*scale, a DIFFERENT amount for
        // every tree since scale is randomized per instance — exactly
        // matching "some trees float, inconsistently, others don't."
        // Offsetting up by 50*scale moves the mesh's true bottom (local
        // Y=-50) down to exactly the sampled ground height instead.
        // REVERTED per direct "now ALL the trees are floating" report —
        // the +50*scale offset below was based on an assumption (local
        // Y=-50 is the trunk base, Y=+50 is the crown) that I could only
        // infer from a raw numeric range, not confirm. If that assumption
        // was backwards, the offset would push every tree further in the
        // WRONG direction — turning an inconsistent "some trees float a
        // little" into a uniform "all trees float a lot," which matches
        // what was reported. Reverting to the plain ground-height
        // placement (the state that was confirmed reasonably working
        // in-browser back in FU184) rather than guessing the sign a third
        // time blind.
        tree.position.set(x, y, z);
        tree.rotation.y = rng() * Math.PI * 2;
        tree.scale.setScalar(scale);
        scene.add(tree);
        realPalmTrees.push(tree);
      }
    }).catch(() => {}); // load failure already logged inside models.js — nothing further to do here

    loadAngelfishModel().then(() => {
      if (currentLevelIdx !== spawnLevelIdx) return;
      const FISH_COUNT = 16; // was 8 — bumped since the area they're spread across is now much larger, 8 would read as sparse/empty
      const MAX_ATTEMPTS = 60;
      const fishSeed = hashStringToSeed(WORLD_SEED + "::realFish");
      const rng = mulberry32(fishSeed);
      let placed = 0;
      for (let i = 0; i < MAX_ATTEMPTS && placed < FISH_COUNT; i++) {
        // Per explicit "should be all over the sea floor" (coral, but
        // applies equally here) — was landmark-relative (8-35 units from
        // LANDMARK_POSITION, which itself sits ~89 units from world
        // origin), clustering everything into one small patch of a much
        // larger reachable seafloor. Centered on world origin now,
        // spanning the real playable radius directly, so fish can turn
        // up anywhere the player actually swims instead of only right
        // next to the landmark.
        const angle = rng() * Math.PI * 2;
        const dist = rng() * (WORLD_BOUND_RADIUS - 8);
        const x = Math.cos(angle) * dist;
        const z = Math.sin(angle) * dist;
        // Real playable radius check — still needed even centered at
        // origin now, since dist alone doesn't already guarantee this
        // (kept for clarity/defense even though it's now redundant with
        // the dist formula above).
        if (Math.hypot(x, z) > WORLD_BOUND_RADIUS - 8) continue;
        const groundY = terrainHeightAt(level, x, z, WORLD_SEED);
        if (groundY === null || groundY > LIQUID_LEVEL.crystal - 1.5) continue; // needs real water depth above it, not a shallow puddle right at the seafloor
        const depth = Math.min(LIQUID_LEVEL.crystal - groundY - 0.8, 1 + rng() * 3.5);
        const fish = createRealAngelfish();
        if (!fish) continue;
        fish.group.position.set(x, LIQUID_LEVEL.crystal - depth, z);
        fish.group.rotation.y = rng() * Math.PI * 2;
        // Corrective scale, not decorative variety — this model's raw
        // geometry measures ~20 units long as exported (verified against
        // its accessor bounds: mesh[0] Z spans -10.14 to 10.14). The
        // previous 0.6-0.9 "variety" multiplier left it roughly
        // 12-18 units long — a MASSIVE fish, ~10x a real emperor
        // angelfish relative to the player's 1.6-unit eye height, almost
        // certainly why it wasn't recognizable as "a fish" even if
        // something was technically rendering (the camera would likely
        // end up inside or pressed right up against one small part of
        // its body). Target ~0.35-0.5 units, a small reef fish visible
        // at a reasonable distance without being unrealistically large.
        const scale = 0.018 + rng() * 0.007;
        fish.group.scale.setScalar(scale);
        // Simple wander path, independent of the skeletal swim animation
        // (which only animates the body/fins in place) — a slow circular
        // drift so the fish actually moves through the reef rather than
        // hovering on one spot. Center/radius/phase are baked onto the
        // instance itself so updateRealFish (animate loop) has everything
        // it needs without a parallel lookup array.
        fish.wanderCenterX = x; fish.wanderCenterZ = z;
        fish.wanderRadius = 3 + rng() * 5;
        fish.wanderSpeed = 0.15 + rng() * 0.15;
        fish.wanderPhase = rng() * Math.PI * 2;
        fish.wanderY = LIQUID_LEVEL.crystal - depth;
        scene.add(fish.group);
        realFish.push(fish);
        placed++;
      }
      // Diagnostic — per repeated "still no fish" with no new evidence to
      // narrow down why: this makes the NEXT console check conclusive
      // rather than another guess. If placed is 0, the spawn loop itself
      // is still rejecting every candidate (a real remaining bug worth
      // digging into further). If placed > 0, spawning is working and the
      // issue is something else — visibility/lighting/distance from
      // wherever the player actually is when they look.
      console.log(`[models] real fish placed: ${placed}/${FISH_COUNT}`, placed > 0 ? realFish.map((f) => f.group.position.toArray().map((n) => n.toFixed(1))) : "(none placed)");
    }).catch(() => {});

    // Real reef structures — per explicit "import this model into the
    // ocean as part of the ocean floor, could add copies and connect
    // them to make it look realistic." Unlike the palm tree/fish, this
    // source file's own bounds checked out as genuine (non-cubic, non-
    // suspicious) geometry — see models.js's own comment — so the whole
    // loaded scene is cloned wholesale, no cherry-picking needed.
    // Several CLUSTERS (not one scattered pool like the fish) — each
    // cluster's pieces sit close enough to overlap/touch their
    // neighbors, which is what actually reads as "a connected reef
    // system" rather than isolated identical props dotted around.
    loadReefModel().then(() => {
      if (currentLevelIdx !== spawnLevelIdx) return;
      const CLUSTER_COUNT = 3;
      const PIECES_PER_CLUSTER = 5;
      const reefSeed = hashStringToSeed(WORLD_SEED + "::realReef");
      const rng = mulberry32(reefSeed);
      let placed = 0;
      for (let c = 0; c < CLUSTER_COUNT; c++) {
        // Cluster centers scattered independently of the landmark/fish —
        // real reefs don't cluster only right next to the one landmark
        // structure — but still real underwater points, same boundary/
        // depth checks as fish placement.
        let centerX, centerZ, centerFound = false;
        for (let attempt = 0; attempt < 20 && !centerFound; attempt++) {
          const angle = rng() * Math.PI * 2;
          const dist = 15 + rng() * 85;
          const cx = LANDMARK_POSITION.x + Math.cos(angle) * dist;
          const cz = LANDMARK_POSITION.z + Math.sin(angle) * dist;
          if (Math.hypot(cx, cz) > WORLD_BOUND_RADIUS - 10) continue;
          const cGroundY = terrainHeightAt(level, cx, cz, WORLD_SEED);
          if (cGroundY === null || cGroundY > LIQUID_LEVEL.crystal - 2) continue; // needs real depth for a whole cluster, not just a shallow puddle
          centerX = cx; centerZ = cz; centerFound = true;
        }
        if (!centerFound) continue;
        for (let p = 0; p < PIECES_PER_CLUSTER; p++) {
          // Small offset from the cluster center — deliberately smaller
          // than the model's own ~10-unit footprint so adjacent pieces
          // genuinely overlap/touch rather than sitting as clearly
          // separate objects that just happen to be nearby.
          const ox = (rng() - 0.5) * 9;
          const oz = (rng() - 0.5) * 9;
          const x = centerX + ox, z = centerZ + oz;
          if (Math.hypot(x, z) > WORLD_BOUND_RADIUS - 8) continue;
          const groundY = terrainHeightAt(level, x, z, WORLD_SEED);
          if (groundY === null || groundY > LIQUID_LEVEL.crystal - 1) continue;
          const reef = createRealReef();
          if (!reef) continue;
          const scale = 0.8 + rng() * 0.5;
          // Origin sits roughly mid-height in the source geometry (Y
          // spans -5.36 to +4.81, not based at the bottom) — for a reef
          // structure resting ON the seafloor, partial embedding into the
          // sand reads as natural (real reefs grow out of the substrate,
          // they don't perch cleanly on top of it the way a tree needs
          // to), so this doesn't need the same precise base-alignment
          // fix the palm tree required — just a modest upward lift so it
          // isn't buried too deep.
          reef.position.set(x, groundY + 1.4 * scale, z);
          reef.rotation.y = rng() * Math.PI * 2;
          reef.scale.setScalar(scale);
          scene.add(reef);
          realReefStructures.push(reef);
          placed++;
        }
      }
      console.log(`[models] real reef pieces placed: ${placed}/${CLUSTER_COUNT * PIECES_PER_CLUSTER}`);
    }).catch(() => {});

    // Real coral pieces — 3 species, scattered individually (not
    // clustered like the reef structures) across the same underwater
    // area, to complement the reef rather than duplicate its "connected
    // structure" look. Per-species scale ranges below are DERIVED from
    // each file's own measured raw bounds (see models.js's own comment —
    // these are genuinely tiny, true-real-world-scale exports, not a
    // broken unit export like the palm tree/fish were), targeting a
    // roughly similar FINAL decorative size (~0.3-0.65 units) across all
    // three despite their differing raw sizes.
    const CORAL_SPECIES = ["stylaster", "pocillopora", "goniastrea"];
    const CORAL_SCALE_RANGE = {
      // Roughly doubled from the previous pass per "is it really small
      // or invisible" — even the earlier ~0.3-0.65 unit final size (a
      // real, plausible coral-head size) could genuinely be hard to spot
      // against a large, dark, busy-textured seafloor from normal
      // swimming distance. Larger mature coral colonies real-world are
      // very plausibly this size too, so this isn't unrealistic, just
      // biased toward "actually visible" over "textbook-accurate small."
      stylaster: [5.5, 7.5],    // raw ~0.17 tall -> ~0.94-1.28 final
      pocillopora: [3.8, 5.2],  // raw ~0.24 wide -> ~0.91-1.24 final
      goniastrea: [6.5, 9.0],   // raw ~0.09 wide -> ~0.59-0.82 final
    };
    Promise.all(CORAL_SPECIES.map((s) => loadCoralModel(s))).then(() => {
      if (currentLevelIdx !== spawnLevelIdx) return;
      // Was a fixed-24-attempt loop — now that spawn points scatter
      // across the WHOLE map (including the dry island itself, which
      // fails the depth check every time), a fixed attempt count would
      // silently place well under the target. Retry-until-reached
      // instead, same pattern fish already uses, per explicit "should be
      // more than just one."
      const CORAL_COUNT = 70;
      const CORAL_MAX_ATTEMPTS = 260;
      const coralSeed = hashStringToSeed(WORLD_SEED + "::realCoral");
      const rng = mulberry32(coralSeed);
      let placed = 0;
      for (let i = 0; i < CORAL_MAX_ATTEMPTS && placed < CORAL_COUNT; i++) {
        // Per explicit "should be all over the sea floor" (revising the
        // previous "near the shore" narrowing — that request and this
        // one turned out to be in tension, and this is the more recent,
        // more specific one) — centered on world origin now, spanning
        // the real playable radius directly, same reasoning as fish just
        // above: landmark-relative placement was clustering everything
        // into one small patch of a much larger reachable seafloor.
        const angle = rng() * Math.PI * 2;
        const dist = rng() * (WORLD_BOUND_RADIUS - 8);
        const x = Math.cos(angle) * dist;
        const z = Math.sin(angle) * dist;
        if (Math.hypot(x, z) > WORLD_BOUND_RADIUS - 8) continue;
        const groundY = terrainHeightAt(level, x, z, WORLD_SEED);
        if (groundY === null || groundY > LIQUID_LEVEL.crystal - 0.3) continue; // still allows genuinely shallow, near-waterline placement, just no longer confined to right off the beach specifically
        const species = CORAL_SPECIES[Math.floor(rng() * CORAL_SPECIES.length)];
        const coral = createRealCoral(species);
        if (!coral) continue;
        const [scaleMin, scaleMax] = CORAL_SCALE_RANGE[species];
        const scale = scaleMin + rng() * (scaleMax - scaleMin);
        // Center-origin geometry (verified against raw accessor Y
        // bounds), same as the reef — partial embedding into the sand
        // reads as natural for something growing out of the substrate,
        // same reasoning the reef used, so just a modest lift rather
        // than a precise base-alignment fix.
        coral.position.set(x, groundY + 0.15 * scale, z);
        coral.rotation.y = rng() * Math.PI * 2;
        coral.scale.setScalar(scale);
        scene.add(coral);
        realCoralPieces.push(coral);
        placed++;
      }
      console.log(`[models] real coral pieces placed: ${placed}/${CORAL_COUNT}`);
    }).catch(() => {});
  }

  if (level.biome === "verdant") {
    // Replicates terrain.js's own riverCenterX formula exactly (same
    // seed derivation as buildPlanetTerrain) rather than guessing a
    // fixed X, so the waterfall lines up with the actual carved river
    // regardless of where its winding path happens to be at this
    // specific Z.
    const terrainSeed = hashStringToSeed(WORLD_SEED + "::" + level.biome) * 1000;
    const waterfallX = Math.sin(WATERFALL_Z * 0.035 + terrainSeed * 0.01) * 28 + Math.sin(WATERFALL_Z * 0.013 + terrainSeed * 0.02) * 14;
    const topY = terrainHeightAt(level, waterfallX, WATERFALL_Z - 4, WORLD_SEED); // just upstream — elevated source side, right at the top of the now-tight 4-unit ramp
    const bottomY = terrainHeightAt(level, waterfallX, WATERFALL_Z + 2, WORLD_SEED); // just downstream — river floor side
    waterfallHandle = createWaterfall(scene, topY, bottomY, waterfallX, WATERFALL_Z, RIVER_WIDTH * 1.3);
    riverCurrentHandle = createRiverCurrent(scene, terrainSeed, LIQUID_LEVEL.verdant, WATERFALL_Z, WORLD_BOUND_RADIUS * 0.95, 110);
    riverFlowStripHandle = createRiverFlowStrip(scene, terrainSeed, LIQUID_LEVEL.verdant, WATERFALL_Z, WORLD_BOUND_RADIUS * 0.95, RIVER_WIDTH * 1.3, 40);

    // The pond feeding the waterfall from above — same riverCenterX
    // formula as the waterfall/river, just evaluated at POND_Z, so it
    // sits along the same projected upstream path. Sized to 0.35 *
    // POND_RADIUS (not 0.5) because createSourcePond's plane is SQUARE —
    // its corners reach radius*sqrt(2), and terrain.js's guarantee only
    // covers out to 0.55*POND_RADIUS, so 0.35 leaves real margin rather
    // than sitting right at the edge of the guarantee.
    const pondX = Math.sin(POND_Z * 0.035 + terrainSeed * 0.01) * 28 + Math.sin(POND_Z * 0.013 + terrainSeed * 0.02) * 14;
    sourcePondHandle = createSourcePond(scene, pondX, POND_Z, POND_LEVEL, POND_RADIUS * 0.35);

    // Craggy rocks scattered around the cliff, plus a cave mouth tucked
    // behind the falls — reuses the existing rock-cluster/cave-mouth
    // decoration builders directly (own deterministic PRNG stream) rather
    // than a new one-off system, and folds into the same
    // decorationHandles array everything else here already uses for
    // cleanup, rather than tracking a separate handle list.
    const cliffRand = mulberry32(hashStringToSeed(WORLD_SEED + "-waterfall-cliff-" + level.biome));
    cliffWallHandle = createCliffWall(scene, topY, bottomY, waterfallX, WATERFALL_Z, WORLD_BOUND_RADIUS * 1.5, cliffRand); // spans the WHOLE hillside now, not just a narrow strip around the falls — user clarified they meant the entire hill
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI + cliffRand() * Math.PI; // restricted to the northern semicircle (behind/beside the falls) — a full 360° spread could place a rock directly south, in the player's sightline toward the water
      const dist = 3 + cliffRand() * 8;
      const rx = waterfallX + Math.cos(angle) * dist;
      const rz = WATERFALL_Z + Math.sin(angle) * dist;
      const ry = terrainHeightAt(level, rx, rz, WORLD_SEED) ?? 0;
      const rockHandle = createRockCluster(level.biome, level.color, cliffRand);
      rockHandle.group.position.set(rx, ry, rz);
      rockHandle.group.rotation.y = cliffRand() * Math.PI * 2;
      rockHandle.group.scale.setScalar(1.3 + cliffRand() * 0.8); // bigger than typical scattered rocks — craggy cliff formations, not small decorative ones
      rockHandle.group.traverse((obj) => { if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; } });
      scene.add(rockHandle.group);
      decorationHandles.push(rockHandle);
    }
    const caveHandle = createCaveMouth(0x2a5c3a, cliffRand, "verdant"); // a mossy green-tinted glow instead of the purple this function otherwise defaults to for its color parameter, to fit Verdant
    // No extra scale applied — the rebuilt cave (real wall blocks +
    // recessed interior) is already sized appropriately in its own
    // dimensions; the old 1.8x multiplier here was tuned for the
    // previous, much smaller single-rock version and would now
    // compound into an oversized structure.
    caveHandle.group.position.set(waterfallX, bottomY, WATERFALL_Z - 1.5); // recessed slightly upstream of the falls' own Z, so it reads as behind the falling water; the mouth's default +Z-facing opening already points toward the player approaching from downstream, no extra rotation needed
    caveHandle.group.traverse((obj) => { if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; } });
    scene.add(caveHandle.group);
    decorationHandles.push(caveHandle);
  }

  if (level.biome === "frost") {
    // Scatters ice spikes (stalagmites/icicles) along the winding
    // tunnel's actual floor — general random decoration placement
    // wouldn't reliably land inside this narrow carved corridor, so this
    // walks the SAME centerline formula terrain.js's frost shaper
    // carves (identical seed derivation to every other terrain-aligned
    // placement in this file), sampling the real rendered terrain height
    // at each point rather than duplicating the noise math.
    const tunnelSeed = hashStringToSeed(WORLD_SEED + "::" + level.biome) * 1000;
    const tunnelRand = mulberry32(hashStringToSeed(WORLD_SEED + "-frost-tunnel-" + level.biome));
    const stepCount = 40;
    for (let i = 0; i < stepCount; i++) {
      const tz = -100 + (i / (stepCount - 1)) * 200; // walks the tunnel's length across most of the playable map
      if (tunnelRand() < 0.4) continue; // not every step gets a spike — avoids a mechanically evenly-spaced row
      const tx = Math.sin(tz * 0.028 + tunnelSeed * 0.021) * 26 + Math.sin(tz * 0.011 + tunnelSeed * 0.037) * 14;
      const sx = tx + (tunnelRand() - 0.5) * 3; // scattered slightly off-center, not a perfectly straight line down the middle
      const groundY = terrainHeightAt(level, sx, tz, WORLD_SEED) ?? 0;
      const spikeMat = new THREE.MeshStandardMaterial({ color: 0xcfe8f2, roughness: 0.15, metalness: 0.15, flatShading: true });
      const sh = 1.2 + tunnelRand() * 2.2, sr = 0.2 + tunnelRand() * 0.25;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(sr, sh, 6), spikeMat);
      spike.position.set(sx, groundY + sh / 2, tz);
      spike.rotation.y = tunnelRand() * Math.PI * 2;
      spike.castShadow = true;
      spike.receiveShadow = true;
      scene.add(spike);
      decorationHandles.push({ group: spike, kind: "rockCluster" }); // reuses the existing static-prop update kind — no animation needed, same convention as fallen logs
    }

    // Roof arches over SOME sections of the canyon, alternating with open
    // stretches — this is what actually makes it feel like a cave system
    // rather than an open trench the whole way. Deliberately kept as pure
    // decoration (zero collision, exactly like every other prop in this
    // game) rather than anything touching physics.js: sampleGroundHeight
    // always resolves to the HIGHEST raycast hit at a given XZ, so a
    // COLLIDABLE roof would make the player stand ON TOP of it rather
    // than walk underneath it — the opposite of what a roof needs. Since
    // decorations already have no collision at all, building the roof as
    // one is the correct mechanism here, not a limitation-driven
    // workaround. The player's footing stays governed entirely by the
    // canyon floor already carved into the terrain.
    const roofRand = mulberry32(hashStringToSeed(WORLD_SEED + "-frost-tunnel-roof-" + level.biome));
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a5a68, roughness: 0.3, metalness: 0.1, flatShading: true });
    const roofSections = 16;
    for (let i = 0; i < roofSections; i++) {
      if (roofRand() < 0.5) continue; // roughly half the candidate spots get a roof — alternating open/covered along the tunnel's length
      const rz = -95 + (i / (roofSections - 1)) * 190;
      const rx = Math.sin(rz * 0.028 + tunnelSeed * 0.021) * 26 + Math.sin(rz * 0.011 + tunnelSeed * 0.037) * 14;
      // Sample the ACTUAL rendered wall-top height on both sides of the
      // canyon at this point (not a guessed constant), so the arch
      // always sits correctly above the real terrain regardless of the
      // surrounding hill noise.
      const leftWallTop = terrainHeightAt(level, rx - 6, rz, WORLD_SEED) ?? 0;
      const rightWallTop = terrainHeightAt(level, rx + 6, rz, WORLD_SEED) ?? 0;
      const roofY = Math.max(leftWallTop, rightWallTop) + 1.2;
      // Oriented along the canyon's own local tangent (same technique
      // used for the river's flow-strip/cliff-wall segments elsewhere in
      // this file), so the slab follows the winding path instead of
      // sitting at a fixed world angle regardless of the curve underneath it.
      const aheadZ = rz + 6;
      const aheadX = Math.sin(aheadZ * 0.028 + tunnelSeed * 0.021) * 26 + Math.sin(aheadZ * 0.011 + tunnelSeed * 0.037) * 14;
      const angle = Math.atan2(aheadX - rx, aheadZ - rz);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(9, 1.6, 9 + roofRand() * 4), roofMat); // width narrowed from 12 to 9 — was wider than the canyon's own 10-unit carved trench (TUNNEL_HALF_WIDTH*2), the same "decoration wider than the carved area" bug just found and fixed in the underground room
      slab.position.set(rx, roofY, rz);
      slab.rotation.y = angle;
      slab.castShadow = true;
      slab.receiveShadow = true;
      scene.add(slab);
      decorationHandles.push({ group: slab, kind: "rockCluster" });
    }

    // A genuinely SEPARATE underground room, reached via the entrance
    // ramp carved into the terrain above (see terrain.js's comment on
    // RAMP_CENTER_X/etc. for the full design). Only the FLOOR is
    // collidable — tracked in caveFloorMeshes, passed into
    // updatePlayerPhysics as extraMeshes below — everything else here
    // (walls, ceiling, interior spikes) is ordinary non-collidable
    // decoration, exactly like every other prop in this game. The front
    // side facing the ramp is deliberately left without a wall, matching
    // where the player actually walks in.
    //
    // Materials use real vertex-color gradients (dark shadowed base
    // rising to a genuinely EMISSIVE teal glow near the top) rather than
    // flat single colors, plus a warm amber accent light alongside the
    // cool teal one — matching a reference image of a glowing ice
    // cavern rather than the flat painted-on look flat colors gave it
    // before.
    const roomWidth = ROOM_WIDTH, roomLength = ROOM_LENGTH; // aliased to the shared constants imported from terrain.js (which now also carves a matching roof-cover over this exact footprint) rather than local literals, so the two can never drift out of sync
    const roomCenterZ = RAMP_CENTER_Z + RAMP_LENGTH + roomLength / 2;
    const roomFloorGeo = new THREE.PlaneGeometry(roomWidth, roomLength + 4); // slightly longer than the room itself so it overlaps into the ramp's own end, avoiding any gap right at the seam
    roomFloorGeo.rotateX(-Math.PI / 2);
    const roomFloorMat = new THREE.MeshStandardMaterial({ color: 0x0c1a22, roughness: 0.85, metalness: 0.1, emissive: 0x0a2a30, emissiveIntensity: 0.3, flatShading: true });
    const roomFloor = new THREE.Mesh(roomFloorGeo, roomFloorMat);
    roomFloor.position.set(RAMP_CENTER_X, ROOM_FLOOR_Y, roomCenterZ);
    roomFloor.receiveShadow = true;
    scene.add(roomFloor);
    caveFloorMeshes.push(roomFloor);

    const roomHeight = 9;
    // Shared gradient geometry technique for every wall panel — dark near
    // the floor (shadowed, matching the reference's deep black lower
    // cave), rising to a bright teal glow near the ceiling. Genuinely
    // emissive, not just a light diffuse color, so the walls actually
    // read as glowing ice rather than painted rock.
    function buildGlowWallMesh(geo) {
      applyVerticalGradient(geo, new THREE.Color(0x050a10), new THREE.Color(0x3ad4c8));
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.15, emissive: 0x2ab8b0, emissiveIntensity: 0.55, flatShading: true });
      return new THREE.Mesh(geo, mat);
    }
    const ceiling = buildGlowWallMesh(new THREE.BoxGeometry(roomWidth + 1, 1.2, roomLength + 1));
    ceiling.position.set(RAMP_CENTER_X, ROOM_FLOOR_Y + roomHeight, roomCenterZ);
    ceiling.castShadow = true;
    scene.add(ceiling);
    decorationHandles.push({ group: ceiling, kind: "rockCluster" });

    const backWall = buildGlowWallMesh(new THREE.BoxGeometry(roomWidth, roomHeight, 1.2));
    backWall.position.set(RAMP_CENTER_X, ROOM_FLOOR_Y + roomHeight / 2, roomCenterZ + roomLength / 2);
    scene.add(backWall);
    decorationHandles.push({ group: backWall, kind: "rockCluster" });

    const leftWall = buildGlowWallMesh(new THREE.BoxGeometry(1.2, roomHeight, roomLength));
    leftWall.position.set(RAMP_CENTER_X - roomWidth / 2, ROOM_FLOOR_Y + roomHeight / 2, roomCenterZ);
    scene.add(leftWall);
    decorationHandles.push({ group: leftWall, kind: "rockCluster" });

    const rightWall = buildGlowWallMesh(new THREE.BoxGeometry(1.2, roomHeight, roomLength));
    rightWall.position.set(RAMP_CENTER_X + roomWidth / 2, ROOM_FLOOR_Y + roomHeight / 2, roomCenterZ);
    scene.add(rightWall);
    decorationHandles.push({ group: rightWall, kind: "rockCluster" });

    // Ice-spike stalagmites on the floor AND hanging icicles from the
    // ceiling — the reference shows a dense, layered mix of both, not
    // just floor spikes. Each spike gets the same dark-to-teal-glow
    // gradient as the walls, so the whole room reads as one continuous
    // glowing material rather than separately-lit props.
    const roomRand = mulberry32(hashStringToSeed(WORLD_SEED + "-frost-room-" + level.biome));
    function buildGlowSpike(sh, sr) {
      const geo = new THREE.ConeGeometry(sr, sh, 6);
      applyVerticalGradient(geo, new THREE.Color(0x0a1a20), new THREE.Color(0x4ae0d0));
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.2, emissive: 0x2ab8b0, emissiveIntensity: 0.6, flatShading: true });
      return new THREE.Mesh(geo, mat);
    }
    for (let i = 0; i < 14; i++) {
      const sx = RAMP_CENTER_X + (roomRand() - 0.5) * (roomWidth - 3);
      const sz = roomCenterZ + (roomRand() - 0.5) * (roomLength - 3);
      const sh = 1.4 + roomRand() * 2.8, sr = 0.22 + roomRand() * 0.3;
      const spike = buildGlowSpike(sh, sr);
      spike.position.set(sx, ROOM_FLOOR_Y + sh / 2, sz);
      spike.rotation.y = roomRand() * Math.PI * 2;
      spike.castShadow = true;
      scene.add(spike);
      decorationHandles.push({ group: spike, kind: "rockCluster" });
      // Roughly half also get a hanging icicle from directly overhead —
      // the reference's most distinctive detail, and previously entirely
      // missing from this room.
      if (roomRand() < 0.5) {
        const ich = 1.2 + roomRand() * 2.2, icr = 0.18 + roomRand() * 0.22;
        const icicle = buildGlowSpike(ich, icr);
        icicle.position.set(sx + (roomRand() - 0.5) * 1.5, ROOM_FLOOR_Y + roomHeight - ich / 2, sz + (roomRand() - 0.5) * 1.5);
        icicle.rotation.x = Math.PI; // points downward, hanging from the ceiling
        icicle.castShadow = true;
        scene.add(icicle);
        decorationHandles.push({ group: icicle, kind: "rockCluster" });
      }
    }

    // Two-tone lighting matching the reference — a cool teal glow (the
    // dominant ice-cavern light) plus a warmer amber accent off to one
    // side, rather than a single flat light source.
    const roomLight = new THREE.PointLight(0x4ae0d0, 0.9, 32);
    roomLight.position.set(RAMP_CENTER_X, ROOM_FLOOR_Y + roomHeight * 0.7, roomCenterZ);
    scene.add(roomLight);
    decorationHandles.push({ group: roomLight, kind: "rockCluster" }); // PointLight has no geometry/material, so the generic disposal traverse is a harmless no-op on it — this just ensures scene.remove happens on teardown

    const roomAmberLight = new THREE.PointLight(0xe8a860, 0.5, 18);
    roomAmberLight.position.set(RAMP_CENTER_X + roomWidth * 0.3, ROOM_FLOOR_Y + 2.5, roomCenterZ - roomLength * 0.25);
    scene.add(roomAmberLight);
    decorationHandles.push({ group: roomAmberLight, kind: "rockCluster" });

    // The connecting branch + second chamber — genuine branching network
    // rather than a single room, per explicit request. Floor is level
    // (ROOM_FLOOR_Y throughout, matching the main room's own floor
    // height) and collidable; walls/ceiling/spikes are ordinary
    // non-collidable decoration, same as everything else here.
    const branchCenterX = BRANCH_START_X + BRANCH_LENGTH / 2;
    const branchFloorGeo = new THREE.PlaneGeometry(BRANCH_LENGTH + 4, BRANCH_HALF_WIDTH * 2);
    branchFloorGeo.rotateX(-Math.PI / 2);
    const branchFloorMat = new THREE.MeshStandardMaterial({ color: 0x0c1a22, roughness: 0.85, metalness: 0.1, emissive: 0x0a2a30, emissiveIntensity: 0.3, flatShading: true });
    const branchFloor = new THREE.Mesh(branchFloorGeo, branchFloorMat);
    branchFloor.position.set(branchCenterX, ROOM_FLOOR_Y, BRANCH_Z);
    branchFloor.receiveShadow = true;
    scene.add(branchFloor);
    caveFloorMeshes.push(branchFloor);

    const branchCeiling = buildGlowWallMesh(new THREE.BoxGeometry(BRANCH_LENGTH + 4, 1.2, BRANCH_HALF_WIDTH * 2 + 1));
    branchCeiling.position.set(branchCenterX, ROOM_FLOOR_Y + roomHeight, BRANCH_Z);
    branchCeiling.castShadow = true;
    scene.add(branchCeiling);
    decorationHandles.push({ group: branchCeiling, kind: "rockCluster" });

    const branchWallNear = buildGlowWallMesh(new THREE.BoxGeometry(BRANCH_LENGTH + 4, roomHeight, 1.2));
    branchWallNear.position.set(branchCenterX, ROOM_FLOOR_Y + roomHeight / 2, BRANCH_Z - BRANCH_HALF_WIDTH);
    scene.add(branchWallNear);
    decorationHandles.push({ group: branchWallNear, kind: "rockCluster" });

    const branchWallFar = buildGlowWallMesh(new THREE.BoxGeometry(BRANCH_LENGTH + 4, roomHeight, 1.2));
    branchWallFar.position.set(branchCenterX, ROOM_FLOOR_Y + roomHeight / 2, BRANCH_Z + BRANCH_HALF_WIDTH);
    scene.add(branchWallFar);
    decorationHandles.push({ group: branchWallFar, kind: "rockCluster" });

    // The second chamber — round rather than rectangular, for genuine
    // shape variety across the network.
    const chamberX = BRANCH_START_X + BRANCH_LENGTH, chamberZ = BRANCH_Z;
    const chamberFloorGeo = new THREE.CircleGeometry(CHAMBER_RADIUS, 20);
    chamberFloorGeo.rotateX(-Math.PI / 2);
    const chamberFloor = new THREE.Mesh(chamberFloorGeo, branchFloorMat);
    chamberFloor.position.set(chamberX, ROOM_FLOOR_Y, chamberZ);
    chamberFloor.receiveShadow = true;
    scene.add(chamberFloor);
    caveFloorMeshes.push(chamberFloor);

    const chamberWallGeo = new THREE.CylinderGeometry(CHAMBER_RADIUS, CHAMBER_RADIUS, roomHeight, 20, 1, true); // open-ended — no top/bottom cap, just the ring wall
    applyVerticalGradient(chamberWallGeo, new THREE.Color(0x050a10), new THREE.Color(0x3ad4c8));
    const chamberWallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.15, emissive: 0x2ab8b0, emissiveIntensity: 0.55, flatShading: true, side: THREE.DoubleSide });
    const chamberWall = new THREE.Mesh(chamberWallGeo, chamberWallMat);
    chamberWall.position.set(chamberX, ROOM_FLOOR_Y + roomHeight / 2, chamberZ);
    scene.add(chamberWall);
    decorationHandles.push({ group: chamberWall, kind: "rockCluster" });

    const chamberCeiling = buildGlowWallMesh(new THREE.CylinderGeometry(CHAMBER_RADIUS + 1, CHAMBER_RADIUS + 1, 1.2, 20));
    chamberCeiling.position.set(chamberX, ROOM_FLOOR_Y + roomHeight, chamberZ);
    chamberCeiling.castShadow = true;
    scene.add(chamberCeiling);
    decorationHandles.push({ group: chamberCeiling, kind: "rockCluster" });

    for (let i = 0; i < 6; i++) {
      const angle = roomRand() * Math.PI * 2, r = roomRand() * (CHAMBER_RADIUS - 2.5);
      const sx = chamberX + Math.cos(angle) * r, sz = chamberZ + Math.sin(angle) * r;
      const sh = 1.4 + roomRand() * 2.8, sr = 0.22 + roomRand() * 0.3;
      const spike = buildGlowSpike(sh, sr);
      spike.position.set(sx, ROOM_FLOOR_Y + sh / 2, sz);
      spike.rotation.y = roomRand() * Math.PI * 2;
      spike.castShadow = true;
      scene.add(spike);
      decorationHandles.push({ group: spike, kind: "rockCluster" });
    }

    const chamberLight = new THREE.PointLight(0xe8a860, 0.7, 26); // warm accent for the second chamber, contrasting with the main room's cooler teal-dominant lighting
    chamberLight.position.set(chamberX, ROOM_FLOOR_Y + roomHeight * 0.6, chamberZ);
    scene.add(chamberLight);
    decorationHandles.push({ group: chamberLight, kind: "rockCluster" });
  }

  atmosphereHandle = createAtmosphericParticles(scene, level.biome);
  grassHandle = createGrass(scene, level.biome, (x, z) => terrainHeightAt(level, x, z, WORLD_SEED), TERRAIN_SIZE * 0.46);
  flowersHandle = createFlowers(scene, level.biome, (x, z) => terrainHeightAt(level, x, z, WORLD_SEED), TERRAIN_SIZE * 0.46);
  footstepGlowHandle = level.biome === "verdant" ? createFootstepGlowSystem(scene, 40) : null;
  weatherHandle = createWeatherSystem(scene, level.biome, LIQUID_LEVEL[level.biome]);
  cloudsHandle = createClouds(scene, level.biome);
  cloudLayerHandle = createCloudLayer(scene);
  horizonHandle = level.biome === "crystal" ? null : createHorizonSilhouettes(scene, level.biome); // Coral Shallows is open ocean now — no distant mountain backdrop, and horizonSilhouettes.js still isn't part of this session so this stays a main.js-only fix rather than touching that file's still-old icy Crystal-Spire theming
  wildlifeHandle = createWildlife(scene, level.biome, (x, z) => terrainHeightAt(level, x, z, WORLD_SEED), LIQUID_LEVEL[level.biome]);
  landmarkHandle = createLandmark(scene, level.biome, level.color, (x, z) => terrainHeightAt(level, x, z, WORLD_SEED));

  const layout = generateLevelLayout(level.biome, WORLD_SEED);

  seedValueEl.textContent = WORLD_SEED;
  levelNameEl.textContent = level.name;

  layout.crystalSeeds.forEach((seed) => {
    const groundY = sampleGroundHeight(seed.x, seed.z, terrainMesh) ?? 0;
    const crystal = { id: seed.id, position: { x: seed.x, y: groundY + 1.1, z: seed.z }, color: level.color };
    allCrystals.push(crystal);
    crystalHandles.set(crystal.id, createCrystalMesh(scene, crystal));
  });

  // Real per-object footprints (actual bounding-box radius, not a guessed
  // constant) for every decoration placed this level — Verdant only. The
  // forest-filler pass below checks every candidate tree/bush against
  // this list before committing to a position, which is what actually
  // guarantees no overlap regardless of how large or small any given
  // tree turns out to be, rather than assuming a fixed "safe" distance.
  const placedFootprints = [];
  function footprintRadiusOf(group) {
    const box = new THREE.Box3().setFromObject(group);
    return Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
  }

  layout.decorationSeeds.forEach((seed) => {
    const groundY = sampleGroundHeight(seed.x, seed.z, terrainMesh) ?? 0;
    const handle = createDecoration(level.biome, level.color, seed.rand, seed.x, seed.z);
    if (!handle) return; // this seed rolled "nothing" — currently only Crystal's open-sand rolls do this
    handle.group.position.set(seed.x, groundY, seed.z);
    handle.group.rotation.y = seed.rand() * Math.PI * 2;
    if (level.biome === "verdant") {
      // Base decorations previously only ever got RECORDED into
      // placedFootprints, never CHECKED against it — meaning two of
      // levels.js's own 60 seeds could overlap each other directly with
      // nothing preventing it, since that loop never had any mutual
      // collision awareness at all (only the forest-filler pass checked
      // against existing placements). This is what was still showing up
      // as overlapping trees even after the filler pass itself became
      // collision-safe.
      const radius = footprintRadiusOf(handle.group);
      const overlaps = placedFootprints.some((f) => Math.hypot(seed.x - f.x, seed.z - f.z) < (radius + f.radius) * 1.25);
      if (overlaps) return; // skip this decoration entirely — forEach's `return` just moves to the next seed
      placedFootprints.push({ x: seed.x, z: seed.z, radius });
    }
    handle.baseY = groundY;
    handle.group.traverse((obj) => {
      if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
    });
    scene.add(handle.group);
    decorationHandles.push(handle);
  });

  // Extra forest fill — Verdant only. worldgen.js's own decoration seeds
  // (the loop above) are sparse enough that the walkable middle of the
  // map reads as open grass with trees only near the edges; this scatters
  // additional trees/bushes across the whole walkable square directly,
  // independent of worldgen's own placement, so density isn't limited by
  // a file this session doesn't have access to. Real size grading gives
  // an actual foreground/midground/background depth cue: bigger near the
  // center (where the player spends most of their time), tapering smaller
  // toward the edge so it blends into horizonSilhouettes.js's distant
  // treeline instead of jumping straight from full-size to backdrop-tiny.
  if (level.biome === "verdant") {
    // Deterministic, like every other placement system in this game —
    // was using raw Math.random() before, which meant the forest layout
    // was different every single page load instead of reproducible from
    // WORLD_SEED the way worldgen.js's own decoration/crystal seeds are.
    const fillerRand = mulberry32(hashStringToSeed(WORLD_SEED + "-forest-filler-" + level.biome));
    const fillerBound = WORLD_BOUND_RADIUS * 0.95;
    const waterLevel = LIQUID_LEVEL[level.biome]; // undefined for biomes without a liquid plane
    const targetCount = 380;
    // A jittered grid, not pure uniform-random sampling — random alone
    // leaves noticeable gaps and clumps purely by chance at this
    // density; one tree/bush per grid cell (nudged by a random offset
    // within it) guarantees genuinely even coverage across the whole
    // forest instead of "mostly dense with big empty patches."
    const gridSize = Math.max(1, Math.round(Math.sqrt(targetCount)));
    const cellSize = (fillerBound * 2) / gridSize;
    // levels.js's own base decorations (layout.decorationSeeds) are a
    // completely separate, uncoordinated placement system — they know
    // nothing about this grid, and this grid knows nothing about them.
    // A fixed "safe distance" can never truly guarantee zero overlap
    // either, since trees vary hugely in actual size (a small sapling vs.
    // a wide spreading tree at max depth-scale) — so instead of a guessed
    // constant, each candidate is built and positioned FIRST, its real
    // bounding-box footprint is measured, and it's only added to the
    // scene if that footprint doesn't overlap anything already placed
    // (base decorations AND earlier filler trees alike). If it would
    // overlap, it's discarded outright rather than shrunk or nudged —
    // this is what actually guarantees no two trees/bushes ever touch,
    // regardless of how big either one happens to be.
    for (let gx = 0; gx < gridSize; gx++) {
      for (let gz = 0; gz < gridSize; gz++) {
        const cellCenterX = -fillerBound + (gx + 0.5) * cellSize;
        const cellCenterZ = -fillerBound + (gz + 0.5) * cellSize;
        const x = cellCenterX + (fillerRand() - 0.5) * cellSize * 0.4;
        const z = cellCenterZ + (fillerRand() - 0.5) * cellSize * 0.4;
        const distFromCenter = Math.hypot(x, z);
        if (distFromCenter > fillerBound) continue; // keep this pass roughly circular within the walkable bound rather than filling the square's far corners too
        if (Math.hypot(x - LANDMARK_POSITION.x, z - LANDMARK_POSITION.z) < 14) continue; // keep the landmark's own clearing free
        if (Math.hypot(x - layout.spawn.x, z - layout.spawn.z) < 8) continue; // keep the immediate spawn area free
        const groundY = sampleGroundHeight(x, z, terrainMesh) ?? 0;
        if (waterLevel !== undefined && groundY < waterLevel + 0.4) continue; // no trees growing in the lake
        const handle = createLivingTree(level.color, fillerRand); // bushes removed per explicit request — filler now trees only
        handle.group.position.set(x, groundY, z);
        handle.group.rotation.y = fillerRand() * Math.PI * 2;
        const depthT = Math.min(1, distFromCenter / fillerBound);
        handle.group.scale.setScalar(1.15 - depthT * 0.55); // 1.15x near the center down to 0.6x near the edge
        const radius = footprintRadiusOf(handle.group);
        const overlaps = placedFootprints.some((f) => Math.hypot(x - f.x, z - f.z) < (radius + f.radius) * 1.25);
        if (overlaps) continue; // discard this candidate entirely rather than force it in — the whole point is a real guarantee, not a best-effort fit
        placedFootprints.push({ x, z, radius });
        handle.baseY = groundY;
        handle.group.traverse((obj) => {
          if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
        });
        scene.add(handle.group);
        decorationHandles.push(handle);
      }
    }

    // Runtime self-check — if the collision logic above is somehow still
    // letting two footprints through anyway, this logs exactly which
    // ones and by how much, directly in the browser console. A
    // standalone simulation of this same algorithm (same math, same
    // order of operations) checked out with zero overlaps, so if this
    // ever actually fires, it means something about the real in-browser
    // execution differs from that simulation — and this gives concrete
    // numbers to debug from instead of guessing again.
    for (let i = 0; i < placedFootprints.length; i++) {
      for (let j = i + 1; j < placedFootprints.length; j++) {
        const a = placedFootprints[i], b = placedFootprints[j];
        const dist = Math.hypot(a.x - b.x, a.z - b.z);
        if (dist < a.radius + b.radius) {
          console.warn(`Rift: overlapping Verdant footprints — a=(${a.x.toFixed(1)},${a.z.toFixed(1)},r=${a.radius.toFixed(2)}) b=(${b.x.toFixed(1)},${b.z.toFixed(1)},r=${b.radius.toFixed(2)}) dist=${dist.toFixed(2)}`);
        }
      }
    }

    // Canopy light shafts — scattered near the forest, not tied to any
    // individual tree's position (a fixed light-shaft-per-tree would look
    // mechanical). Own deterministic PRNG stream, same pattern as the
    // filler trees above.
    const shaftRand = mulberry32(hashStringToSeed(WORLD_SEED + "-light-shafts-" + level.biome));
    const shaftCount = 28;
    for (let i = 0; i < shaftCount; i++) {
      const x = (shaftRand() * 2 - 1) * fillerBound;
      const z = (shaftRand() * 2 - 1) * fillerBound;
      if (Math.hypot(x, z) > fillerBound) continue;
      const groundY = sampleGroundHeight(x, z, terrainMesh) ?? 0;
      if (waterLevel !== undefined && groundY < waterLevel + 0.4) continue; // no light shafts shining out of the middle of the lake either
      const shaft = createLightShaft(x, z, groundY, shaftRand);
      scene.add(shaft.sprite);
      lightShaftHandles.push(shaft);
    }
  }

  // Coral Shallows underwater light shafts — RE-ADDED per explicit
  // request ("more light shining through the surface of the water").
  // Previously removed on a hypothesis (grainy/noisy underwater look)
  // made without being able to inspect decorations.js directly — now
  // that it's available, createUnderwaterLightShaft's actual geometry
  // looks correctly built (anchored at the real water surface, length
  // capped to the real local depth so it can't poke through the sand,
  // same clean soft-gradient texture the working Verdant canopy version
  // above already uses) — the earlier diagnosis doesn't hold up against
  // the real code. The SEPARATE flicker issue that came with it before
  // was very likely the per-frame submersion visibility toggle fighting
  // the water's own wave bob right at the boundary — main.js's
  // isFullySubmerged now has a real hysteresis dead zone (1.1 units,
  // comfortably past the ~1.7-unit wave amplitude) that didn't exist
  // yet at the time, so that specific failure mode should be resolved
  // independently of this. Own separate array (underwaterShaftHandles)
  // so its submersion-based visibility can be toggled without touching
  // Verdant's canopy shafts. Count kept conservative (18, vs the
  // original 40) for a first re-introduction.
  if (level.biome === "crystal" && LIQUID_LEVEL.crystal !== undefined) {
    const uwWaterLevel = LIQUID_LEVEL.crystal; // own local lookup — the `waterLevel` above is block-scoped to the Verdant `if` and isn't visible here
    const uwShaftRand = mulberry32(hashStringToSeed(WORLD_SEED + "-uw-light-shafts-" + level.biome));
    const uwShaftBound = WORLD_BOUND_RADIUS * 0.85;
    const uwShaftCount = 18;
    for (let i = 0; i < uwShaftCount; i++) {
      const x = (uwShaftRand() * 2 - 1) * uwShaftBound;
      const z = (uwShaftRand() * 2 - 1) * uwShaftBound;
      if (Math.hypot(x, z) > uwShaftBound) continue;
      const groundY = sampleGroundHeight(x, z, terrainMesh) ?? 0;
      if (groundY > uwWaterLevel - 1.0) continue; // needs genuine depth below it — skip shallow-water/near-shore spots
      const shaft = createUnderwaterLightShaft(x, z, groundY, uwWaterLevel, uwShaftRand);
      shaft.sprite.visible = false; // starts hidden — animate loop sets real visibility from isFullySubmerged each frame
      scene.add(shaft.sprite);
      underwaterShaftHandles.push(shaft);
    }
  }

  loreMarkers = layout.loreMarkers.map((m) => ({
    ...m, y: sampleGroundHeight(m.x, m.z, terrainMesh) ?? 0, shown: false,
  }));

  crystalsTotal = allCrystals.length;
  crystalsCollected = 0;
  updateResonanceUI();

  const spawnGroundY = sampleGroundHeight(layout.spawn.x, layout.spawn.z, terrainMesh) ?? 0;
  spawnPosition = { x: layout.spawn.x, y: spawnGroundY + PLAYER_EYE_HEIGHT + 2, z: layout.spawn.z };
  camera.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
  faceAwayFromLandmark(spawnPosition.x, spawnPosition.z);
  playerPhysics.verticalVelocity = 0;
  playerPhysics.grounded = false;
  fireSpawnTimer = 3 + Math.random() * 5; // harmless on non-Ember biomes, the spawner below gates on biome anyway
}

function respawnInLevel() {
  camera.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
  faceAwayFromLandmark(spawnPosition.x, spawnPosition.z);
  playerPhysics.verticalVelocity = 0;
  playerPhysics.grounded = false;
  logDiscovery("Fell — back to the start.");
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Graphics settings — applying a tier change updates the renderer/shadow
// state immediately, then rebuilds the current level (if one is active) so
// tier-dependent counts baked in at build time (terrain resolution, grass,
// particles, decoration detail, cloud/wildlife counts) actually take
// effect right away instead of only on the next level entry.
// ---------------------------------------------------------------------------
function applyGraphicsSettings() {
  const s = getGraphicsSettings();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, s.pixelRatioCap));
  renderer.shadowMap.enabled = s.shadowsEnabled;
  if (sun.shadow.mapSize.width !== s.shadowMapSize) {
    sun.shadow.mapSize.set(s.shadowMapSize, s.shadowMapSize);
    // Three.js only regenerates the shadow map texture at the new
    // resolution once the old one is disposed — changing mapSize alone
    // has no effect on an already-rendered light.
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  const moonShadowSize = s.shadowMapSize / 2;
  if (moonLight.shadow.mapSize.width !== moonShadowSize) {
    moonLight.shadow.mapSize.set(moonShadowSize, moonShadowSize);
    if (moonLight.shadow.map) { moonLight.shadow.map.dispose(); moonLight.shadow.map = null; }
  }
  applySsaoTier();
  resizeToViewport();
  if (currentLevelIdx >= 0) buildLevel(currentLevelIdx);
}

function changeGraphicsTier(tier) {
  if (!setGraphicsTier(tier)) return;
  applyGraphicsSettings();
  syncGraphicsUI();
}

function syncGraphicsUI() {
  const active = getGraphicsTier();
  graphicsPanel?.querySelectorAll(".rift-graphics-opt").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tier === active);
  });
}

if (graphicsBtn && graphicsPanel) {
  graphicsBtn.addEventListener("click", () => {
    const open = graphicsPanel.hidden;
    graphicsPanel.hidden = !open;
    graphicsBtn.classList.toggle("gfx-open", open);
  });
  graphicsPanel.querySelectorAll(".rift-graphics-opt").forEach((btn) => {
    btn.addEventListener("click", () => changeGraphicsTier(btn.dataset.tier));
  });
  syncGraphicsUI();
}

// ---------------------------------------------------------------------------
// Level select UI
// ---------------------------------------------------------------------------
// A brief "you've just landed" beat on entering any level — fades from
// black, holds on the biome name, then fades into gameplay, instead of
// snapping straight from the level-select menu into full control.
function playArrivalSequence(levelName) {
  if (!arrivalOverlay || !arrivalNameEl) return;
  arrivalOverlay.classList.remove("rift-arrival-name-in");
  // Snap instantly to fully opaque (bypassing the transition) right as the
  // level starts building, then let the CSS transition fade it back out
  // after the hold below — invisible is the default state (see the CSS),
  // so there's no leftover state to reset between arrivals the way an
  // "opaque by default" design would require.
  arrivalOverlay.style.transition = "none";
  arrivalOverlay.classList.add("rift-arrival-active");
  arrivalOverlay.offsetHeight; // force a reflow so the instant opacity jump above actually applies before the transition is restored below
  arrivalOverlay.style.transition = "";
  arrivalNameEl.textContent = levelName;
  requestAnimationFrame(() => {
    arrivalOverlay.classList.add("rift-arrival-name-in");
  });
  setTimeout(() => arrivalOverlay.classList.remove("rift-arrival-active"), 1900);
}

function enterLevel(levelIdx) {
  buildLevel(levelIdx);
  initAudio();
  startAmbient(LEVELS[levelIdx].biome);
  playArrivalSequence(LEVELS[levelIdx].name);
  if (isTouchDevice) {
    touchGameActive = true;
    startOverlay.style.display = "none";
  } else {
    controls.lock();
  }
}

function buildLevelSelectButtons() {
  if (!levelSelectEl) return;
  levelSelectEl.innerHTML = "";
  LEVELS.forEach((level, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rift-level-btn";
    btn.innerHTML = `<strong>${level.name}</strong><span>${level.tagline}</span>`;
    btn.addEventListener("click", () => enterLevel(idx));
    levelSelectEl.appendChild(btn);
  });
}
buildLevelSelectButtons();

// ---------------------------------------------------------------------------
// Resonance Crystals
// ---------------------------------------------------------------------------
let worldPulseElapsed = null;
const WORLD_PULSE_DURATION = 4;

function updateResonanceUI() {
  resonanceValueEl.textContent = `${crystalsCollected} / ${crystalsTotal}`;
  resonanceDot.classList.toggle("complete", crystalsTotal > 0 && crystalsCollected >= crystalsTotal);
}

function shatterCrystal(id) {
  const handle = crystalHandles.get(id);
  if (!handle) return;
  const crystal = allCrystals.find((c) => c.id === id);

  disposeCrystalMesh(scene, handle);
  crystalHandles.delete(id);
  allCrystals = allCrystals.filter((c) => c.id !== id);
  crystalsCollected++;
  updateResonanceUI();

  if (crystal) {
    spawnImpact(crystal.position, crystal.color, { count: 14, speedMin: 2.5, speedMax: 5, particleSize: 0.09, duration: 0.5 });
  }
  playShatter();
  logDiscovery(`Resonance Crystal shattered — ${crystalsCollected} / ${crystalsTotal}`);

  if (crystalsCollected >= crystalsTotal && crystalsTotal > 0) {
    worldPulseElapsed = 0;
    logDiscovery("Every crystal on this landmass has been shattered.");
    setTimeout(() => playShatter(), 150);
  }
}

function updateWorldPulse(dt) {
  if (worldPulseElapsed === null || !terrainMesh) return;
  worldPulseElapsed += dt;
  const t = Math.min(1, worldPulseElapsed / WORLD_PULSE_DURATION);
  terrainMesh.material.emissiveIntensity = 0.04 + Math.sin(t * Math.PI) * 0.55;
  if (worldPulseElapsed >= WORLD_PULSE_DURATION) worldPulseElapsed = null;
}

function logDiscovery(text) {
  if (!discoveryLogEl) return;
  const line = document.createElement("div");
  line.textContent = text;
  discoveryLogEl.prepend(line);
  setTimeout(() => line.remove(), 5000);
  while (discoveryLogEl.children.length > 5) discoveryLogEl.removeChild(discoveryLogEl.lastChild);
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------
const MAX_SHOT_RANGE = 400;
const PROJECTILE_SPEED = 140;
const PROJECTILE_LIFETIME = 2.5;
const bolts = [];
const muzzleFlashes = [];
const impactBursts = [];

function spawnProjectile(origin, direction, colorHex = 0x4fd1c5) {
  bolts.push(createBolt(scene, origin, direction, colorHex, PROJECTILE_SPEED));
}
function spawnImpact(position, colorHex = 0xff6b4a, options = {}) {
  impactBursts.push(createImpactBurst(scene, position, colorHex, options));
}

function updateProjectiles(dt) {
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i]; updateBolt(b, dt);
    if (b.life > PROJECTILE_LIFETIME) { disposeBolt(scene, b); bolts.splice(i, 1); }
  }
  for (let i = muzzleFlashes.length - 1; i >= 0; i--) {
    const f = muzzleFlashes[i]; updateMuzzleFlash(f, dt);
    if (f.life > f.duration) { disposeMuzzleFlash(scene, f); muzzleFlashes.splice(i, 1); }
  }
  for (let i = impactBursts.length - 1; i >= 0; i--) {
    const b = impactBursts[i]; updateImpactBurst(b, dt);
    if (b.life > b.duration) { disposeImpactBurst(scene, b); impactBursts.splice(i, 1); }
  }
}

function fireShot() {
  if (!isGameActive()) return;
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  const dir = { x: direction.x, y: direction.y, z: direction.z };
  const origin = { x: camera.position.x, y: camera.position.y, z: camera.position.z };

  const muzzleOffset = direction.clone().multiplyScalar(0.8);
  const muzzlePos = camera.position.clone().add(muzzleOffset);
  muzzlePos.y -= 0.15;
  muzzleFlashes.push(createMuzzleFlash(scene, muzzlePos, 0xe8ecf1));

  spawnProjectile(origin, dir, 0xe8ecf1);
  playShoot();

  const hit = findClosestHit(origin, dir, allCrystals, CRYSTAL_RADIUS, MAX_SHOT_RANGE);
  if (hit) {
    const travelMs = (hit.distance / PROJECTILE_SPEED) * 1000;
    setTimeout(() => shatterCrystal(hit.id), Math.max(0, travelMs));
  }
}

document.addEventListener("mousedown", (e) => {
  if (e.button === 0 && controls.isLocked) fireShot();
});

createTouchControls({
  camera, keys, onFire: fireShot, viewport, isActive: isGameActive,
  onJump: () => { jumpQueued = true; },
});

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyM") {
    const isMuted = toggleMuted();
    logDiscovery(isMuted ? "Sound muted" : "Sound on");
  }
});

// ---------------------------------------------------------------------------
// Lore proximity trigger — a handful of fixed points scattered across the
// landmass now, rather than one trigger per island.
// ---------------------------------------------------------------------------
let loreTickerTimeout = null;
const LORE_TRIGGER_RADIUS = 14;

function checkLoreProximity() {
  for (const marker of loreMarkers) {
    const dx = camera.position.x - marker.x, dz = camera.position.z - marker.z;
    const dist = Math.hypot(dx, dz);
    if (dist < LORE_TRIGGER_RADIUS && !marker.shown) {
      marker.shown = true;
      showLore(getIslandLore({ id: marker.id, biome: LEVELS[currentLevelIdx].biome }));
    } else if (dist > LORE_TRIGGER_RADIUS * 1.6 && marker.shown) {
      marker.shown = false;
    }
  }
}

function showLore(text) {
  if (!text) return;
  loreTicker.textContent = text;
  loreTicker.classList.add("visible");
  clearTimeout(loreTickerTimeout);
  loreTickerTimeout = setTimeout(() => loreTicker.classList.remove("visible"), 6000);
  playLoreChime();
}

// ---------------------------------------------------------------------------
// Boot — show the level-select screen. No level is built until the player
// actually picks one.
// ---------------------------------------------------------------------------
showLevelSelect();

// ---------------------------------------------------------------------------
// Ember fire spawner — state (fireSpawnTimer, MAX_DYNAMIC_FIRES) declared
// earlier alongside the other level vars.
// ---------------------------------------------------------------------------
function spawnEmberFire() {
  const level = LEVELS[currentLevelIdx];
  const angle = Math.random() * Math.PI * 2;
  const dist = Math.random() * WORLD_BOUND_RADIUS * 0.9; // stay within the player's actual reachable area, not right at the falloff rim
  const x = Math.cos(angle) * dist, z = Math.sin(angle) * dist;
  const groundY = sampleGroundHeight(x, z, terrainMesh) ?? 0;
  const lifespan = 15 + Math.random() * 20; // 15-35s — "burns out after a while"
  // Math.random is a drop-in for the seedRand()-style function
  // createEmberFire normally receives from a decoration's deterministic
  // per-instance RNG — it only needs the same () => [0,1) interface,
  // which a runtime-spawned fire has no deterministic seed for anyway.
  const handle = createEmberFire(level.color, Math.random, elapsedTime, lifespan);
  handle.group.position.set(x, groundY, z);
  handle.group.traverse((obj) => {
    if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
  });
  scene.add(handle.group);
  decorationHandles.push(handle);
}

function updateEmberFireSpawner(dt) {
  if (currentLevelIdx < 0 || !terrainMesh || LEVELS[currentLevelIdx].biome !== "ember") return;
  fireSpawnTimer -= dt;
  if (fireSpawnTimer > 0) return;
  fireSpawnTimer = 3 + Math.random() * 5; // next fire in 3-8s
  const activeFireCount = decorationHandles.reduce((n, h) => n + (h.kind === "emberFire" ? 1 : 0), 0);
  if (activeFireCount < MAX_DYNAMIC_FIRES) spawnEmberFire();
}

// Finds whichever "emberFire" decoration is currently closest to the
// player (there can be several — static level-placed ones plus whatever
// the spawner above has going) and hands its position to audio.js's
// single positional fire-crackle panner. Cheap even with MAX_DYNAMIC_FIRES
// dynamic fires plus the level's static ones, since this is a flat scan
// over decorationHandles that's already being iterated once per frame
// anyway for updateDecoration above.
const cameraForward = new THREE.Vector3();
function updateFireAudio() {
  let nearest = null;
  let nearestDistSq = Infinity;
  for (const handle of decorationHandles) {
    if (handle.kind !== "emberFire") continue;
    const dx = handle.group.position.x - camera.position.x;
    const dz = handle.group.position.z - camera.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < nearestDistSq) { nearestDistSq = distSq; nearest = handle.group.position; }
  }
  if (nearest) updateFirePosition(nearest.x, nearest.y, nearest.z);
  camera.getWorldDirection(cameraForward);
  updateListenerPosition(camera.position.x, camera.position.y, camera.position.z, cameraForward.x, cameraForward.y, cameraForward.z);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let elapsedTime = 0;
const FALL_RESPAWN_OFFSET = 80; // generous — the world-bounds clamp above should make this a rare last-resort safety net, not the primary way players learn there's an edge

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  elapsedTime += dt;

  fpsFrameCount++;
  fpsAccumTime += dt;
  if (fpsAccumTime >= 0.5) {
    fpsCounterEl.textContent = Math.round(fpsFrameCount / fpsAccumTime) + " fps";
    fpsFrameCount = 0;
    fpsAccumTime = 0;
  }

  const dayNight = updateDayNightCycle(dayNightCycle, dt);
  // Fallback sky background — mutated in place (scene.background already
  // references this same Color object, set once at module init above),
  // blended from the day/night cycle's own current colors so it stays
  // in sync with the cloud dome's own tint and the rest of the lighting.
  if (dayNight.skyZenith && dayNight.skyHorizon) {
    sceneBackgroundColor.copy(dayNight.skyHorizon).lerp(dayNight.skyZenith, 0.5);
  }

  if (isGameActive() && currentLevelIdx >= 0) {
    // Only Coral Shallows is a real whole-level ocean — Ember's/Verdant's
    // own LIQUID_LEVEL entries are small local features (a lava channel,
    // a river), not something the whole level is submerged in, so swim
    // mode stays scoped to the one biome it actually describes rather
    // than triggering for every biome that happens to have ANY liquid.
    const swimLevel = LEVELS[currentLevelIdx].biome === "crystal" ? LIQUID_LEVEL[LEVELS[currentLevelIdx].biome] : undefined;
    // Same "eye height below the surface" check physics.js uses
    // internally to decide swim mode — computed once here so movement
    // speed and vertical swim control can't ever disagree about whether
    // the player is currently swimming.
    const swimming = swimLevel !== undefined && camera.position.y < swimLevel;
    updateMovement(dt, playerPhysics.grounded, swimming);
    const swimVertical = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    updatePlayerPhysics(camera, terrainMesh, playerPhysics, dt, PLAYER_EYE_HEIGHT, jumpQueued, caveFloorMeshes.length ? caveFloorMeshes : undefined, swimLevel, swimVertical);
    jumpQueued = false;
    if (camera.position.y < spawnPosition.y - FALL_RESPAWN_OFFSET) respawnInLevel();
    checkLoreProximity();
  }

  for (const [, handle] of crystalHandles) updateCrystalMesh(handle, elapsedTime);
  for (let i = decorationHandles.length - 1; i >= 0; i--) {
    const handle = decorationHandles[i];
    updateDecoration(handle, elapsedTime, dayNight.dayAmount);
    if (handle.expired) {
      scene.remove(handle.group);
      handle.group.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      decorationHandles.splice(i, 1);
    }
  }
  updateEmberFireSpawner(dt);
  updateFireAudio();
  // Read from whatever updateLandmark last set — that call happens a few
  // lines below this frame (one-frame lag, imperceptible for ambient
  // reactions like these) rather than reordering the whole loop for it.
  const eruptionActive = !!(landmarkHandle && landmarkHandle.volcano && landmarkHandle.volcano.erupting);
  if (eruptionActive !== wasErupting) {
    setEruptionIntensity(eruptionActive);
    if (eruptionActive) playEruptionBurst();
    wasErupting = eruptionActive;
  }
  if (terrainMesh && terrainMesh.material.userData.shader) {
    terrainMesh.material.userData.shader.uniforms.uTime.value = elapsedTime;
    terrainMesh.material.userData.shader.uniforms.uDayAmount.value = dayNight.dayAmount;
  }
  // Real planar water reflection — Coral Shallows only, above-water only
  // (a reflection rendered from below the surface looking up would be
  // nonsensical for this same-plane technique). Computes the active
  // biome directly here (currentLevelIdx/LEVELS, not the later `currentBiome`
  // const — that's declared further down this function, AFTER this point,
  // so referencing it here would throw). Also uses a plain position check
  // rather than the later-computed isFullySubmerged/hysteresis state —
  // perfectly adequate for deciding whether to spend a second scene
  // render this frame, doesn't need hysteresis the way the underwater
  // post-process toggle does.
  // Reflection/refraction throttling — per explicit "frame rate is an
  // issue" follow-up. Each of these is a FULL extra scene render (the
  // reduced render-target resolution only saves fragment/pixel cost, not
  // the vertex/geometry throughput of rendering the whole scene — terrain,
  // decorations, wildlife — a second and third time), and previously ran
  // every single frame regardless of graphics tier — the single largest
  // unmitigated cost in the project by the time this was added. Now only
  // actually re-rendered every reflectionUpdateInterval-th frame (tier-
  // dependent, see graphicsSettings.js); on skipped frames the render
  // targets simply keep showing last frame's content, which
  // updateLiquidPlane below still reads every frame regardless — a
  // reflection/refraction lagging by 1-2 frames is imperceptible, unlike
  // the render cost of computing it fresh every single frame.
  reflectionFrameCounter++;
  const reflectionBiome = currentLevelIdx >= 0 ? LEVELS[currentLevelIdx].biome : null;
  if (reflectionBiome === "crystal" && camera.position.y > LIQUID_LEVEL.crystal) {
    if (reflectionFrameCounter >= getGraphicsSettings().reflectionUpdateInterval) {
      reflectionFrameCounter = 0;
      updateWaterReflection(LIQUID_LEVEL.crystal, liquidHandle);
      updateWaterRefraction(liquidHandle);
    }
  }
  // stormAmount (last arg): reads weatherHandle's own persisted
  // rainIntensity directly rather than a fresher value from this frame's
  // updateWeatherSystem call, which hasn't run yet at this point in the
  // frame (see its own call further down) — rainIntensity already eases
  // in/out over several seconds (see weather.js), so being one frame
  // behind here is never visible. biome-gated inside updateLiquidPlane
  // itself (crystal only), so this is harmless to pass unconditionally.
  updateLiquidPlane(liquidHandle, elapsedTime, dayNight.skyZenith, camera.position.y, camera.position, sun.position, dayNight.skyHorizon, reflectionRenderTarget.texture, reflectionTextureMatrix, refractionRenderTarget.texture, refractionResolution, weatherHandle ? weatherHandle.rainIntensity : 0);
  updateWaterfall(waterfallHandle, dt, elapsedTime);
  updateOceanSurfaceDetail(oceanSurfaceDetailHandle, elapsedTime, dayNight.dayAmount);
  // Real angelfish (models.js) — AnimationMixer drives the loaded skeletal
  // swim clip (fin/body motion in place), the wander drift here separately
  // moves the fish THROUGH the reef along a slow circle so they don't just
  // hover on one spot animating in place. Palm trees need no per-frame
  // update at all (static geometry).
  for (const fish of realFish) {
    fish.mixer.update(dt);
    const t = elapsedTime * fish.wanderSpeed + fish.wanderPhase;
    const fx = fish.wanderCenterX + Math.cos(t) * fish.wanderRadius;
    const fz = fish.wanderCenterZ + Math.sin(t) * fish.wanderRadius;
    fish.group.position.set(fx, fish.wanderY + Math.sin(t * 1.7) * 0.3, fz);
    fish.group.rotation.y = -t + Math.PI / 2; // face the direction of travel around the circle (tangent to the path), not the path's own radius direction
  }
  updateRiverCurrent(riverCurrentHandle, dt);
  updateRiverFlowStrip(riverFlowStripHandle, dt);
  updateSourcePond(sourcePondHandle, elapsedTime);
  // Ground indigo/violet night tint — Verdant only. The terrain mesh uses
  // one shared vertex-colored material for the whole landmass, so tinting
  // .color (multiplies with the baked-in vertex colors) plus boosting
  // .emissive is the same technique used for grass — a diffuse tint
  // alone would still go invisible under this biome's crushed-dark night
  // lighting, so real emissive glow is what keeps it visibly colored.
  if (currentLevelIdx >= 0 && LEVELS[currentLevelIdx].biome === "verdant" && terrainMesh) {
    const groundNightAmount = Math.max(0, Math.min(1, 1 - dayNight.dayAmount / 0.3));
    terrainMesh.material.color.setRGB(1, 1, 1).lerp(new THREE.Color(0x5a3ad8), groundNightAmount * 0.6);
    terrainMesh.material.emissive.setHex(0x4a20c8);
    terrainMesh.material.emissiveIntensity = 0.04 + groundNightAmount * 0.5;
  }
  // Coral Shallows' own night terrain tint — per explicit "the sand is
  // looking too green at night" report. Without an explicit tint here,
  // the sand's baked vertex color was left to whatever the raw ambient/
  // sun light color happened to multiply out to at night, uncontrolled.
  // A pale, deliberately cool-BLUE moonlight tone (no green component at
  // all) guarantees the sand reads as moonlit sand rather than whatever
  // hue the raw lighting math produced. No emissive boost, unlike
  // Verdant above — a beach shouldn't glow the way that biome's
  // bioluminescent forest floor does, this is purely a diffuse tint.
  if (currentLevelIdx >= 0 && LEVELS[currentLevelIdx].biome === "crystal" && terrainMesh) {
    const groundNightAmount = Math.max(0, Math.min(1, 1 - dayNight.dayAmount / 0.3));
    terrainMesh.material.color.setRGB(1, 1, 1).lerp(new THREE.Color(0xb8c8e6), groundNightAmount * 0.45);
  }
  // Underwater effect — Verdant only. All of it (fog, lighting, water
  // volume, screen distortion below) now gated on the SAME strict
  // "fully submerged" condition — the camera/eyes themselves below the
  // water surface, not just the player's feet in shallow water — per
  // explicit request that the fog/distortion match lighting's threshold
  // rather than triggering earlier. sun.color/ambientLight.color/
  // scene.fog.color/.density are all confirmed reset every frame by
  // dayNightCycle, so this override is safe and self-corrects the
  // moment the player surfaces.
  //
  // Generalized across ANY water-having biome (was hardcoded to
  // "verdant" specifically) — derives the water level from whatever the
  // current biome's own LIQUID_LEVEL entry is, so it will automatically
  // cover any future water biome without needing another hardcoded
  // special-case here.
  const currentBiome = currentLevelIdx >= 0 ? LEVELS[currentLevelIdx].biome : null;
  // Crystal-only, Medium/Low-tier skipped — see updateSkyEnvironment's
  // own comment for why this exists at all (clearcoat needs something to
  // reflect). Every other biome gets scene.environment cleared in
  // teardownLevel so this stays scoped to the one material that actually
  // uses it.
  // TEMPORARILY DISABLED as a diagnostic test — per explicit request, to
  // isolate whether scene.environment (a scene-wide PBR env map) being
  // active at the same time as the (since-removed) THREE.Water mirror
  // plane was contributing to that reflection-corruption saga. RE-
  // ENABLED — that whole mirror-plane approach has since been replaced
  // entirely with a real planar reflection sampled directly in liquid.js
  // (see updateWaterReflection above), so the diagnostic test's original
  // premise no longer applies; this env map still independently feeds
  // the water's clearcoat layer as it always did.
  if (currentBiome === "crystal" && getGraphicsTier() !== "low") {
    updateSkyEnvironment(dayNight.skyZenith, dayNight.skyHorizon);
  }
  const currentLiquidLevel = currentBiome !== null ? LIQUID_LEVEL[currentBiome] : undefined;
  // Hysteresis, not a bare threshold — a plain "camera.y < liquidLevel"
  // check flickers every single frame when the camera hovers right at
  // the water line (standing at the shoreline, camera bob, the water
  // surface's own wave height), rapidly toggling the underwater post-
  // process (fog, color, distortion) on and off — exactly the "flashing
  // between dark waves and normal sand" symptom. A dead zone means it
  // only flips submerged once genuinely well below the line, and only
  // flips back once genuinely well above it.
  if (currentLiquidLevel !== undefined) {
    if (!submergedState && camera.position.y < currentLiquidLevel - 1.1) submergedState = true;
    else if (submergedState && camera.position.y > currentLiquidLevel + 1.1) submergedState = false;
  } else {
    submergedState = false;
  }
  const isFullySubmerged = submergedState; // was 0.6 — still narrower than the ocean's own ~0.85-unit wave amplitude, so waves washing over the camera near the surface could still cross both edges of the dead zone repeatedly, flipping the underwater post-process (fog/distortion/render-target pass) on and off every couple frames. 1.1 comfortably exceeds the max wave amplitude, so only an actual sustained surface crossing (not wave bob) flips the state now.
  if (isFullySubmerged) {
    const uwStyle = UNDERWATER_STYLE[currentBiome] || UNDERWATER_STYLE.default;
    // Per explicit "remove underwater color effects that could be
    // darkening everything, except at night/during a storm it should be
    // less bright" — clarity is 0 at night (dayAmount=0) OR during a full
    // storm (stormAmount=1), preserving exactly today's existing dim
    // underwater look in both those cases untouched. It only ever climbs
    // toward 1 on a bright, stormless day, and that's where fog/tint get
    // pulled back and real light is let through — reading `weatherHandle`
    // directly rather than the frame's own `wind` (computed later this
    // same function) since this block runs first.
    const stormAmountNow = weatherHandle ? weatherHandle.rainIntensity : 0;
    const clarity = currentBiome === "crystal" ? dayNight.dayAmount * (1 - stormAmountNow) : 0;
    scene.fog.color.setHex(uwStyle.fogColor);
    scene.fog.density = uwStyle.fogDensity * (1 - clarity * 0.7); // up to 70% thinner at full clarity, never fully zero — a hard-zero fog would make the far seafloor cut off at an unnaturally sharp render-distance edge instead of fading
    sun.color.setHex(uwStyle.sunColor);
    // Was capped at 1.9x (dayAmount*0.9), day-only — widened to 2.6x and
    // now ALSO pulled back during storms (previously storm had zero
    // effect on this specific multiplier, even though storms already dim
    // the real sun elsewhere) via the same clarity term as everything
    // else in this block, so this and fog/tint move together consistently
    // instead of three separate ad-hoc day/storm rules.
    const dayBrightBoost = currentBiome === "crystal" ? 1.0 + clarity * 1.6 : 1.0;
    sun.intensity *= uwStyle.sunMult * dayBrightBoost;
    ambientLight.color.setHex(uwStyle.ambientColor);
    ambientLight.intensity *= uwStyle.ambientMult * dayBrightBoost;
    underwaterDistortionMaterial.uniforms.tintColor.value.set(uwStyle.tint[0], uwStyle.tint[1], uwStyle.tint[2]);
    underwaterDistortionMaterial.uniforms.tintStrength.value = uwStyle.tintStrength * (1 - clarity * 0.75); // the screen-space color-cast overlay — the main "everything looks tinted/darkened" culprit, pulled back the most aggressively of all these
    underwaterDistortionMaterial.uniforms.fogDensity.value = scene.fog.density; // kept in sync with the real scene fog set just above, not the style's own un-scaled base value
    underwaterDistortionMaterial.uniforms.causticStrength.value = uwStyle.causticStrength;
    underwaterDistortionMaterial.uniforms.distortAmp.value = uwStyle.distortAmp;
    waterVolumeMesh.material.color.setHex(uwStyle.volumeColor);
    waterVolumeMesh.material.opacity = 0.12 * (1 - clarity * 0.6); // the enclosing color-cast sphere itself — real, direct contributor to "everything looks a uniform color underwater" that none of the other tuning above actually touches. Direct assignment (not *=) from its own base 0.12 (set at creation) — this property has no other per-frame reset, so *= here would compound every frame while submerged and shrink toward zero within seconds instead of applying a stable reduction.
  }
  // The enclosing "water volume" sphere — follows the camera every
  // frame, only visible while actually fully submerged.
  waterVolumeMesh.visible = isFullySubmerged;
  if (isFullySubmerged) waterVolumeMesh.position.copy(camera.position);
  // Ocean surface glitter/whitecaps (createOceanSurfaceDetail) sit right
  // at the water plane and were never gated on submersion — from
  // underwater looking up at the surface, those foam/glint points read
  // as a row of glowing domes along the horizon, which is what was being
  // reported as "glowing balls" (the earlier fix removing the underwater
  // light shafts targeted the wrong system entirely). These are an
  // above-surface effect, so hide them the same way waterVolumeMesh is
  // gated — only visible while NOT fully submerged.
  if (oceanSurfaceDetailHandle) {
    // glitter no longer exists on this handle — liquid.js removed the
    // sun-glitter Points system (its untextured PointsMaterial was
    // rendering as flat squares, reported as "floating lights" on the
    // water). whitecaps is unaffected.
    oceanSurfaceDetailHandle.whitecaps.visible = !isFullySubmerged;
  }
  // Realistic cloud dome (clouds.js) — explicitly set fog:false on its
  // own material (correct for normal above-water rendering: fading
  // clouds to fog color at the far background distance they represent
  // would look wrong), which means scene.fog's underwater color/density
  // has ZERO effect on it regardless of how it's tuned — it would keep
  // rendering at full unobstructed visibility straight through the
  // water, per explicit "should not see any sky through the water"
  // report. Same established pattern as whitecaps just above: toggle
  // visibility directly on submersion rather than trying to fog an
  // object that was deliberately built to ignore fog.
  if (realisticCloudDomeHandle) realisticCloudDomeHandle.mesh.visible = !isFullySubmerged;
  // Underwater light shafts — opposite gating from the cloud dome just
  // above: only visible while actually submerged (a beam of light
  // shining down FROM the surface only makes sense to see from below
  // it). Safe to toggle every frame now — see the creation comment
  // (buildLevel) for why the flicker risk that came with this exact
  // toggle before should no longer apply.
  for (const s of underwaterShaftHandles) s.sprite.visible = isFullySubmerged;
  if (isFullySubmerged) {
    // Real water only lets you see the sky within a narrow cone roughly
    // straight overhead (Snell's window) — from any other angle you'd
    // see total internal reflection of the water/seafloor instead, not
    // the sun or moon. updateDayNightCycle (called earlier this frame,
    // before isFullySubmerged is even known) already set sun/moon
    // opacity from orbital elevation alone; this further fades them out
    // unless the camera itself is looking mostly straight up, using
    // cameraForward — already computed this frame for the audio listener.
    const lookingUpFactor = THREE.MathUtils.clamp((cameraForward.y - 0.55) / 0.35, 0, 1);
    dayNightCycle.sunBody.core.material.opacity *= lookingUpFactor;
    dayNightCycle.sunBody.glow.material.opacity *= lookingUpFactor;
    dayNightCycle.moonBody.core.material.opacity *= lookingUpFactor;
    dayNightCycle.moonBody.glow.material.opacity *= lookingUpFactor;
  }
  const wind = updateWeatherSystem(weatherHandle, dt, eruptionActive, dayNight.dayAmount);
  // Rain is an above-surface effect — real rain doesn't fall underwater.
  // Same visibility-gating pattern already used for whitecaps/the cloud
  // dome/light shafts above: toggle directly on submersion rather than
  // trying to fog/hide it any other way.
  if (weatherHandle && weatherHandle.rain) weatherHandle.rain.points.visible = !isFullySubmerged;
  updateAtmosphericParticles(atmosphereHandle, elapsedTime, dt, wind.windX, wind.windZ);
  updateGrass(grassHandle, elapsedTime, wind.windX, wind.windZ, dayNight.dayAmount);
  updateFlowers(flowersHandle, elapsedTime);
  updateFootstepGlowSystem(footstepGlowHandle, dt);
  updateWildlife(wildlifeHandle, elapsedTime, dt, camera.position.x, camera.position.z, eruptionActive);
  updateLandmark(landmarkHandle, elapsedTime, dt);
  updateClouds(cloudsHandle, dt, wind, dayNight.dayAmount, wind.rainIntensity, dayNight.skyHorizon, dayNightCycle.sunBody.group.position, camera.position);
  updateCloudLayer(cloudLayerHandle, dt, wind, dayNight.dayAmount, dayNight.skyHorizon);
  updateRealisticCloudDome(realisticCloudDomeHandle, dt, dayNight.dayAmount, dayNight.skyHorizon, dayNight.skyZenith, wind.rainIntensity, dayNightCycle.phaseT);
  // Clouds sometimes drift in front of the sun/moon — a cheap angular
  // check (see getCloudOcclusionFactor's own comment for why this isn't
  // real depth-buffer occlusion), applied as a further opacity
  // multiplier on top of whatever the day/night cycle (and the Snell's-
  // window submersion gating above) already computed this frame.
  if (cloudsHandle) {
    const sunOcclusion = 1 - getCloudOcclusionFactor(cloudsHandle, camera.position, dayNightCycle.sunBody.group.position);
    dayNightCycle.sunBody.core.material.opacity *= sunOcclusion;
    dayNightCycle.sunBody.glow.material.opacity *= sunOcclusion;
    // Real sunlight dims when clouds pass in front of the sun, not just
    // the visual sun sprite fading — the actual DirectionalLight driving
    // shading/shadows across the whole scene. Floored at 0.35 rather
    // than letting it go fully dark — cloud cover scatters sunlight, it
    // doesn't block it entirely the way full night does.
    dayNightCycle.sun.intensity *= Math.max(0.35, sunOcclusion);
    const moonOcclusion = 1 - getCloudOcclusionFactor(cloudsHandle, camera.position, dayNightCycle.moonBody.group.position);
    dayNightCycle.moonBody.core.material.opacity *= moonOcclusion;
    dayNightCycle.moonBody.glow.material.opacity *= moonOcclusion;
  }
  // Per explicit "the sun should not be this bright during a storm" —
  // the dimming above only happens when the sun's sprite position
  // happens to fall behind a cloud shape at this exact camera angle
  // (incidental, not tied to how heavily it's actually storming). This
  // adds a DIRECT stormAmount (wind.rainIntensity) dim on top, to both
  // the visual sprite and the real light — floored so it never goes
  // fully dark (real storms still have some diffuse skylight), but a
  // heavy storm now visibly dims the sun regardless of exact cloud
  // placement.
  const stormSunDim = 1 - Math.min(0.75, wind.rainIntensity * 0.85);
  dayNightCycle.sunBody.core.material.opacity *= stormSunDim;
  dayNightCycle.sunBody.glow.material.opacity *= stormSunDim;
  dayNightCycle.sun.intensity *= Math.max(0.3, stormSunDim);
  // Per explicit "definitely major issues aligning the sun with the
  // skybox... let's make it invisible but still retain all effects and
  // let the background sun fake it" — the real sun's drawn disc/glow/
  // beams are forced fully invisible here, LAST, after every dimming/
  // occlusion/storm calculation above has already run. Those all still
  // execute and still drive the REAL DirectionalLight's own intensity
  // (shading, shadows, everything gameplay-relevant) — only the visible
  // sprite is zeroed out. One of the sky mood textures' own baked-in sun
  // glow (still there under the hood, just suppressed to a soft ambient
  // highlight rather than a sharp disc — see clouds.js) now reads as
  // "the sun" instead, with no risk of two independent systems ever
  // disagreeing about where it should be.
  dayNightCycle.sunBody.core.material.opacity = 0;
  dayNightCycle.sunBody.glow.material.opacity = 0;
  for (const sprite of dayNightCycle.sunBeams.sprites) sprite.material.opacity = 0;
  setAmbientDayAmount(dayNight.dayAmount);
  if (currentLevelIdx >= 0 && horizonHandle) updateHorizonSilhouettes(horizonHandle, LEVELS[currentLevelIdx].biome, dayNight.dayAmount);
  updateLightShafts(lightShaftHandles, dayNight.dayAmount);
  updateLightShafts(underwaterShaftHandles, dayNight.dayAmount);
  updateWorldPulse(dt);
  updateProjectiles(dt);
  if (isFullySubmerged) {
    // Two-pass render: scene (including the water volume mesh above,
    // which renders normally as part of it) to an offscreen target, then
    // a full-screen quad draws that texture back out with a
    // sine-distorted UV and a blue tint (see the setup near the
    // renderer/resize code above).
    renderer.setRenderTarget(underwaterRenderTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    underwaterDistortionMaterial.uniforms.time.value = elapsedTime;
    renderer.render(underwaterQuadScene, underwaterQuadCamera);
  } else {
    composer.render();
  }
}
requestAnimationFrame(animate);
