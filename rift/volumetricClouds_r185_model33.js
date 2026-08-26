import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model32.js";
import { createReferenceCloudAtlas } from "./cloudReferenceVolumeAtlas_v3.js";
import {
  applyReferenceCloudEvolution,
  computeReferenceCloudStateV3,
} from "./cloudInstanceDirector_reference_v3.js";

export * from "./volumetricClouds_r185_model32.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 3.3 — multi-scale cloud families + weather structure.
//
// 3.3 keeps the 3.2 lighting and the exact 3.1 raymarch/TAAU path. Structural
// variety is baked into a v3 atlas so runtime cost stays essentially identical:
// hero cumulus now carry satellite puffs, broken-cumulus channels contain several
// offset families, distant clouds include flattened horizon banks, and the storm
// channel combines a low shelf with embedded convective towers.
// -----------------------------------------------------------------------------

function atlasSizeFor(handle) {
  const label = handle?.__riftModel2Quality?.label;
  if (label === "mobile-low") return { width: 64, height: 46, depth: 64 };
  if (label === "medium") return { width: 80, height: 54, depth: 80 };
  return { width: 96, height: 62, depth: 96 };
}

function tuneModel33Structure(handle, dt, sunDirection, rainIntensity) {
  const u = handle?.uniforms;
  if (!u) return;

  const state = computeReferenceCloudStateV3({
    sunDirection,
    rainIntensity,
  });

  // Structure-only controls. Model 3.2 owns the lighting values after the base
  // update, so 3.3 intentionally does NOT overwrite self-shadow/base/crown light.
  u.m3ReferenceWeights.value.set(...state.weights);
  u.m3ReferenceWorldScale.value = state.worldScale;
  u.m3ReferenceStrength.value = state.referenceStrength;
  u.m31CrownBreakup.value = state.crownBreakup;
  u.m2EdgeErosion.value = state.edgeErosion;
  u.m2DetailScale.value = state.detailScale;
  u.m2DensityScale.value = state.densityScale;

  // Preserve more blue gaps in fair weather; close the deck progressively only
  // when coverage/storm state actually calls for it.
  if (u.coverage) {
    const fairCoverage = THREE.MathUtils.clamp(
      0.39
        + state.coverage * 0.22
        + state.humidity * 0.05
        - state.clusterGap * 0.12,
      0.38,
      0.61,
    );
    u.coverage.value = THREE.MathUtils.lerp(fairCoverage, 0.91, state.storm);
  }
  if (u.density) {
    const fairDensity = THREE.MathUtils.clamp(
      0.50 + state.humidity * 0.08 + state.convection * 0.04,
      0.50,
      0.64,
    );
    u.density.value = THREE.MathUtils.lerp(fairDensity, 0.84, state.storm);
  }

  // Lower, flatter bases in humid/storm weather; maintain enough vertical space
  // for the additional v3 hero crowns without increasing maximum storm height.
  const fairBase = THREE.MathUtils.lerp(57, 47, state.humidity);
  const baseY = THREE.MathUtils.lerp(fairBase, 31, state.storm);
  const fairTop = baseY + 172 + state.convection * 54;
  const topY = THREE.MathUtils.lerp(fairTop, baseY + 240, state.storm);
  u.cloudBaseY.value = baseY;
  u.cloudTopY.value = topY;

  if (handle.mesh) handle.mesh.position.y = baseY;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;

  applyReferenceCloudEvolution(handle, dt, state);

  if (handle.__riftCirrus?.material) {
    const fairCirrus = THREE.MathUtils.lerp(0.010, 0.016, state.lowSun);
    handle.__riftCirrus.material.opacity = THREE.MathUtils.lerp(
      fairCirrus,
      0.0025,
      state.storm,
    ) * THREE.MathUtils.lerp(1.0, 0.76, state.humidity);
  }

  const offset = u.m3ReferenceOffset?.value;
  globalThis.__riftCloudModel33Debug = {
    active: true,
    version: "3.3-multiscale-family-atlas",
    architecture: "3.2 lighting + v3 multi-family single-sample atlas + weather-driven population weights + stable micro-evolution",
    atlas: {
      width: handle.__riftModel3Atlas?.width,
      height: handle.__riftModel3Atlas?.height,
      depth: handle.__riftModel3Atlas?.depth,
      bytes: handle.__riftModel3Atlas?.bytes,
    },
    weights: [...state.weights],
    worldScale: state.worldScale,
    referenceStrength: state.referenceStrength,
    offset: offset ? [offset.x, offset.y] : [0, 0],
    baseY,
    topY,
    storm: state.storm,
    humidity: state.humidity,
    coverage: state.coverage,
    convection: state.convection,
    crownBreakup: state.crownBreakup,
    clusterGap: state.clusterGap,
    evolutionStrength: state.evolutionStrength,
    inheritedLighting: {
      silverStrength: u.m2SilverStrength?.value,
      crownLightBoost: u.m31CrownLightBoost?.value,
      selfShadow: u.m31SelfShadow?.value,
      baseDarkening: u.m31BaseDarkening?.value,
    },
    threeRevision: THREE.REVISION,
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (!handle) return handle;

  // Replace the 3.1 atlas BEFORE the first update compiles the inherited shader.
  // The shader still performs the same single reference-atlas lookup per sample.
  handle.__riftModel3Atlas?.dispose?.();
  handle.__riftModel3Atlas = createReferenceCloudAtlas(atlasSizeFor(handle));
  handle.__riftModel33 = true;
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
  tuneModel33Structure(handle, dt, sunDirection, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  if (handle) handle.__riftModel33 = false;
  delete globalThis.__riftCloudModel33Debug;
  return base.disposeVolumetricClouds(handle);
}
