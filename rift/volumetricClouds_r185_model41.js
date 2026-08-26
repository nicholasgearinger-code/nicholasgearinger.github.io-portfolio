import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model40.js";

export * from "./volumetricClouds_r185_model40.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 4.1 — separated reference masses + reference-scale Sun.
//
// Model 4.0 proved the photo->3D reconstruction path, but its near-total authored
// weight and very large world scale allowed the reconstructed masks to read as a
// single ceiling. 4.1 keeps the same real reference volume and lighting, while
// deliberately letting more of the existing procedural mass/erosion separate
// that macro silhouette into individual cloud bodies and broken sunset banks.
// It also makes the low-Sun photosphere visually match the reference photography
// rather than the physically tiny astronomical angular diameter.
// -----------------------------------------------------------------------------

const TMP_WEIGHTS = new THREE.Vector4();
const TMP_WORLD = new THREE.Vector3();

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

function atmosphereState(sunDirection, rainIntensity = 0) {
  const celestial = globalThis.__riftCelestialModel35 || globalThis.__riftCelestialModel34 || {};
  const weather = globalThis.__riftProceduralWeatherState || {};
  const sunY = Number(sunDirection?.y) || 0;
  const altitudeFromState = Number(celestial.altitudeDeg);
  const altitude = Number.isFinite(altitudeFromState)
    ? altitudeFromState
    : THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(sunY, -1, 1)));
  const daylight = clamp01(celestial.daylight ?? smoothRange(-0.10, 0.08, sunY));
  const golden = clamp01(
    celestial.goldenHour
      ?? (smoothRange(-5, 0.5, altitude) * (1 - smoothRange(12, 24, altitude)))
  ) * daylight;
  const storm = clamp01(weather.stormIntensity ?? rainIntensity);
  const lowSun = smoothRange(-4, 0.5, altitude) * (1 - smoothRange(12, 22, altitude));
  return { altitude, daylight, golden, storm, lowSun };
}

function targetReferenceWeights(state) {
  if (state.storm > 0.48) {
    // Keep storm mass substantial, but retain a little broken-bank structure so
    // the ceiling has holes and separated shelves instead of one opaque sheet.
    return TMP_WEIGHTS.set(0.08, 0.16, 0.28, 1.0);
  }
  if (state.golden > 0.08) {
    // The first dusk family contains the broken/isolated shapes. The sunset-bank
    // family is intentionally secondary; in 4.0 its nearly equal weight joined
    // the horizon layers into one enormous slab.
    return TMP_WEIGHTS.set(0.10, 1.0, 0.34, 0.015);
  }
  return TMP_WEIGHTS.set(1.0, 0.24, 0.045, 0.01);
}

function tuneSeparatedMasses(handle, state) {
  const u = handle?.uniforms;
  if (!u) return;
  const refBlend = clamp01(handle?.__riftModel40State?.blend ?? 1);
  const target = targetReferenceWeights(state);
  const current = u.m3ReferenceWeights?.value;
  if (current?.isVector4) {
    const sum = Math.max(1e-5, target.x + target.y + target.z + target.w);
    const tx = target.x / sum;
    const ty = target.y / sum;
    const tz = target.z / sum;
    const tw = target.w / sum;
    const lerp = 0.23 + refBlend * 0.32;
    current.set(
      THREE.MathUtils.lerp(current.x, tx, lerp),
      THREE.MathUtils.lerp(current.y, ty, lerp),
      THREE.MathUtils.lerp(current.z, tz, lerp),
      THREE.MathUtils.lerp(current.w, tw, lerp),
    );
  }

  if (u.m3ReferenceStrength) {
    const targetStrength = state.storm > 0.48
      ? 0.88
      : THREE.MathUtils.lerp(0.82, 0.86, state.golden);
    u.m3ReferenceStrength.value = THREE.MathUtils.lerp(
      u.m3ReferenceStrength.value,
      targetStrength,
      0.46,
    );
  }

  if (u.m31CrownBreakup) {
    const breakup = state.storm > 0.48 ? 0.72 : THREE.MathUtils.lerp(0.84, 0.96, state.golden);
    u.m31CrownBreakup.value = THREE.MathUtils.lerp(u.m31CrownBreakup.value, breakup, 0.42);
  }

  if (u.m2EdgeErosion) {
    const erosion = state.storm > 0.48 ? 0.44 : THREE.MathUtils.lerp(0.56, 0.64, state.golden);
    u.m2EdgeErosion.value = THREE.MathUtils.lerp(u.m2EdgeErosion.value, erosion, 0.42);
  }

  if (u.m2DomainWarp) {
    const original = Number(handle?.__riftModel40State?.baseDomainWarp) || Number(u.m2DomainWarp.value) || 1;
    const targetWarp = original * (state.storm > 0.48 ? 0.78 : 0.94);
    u.m2DomainWarp.value = THREE.MathUtils.lerp(u.m2DomainWarp.value, targetWarp, 0.36);
  }

  if (u.m3ReferenceWorldScale) {
    // Larger reciprocal => smaller repeated reference forms in world space.
    // This is the main anti-sheet correction versus Model 4.0's 1/1360 fair scale.
    const fair = 1 / 720;
    const sunset = 1 / 610;
    const storm = 1 / 820;
    const targetScale = state.storm > 0.48
      ? storm
      : THREE.MathUtils.lerp(fair, sunset, state.golden);
    u.m3ReferenceWorldScale.value = THREE.MathUtils.lerp(
      u.m3ReferenceWorldScale.value,
      targetScale,
      0.38,
    );
  }
}

function tuneReferenceSun(handle, state, camera) {
  const scene = handle?.__riftModel40Scene;
  if (!scene || !camera || state.daylight < 0.02) return;
  const disc = scene.getObjectByName?.("rift-real-sun-disc");
  if (!disc?.scale) return;

  disc.getWorldPosition(TMP_WORLD);
  const distance = Math.max(10, TMP_WORLD.distanceTo(camera.position));

  // The game is matching photographic references, not naked-eye astronomy.
  // At the horizon the apparent photosphere is intentionally 3.0-3.4 degrees,
  // while high noon returns close to the physically small presentation.
  const refBoost = smoothRange(-3.5, 0.5, state.altitude)
    * (1 - smoothRange(11, 21, state.altitude));
  const targetDeg = THREE.MathUtils.lerp(0.68, 3.25, refBoost);
  const targetRad = THREE.MathUtils.degToRad(targetDeg);
  const targetDiameter = 2 * distance * Math.tan(targetRad * 0.5);
  const current = Number(disc.scale.x) || targetDiameter;
  const diameter = THREE.MathUtils.lerp(current, targetDiameter, 0.54);
  disc.scale.set(diameter, diameter, 1);

  const halo = scene.getObjectByName?.("rift-real-sun-halo");
  const aureole = scene.getObjectByName?.("rift-real-sun-aureole");
  const horizonGlow = scene.getObjectByName?.("rift-real-sun-horizon-glow");
  if (halo?.scale) halo.scale.set(Math.max(halo.scale.x, diameter * 7.5), Math.max(halo.scale.y, diameter * 7.5), 1);
  if (aureole?.scale) aureole.scale.set(Math.max(aureole.scale.x, diameter * 18), Math.max(aureole.scale.y, diameter * 18), 1);
  if (horizonGlow?.scale && refBoost > 0.05) {
    horizonGlow.scale.set(Math.max(horizonGlow.scale.x, diameter * 34), Math.max(horizonGlow.scale.y, diameter * 12), 1);
  }
}

function apply41(handle, sunDirection, rainIntensity, camera) {
  if (!handle || !camera) return;
  const state = atmosphereState(sunDirection, rainIntensity);
  tuneSeparatedMasses(handle, state);
  tuneReferenceSun(handle, state, camera);

  globalThis.__riftCloudModel41Debug = {
    active: true,
    version: "4.1-separated-reference-masses",
    altitudeDeg: state.altitude,
    golden: state.golden,
    storm: state.storm,
    lowSun: state.lowSun,
    referenceStrength: handle.uniforms?.m3ReferenceStrength?.value,
    referenceWorldScale: handle.uniforms?.m3ReferenceWorldScale?.value,
    crownBreakup: handle.uniforms?.m31CrownBreakup?.value,
    edgeErosion: handle.uniforms?.m2EdgeErosion?.value,
    weights: handle.uniforms?.m3ReferenceWeights?.value?.toArray?.(),
    threeRevision: THREE.REVISION,
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (handle) handle.__riftModel41 = true;
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
  apply41(handle, sunDirection, rainIntensity, camera);
}

export function disposeVolumetricClouds(handle) {
  if (handle) handle.__riftModel41 = false;
  delete globalThis.__riftCloudModel41Debug;
  return base.disposeVolumetricClouds(handle);
}
