import * as THREE from "three";
import * as base from "./volumetricClouds_r185_model22.js";

export * from "./volumetricClouds_r185_model22.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 2.3 — atmosphere-coupled meteorological clouds.
//
// Model 2.2 already provides the proven r185 adaptive raymarch, TAAU, weather
// maps, Perlin-Worley density and cloud-shadow feedback. 2.3 intentionally does
// NOT replace that shader. It drives its existing uniforms from the new physical
// SkyMesh atmosphere so the cloud field evolves like weather instead of a static
// art preset:
//   * humidity / coverage / convection change occupancy and cloud-layer depth;
//   * the condensation base lowers in humid/stormy air while convective tops grow;
//   * solar altitude changes silver lining, multiple scattering and extinction;
//   * the exact Sun/sky palette used by terrain is fed into cloud radiance;
//   * the existing cloud-shadow map still attenuates the global directional Sun.
//
// Because these are uniform-only changes, Mobile Low keeps Model 2.2's 16x2
// compile-time ray/light budget and does not incur another cloud shader rebuild.
// -----------------------------------------------------------------------------

const TMP_SUN = new THREE.Color();
const TMP_AMBIENT = new THREE.Color();

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function maxChannel(c) {
  if (!c?.isColor) return 1;
  return Math.max(c.r, c.g, c.b, 0.0001);
}

function retintPreserveEnergy(target, tint, amount) {
  if (!target?.isColor || !tint?.isColor) return;
  const energy = maxChannel(target);
  TMP_SUN.copy(tint);
  TMP_SUN.multiplyScalar(energy / maxChannel(TMP_SUN));
  target.lerp(TMP_SUN, clamp01(amount));
}

function retintAmbientPreserveEnergy(target, tint, amount) {
  if (!target?.isColor || !tint?.isColor) return;
  const energy = maxChannel(target);
  TMP_AMBIENT.copy(tint);
  TMP_AMBIENT.multiplyScalar(energy / maxChannel(TMP_AMBIENT));
  target.lerp(TMP_AMBIENT, clamp01(amount));
}

function syncMeshLayerHeight(handle, baseY) {
  if (handle?.mesh) handle.mesh.position.y = baseY;
  const temporal = handle?.__riftTemporalCloudState;
  if (temporal?.rawMesh) temporal.rawMesh.position.y = baseY;
  if (temporal?.displayMesh) temporal.displayMesh.position.y = baseY;
}

function applyAtmosphereCoupling(handle, rainIntensity = 0) {
  const u = handle?.uniforms;
  if (!u) return;

  const physical = globalThis.__riftSkyPhysicalV11;
  const weather = globalThis.__riftProceduralWeatherState;
  const sunset = globalThis.__riftSunsetAtmosphereV9 || globalThis.__riftSunsetAtmosphereV8;

  const storm = clamp01(weather?.stormIntensity ?? rainIntensity);
  const humidity = clamp01(weather?.humidity ?? physical?.humidity ?? 0.68);
  const requestedCoverage = clamp01(weather?.cloudCoverage ?? physical?.cloudCoverage ?? 0.52);
  const convection = clamp01(weather?.convection ?? 0.76);
  const cloudT = clamp01(physical?.cloudTransmittance ?? 1);
  const lowSun = clamp01(sunset?.sunsetStrength ?? physical?.lowSun ?? 0);
  const daylight = clamp01(physical?.daylight ?? 1);

  // Fair-weather coverage follows real atmospheric moisture instead of being
  // pinned to one constant. The reference target is broken cumulus with generous
  // blue windows; storms still close toward a coherent deck.
  const fairCoverage = THREE.MathUtils.clamp(
    0.38 + requestedCoverage * 0.22 + humidity * 0.12,
    0.50,
    0.66,
  );
  if (u.coverage) u.coverage.value = THREE.MathUtils.lerp(fairCoverage, 0.92, storm);

  const fairDensity = THREE.MathUtils.clamp(0.55 + humidity * 0.085, 0.58, 0.64);
  if (u.density) u.density.value = THREE.MathUtils.lerp(fairDensity, 0.86, storm);
  if (u.humidity) u.humidity.value = THREE.MathUtils.lerp(Math.max(0.66, humidity), 0.98, storm);
  if (u.convection) u.convection.value = THREE.MathUtils.lerp(Math.max(0.62, convection), 0.995, storm);
  if (u.erosion) {
    const fairErosion = THREE.MathUtils.lerp(0.50, 0.40, humidity);
    u.erosion.value = THREE.MathUtils.lerp(fairErosion, 0.29, storm);
  }

  // A dynamic condensation layer is one of the strongest cues that clouds belong
  // to the weather. Humid/storm air lowers the base; convection raises cloud tops
  // without changing the nearly-flat base assumption used by the raymarch.
  const dryBase = THREE.MathUtils.lerp(66, 49, humidity);
  const baseTarget = THREE.MathUtils.lerp(dryBase, 30, storm);
  const fairThickness = 82 + convection * 72 + humidity * 18;
  const thickness = THREE.MathUtils.lerp(fairThickness, 225, storm);
  const topTarget = baseTarget + thickness;

  if (u.cloudBaseY) u.cloudBaseY.value = baseTarget;
  if (u.cloudTopY) u.cloudTopY.value = topTarget;
  syncMeshLayerHeight(handle, baseTarget);

  // Dry convection produces sharper cauliflower crowns. Storms become broader
  // and optically deeper rather than merely turning the same cloud gray.
  if (u.m2DomainWarp) {
    const fairWarp = THREE.MathUtils.lerp(0.068, 0.090, convection);
    u.m2DomainWarp.value = THREE.MathUtils.lerp(fairWarp, 0.060, storm);
  }
  if (u.m2EdgeErosion) {
    const fairEdge = THREE.MathUtils.lerp(0.49, 0.40, humidity);
    u.m2EdgeErosion.value = THREE.MathUtils.lerp(fairEdge, 0.30, storm);
  }
  if (u.m2DensityBias) {
    u.m2DensityBias.value = THREE.MathUtils.lerp(-0.060, -0.014, storm);
  }
  if (u.m2DensityScale) {
    const fairScale = THREE.MathUtils.lerp(1.06, 1.18, convection);
    u.m2DensityScale.value = THREE.MathUtils.lerp(fairScale, 1.27, storm);
  }

  // Retint the already energy-scaled Model 2 lighting with the same atmosphere
  // colors that illuminate terrain/water. Preserve radiometric magnitude so this
  // step changes spectral character rather than accidentally re-exposing clouds.
  if (u.sunColor?.value?.isColor && physical?.sunColor?.isColor) {
    retintPreserveEnergy(u.sunColor.value, physical.sunColor, 0.72);
  }
  if (u.ambientColor?.value?.isColor && physical?.skyDiffuseColor?.isColor) {
    retintAmbientPreserveEnergy(u.ambientColor.value, physical.skyDiffuseColor, 0.62);
  }

  // Low Sun travels a longer path through the atmosphere, so cloud rims become
  // warmer and more forward-scattered while interiors retain substantial optical
  // depth. Heavy overcast suppresses the silver edge even when the Sun is low.
  if (u.m2SilverStrength) {
    const clearSilver = THREE.MathUtils.lerp(0.46, 0.70, lowSun)
      * THREE.MathUtils.lerp(0.44, 1.0, cloudT);
    u.m2SilverStrength.value = THREE.MathUtils.lerp(clearSilver, 0.14, storm);
  }
  if (u.m2MultiScatter) {
    const clearScatter = THREE.MathUtils.lerp(0.235, 0.335, lowSun);
    u.m2MultiScatter.value = THREE.MathUtils.lerp(clearScatter, 0.30, storm);
  }
  if (u.m2LightExtinction) {
    const clearExtinction = THREE.MathUtils.lerp(0.58, 0.69, humidity);
    u.m2LightExtinction.value = THREE.MathUtils.lerp(clearExtinction, 0.94, storm);
  }
  if (u.m2AmbientStrength) {
    const overcast = 1 - cloudT;
    const target = THREE.MathUtils.lerp(0.56, 0.63, overcast)
      * THREE.MathUtils.lerp(0.96, 1.0, daylight);
    u.m2AmbientStrength.value = THREE.MathUtils.lerp(target, 0.58, storm * 0.65);
  }

  // Keep the inexpensive cirrus veil subtle. It becomes least visible beneath a
  // thick storm deck and slightly stronger in dry/clear air.
  if (handle.__riftCirrus?.material) {
    handle.__riftCirrus.material.opacity = THREE.MathUtils.lerp(
      0.012 * THREE.MathUtils.lerp(1.0, 0.65, humidity),
      0.0025,
      storm,
    );
  }

  globalThis.__riftCloudModel23 = {
    version: "2.3-atmosphere-coupled",
    coverage: Number(u.coverage?.value) || 0,
    density: Number(u.density?.value) || 0,
    baseY: Number(u.cloudBaseY?.value) || baseTarget,
    topY: Number(u.cloudTopY?.value) || topTarget,
    humidity,
    convection,
    storm,
    lowSun,
    cloudTransmittance: cloudT,
    silverStrength: Number(u.m2SilverStrength?.value) || 0,
    lightExtinction: Number(u.m2LightExtinction?.value) || 0,
    threeRevision: THREE.REVISION,
  };
}

export function createVolumetricClouds(scene) {
  const handle = base.createVolumetricClouds(scene);
  if (handle) handle.__riftModel23 = true;
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

  applyAtmosphereCoupling(handle, rainIntensity);
}

export function disposeVolumetricClouds(handle) {
  delete globalThis.__riftCloudModel23;
  return base.disposeVolumetricClouds(handle);
}
