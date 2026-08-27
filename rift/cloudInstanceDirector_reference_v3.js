import * as THREE from "three";
import { REFERENCE_CLOUD_PRESETS } from "./cloudArchetypes_reference_v3.js";

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

export function computeReferenceCloudStateV3({
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
  const coverage = clamp01(weather.cloudCoverage ?? physical.cloudCoverage ?? 0.48);
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
    clamp01((coverage - 0.58) * 1.9),
  );
  weights = lerp4(weights, REFERENCE_CLOUD_PRESETS.storm, storm);
  weights = add4(weights, [
    0.10 * convection * daylight,
    0.13 * humidity * (1 - storm),
    0.05 * storm,
    0.12 * lowSun + 0.06 * (1 - coverage),
  ]);
  weights = normalizeWeights(weights);

  // Larger fair-weather cells + more distinct gaps; storm compresses scale to
  // show more embedded cells across the sky instead of one monolithic ceiling.
  const fairScale = THREE.MathUtils.lerp(1 / 1380, 1 / 1080, convection);
  const stormScale = THREE.MathUtils.lerp(1 / 1040, 1 / 900, convection);
  const worldScale = THREE.MathUtils.lerp(fairScale, stormScale, storm);

  return {
    storm,
    humidity,
    coverage,
    convection,
    daylight,
    highSun,
    lowSun,
    night,
    weights,
    worldScale,
    referenceStrength: THREE.MathUtils.lerp(0.965, 0.994, storm * 0.35 + highSun * 0.18),
    crownBreakup: THREE.MathUtils.lerp(0.94 + convection * 0.12, 0.40, storm),
    edgeErosion: THREE.MathUtils.lerp(0.64, 0.30, storm),
    detailScale: THREE.MathUtils.lerp(7.5, 4.6, storm),
    densityScale: THREE.MathUtils.lerp(1.02, 1.24, storm),
    selfShadowStrength: THREE.MathUtils.lerp(0.92 + humidity * 0.16, 1.22, storm),
    baseDarkening: THREE.MathUtils.lerp(0.45 + humidity * 0.15, 0.76, storm),
    crownLightBoost: THREE.MathUtils.lerp(1.10 + highSun * 0.12 + lowSun * 0.10, 0.80, storm),
    clusterGap: THREE.MathUtils.lerp(0.16 + (1 - coverage) * 0.18, 0.04, storm),
    evolutionStrength: THREE.MathUtils.lerp(0.020, 0.045, convection) * (1 - storm * 0.35),
  };
}

export function applyReferenceCloudEvolution(handle, dt, state) {
  const modelState = handle?.__riftModel3State;
  const offset = handle?.uniforms?.m3ReferenceOffset?.value;
  if (!modelState || !offset || !state) return;

  const safeDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
  modelState.__m33Phase = (modelState.__m33Phase || Math.random() * 1000) + safeDt;
  const phase = modelState.__m33Phase;
  const strength = state.evolutionStrength * 0.001;

  // Very slow differential breathing: enough to keep clusters alive, but below
  // the threshold where TAAU interprets macro shape changes as shimmer.
  offset.x += Math.sin(phase * 0.021) * strength;
  offset.y += Math.cos(phase * 0.017) * strength * 0.82;
}
