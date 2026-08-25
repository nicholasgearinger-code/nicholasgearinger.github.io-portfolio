import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model24.js";

export * from "./volumetricClouds_r185_model24.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 2.5 — mobile temporal stability + broken-cumulus presentation.
//
// The latest iPhone captures exposed the real remaining failure mode: Model 2's
// 31%-resolution TAAU history was carrying too much old cloud radiance. At a low
// 14-15 fps, 5.5% current-frame weight turns moving/evolving clouds into broad
// horizontal smears and rectangular history patches. The sky then appears gray
// or mauve even when the atmosphere itself is blue.
//
// 2.5 keeps the proven 16x2 Mobile Low raymarch but:
//   * raises cloud input resolution moderately (31% -> 36%), not full-res;
//   * increases TAAU current-frame contribution so history clears much faster;
//   * tightens the retained history velocity range;
//   * opens fair-weather coverage and raises the cloud base slightly;
//   * suppresses low-horizon overdraw with thinner fair-weather layers.
//
// No new compute pass and no additional raymarch loops are introduced.
// -----------------------------------------------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function configureMobileQuality(handle) {
  const q = handle?.__riftModel2Quality;
  if (!q || q.label !== "mobile-low") return;

  // 36% is ~35% more pixels than 31%, but still only 13% of native pixel count.
  // Keep the expensive loop counts exactly where the known-good r185 path had
  // them; the extra resolution is aimed specifically at temporal block breakup.
  q.renderScale = 0.36;
  q.viewSteps = 16;
  q.lightSteps = 2;
}

function tuneTemporalReconstruction(handle) {
  const q = handle?.__riftModel2Quality;
  if (q?.label !== "mobile-low") return;

  const temporal = handle?.__riftTemporalCloudState;
  const taauState = handle?.__riftModel2TAAUState;
  const scale = 0.36;

  if (temporal?.cloudPass) {
    temporal.cloudPass.setResolutionScale?.(scale);
    temporal.resolutionScale = scale;
  }

  if (taauState) {
    taauState.resolutionScale = scale;
    const node = taauState.node;
    if (node) {
      // Original was 0.055. At 14 fps that retains visibly stale weather for far
      // too long. 0.18 still gives temporal smoothing but reacts within a handful
      // of frames when silhouettes or lighting change.
      node.currentFrameWeight = 0.18;
      node.depthThreshold = 0.0022;
      node.edgeDepthDiff = 0.0045;
      node.maxVelocityLength = 38;
    }
  }

  if (globalThis.__riftModel2TAAUDebug) {
    Object.assign(globalThis.__riftModel2TAAUDebug, {
      inputResolutionScale: scale,
      currentFrameWeight: taauState?.node?.currentFrameWeight ?? 0.18,
      maxVelocityLength: taauState?.node?.maxVelocityLength ?? 38,
      model25MobileStability: true,
    });
  }
}

function tuneBrokenCumulus(handle, rainIntensity = 0) {
  const u = handle?.uniforms;
  if (!u) return;

  const sky = globalThis.__riftSkyPhysicalV13
    || globalThis.__riftSkyPhysicalV12
    || globalThis.__riftSkyPhysicalV11;
  const weather = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(weather?.stormIntensity ?? rainIntensity);
  const humidity = clamp01(weather?.humidity ?? sky?.humidity ?? 0.64);
  const requestedCoverage = clamp01(weather?.cloudCoverage ?? 0.44);
  const convection = clamp01(weather?.convection ?? 0.72);
  const lowSun = clamp01(sky?.lowSun ?? 0);
  const daylight = clamp01(sky?.daylight ?? 1);

  // The reference photo is a broken field, not an overcast veil. At clear weather
  // keep substantial blue windows even if humidity is high. Storm logic retains
  // authority and can still close the deck almost completely.
  const fairCoverage = THREE.MathUtils.clamp(
    0.31 + requestedCoverage * 0.17 + humidity * 0.075,
    0.36,
    0.49,
  );
  if (u.coverage) u.coverage.value = THREE.MathUtils.lerp(fairCoverage, 0.89, storm);

  const fairDensity = THREE.MathUtils.clamp(0.53 + humidity * 0.065, 0.55, 0.59);
  if (u.density) u.density.value = THREE.MathUtils.lerp(fairDensity, 0.83, storm);

  // Raise the fair-weather layer and reduce thickness. This keeps low grazing rays
  // from traversing an enormous dense slab right above the sea horizon, one of the
  // strongest causes of the horizontal bands in the screenshots.
  const fairBase = THREE.MathUtils.lerp(78, 62, humidity);
  const baseY = THREE.MathUtils.lerp(fairBase, 34, storm);
  const fairThickness = 78 + convection * 46 + humidity * 12;
  const topY = baseY + THREE.MathUtils.lerp(fairThickness, 214, storm);
  if (u.cloudBaseY) u.cloudBaseY.value = baseY;
  if (u.cloudTopY) u.cloudTopY.value = topY;

  if (handle.mesh) handle.mesh.position.y = baseY;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;

  // Stronger edge breakup in fair weather creates individual lobes instead of
  // smooth reconstructed rectangles. Storms stay broader and denser.
  if (u.m2EdgeErosion) {
    u.m2EdgeErosion.value = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(0.55, 0.47, humidity),
      0.30,
      storm,
    );
  }
  if (u.m2DomainWarp) {
    u.m2DomainWarp.value = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(0.082, 0.098, convection),
      0.061,
      storm,
    );
  }
  if (u.m2DensityBias) {
    u.m2DensityBias.value = THREE.MathUtils.lerp(-0.045, -0.012, storm);
  }
  if (u.m2DensityScale) {
    u.m2DensityScale.value = THREE.MathUtils.lerp(1.04, 1.25, storm);
  }

  // Sunset cloud faces should darken with the sky while retaining a localized
  // warm edge. Model 2.4 already dims them; 2.5 trims the remaining emission-like
  // look seen in the horizon strips.
  if (u.sunColor?.value?.isColor) {
    u.sunColor.value.multiplyScalar(THREE.MathUtils.lerp(1.0, 0.82, lowSun));
  }
  if (u.ambientColor?.value?.isColor) {
    u.ambientColor.value.multiplyScalar(
      THREE.MathUtils.lerp(0.86, 1.0, daylight),
    );
  }
  if (u.m2SilverStrength) {
    u.m2SilverStrength.value *= THREE.MathUtils.lerp(1.0, 0.78, lowSun);
  }

  if (handle.__riftCirrus?.material) {
    handle.__riftCirrus.material.opacity *= 0.72;
  }

  globalThis.__riftCloudModel25 = {
    version: "2.5-mobile-temporal-stability",
    coverage: Number(u.coverage?.value) || 0,
    density: Number(u.density?.value) || 0,
    baseY,
    topY,
    humidity,
    convection,
    storm,
    lowSun,
    daylight,
    renderScale: handle?.__riftModel2Quality?.renderScale || 0,
    taauCurrentFrameWeight: handle?.__riftModel2TAAUState?.node?.currentFrameWeight || 0,
    threeRevision: THREE.REVISION,
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (!handle) return handle;
  handle.__riftModel25 = true;
  configureMobileQuality(handle);
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

  tuneTemporalReconstruction(handle);
  tuneBrokenCumulus(handle, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  delete globalThis.__riftCloudModel25;
  return base.disposeVolumetricClouds(handle);
}
