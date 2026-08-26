import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model43.js";

export * from "./volumetricClouds_r185_model43.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 4.4 — reference cloud-shape library.
//
// 4.3 improved the Sun and broke up the reconstructed reference volume, but the
// review still exposed too little *morphological* variety: most fair-weather
// frames could still read as the same broad cloud body at different scales.
//
// 4.4 treats the supplied reference set as a small cloud-type library and morphs
// the existing single volumetric raymarch between several physically plausible
// regimes. This costs no additional 3D texture lookup and no additional fullscreen
// pass. The expensive renderer remains Model 3.1/4.x; only uniforms, reference
// family weights and the already-existing cirrus layer are directed differently.
//
// Reference targets represented here:
//   - deep cauliflower cumulus / towering fair-weather cells
//   - broken stratocumulus banks with large clear windows
//   - small altocumulus puffs / mid-level scattered groups
//   - thin sunset bands and high wispy/cirrus structure
//   - broad storm deck when weather requires it
// -----------------------------------------------------------------------------

const TMP_WEIGHTS = new THREE.Vector4();

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

function normalizedWeights(a, b, c, d) {
  const sum = Math.max(1e-5, a + b + c + d);
  return TMP_WEIGHTS.set(a / sum, b / sum, c / sum, d / sum);
}

const TYPES = {
  cumulus: {
    weights: [0.62, 0.24, 0.13, 0.01],
    referenceStrength: 0.50,
    worldScale: 1 / 455,
    coverage: 0.45,
    density: 0.60,
    baseY: 54,
    topY: 238,
    crownBreakup: 1.08,
    edgeErosion: 0.74,
    domainWarp: 1.12,
    cirrus: 0.020,
  },
  stratocumulus: {
    weights: [0.34, 0.42, 0.22, 0.02],
    referenceStrength: 0.47,
    worldScale: 1 / 325,
    coverage: 0.50,
    density: 0.57,
    baseY: 86,
    topY: 181,
    crownBreakup: 0.78,
    edgeErosion: 0.62,
    domainWarp: 0.95,
    cirrus: 0.024,
  },
  altocumulus: {
    weights: [0.45, 0.36, 0.18, 0.01],
    referenceStrength: 0.44,
    worldScale: 1 / 245,
    coverage: 0.37,
    density: 0.54,
    baseY: 126,
    topY: 196,
    crownBreakup: 1.02,
    edgeErosion: 0.80,
    domainWarp: 1.04,
    cirrus: 0.030,
  },
  sunsetBands: {
    weights: [0.17, 0.50, 0.32, 0.01],
    referenceStrength: 0.42,
    worldScale: 1 / 285,
    coverage: 0.34,
    density: 0.53,
    baseY: 132,
    topY: 201,
    crownBreakup: 0.86,
    edgeErosion: 0.73,
    domainWarp: 0.92,
    cirrus: 0.050,
  },
  storm: {
    weights: [0.08, 0.17, 0.27, 0.48],
    referenceStrength: 0.77,
    worldScale: 1 / 690,
    coverage: 0.74,
    density: 0.76,
    baseY: 34,
    topY: 276,
    crownBreakup: 0.70,
    edgeErosion: 0.46,
    domainWarp: 1.05,
    cirrus: 0.006,
  },
};

function lerpType(a, b, t, target) {
  const q = smooth01(t);
  target.weights = [
    THREE.MathUtils.lerp(a.weights[0], b.weights[0], q),
    THREE.MathUtils.lerp(a.weights[1], b.weights[1], q),
    THREE.MathUtils.lerp(a.weights[2], b.weights[2], q),
    THREE.MathUtils.lerp(a.weights[3], b.weights[3], q),
  ];
  target.referenceStrength = THREE.MathUtils.lerp(a.referenceStrength, b.referenceStrength, q);
  target.worldScale = THREE.MathUtils.lerp(a.worldScale, b.worldScale, q);
  target.coverage = THREE.MathUtils.lerp(a.coverage, b.coverage, q);
  target.density = THREE.MathUtils.lerp(a.density, b.density, q);
  target.baseY = THREE.MathUtils.lerp(a.baseY, b.baseY, q);
  target.topY = THREE.MathUtils.lerp(a.topY, b.topY, q);
  target.crownBreakup = THREE.MathUtils.lerp(a.crownBreakup, b.crownBreakup, q);
  target.edgeErosion = THREE.MathUtils.lerp(a.edgeErosion, b.edgeErosion, q);
  target.domainWarp = THREE.MathUtils.lerp(a.domainWarp, b.domainWarp, q);
  target.cirrus = THREE.MathUtils.lerp(a.cirrus, b.cirrus, q);
  return target;
}

function cloudTypeState(handle, dt, sunDirection, rainIntensity = 0) {
  const celestial = globalThis.__riftCelestialModel35 || globalThis.__riftCelestialModel34 || {};
  const weather = globalThis.__riftProceduralWeatherState || {};
  const sunY = Number(sunDirection?.y) || 0;
  const altitudeState = Number(celestial.altitudeDeg);
  const altitudeDeg = Number.isFinite(altitudeState)
    ? altitudeState
    : THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(sunY, -1, 1)));
  const daylight = clamp01(celestial.daylight ?? smoothRange(-0.10, 0.08, sunY));
  const storm = clamp01(weather.stormIntensity ?? rainIntensity);
  const golden = clamp01(
    celestial.goldenHour
      ?? (smoothRange(-5.5, 0.5, altitudeDeg) * (1 - smoothRange(13, 24, altitudeDeg)))
  ) * daylight;

  const local = handle.__riftModel44State || (handle.__riftModel44State = {
    time: Math.random() * 500,
    type: {},
  });
  local.time += Math.min(Math.max(Number(dt) || 0, 0), 0.1);

  // Very slow weather-independent morphology changes. The two irrational-ish
  // frequencies avoid obviously repeating cloud layouts while keeping transitions
  // slow enough that the sky reads as evolving weather rather than shape popping.
  const a = 0.5 + 0.5 * Math.sin(local.time * 0.0067 + 0.8);
  const b = 0.5 + 0.5 * Math.sin(local.time * 0.0041 + 2.3);
  const c = 0.5 + 0.5 * Math.sin(local.time * 0.0029 + 4.1);

  if (storm > 0.55) {
    lerpType(TYPES.stratocumulus, TYPES.storm, smoothRange(0.45, 0.90, storm), local.type);
  } else if (golden > 0.12) {
    // Sunset reference: mostly narrow banks, but retain some isolated puffs and
    // high wisps so the sky does not collapse into a single horizontal slab.
    const mixed = {};
    lerpType(TYPES.altocumulus, TYPES.sunsetBands, 0.58 + b * 0.32, mixed);
    lerpType(mixed, TYPES.stratocumulus, a * 0.22, local.type);
  } else if (a < 0.33) {
    lerpType(TYPES.cumulus, TYPES.altocumulus, a / 0.33, local.type);
  } else if (a < 0.68) {
    lerpType(TYPES.altocumulus, TYPES.stratocumulus, (a - 0.33) / 0.35, local.type);
  } else {
    lerpType(TYPES.stratocumulus, TYPES.cumulus, (a - 0.68) / 0.32, local.type);
  }

  // Small secondary modulation creates cloud-size diversity *within* each type.
  local.type.worldScale *= THREE.MathUtils.lerp(0.90, 1.13, b);
  local.type.coverage = clamp01(local.type.coverage + (c - 0.5) * 0.055);
  local.type.density = clamp01(local.type.density + (b - 0.5) * 0.045);
  local.type.crownBreakup *= THREE.MathUtils.lerp(0.93, 1.08, c);

  return { altitudeDeg, daylight, storm, golden, a, b, c, type: local.type };
}

function applyType(handle, state) {
  const u = handle?.uniforms;
  const t = state?.type;
  if (!u || !t) return;

  const response = 0.20;
  const weights = normalizedWeights(...t.weights);
  const currentWeights = u.m3ReferenceWeights?.value;
  if (currentWeights?.isVector4) {
    currentWeights.set(
      THREE.MathUtils.lerp(currentWeights.x, weights.x, response),
      THREE.MathUtils.lerp(currentWeights.y, weights.y, response),
      THREE.MathUtils.lerp(currentWeights.z, weights.z, response),
      THREE.MathUtils.lerp(currentWeights.w, weights.w, response),
    );
  }

  if (u.m3ReferenceStrength) {
    u.m3ReferenceStrength.value = THREE.MathUtils.lerp(
      Number(u.m3ReferenceStrength.value) || t.referenceStrength,
      t.referenceStrength,
      response,
    );
  }
  if (u.m3ReferenceWorldScale) {
    u.m3ReferenceWorldScale.value = THREE.MathUtils.lerp(
      Number(u.m3ReferenceWorldScale.value) || t.worldScale,
      t.worldScale,
      response,
    );
  }
  if (u.coverage) {
    u.coverage.value = THREE.MathUtils.lerp(Number(u.coverage.value) || t.coverage, t.coverage, response);
  }
  if (u.density) {
    u.density.value = THREE.MathUtils.lerp(Number(u.density.value) || t.density, t.density, response);
  }
  if (u.m31CrownBreakup) {
    u.m31CrownBreakup.value = THREE.MathUtils.lerp(
      Number(u.m31CrownBreakup.value) || t.crownBreakup,
      t.crownBreakup,
      response,
    );
  }
  if (u.m2EdgeErosion) {
    u.m2EdgeErosion.value = THREE.MathUtils.lerp(
      Number(u.m2EdgeErosion.value) || t.edgeErosion,
      t.edgeErosion,
      response,
    );
  }
  if (u.m2DomainWarp) {
    const baseWarp = Number(handle?.__riftModel40State?.baseDomainWarp) || 1;
    const targetWarp = baseWarp * t.domainWarp;
    u.m2DomainWarp.value = THREE.MathUtils.lerp(
      Number(u.m2DomainWarp.value) || targetWarp,
      targetWarp,
      response,
    );
  }

  if (u.cloudBaseY && u.cloudTopY) {
    u.cloudBaseY.value = THREE.MathUtils.lerp(Number(u.cloudBaseY.value) || t.baseY, t.baseY, 0.12);
    u.cloudTopY.value = THREE.MathUtils.lerp(Number(u.cloudTopY.value) || t.topY, t.topY, 0.12);
    if (handle.mesh) handle.mesh.position.y = u.cloudBaseY.value;
    const temporal = handle.__riftTemporalCloudState;
    if (temporal?.rawMesh) temporal.rawMesh.position.y = u.cloudBaseY.value;
    if (temporal?.displayMesh) temporal.displayMesh.position.y = u.cloudBaseY.value;
  }

  // The existing cirrus renderer becomes the dedicated high-cloud family. This
  // is important for the user's real-sky and Sky Pro references, which contain
  // wisps above the deeper cumulus/stratocumulus volume.
  if (handle.__riftCirrus?.material) {
    const moonBoost = state.daylight < 0.15 ? 1.25 : 1.0;
    handle.__riftCirrus.material.opacity = t.cirrus * moonBoost;
  }

  // Drift the reconstructed macro atlas at a slightly different rate as the
  // active family changes. That makes nearby puffs, mid-level banks and large
  // cells occupy independent-looking positions without another volume sample.
  const offset = u.m3ReferenceOffset?.value;
  if (offset) {
    const drift = 0.00012 + state.b * 0.00010;
    offset.x = (offset.x + drift + 1) % 1;
    offset.y = (offset.y + drift * (0.48 + state.c * 0.35) + 1) % 1;
  }

  globalThis.__riftCloudModel44Shape = {
    weights: currentWeights?.toArray?.(),
    referenceStrength: u.m3ReferenceStrength?.value,
    worldScale: u.m3ReferenceWorldScale?.value,
    coverage: u.coverage?.value,
    density: u.density?.value,
    baseY: u.cloudBaseY?.value,
    topY: u.cloudTopY?.value,
    crownBreakup: u.m31CrownBreakup?.value,
    edgeErosion: u.m2EdgeErosion?.value,
    cirrusOpacity: handle.__riftCirrus?.material?.opacity,
  };
}

function apply44(handle, dt, sunDirection, rainIntensity) {
  if (!handle) return;
  const state = cloudTypeState(handle, dt, sunDirection, rainIntensity);
  applyType(handle, state);

  globalThis.__riftCloudModel44Debug = {
    active: true,
    version: "4.4-reference-cloud-shape-library",
    architecture: "single raymarch + reconstructed reference atlas + procedural macro blend + dynamic cloud-type height/scale profiles + existing cirrus layer",
    altitudeDeg: state.altitudeDeg,
    daylight: state.daylight,
    golden: state.golden,
    storm: state.storm,
    phases: [state.a, state.b, state.c],
    shape: globalThis.__riftCloudModel44Shape,
    threeRevision: THREE.REVISION,
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (handle) handle.__riftModel44 = true;
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
  apply44(handle, dt, sunDirection, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  if (handle) {
    handle.__riftModel44 = false;
    delete handle.__riftModel44State;
  }
  delete globalThis.__riftCloudModel44Shape;
  delete globalThis.__riftCloudModel44Debug;
  return base.disposeVolumetricClouds(handle);
}
