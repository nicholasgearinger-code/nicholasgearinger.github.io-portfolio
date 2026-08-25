import * as THREE from "three";
import { SkyMesh } from "three/addons/objects/SkyMesh.js";
import * as base from "./dayNightCycle_celestial_physical_v10.js";

export * from "./dayNightCycle_celestial_physical_v10.js";

// -----------------------------------------------------------------------------
// Celestial / atmosphere v11 — dynamic r185 SkyMesh atmosphere.
//
// Three r185's SkyMesh implements the Preetham daylight model directly in TSL,
// including Rayleigh + Mie scattering. Rift keeps its existing photographic Sun
// sprites and Model 2 volumetric clouds, so SkyMesh owns ONLY the clear-air
// atmosphere: its built-in solar disc and 2D clouds are disabled.
//
// Weather continuously drives turbidity/aerosols while the real Rift Sun drives
// the scattering direction. The old vertex-colored dome remains underneath as a
// night/twilight fallback and is smoothly revealed as the physical daylight sky
// fades below the horizon. This gives us a safe rollback path and avoids adding a
// second nighttime renderer.
// -----------------------------------------------------------------------------

const stateByCycle = new WeakMap();
const ORBIT_RADIUS = 260;
const SUN_HORIZON_OFFSET = 10;
const TMP_SUN_DIR = new THREE.Vector3();
const TMP_COLOR = new THREE.Color();

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

function expApproach(current, target, dt, speed = 2.2) {
  const t = 1 - Math.exp(-Math.max(0, Math.min(0.1, Number(dt) || 0)) * speed);
  return THREE.MathUtils.lerp(Number(current) || target, target, t);
}

function solarAltitudeDeg(cycle) {
  const y = cycle?.sunBody?.group?.position?.y;
  if (!Number.isFinite(y)) return -90;
  const sinAltitude = THREE.MathUtils.clamp((y - SUN_HORIZON_OFFSET) / ORBIT_RADIUS, -1, 1);
  return THREE.MathUtils.radToDeg(Math.asin(sinAltitude));
}

function cloudTransmittance() {
  const coarse = Number(globalThis.__riftCloudShadowState?.averageTransmittance);
  if (Number.isFinite(coarse)) return clamp01(coarse);
  const occlusion = clamp01(globalThis.__riftProceduralCloudOcclusion || 0);
  return 1 - occlusion;
}

function installPhysicalSky(cycle, scene) {
  if (!cycle || !scene) return null;

  const legacy = globalThis.__riftReferenceAtmosphere || null;
  const forceLegacy = typeof location !== "undefined"
    && new URLSearchParams(location.search).has("atmosphereLegacy");

  const shared = {
    active: !forceLegacy,
    version: "11-sky-mesh-preetham",
    sky: null,
    legacy,
    turbidity: 3.2,
    rayleigh: 2.45,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.81,
    altitudeDeg: solarAltitudeDeg(cycle),
    daylight: 1,
    lowSun: 0,
    storm: 0,
    humidity: 0.65,
    cloudCoverage: 0.45,
    cloudTransmittance: 1,
    opacity: 1,
    sunDirection: new THREE.Vector3(0.3, 0.8, 0.2).normalize(),
    sunColor: new THREE.Color(0xffffff),
    skyDiffuseColor: new THREE.Color(0xa9c8df),
    zenithColor: new THREE.Color(0x4f8dcc),
    horizonColor: new THREE.Color(0xc8e0ed),
  };

  if (forceLegacy) {
    stateByCycle.set(cycle, shared);
    globalThis.__riftSkyPhysicalV11 = shared;
    return shared;
  }

  const sky = new SkyMesh();
  sky.name = "rift-physical-sky-r185-v11";
  sky.scale.setScalar(450000);
  sky.frustumCulled = false;
  sky.renderOrder = -1100;

  // The old dome is the twilight/night underlay. SkyMesh fades over it during
  // civil dawn/dusk instead of causing a hard renderer switch at the horizon.
  if (legacy?.dome?.mesh) legacy.dome.mesh.renderOrder = -1200;

  sky.material.depthWrite = false;
  sky.material.depthTest = false;
  sky.material.transparent = true;
  sky.material.opacity = 1;

  // Rift already has a physically scaled photographic Sun and true volumetric
  // clouds. Disable SkyMesh's inexpensive built-ins to prevent double imagery.
  sky.showSunDisc.value = 0;
  sky.cloudCoverage.value = 0;
  sky.cloudDensity.value = 0;
  sky.cloudElevation.value = 0.5;
  sky.cloudSpeed.value = 0;

  sky.turbidity.value = shared.turbidity;
  sky.rayleigh.value = shared.rayleigh;
  sky.mieCoefficient.value = shared.mieCoefficient;
  sky.mieDirectionalG.value = shared.mieDirectionalG;

  scene.add(sky);
  shared.sky = sky;
  stateByCycle.set(cycle, shared);
  globalThis.__riftSkyPhysicalV11 = shared;

  console.info("[atmosphere] r185 SkyMesh physical daylight active; Rift volumetric clouds retained");
  return shared;
}

function updatePhysicalSky(cycle, dt) {
  const state = stateByCycle.get(cycle);
  if (!state) return;

  const legacy = globalThis.__riftReferenceAtmosphere || state.legacy;
  state.legacy = legacy;

  const weather = globalThis.__riftProceduralWeatherState;
  const sunset = globalThis.__riftSunsetAtmosphereV9 || globalThis.__riftSunsetAtmosphereV8;
  const solar = globalThis.__riftSolarLightingV7 || globalThis.__riftSolarLightingV6;

  const altitudeDeg = Number(solar?.altitudeDeg);
  state.altitudeDeg = Number.isFinite(altitudeDeg) ? altitudeDeg : solarAltitudeDeg(cycle);
  state.daylight = clamp01(solar?.skyDaylight ?? legacy?.daylight ?? 1);
  state.lowSun = clamp01(sunset?.sunsetStrength ?? solar?.goldenHour ?? legacy?.lowSun ?? 0);
  state.storm = clamp01(weather?.stormIntensity ?? weather?.rainIntensity ?? legacy?.storm ?? 0);
  state.humidity = clamp01(weather?.humidity ?? 0.66);
  state.cloudCoverage = clamp01(weather?.cloudCoverage ?? 0.45);
  state.cloudTransmittance = cloudTransmittance();

  const sunPos = cycle?.sunBody?.group?.position;
  if (sunPos?.isVector3) {
    TMP_SUN_DIR.copy(sunPos).normalize();
    state.sunDirection.copy(TMP_SUN_DIR);
  }

  // Preetham/Sky-style atmospheric controls. Clear tropical air stays low in
  // turbidity with strong Rayleigh blue. Humidity, low-Sun optical path and storm
  // aerosol progressively raise Mie scattering and forward haze.
  const clearTurbidity = 2.45 + state.humidity * 1.45 + state.lowSun * 1.35;
  const targetTurbidity = THREE.MathUtils.lerp(clearTurbidity, 11.5, state.storm);
  const targetRayleigh = THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(2.65, 2.25, state.lowSun),
    1.18,
    state.storm,
  );
  const clearMie = 0.0032 + state.humidity * 0.0034 + state.lowSun * 0.0048;
  const targetMie = THREE.MathUtils.lerp(clearMie, 0.021, state.storm);
  const targetG = THREE.MathUtils.lerp(
    0.79 + state.humidity * 0.035,
    0.90,
    state.storm,
  );

  state.turbidity = expApproach(state.turbidity, targetTurbidity, dt, 1.55);
  state.rayleigh = expApproach(state.rayleigh, targetRayleigh, dt, 1.8);
  state.mieCoefficient = expApproach(state.mieCoefficient, targetMie, dt, 1.45);
  state.mieDirectionalG = expApproach(state.mieDirectionalG, targetG, dt, 1.6);

  // Keep the existing lighting palette as the shared radiometric contract for
  // clouds/water/terrain. SkyMesh supplies angular distribution; these colors
  // supply the same world-light hue to every other system.
  if (cycle?.sun?.color?.isColor) state.sunColor.copy(cycle.sun.color);
  if (cycle?.ambient?.color?.isColor) state.skyDiffuseColor.copy(cycle.ambient.color);
  if (legacy?.zenithColor?.isColor) state.zenithColor.copy(legacy.zenithColor);
  if (legacy?.horizonColor?.isColor) state.horizonColor.copy(legacy.horizonColor);

  if (state.sky) {
    state.sky.sunPosition.value.copy(state.sunDirection);
    state.sky.turbidity.value = state.turbidity;
    state.sky.rayleigh.value = state.rayleigh;
    state.sky.mieCoefficient.value = state.mieCoefficient;
    state.sky.mieDirectionalG.value = state.mieDirectionalG;

    // SkyMesh is a daylight model. Blend it smoothly over Rift's existing
    // twilight/night dome from nautical dawn into full daylight.
    const daylightFade = smoothRange(-7.0, 2.5, state.altitudeDeg);
    const stormFade = THREE.MathUtils.lerp(1.0, 0.92, state.storm);
    state.opacity = clamp01(daylightFade * stormFade);
    state.sky.material.opacity = state.opacity;
    state.sky.visible = state.opacity > 0.002;
  } else {
    state.opacity = 0;
  }

  // Expose stable, allocation-free state to the volumetric cloud engine and
  // future water/atmospheric perspective passes.
  globalThis.__riftSkyPhysicalV11 = state;

  // Small diagnostic snapshot for on-device tuning.
  globalThis.__riftAtmosphereDebug = {
    version: state.version,
    active: state.active,
    altitudeDeg: state.altitudeDeg,
    turbidity: state.turbidity,
    rayleigh: state.rayleigh,
    mieCoefficient: state.mieCoefficient,
    mieDirectionalG: state.mieDirectionalG,
    storm: state.storm,
    humidity: state.humidity,
    cloudCoverage: state.cloudCoverage,
    cloudTransmittance: state.cloudTransmittance,
    opacity: state.opacity,
    threeRevision: THREE.REVISION,
  };
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  const cycle = base.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight);
  installPhysicalSky(cycle, scene);
  updatePhysicalSky(cycle, 1 / 60);
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = base.updateDayNightCycle(cycle, dt);
  updatePhysicalSky(cycle, dt);
  return result;
}
