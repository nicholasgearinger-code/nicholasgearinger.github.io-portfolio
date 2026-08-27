import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model28.js";

export * from "./volumetricClouds_r185_model28.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 2.9 — photographic cloud families + low-Sun backlighting.
//
// Model 2.8 established the important architecture: camera-centred volumetric
// clouds, phase-aware Sun/Moon scattering, celestial occlusion and a cheap moving
// terrain shadow map. This layer stays on that exact render path and only retunes
// the existing cloud-density / optical uniforms every frame.
//
// Visual target:
//   * distinct fair-weather cumulus families instead of broad cotton slabs;
//   * flatter condensation bases and solid dark cores;
//   * rounded cauliflower towers with strongly eroded outer lobes;
//   * a hierarchy of small, medium and tall cloud forms produced by the existing
//     weather-map cloud-type channel rather than a single homogeneous deck;
//   * warm sunrise/sunset transmission and cloud-edge backlighting;
//   * deep cool-gray shadow sides while the Sun-facing rim stays bright;
//   * no extra WebGPU pass, ray step, render target or temporal history buffer.
// -----------------------------------------------------------------------------

const DAYLIGHT_WHITE = new THREE.Color(0xfff8ed);
const GOLDEN_EDGE = new THREE.Color(0xffc082);
const SUNSET_EDGE = new THREE.Color(0xff8a55);
const TWILIGHT_EDGE = new THREE.Color(0xd98978);
const CLEAR_SKY_FILL = new THREE.Color(0x91b2cc);
const LOW_SUN_FILL = new THREE.Color(0x66788e);
const STORM_FILL = new THREE.Color(0x475563);

const TMP_DIRECT = new THREE.Color();
const TMP_AMBIENT = new THREE.Color();

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

function solarState() {
  const optics = globalThis.__riftCelestialOpticsV14;
  const sunset = globalThis.__riftSunsetAtmosphereV9
    || globalThis.__riftSunsetAtmosphereV8
    || globalThis.__riftSkyPhysicalV13
    || globalThis.__riftSkyPhysicalV12;

  let altitudeDeg = Number(sunset?.altitudeDeg);
  if (!Number.isFinite(altitudeDeg)) {
    const elevation = THREE.MathUtils.clamp(Number(optics?.solarElevation) || -1, -1, 1);
    altitudeDeg = THREE.MathUtils.radToDeg(Math.asin(elevation));
  }

  const daylight = clamp01(optics?.dayAmount ?? sunset?.daylight ?? 0);
  const lowSun = clamp01(
    sunset?.sunsetStrength
    ?? Math.max(
      smoothRange(-5.0, 5.0, altitudeDeg) * (1 - smoothRange(18.0, 34.0, altitudeDeg)),
      0,
    )
  );
  const golden = clamp01(
    sunset?.goldenHour
    ?? (smoothRange(-2.0, 5.0, altitudeDeg) * (1 - smoothRange(11.0, 22.0, altitudeDeg)))
  );
  const horizonFire = clamp01(
    sunset?.horizonFire
    ?? (smoothRange(-5.0, 0.5, altitudeDeg) * (1 - smoothRange(4.0, 10.0, altitudeDeg)))
  );
  const twilight = clamp01(
    sunset?.twilight
    ?? (1 - smoothRange(-5.5, 7.0, altitudeDeg))
  );

  return {
    optics,
    sunset,
    altitudeDeg,
    daylight,
    lowSun,
    golden,
    horizonFire,
    twilight,
  };
}

function tunePhotographicStructure(handle, rainIntensity = 0) {
  const u = handle?.uniforms;
  if (!u) return null;

  const weather = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(weather?.stormIntensity ?? rainIntensity);
  const requestedCoverage = clamp01(weather?.cloudCoverage ?? 0.44);
  const humidity = clamp01(weather?.humidity ?? 0.70);
  const convection = clamp01(weather?.convection ?? 0.80);

  // Isolated cloud families need blue-sky gaps. Density is increased while
  // coverage is slightly reduced: less total sheet, more mass inside each cloud.
  const fairCoverage = THREE.MathUtils.clamp(
    0.405 + requestedCoverage * 0.145 + humidity * 0.035,
    0.43,
    0.515,
  );
  const fairDensity = THREE.MathUtils.lerp(0.67, 0.72, convection);

  if (u.coverage) u.coverage.value = THREE.MathUtils.lerp(fairCoverage, 0.89, storm);
  if (u.density) u.density.value = THREE.MathUtils.lerp(fairDensity, 0.88, storm);
  if (u.humidity) u.humidity.value = THREE.MathUtils.lerp(Math.max(0.70, humidity), 0.97, storm);
  if (u.convection) u.convection.value = THREE.MathUtils.lerp(Math.max(0.84, convection), 0.995, storm);
  if (u.erosion) u.erosion.value = THREE.MathUtils.lerp(0.66, 0.36, storm);

  // The underlying Model 2 shader already combines a broad Perlin signal with
  // several Worley channels. These values push the broad signal into separated
  // masses while exposing more Worley lobes specifically at the boundary — the
  // cauliflower-turret silhouette visible in photographic cumulus references.
  if (u.m2BaseScale) u.m2BaseScale.value = THREE.MathUtils.lerp(0.64, 0.47, storm);
  if (u.m2DetailScale) u.m2DetailScale.value = THREE.MathUtils.lerp(7.75, 5.35, storm);
  if (u.m2DomainWarp) u.m2DomainWarp.value = THREE.MathUtils.lerp(0.108, 0.070, storm);
  if (u.m2EdgeErosion) u.m2EdgeErosion.value = THREE.MathUtils.lerp(0.68, 0.38, storm);
  if (u.m2DensityBias) u.m2DensityBias.value = THREE.MathUtils.lerp(-0.012, -0.008, storm);
  if (u.m2DensityScale) u.m2DensityScale.value = THREE.MathUtils.lerp(1.23, 1.31, storm);

  // A real cumulus field shares a relatively level lifting-condensation base but
  // has strongly varying tops. Model 2's cloud-type channel already controls the
  // local vertical profile; this global slab simply gives that profile enough
  // vertical room for small, medium and tower clouds to coexist.
  const baseY = THREE.MathUtils.lerp(68, 35, storm);
  const towerRoom = 146 + convection * 50 + humidity * 15;
  const topY = baseY + THREE.MathUtils.lerp(towerRoom, 270, storm);
  if (u.cloudBaseY) u.cloudBaseY.value = baseY;
  if (u.cloudTopY) u.cloudTopY.value = topY;

  if (handle.mesh) handle.mesh.position.y = baseY;
  const temporal = handle.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;

  if (handle.__riftCirrus?.material) {
    // Keep a trace of high cloud, but the photographic target is predominantly
    // dimensional cumulus. Cirrus should never wash out the blue gaps.
    handle.__riftCirrus.material.opacity *= THREE.MathUtils.lerp(0.62, 0.48, storm);
  }

  return {
    storm,
    coverage: Number(u.coverage?.value) || fairCoverage,
    density: Number(u.density?.value) || fairDensity,
    humidity,
    convection,
    baseY,
    topY,
  };
}

function applySunriseSunsetBacklighting(handle, structure) {
  const u = handle?.uniforms;
  if (!u || !structure) return null;

  const solar = solarState();
  const storm = structure.storm;
  const clear = 1 - storm;
  const sunOcclusion = clamp01(globalThis.__riftSunDiskOcclusion || 0);

  // Peak backlighting occurs with the light low in the sky AND a cloud partly
  // crossing the solar line of sight. At complete occlusion the hard source is
  // hidden, so the rim remains but does not grow without bound.
  const partialOcclusion = 1 - Math.min(1, Math.abs(sunOcclusion - 0.56) / 0.56);
  const grazing = solar.lowSun * clear;
  const backlight = clamp01(
    grazing * (0.42 + partialOcclusion * 0.58) * solar.daylight,
  );
  const sunsetFire = clamp01(solar.horizonFire * clear);
  const golden = clamp01(solar.golden * clear);

  // Direct cloud light follows the same atmosphere palette as the Sun itself.
  // When a dedicated cloud-light tint exists, honor it; otherwise interpolate
  // from white daylight through warm golden-hour and orange horizon light.
  TMP_DIRECT.copy(DAYLIGHT_WHITE);
  if (solar.sunset?.cloudLightTint?.isColor) {
    TMP_DIRECT.copy(solar.sunset.cloudLightTint);
  } else {
    TMP_DIRECT.lerp(GOLDEN_EDGE, golden * 0.78);
    TMP_DIRECT.lerp(SUNSET_EDGE, sunsetFire * 0.90);
    TMP_DIRECT.lerp(TWILIGHT_EDGE, solar.twilight * (1 - solar.daylight) * 0.35);
  }

  if (u.sunColor?.value?.isColor) {
    // Preserve the Moon path authored by Model 2.7 at night. Only retint while
    // direct solar daylight remains materially present.
    const solarAuthority = smoothRange(0.035, 0.22, solar.daylight);
    u.sunColor.value.lerp(TMP_DIRECT, solarAuthority * (0.38 + grazing * 0.62));
  }

  // Backlit photographs have strongly separated values: a bright translucent rim
  // around a much cooler, darker interior. Reduce hemispheric fill at low Sun,
  // rather than brightening the entire cloud orange.
  TMP_AMBIENT.copy(CLEAR_SKY_FILL)
    .lerp(LOW_SUN_FILL, grazing * 0.68)
    .lerp(STORM_FILL, storm * 0.78);
  if (solar.sunset?.cloudShadowTint?.isColor) {
    TMP_AMBIENT.lerp(solar.sunset.cloudShadowTint, grazing * 0.46);
  }
  if (u.ambientColor?.value?.isColor) {
    u.ambientColor.value.lerp(TMP_AMBIENT, solar.daylight * (0.20 + grazing * 0.46));
  }

  // Silver lining: stronger at grazing angles and strongest when the solar disc is
  // partially obscured. This uses the shader's existing HG phase function, so the
  // boost remains directional rather than lighting every edge indiscriminately.
  if (u.m2SilverStrength) {
    const midday = THREE.MathUtils.lerp(0.43, 0.30, storm);
    const lowSunRim = THREE.MathUtils.lerp(0.70, 0.52, storm);
    const target = THREE.MathUtils.lerp(midday, lowSunRim, grazing)
      + backlight * 0.22;
    u.m2SilverStrength.value = Math.min(0.88, target);
  }

  // Approximate the characteristic inner glow/powder response of optically thick
  // cloud near the light-facing boundary, while leaving dense cores dimensional.
  if (u.m2MultiScatter) {
    const target = THREE.MathUtils.lerp(0.255, 0.34, backlight)
      * THREE.MathUtils.lerp(1.0, 0.80, storm);
    u.m2MultiScatter.value = target;
  }

  // At low solar altitude the optical path through a cloud is longer. Raising
  // extinction darkens the core while the independent silver/multiscatter terms
  // preserve the bright rim — the high-contrast backlit look in the references.
  if (u.m2LightExtinction) {
    u.m2LightExtinction.value = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(0.66, 0.82, storm),
      THREE.MathUtils.lerp(0.79, 0.90, storm),
      grazing,
    );
  }

  if (u.m2AmbientStrength) {
    const dayFill = THREE.MathUtils.lerp(0.57, 0.46, storm);
    const lowSunFill = THREE.MathUtils.lerp(0.43, 0.38, storm);
    u.m2AmbientStrength.value = THREE.MathUtils.lerp(dayFill, lowSunFill, grazing);
  }

  globalThis.__riftCloudModel29Lighting = {
    altitudeDeg: solar.altitudeDeg,
    daylight: solar.daylight,
    lowSun: solar.lowSun,
    golden,
    sunsetFire,
    sunOcclusion,
    partialOcclusion,
    backlight,
    silverStrength: Number(u.m2SilverStrength?.value) || 0,
    multiScatter: Number(u.m2MultiScatter?.value) || 0,
    lightExtinction: Number(u.m2LightExtinction?.value) || 0,
    ambientStrength: Number(u.m2AmbientStrength?.value) || 0,
  };

  return globalThis.__riftCloudModel29Lighting;
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (handle) handle.__riftModel29 = true;
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

  if (!handle) return;
  const structure = tunePhotographicStructure(handle, rainIntensity);
  const lighting = applySunriseSunsetBacklighting(handle, structure);

  globalThis.__riftCloudModel29 = {
    version: "2.9-photographic-cloud-families-backlighting",
    structure,
    lighting,
    inheritedModel28: globalThis.__riftCloudModel28 || null,
    renderScale: handle.__riftModel2Quality?.renderScale || 0,
    viewSteps: handle.__riftModel2Quality?.viewSteps || 0,
    lightSteps: handle.__riftModel2Quality?.lightSteps || 0,
    threeRevision: THREE.REVISION,
  };
}

export function disposeVolumetricClouds(handle) {
  delete globalThis.__riftCloudModel29;
  delete globalThis.__riftCloudModel29Lighting;
  return base.disposeVolumetricClouds(handle);
}
