import * as THREE from "three";
import * as base from "./dayNightCycle_celestial_physical_v6.js";

export * from "./dayNightCycle_celestial_physical_v6.js";

// -----------------------------------------------------------------------------
// Celestial / atmosphere v7 — photometric Sun + cloud-aware diffuse daylight.
//
// v6 made solar colour physically altitude-dependent. v7 makes that solution
// read more like a real high-dynamic-range light source on a phone:
//   * an additive inner photosphere and bloom are layered over the existing disc;
//   * clear high-Sun directional illumination is stronger without raising the
//     whole scene exposure;
//   * Model 2's coarse cloud transmittance attenuates direct sunlight globally;
//   * the energy removed from the direct beam is partially returned as cool
//     diffuse skylight, so an overcast afternoon is dim but not pitch black.
// -----------------------------------------------------------------------------

const HOT_ZENITH = new THREE.Color(0xfffffb);
const HOT_GOLD = new THREE.Color(0xffc27c);
const OVERCAST_FILL = new THREE.Color(0x93a7b8);
const TMP_COLOR = new THREE.Color();

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function installPhotometricSun(cycle) {
  if (cycle?.__riftPhotometricSunV7 || !cycle?.__riftRealSun || !cycle?.sunBody?.group) return;

  const visual = cycle.__riftRealSun;
  const discMap = visual.discMaterial?.map ?? null;
  const haloMap = visual.haloMaterial?.map ?? null;

  const hotCoreMaterial = new THREE.SpriteMaterial({
    map: discMap,
    color: HOT_ZENITH.clone(),
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: false,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const hotCore = new THREE.Sprite(hotCoreMaterial);
  hotCore.name = "rift-sun-hot-core-v7";
  hotCore.renderOrder = -89;

  const bloomMaterial = new THREE.SpriteMaterial({
    map: haloMap,
    color: HOT_GOLD.clone(),
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: false,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const bloom = new THREE.Sprite(bloomMaterial);
  bloom.name = "rift-sun-bloom-v7";
  bloom.renderOrder = -90;

  cycle.sunBody.group.add(bloom, hotCore);
  cycle.__riftPhotometricSunV7 = {
    hotCore,
    hotCoreMaterial,
    bloom,
    bloomMaterial,
  };
}

function cloudTransmittance() {
  const coarse = Number(globalThis.__riftCloudShadowState?.averageTransmittance);
  if (Number.isFinite(coarse)) return clamp01(coarse);

  const occlusion = clamp01(globalThis.__riftProceduralCloudOcclusion || 0);
  return 1 - occlusion;
}

function applyPhotometricLighting(cycle, result) {
  if (!cycle) return result;
  installPhotometricSun(cycle);

  const v6 = globalThis.__riftSolarLightingV6;
  if (!v6) return result;

  const skyDaylight = clamp01(v6.skyDaylight);
  const highSun = clamp01(v6.highSun);
  const goldenHour = clamp01(v6.goldenHour);
  const storm = clamp01(v6.storm);
  const cloudT = cloudTransmittance();
  const overcast = 1 - cloudT;

  // The direct beam is strongest in clear air. Clouds attenuate it, but not as
  // brutally as multiplying by raw optical transmittance because a low-res cloud
  // shadow field represents an area-average rather than the exact solar disc.
  if (cycle.sun) {
    const clearBoost = THREE.MathUtils.lerp(1.08, 1.30, highSun);
    const cloudBeam = THREE.MathUtils.lerp(0.50, 1.0, Math.pow(cloudT, 0.42));
    cycle.sun.intensity *= clearBoost * cloudBeam;
  }

  // Real overcast daylight is dominated by diffuse sky illumination. Recover a
  // portion of the blocked direct energy into a cool ambient term so terrain and
  // water retain shape instead of collapsing to black beneath storm clouds.
  if (cycle.ambient) {
    const diffuseReturn = overcast * skyDaylight * THREE.MathUtils.lerp(0.055, 0.115, storm);
    cycle.ambient.intensity = Math.min(0.42, cycle.ambient.intensity + diffuseReturn);
    if (cycle.ambient.color?.isColor) {
      cycle.ambient.color.lerp(OVERCAST_FILL, overcast * (0.18 + storm * 0.18));
    }
  }

  const visual = cycle.__riftRealSun;
  const photo = cycle.__riftPhotometricSunV7;
  if (visual && photo) {
    const horizon = 1 - Math.min(1, Math.abs(Number(v6.altitudeDeg) || 0) / 13);
    const transmission = THREE.MathUtils.lerp(0.34, 1.0, Math.pow(cloudT, 0.48));

    TMP_COLOR.copy(v6.sunColor || HOT_ZENITH).lerp(HOT_ZENITH, highSun * 0.42);
    photo.hotCoreMaterial.color.copy(TMP_COLOR);
    photo.hotCoreMaterial.opacity = skyDaylight
      * THREE.MathUtils.lerp(0.78, 1.0, highSun)
      * transmission;

    const discScaleX = visual.disc?.scale?.x || 20;
    const discScaleY = visual.disc?.scale?.y || discScaleX;
    photo.hotCore.scale.set(discScaleX * 0.74, discScaleY * 0.74, 1);

    photo.bloomMaterial.color.copy(HOT_GOLD).lerp(TMP_COLOR, highSun * 0.72);
    photo.bloomMaterial.opacity = skyDaylight
      * THREE.MathUtils.lerp(0.48, 0.62, highSun)
      * THREE.MathUtils.lerp(0.78, 1.0, horizon)
      * transmission;

    const haloScaleX = visual.halo?.scale?.x || 120;
    const haloScaleY = visual.halo?.scale?.y || haloScaleX;
    photo.bloom.scale.set(
      haloScaleX * THREE.MathUtils.lerp(0.62, 0.78, horizon),
      haloScaleY * THREE.MathUtils.lerp(0.62, 0.78, horizon),
      1,
    );

    // Keep the original optical layers, but give the halo enough energy that the
    // Sun reads as brighter than the surrounding sky without increasing exposure.
    if (visual.haloMaterial) visual.haloMaterial.opacity *= 1.18;
    if (visual.aureoleMaterial) visual.aureoleMaterial.opacity *= 1.08;

    const show = skyDaylight > 0.002;
    photo.hotCore.visible = show;
    photo.bloom.visible = show;
  }

  const atmosphere = globalThis.__riftReferenceAtmosphere;
  if (atmosphere) {
    // Keep clear daylight crisp. Heavy cloud receives a small exposure recovery
    // from diffuse skylight, while clear sunsets retain v6's darker golden-hour
    // exposure and therefore stronger colour contrast.
    atmosphere.exposure *= THREE.MathUtils.lerp(
      1.0,
      1.0 + 0.055 * skyDaylight,
      overcast * storm,
    );
  }

  if (result) {
    if (result.sunColor?.isColor && v6.sunColor?.isColor) result.sunColor.copy(v6.sunColor);
    if (result.ambientColor?.isColor && cycle.ambient?.color?.isColor) {
      result.ambientColor.copy(cycle.ambient.color);
    }
  }

  const state = globalThis.__riftSolarLightingV7 || {
    sunColor: new THREE.Color(),
    ambientColor: new THREE.Color(),
  };
  state.sunColor.copy(cycle.sun?.color || v6.sunColor || HOT_ZENITH);
  state.ambientColor.copy(cycle.ambient?.color || v6.ambientColor || OVERCAST_FILL);
  state.altitudeDeg = Number(v6.altitudeDeg) || -90;
  state.skyDaylight = skyDaylight;
  state.highSun = highSun;
  state.goldenHour = goldenHour;
  state.storm = storm;
  state.cloudTransmittance = cloudT;
  state.overcast = overcast;
  state.directSunIntensity = Number(cycle.sun?.intensity) || 0;
  state.ambientIntensity = Number(cycle.ambient?.intensity) || 0;
  state.exposure = Number(atmosphere?.exposure) || 1;
  globalThis.__riftSolarLightingV7 = state;

  // Keep v6's shared state truthful for systems still reading the old key.
  v6.directSunIntensity = state.directSunIntensity;
  v6.ambientIntensity = state.ambientIntensity;
  v6.exposure = state.exposure;

  return result;
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  const cycle = base.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight);
  applyPhotometricLighting(cycle, null);
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = base.updateDayNightCycle(cycle, dt);
  return applyPhotometricLighting(cycle, result);
}
