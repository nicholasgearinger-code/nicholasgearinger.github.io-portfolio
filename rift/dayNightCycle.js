import * as THREE from "three";
import * as current from "./dayNightCycle_lighting_base.js";

export * from "./dayNightCycle_lighting_base.js";

const ORBIT_RADIUS = 260;
const SUN_VISUAL_HORIZON_OFFSET = 10;
const HORIZON_SUN_LIGHT = new THREE.Color(0xff9657);
const HORIZON_SKY_FILL = new THREE.Color(0xffc79a);

const REAL_SUN_ZENITH = new THREE.Color(0xfffdf4);
const REAL_SUN_HORIZON = new THREE.Color(0xff7f32);
const REAL_HALO_ZENITH = new THREE.Color(0xfff4d6);
const REAL_HALO_HORIZON = new THREE.Color(0xffa04c);
const REAL_TWILIGHT_GLOW = new THREE.Color(0xff713e);

// Day/twilight atmosphere. The zenith intentionally stays blue during sunrise
// and sunset; only the lower atmosphere becomes strongly warm. This fixes the
// previous full-sky pink/purple wash and better matches real long-path scattering.
const SKY_ZENITH_DAY = new THREE.Color(0x67b8ef);
const SKY_MID_DAY = new THREE.Color(0xa8daf5);
const SKY_HORIZON_DAY = new THREE.Color(0xdceff8);
const SKY_ZENITH_TWILIGHT = new THREE.Color(0x587bb3);
const SKY_MID_TWILIGHT = new THREE.Color(0xd39a8d);
const SKY_HORIZON_TWILIGHT = new THREE.Color(0xff9a50);
const CLOUD_LIGHT_DAY = new THREE.Color(0xf8fbff);
const CLOUD_SHADOW_DAY = new THREE.Color(0x9fb6ca);
const CLOUD_LIGHT_TWILIGHT = new THREE.Color(0xffc58f);
const CLOUD_SHADOW_TWILIGHT = new THREE.Color(0x71798d);
const CLOUD_LIGHT_NIGHT = new THREE.Color(0x70839a);
const CLOUD_SHADOW_NIGHT = new THREE.Color(0x202a3b);

// The earlier physically tiny 2.85-unit disc was technically close to the Sun's
// true angular diameter, but on a phone it read as a white pixel. Keep the
// layered optical model while giving the visible disc enough screen presence to
// feel like a real celestial body. The halo/aureole remain much larger than the
// disc because atmosphere, not the photosphere, creates most perceived glare.
const SUN_CORE_DIAMETER = 5.8;
const SUN_HALO_DIAMETER = 60;
const SUN_AUREOLE_DIAMETER = 165;
const SUN_HORIZON_GLOW_WIDTH = 250;
const SUN_HORIZON_GLOW_HEIGHT = 92;
const MOON_CORE_DIAMETER = 2.45;
const MOON_GLOW_DIAMETER = 7.2;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function smoothstep01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function sunElevation(cycle) {
  const y = cycle?.sunBody?.group?.position?.y;
  if (!Number.isFinite(y)) return -1;
  return THREE.MathUtils.clamp(
    (y - SUN_VISUAL_HORIZON_OFFSET) / ORBIT_RADIUS,
    -1,
    1,
  );
}

function createSolarDiscTexture(size = 128) {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) * 0.5;
  const radius = size * 0.46;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / radius;
      const dy = (y - c) / radius;
      const r = Math.sqrt(dx * dx + dy * dy);
      const i = (x + y * size) * 4;

      if (r >= 1) {
        data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
        continue;
      }

      // A small amount of limb darkening keeps the disc spherical while the edge
      // remains soft enough to avoid a jagged circle at mobile resolution.
      const limb = 1 - Math.pow(clamp01(r), 2) * 0.075;
      const edge = 1 - smoothstep01((r - 0.91) / 0.09);
      const value = Math.round(255 * limb);
      data[i] = 255;
      data[i + 1] = Math.max(240, value);
      data[i + 2] = Math.max(220, Math.round(value * 0.965));
      data[i + 3] = Math.round(255 * edge);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createSolarHaloTexture(size = 128, exponent = 2.2) {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) * 0.5;
  const radius = size * 0.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / radius;
      const dy = (y - c) / radius;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const alpha = Math.pow(1 - r, exponent);
      const i = (x + y * size) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function installRealSun(cycle) {
  if (!cycle?.sunBody?.group || cycle.__riftRealSunInstalled) return;

  const discTexture = createSolarDiscTexture();
  const haloTexture = createSolarHaloTexture(128, 2.0);
  const aureoleTexture = createSolarHaloTexture(128, 3.0);
  const horizonTexture = createSolarHaloTexture(128, 2.6);

  const discMaterial = new THREE.SpriteMaterial({
    map: discTexture,
    color: REAL_SUN_ZENITH.clone(),
    transparent: true,
    opacity: 1,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
    alphaTest: 0.01,
  });
  const disc = new THREE.Sprite(discMaterial);
  disc.name = "rift-real-sun-disc";
  disc.scale.set(SUN_CORE_DIAMETER, SUN_CORE_DIAMETER, 1);
  disc.renderOrder = -91;

  const haloMaterial = new THREE.SpriteMaterial({
    map: haloTexture,
    color: REAL_HALO_ZENITH.clone(),
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const halo = new THREE.Sprite(haloMaterial);
  halo.name = "rift-real-sun-halo";
  halo.scale.set(SUN_HALO_DIAMETER, SUN_HALO_DIAMETER, 1);
  halo.renderOrder = -92;

  const aureoleMaterial = new THREE.SpriteMaterial({
    map: aureoleTexture,
    color: REAL_HALO_ZENITH.clone(),
    transparent: true,
    opacity: 0.06,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const aureole = new THREE.Sprite(aureoleMaterial);
  aureole.name = "rift-real-sun-aureole";
  aureole.scale.set(SUN_AUREOLE_DIAMETER, SUN_AUREOLE_DIAMETER, 1);
  aureole.renderOrder = -93;

  // Long optical path through the lower atmosphere creates a broad horizontal
  // glow around a low Sun. Localizing it to the Sun prevents the whole sky from
  // becoming orange or pink during every dawn/dusk frame.
  const horizonGlowMaterial = new THREE.SpriteMaterial({
    map: horizonTexture,
    color: REAL_TWILIGHT_GLOW.clone(),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const horizonGlow = new THREE.Sprite(horizonGlowMaterial);
  horizonGlow.name = "rift-real-sun-horizon-glow";
  horizonGlow.scale.set(SUN_HORIZON_GLOW_WIDTH, SUN_HORIZON_GLOW_HEIGHT, 1);
  horizonGlow.renderOrder = -94;

  cycle.sunBody.group.add(horizonGlow, aureole, halo, disc);
  cycle.__riftRealSun = {
    disc,
    halo,
    aureole,
    horizonGlow,
    discMaterial,
    haloMaterial,
    aureoleMaterial,
    horizonGlowMaterial,
    discTexture,
    haloTexture,
    aureoleTexture,
    horizonTexture,
  };
  cycle.__riftRealSunInstalled = true;
}

function updateRealSun(cycle) {
  installRealSun(cycle);
  const visual = cycle?.__riftRealSun;
  const sunBody = cycle?.sunBody;
  if (!visual || !sunBody?.group?.position) return;

  // Preserve the old body as the authoritative orbit/API anchor only. It no
  // longer draws, preventing two different Suns from appearing simultaneously.
  if (sunBody.core) sunBody.core.visible = false;
  if (sunBody.glow) sunBody.glow.visible = false;

  const elevation = sunElevation(cycle);
  const altitudeT = smoothstep01(Math.max(0, elevation) / 0.34);
  const horizon = smoothstep01(1 - Math.min(1, Math.abs(elevation) / 0.18));
  const visible = smoothstep01((elevation + 0.035) / 0.075);
  const cloudOcclusion = clamp01(globalThis.__riftProceduralCloudOcclusion || 0);
  const transmission = 1 - cloudOcclusion * 0.88;

  visual.discMaterial.color.copy(REAL_SUN_HORIZON).lerp(REAL_SUN_ZENITH, altitudeT);
  visual.haloMaterial.color.copy(REAL_HALO_HORIZON).lerp(REAL_HALO_ZENITH, altitudeT);
  visual.aureoleMaterial.color.copy(visual.haloMaterial.color);
  visual.horizonGlowMaterial.color
    .copy(REAL_TWILIGHT_GLOW)
    .lerp(REAL_HALO_HORIZON, altitudeT * 0.22);

  // The enlarged disc carries the identity of the Sun; glare supports it rather
  // than overwhelming it. Clouds attenuate the disc but never collapse it into a
  // one-pixel point unless the weather really is opaque.
  visual.discMaterial.opacity = visible
    * THREE.MathUtils.lerp(0.98, 1.0, altitudeT)
    * (0.65 + transmission * 0.35);
  visual.haloMaterial.opacity = visible
    * THREE.MathUtils.lerp(0.30, 0.16, altitudeT)
    * (0.35 + transmission * 0.65);
  visual.aureoleMaterial.opacity = visible
    * THREE.MathUtils.lerp(0.12, 0.045, altitudeT)
    * (0.40 + transmission * 0.60);
  visual.horizonGlowMaterial.opacity = visible
    * horizon
    * 0.12
    * (0.42 + transmission * 0.58);

  const discScale = SUN_CORE_DIAMETER * (1 + horizon * 0.12);
  const haloScale = SUN_HALO_DIAMETER * (1 + horizon * 0.24);
  const aureoleScale = SUN_AUREOLE_DIAMETER * (1 + horizon * 0.34);
  visual.disc.scale.set(discScale, discScale, 1);
  visual.halo.scale.set(haloScale, haloScale, 1);
  visual.aureole.scale.set(aureoleScale, aureoleScale, 1);
  visual.horizonGlow.scale.set(
    SUN_HORIZON_GLOW_WIDTH * (1 + horizon * 0.22),
    SUN_HORIZON_GLOW_HEIGHT * (1 + horizon * 0.10),
    1,
  );

  const show = visible > 0.001;
  visual.disc.visible = show;
  visual.halo.visible = show;
  visual.aureole.visible = show;
  visual.horizonGlow.visible = show && horizon > 0.01;
}

function configureNaturalShadows(cycle) {
  if (!cycle || cycle.__riftNaturalShadowTuningV2) return;

  const sunShadow = cycle.sun?.shadow;
  if (sunShadow) {
    sunShadow.bias = -0.00028;
    sunShadow.normalBias = 0.018;
    sunShadow.radius = 2.0;
    if (sunShadow.camera) {
      sunShadow.camera.near = 120;
      sunShadow.camera.far = 420;
      sunShadow.camera.updateProjectionMatrix?.();
    }
  }

  const moonShadow = cycle.moonLight?.shadow;
  if (moonShadow) {
    moonShadow.bias = -0.00022;
    moonShadow.normalBias = 0.024;
    moonShadow.radius = 3.0;
    if (moonShadow.camera) {
      moonShadow.camera.near = 120;
      moonShadow.camera.far = 420;
      moonShadow.camera.updateProjectionMatrix?.();
    }
  }

  cycle.__riftNaturalShadowTuningV2 = true;
}

function alignCelestialLighting(cycle) {
  if (!cycle) return;
  const sunBody = cycle.sunBody;
  const moonBody = cycle.moonBody;

  if (moonBody?.core?.scale && moonBody?.glow?.scale) {
    moonBody.core.scale.set(MOON_CORE_DIAMETER, MOON_CORE_DIAMETER, 1);
    moonBody.glow.scale.set(MOON_GLOW_DIAMETER, MOON_GLOW_DIAMETER, 1);
    if (moonBody.glow.material) moonBody.glow.material.opacity *= 0.58;
  }

  if (cycle.sun?.position && sunBody?.group?.position) {
    cycle.sun.position.copy(sunBody.group.position);
  }
  if (cycle.moonLight?.position && moonBody?.group?.position) {
    cycle.moonLight.position.copy(moonBody.group.position);
  }
}

function applyNaturalLightBalance(cycle) {
  if (!cycle) return;
  const elevation = sunElevation(cycle);

  if (cycle.sun && cycle.ambient) {
    const altitudeT = smoothstep01(Math.max(0, elevation) / 0.30);
    const lowSun = 1 - altitudeT;

    if (elevation > -0.08) {
      cycle.sun.intensity *= THREE.MathUtils.lerp(0.28, 1.0, altitudeT);
      cycle.sun.color.lerp(HORIZON_SUN_LIGHT, lowSun * 0.26);
      cycle.ambient.intensity *= 1 + lowSun * 0.20;
      if (cycle.ambient.color?.isColor) {
        cycle.ambient.color.lerp(HORIZON_SKY_FILL, lowSun * 0.05);
      }
    }
  }

  if (cycle.moonLight) cycle.moonLight.intensity *= 0.32;
}

function blendResultColor(result, key, target, amount) {
  const color = result?.[key];
  if (color?.isColor) color.lerp(target, clamp01(amount));
}

function applySunriseSunsetAtmosphere(cycle, result) {
  const elevation = sunElevation(cycle);

  // The atmosphere begins to brighten before the solar disc appears. Warmth is
  // concentrated near the lower sky while the zenith stays distinctly blue.
  const sunlightPresence = smoothstep01((elevation + 0.115) / 0.145);
  const dayT = smoothstep01(Math.max(0, elevation) / 0.42);
  const lowSun = smoothstep01(1 - Math.min(1, Math.abs(elevation) / 0.24))
    * sunlightPresence;

  const targetZenith = SKY_ZENITH_TWILIGHT.clone().lerp(SKY_ZENITH_DAY, dayT);
  const targetMid = SKY_MID_TWILIGHT.clone().lerp(SKY_MID_DAY, dayT);
  const targetHorizon = SKY_HORIZON_TWILIGHT.clone().lerp(SKY_HORIZON_DAY, dayT);

  // Retain the preserved biome/night atmosphere. Sunrise/sunset strongly affects
  // the horizon, moderately affects the middle sky and only gently touches the
  // zenith — closer to actual atmospheric scattering than a full-screen tint.
  const atmosphereWeight = sunlightPresence * 0.64;
  blendResultColor(result, "skyZenith", targetZenith, atmosphereWeight * 0.30);
  blendResultColor(result, "skyMid", targetMid, atmosphereWeight * (0.48 + lowSun * 0.10));
  blendResultColor(result, "skyHorizon", targetHorizon, atmosphereWeight * (0.80 + lowSun * 0.16));
  blendResultColor(result, "fogColor", targetHorizon, lowSun * 0.15);
  blendResultColor(result, "skyColor", targetMid, lowSun * 0.08);

  if (cycle.ambient?.color?.isColor && sunlightPresence > 0) {
    cycle.ambient.color.lerp(targetMid, lowSun * 0.035);
  }

  const daylightCloud = CLOUD_LIGHT_TWILIGHT.clone().lerp(CLOUD_LIGHT_DAY, dayT);
  const daylightShadow = CLOUD_SHADOW_TWILIGHT.clone().lerp(CLOUD_SHADOW_DAY, dayT);
  const cloudLight = CLOUD_LIGHT_NIGHT.clone().lerp(daylightCloud, sunlightPresence);
  const cloudShadow = CLOUD_SHADOW_NIGHT.clone().lerp(daylightShadow, sunlightPresence);

  const skyZenith = result?.skyZenith?.isColor ? result.skyZenith.clone() : targetZenith;
  const skyMid = result?.skyMid?.isColor ? result.skyMid.clone() : targetMid;
  const skyHorizon = result?.skyHorizon?.isColor ? result.skyHorizon.clone() : targetHorizon;

  globalThis.__riftSkyAtmosphere = {
    sunElevation: elevation,
    sunlightPresence,
    dayT,
    lowSun,
    skyZenith,
    skyMid,
    skyHorizon,
    cloudLight,
    cloudShadow,
  };
}

export function createDayNightCycle(
  scene,
  sun,
  ambient,
  starfield,
  biome,
  moonLight,
) {
  const cycle = current.createDayNightCycle(
    scene,
    sun,
    ambient,
    starfield,
    biome,
    moonLight,
  );
  configureNaturalShadows(cycle);
  installRealSun(cycle);
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = current.updateDayNightCycle(cycle, dt);
  configureNaturalShadows(cycle);
  alignCelestialLighting(cycle);
  applyNaturalLightBalance(cycle);
  applySunriseSunsetAtmosphere(cycle, result);
  updateRealSun(cycle);
  return result;
}
