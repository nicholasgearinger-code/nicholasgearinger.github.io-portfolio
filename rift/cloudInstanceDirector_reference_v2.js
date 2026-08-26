import * as THREE from "three";
import { REFERENCE_CLOUD_PRESETS } from "./cloudArchetypes_reference_v2.js";

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / Math.max(1e-5, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function lerp4(a, b, t) {
  return [
    THREE.MathUtils.lerp(a[0], b[0], t),
    THREE.MathUtils.lerp(a[1], b[1], t),
    THREE.MathUtils.lerp(a[2], b[2], t),
    THREE.MathUtils.lerp(a[3], b[3], t),
  ];
}

function add4(a, b, scale = 1) {
  return [
    a[0] + b[0] * scale,
    a[1] + b[1] * scale,
    a[2] + b[2] * scale,
    a[3] + b[3] * scale,
  ];
}

function normalizeWeights(v) {
  const max = Math.max(1, v[0], v[1], v[2], v[3]);
  return v.map((x) => clamp01(x / max));
}

export function computeReferenceCloudState({
  sunDirection = null,
  rainIntensity = 0,
  weatherState = null,
  physicalAtmosphere = null,
} = {}) {
  const weather = weatherState || globalThis.__riftProceduralWeatherState || {};
  const physical = physicalAtmosphere || globalThis.__riftSkyPhysicalV11 || {};
  const sunY = Number(sunDirection?.y) || 0;
  const storm = clamp01(weather.stormIntensity ?? rainIntensity);
  const humidity = clamp01(weather.humidity ?? physical.humidity ?? 0.66);
  const requestedCoverage = clamp01(weather.cloudCoverage ?? physical.cloudCoverage ?? 0.48);
  const convection = clamp01(weather.convection ?? 0.70);

  const daylight = smoothstep(-0.12, 0.08, sunY);
  const highSun = smoothstep(0.12, 0.62, sunY);
  const lowSun = (1 - smoothstep(0.10, 0.38, Math.abs(sunY))) * daylight;
  const night = 1 - daylight;

  let weights = lerp4(
    REFERENCE_CLOUD_PRESETS.clearDay,
    REFERENCE_CLOUD_PRESETS.goldenHour,
    lowSun,
  );
  weights = lerp4(weights, REFERENCE_CLOUD_PRESETS.moonlit, night);
  weights = lerp4(
    weights,
    REFERENCE_CLOUD_PRESETS.overcast,
    clamp01((requestedCoverage - 0.58) * 1.9),
  );
  weights = lerp4(weights, REFERENCE_CLOUD_PRESETS.storm, storm);
  weights = add4(weights, [
    0.20 * convection * daylight,
    0.10 * humidity,
    0,
    0.06 * lowSun,
  ]);
  weights = normalizeWeights(weights);

  const worldScale = THREE.MathUtils.lerp(
    1 / 1220,
    1 / 940,
    convection * 0.62 + storm * 0.18,
  );
  const referenceStrength = THREE.MathUtils.lerp(
    0.955,
    0.992,
    storm * 0.30 + highSun * 0.25,
  );

  // Model 3.1: more shell breakup in fair weather, but preserve storm coherence.
  const edgeErosion = THREE.MathUtils.lerp(0.62, 0.30, storm);
  const detailScale = THREE.MathUtils.lerp(7.2, 4.7, storm);
  const densityScale = THREE.MathUtils.lerp(1.05, 1.25, storm);
  const extinction = THREE.MathUtils.lerp(0.64, 0.96, storm);
  const ambientStrength = THREE.MathUtils.lerp(0.57, 0.42, storm);
  const silverStrength = THREE.MathUtils.lerp(
    0.52 + lowSun * 0.20 + night * 0.06,
    0.16,
    storm,
  );

  // New 3.1 controls consumed directly by the shader.
  const crownBreakup = THREE.MathUtils.lerp(
    0.82 + convection * 0.18,
    0.34,
    storm,
  );
  const selfShadowStrength = THREE.MathUtils.lerp(
    0.86 + humidity * 0.18,
    1.20,
    storm,
  );
  const baseDarkening = THREE.MathUtils.lerp(
    0.42 + humidity * 0.16,
    0.72,
    storm,
  );
  const crownLightBoost = THREE.MathUtils.lerp(
    1.08 + highSun * 0.12 + lowSun * 0.08,
    0.82,
    storm,
  );

  return {
    storm,
    humidity,
    coverage: requestedCoverage,
    convection,
    daylight,
    highSun,
    lowSun,
    night,
    weights,
    worldScale,
    referenceStrength,
    edgeErosion,
    detailScale,
    densityScale,
    extinction,
    ambientStrength,
    silverStrength,
    crownBreakup,
    selfShadowStrength,
    baseDarkening,
    crownLightBoost,
  };
}

export function updateReferenceCloudAdvection(handle, dt, windX = 0, windZ = 0) {
  const state = handle?.__riftModel3State;
  if (!state) return new THREE.Vector2();
  const safeDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
  const wx = Number(windX) || 0;
  const wz = Number(windZ) || 0;

  state.offsetX = (state.offsetX + (0.18 + wx * 0.28) * safeDt * 0.00020) % 1;
  state.offsetZ = (state.offsetZ + (0.07 + wz * 0.28) * safeDt * 0.00020) % 1;
  state.age += safeDt;

  // Keep macro drift slow; tiny differential breathing makes crowns evolve
  // without destroying the authored silhouette from one frame to the next.
  const breatheX = Math.sin(state.age * 0.010) * 0.0030;
  const breatheZ = Math.cos(state.age * 0.0085) * 0.0026;
  return new THREE.Vector2(state.offsetX + breatheX, state.offsetZ + breatheZ);
}
