import * as THREE from "three";
import * as base from "./dayNightCycle_celestial_physical_v7.js";
import {
  createSunsetAtmosphereState,
  updateSunsetAtmosphereState,
} from "./sunsetAtmosphere_v1.js";

export * from "./dayNightCycle_celestial_physical_v7.js";

// -----------------------------------------------------------------------------
// Celestial / atmosphere v8 — photographic sunrise / sunset response.
//
// This layer keeps v7's cloud-aware HDR lighting, then imposes the vertical sky
// structure seen in real ocean photography: cool zenith, peach/gold middle sky,
// saturated orange/red horizon, white-hot solar core, broad warm glare, and a
// globally warm directional light during golden hour.
// -----------------------------------------------------------------------------

const stateByCycle = new WeakMap();
const TMP_DIR = new THREE.Vector3();
const TMP_COLOR = new THREE.Color();
const TMP_HDR = new THREE.Color();
const TMP_SKY = new THREE.Color();

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

    // Four-layer gradient. The bands intentionally preserve a cool upper sky
    // while concentrating orange/red energy in the lowest ~20% of the dome.
    if (h < 0.18) {
      mixBand(TMP_SKY, state.horizonColor, state.lowerMidColor, h / 0.18);
    } else if (h < 0.50) {
      mixBand(TMP_SKY, state.lowerMidColor, state.upperMidColor, (h - 0.18) / 0.32);
    } else {
      mixBand(TMP_SKY, state.upperMidColor, state.zenithColor, (h - 0.50) / 0.50);
    }

    // Warm lower-atmosphere haze without tinting the entire sky.
    const lowerHaze = Math.pow(1 - h, 5.8)
      * (0.08 + sunset * 0.24 + fire * 0.18 + state.storm * 0.08);
    TMP_SKY.lerp(state.hazeColor, clamp01(lowerHaze));

    // Strong Mie-like forward scattering around the actual sun direction.
    const sunDot = clamp01(TMP_DIR.dot(sunDir));
    const broadGlow = Math.pow(sunDot, 18)
      * state.daylight
      * (0.08 + sunset * 0.23);
    const aureole = Math.pow(sunDot, 54)
      * state.daylight
      * (0.09 + sunset * 0.26);
    const hotCore = Math.pow(sunDot, 170)
      * state.daylight
      * (0.10 + sunset * 0.28);
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

  const cloudT = clamp01(source.cloudTransmittance ?? 1);
  const clearBeam = Math.pow(cloudT, 0.45);
  const golden = state.goldenHour * state.clear;
  const fire = state.horizonFire * state.clear;
  const sunsetStrength = Math.max(golden, fire);

  // Global scene light: keep real low-Sun light weaker than noon, but do not let
  // it collapse so early that terrain/water lose the warm directional cue while
  // the solar disc is still visibly above the horizon.
  if (cycle.sun) {
    cycle.sun.color.copy(state.directLightColor);
    const lowSunFloor = 0.72
      * state.daylight
      * smooth01((state.altitudeDeg + 1.5) / 8.5)
      * THREE.MathUtils.lerp(0.45, 1.0, clearBeam);
    cycle.sun.intensity = Math.max(Number(cycle.sun.intensity) || 0, lowSunFloor);
  }

  if (cycle.ambient) {
    cycle.ambient.color?.copy?.(state.ambientColor);
    // Slightly suppress neutral fill during clear golden hour to preserve long,
    // warm directional shadows. Storms retain the v7 diffuse-return behavior.
    cycle.ambient.intensity *= THREE.MathUtils.lerp(1.0, 0.88, golden * (1 - state.storm));
  }

  const atmosphere = globalThis.__riftReferenceAtmosphere;
  if (atmosphere) {
    atmosphere.daylight = state.daylight;
    atmosphere.lowSun = sunsetStrength;
    atmosphere.storm = state.storm;
    atmosphere.zenithColor.copy(state.zenithColor);
    atmosphere.horizonColor.copy(state.horizonColor);
    atmosphere.hazeColor.copy(state.hazeColor);
    atmosphere.ambientColor.copy(state.ambientColor);
    atmosphere.sunColor.copy(state.directLightColor);
    atmosphere.backgroundColor.copy(state.lowerMidColor).lerp(state.zenithColor, 0.58);

    // Protect saturation near sunset. The Sun/glare sprites are untone-mapped,
    // so we can keep scene exposure photographic instead of blowing the sky out.
    const targetExposure = THREE.MathUtils.lerp(0.84, 0.94, state.daylight);
    atmosphere.exposure = THREE.MathUtils.lerp(
      Number(atmosphere.exposure) || targetExposure,
      targetExposure,
      sunsetStrength * 0.72 * state.clear,
    );

    if (atmosphere.scene?.background?.isColor) {
      atmosphere.scene.background.copy(atmosphere.backgroundColor);
    }
    recolorSunsetDome(atmosphere, state);
  }

  // Visible solar body: keep a white-hot inner core even when the transmitted
  // light turns orange. This is the perceptual signature missing from the old
  // pale-circle Sun.
  const visual = cycle.__riftRealSun;
  const photo = cycle.__riftPhotometricSunV7;
  if (visual) {
    const transmission = THREE.MathUtils.lerp(0.22, 1.0, clearBeam);
    const horizonScale = 1 + fire * 0.20 + golden * 0.08;

    if (visual.discMaterial) {
      visual.discMaterial.color.copy(state.solarDiscColor);
      visual.discMaterial.opacity = state.daylight
        * THREE.MathUtils.lerp(0.86, 1.0, transmission);
    }
    if (visual.disc?.scale) {
      const baseX = visual.disc.scale.x || 20;
      const baseY = visual.disc.scale.y || baseX;
      visual.disc.scale.set(baseX * horizonScale, baseY * horizonScale, 1);
    }

    if (visual.haloMaterial) {
      visual.haloMaterial.color.copy(state.solarHaloColor);
      visual.haloMaterial.opacity = Math.min(
        0.90,
        (Number(visual.haloMaterial.opacity) || 0)
          * THREE.MathUtils.lerp(1.08, 1.62, sunsetStrength)
          * transmission,
      );
    }
    if (visual.aureoleMaterial) {
      visual.aureoleMaterial.color.copy(state.solarHaloColor);
      visual.aureoleMaterial.opacity = Math.min(
        0.42,
        (Number(visual.aureoleMaterial.opacity) || 0)
          * THREE.MathUtils.lerp(1.05, 1.72, sunsetStrength)
          * transmission,
      );
    }
    if (visual.horizonGlowMaterial) {
      visual.horizonGlowMaterial.color.copy(state.horizonColor);
      visual.horizonGlowMaterial.opacity = Math.max(
        Number(visual.horizonGlowMaterial.opacity) || 0,
        fire * 0.46 * transmission,
      );
    }
  }

  if (photo) {
    // HDR-valued additive core. Color channels intentionally exceed 1.0; the
    // sprite is untone-mapped, so this reads as a genuinely luminous source.
    TMP_HDR.copy(state.solarCoreColor).multiplyScalar(
      THREE.MathUtils.lerp(1.28, 1.62, sunsetStrength),
    );
    photo.hotCoreMaterial.color.copy(TMP_HDR);
    photo.hotCoreMaterial.opacity = state.daylight
      * THREE.MathUtils.lerp(0.90, 1.0, clearBeam);

    if (visual?.disc?.scale) {
      photo.hotCore.scale.set(
        visual.disc.scale.x * THREE.MathUtils.lerp(0.70, 0.78, sunsetStrength),
        visual.disc.scale.y * THREE.MathUtils.lerp(0.70, 0.78, sunsetStrength),
        1,
      );
    }

    photo.bloomMaterial.color.copy(state.solarHaloColor);
    photo.bloomMaterial.opacity = state.daylight
      * THREE.MathUtils.lerp(0.58, 0.86, sunsetStrength)
      * THREE.MathUtils.lerp(0.52, 1.0, clearBeam);

    if (visual?.halo?.scale) {
      const bloomScale = THREE.MathUtils.lerp(0.74, 1.08, sunsetStrength);
      photo.bloom.scale.set(
        visual.halo.scale.x * bloomScale,
        visual.halo.scale.y * bloomScale,
        1,
      );
    }
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
    "zenithColor",
    "upperMidColor",
    "lowerMidColor",
    "horizonColor",
    "hazeColor",
    "solarCoreColor",
    "solarDiscColor",
    "solarHaloColor",
    "directLightColor",
    "ambientColor",
    "waterSunTint",
    "cloudLightTint",
    "cloudShadowTint",
  ]) shared[key].copy(state[key]);

  shared.altitudeDeg = state.altitudeDeg;
  shared.daylight = state.daylight;
  shared.goldenHour = state.goldenHour;
  shared.sunset = state.sunset;
  shared.horizonFire = state.horizonFire;
  shared.twilight = state.twilight;
  shared.storm = state.storm;
  shared.clear = state.clear;
  shared.cloudTransmittance = cloudT;
  shared.sunsetStrength = sunsetStrength;
  shared.directSunIntensity = Number(cycle.sun?.intensity) || 0;
  shared.ambientIntensity = Number(cycle.ambient?.intensity) || 0;
  shared.exposure = Number(atmosphere?.exposure) || 1;
  globalThis.__riftSunsetAtmosphereV8 = shared;

  // Keep the v7 state authoritative for older consumers while updating the
  // values that v8 has legitimately changed.
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
