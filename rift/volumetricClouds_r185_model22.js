import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model21.js";

export * from "./volumetricClouds_r185_model21.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 2.2 — low-Sun spectral lighting.
//
// Density/raymarch architecture remains Model 2.0. This pass only retunes the
// already-existing lighting uniforms from the v8 atmospheric state so sunrise
// and sunset produce warm rims/crowns, peach-lit thin edges, and slightly warm
// lower-cloud fill while preserving blue-gray storm interiors.
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

function applySunsetCloudLighting(handle) {
  const u = handle?.uniforms;
  const sunset = globalThis.__riftSunsetAtmosphereV8;
  if (!u || !sunset) return;

  const golden = clamp01(sunset.goldenHour) * clamp01(sunset.clear);
  const fire = clamp01(sunset.horizonFire) * clamp01(sunset.clear);
  const lowSun = Math.max(golden, fire);
  const storm = clamp01(sunset.storm);
  const cloudT = clamp01(sunset.cloudTransmittance ?? 1);

  // Preserve the HDR energy established by Model 2.1, then rotate the spectrum
  // toward the shared low-Sun cloud tint. This avoids accidentally flattening
  // clear-noon brightness back to an LDR Color value.
  if (u.sunColor?.value?.isColor) {
    const energy = maxChannel(u.sunColor.value);
    TMP_LIGHT.copy(sunset.cloudLightTint || sunset.directLightColor || u.sunColor.value);
    TMP_LIGHT.multiplyScalar(
      energy * THREE.MathUtils.lerp(1.0, 1.30, lowSun) * THREE.MathUtils.lerp(0.82, 1.0, cloudT),
    );
    u.sunColor.value.lerp(TMP_LIGHT, lowSun * 0.88);
  }

  // Warm light scattered upward from the illuminated horizon subtly enters the
  // cloud underside. Storms keep their cool gray character and suppress this.
  if (u.ambientColor?.value?.isColor) {
    const ambientEnergy = maxChannel(u.ambientColor.value);
    TMP_AMBIENT.copy(sunset.cloudShadowTint || sunset.ambientColor || u.ambientColor.value)
      .multiplyScalar(ambientEnergy);
    u.ambientColor.value.lerp(
      TMP_AMBIENT,
      lowSun * THREE.MathUtils.lerp(0.36, 0.08, storm),
    );
  }

  // Thin edges become especially luminous at low solar angles because the light
  // path is tangential through the cloud shell. Keep this muted in overcast rain.
  if (u.m2SilverStrength) {
    const target = THREE.MathUtils.lerp(0.48, 0.68, lowSun)
      * THREE.MathUtils.lerp(1.0, 0.34, storm);
    u.m2SilverStrength.value = THREE.MathUtils.lerp(
      Number(u.m2SilverStrength.value) || target,
      target,
      0.62,
    );
  }

  if (u.m2MultiScatter) {
    const target = THREE.MathUtils.lerp(0.25, 0.34, lowSun)
      * THREE.MathUtils.lerp(1.0, 0.82, storm);
    u.m2MultiScatter.value = THREE.MathUtils.lerp(
      Number(u.m2MultiScatter.value) || target,
      target,
      0.55,
    );
  }

  // Clear golden-hour clouds need slightly more transmissive rims; storm clouds
  // retain the stronger extinction established by Model 2.1.
  if (u.m2LightExtinction) {
    const clearTarget = THREE.MathUtils.lerp(0.62, 0.56, lowSun);
    const stormTarget = THREE.MathUtils.lerp(clearTarget, 0.90, storm);
    u.m2LightExtinction.value = THREE.MathUtils.lerp(
      Number(u.m2LightExtinction.value) || stormTarget,
      stormTarget,
      0.48,
    );
  }

  if (u.m2AmbientStrength) {
    const target = THREE.MathUtils.lerp(0.59, 0.54, lowSun)
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
  if (handle) handle.__riftModel22 = true;
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

  applySunsetCloudLighting(handle);
}

export function disposeVolumetricClouds(handle) {
  delete globalThis.__riftCloudModel22Lighting;
  return base.disposeVolumetricClouds(handle);
}
