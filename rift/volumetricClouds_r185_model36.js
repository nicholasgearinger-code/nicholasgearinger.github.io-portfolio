import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model35.js";

export * from "./volumetricClouds_r185_model35.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 3.6 — golden-hour solar corridor + reference composition.
//
// Model 3.5 proved the lighting response, but the reference review showed a
// composition problem: at sunrise/sunset the low Sun often sits in an empty gap
// while the authored cloud families remain elsewhere in the periodic atlas.
// That means the cloud lighting looks good but there is nothing to occlude the
// solar disc and therefore little opportunity for cloud-cut crepuscular rays.
//
// 3.6 keeps the exact 3.5 shader and raymarch cost. It only steers the EXISTING
// atlas offset and family weights during the low-Sun window so a broken/distant
// bank naturally drifts across the solar corridor. The alignment is partial,
// slow and periodic rather than hard-locked, so the Sun is alternately revealed
// and obscured instead of permanently hidden behind one cloud.
// -----------------------------------------------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function fract(v) {
  return v - Math.floor(v);
}

function periodicDelta(from, to) {
  let d = fract(to) - fract(from);
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

function smoothRange(a, b, x) {
  const t = clamp01((x - a) / Math.max(1e-6, b - a));
  return t * t * (3 - 2 * t);
}

function tuneGoldenHourComposition(handle, dt, camera, sunDirection, rainIntensity = 0) {
  const u = handle?.uniforms;
  if (!u || !camera || !sunDirection) return;

  const celestial = globalThis.__riftCelestialModel35 || globalThis.__riftCelestialModel34 || {};
  const weather = globalThis.__riftProceduralWeatherState || {};
  const altitudeDeg = Number(celestial.altitudeDeg);
  const altitude = Number.isFinite(altitudeDeg)
    ? altitudeDeg
    : THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(Number(sunDirection.y) || 0, -1, 1)));
  const storm = clamp01(weather.stormIntensity ?? celestial.storm ?? rainIntensity);
  const clear = 1 - storm;
  const daylight = clamp01(celestial.daylight ?? 1);
  const golden = clamp01(
    celestial.goldenHour
      ?? (smoothRange(-5, 1.5, altitude) * (1 - smoothRange(12, 24, altitude)))
  ) * clear * daylight;

  if (golden < 0.001) return;

  const state = handle.__riftModel36State || (handle.__riftModel36State = {
    phase: Math.random() * Math.PI * 2,
    lastAlignment: 0,
  });
  const safeDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
  state.phase += safeDt;

  // Shift the family mix toward the reference look: less giant isolated hero
  // cumulus, more broken mid-distance cells and more horizon banks.
  const weights = u.m3ReferenceWeights?.value;
  if (weights) {
    weights.x *= THREE.MathUtils.lerp(1.0, 0.58, golden);
    weights.y = Math.min(1.0, weights.y + 0.20 * golden);
    weights.w = Math.min(1.0, weights.w + 0.28 * golden);
  }

  // Keep blue gaps, but ensure enough actual condensate exists near the horizon
  // for the Sun to pass behind cloud instead of always sitting in empty sky.
  if (u.coverage) {
    const target = Math.min(0.72, Number(u.coverage.value || 0.5) + 0.085 * golden);
    u.coverage.value = THREE.MathUtils.lerp(Number(u.coverage.value) || target, target, 0.72);
  }
  if (u.density) {
    const target = Math.min(0.78, Number(u.density.value || 0.56) + 0.035 * golden);
    u.density.value = THREE.MathUtils.lerp(Number(u.density.value) || target, target, 0.64);
  }

  // Slightly lower the cloud layer in the golden-hour window so the authored
  // distant banks occupy the same part of the sky as the low solar disc.
  if (u.cloudBaseY && u.cloudTopY) {
    const down = 7.5 * golden;
    u.cloudBaseY.value -= down;
    u.cloudTopY.value -= down * 0.72;
    if (handle.mesh) handle.mesh.position.y = u.cloudBaseY.value;
    const temporal = handle.__riftTemporalCloudState;
    if (temporal?.rawMesh) temporal.rawMesh.position.y = u.cloudBaseY.value;
    if (temporal?.displayMesh) temporal.displayMesh.position.y = u.cloudBaseY.value;
  }

  const offset = u.m3ReferenceOffset?.value;
  const worldScale = Number(u.m3ReferenceWorldScale?.value);
  const sunY = Number(sunDirection.y) || 0;
  if (offset && Number.isFinite(worldScale) && worldScale > 0 && sunY > 0.018) {
    const baseY = Number(u.cloudBaseY?.value) || 45;
    const topY = Number(u.cloudTopY?.value) || 220;
    const corridorY = THREE.MathUtils.lerp(baseY, topY, 0.16);
    const t = THREE.MathUtils.clamp(
      (corridorY - camera.position.y) / Math.max(0.018, sunY),
      220,
      2600,
    );

    const worldX = camera.position.x + sunDirection.x * t;
    const worldZ = camera.position.z + sunDirection.z * t;

    // Dense broken/distant authored cells live around the center of the periodic
    // reference tile. A very slow wobble moves that bank across the Sun instead
    // of pinning a cloud to the disc forever.
    const wobbleX = Math.sin(state.phase * 0.075) * 0.060;
    const wobbleZ = Math.cos(state.phase * 0.061 + 0.8) * 0.052;
    const targetU = fract(0.54 + wobbleX);
    const targetV = fract(0.52 + wobbleZ);
    const desiredX = fract(targetU - worldX * worldScale);
    const desiredY = fract(targetV - worldZ * worldScale);

    const broken = clamp01(
      globalThis.__riftCloudModel35Debug?.brokenCloud
        ?? (1 - Math.abs((globalThis.__riftCloudShadowState?.averageTransmittance ?? 0.5) * 2 - 1))
    );
    const alignment = golden * THREE.MathUtils.lerp(0.38, 0.78, broken);
    const response = (1 - Math.exp(-safeDt * 0.42)) * alignment;

    offset.x = fract(offset.x + periodicDelta(offset.x, desiredX) * response);
    offset.y = fract(offset.y + periodicDelta(offset.y, desiredY) * response);
    state.lastAlignment = alignment;
  }

  globalThis.__riftCloudModel36Debug = {
    active: true,
    version: "3.6-golden-hour-solar-corridor",
    architecture: "Model 3.5 shader + low-Sun family/coverage steering + periodic solar-corridor atlas alignment",
    altitudeDeg: altitude,
    golden,
    storm,
    alignment: state.lastAlignment,
    coverage: u.coverage?.value,
    density: u.density?.value,
    weights: weights ? [weights.x, weights.y, weights.z, weights.w] : null,
    offset: offset ? [offset.x, offset.y] : null,
    threeRevision: THREE.REVISION,
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (handle) handle.__riftModel36 = true;
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
  tuneGoldenHourComposition(handle, dt, camera, sunDirection, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  if (handle) {
    handle.__riftModel36 = false;
    delete handle.__riftModel36State;
  }
  delete globalThis.__riftCloudModel36Debug;
  return base.disposeVolumetricClouds(handle);
}
