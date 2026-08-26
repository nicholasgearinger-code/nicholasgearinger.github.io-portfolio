import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model36.js";
import { createReferenceReconstructedCloudAtlas } from "./cloudReferenceReconstruction_v1.js";

export * from "./volumetricClouds_r185_model36.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 4.0 — Reference-Reconstructed Sky.
//
// Model 3.x proved the r185 raymarch, TAAU, lighting and cloud-aware godrays.
// Model 4.0 changes the macro source: the actual sky reference images in
// rift/textures are segmented at startup, converted to 2D distance fields and
// inflated into real 3D density channels. Perlin-Worley remains detail only.
// -----------------------------------------------------------------------------

const TMP_REF_SUN = new THREE.Color();
const TMP_REF_SHADOW = new THREE.Color();
const TMP_REF_LIGHT = new THREE.Color();

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smoothRange(a, b, x) {
  const t = clamp01((x - a) / Math.max(1e-6, b - a));
  return t * t * (3 - 2 * t);
}

function atlasSizeFor(handle) {
  const label = handle?.__riftModel2Quality?.label;
  if (label === "mobile-low") return { width: 64, height: 46, depth: 64 };
  if (label === "medium") return { width: 80, height: 54, depth: 80 };
  return { width: 96, height: 62, depth: 96 };
}

function normalizeWeights(values) {
  const max = Math.max(1, ...values);
  return values.map((value) => clamp01(value / max));
}

function referenceWeights(sunDirection, rainIntensity = 0) {
  const celestial = globalThis.__riftCelestialModel35 || globalThis.__riftCelestialModel34 || {};
  const weather = globalThis.__riftProceduralWeatherState || {};
  const sunY = Number(sunDirection?.y) || 0;
  const daylight = clamp01(celestial.daylight ?? smoothRange(-0.10, 0.08, sunY));
  const altitudeDeg = Number(celestial.altitudeDeg);
  const altitude = Number.isFinite(altitudeDeg)
    ? altitudeDeg
    : THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(sunY, -1, 1)));
  const golden = clamp01(
    celestial.goldenHour
      ?? (smoothRange(-5, 1, altitude) * (1 - smoothRange(12, 24, altitude)))
  ) * daylight;
  const storm = clamp01(weather.stormIntensity ?? rainIntensity);
  const night = 1 - daylight;
  const highDay = daylight * (1 - golden);

  return {
    daylight,
    golden,
    storm,
    night,
    altitude,
    weights: normalizeWeights([
      highDay * (1 - storm) * 0.96 + night * 0.08,
      highDay * (1 - storm) * 0.22 + golden * (1 - storm) * 0.88 + night * 0.10,
      golden * (1 - storm) * 1.00 + night * 0.28,
      storm * 1.00 + night * 0.48,
    ]),
  };
}

function arrayColor(target, array, fallbackHex) {
  if (Array.isArray(array) && array.length >= 3) {
    target.setRGB(clamp01(array[0]), clamp01(array[1]), clamp01(array[2]));
  } else {
    target.setHex(fallbackHex);
  }
  return target;
}

function applyReferencePalette(handle, state, sunColor, ambientColor) {
  const calibration = handle?.__riftModel4Atlas?.calibration;
  if (!calibration) return;

  arrayColor(TMP_REF_SHADOW, calibration.cloudShadow, 0x69758a);
  arrayColor(TMP_REF_LIGHT, calibration.cloudLight, 0xf0f1ef);
  arrayColor(TMP_REF_SUN, calibration.horizon, 0xffa45c);

  const peak = Math.max(TMP_REF_SUN.r, TMP_REF_SUN.g, TMP_REF_SUN.b, 1e-4);
  TMP_REF_SUN.multiplyScalar(Math.min(1.55, 1 / peak));

  const paletteStrength = clamp01(
    state.golden * (1 - state.storm) * 0.20
      + state.storm * 0.08
      + state.night * 0.05
  );

  if (sunColor?.isColor && paletteStrength > 0.001) {
    sunColor.lerp(TMP_REF_SUN, paletteStrength);
    handle.uniforms?.sunColor?.value?.copy?.(sunColor);
  }

  const ambientTarget = TMP_REF_SHADOW.clone().lerp(TMP_REF_LIGHT, state.daylight * 0.32);
  if (ambientColor?.isColor) {
    ambientColor.lerp(ambientTarget, clamp01(0.06 + state.golden * 0.06 + state.storm * 0.09));
    handle.uniforms?.ambientColor?.value?.copy?.(ambientColor);
  }

  const atmosphere = globalThis.__riftReferenceAtmosphere;
  if (atmosphere?.horizonColor?.isColor) {
    atmosphere.horizonColor.lerp(TMP_REF_SUN, state.golden * 0.055);
  }
  if (atmosphere?.sunColor?.isColor && sunColor?.isColor) {
    atmosphere.sunColor.copy(sunColor);
  }

  const shared = globalThis.__riftSunsetAtmosphereV9;
  shared?.cloudLightTint?.copy?.(TMP_REF_LIGHT);
  shared?.cloudShadowTint?.copy?.(TMP_REF_SHADOW);
}

function applyReferenceSunGeometry(handle, state, camera) {
  const calibration = handle?.__riftModel4Atlas?.calibration?.sun;
  const scene = handle?.__riftModel40Scene;
  if (!calibration || !scene || !camera || state.golden < 0.05) return;
  if (clamp01(calibration.confidence) < 0.18) return;

  const disc = scene.getObjectByName?.("rift-real-sun-disc");
  if (!disc?.scale) return;

  const world = new THREE.Vector3();
  disc.getWorldPosition(world);
  const distance = Math.max(10, world.distanceTo(camera.position));
  const verticalFov = THREE.MathUtils.degToRad(Number(camera.fov) || 60);
  const radiusFrac = THREE.MathUtils.clamp(Number(calibration.apparentRadius) || 0.012, 0.004, 0.055);
  const angularDiameter = THREE.MathUtils.clamp(
    radiusFrac * 2 * verticalFov,
    THREE.MathUtils.degToRad(0.48),
    THREE.MathUtils.degToRad(2.8),
  );
  const targetWorldDiameter = THREE.MathUtils.clamp(
    2 * distance * Math.tan(angularDiameter * 0.5),
    4.4,
    13.5,
  );
  const current = Number(disc.scale.x) || targetWorldDiameter;
  const blend = state.golden * 0.42 * clamp01(calibration.confidence + 0.2);
  const diameter = THREE.MathUtils.lerp(current, targetWorldDiameter, blend);
  disc.scale.set(diameter, diameter, 1);

  const halo = scene.getObjectByName?.("rift-real-sun-halo");
  const aureole = scene.getObjectByName?.("rift-real-sun-aureole");
  if (halo?.scale && halo.scale.x < diameter * 8) {
    halo.scale.set(diameter * 8, diameter * 8, 1);
  }
  if (aureole?.scale && aureole.scale.x < diameter * 18) {
    aureole.scale.set(diameter * 18, diameter * 18, 1);
  }
}

function tuneModel40(handle, dt, sunDirection, sunColor, ambientColor, rainIntensity, camera) {
  const u = handle?.uniforms;
  if (!u) return;

  const reconstructed = handle.__riftModel4Atlas?.ready === true;
  const state = referenceWeights(sunDirection, rainIntensity);
  const blendState = handle.__riftModel40State || (handle.__riftModel40State = {
    blend: 0,
    baseDomainWarp: Number(u.m2DomainWarp?.value) || 1,
  });
  const safeDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
  const targetBlend = reconstructed ? 1 : 0;
  blendState.blend = THREE.MathUtils.lerp(
    blendState.blend,
    targetBlend,
    1 - Math.exp(-safeDt * 1.25),
  );
  const refBlend = clamp01(blendState.blend);

  if (reconstructed && u.m3ReferenceWeights?.value) {
    const current = u.m3ReferenceWeights.value;
    const target = state.weights;
    current.set(
      THREE.MathUtils.lerp(current.x, target[0], refBlend),
      THREE.MathUtils.lerp(current.y, target[1], refBlend),
      THREE.MathUtils.lerp(current.z, target[2], refBlend),
      THREE.MathUtils.lerp(current.w, target[3], refBlend),
    );
  }

  if (u.m3ReferenceStrength) {
    const target = THREE.MathUtils.lerp(0.965, 0.992, refBlend);
    u.m3ReferenceStrength.value = THREE.MathUtils.lerp(u.m3ReferenceStrength.value, target, 0.72);
  }
  if (u.m31CrownBreakup) {
    const target = THREE.MathUtils.lerp(u.m31CrownBreakup.value, 0.58, refBlend);
    u.m31CrownBreakup.value = THREE.MathUtils.lerp(u.m31CrownBreakup.value, target, 0.58);
  }
  if (u.m2EdgeErosion) {
    const target = THREE.MathUtils.lerp(u.m2EdgeErosion.value, state.storm > 0.35 ? 0.28 : 0.42, refBlend);
    u.m2EdgeErosion.value = THREE.MathUtils.lerp(u.m2EdgeErosion.value, target, 0.55);
  }
  if (u.m2DomainWarp) {
    const targetWarp = blendState.baseDomainWarp * THREE.MathUtils.lerp(1.0, 0.62, refBlend);
    u.m2DomainWarp.value = THREE.MathUtils.lerp(u.m2DomainWarp.value, targetWarp, 0.64);
  }

  if (u.m3ReferenceWorldScale) {
    const fairScale = 1 / 1360;
    const stormScale = 1 / 980;
    const targetScale = THREE.MathUtils.lerp(fairScale, stormScale, state.storm);
    u.m3ReferenceWorldScale.value = THREE.MathUtils.lerp(
      u.m3ReferenceWorldScale.value,
      targetScale,
      refBlend * 0.56,
    );
  }

  applyReferencePalette(handle, state, sunColor, ambientColor);
  applyReferenceSunGeometry(handle, state, camera);

  globalThis.__riftCloudModel40Debug = {
    active: true,
    version: "4.0-reference-reconstructed-sky",
    architecture: "photo segmentation -> signed distance/thickness -> 3D RGBA density atlas -> inherited Model 3.6 raymarch/TAAU/lighting",
    ready: reconstructed,
    blend: refBlend,
    atlas: {
      width: handle.__riftModel4Atlas?.width,
      height: handle.__riftModel4Atlas?.height,
      depth: handle.__riftModel4Atlas?.depth,
      bytes: handle.__riftModel4Atlas?.bytes,
      error: handle.__riftModel4Atlas?.error ? String(handle.__riftModel4Atlas.error) : null,
    },
    altitudeDeg: state.altitude,
    daylight: state.daylight,
    golden: state.golden,
    storm: state.storm,
    night: state.night,
    weights: state.weights,
    uniforms: {
      referenceStrength: u.m3ReferenceStrength?.value,
      crownBreakup: u.m31CrownBreakup?.value,
      edgeErosion: u.m2EdgeErosion?.value,
      domainWarp: u.m2DomainWarp?.value,
      worldScale: u.m3ReferenceWorldScale?.value,
    },
    threeRevision: THREE.REVISION,
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (!handle) return handle;

  handle.__riftModel3Atlas?.dispose?.();
  handle.__riftModel4Atlas = createReferenceReconstructedCloudAtlas(atlasSizeFor(handle));
  handle.__riftModel40Scene = scene;
  handle.__riftModel3Atlas = handle.__riftModel4Atlas;
  handle.__riftModel40 = true;
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
  tuneModel40(handle, dt, sunDirection, sunColor, ambientColor, rainIntensity, camera);
}

export function disposeVolumetricClouds(handle) {
  if (handle) {
    handle.__riftModel40 = false;
    delete handle.__riftModel40State;
    delete handle.__riftModel40Scene;
  }
  delete globalThis.__riftCloudModel40Debug;
  if (globalThis.__riftReferenceReconstruction?.version === "4.0-reference-reconstructed-volume") {
    delete globalThis.__riftReferenceReconstruction;
  }
  return base.disposeVolumetricClouds(handle);
}
