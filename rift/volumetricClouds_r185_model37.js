import * as THREE from "three";
import { float, mix, positionWorld, smoothstep, texture, uniform } from "three/tsl";
import * as base from "./volumetricClouds_r185_model36.js";

export * from "./volumetricClouds_r185_model36.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 3.7 — production reference volumes.
//
// Model 2.x used Perlin/Worley noise for both the macro silhouette and detail.
// No amount of uniform tuning could turn that broad field into consistently
// believable cumulus. Model 3.x fixes the architecture: an authored 3D atlas of
// meteorological cloud archetypes owns the large-scale silhouette while noise is
// demoted to interior variation, crown breakup, erosion and advection.
//
// This production wrapper keeps the proven Model 3.6 shape/raymarch/TAAU path,
// but adapts its lighting/occlusion contracts to the CURRENT production celestial
// system (v16 / __riftCelestialOpticsV14) instead of the older preview-branch
// celestial globals. It also keeps a cheap terrain shadow receiver and local
// camera->Sun/Moon optical-depth estimate so promoting Model 3 does not regress
// the cloud/ground/celestial interaction already present in Model 2.8/2.9.
// -----------------------------------------------------------------------------

const DAY_WHITE = new THREE.Color(0xfffbf2);
const GOLD = new THREE.Color(0xffc680);
const SUNSET = new THREE.Color(0xff8d58);
const COOL_SKY = new THREE.Color(0x7d93aa);
const COOL_SHADOW = new THREE.Color(0x53657b);
const MOON_SILVER = new THREE.Color(0xb8c8df);
const TMP = new THREE.Color();
const stateByHandle = new WeakMap();

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

function fract(v) {
  return v - Math.floor(v);
}

function maxChannel(c) {
  return c?.isColor ? Math.max(c.r, c.g, c.b, 1e-4) : 1;
}

function celestialState(sunDirection) {
  const optics = globalThis.__riftCelestialOpticsV14 || {};
  const sunset = globalThis.__riftSunsetAtmosphereV9
    || globalThis.__riftSunsetAtmosphereV8
    || globalThis.__riftSkyPhysicalV13
    || globalThis.__riftSkyPhysicalV12
    || {};

  const sunY = Number(optics.sunDirection?.y ?? sunDirection?.y) || -1;
  let altitudeDeg = Number(sunset.altitudeDeg);
  if (!Number.isFinite(altitudeDeg)) {
    altitudeDeg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(sunY, -1, 1)));
  }

  const day = clamp01(optics.dayAmount ?? sunset.daylight ?? smoothRange(-0.08, 0.08, sunY));
  const lowSun = clamp01(
    sunset.sunsetStrength
      ?? (smoothRange(-6, 1.5, altitudeDeg) * (1 - smoothRange(13, 26, altitudeDeg)))
  );
  const golden = clamp01(
    sunset.goldenHour
      ?? (smoothRange(-3, 2, altitudeDeg) * (1 - smoothRange(11, 22, altitudeDeg)))
  );
  const fire = clamp01(
    sunset.horizonFire
      ?? (smoothRange(-4, -0.2, altitudeDeg) * (1 - smoothRange(4, 10, altitudeDeg)))
  );
  const moonIllumination = clamp01(optics.moonIllumination ?? 1);
  const moonElevation = Number(optics.moonElevation) || -1;
  const moonAbove = smoothRange(-0.04, 0.10, moonElevation);
  const night = 1 - day;

  return { optics, sunset, altitudeDeg, day, lowSun, golden, fire, night, moonIllumination, moonAbove };
}

function tuneProductionLighting(handle, sunDirection, sunColor, rainIntensity = 0) {
  const u = handle?.uniforms;
  if (!u) return null;

  const c = celestialState(sunDirection);
  const weather = globalThis.__riftProceduralWeatherState || {};
  const storm = clamp01(weather.stormIntensity ?? rainIntensity);
  const clear = 1 - storm;
  const cloudT = clamp01(globalThis.__riftCloudShadowState?.averageTransmittance ?? 0.72);
  const brokenCloud = clamp01(1 - Math.abs(cloudT * 2 - 1));
  const localSunOcc = clamp01(globalThis.__riftSunDiskOcclusion || 0);
  const partialOcc = 1 - Math.min(1, Math.abs(localSunOcc - 0.52) / 0.52);
  const backlight = c.lowSun * clear * c.day * (0.42 + brokenCloud * 0.28 + partialOcc * 0.30);

  // Preserve actual radiometric energy from the base update; only change hue and
  // directional contrast. The cloud core remains cool while the solar-facing rim
  // warms through cream/gold/orange as the source approaches the horizon.
  if (u.sunColor?.value?.isColor) {
    const energy = maxChannel(u.sunColor.value);
    if (c.night > 0.55) {
      TMP.copy(MOON_SILVER).multiplyScalar(
        THREE.MathUtils.lerp(0.08, 0.28, Math.pow(c.moonIllumination, 0.75)) * c.moonAbove,
      );
      u.sunColor.value.lerp(TMP, c.night * c.moonAbove * 0.72);
    } else {
      TMP.copy(DAY_WHITE)
        .lerp(GOLD, Math.max(c.golden, c.lowSun * 0.48))
        .lerp(SUNSET, c.fire * 0.88);
      if (sunColor?.isColor) TMP.lerp(sunColor, 0.32);
      TMP.multiplyScalar(energy / maxChannel(TMP));
      u.sunColor.value.lerp(TMP, 0.40 + c.lowSun * 0.46);
      u.sunColor.value.multiplyScalar(1 + backlight * 0.22);
    }
  }

  if (u.ambientColor?.value?.isColor) {
    const energy = maxChannel(u.ambientColor.value);
    TMP.copy(COOL_SKY).lerp(COOL_SHADOW, c.lowSun * 0.54 + storm * 0.45);
    if (c.night > 0.5) TMP.lerp(MOON_SILVER, c.moonIllumination * 0.30);
    TMP.multiplyScalar(energy / maxChannel(TMP));
    u.ambientColor.value.lerp(TMP, 0.34 + c.lowSun * 0.24);
  }

  // These controls are consumed INSIDE Model 3.1's reference-aware shader.
  // Together they create the photographic hierarchy we were missing: bright crown
  // and rim -> gray-blue core -> dark, relatively flat condensation base.
  if (u.m2SilverStrength) {
    u.m2SilverStrength.value = THREE.MathUtils.lerp(
      Number(u.m2SilverStrength.value) || 0.52,
      THREE.MathUtils.lerp(0.58, 0.94, backlight) * THREE.MathUtils.lerp(1, 0.44, storm),
      0.72,
    );
  }
  if (u.m31CrownLightBoost) {
    u.m31CrownLightBoost.value = THREE.MathUtils.lerp(
      Number(u.m31CrownLightBoost.value) || 1.14,
      THREE.MathUtils.lerp(1.18, 1.58, backlight) * THREE.MathUtils.lerp(1, 0.88, storm),
      0.68,
    );
  }
  if (u.m31SelfShadow) {
    u.m31SelfShadow.value = THREE.MathUtils.lerp(
      Number(u.m31SelfShadow.value) || 1.0,
      THREE.MathUtils.lerp(1.02, 1.24, c.lowSun) + storm * 0.12,
      0.60,
    );
  }
  if (u.m31BaseDarkening) {
    u.m31BaseDarkening.value = THREE.MathUtils.lerp(
      Number(u.m31BaseDarkening.value) || 0.55,
      THREE.MathUtils.lerp(0.58, 0.78, c.lowSun) + storm * 0.08,
      0.62,
    );
  }
  if (u.m2LightExtinction) {
    u.m2LightExtinction.value = THREE.MathUtils.lerp(
      Number(u.m2LightExtinction.value) || 0.72,
      THREE.MathUtils.lerp(0.72, 0.91, c.lowSun) + storm * 0.10,
      0.58,
    );
  }
  if (u.m2AmbientStrength) {
    u.m2AmbientStrength.value = THREE.MathUtils.lerp(
      Number(u.m2AmbientStrength.value) || 0.56,
      THREE.MathUtils.lerp(0.58, 0.42, c.lowSun) * THREE.MathUtils.lerp(1, 0.88, storm),
      0.56,
    );
  }
  if (u.m2MultiScatter) {
    u.m2MultiScatter.value = THREE.MathUtils.lerp(
      Number(u.m2MultiScatter.value) || 0.26,
      THREE.MathUtils.lerp(0.27, 0.34, backlight) * THREE.MathUtils.lerp(1, 0.80, storm),
      0.54,
    );
  }

  return { ...c, storm, cloudT, brokenCloud, localSunOcc, partialOcc, backlight };
}

function sampleAtlasNearest(handle, u, v, w) {
  const atlas = handle?.__riftModel3Atlas;
  const image = atlas?.texture?.image;
  const data = image?.data;
  const width = Number(atlas?.width || image?.width) || 0;
  const height = Number(atlas?.height || image?.height) || 0;
  const depth = Number(atlas?.depth || image?.depth) || 0;
  if (!data || width < 1 || height < 1 || depth < 1) return 0;

  const x = Math.floor(fract(u) * width) % width;
  const y = Math.min(height - 1, Math.max(0, Math.floor(clamp01(v) * height)));
  const z = Math.floor(fract(w) * depth) % depth;
  const idx = (x + width * (y + height * z)) * 4;
  const weights = handle.uniforms?.m3ReferenceWeights?.value;
  const wr = Number(weights?.x) || 0;
  const wg = Number(weights?.y) || 0;
  const wb = Number(weights?.z) || 0;
  const wa = Number(weights?.w) || 0;
  return clamp01(
    (data[idx] / 255) * wr
      + (data[idx + 1] / 255) * wg
      + (data[idx + 2] / 255) * wb
      + (data[idx + 3] / 255) * wa,
  );
}

function macroDensityAt(handle, x, y, z) {
  const u = handle?.uniforms;
  if (!u?.m3ReferenceOffset?.value || !u?.m3ReferenceWorldScale) return 0;
  const baseY = Number(u.cloudBaseY?.value) || 50;
  const topY = Number(u.cloudTopY?.value) || 220;
  if (y <= baseY || y >= topY) return 0;
  const h = clamp01((y - baseY) / Math.max(1, topY - baseY));
  const scale = Number(u.m3ReferenceWorldScale.value) || (1 / 1080);
  const off = u.m3ReferenceOffset.value;
  const raw = sampleAtlasNearest(handle, x * scale + off.x, h, z * scale + off.y);
  const coverage = clamp01(u.coverage?.value ?? 0.5);
  const threshold = THREE.MathUtils.lerp(0.47, 0.12, coverage);
  return smoothRange(threshold, threshold + 0.205, raw);
}

function sourceOcclusion(handle, camera, direction) {
  const u = handle?.uniforms;
  if (!u || !camera?.position || !direction?.isVector3 || direction.y <= 0.018) return 0;
  const baseY = Number(u.cloudBaseY?.value) || 50;
  const topY = Number(u.cloudTopY?.value) || 220;
  const origin = camera.position;
  const t0 = (baseY - origin.y) / direction.y;
  const t1 = (topY - origin.y) / direction.y;
  const start = Math.max(0, Math.min(t0, t1));
  const end = Math.max(t0, t1);
  if (!(end > start)) return 0;

  let optical = 0;
  const samples = 7;
  for (let i = 0; i < samples; i++) {
    const f = (i + 0.5) / samples;
    const t = THREE.MathUtils.lerp(start, end, f);
    optical += macroDensityAt(
      handle,
      origin.x + direction.x * t,
      origin.y + direction.y * t,
      origin.z + direction.z * t,
    );
  }
  optical /= samples;
  const density = Number(u.m2DensityScale?.value) || 1;
  return clamp01(1 - Math.exp(-optical * density * 2.8));
}

function updateSourceOcclusion(handle, dt, camera) {
  const optics = globalThis.__riftCelestialOpticsV14;
  if (!optics) return null;
  let state = stateByHandle.get(handle);
  if (!state) {
    state = { sun: 0, moon: 0, sunTarget: 0, moonTarget: 0 };
    stateByHandle.set(handle, state);
  }

  state.sunTarget = sourceOcclusion(handle, camera, optics.sunDirection);
  state.moonTarget = sourceOcclusion(handle, camera, optics.moonDirection);
  const safeDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
  const response = 1 - Math.exp(-safeDt * 4.6);
  state.sun = THREE.MathUtils.lerp(state.sun, state.sunTarget, response);
  state.moon = THREE.MathUtils.lerp(state.moon, state.moonTarget, response * 0.8);
  globalThis.__riftSunDiskOcclusion = clamp01(state.sun);
  globalThis.__riftMoonDiskOcclusion = clamp01(state.moon);
  globalThis.__riftProceduralCloudOcclusion = clamp01(state.sun);
  return state;
}

function installTerrainShadowReceiver(handle) {
  const scene = handle?.__riftScene;
  const shadowTexture = globalThis.__riftCloudShadowTexture;
  if (!scene || !shadowTexture) return null;
  const current = handle.__riftTerrainShadow37;
  if (current?.parent && current.material?.userData?.__riftCloudShadow37) return current;

  let receiver = null;
  scene.traverse((obj) => {
    if (receiver || !obj?.isMesh) return;
    const m = obj.material;
    if (
      m?.isMeshStandardNodeMaterial
      && m.userData?.causticTimeUniform
      && obj.receiveShadow === true
      && obj.geometry?.attributes?.color
    ) receiver = obj;
  });
  if (!receiver) return null;
  const material = receiver.material;
  if (material.userData.__riftCloudShadow37) {
    handle.__riftTerrainShadow37 = receiver;
    return receiver;
  }
  const baseColorNode = material.colorNode;
  if (!baseColorNode) return null;

  const scaleValue = Number(globalThis.__riftCloudShadowState?.worldScale)
    || ((Number(handle.quality?.weatherScale) || 0.001) * 0.72);
  const strength = uniform(0);
  const uv = positionWorld.xz.mul(float(scaleValue)).fract();
  const transmission = texture(shadowTexture, uv).r;
  const shadowFactor = mix(float(0.58), float(1), transmission);
  const aboveWater = smoothstep(float(8.05), float(9.05), positionWorld.y);
  material.colorNode = baseColorNode.mul(mix(float(1), shadowFactor, strength.mul(aboveWater)));
  material.userData.__riftCloudShadow37 = { baseColorNode, strength, shadowTexture, scaleValue };
  material.needsUpdate = true;
  handle.__riftTerrainShadow37 = receiver;
  return receiver;
}

function updateTerrainShadowReceiver(handle, lighting) {
  const receiver = installTerrainShadowReceiver(handle);
  const state = receiver?.material?.userData?.__riftCloudShadow37;
  if (!state?.strength) return false;
  const optics = globalThis.__riftCelestialOpticsV14;
  const day = clamp01(optics?.dayAmount ?? lighting?.day ?? 0);
  const sunY = Number(optics?.sunDirection?.y) || 0;
  const sunAbove = smoothRange(0.005, 0.15, sunY);
  const avgT = clamp01(globalThis.__riftCloudShadowState?.averageTransmittance ?? 1);
  const presence = 1 - avgT;
  const storm = clamp01(lighting?.storm ?? 0);
  state.strength.value = clamp01(
    day * sunAbove * THREE.MathUtils.lerp(0.54, 0.82, presence) * THREE.MathUtils.lerp(1, 0.82, storm),
  );
  return true;
}

function restoreTerrainShadowReceiver(handle) {
  const receiver = handle?.__riftTerrainShadow37;
  const material = receiver?.material;
  const state = material?.userData?.__riftCloudShadow37;
  if (material && state?.baseColorNode) {
    material.colorNode = state.baseColorNode;
    delete material.userData.__riftCloudShadow37;
    material.needsUpdate = true;
  }
  if (handle) handle.__riftTerrainShadow37 = null;
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (!handle) return handle;
  handle.__riftModel37 = true;
  handle.__riftScene = scene;
  return handle;
}

export function updateVolumetricClouds(
  handle,
  dt,
  camera,
  sunDirection,
  sunColor,
  ambientColor,
  lightningFlash,
  lightningColor,
  windX = 0,
  windZ = 0,
  rainIntensity = 0,
  currentBiome = "default",
) {
  base.updateVolumetricClouds(
    handle,
    dt,
    camera,
    sunDirection,
    sunColor,
    ambientColor,
    lightningFlash,
    lightningColor,
    windX,
    windZ,
    rainIntensity,
    currentBiome,
  );
  if (!handle || !camera) return;

  const occlusion = updateSourceOcclusion(handle, dt, camera);
  const lighting = tuneProductionLighting(handle, sunDirection, sunColor, rainIntensity);
  const terrainShadowActive = updateTerrainShadowReceiver(handle, lighting);

  globalThis.__riftCloudModel37 = {
    version: "3.7-reference-volume-production",
    architecture: "authored 3D macro archetypes + Perlin/Worley detail + reference-aware self-shadow + current celestial coupling",
    altitudeDeg: lighting?.altitudeDeg ?? -90,
    lowSun: lighting?.lowSun ?? 0,
    backlight: lighting?.backlight ?? 0,
    sunOcclusion: occlusion?.sun ?? 0,
    moonOcclusion: occlusion?.moon ?? 0,
    terrainShadowActive,
    cloudTransmittance: globalThis.__riftCloudShadowState?.averageTransmittance ?? 1,
    weights: handle.uniforms?.m3ReferenceWeights?.value?.toArray?.() ?? null,
    atlas: handle.__riftModel3Atlas
      ? [handle.__riftModel3Atlas.width, handle.__riftModel3Atlas.height, handle.__riftModel3Atlas.depth]
      : null,
    renderScale: handle.__riftModel2Quality?.renderScale || 0,
    viewSteps: handle.__riftModel2Quality?.viewSteps || 0,
    lightSteps: handle.__riftModel2Quality?.lightSteps || 0,
    threeRevision: THREE.REVISION,
  };
}

export function disposeVolumetricClouds(handle) {
  restoreTerrainShadowReceiver(handle);
  stateByHandle.delete(handle);
  delete globalThis.__riftCloudModel37;
  delete globalThis.__riftSunDiskOcclusion;
  delete globalThis.__riftMoonDiskOcclusion;
  if (handle) handle.__riftScene = null;
  return base.disposeVolumetricClouds(handle);
}
