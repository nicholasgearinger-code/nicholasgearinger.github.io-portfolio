import * as THREE from "three";
import * as previous from "./dayNightCycle_celestial_physical_v8.js";

export * from "./dayNightCycle_celestial_physical_v8.js";

// -----------------------------------------------------------------------------
// Celestial / atmosphere v15 — solar-radiance presentation.
//
// v14/Model 3.4 intentionally put the Sun and Moon close to their real angular
// diameters. That is geometrically correct, but on a phone it made the Sun read
// like a second Moon. v15 keeps the physical photospheric core while restoring
// the much larger *apparent* solar envelope created by glare, forward scattering
// and low-altitude aerosol haze. The Moon stays a dim textured body with a small
// cool halo; only the Sun receives the high-radiance envelope below.
// -----------------------------------------------------------------------------

const SUN_WHITE = new THREE.Color(0xfffff2);
const SUN_GOLD = new THREE.Color(0xffca58);
const SUN_ORANGE = new THREE.Color(0xff9b32);
const SUN_FIRE = new THREE.Color(0xff6d22);
const INNER_GLOW = new THREE.Color(0xffbd4b);
const HORIZON_GLOW = new THREE.Color(0xff8a2a);
const CLOUD_GOLD = new THREE.Color(0xffb66f);
const CLOUD_SHADOW = new THREE.Color(0x656d86);

const TMP_COLOR = new THREE.Color();
const TMP_DIR = new THREE.Vector3();

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

function solarAltitude(cycle, state) {
  const fromState = Number(state?.altitudeDeg);
  if (Number.isFinite(fromState)) return fromState;
  const p = cycle?.sunBody?.group?.position;
  if (!p?.isVector3 || p.lengthSq() < 1e-6) return -90;
  TMP_DIR.copy(p).normalize();
  return THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(TMP_DIR.y, -1, 1)));
}

function installSolarEnvelope(cycle) {
  if (cycle?.__riftSolarEnvelopeV15) return cycle.__riftSolarEnvelopeV15;
  const realSun = cycle?.__riftRealSun;
  const group = cycle?.sunBody?.group;
  if (!realSun || !group) return null;

  const sourceMap = realSun.haloMaterial?.map || null;
  const innerMaterial = new THREE.SpriteMaterial({
    map: sourceMap,
    color: INNER_GLOW.clone(),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const innerGlow = new THREE.Sprite(innerMaterial);
  innerGlow.name = "rift-solar-inner-radiance-v15";
  innerGlow.renderOrder = -91.5;
  group.add(innerGlow);

  const scatterMaterial = new THREE.SpriteMaterial({
    map: sourceMap,
    color: HORIZON_GLOW.clone(),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const scatter = new THREE.Sprite(scatterMaterial);
  scatter.name = "rift-solar-forward-scatter-v15";
  scatter.renderOrder = -93.5;
  group.add(scatter);

  cycle.__riftSolarEnvelopeV15 = {
    innerGlow,
    innerMaterial,
    scatter,
    scatterMaterial,
  };
  return cycle.__riftSolarEnvelopeV15;
}

function applySolarRadiance(cycle, result) {
  if (!cycle) return result;

  const prior = globalThis.__riftCelestialModel34 || {};
  const atmosphere = globalThis.__riftReferenceAtmosphere;
  const state = globalThis.__riftSkyPhysicalV13 || globalThis.__riftSkyPhysicalV12;
  const realSun = cycle.__riftRealSun;
  if (!realSun || !state) return result;

  const envelope = installSolarEnvelope(cycle);
  const altitudeDeg = solarAltitude(cycle, prior);
  const daylight = clamp01(state.daylight ?? prior.daylight ?? 1);
  const storm = clamp01(state.storm ?? prior.storm ?? 0);
  const clear = 1 - storm;
  const cloudTransmittance = clamp01(
    globalThis.__riftCloudShadowState?.averageTransmittance
      ?? state.cloudTransmittance
      ?? (1 - clamp01(globalThis.__riftProceduralCloudOcclusion || 0)),
  );

  const aboveHorizon = smoothRange(-2.5, 1.0, altitudeDeg);
  const horizon = 1 - smoothRange(4, 20, altitudeDeg);
  const golden = smoothRange(-5, 0.5, altitudeDeg)
    * (1 - smoothRange(11, 23, altitudeDeg));
  const fire = smoothRange(-2.5, 0.2, altitudeDeg)
    * (1 - smoothRange(4, 10, altitudeDeg));
  const lowSun = clamp01(Math.max(golden, horizon * aboveHorizon * 0.78)) * clear;
  const beam = THREE.MathUtils.lerp(0.34, 1.0, Math.pow(cloudTransmittance, 0.42));
  const visible = daylight * aboveHorizon;

  // Keep the physical disk underneath, but let the low-Sun apparent photosphere
  // grow modestly on a phone. Most perceived size still comes from glare below.
  const physicalDiameter = Number(prior.sunDiscWorld)
    || Number(globalThis.__riftCelestialModel35?.physicalSunDiscWorld)
    || Number(realSun.disc?.scale?.x)
    || 2.4;
  const discDiameter = physicalDiameter * THREE.MathUtils.lerp(1.06, 1.48, horizon);

  TMP_COLOR.copy(SUN_FIRE)
    .lerp(SUN_ORANGE, smoothRange(-1.5, 3.5, altitudeDeg))
    .lerp(SUN_GOLD, smoothRange(2, 12, altitudeDeg))
    .lerp(SUN_WHITE, smoothRange(13, 38, altitudeDeg));

  if (realSun.disc) realSun.disc.scale.set(discDiameter, discDiameter, 1);
  if (realSun.discMaterial) {
    realSun.discMaterial.color.copy(TMP_COLOR);
    realSun.discMaterial.opacity = visible * THREE.MathUtils.lerp(0.96, 1.0, beam);
    realSun.discMaterial.blending = THREE.NormalBlending;
    realSun.discMaterial.toneMapped = false;
  }

  const innerDiameter = discDiameter * THREE.MathUtils.lerp(3.0, 5.6, horizon);
  const haloDiameter = discDiameter * THREE.MathUtils.lerp(15, 27, horizon);
  const aureoleDiameter = discDiameter * THREE.MathUtils.lerp(38, 72, horizon);
  const scatterW = discDiameter * THREE.MathUtils.lerp(64, 126, horizon);
  const scatterH = discDiameter * THREE.MathUtils.lerp(24, 47, horizon);

  if (envelope) {
    envelope.innerGlow.scale.set(innerDiameter, innerDiameter, 1);
    envelope.innerMaterial.color.copy(INNER_GLOW).lerp(SUN_WHITE, smoothRange(12, 34, altitudeDeg));
    envelope.innerMaterial.opacity = visible
      * THREE.MathUtils.lerp(0.18, 0.42, horizon)
      * THREE.MathUtils.lerp(0.44, 1.0, beam);
    envelope.scatter.scale.set(scatterW, scatterH, 1);
    envelope.scatterMaterial.color.copy(HORIZON_GLOW).lerp(SUN_GOLD, smoothRange(7, 20, altitudeDeg));
    envelope.scatterMaterial.opacity = visible
      * lowSun
      * THREE.MathUtils.lerp(0.075, 0.17, fire)
      * THREE.MathUtils.lerp(0.36, 1.0, beam);
    envelope.innerGlow.visible = visible > 0.001;
    envelope.scatter.visible = visible > 0.001 && lowSun > 0.01;
  }

  if (realSun.halo) realSun.halo.scale.set(haloDiameter, haloDiameter, 1);
  if (realSun.aureole) realSun.aureole.scale.set(aureoleDiameter, aureoleDiameter, 1);
  if (realSun.horizonGlow) {
    realSun.horizonGlow.scale.set(scatterW * 1.18, scatterH * 0.92, 1);
  }
  if (realSun.haloMaterial) {
    realSun.haloMaterial.color.copy(SUN_GOLD).lerp(SUN_WHITE, smoothRange(15, 38, altitudeDeg));
    realSun.haloMaterial.opacity = visible
      * THREE.MathUtils.lerp(0.13, 0.27, horizon)
      * THREE.MathUtils.lerp(0.42, 1.0, beam);
  }
  if (realSun.aureoleMaterial) {
    realSun.aureoleMaterial.color.copy(SUN_ORANGE).lerp(SUN_GOLD, smoothRange(5, 17, altitudeDeg));
    realSun.aureoleMaterial.opacity = visible
      * THREE.MathUtils.lerp(0.035, 0.105, horizon)
      * THREE.MathUtils.lerp(0.42, 1.0, beam);
  }
  if (realSun.horizonGlowMaterial) {
    realSun.horizonGlowMaterial.color.copy(SUN_ORANGE).lerp(SUN_FIRE, fire * 0.72);
    realSun.horizonGlowMaterial.opacity = visible
      * lowSun
      * 0.20
      * THREE.MathUtils.lerp(0.36, 1.0, beam);
  }

  // The world Sun gets slightly more low-angle radiometric authority so clouds,
  // water and terrain receive golden direct light instead of only a colored sky.
  if (cycle.sun) {
    cycle.sun.color?.copy?.(TMP_COLOR);
    cycle.sun.intensity *= THREE.MathUtils.lerp(1.0, 1.16, golden * clear);
  }

  if (atmosphere) {
    atmosphere.sunColor?.copy?.(TMP_COLOR);
    atmosphere.horizonColor?.lerp?.(SUN_ORANGE, golden * clear * 0.16);
    atmosphere.hazeColor?.lerp?.(SUN_GOLD, golden * clear * 0.11);
  }

  const shared = globalThis.__riftSunsetAtmosphereV9;
  if (shared) {
    shared.solarDiscColor?.copy?.(TMP_COLOR);
    shared.solarHaloColor?.copy?.(SUN_GOLD);
    shared.cloudLightTint?.copy?.(CLOUD_GOLD);
    shared.cloudShadowTint?.copy?.(CLOUD_SHADOW);
    shared.waterSunTint?.copy?.(TMP_COLOR);
  }

  result?.sunColor?.copy?.(cycle.sun?.color || TMP_COLOR);

  globalThis.__riftCelestialModel35 = {
    ...prior,
    active: true,
    version: "3.5-solar-radiance-envelope",
    altitudeDeg,
    daylight,
    storm,
    goldenHour: golden,
    horizonStrength: horizon,
    solarEnvelopeStrength: lowSun,
    cloudTransmittance,
    physicalSunDiscWorld: physicalDiameter,
    apparentSunDiscWorld: discDiameter,
    sunColor: cycle.sun?.color,
  };

  globalThis.__riftAtmosphereDebug = {
    ...(globalThis.__riftAtmosphereDebug || {}),
    version: "15-model35-solar-radiance",
    solarEnvelopeStrength: lowSun,
    apparentSunDiscWorld: discDiameter,
    cloudTransmittance,
  };

  return result;
}

export function createDayNightCycle(...args) {
  const cycle = previous.createDayNightCycle(...args);
  applySolarRadiance(cycle, null);
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = previous.updateDayNightCycle(cycle, dt);
  return applySolarRadiance(cycle, result);
}
