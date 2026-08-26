import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model42.js";

export * from "./volumetricClouds_r185_model42.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 4.3 — reference-scale solar disc + hybrid cloud-type variety.
//
// 4.2 moved toward the supplied sunset photograph, but the review exposed two
// remaining mismatches:
//   1) the visible solar body still read as a tiny horizon point because older
//      photometric core sprites kept their original compact scales;
//   2) the reconstructed macro mask could still dominate as one huge pink form.
//
// 4.3 makes the low-Sun presentation authoritative across *all* solar sprites and
// blends the reference reconstruction with the procedural macro field. This is
// intentionally closer to the cloud-type strategy used by modern volumetric
// renderers: authored/reference shape controls the composition while procedural
// structure supplies independent masses, holes, towers and wisps.
// -----------------------------------------------------------------------------

const TMP_WEIGHTS = new THREE.Vector4();
const TMP_WORLD = new THREE.Vector3();
const SUN_DISC = new THREE.Color(0xfffff2);
const SUN_CORE = new THREE.Color(0xffffff);
const SUN_WARM = new THREE.Color(0xffefad);
const HALO_GOLD = new THREE.Color(0xffc15a);
const HALO_ORANGE = new THREE.Color(0xff8d31);

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

function stateFor(handle, dt, sunDirection, rainIntensity = 0) {
  const celestial = globalThis.__riftCelestialModel35 || globalThis.__riftCelestialModel34 || {};
  const weather = globalThis.__riftProceduralWeatherState || {};
  const sunY = Number(sunDirection?.y) || 0;
  const altState = Number(celestial.altitudeDeg);
  const altitude = Number.isFinite(altState)
    ? altState
    : THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(sunY, -1, 1)));
  const daylight = clamp01(celestial.daylight ?? smoothRange(-0.10, 0.08, sunY));
  const storm = clamp01(weather.stormIntensity ?? rainIntensity);
  const golden = clamp01(
    celestial.goldenHour
      ?? (smoothRange(-5.5, 0.5, altitude) * (1 - smoothRange(13, 24, altitude)))
  ) * daylight;
  const horizon = smoothRange(-5, -0.25, altitude) * (1 - smoothRange(7, 16, altitude));
  const photo = clamp01(Math.max(golden, horizon)) * (1 - storm);

  const local = handle.__riftModel43State || (handle.__riftModel43State = {
    time: Math.random() * 100,
  });
  local.time += Math.min(Math.max(Number(dt) || 0, 0), 0.1);
  const variety = 0.5 + 0.5 * Math.sin(local.time * 0.041);
  const variety2 = 0.5 + 0.5 * Math.sin(local.time * 0.027 + 1.7);

  return { altitude, daylight, storm, golden, horizon, photo, variety, variety2 };
}

function tuneCloudVariety(handle, state) {
  const u = handle?.uniforms;
  if (!u) return;

  const photo = state.photo;
  const clear = 1 - state.storm;

  // Blend several reference families at once. The day/cumulus channel supplies
  // isolated cauliflower masses while dusk channels provide the flatter banks.
  // Slow phase variation prevents every sunset frame from being the same layout.
  let target;
  if (state.storm > 0.50) {
    target = TMP_WEIGHTS.set(0.10, 0.20, 0.34, 1.00);
  } else if (photo > 0.06) {
    target = TMP_WEIGHTS.set(
      0.26 + state.variety * 0.18,
      1.00,
      0.28 + state.variety2 * 0.24,
      0.004,
    );
  } else {
    target = TMP_WEIGHTS.set(
      1.00,
      0.24 + state.variety * 0.22,
      0.035 + state.variety2 * 0.06,
      0.006,
    );
  }

  const weights = u.m3ReferenceWeights?.value;
  if (weights?.isVector4) {
    const sum = Math.max(1e-5, target.x + target.y + target.z + target.w);
    const response = 0.34;
    weights.set(
      THREE.MathUtils.lerp(weights.x, target.x / sum, response),
      THREE.MathUtils.lerp(weights.y, target.y / sum, response),
      THREE.MathUtils.lerp(weights.z, target.z / sum, response),
      THREE.MathUtils.lerp(weights.w, target.w / sum, response),
    );
  }

  // This is the key anti-sheet change: reference density no longer owns almost
  // the entire macro silhouette. Roughly half of the macro field comes from the
  // independent procedural volume, which punches holes and produces distinct
  // bodies while the photo atlas continues to guide their broad arrangement.
  if (u.m3ReferenceStrength) {
    const targetStrength = state.storm > 0.50
      ? 0.80
      : THREE.MathUtils.lerp(0.64, 0.54, photo);
    u.m3ReferenceStrength.value = THREE.MathUtils.lerp(
      Number(u.m3ReferenceStrength.value) || targetStrength,
      targetStrength,
      0.48,
    );
  }

  if (u.m31CrownBreakup) {
    const targetBreakup = state.storm > 0.50
      ? 0.74
      : THREE.MathUtils.lerp(0.88, 1.00, photo);
    u.m31CrownBreakup.value = THREE.MathUtils.lerp(
      Number(u.m31CrownBreakup.value) || targetBreakup,
      targetBreakup,
      0.44,
    );
  }

  if (u.m2EdgeErosion) {
    const targetErosion = state.storm > 0.50
      ? 0.46
      : THREE.MathUtils.lerp(0.62, 0.78, photo);
    u.m2EdgeErosion.value = THREE.MathUtils.lerp(
      Number(u.m2EdgeErosion.value) || targetErosion,
      targetErosion,
      0.46,
    );
  }

  if (u.m2DomainWarp) {
    const baseWarp = Number(handle?.__riftModel40State?.baseDomainWarp) || 1;
    const targetWarp = baseWarp * THREE.MathUtils.lerp(0.96, 1.08, photo);
    u.m2DomainWarp.value = THREE.MathUtils.lerp(
      Number(u.m2DomainWarp.value) || targetWarp,
      targetWarp,
      0.34,
    );
  }

  if (u.m3ReferenceWorldScale) {
    // Increase atlas frequency at sunset so the camera sees many separated cloud
    // groups rather than one giant reconstructed feature spanning the viewport.
    const dayScale = 1 / 520;
    const sunsetScale = 1 / 335;
    const stormScale = 1 / 760;
    const targetScale = state.storm > 0.50
      ? stormScale
      : THREE.MathUtils.lerp(dayScale, sunsetScale, photo);
    u.m3ReferenceWorldScale.value = THREE.MathUtils.lerp(
      Number(u.m3ReferenceWorldScale.value) || targetScale,
      targetScale,
      0.44,
    );
  }

  if (u.coverage) {
    // The supplied sunset reference has clear gaps around every bank. Keep the
    // sky visibly open so the Sun and cloud-cut rays have room to read.
    const targetCoverage = state.storm > 0.50
      ? 0.72
      : THREE.MathUtils.lerp(0.50, 0.40 + state.variety * 0.035, photo);
    u.coverage.value = THREE.MathUtils.lerp(
      Number(u.coverage.value) || targetCoverage,
      targetCoverage,
      0.44,
    );
  }

  if (u.density) {
    const targetDensity = state.storm > 0.50
      ? 0.74
      : THREE.MathUtils.lerp(0.60, 0.57, photo);
    u.density.value = THREE.MathUtils.lerp(
      Number(u.density.value) || targetDensity,
      targetDensity,
      0.34,
    );
  }

  if (u.cloudBaseY && u.cloudTopY) {
    // Day remains a deep cumulus layer; sunset compresses into distant broken
    // banks but retains enough thickness for a few vertically developed cells.
    const dayBase = 60;
    const dayTop = 222;
    const sunsetBase = 116;
    const sunsetTop = 212;
    const targetBase = THREE.MathUtils.lerp(dayBase, sunsetBase, photo);
    const targetTop = THREE.MathUtils.lerp(dayTop, sunsetTop, photo);
    u.cloudBaseY.value = THREE.MathUtils.lerp(Number(u.cloudBaseY.value) || targetBase, targetBase, 0.28);
    u.cloudTopY.value = THREE.MathUtils.lerp(Number(u.cloudTopY.value) || targetTop, targetTop, 0.28);
    if (handle.mesh) handle.mesh.position.y = u.cloudBaseY.value;
    const temporal = handle.__riftTemporalCloudState;
    if (temporal?.rawMesh) temporal.rawMesh.position.y = u.cloudBaseY.value;
    if (temporal?.displayMesh) temporal.displayMesh.position.y = u.cloudBaseY.value;
  }

  // Preserve enough condensate during golden hour for partial Sun occlusion, but
  // do not recreate Model 3.6's continuous solar corridor cloud sheet.
  if (photo > 0.10 && u.m3ReferenceOffset?.value) {
    const offset = u.m3ReferenceOffset.value;
    offset.x = (offset.x + Math.sin(state.variety * Math.PI * 2) * 0.0007 * photo + 1) % 1;
    offset.y = (offset.y + Math.cos(state.variety2 * Math.PI * 2) * 0.0005 * photo + 1) % 1;
  }

  globalThis.__riftCloudModel43Variety = {
    referenceStrength: u.m3ReferenceStrength?.value,
    worldScale: u.m3ReferenceWorldScale?.value,
    coverage: u.coverage?.value,
    density: u.density?.value,
    baseY: u.cloudBaseY?.value,
    topY: u.cloudTopY?.value,
    weights: weights?.toArray?.(),
    clear,
  };
}

function tuneReferenceSun(handle, state, camera) {
  const scene = handle?.__riftModel40Scene;
  if (!scene || !camera || state.daylight < 0.003) return;

  const disc = scene.getObjectByName?.("rift-real-sun-disc");
  if (!disc?.scale) return;
  disc.getWorldPosition(TMP_WORLD);
  const distance = Math.max(10, TMP_WORLD.distanceTo(camera.position));

  // The user's actual reference crop has a white/yellow core ~15% of the image
  // width. On Rift's portrait camera that corresponds to roughly a 4.5-5 degree
  // apparent photosphere. This is an artistic/reference match, not astronomy.
  const targetDeg = THREE.MathUtils.lerp(0.72, 4.85, state.photo);
  const targetDiameter = 2 * distance * Math.tan(THREE.MathUtils.degToRad(targetDeg) * 0.5);
  const currentDiameter = Number(disc.scale.x) || targetDiameter;
  const diameter = THREE.MathUtils.lerp(currentDiameter, targetDiameter, 0.68);

  disc.scale.set(diameter, diameter, 1);
  if (disc.material) {
    disc.material.color?.copy?.(SUN_DISC).lerp(SUN_WARM, state.photo * 0.12);
    disc.material.opacity = THREE.MathUtils.lerp(Number(disc.material.opacity) || 1, 1, 0.78);
    disc.material.blending = THREE.NormalBlending;
    disc.material.depthWrite = false;
    disc.material.toneMapped = false;
  }

  // Older celestial layers own most of the visible solar brightness. Scale all
  // of them from the same authoritative diameter so none can collapse the Sun
  // back to a tiny point after the geometric disc has been enlarged.
  const hotCore = scene.getObjectByName?.("rift-sun-hot-core-v7");
  const photoCore = scene.getObjectByName?.("rift-sun-photographic-core-v9");
  const bloom = scene.getObjectByName?.("rift-sun-bloom-v7");
  const halo = scene.getObjectByName?.("rift-real-sun-halo");
  const aureole = scene.getObjectByName?.("rift-real-sun-aureole");
  const horizonGlow = scene.getObjectByName?.("rift-real-sun-horizon-glow");
  const inner = scene.getObjectByName?.("rift-solar-inner-radiance-v15");
  const scatter = scene.getObjectByName?.("rift-solar-forward-scatter-v15");

  if (hotCore?.scale) hotCore.scale.set(diameter * 0.91, diameter * 0.91, 1);
  if (hotCore?.material) {
    hotCore.material.color?.copy?.(SUN_CORE);
    hotCore.material.opacity = THREE.MathUtils.lerp(Number(hotCore.material.opacity) || 0.9, 0.96, state.photo);
    hotCore.material.toneMapped = false;
  }

  if (photoCore?.scale) photoCore.scale.set(diameter * 0.72, diameter * 0.72, 1);
  if (photoCore?.material) {
    photoCore.material.color?.copy?.(SUN_CORE).multiplyScalar(4.8);
    photoCore.material.opacity = THREE.MathUtils.lerp(Number(photoCore.material.opacity) || 0.8, 0.92, state.photo);
    photoCore.material.toneMapped = false;
  }

  if (halo?.scale) halo.scale.set(diameter * 4.6, diameter * 4.6, 1);
  if (halo?.material) {
    halo.material.color?.copy?.(HALO_GOLD);
    halo.material.opacity = THREE.MathUtils.lerp(Number(halo.material.opacity) || 0, 0.26, state.photo);
  }

  if (bloom?.scale) bloom.scale.set(diameter * 4.0, diameter * 4.0, 1);
  if (bloom?.material) {
    bloom.material.color?.copy?.(HALO_GOLD);
    bloom.material.opacity = THREE.MathUtils.lerp(Number(bloom.material.opacity) || 0, 0.20, state.photo);
  }

  if (aureole?.scale) aureole.scale.set(diameter * 9.0, diameter * 9.0, 1);
  if (aureole?.material) {
    aureole.material.color?.copy?.(HALO_ORANGE);
    aureole.material.opacity = THREE.MathUtils.lerp(Number(aureole.material.opacity) || 0, 0.070, state.photo);
  }

  if (horizonGlow?.scale) horizonGlow.scale.set(diameter * 18, diameter * 6.0, 1);
  if (horizonGlow?.material) {
    horizonGlow.material.color?.copy?.(HALO_ORANGE);
    horizonGlow.material.opacity = THREE.MathUtils.lerp(Number(horizonGlow.material.opacity) || 0, 0.12, state.photo);
  }

  if (inner?.scale) inner.scale.set(diameter * 2.45, diameter * 2.45, 1);
  if (inner?.material) {
    inner.material.color?.copy?.(SUN_WARM);
    inner.material.opacity = THREE.MathUtils.lerp(Number(inner.material.opacity) || 0, 0.32, state.photo);
  }

  if (scatter?.scale) scatter.scale.set(diameter * 15, diameter * 5.2, 1);
  if (scatter?.material) {
    scatter.material.color?.copy?.(HALO_ORANGE);
    scatter.material.opacity = THREE.MathUtils.lerp(Number(scatter.material.opacity) || 0, 0.060, state.photo);
  }

  globalThis.__riftModel43Sun = {
    altitudeDeg: state.altitude,
    photoStrength: state.photo,
    targetAngularDiameterDeg: targetDeg,
    worldDiameter: diameter,
  };
}

function apply43(handle, dt, sunDirection, rainIntensity, camera) {
  if (!handle || !camera) return;
  const state = stateFor(handle, dt, sunDirection, rainIntensity);
  tuneCloudVariety(handle, state);
  tuneReferenceSun(handle, state, camera);

  globalThis.__riftCloudModel43Debug = {
    active: true,
    version: "4.3-reference-sun-hybrid-cloud-types",
    altitudeDeg: state.altitude,
    daylight: state.daylight,
    golden: state.golden,
    storm: state.storm,
    photoStrength: state.photo,
    variety: state.variety,
    variety2: state.variety2,
    cloud: globalThis.__riftCloudModel43Variety,
    sun: globalThis.__riftModel43Sun,
    threeRevision: THREE.REVISION,
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (handle) handle.__riftModel43 = true;
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
  apply43(handle, dt, sunDirection, rainIntensity, camera);
}

export function disposeVolumetricClouds(handle) {
  if (handle) {
    handle.__riftModel43 = false;
    delete handle.__riftModel43State;
  }
  delete globalThis.__riftCloudModel43Variety;
  delete globalThis.__riftModel43Sun;
  delete globalThis.__riftCloudModel43Debug;
  return base.disposeVolumetricClouds(handle);
}
