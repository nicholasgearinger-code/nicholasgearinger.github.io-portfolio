import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model41.js";

export * from "./volumetricClouds_r185_model41.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 4.2 — sunset-reference stratocumulus + photographic Sun.
//
// 4.1 separated the Model 4 reference volume, but the review target is more
// specific: thin, broken, horizontally stretched sunset banks with clear sky
// between layers, plus a bright white-yellow solar disc surrounded by a compact
// warm halo. This wrapper keeps the proven Model 4 lighting/raymarch/godray path
// and retunes only low-Sun composition/presentation.
// -----------------------------------------------------------------------------

const TMP_WEIGHTS = new THREE.Vector4();
const TMP_WORLD = new THREE.Vector3();
const SUN_CORE = new THREE.Color(0xffffe0);
const SUN_WARM = new THREE.Color(0xfff0ad);
const HALO_GOLD = new THREE.Color(0xffb34f);
const HALO_ORANGE = new THREE.Color(0xff8a35);

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

function stateFor(sunDirection, rainIntensity = 0) {
  const celestial = globalThis.__riftCelestialModel35 || globalThis.__riftCelestialModel34 || {};
  const weather = globalThis.__riftProceduralWeatherState || {};
  const sunY = Number(sunDirection?.y) || 0;
  const altFromState = Number(celestial.altitudeDeg);
  const altitude = Number.isFinite(altFromState)
    ? altFromState
    : THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(sunY, -1, 1)));
  const daylight = clamp01(celestial.daylight ?? smoothRange(-0.10, 0.08, sunY));
  const storm = clamp01(weather.stormIntensity ?? rainIntensity);
  const golden = clamp01(
    celestial.goldenHour
      ?? (smoothRange(-5, 0.8, altitude) * (1 - smoothRange(12, 23, altitude)))
  ) * daylight;
  const horizon = smoothRange(-4, 0.5, altitude) * (1 - smoothRange(10, 18, altitude));
  const sunsetReference = clamp01(Math.max(golden, horizon * 0.95)) * (1 - storm);
  return { altitude, daylight, storm, golden, horizon, sunsetReference };
}

function tuneSunsetCloudProfile(handle, state) {
  const u = handle?.uniforms;
  if (!u) return;
  const t = state.sunsetReference;
  if (t < 0.005) return;

  // The target reference is a field of shallow broken banks, not a deep nearby
  // cumulus tower. Keep the photo-derived dusk channels, but make them smaller,
  // thinner and more eroded so blue/orange gaps survive between cloud bodies.
  const target = TMP_WEIGHTS.set(0.06, 1.00, 0.46, 0.005);
  const weights = u.m3ReferenceWeights?.value;
  if (weights?.isVector4) {
    const sum = target.x + target.y + target.z + target.w;
    const response = 0.34 + t * 0.22;
    weights.set(
      THREE.MathUtils.lerp(weights.x, target.x / sum, response),
      THREE.MathUtils.lerp(weights.y, target.y / sum, response),
      THREE.MathUtils.lerp(weights.z, target.z / sum, response),
      THREE.MathUtils.lerp(weights.w, target.w / sum, response),
    );
  }

  if (u.m3ReferenceStrength) {
    u.m3ReferenceStrength.value = THREE.MathUtils.lerp(
      u.m3ReferenceStrength.value,
      0.77,
      0.42 * t,
    );
  }
  if (u.m31CrownBreakup) {
    u.m31CrownBreakup.value = THREE.MathUtils.lerp(
      u.m31CrownBreakup.value,
      0.98,
      0.42 * t,
    );
  }
  if (u.m2EdgeErosion) {
    u.m2EdgeErosion.value = THREE.MathUtils.lerp(
      u.m2EdgeErosion.value,
      0.67,
      0.44 * t,
    );
  }
  if (u.m2DomainWarp) {
    const original = Number(handle?.__riftModel40State?.baseDomainWarp) || 1;
    u.m2DomainWarp.value = THREE.MathUtils.lerp(
      u.m2DomainWarp.value,
      original * 0.88,
      0.30 * t,
    );
  }
  if (u.m3ReferenceWorldScale) {
    // Smaller world-space cells make the banks read as distant cloud groups
    // instead of one object spanning most of the phone viewport.
    u.m3ReferenceWorldScale.value = THREE.MathUtils.lerp(
      u.m3ReferenceWorldScale.value,
      1 / 470,
      0.40 * t,
    );
  }

  // Model 3.6 deliberately raises golden-hour coverage to guarantee solar
  // occlusion. The supplied reference instead has a clearly visible Sun and
  // broken horizontal banks around it, so restore open sky between the layers.
  if (u.coverage) {
    u.coverage.value = THREE.MathUtils.lerp(Number(u.coverage.value) || 0.52, 0.49, 0.46 * t);
  }
  if (u.density) {
    u.density.value = THREE.MathUtils.lerp(Number(u.density.value) || 0.60, 0.61, 0.32 * t);
  }

  // Compress and lift the golden-hour layer. This is the strongest silhouette
  // change: a ~60-unit-deep deck produces distant stratocumulus/altocumulus
  // bands instead of the 150+ unit deep overhead ceiling seen in review shots.
  if (u.cloudBaseY && u.cloudTopY) {
    const currentBase = Number(u.cloudBaseY.value) || 60;
    const currentTop = Number(u.cloudTopY.value) || 210;
    const targetBase = 126;
    const targetTop = 190;
    u.cloudBaseY.value = THREE.MathUtils.lerp(currentBase, targetBase, 0.24 * t);
    u.cloudTopY.value = THREE.MathUtils.lerp(currentTop, targetTop, 0.24 * t);
    if (handle.mesh) handle.mesh.position.y = u.cloudBaseY.value;
    const temporal = handle.__riftTemporalCloudState;
    if (temporal?.rawMesh) temporal.rawMesh.position.y = u.cloudBaseY.value;
    if (temporal?.displayMesh) temporal.displayMesh.position.y = u.cloudBaseY.value;
  }
}

function tunePhotographicSun(handle, state, camera) {
  const scene = handle?.__riftModel40Scene;
  if (!scene || !camera || state.daylight < 0.01) return;
  const disc = scene.getObjectByName?.("rift-real-sun-disc");
  if (!disc?.scale) return;

  disc.getWorldPosition(TMP_WORLD);
  const distance = Math.max(10, TMP_WORLD.distanceTo(camera.position));
  const photo = state.sunsetReference;

  // The supplied sunset reference reads as a crisp white-yellow disc roughly
  // a couple of degrees wide in the photographed field of view: larger than a
  // physical 0.53° Sun, but much tighter than a giant soft bloom sprite.
  const targetDeg = THREE.MathUtils.lerp(0.68, 2.18, photo);
  const targetDiameter = 2 * distance * Math.tan(THREE.MathUtils.degToRad(targetDeg) * 0.5);
  const diameter = THREE.MathUtils.lerp(Number(disc.scale.x) || targetDiameter, targetDiameter, 0.58);
  disc.scale.set(diameter, diameter, 1);

  if (disc.material) {
    disc.material.color?.copy?.(SUN_CORE).lerp(SUN_WARM, photo * 0.28);
    disc.material.opacity = THREE.MathUtils.lerp(Number(disc.material.opacity) || 1, 1.0, 0.62 * photo);
    disc.material.blending = THREE.NormalBlending;
    disc.material.toneMapped = false;
  }

  const halo = scene.getObjectByName?.("rift-real-sun-halo");
  const aureole = scene.getObjectByName?.("rift-real-sun-aureole");
  const horizonGlow = scene.getObjectByName?.("rift-real-sun-horizon-glow");
  const inner = scene.getObjectByName?.("rift-solar-inner-radiance-v15");
  const scatter = scene.getObjectByName?.("rift-solar-forward-scatter-v15");

  if (halo?.scale) halo.scale.set(diameter * 5.2, diameter * 5.2, 1);
  if (halo?.material) {
    halo.material.color?.copy?.(HALO_GOLD);
    halo.material.opacity = THREE.MathUtils.lerp(Number(halo.material.opacity) || 0, 0.24, photo);
  }
  if (aureole?.scale) aureole.scale.set(diameter * 11.5, diameter * 11.5, 1);
  if (aureole?.material) {
    aureole.material.color?.copy?.(HALO_ORANGE);
    aureole.material.opacity = THREE.MathUtils.lerp(Number(aureole.material.opacity) || 0, 0.075, photo);
  }
  if (horizonGlow?.scale) horizonGlow.scale.set(diameter * 25, diameter * 7.2, 1);
  if (horizonGlow?.material) {
    horizonGlow.material.color?.copy?.(HALO_ORANGE);
    horizonGlow.material.opacity = THREE.MathUtils.lerp(Number(horizonGlow.material.opacity) || 0, 0.105, photo);
  }
  if (inner?.scale) inner.scale.set(diameter * 3.1, diameter * 3.1, 1);
  if (inner?.material) {
    inner.material.color?.copy?.(SUN_WARM);
    inner.material.opacity = THREE.MathUtils.lerp(Number(inner.material.opacity) || 0, 0.28, photo);
  }
  if (scatter?.scale) scatter.scale.set(diameter * 22, diameter * 6.4, 1);
  if (scatter?.material) {
    scatter.material.color?.copy?.(HALO_ORANGE);
    scatter.material.opacity = THREE.MathUtils.lerp(Number(scatter.material.opacity) || 0, 0.052, photo);
  }
}

function apply42(handle, sunDirection, rainIntensity, camera) {
  if (!handle || !camera) return;
  const state = stateFor(sunDirection, rainIntensity);
  tuneSunsetCloudProfile(handle, state);
  tunePhotographicSun(handle, state, camera);

  globalThis.__riftCloudModel42Debug = {
    active: true,
    version: "4.2-sunset-reference-stratocumulus",
    altitudeDeg: state.altitude,
    golden: state.golden,
    storm: state.storm,
    sunsetReference: state.sunsetReference,
    coverage: handle.uniforms?.coverage?.value,
    density: handle.uniforms?.density?.value,
    cloudBaseY: handle.uniforms?.cloudBaseY?.value,
    cloudTopY: handle.uniforms?.cloudTopY?.value,
    referenceStrength: handle.uniforms?.m3ReferenceStrength?.value,
    referenceWorldScale: handle.uniforms?.m3ReferenceWorldScale?.value,
    weights: handle.uniforms?.m3ReferenceWeights?.value?.toArray?.(),
    threeRevision: THREE.REVISION,
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (handle) handle.__riftModel42 = true;
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
  apply42(handle, sunDirection, rainIntensity, camera);
}

export function disposeVolumetricClouds(handle) {
  if (handle) handle.__riftModel42 = false;
  delete globalThis.__riftCloudModel42Debug;
  return base.disposeVolumetricClouds(handle);
}
