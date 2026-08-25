import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model2.js";

export * from "./volumetricClouds_r185_model2.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 2.1 — global-light synchronization.
//
// Model 2.0 already receives the real Sun colour, but its shader treated that
// colour as if it had roughly constant radiometric energy. This wrapper keeps the
// proven 2.0 density/shader and scales the existing Sun/ambient uniforms from the
// same v7 solar state that lights terrain and props. Sunrise/sunset therefore
// change cloud luminance as well as hue, and overcast weather retains diffuse
// blue-gray skylight instead of becoming featureless white or crushed black.
// -----------------------------------------------------------------------------

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(v) || 0));
}

function syncGlobalCloudLighting(handle, sunColor, ambientColor) {
  const u = handle?.uniforms;
  if (!u) return;

  const solar = globalThis.__riftSolarLightingV7 || globalThis.__riftSolarLightingV6;
  if (!solar) return;

  const daylight = clamp(solar.skyDaylight, 0, 1);
  const highSun = clamp(solar.highSun, 0, 1);
  const goldenHour = clamp(solar.goldenHour, 0, 1);
  const storm = clamp(solar.storm, 0, 1);
  const overcast = clamp(solar.overcast ?? (1 - (solar.cloudTransmittance ?? 1)), 0, 1);

  // Normalize around v7's clear-noon target (~6.5 DirectionalLight units). The
  // shader is linear/HDR-capable, so values slightly above 1 are intentional.
  const directEnergy = clamp((solar.directSunIntensity || 0) / 6.4, 0, 1.20);
  const skyEnergy = clamp((solar.ambientIntensity || 0) / 0.31, 0.12, 1.25);

  if (u.sunColor?.value?.isColor) {
    u.sunColor.value.copy(sunColor || solar.sunColor || new THREE.Color(0xffffff));
    const sunScale = THREE.MathUtils.lerp(0.06, 1.18, directEnergy)
      * THREE.MathUtils.lerp(0.90, 1.06, highSun);
    u.sunColor.value.multiplyScalar(sunScale);
  }

  if (u.ambientColor?.value?.isColor) {
    u.ambientColor.value.copy(ambientColor || solar.ambientColor || new THREE.Color(0x9fbfd5));
    const ambientScale = THREE.MathUtils.lerp(0.48, 1.02, daylight)
      * THREE.MathUtils.lerp(0.92, 1.10, overcast)
      * THREE.MathUtils.lerp(1.0, 0.92, goldenHour)
      * clamp(skyEnergy, 0.45, 1.20);
    u.ambientColor.value.multiplyScalar(ambientScale);
  }

  // Preserve dimensional storm clouds: stronger extinction and lower silver
  // lining under overcast skies, while clear weather keeps brighter sun-facing
  // cauliflower crowns. These are existing uniforms, so no shader recompile.
  if (u.m2LightExtinction) {
    u.m2LightExtinction.value = THREE.MathUtils.lerp(0.62, 0.88, Math.max(storm, overcast * 0.72));
  }
  if (u.m2SilverStrength) {
    u.m2SilverStrength.value = THREE.MathUtils.lerp(0.48, 0.16, Math.max(storm, overcast));
  }
  if (u.m2AmbientStrength) {
    u.m2AmbientStrength.value = THREE.MathUtils.lerp(0.60, 0.50, storm)
      * THREE.MathUtils.lerp(1.0, 1.08, overcast);
  }

  globalThis.__riftCloudModel21Lighting = {
    directEnergy,
    skyEnergy,
    daylight,
    goldenHour,
    storm,
    overcast,
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (handle) handle.__riftModel21 = true;
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

  syncGlobalCloudLighting(handle, sunColor, ambientColor);
}

export function disposeVolumetricClouds(handle) {
  delete globalThis.__riftCloudModel21Lighting;
  return base.disposeVolumetricClouds(handle);
}
