import * as THREE from "three";
import { REFERENCE_CLOUD_PRESETS } from "./cloudArchetypes_reference_v1.js";

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
  weights = lerp4(weights, REFERENCE_CLOUD_PRESETS.overcast, clamp01((requestedCoverage - 0.58) * 1.9));
  weights = lerp4(weights, REFERENCE_CLOUD_PRESETS.storm, storm);
  weights = add4(weights, [0.18 * convection * daylight, 0.10 * humidity, 0, 0.08 * lowSun]);
  weights = normalizeWeights(weights);

  const worldScale = THREE.MathUtils.lerp(1 / 1180, 1 / 920, convection * 0.65 + storm * 0.20);
  const referenceStrength = THREE.MathUtils.lerp(0.92, 0.985, storm * 0.35 + highSun * 0.25);
  const edgeErosion = THREE.MathUtils.lerp(0.56, 0.30, storm);
  const detailScale = THREE.MathUtils.lerp(6.6, 4.8, storm);
  const densityScale = THREE.MathUtils.lerp(1.08, 1.26, storm);
  const extinction = THREE.MathUtils.lerp(0.60, 0.92, storm);
  const ambientStrength = THREE.MathUtils.lerp(0.60, 0.46, storm);
  const silverStrength = THREE.MathUtils.lerp(0.48 + lowSun * 0.18 + night * 0.08, 0.18, storm);

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

  const breatheX = Math.sin(state.age * 0.011) * 0.0035;
  const breatheZ = Math.cos(state.age * 0.009) * 0.0030;
  return new THREE.Vector2(state.offsetX + breatheX, state.offsetZ + breatheZ);
}
