import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model21.js";

export * from "./volumetricClouds_r185_model21.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 2.2b — persistent cloud field + low-Sun spectral lighting.
//
// The denser weather texture now provides many more cloud families. This wrapper
// raises the clear-weather formation floor while trimming Mobile Low ray/light
// loops before the shader compiles so the extra occupied cloud pixels do not
// immediately erase the performance gain from r185 TAAU.
// -----------------------------------------------------------------------------

const TMP_LIGHT = new THREE.Color();
const TMP_AMBIENT = new THREE.Color();

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function maxChannel(c) {
  if (!c?.isColor) return 1;
  return Math.max(c.r, c.g, c.b, 0.0001);
}

function tunePersistentCloudField(handle, rainIntensity = 0) {
  const u = handle?.uniforms;
  if (!u) return;

  const weather = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(weather?.stormIntensity ?? rainIntensity);
  const requestedCoverage = clamp01(weather?.cloudCoverage ?? 0.56);
  const requestedHumidity = clamp01(weather?.humidity ?? 0.74);
  const requestedConvection = clamp01(weather?.convection ?? 0.78);
  const sunset = globalThis.__riftSunsetAtmosphereV9 || globalThis.__riftSunsetAtmosphereV8;
  const lowSun = clamp01(sunset?.sunsetStrength ?? 0);

  // Much more persistent fair-weather cumulus. The upper bound still leaves blue
  // windows, while storms are allowed to approach a continuous cloud deck.
  if (u.coverage) {
    const fairCoverage = THREE.MathUtils.clamp(
      Math.max(0.58, requestedCoverage + 0.08 + lowSun * 0.025),
      0.58,
      0.72,
    );
    u.coverage.value = THREE.MathUtils.lerp(fairCoverage, 0.92, storm);
  }
  if (u.density) u.density.value = THREE.MathUtils.lerp(0.61, 0.85, storm);
  if (u.humidity) {
    u.humidity.value = THREE.MathUtils.lerp(
      Math.max(0.74, requestedHumidity),
      0.97,
      storm,
    );
  }
  if (u.convection) {
    u.convection.value = THREE.MathUtils.lerp(
      Math.max(0.76, requestedConvection),
      0.99,
      storm,
    );
  }
  if (u.erosion) u.erosion.value = THREE.MathUtils.lerp(0.43, 0.30, storm);

  // Preserve cauliflower breakup without eroding the larger number of clouds out
  // of existence. A slightly more negative bias keeps visible cores persistent.
  if (u.m2DensityBias) u.m2DensityBias.value = THREE.MathUtils.lerp(-0.060, -0.018, storm);
  if (u.m2DensityScale) u.m2DensityScale.value = THREE.MathUtils.lerp(1.12, 1.23, storm);
  if (u.m2EdgeErosion) u.m2EdgeErosion.value = THREE.MathUtils.lerp(0.45, 0.32, storm);
  if (u.m2DomainWarp) u.m2DomainWarp.value = THREE.MathUtils.lerp(0.078, 0.061, storm);

  globalThis.__riftCloudModel22Coverage = {
    coverage: Number(u.coverage?.value) || 0,
    density: Number(u.density?.value) || 0,
    humidity: Number(u.humidity?.value) || 0,
    convection: Number(u.convection?.value) || 0,
    storm,
  };
}

function applySunsetCloudLighting(handle) {
  const u = handle?.uniforms;
  const sunset = globalThis.__riftSunsetAtmosphereV9 || globalThis.__riftSunsetAtmosphereV8;
  if (!u || !sunset) return;

  const golden = clamp01(sunset.goldenHour) * clamp01(sunset.clear);
  const fire = clamp01(sunset.horizonFire) * clamp01(sunset.clear);
  const lowSun = Math.max(golden, fire);
  const storm = clamp01(sunset.storm);
  const cloudT = clamp01(sunset.cloudTransmittance ?? 1);

  if (u.sunColor?.value?.isColor) {
    const energy = maxChannel(u.sunColor.value);
    TMP_LIGHT.copy(sunset.cloudLightTint || sunset.directLightColor || u.sunColor.value);
    TMP_LIGHT.multiplyScalar(
      energy
      * THREE.MathUtils.lerp(1.0, 1.34, lowSun)
      * THREE.MathUtils.lerp(0.82, 1.0, cloudT),
    );
    u.sunColor.value.lerp(TMP_LIGHT, lowSun * 0.90);
  }

  if (u.ambientColor?.value?.isColor) {
    const ambientEnergy = maxChannel(u.ambientColor.value);
    TMP_AMBIENT.copy(sunset.cloudShadowTint || sunset.ambientColor || u.ambientColor.value)
      .multiplyScalar(ambientEnergy);
    u.ambientColor.value.lerp(
      TMP_AMBIENT,
      lowSun * THREE.MathUtils.lerp(0.38, 0.08, storm),
    );
  }

  if (u.m2SilverStrength) {
    const target = THREE.MathUtils.lerp(0.50, 0.72, lowSun)
      * THREE.MathUtils.lerp(1.0, 0.34, storm);
    u.m2SilverStrength.value = THREE.MathUtils.lerp(
      Number(u.m2SilverStrength.value) || target,
      target,
      0.62,
    );
  }

  if (u.m2MultiScatter) {
    const target = THREE.MathUtils.lerp(0.25, 0.35, lowSun)
      * THREE.MathUtils.lerp(1.0, 0.82, storm);
    u.m2MultiScatter.value = THREE.MathUtils.lerp(
      Number(u.m2MultiScatter.value) || target,
      target,
      0.55,
    );
  }

  if (u.m2LightExtinction) {
    const clearTarget = THREE.MathUtils.lerp(0.62, 0.55, lowSun);
    const stormTarget = THREE.MathUtils.lerp(clearTarget, 0.90, storm);
    u.m2LightExtinction.value = THREE.MathUtils.lerp(
      Number(u.m2LightExtinction.value) || stormTarget,
      stormTarget,
      0.48,
    );
  }

  if (u.m2AmbientStrength) {
    const target = THREE.MathUtils.lerp(0.59, 0.53, lowSun)
      * THREE.MathUtils.lerp(1.0, 0.95, storm);
    u.m2AmbientStrength.value = THREE.MathUtils.lerp(
      Number(u.m2AmbientStrength.value) || target,
      target,
      0.38,
    );
  }

  globalThis.__riftCloudModel22Lighting = {
    goldenHour: golden,
    horizonFire: fire,
    lowSun,
    storm,
    cloudTransmittance: cloudT,
    silverStrength: Number(u.m2SilverStrength?.value) || 0,
    lightExtinction: Number(u.m2LightExtinction?.value) || 0,
    multiScatter: Number(u.m2MultiScatter?.value) || 0,
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (!handle) return handle;

  handle.__riftModel22 = true;

  // Important: Model 2 installs its final shader on the first update, not create.
  // Lowering these values here changes the compiled loop counts and offsets the
  // cost of rendering a much larger portion of the sky as cloud.
  const q = handle.__riftModel2Quality;
  if (q?.label === "mobile-low") {
    q.renderScale = 0.31;
    q.viewSteps = 16;
    q.lightSteps = 2;
  }

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

  // Base Model 2.0 retunes weather every frame. Override only after that update so
  // the denser persistent field remains authoritative.
  tunePersistentCloudField(handle, rainIntensity);
  applySunsetCloudLighting(handle);
}

export function disposeVolumetricClouds(handle) {
  delete globalThis.__riftCloudModel22Lighting;
  delete globalThis.__riftCloudModel22Coverage;
  return base.disposeVolumetricClouds(handle);
}
