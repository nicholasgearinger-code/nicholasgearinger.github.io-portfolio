import * as THREE from "three";
import { float, mix, positionWorld, smoothstep, texture, uniform } from "three/tsl";
import * as base from "./volumetricClouds_r185_model27.js";
import { sampleWeatherCpu } from "./cloudWeatherModel2.js";
import { createRiftCloudShadowMap28 } from "./cloudShadowModel28.js";

export * from "./volumetricClouds_r185_model27.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 2.8 — structured cumulus + celestial occlusion + shadows.
//
// Goals for the photographic/Sky-Pro-style reference:
//   * discrete cloud families instead of broad horizontal slabs;
//   * flatter condensation bases with dense, dimensional cores;
//   * taller cauliflower crowns and more strongly eroded silhouettes;
//   * a cloud passing over the Sun/Moon actually hides the celestial disc;
//   * the same moving field drives a cheap projected terrain-shadow texture;
//   * keep Model 2.6/2.7's mobile TAAU/ray-step budget unchanged.
//
// All structure changes below are existing uniform changes. The only new CPU work
// is a 6 Hz 128-ish shadow texture plus two five-sample line-of-sight tests, so we
// do NOT add a second cloud raymarch or another WebGPU render pass.
// -----------------------------------------------------------------------------

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

function hash2(x, y) {
  return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
}

function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fract(x);
  const fy = fract(y);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, ux),
    THREE.MathUtils.lerp(c, d, ux),
    uy,
  );
}

function structuredRayLobe(u, v, baseOffset, detailOffset, convection) {
  const bx = Number(baseOffset?.x) || 0;
  const bz = Number(baseOffset?.z) || 0;
  const dx = Number(detailOffset?.x) || 0;
  const dz = Number(detailOffset?.z) || 0;
  const broad = valueNoise(u * 15.5 + bx * 113.0, v * 15.5 + bz * 113.0);
  const detail = valueNoise(u * 37.0 + dx * 79.0, v * 37.0 + dz * 79.0);
  const combined = broad * 0.76 + detail * 0.24;
  const threshold = THREE.MathUtils.lerp(0.47, 0.42, clamp01(convection));
  return smooth01((combined - threshold) / 0.25);
}

function ensureState(handle) {
  let state = stateByHandle.get(handle);
  if (state) return state;
  state = {
    sunOcclusion: 0,
    moonOcclusion: 0,
    targetSunOcclusion: 0,
    targetMoonOcclusion: 0,
  };
  stateByHandle.set(handle, state);
  return state;
}

function installStructuredShadow(handle) {
  if (!handle || handle.__riftModel28ShadowInstalled) return;

  const oldShadow = handle.__riftModel2Shadow;
  const size = Number(handle.__riftModel2Quality?.shadowSize) || 128;
  const shadow = createRiftCloudShadowMap28(size);
  handle.__riftModel2Shadow = shadow;
  handle.__riftModel28ShadowInstalled = true;

  // The old texture has not been exposed to any long-lived material yet when this
  // runs (createVolumetricClouds happens before a level is entered), so it is safe
  // to reclaim it immediately.
  oldShadow?.dispose?.();

  const worldScale = (Number(handle.quality?.weatherScale) || 0.001) * 0.72;
  globalThis.__riftCloudShadowTexture = shadow.texture;
  globalThis.__riftCloudShadowState = {
    texture: shadow.texture,
    averageTransmittance: 1,
    updateHz: Math.round(1 / shadow.updateInterval),
    worldScale,
    model: "2.8-structured",
  };
}

function tuneCloudAnatomy(handle, rainIntensity = 0) {
  const u = handle?.uniforms;
  if (!u) return null;

  const weather = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(weather?.stormIntensity ?? rainIntensity);
  const requestedCoverage = clamp01(weather?.cloudCoverage ?? 0.46);
  const humidity = clamp01(weather?.humidity ?? 0.70);
  const requestedConvection = clamp01(weather?.convection ?? 0.80);
  const convection = THREE.MathUtils.lerp(Math.max(0.82, requestedConvection), 0.995, storm);

  // Fair-weather coverage is intentionally modest. More blue gaps + denser cloud
  // cores reads as individual cumulus families; high coverage + low density is
  // exactly what produces the soft horizontal sheet visible in the current build.
  const fairCoverage = THREE.MathUtils.clamp(
    0.38 + requestedCoverage * 0.17 + humidity * 0.055,
    0.43,
    0.54,
  );
  if (u.coverage) u.coverage.value = THREE.MathUtils.lerp(fairCoverage, 0.89, storm);
  if (u.density) u.density.value = THREE.MathUtils.lerp(0.64, 0.87, storm);
  if (u.humidity) u.humidity.value = THREE.MathUtils.lerp(Math.max(0.69, humidity), 0.97, storm);
  if (u.convection) u.convection.value = convection;
  if (u.erosion) u.erosion.value = THREE.MathUtils.lerp(0.61, 0.35, storm);

  // Larger base scale = smaller/more distinct primary lobes. Strong boundary
  // erosion exposes cauliflower crowns while the increased density scale keeps
  // interiors solid instead of turning the entire cloud into fuzzy noise.
  if (u.m2BaseScale) u.m2BaseScale.value = THREE.MathUtils.lerp(0.585, 0.46, storm);
  if (u.m2DetailScale) u.m2DetailScale.value = THREE.MathUtils.lerp(7.15, 5.20, storm);
  if (u.m2DomainWarp) u.m2DomainWarp.value = THREE.MathUtils.lerp(0.094, 0.066, storm);
  if (u.m2EdgeErosion) u.m2EdgeErosion.value = THREE.MathUtils.lerp(0.62, 0.36, storm);
  if (u.m2DensityBias) u.m2DensityBias.value = THREE.MathUtils.lerp(-0.025, -0.012, storm);
  if (u.m2DensityScale) u.m2DensityScale.value = THREE.MathUtils.lerp(1.18, 1.29, storm);

  // Condensation base stays nearly flat. Fair cumulus gets enough vertical room
  // to build towers without becoming the full-height blurry wall from the current
  // screenshot. Storms retain the ability to grow into a deep cumulonimbus deck.
  const baseY = THREE.MathUtils.lerp(62, 34, storm);
  const fairThickness = 126 + convection * 38 + humidity * 14;
  const thickness = THREE.MathUtils.lerp(fairThickness, 264, storm);
  const topY = baseY + thickness;
  if (u.cloudBaseY) u.cloudBaseY.value = baseY;
  if (u.cloudTopY) u.cloudTopY.value = topY;

  if (handle.mesh) handle.mesh.position.y = baseY;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;

  // Thin high cloud is useful, but it should never compete with the dimensional
  // cumulus field in the reference look.
  if (handle.__riftCirrus?.material) {
    handle.__riftCirrus.material.opacity *= THREE.MathUtils.lerp(0.70, 0.55, storm);
  }

  return {
    storm,
    humidity,
    convection,
    coverage: Number(u.coverage?.value) || fairCoverage,
    density: Number(u.density?.value) || 0.64,
    baseY,
    topY,
  };
}

function updateStructuredShadow(handle, dt, sunDirection, anatomy) {
  const u = handle?.uniforms;
  const shadow = handle?.__riftModel2Shadow;
  if (!u || !shadow?.updateAfterTune || !anatomy) return;

  const optics = globalThis.__riftCelestialOpticsV14;
  const realSunDirection = optics?.sunDirection?.isVector3
    ? optics.sunDirection
    : sunDirection;

  shadow.updateAfterTune(dt, {
    weatherPair: handle.__riftModel2WeatherPair,
    offsetA: u.m2WeatherOffsetA?.value,
    offsetB: u.m2WeatherOffsetB?.value,
    morph: Number(u.m2WeatherBlend?.value) || 0,
    sunDirection: realSunDirection,
    coverage: anatomy.coverage,
    density: anatomy.density,
    storm: anatomy.storm,
    convection: anatomy.convection,
    baseOffset: u.m2BaseOffset?.value,
    detailOffset: u.m2DetailOffset?.value,
  });

  const worldScale = (Number(handle.quality?.weatherScale) || 0.001) * 0.72;
  globalThis.__riftCloudShadowTexture = shadow.texture;
  globalThis.__riftCloudShadowState = {
    texture: shadow.texture,
    averageTransmittance: shadow.averageTransmittance,
    updateHz: Math.round(1 / shadow.updateInterval),
    worldScale,
    offsetA: u.m2WeatherOffsetA?.value,
    offsetB: u.m2WeatherOffsetB?.value,
    morph: Number(u.m2WeatherBlend?.value) || 0,
    model: "2.8-structured",
  };
}

function installTerrainShadowReceiver(handle) {
  const scene = handle?.__riftScene;
  const shadowTexture = handle?.__riftModel2Shadow?.texture;
  if (!scene || !shadowTexture) return null;

  const current = handle.__riftTerrainShadowReceiver;
  if (current?.parent && current.material?.userData?.__riftCloudShadow28) return current;
  handle.__riftTerrainShadowReceiver = null;

  let receiver = null;
  scene.traverse((obj) => {
    if (receiver || !obj?.isMesh) return;
    const material = obj.material;

    // Coral Shallows' real terrain is uniquely identifiable without importing
    // main_game internals: it is the large MeshStandardNodeMaterial receiver with
    // the caustic-time uniform installed by the seafloor material. Water and props
    // do not carry that marker. This keeps the shadow sample off unrelated meshes.
    if (
      material?.isMeshStandardNodeMaterial &&
      material.userData?.causticTimeUniform &&
      obj.receiveShadow === true &&
      obj.geometry?.attributes?.color
    ) {
      receiver = obj;
    }
  });

  if (!receiver) return null;
  const material = receiver.material;
  if (material.userData.__riftCloudShadow28) {
    handle.__riftTerrainShadowReceiver = receiver;
    return receiver;
  }

  const baseColorNode = material.colorNode;
  if (!baseColorNode) return null;

  const worldScale = (Number(handle.quality?.weatherScale) || 0.001) * 0.72;
  const strengthUniform = uniform(0);
  const shadowUV = positionWorld.xz.mul(float(worldScale)).fract();
  const cloudTransmittance = texture(shadowTexture, shadowUV).r;

  // The map stores physical-ish transmittance (1=clear, 0=dense cloud). Even the
  // darkest patch keeps ~56% of the material's base color because skylight still
  // illuminates a beach under cloud cover. The normal PBR lighting then supplies
  // the remaining directional/ambient response.
  const shadowFactor = mix(float(0.56), float(1.0), cloudTransmittance);
  const aboveWater = smoothstep(float(8.05), float(9.05), positionWorld.y);
  const appliedShadow = mix(
    float(1.0),
    shadowFactor,
    strengthUniform.mul(aboveWater),
  );

  material.colorNode = baseColorNode.mul(appliedShadow);
  material.userData.__riftCloudShadow28 = {
    strengthUniform,
    baseColorNode,
    shadowTexture,
    worldScale,
  };
  material.needsUpdate = true;
  handle.__riftTerrainShadowReceiver = receiver;

  return receiver;
}

function updateTerrainShadowReceiver(handle, anatomy) {
  const receiver = installTerrainShadowReceiver(handle);
  const state = receiver?.material?.userData?.__riftCloudShadow28;
  if (!state?.strengthUniform) return false;

  const optics = globalThis.__riftCelestialOpticsV14;
  const daylight = clamp01(optics?.dayAmount ?? 0);
  const solarElevation = Number(optics?.solarElevation) || -1;
  const sunAbove = smoothRange(-0.015, 0.12, solarElevation);
  const averageT = clamp01(handle.__riftModel2Shadow?.averageTransmittance ?? 1);
  const shadowPresence = 1 - averageT;
  const storm = clamp01(anatomy?.storm ?? 0);

  // Cloud shadows are strongest under a healthy daytime Sun. Overcast still has
  // spatial variation, but a fully storm-dark sky shifts more toward diffuse
  // illumination, so the projected pattern softens slightly instead of becoming
  // an implausible black cookie-cutter texture.
  const targetStrength = daylight
    * sunAbove
    * THREE.MathUtils.lerp(0.56, 0.82, shadowPresence)
    * THREE.MathUtils.lerp(1.0, 0.84, storm);
  state.strengthUniform.value = clamp01(targetStrength);
  return true;
}

function restoreTerrainShadowReceiver(handle) {
  const receiver = handle?.__riftTerrainShadowReceiver;
  const material = receiver?.material;
  const state = material?.userData?.__riftCloudShadow28;
  if (material && state?.baseColorNode) {
    material.colorNode = state.baseColorNode;
    delete material.userData.__riftCloudShadow28;
    material.needsUpdate = true;
  }
  if (handle) handle.__riftTerrainShadowReceiver = null;
}

function computeCelestialOcclusion(handle, camera, direction, anatomy) {
  const u = handle?.uniforms;
  const pair = handle?.__riftModel2WeatherPair;
  if (!u || !pair?.a || !pair?.b || !camera?.position || !direction?.isVector3 || !anatomy) return 0;

  const dirY = Number(direction.y) || 0;
  if (dirY <= 0.025) return 0;

  const baseY = anatomy.baseY;
  const topY = anatomy.topY;
  const origin = camera.position;
  const tBase = (baseY - origin.y) / dirY;
  const tTop = (topY - origin.y) / dirY;
  const tStart = Math.max(0, Math.min(tBase, tTop));
  const tEnd = Math.max(tBase, tTop);
  if (!(tEnd > tStart)) return 0;

  const worldScale = (Number(handle.quality?.weatherScale) || 0.001) * 0.72;
  const ax = Number(u.m2WeatherOffsetA?.value?.x) || 0;
  const ay = Number(u.m2WeatherOffsetA?.value?.y) || 0;
  const bx = Number(u.m2WeatherOffsetB?.value?.x) || 0;
  const by = Number(u.m2WeatherOffsetB?.value?.y) || 0;
  const morph = clamp01(u.m2WeatherBlend?.value);
  const baseOffset = u.m2BaseOffset?.value;
  const detailOffset = u.m2DetailOffset?.value;

  let optical = 0;
  const samples = 5;
  for (let i = 0; i < samples; i++) {
    const f = (i + 0.5) / samples;
    const t = THREE.MathUtils.lerp(tStart, tEnd, f);
    const x = origin.x + direction.x * t;
    const y = origin.y + direction.y * t;
    const z = origin.z + direction.z * t;
    const h = clamp01((y - baseY) / Math.max(1, topY - baseY));
    const wu = x * worldScale;
    const wv = z * worldScale;

    const wa = sampleWeatherCpu(pair.a, wu + ax, wv + ay);
    const wb = sampleWeatherCpu(pair.b, wu + bx, wv + by);
    const coverageSignal = THREE.MathUtils.lerp(wa[0], wb[0], morph);
    const cloudType = clamp01(THREE.MathUtils.lerp(wa[1], wb[1], morph));
    const localHumidity = clamp01(THREE.MathUtils.lerp(wa[2], wb[2], morph));

    const formThreshold = 0.61 - anatomy.coverage * 0.34;
    const formed = smooth01((coverageSignal - formThreshold) / 0.25);
    const lobe = structuredRayLobe(wu, wv, baseOffset, detailOffset, anatomy.convection);

    // Same meteorological idea as the GPU shader: flatter stratus stays lower;
    // convective cumulus survives much higher into the slab.
    const baseGate = smoothRange(0.012, 0.07, h);
    const stratusTop = 1 - smoothRange(0.35, 0.61, h);
    const cumulusTopStart = THREE.MathUtils.lerp(0.60, 0.82, anatomy.convection);
    const cumulusTop = 1 - smoothRange(cumulusTopStart, 0.995, h);
    const towerTop = 1 - smoothRange(0.86, 0.999, h);
    const stratusWeight = 1 - smoothRange(0.26, 0.48, cloudType);
    const towerWeight = smoothRange(0.65, 0.91, cloudType) * anatomy.convection;
    const fairProfile = THREE.MathUtils.lerp(cumulusTop, stratusTop, stratusWeight);
    const verticalProfile = baseGate * THREE.MathUtils.lerp(fairProfile, towerTop, towerWeight);

    optical += formed
      * THREE.MathUtils.lerp(0.32, 1.12, lobe)
      * verticalProfile
      * THREE.MathUtils.lerp(0.78, 1.18, localHumidity)
      * anatomy.density;
  }

  optical /= samples;
  optical *= THREE.MathUtils.lerp(2.1, 3.1, anatomy.storm);
  return clamp01(1 - Math.exp(-optical));
}

function updateCelestialOcclusion(handle, dt, camera, anatomy) {
  const optics = globalThis.__riftCelestialOpticsV14;
  if (!optics || !anatomy) return;

  const state = ensureState(handle);
  const sunDir = optics.sunDirection;
  const moonDir = optics.moonDirection;

  state.targetSunOcclusion = computeCelestialOcclusion(handle, camera, sunDir, anatomy);
  state.targetMoonOcclusion = computeCelestialOcclusion(handle, camera, moonDir, anatomy);

  // A little temporal inertia prevents a coarse five-sample CPU estimate from
  // flickering at cloud boundaries while still allowing a cloud to visibly cross
  // the Sun over roughly a fraction of a second.
  const safeDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
  const response = 1 - Math.exp(-safeDt * 5.2);
  state.sunOcclusion = THREE.MathUtils.lerp(state.sunOcclusion, state.targetSunOcclusion, response);
  state.moonOcclusion = THREE.MathUtils.lerp(state.moonOcclusion, state.targetMoonOcclusion, response * 0.78);

  globalThis.__riftSunDiskOcclusion = clamp01(state.sunOcclusion);
  globalThis.__riftMoonDiskOcclusion = clamp01(state.moonOcclusion);
  // Keep the legacy/global contract populated for god rays and any system that
  // wants local source occlusion rather than the whole-map average.
  globalThis.__riftProceduralCloudOcclusion = clamp01(state.sunOcclusion);

  // When the Sun is partially hidden, forward scattering/silver lining should
  // become MORE visible around the cloud edge. The shader's phase function keeps
  // this boost strongly view/light-direction dependent rather than brightening all
  // edges uniformly.
  const partialSun = 1 - Math.min(1, Math.abs(state.sunOcclusion - 0.5) / 0.5);
  if (handle?.uniforms?.m2SilverStrength) {
    const current = Number(handle.uniforms.m2SilverStrength.value) || 0;
    const daylight = clamp01(optics.dayAmount);
    handle.uniforms.m2SilverStrength.value = Math.min(
      0.72,
      current * (1 + partialSun * daylight * 0.48),
    );
  }

  return state;
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (!handle) return handle;
  handle.__riftModel28 = true;
  handle.__riftScene = scene;
  installStructuredShadow(handle);
  ensureState(handle);
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
  installStructuredShadow(handle);
  const anatomy = tuneCloudAnatomy(handle, rainIntensity);
  updateStructuredShadow(handle, dt, sunDirection, anatomy);
  const terrainShadowActive = updateTerrainShadowReceiver(handle, anatomy);
  const occ = updateCelestialOcclusion(handle, dt, camera, anatomy);

  globalThis.__riftCloudModel28 = {
    version: "2.8-structured-cumulus-occlusion-shadows",
    coverage: anatomy?.coverage || 0,
    density: anatomy?.density || 0,
    humidity: anatomy?.humidity || 0,
    convection: anatomy?.convection || 0,
    baseY: anatomy?.baseY || 0,
    topY: anatomy?.topY || 0,
    sunOcclusion: occ?.sunOcclusion || 0,
    moonOcclusion: occ?.moonOcclusion || 0,
    terrainShadowActive,
    terrainShadowStrength: Number(
      handle.__riftTerrainShadowReceiver?.material?.userData?.__riftCloudShadow28?.strengthUniform?.value,
    ) || 0,
    shadowTransmittance: handle.__riftModel2Shadow?.averageTransmittance ?? 1,
    shadowHz: handle.__riftModel2Shadow?.updateInterval
      ? Math.round(1 / handle.__riftModel2Shadow.updateInterval)
      : 0,
    renderScale: handle.__riftModel2Quality?.renderScale || 0,
    viewSteps: handle.__riftModel2Quality?.viewSteps || 0,
    lightSteps: handle.__riftModel2Quality?.lightSteps || 0,
    threeRevision: THREE.REVISION,
  };
}

export function disposeVolumetricClouds(handle) {
  restoreTerrainShadowReceiver(handle);
  stateByHandle.delete(handle);
  delete globalThis.__riftCloudModel28;
  delete globalThis.__riftSunDiskOcclusion;
  delete globalThis.__riftMoonDiskOcclusion;
  if (handle) handle.__riftScene = null;
  return base.disposeVolumetricClouds(handle);
}
