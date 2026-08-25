import * as THREE from "three";
import * as base from "./dayNightCycle_celestial_physical_v7.js";
import {
  createSunsetAtmosphereState,
  updateSunsetAtmosphereState,
} from "./sunsetAtmosphere_v1.js";

export * from "./dayNightCycle_celestial_physical_v7.js";

// -----------------------------------------------------------------------------
// Celestial / atmosphere v9 — photographic solar-disc pass.
//
// Target: the small, white-hot Sun seen in real sunset photography rather than
// a large pale sprite. The physical solar disc does not really grow at the
// horizon; this pass therefore keeps the apparent disc compact, uses a warm
// translucent outer photosphere, a clipped-white primary disc, a tiny HDR core,
// and broad low-opacity glare. The low sky also receives stronger orange/red
// saturation while the upper sky stays blue.
// -----------------------------------------------------------------------------

const stateByCycle = new WeakMap();
const TMP_DIR = new THREE.Vector3();
const TMP_SKY = new THREE.Color();
const TMP_COLOR = new THREE.Color();
const TMP_HDR = new THREE.Color();

const PHOTO_ZENITH = new THREE.Color(0x5f91c2);
const PHOTO_UPPER = new THREE.Color(0xc68683);
const PHOTO_LOWER = new THREE.Color(0xffa23d);
const PHOTO_HORIZON = new THREE.Color(0xff571e);
const PHOTO_HAZE = new THREE.Color(0xff8a35);
const PHOTO_RIM = new THREE.Color(0xffa12d);
const PHOTO_HALO = new THREE.Color(0xff8b26);
const WHITE_DISC = new THREE.Color(1.0, 0.965, 0.84);
const WHITE_CORE = new THREE.Color(1.0, 0.995, 0.96);

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function mixBand(out, a, b, t) {
  return out.copy(a).lerp(b, clamp01(t));
}

function ensureSunV9(cycle) {
  if (!cycle?.__riftRealSun || !cycle?.sunBody?.group) return null;
  if (cycle.__riftSunV9) return cycle.__riftSunV9;

  const visual = cycle.__riftRealSun;
  const photo = cycle.__riftPhotometricSunV7;
  const discMap = visual.discMaterial?.map ?? null;

  const coreMaterial = new THREE.SpriteMaterial({
    map: discMap,
    color: WHITE_CORE.clone().multiplyScalar(7.5),
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: false,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const core = new THREE.Sprite(coreMaterial);
  core.name = "rift-sun-photographic-core-v9";
  core.renderOrder = -87;
  cycle.sunBody.group.add(core);

  const state = {
    core,
    coreMaterial,
    discScale: visual.disc?.scale?.clone?.() ?? new THREE.Vector3(20, 20, 1),
    haloScale: visual.halo?.scale?.clone?.() ?? new THREE.Vector3(120, 120, 1),
    aureoleScale: visual.aureole?.scale?.clone?.() ?? null,
  };
  cycle.__riftSunV9 = state;
  return state;
}

function recolorSky(atmosphere, state, lowSun) {
  const dome = atmosphere?.dome;
  const pos = dome?.position;
  const colorAttr = dome?.color;
  const sunDir = atmosphere?.sunDirection;
  if (!pos || !colorAttr || !sunDir || !state) return;

  const clearLow = lowSun * state.clear;
  const zenith = state.zenithColor.clone().lerp(PHOTO_ZENITH, clearLow * 0.58);
  const upper = state.upperMidColor.clone().lerp(PHOTO_UPPER, clearLow * 0.64);
  const lower = state.lowerMidColor.clone().lerp(PHOTO_LOWER, clearLow * 0.88);
  const horizon = state.horizonColor.clone().lerp(PHOTO_HORIZON, clearLow * 0.94);
  const haze = state.hazeColor.clone().lerp(PHOTO_HAZE, clearLow * 0.84);

  const colors = colorAttr.array;
  for (let i = 0; i < pos.count; i++) {
    TMP_DIR.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const h = clamp01((TMP_DIR.y + 0.03) / 1.03);

    if (h < 0.12) {
      mixBand(TMP_SKY, horizon, lower, h / 0.12);
    } else if (h < 0.31) {
      mixBand(TMP_SKY, lower, upper, (h - 0.12) / 0.19);
    } else {
      mixBand(TMP_SKY, upper, zenith, (h - 0.31) / 0.69);
    }

    const lowerHaze = Math.pow(1 - h, 8.0)
      * (0.05 + clearLow * 0.26 + state.storm * 0.07);
    TMP_SKY.lerp(haze, clamp01(lowerHaze));

    // Keep the glare broad and subtle. The solar sprites own the actual white
    // disc, preventing the sky mesh itself from becoming a giant white circle.
    const sunDot = clamp01(TMP_DIR.dot(sunDir));
    const broad = Math.pow(sunDot, 25) * state.daylight * (0.025 + clearLow * 0.085);
    const tight = Math.pow(sunDot, 95) * state.daylight * (0.035 + clearLow * 0.10);
    TMP_COLOR.copy(PHOTO_HALO).lerp(WHITE_DISC, 0.28);
    TMP_SKY.lerp(TMP_COLOR, clamp01(broad + tight));

    const j = i * 3;
    colors[j] = TMP_SKY.r;
    colors[j + 1] = TMP_SKY.g;
    colors[j + 2] = TMP_SKY.b;
  }
  colorAttr.needsUpdate = true;

  atmosphere.zenithColor.copy(zenith);
  atmosphere.horizonColor.copy(horizon);
  atmosphere.hazeColor.copy(haze);
  atmosphere.backgroundColor.copy(lower).lerp(zenith, 0.72);
  if (atmosphere.scene?.background?.isColor) {
    atmosphere.scene.background.copy(atmosphere.backgroundColor);
  }
}

function applySolarPhotography(cycle, result) {
  if (!cycle) return result;

  const source = globalThis.__riftSolarLightingV7 || globalThis.__riftSolarLightingV6;
  if (!source) return result;

  let state = stateByCycle.get(cycle);
  if (!state) {
    state = createSunsetAtmosphereState();
    stateByCycle.set(cycle, state);
  }
  updateSunsetAtmosphereState(
    state,
    Number(source.altitudeDeg) || -90,
    Number(source.storm) || 0,
  );

  const sunV9 = ensureSunV9(cycle);
  const cloudT = clamp01(source.cloudTransmittance ?? 1);
  const clearBeam = Math.pow(cloudT, 0.45);
  const golden = state.goldenHour * state.clear;
  const fire = state.horizonFire * state.clear;
  const lowSun = Math.max(golden, fire);
  const transmission = THREE.MathUtils.lerp(0.20, 1.0, clearBeam);

  // Preserve warm global illumination but increase the directional/ambient ratio
  // at golden hour so the scene has photographic contrast.
  if (cycle.sun) {
    cycle.sun.color.copy(state.directLightColor);
    const altitudeGate = smooth01((state.altitudeDeg + 1.5) / 8.5);
    const floor = THREE.MathUtils.lerp(0.92, 1.42, golden)
      * state.daylight
      * altitudeGate
      * THREE.MathUtils.lerp(0.42, 1.0, clearBeam);
    cycle.sun.intensity = Math.max(Number(cycle.sun.intensity) || 0, floor);
  }
  if (cycle.ambient) {
    cycle.ambient.color?.copy?.(state.ambientColor);
    cycle.ambient.intensity *= THREE.MathUtils.lerp(1.0, 0.82, golden * (1 - state.storm));
  }

  const atmosphere = globalThis.__riftReferenceAtmosphere;
  if (atmosphere) {
    recolorSky(atmosphere, state, lowSun);
    atmosphere.daylight = state.daylight;
    atmosphere.lowSun = lowSun;
    atmosphere.storm = state.storm;
    atmosphere.ambientColor.copy(state.ambientColor);
    atmosphere.sunColor.copy(state.directLightColor);

    // Slightly darker low-Sun exposure preserves orange saturation and gives the
    // untone-mapped solar core clear highlight separation.
    const targetExposure = THREE.MathUtils.lerp(0.76, 0.96, state.daylight);
    atmosphere.exposure = THREE.MathUtils.lerp(
      Number(atmosphere.exposure) || targetExposure,
      targetExposure,
      lowSun * 0.90 * state.clear,
    );
  }

  const visual = cycle.__riftRealSun;
  const photo = cycle.__riftPhotometricSunV7;
  if (visual && sunV9) {
    // The reference photo's Sun is about half the relative diameter of the prior
    // Rift disc. Do not fake horizon magnification; keep it compact and stable.
    const apparent = THREE.MathUtils.lerp(0.60, 0.50, lowSun);
    const discX = sunV9.discScale.x * apparent;
    const discY = sunV9.discScale.y * apparent;

    if (visual.discMaterial) {
      visual.discMaterial.blending = THREE.AdditiveBlending;
      visual.discMaterial.premultipliedAlpha = false;
      visual.discMaterial.toneMapped = false;
      TMP_COLOR.copy(state.solarDiscColor).lerp(PHOTO_RIM, lowSun * 0.72);
      visual.discMaterial.color.copy(TMP_COLOR);
      visual.discMaterial.opacity = state.daylight
        * THREE.MathUtils.lerp(0.34, 0.48, lowSun)
        * transmission;
    }
    visual.disc?.scale?.set(discX, discY, 1);

    // Primary clipped-white disc: most of the visible solar face is white-hot,
    // leaving only a thin warm outer shell rather than a large pale ring.
    if (photo) {
      TMP_HDR.copy(WHITE_DISC).multiplyScalar(THREE.MathUtils.lerp(2.6, 3.5, lowSun));
      photo.hotCoreMaterial.color.copy(TMP_HDR);
      photo.hotCoreMaterial.opacity = state.daylight
        * THREE.MathUtils.lerp(0.90, 1.0, clearBeam);
      photo.hotCore.scale.set(discX * 0.82, discY * 0.82, 1);

      photo.bloomMaterial.color.copy(PHOTO_HALO);
      photo.bloomMaterial.opacity = state.daylight
        * THREE.MathUtils.lerp(0.10, 0.20, lowSun)
        * THREE.MathUtils.lerp(0.45, 1.0, clearBeam);
      photo.bloom.scale.set(
        sunV9.haloScale.x * THREE.MathUtils.lerp(0.64, 0.78, lowSun),
        sunV9.haloScale.y * THREE.MathUtils.lerp(0.64, 0.78, lowSun),
        1,
      );
    }

    // Small nuclear center supplies the unmistakable maximum luminance seen in
    // exposed photographs without enlarging the geometric solar disc.
    TMP_HDR.copy(WHITE_CORE).multiplyScalar(THREE.MathUtils.lerp(6.5, 9.0, lowSun));
    sunV9.coreMaterial.color.copy(TMP_HDR);
    sunV9.coreMaterial.opacity = state.daylight
      * THREE.MathUtils.lerp(0.94, 1.0, clearBeam);
    sunV9.core.scale.set(discX * 0.48, discY * 0.48, 1);
    sunV9.core.visible = state.daylight > 0.002;

    if (visual.haloMaterial) {
      visual.haloMaterial.color.copy(PHOTO_HALO);
      visual.haloMaterial.opacity = state.daylight
        * THREE.MathUtils.lerp(0.07, 0.15, lowSun)
        * transmission;
    }
    if (visual.halo?.scale) {
      visual.halo.scale.set(
        sunV9.haloScale.x * THREE.MathUtils.lerp(0.74, 0.88, lowSun),
        sunV9.haloScale.y * THREE.MathUtils.lerp(0.74, 0.88, lowSun),
        1,
      );
    }
    if (visual.aureoleMaterial) {
      visual.aureoleMaterial.color.copy(PHOTO_HALO);
      visual.aureoleMaterial.opacity = state.daylight * lowSun * 0.075 * transmission;
    }
    if (visual.aureole?.scale && sunV9.aureoleScale) {
      visual.aureole.scale.copy(sunV9.aureoleScale).multiplyScalar(0.86 + lowSun * 0.08);
    }
    if (visual.horizonGlowMaterial) {
      visual.horizonGlowMaterial.color.copy(PHOTO_HORIZON);
      visual.horizonGlowMaterial.opacity = fire * 0.32 * transmission;
    }
  }

  if (result) {
    result.sunColor?.copy?.(state.directLightColor);
    result.ambientColor?.copy?.(cycle.ambient?.color || state.ambientColor);
    result.skyZenith?.copy?.(atmosphere?.zenithColor || state.zenithColor);
    result.skyHorizon?.copy?.(atmosphere?.horizonColor || state.horizonColor);
  }

  const shared = globalThis.__riftSunsetAtmosphereV9 || {
    zenithColor: new THREE.Color(),
    upperMidColor: new THREE.Color(),
    lowerMidColor: new THREE.Color(),
    horizonColor: new THREE.Color(),
    hazeColor: new THREE.Color(),
    solarCoreColor: new THREE.Color(),
    solarDiscColor: new THREE.Color(),
    solarHaloColor: new THREE.Color(),
    directLightColor: new THREE.Color(),
    ambientColor: new THREE.Color(),
    waterSunTint: new THREE.Color(),
    cloudLightTint: new THREE.Color(),
    cloudShadowTint: new THREE.Color(),
  };

  shared.zenithColor.copy(atmosphere?.zenithColor || state.zenithColor);
  shared.upperMidColor.copy(state.upperMidColor).lerp(PHOTO_UPPER, lowSun * state.clear * 0.64);
  shared.lowerMidColor.copy(state.lowerMidColor).lerp(PHOTO_LOWER, lowSun * state.clear * 0.88);
  shared.horizonColor.copy(atmosphere?.horizonColor || state.horizonColor);
  shared.hazeColor.copy(atmosphere?.hazeColor || state.hazeColor);
  shared.solarCoreColor.copy(WHITE_CORE);
  shared.solarDiscColor.copy(state.solarDiscColor).lerp(PHOTO_RIM, lowSun * 0.72);
  shared.solarHaloColor.copy(PHOTO_HALO);
  shared.directLightColor.copy(state.directLightColor);
  shared.ambientColor.copy(cycle.ambient?.color || state.ambientColor);
  shared.waterSunTint.copy(state.waterSunTint);
  shared.cloudLightTint.copy(state.cloudLightTint);
  shared.cloudShadowTint.copy(state.cloudShadowTint);
  shared.altitudeDeg = state.altitudeDeg;
  shared.daylight = state.daylight;
  shared.goldenHour = state.goldenHour;
  shared.sunset = state.sunset;
  shared.horizonFire = state.horizonFire;
  shared.twilight = state.twilight;
  shared.highSun = state.highSun;
  shared.storm = state.storm;
  shared.clear = state.clear;
  shared.cloudTransmittance = cloudT;
  shared.sunsetStrength = lowSun;
  shared.directSunIntensity = Number(cycle.sun?.intensity) || 0;
  shared.ambientIntensity = Number(cycle.ambient?.intensity) || 0;
  shared.exposure = Number(atmosphere?.exposure) || 1;
  globalThis.__riftSunsetAtmosphereV9 = shared;
  globalThis.__riftSunsetAtmosphereV8 = shared;

  return result;
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  const cycle = base.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight);
  applySolarPhotography(cycle, null);
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = base.updateDayNightCycle(cycle, dt);
  return applySolarPhotography(cycle, result);
}
