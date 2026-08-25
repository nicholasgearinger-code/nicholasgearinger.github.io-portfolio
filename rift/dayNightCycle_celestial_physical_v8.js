import * as THREE from "three";
import * as base from "./dayNightCycle_celestial_physical_v7.js";
import {
  createSunsetAtmosphereState,
  updateSunsetAtmosphereState,
} from "./sunsetAtmosphere_v1.js";

export * from "./dayNightCycle_celestial_physical_v7.js";

// -----------------------------------------------------------------------------
// Celestial / atmosphere v8.1 — photographic sunrise / sunset response.
//
// Keeps v7's cloud-aware global lighting but makes sunrise/sunset more strongly
// photographic: blue upper sky, saturated warm lower atmosphere, a much smaller
// white-hot nuclear solar core, warm solar shell, broad low-opacity glare, and
// stable non-accumulating sprite scales.
// -----------------------------------------------------------------------------

const stateByCycle = new WeakMap();
const TMP_DIR = new THREE.Vector3();
const TMP_COLOR = new THREE.Color();
const TMP_HDR = new THREE.Color();
const TMP_SKY = new THREE.Color();
const WHITE_HOT = new THREE.Color(1.0, 0.985, 0.92);

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

function ensureSolarContrastLayer(cycle) {
  if (!cycle?.__riftRealSun || !cycle?.sunBody?.group) return null;
  if (cycle.__riftSolarContrastV81) return cycle.__riftSolarContrastV81;

  const visual = cycle.__riftRealSun;
  const photo = cycle.__riftPhotometricSunV7;
  const discMap = visual.discMaterial?.map ?? null;

  const nuclearMaterial = new THREE.SpriteMaterial({
    map: discMap,
    color: WHITE_HOT.clone().multiplyScalar(4.5),
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: false,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const nuclearCore = new THREE.Sprite(nuclearMaterial);
  nuclearCore.name = "rift-sun-nuclear-core-v81";
  nuclearCore.renderOrder = -88;
  cycle.sunBody.group.add(nuclearCore);

  const state = {
    nuclearCore,
    nuclearMaterial,
    discScale: visual.disc?.scale?.clone?.() ?? new THREE.Vector3(20, 20, 1),
    haloScale: visual.halo?.scale?.clone?.() ?? new THREE.Vector3(120, 120, 1),
    aureoleScale: visual.aureole?.scale?.clone?.() ?? null,
    hotScale: photo?.hotCore?.scale?.clone?.() ?? null,
    bloomScale: photo?.bloom?.scale?.clone?.() ?? null,
  };
  cycle.__riftSolarContrastV81 = state;
  return state;
}

function recolorSunsetDome(atmosphere, state) {
  const dome = atmosphere?.dome;
  const pos = dome?.position;
  const colorAttr = dome?.color;
  const sunDir = atmosphere?.sunDirection;
  if (!pos || !colorAttr || !sunDir || !state) return;

  const colors = colorAttr.array;
  const sunset = state.sunset * state.clear;
  const fire = state.horizonFire * state.clear;

  for (let i = 0; i < pos.count; i++) {
    TMP_DIR.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const h = clamp01((TMP_DIR.y + 0.035) / 1.035);

    // Stronger vertical separation than v8: warm energy lives low while the
    // upper hemisphere remains distinctly blue/cyan in clear weather.
    if (h < 0.14) {
      mixBand(TMP_SKY, state.horizonColor, state.lowerMidColor, h / 0.14);
    } else if (h < 0.36) {
      mixBand(TMP_SKY, state.lowerMidColor, state.upperMidColor, (h - 0.14) / 0.22);
    } else {
      mixBand(TMP_SKY, state.upperMidColor, state.zenithColor, (h - 0.36) / 0.64);
    }

    const lowerHaze = Math.pow(1 - h, 7.0)
      * (0.07 + sunset * 0.30 + fire * 0.22 + state.storm * 0.08);
    TMP_SKY.lerp(state.hazeColor, clamp01(lowerHaze));

    // Localized Mie-like solar glare. The broad term is deliberately restrained
    // so the white-hot core remains visibly brighter than the sky around it.
    const sunDot = clamp01(TMP_DIR.dot(sunDir));
    const broadGlow = Math.pow(sunDot, 20)
      * state.daylight
      * (0.055 + sunset * 0.16);
    const aureole = Math.pow(sunDot, 64)
      * state.daylight
      * (0.07 + sunset * 0.18);
    const hotCore = Math.pow(sunDot, 220)
      * state.daylight
      * (0.11 + sunset * 0.30);
    TMP_SKY.lerp(state.solarHaloColor, clamp01(broadGlow + aureole));
    TMP_SKY.lerp(state.solarCoreColor, clamp01(hotCore));

    const j = i * 3;
    colors[j] = TMP_SKY.r;
    colors[j + 1] = TMP_SKY.g;
    colors[j + 2] = TMP_SKY.b;
  }
  colorAttr.needsUpdate = true;
}

function applySunsetPresentation(cycle, result) {
  if (!cycle) return result;

  const v7 = globalThis.__riftSolarLightingV7;
  const v6 = globalThis.__riftSolarLightingV6;
  const source = v7 || v6;
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

  const contrast = ensureSolarContrastLayer(cycle);
  const cloudT = clamp01(source.cloudTransmittance ?? 1);
  const clearBeam = Math.pow(cloudT, 0.45);
  const golden = state.goldenHour * state.clear;
  const fire = state.horizonFire * state.clear;
  const lowSun = Math.max(golden, fire);

  // Global direct light stays warm and legible while the Sun remains above the
  // horizon. Clear golden hour receives more directional contrast than ambient.
  if (cycle.sun) {
    cycle.sun.color.copy(state.directLightColor);
    const altitudeGate = smooth01((state.altitudeDeg + 1.8) / 9.0);
    const lowSunFloor = THREE.MathUtils.lerp(0.88, 1.35, golden)
      * state.daylight
      * altitudeGate
      * THREE.MathUtils.lerp(0.42, 1.0, clearBeam);
    cycle.sun.intensity = Math.max(Number(cycle.sun.intensity) || 0, lowSunFloor);
  }

  if (cycle.ambient) {
    cycle.ambient.color?.copy?.(state.ambientColor);
    cycle.ambient.intensity *= THREE.MathUtils.lerp(1.0, 0.84, golden * (1 - state.storm));
  }

  const atmosphere = globalThis.__riftReferenceAtmosphere;
  if (atmosphere) {
    atmosphere.daylight = state.daylight;
    atmosphere.lowSun = lowSun;
    atmosphere.storm = state.storm;
    atmosphere.zenithColor.copy(state.zenithColor);
    atmosphere.horizonColor.copy(state.horizonColor);
    atmosphere.hazeColor.copy(state.hazeColor);
    atmosphere.ambientColor.copy(state.ambientColor);
    atmosphere.sunColor.copy(state.directLightColor);
    atmosphere.backgroundColor.copy(state.lowerMidColor).lerp(state.zenithColor, 0.67);

    // Preserve color saturation and highlight headroom. Solar sprites are
    // untone-mapped, so exposure does not need to blow the whole scene out.
    const targetExposure = THREE.MathUtils.lerp(0.82, 0.96, state.daylight);
    atmosphere.exposure = THREE.MathUtils.lerp(
      Number(atmosphere.exposure) || targetExposure,
      targetExposure,
      lowSun * 0.82 * state.clear,
    );

    if (atmosphere.scene?.background?.isColor) {
      atmosphere.scene.background.copy(atmosphere.backgroundColor);
    }
    recolorSunsetDome(atmosphere, state);
  }

  const visual = cycle.__riftRealSun;
  const photo = cycle.__riftPhotometricSunV7;
  if (visual && contrast) {
    const transmission = THREE.MathUtils.lerp(0.22, 1.0, clearBeam);
    const discScale = 1 + fire * 0.08 + golden * 0.03;

    // Warm outer photosphere shell.
    if (visual.discMaterial) {
      visual.discMaterial.color.copy(state.solarDiscColor);
      visual.discMaterial.opacity = state.daylight
        * THREE.MathUtils.lerp(0.82, 0.96, transmission);
    }
    if (visual.disc?.scale) {
      visual.disc.scale.set(
        contrast.discScale.x * discScale,
        contrast.discScale.y * discScale,
        1,
      );
    }

    // Warm optical halo remains broad but lower opacity so it does not flatten the
    // contrast between the sky, solar shell and nuclear core.
    if (visual.haloMaterial) {
      visual.haloMaterial.color.copy(state.solarHaloColor);
      visual.haloMaterial.opacity = Math.min(
        0.64,
        state.daylight
          * THREE.MathUtils.lerp(0.20, 0.40, lowSun)
          * transmission,
      );
    }
    if (visual.halo?.scale) {
      const hs = THREE.MathUtils.lerp(0.92, 1.12, lowSun);
      visual.halo.scale.set(contrast.haloScale.x * hs, contrast.haloScale.y * hs, 1);
    }
    if (visual.aureoleMaterial) {
      visual.aureoleMaterial.color.copy(state.solarHaloColor);
      visual.aureoleMaterial.opacity = Math.min(
        0.30,
        state.daylight * THREE.MathUtils.lerp(0.08, 0.22, lowSun) * transmission,
      );
    }
    if (visual.aureole?.scale && contrast.aureoleScale) {
      const as = THREE.MathUtils.lerp(0.96, 1.16, lowSun);
      visual.aureole.scale.set(
        contrast.aureoleScale.x * as,
        contrast.aureoleScale.y * as,
        1,
      );
    }
    if (visual.horizonGlowMaterial) {
      visual.horizonGlowMaterial.color.copy(state.horizonColor);
      visual.horizonGlowMaterial.opacity = fire * 0.50 * transmission;
    }

    // Tiny HDR core: this is intentionally much smaller and much brighter than
    // the warm disc around it, matching photographic clipping around the Sun.
    TMP_HDR.copy(state.solarCoreColor).multiplyScalar(
      THREE.MathUtils.lerp(4.2, 6.2, lowSun),
    );
    contrast.nuclearMaterial.color.copy(TMP_HDR);
    contrast.nuclearMaterial.opacity = state.daylight
      * THREE.MathUtils.lerp(0.88, 1.0, clearBeam);
    contrast.nuclearCore.scale.set(
      contrast.discScale.x * THREE.MathUtils.lerp(0.22, 0.27, lowSun),
      contrast.discScale.y * THREE.MathUtils.lerp(0.22, 0.27, lowSun),
      1,
    );
    contrast.nuclearCore.visible = state.daylight > 0.002;
  }

  if (photo && contrast) {
    TMP_COLOR.copy(state.solarCoreColor).multiplyScalar(
      THREE.MathUtils.lerp(2.0, 2.8, lowSun),
    );
    photo.hotCoreMaterial.color.copy(TMP_COLOR);
    photo.hotCoreMaterial.opacity = state.daylight
      * THREE.MathUtils.lerp(0.84, 0.98, clearBeam);
    photo.hotCore.scale.set(
      contrast.discScale.x * THREE.MathUtils.lerp(0.40, 0.46, lowSun),
      contrast.discScale.y * THREE.MathUtils.lerp(0.40, 0.46, lowSun),
      1,
    );

    photo.bloomMaterial.color.copy(state.solarHaloColor);
    photo.bloomMaterial.opacity = state.daylight
      * THREE.MathUtils.lerp(0.28, 0.44, lowSun)
      * THREE.MathUtils.lerp(0.50, 1.0, clearBeam);
    photo.bloom.scale.set(
      contrast.haloScale.x * THREE.MathUtils.lerp(0.78, 1.02, lowSun),
      contrast.haloScale.y * THREE.MathUtils.lerp(0.78, 1.02, lowSun),
      1,
    );
  }

  if (result) {
    if (result.sunColor?.isColor) result.sunColor.copy(state.directLightColor);
    if (result.skyZenith?.isColor) result.skyZenith.copy(state.zenithColor);
    if (result.skyHorizon?.isColor) result.skyHorizon.copy(state.horizonColor);
    if (result.ambientColor?.isColor) result.ambientColor.copy(state.ambientColor);
  }

  const shared = globalThis.__riftSunsetAtmosphereV8 || {
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

  for (const key of [
    "zenithColor", "upperMidColor", "lowerMidColor", "horizonColor",
    "hazeColor", "solarCoreColor", "solarDiscColor", "solarHaloColor",
    "directLightColor", "ambientColor", "waterSunTint", "cloudLightTint",
    "cloudShadowTint",
  ]) shared[key].copy(state[key]);

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
  globalThis.__riftSunsetAtmosphereV8 = shared;
  globalThis.__riftSunsetAtmosphereV9 = shared;

  if (v7) {
    v7.sunColor?.copy?.(cycle.sun?.color || state.directLightColor);
    v7.ambientColor?.copy?.(cycle.ambient?.color || state.ambientColor);
    v7.directSunIntensity = shared.directSunIntensity;
    v7.ambientIntensity = shared.ambientIntensity;
    v7.exposure = shared.exposure;
  }

  return result;
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  const cycle = base.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight);
  applySunsetPresentation(cycle, null);
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = base.updateDayNightCycle(cycle, dt);
  return applySunsetPresentation(cycle, result);
}
