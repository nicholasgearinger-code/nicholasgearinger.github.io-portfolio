import * as THREE from "three";
import * as base from "./dayNightCycle_celestial_physical_v13.js";

export * from "./dayNightCycle_celestial_physical_v13.js";

// -----------------------------------------------------------------------------
// Celestial v14 — lunar ephemeris + camera-space lens optics.
//
// The preserved v13 stack still owns Rift's photographic atmosphere, solar
// radiometry, shadows, textures and the existing lunar phase mask. This layer
// makes the Moon's sky position agree with those phases instead of keeping it
// permanently 180 degrees from the Sun, and adds a lightweight photographic
// lens-flare rig that needs no post-process pass or extra render target.
//
// World convention inherited from the base orbit:
//   +X = east, -X = west, +Y = up.
// Therefore both bodies rise on +X and set on -X.
// -----------------------------------------------------------------------------

const TAU = Math.PI * 2;
const ORBIT_RADIUS = 260;
const SUN_HORIZON_OFFSET = 10;
const MOON_HORIZON_OFFSET = 7;
const AZIMUTH_SWING = 140;
const MOON_DECLINATION_SWING = 28;

const stateByCycle = new WeakMap();
const TMP_SUN_WORLD = new THREE.Vector3();
const TMP_CAMERA_POS = new THREE.Vector3();
const TMP_FORWARD = new THREE.Vector3();
const TMP_RIGHT = new THREE.Vector3();
const TMP_UP = new THREE.Vector3();
const TMP_WORLD = new THREE.Vector3();
const TMP_NDC = new THREE.Vector3();
const TMP_TO_SUN = new THREE.Vector3();
const TMP_COLOR = new THREE.Color();

const FLARE_WARM = new THREE.Color(0xffd7a0);
const FLARE_WHITE = new THREE.Color(0xfffbec);
const FLARE_GHOST = new THREE.Color(0xffc88e);
const FLARE_COOL = new THREE.Color(0x9ec9dc);

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function smoothRange(a, b, x) {
  return smooth01((x - a) / Math.max(1e-6, b - a));
}

function wrap01(v) {
  const n = Number(v) || 0;
  return ((n % 1) + 1) % 1;
}

function cloudTransmission() {
  const sampled = Number(globalThis.__riftCloudShadowState?.averageTransmittance);
  if (Number.isFinite(sampled)) return clamp01(sampled);
  return 1 - clamp01(globalThis.__riftProceduralCloudOcclusion || 0);
}

function makeRadialTexture(size = 192, ring = false) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = size * 0.5;
  const r = size * 0.5;
  const g = ctx.createRadialGradient(c, c, 0, c, c, r);

  if (ring) {
    g.addColorStop(0.0, "rgba(255,255,255,0)");
    g.addColorStop(0.48, "rgba(255,255,255,0.02)");
    g.addColorStop(0.66, "rgba(255,255,255,0.32)");
    g.addColorStop(0.78, "rgba(255,255,255,0.08)");
    g.addColorStop(1.0, "rgba(255,255,255,0)");
  } else {
    g.addColorStop(0.0, "rgba(255,255,255,1)");
    g.addColorStop(0.08, "rgba(255,255,255,0.88)");
    g.addColorStop(0.24, "rgba(255,255,255,0.28)");
    g.addColorStop(0.58, "rgba(255,255,255,0.06)");
    g.addColorStop(1.0, "rgba(255,255,255,0)");
  }

  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function makeStreakTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const cx = canvas.width * 0.5;
  const cy = canvas.height * 0.5;

  const horizontal = ctx.createLinearGradient(0, 0, canvas.width, 0);
  horizontal.addColorStop(0.0, "rgba(255,255,255,0)");
  horizontal.addColorStop(0.34, "rgba(255,255,255,0.05)");
  horizontal.addColorStop(0.49, "rgba(255,255,255,0.70)");
  horizontal.addColorStop(0.51, "rgba(255,255,255,0.70)");
  horizontal.addColorStop(0.66, "rgba(255,255,255,0.05)");
  horizontal.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = horizontal;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const vertical = ctx.createLinearGradient(0, 0, 0, canvas.height);
  vertical.addColorStop(0.0, "rgba(255,255,255,0)");
  vertical.addColorStop(0.34, "rgba(255,255,255,0.12)");
  vertical.addColorStop(0.50, "rgba(255,255,255,1)");
  vertical.addColorStop(0.66, "rgba(255,255,255,0.12)");
  vertical.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.globalCompositeOperation = "lighter";
  const hot = ctx.createRadialGradient(cx, cy, 0, cx, cy, 22);
  hot.addColorStop(0.0, "rgba(255,255,255,0.95)");
  hot.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = hot;
  ctx.fillRect(cx - 24, cy - 24, 48, 48);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function makeFlareSprite(map, color, opacity, scale, aspect = 1) {
  const material = new THREE.SpriteMaterial({
    map,
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scale * aspect, scale, 1);
  sprite.renderOrder = 10020;
  sprite.userData.baseOpacity = opacity;
  sprite.userData.baseScale = scale;
  sprite.userData.aspect = aspect;
  return sprite;
}

function installLensOptics(cycle) {
  if (!cycle?.scene || cycle.__riftLensOpticsV14) return cycle?.__riftLensOpticsV14 || null;

  const soft = makeRadialTexture(192, false);
  const ring = makeRadialTexture(192, true);
  const streak = makeStreakTexture();
  const group = new THREE.Group();
  group.name = "rift-celestial-lens-flare-v14";
  group.visible = true;
  group.frustumCulled = false;

  const elements = [
    { sprite: makeFlareSprite(streak, FLARE_WARM, 0.16, 0.42, 7.5), factor: 1.0, kind: "source" },
    { sprite: makeFlareSprite(soft, FLARE_WHITE, 0.11, 0.34), factor: 0.82, kind: "source" },
    { sprite: makeFlareSprite(ring, FLARE_GHOST, 0.075, 0.46), factor: 0.38, kind: "ghost" },
    { sprite: makeFlareSprite(soft, FLARE_COOL, 0.052, 0.24), factor: -0.18, kind: "ghost" },
    { sprite: makeFlareSprite(ring, FLARE_GHOST, 0.045, 0.62), factor: -0.52, kind: "ghost" },
    { sprite: makeFlareSprite(soft, FLARE_WARM, 0.032, 0.31), factor: -0.88, kind: "ghost" },
  ];

  for (const element of elements) group.add(element.sprite);
  cycle.scene.add(group);

  // A near-invisible, frustum-independent capture sprite gives this module the
  // active render camera through onBeforeRender without changing the game's
  // public updateDayNightCycle(cycle, dt) call signature.
  const captureMaterial = new THREE.SpriteMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.00001,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const capture = new THREE.Sprite(captureMaterial);
  capture.name = "rift-lens-camera-capture-v14";
  capture.scale.setScalar(0.001);
  capture.frustumCulled = false;
  capture.renderOrder = -10000;
  cycle.sunBody?.group?.add(capture);

  const state = {
    group,
    elements,
    capture,
    soft,
    ring,
    streak,
    publicState: {
      version: "14-lunar-ephemeris-lens-optics",
      sunDirection: new THREE.Vector3(0, 1, 0),
      moonDirection: new THREE.Vector3(0, 1, 0),
      solarElevation: -1,
      moonElevation: -1,
      lowSun: 0,
      cloudTransmission: 1,
      sourceVisibility: 0,
      moonPhase: 0,
      moonIllumination: 1,
      flareStrength: 0,
      flareVisible: false,
    },
  };

  capture.onBeforeRender = (_renderer, _scene, camera) => {
    updateLensFlare(cycle, state, camera);
  };

  cycle.__riftLensOpticsV14 = state;
  stateByCycle.set(cycle, state);
  globalThis.__riftCelestialOpticsV14 = state.publicState;
  return state;
}

function updateMoonEphemeris(cycle, result, state) {
  if (!cycle?.moonBody?.group) return;

  const phaseT = wrap01(cycle.phaseT);
  const moonPhase = wrap01(cycle.moonPhase);

  // The existing phase layer defines phase=0 as full and phase=0.5 as new.
  // A real full Moon is opposite the Sun while a new Moon is close to it, so
  // the phase-derived elongation below makes sky position and visible phase
  // agree. Because Rift compresses the lunar month to its existing eight-day
  // gameplay cycle, the daily moonrise delay is intentionally compressed too.
  const solarAngle = phaseT * TAU;
  const elongation = Math.PI - moonPhase * TAU;
  const moonAngle = solarAngle + elongation;
  const orbitAngle = moonAngle - Math.PI / 2;
  const elevation = Math.sin(orbitAngle);

  const x = Math.cos(orbitAngle) * ORBIT_RADIUS;
  const y = elevation * ORBIT_RADIUS;
  const declination = Math.sin(moonPhase * TAU + 0.72) * MOON_DECLINATION_SWING;
  const z = 80 + elevation * AZIMUTH_SWING + declination;

  cycle.moonBody.group.position.set(x, y + MOON_HORIZON_OFFSET, z);
  if (cycle.moonLight?.position) {
    cycle.moonLight.position.set(x, Math.max(y, -20), z);
  }

  const moonElevation = THREE.MathUtils.clamp(y / ORBIT_RADIUS, -1, 1);
  const horizonVisibility = smoothRange(-0.045, 0.035, moonElevation);
  const illumination = clamp01(cycle.moonIllumination ?? 1);
  const dayAmount = clamp01(result?.dayAmount ?? 0);

  // Unlike the old permanently night-only Moon, phase-consistent geometry can
  // place crescents/quarters in the daytime sky. Keep the cratered phase mask;
  // only suppress the body when it is truly below the horizon or essentially new.
  cycle.moonBody.group.visible = horizonVisibility > 0.001 && illumination > 0.0015;

  if (cycle.moonBody.core?.material) {
    cycle.moonBody.core.material.opacity = horizonVisibility
      * THREE.MathUtils.lerp(0.58, 0.94, 1 - dayAmount);
  }
  if (cycle.moonBody.glow?.material) {
    cycle.moonBody.glow.material.opacity = horizonVisibility
      * 0.13
      * Math.pow(illumination, 0.72)
      * THREE.MathUtils.lerp(0.42, 1.0, 1 - dayAmount);
  }
  if (cycle.moonLight) {
    cycle.moonLight.intensity *= horizonVisibility;
  }

  state.publicState.moonPhase = moonPhase;
  state.publicState.moonIllumination = illumination;
  state.publicState.moonElevation = moonElevation;
  state.publicState.moonDirection.set(x, y, z).normalize();
}

function updatePublicSolarState(cycle, result, state) {
  const trueY = (cycle?.sunBody?.group?.position?.y ?? -ORBIT_RADIUS) - SUN_HORIZON_OFFSET;
  const solarElevation = THREE.MathUtils.clamp(trueY / ORBIT_RADIUS, -1, 1);
  const sunlight = smoothRange(-0.035, 0.08, solarElevation);
  const lowSun = sunlight * (1 - smoothRange(0.16, 0.55, solarElevation));
  const transmission = cloudTransmission();
  const storm = clamp01(globalThis.__riftSkyPhysicalV13?.storm ?? globalThis.__riftSkyPhysicalV12?.storm ?? 0);
  const sourceVisibility = sunlight * transmission * (1 - storm * 0.42);

  const sunPos = cycle?.sunBody?.group?.position;
  if (sunPos) {
    state.publicState.sunDirection
      .set(sunPos.x, trueY, sunPos.z)
      .normalize();
  }
  state.publicState.solarElevation = solarElevation;
  state.publicState.lowSun = lowSun;
  state.publicState.cloudTransmission = transmission;
  state.publicState.sourceVisibility = sourceVisibility;
  state.publicState.dayAmount = clamp01(result?.dayAmount ?? Math.max(0, solarElevation));
  globalThis.__riftCelestialOpticsV14 = state.publicState;
}

function hideLensFlare(state) {
  for (const element of state.elements) element.sprite.material.opacity = 0;
  state.publicState.flareStrength = 0;
  state.publicState.flareVisible = false;
}

function updateLensFlare(cycle, state, camera) {
  const optics = state.publicState;
  if (!camera?.isCamera || !cycle?.sunBody?.group || optics.sourceVisibility <= 0.002) {
    hideLensFlare(state);
    return;
  }

  cycle.sunBody.group.getWorldPosition(TMP_SUN_WORLD);
  camera.getWorldPosition(TMP_CAMERA_POS);
  camera.getWorldDirection(TMP_FORWARD).normalize();
  const facing = TMP_TO_SUN.copy(TMP_SUN_WORLD).sub(TMP_CAMERA_POS).normalize().dot(TMP_FORWARD);
  TMP_NDC.copy(TMP_SUN_WORLD).project(camera);

  // Camera-space visibility. Use a forward-vector test rather than NDC-Z so
  // this stays correct under both WebGL-style and WebGPU-style clip-space
  // conventions. The 1.18 XY margin gives a soft fade near the frame edge.
  if (
    facing <= 0.001 ||
    Math.abs(TMP_NDC.x) > 1.18 || Math.abs(TMP_NDC.y) > 1.18
  ) {
    hideLensFlare(state);
    return;
  }

  const edge = 1 - clamp01(Math.max(Math.abs(TMP_NDC.x), Math.abs(TMP_NDC.y)) / 1.18);
  const center = 1 - clamp01(Math.hypot(TMP_NDC.x, TMP_NDC.y) / 1.28);
  const lowSunBoost = 0.72 + optics.lowSun * 0.38;
  const strength = optics.sourceVisibility * smooth01(edge) * lowSunBoost;

  if (strength <= 0.002) {
    hideLensFlare(state);
    return;
  }

  TMP_RIGHT.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  TMP_UP.setFromMatrixColumn(camera.matrixWorld, 1).normalize();

  const planeDistance = 3.4;
  const fov = THREE.MathUtils.degToRad(Number(camera.fov) || 50);
  const halfH = Math.tan(fov * 0.5) * planeDistance;
  const halfW = halfH * (Number(camera.aspect) || 1);
  const time = performance.now() * 0.001;

  for (let i = 0; i < state.elements.length; i++) {
    const element = state.elements[i];
    const sprite = element.sprite;
    const factor = element.factor;

    // factor=1 sits at the solar source; negative values create the classic
    // aperture ghosts that continue past the frame center on the opposite side.
    const nx = TMP_NDC.x * factor;
    const ny = TMP_NDC.y * factor;
    TMP_WORLD.copy(TMP_CAMERA_POS)
      .addScaledVector(TMP_FORWARD, planeDistance)
      .addScaledVector(TMP_RIGHT, nx * halfW)
      .addScaledVector(TMP_UP, ny * halfH);
    sprite.position.copy(TMP_WORLD);

    const sourceBoost = element.kind === "source" ? (0.76 + center * 0.36) : 1;
    const breathe = 0.985 + Math.sin(time * 0.33 + i * 2.17) * 0.015;
    sprite.material.opacity = sprite.userData.baseOpacity * strength * sourceBoost * breathe;

    const scale = sprite.userData.baseScale
      * (0.82 + strength * 0.52)
      * (element.kind === "source" ? (0.90 + optics.lowSun * 0.18) : 1);
    sprite.scale.set(
      scale * sprite.userData.aspect,
      scale,
      1,
    );

    if (element.kind === "source") {
      TMP_COLOR.copy(FLARE_WHITE).lerp(FLARE_WARM, optics.lowSun * 0.72);
      sprite.material.color.copy(TMP_COLOR);
    }
  }

  optics.flareStrength = strength;
  optics.flareVisible = true;
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  const cycle = base.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight);
  installLensOptics(cycle);
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = base.updateDayNightCycle(cycle, dt);
  const state = stateByCycle.get(cycle) || installLensOptics(cycle);
  if (!state) return result;

  // Zero the optical elements before render. They remain in the render list so
  // the capture sprite can repopulate their opacity/positions in onBeforeRender
  // for the active camera later in this same frame.
  hideLensFlare(state);

  updatePublicSolarState(cycle, result, state);
  updateMoonEphemeris(cycle, result, state);
  return result;
}
