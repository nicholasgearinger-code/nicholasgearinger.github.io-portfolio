import * as THREE from "three";
import * as current from "./dayNightCycle_lighting_base.js";

export * from "./dayNightCycle_lighting_base.js";

const ORBIT_RADIUS = 260;
const SUN_VISUAL_HORIZON_OFFSET = 10;
const HORIZON_SUN_LIGHT = new THREE.Color(0xff9657);
const HORIZON_SKY_FILL = new THREE.Color(0xffc79a);
const REAL_SUN_ZENITH = new THREE.Color(0xfffdf4);
const REAL_SUN_HORIZON = new THREE.Color(0xff8a3d);
const REAL_HALO_ZENITH = new THREE.Color(0xfff4d6);
const REAL_HALO_HORIZON = new THREE.Color(0xffa04c);

// The real Sun and Moon both subtend roughly half a degree in our sky. The Sun
// itself remains physically small; the much larger apparent size in photographs
// comes from atmospheric glare, which is rendered as two separate soft halos.
const SUN_CORE_DIAMETER = 2.85;
const SUN_HALO_DIAMETER = 28;
const SUN_AUREOLE_DIAMETER = 82;
const MOON_CORE_DIAMETER = 2.45;
const MOON_GLOW_DIAMETER = 7.2;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function smoothstep01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
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

      // Very subtle limb darkening keeps the disc spherical without turning it
      // into a shaded ball. The last few percent of the radius receive a soft
      // antialiased edge so the Sun stays round even at phone resolution.
      const limb = 1 - Math.pow(clamp01(r), 2) * 0.08;
      const edge = 1 - smoothstep01((r - 0.92) / 0.08);
      const value = Math.round(255 * limb);
      data[i] = 255;
      data[i + 1] = Math.max(238, value);
      data[i + 2] = Math.max(218, Math.round(value * 0.96));
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
  const aureoleTexture = createSolarHaloTexture(128, 3.1);

  const discMaterial = new THREE.SpriteMaterial({
    map: discTexture,
    color: REAL_SUN_ZENITH.clone(),
    transparent: true,
    opacity: 1,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const disc = new THREE.Sprite(discMaterial);
  disc.name = "rift-real-sun-disc";
  disc.scale.set(SUN_CORE_DIAMETER, SUN_CORE_DIAMETER, 1);
  disc.renderOrder = -91;

  const haloMaterial = new THREE.SpriteMaterial({
    map: haloTexture,
    color: REAL_HALO_ZENITH.clone(),
    transparent: true,
    opacity: 0.26,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const halo = new THREE.Sprite(haloMaterial);
  halo.name = "rift-real-sun-halo";
  halo.scale.set(SUN_HALO_DIAMETER, SUN_HALO_DIAMETER, 1);
  halo.renderOrder = -91;

  const aureoleMaterial = new THREE.SpriteMaterial({
    map: aureoleTexture,
    color: REAL_HALO_ZENITH.clone(),
    transparent: true,
    opacity: 0.075,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const aureole = new THREE.Sprite(aureoleMaterial);
  aureole.name = "rift-real-sun-aureole";
  aureole.scale.set(SUN_AUREOLE_DIAMETER, SUN_AUREOLE_DIAMETER, 1);
  aureole.renderOrder = -92;

  cycle.sunBody.group.add(aureole, halo, disc);
  cycle.__riftRealSun = {
    disc,
    halo,
    aureole,
    discMaterial,
    haloMaterial,
    aureoleMaterial,
    discTexture,
    haloTexture,
    aureoleTexture,
  };
  cycle.__riftRealSunInstalled = true;
}

function updateRealSun(cycle) {
  installRealSun(cycle);
  const visual = cycle?.__riftRealSun;
  const sunBody = cycle?.sunBody;
  if (!visual || !sunBody?.group?.position) return;

  // Keep the historical Sun geometry alive for the rest of the game's existing
  // API (cloud occlusion code still writes its material opacity), but hide its
  // actual drawing. The new camera-facing disc is what players see.
  if (sunBody.core) sunBody.core.visible = false;
  if (sunBody.glow) sunBody.glow.visible = false;

  const elevation = THREE.MathUtils.clamp(
    (sunBody.group.position.y - SUN_VISUAL_HORIZON_OFFSET) / ORBIT_RADIUS,
    -1,
    1,
  );
  const altitudeT = smoothstep01(Math.max(0, elevation) / 0.34);
  const horizon = smoothstep01(1 - Math.min(1, Math.abs(elevation) / 0.18));
  const visible = smoothstep01((elevation + 0.035) / 0.075);

  // Use the previous frame's procedural-weather occlusion. The cloud renderer
  // itself is also depth/blend composited over the Sun, so this is only the
  // extra physical dimming of the solar disc through dense vapor.
  const cloudOcclusion = clamp01(globalThis.__riftProceduralCloudOcclusion || 0);
  const transmission = 1 - cloudOcclusion * 0.88;

  visual.discMaterial.color.copy(REAL_SUN_HORIZON).lerp(REAL_SUN_ZENITH, altitudeT);
  visual.haloMaterial.color.copy(REAL_HALO_HORIZON).lerp(REAL_HALO_ZENITH, altitudeT);
  visual.aureoleMaterial.color.copy(visual.haloMaterial.color);

  visual.discMaterial.opacity = visible * THREE.MathUtils.lerp(0.92, 1.0, altitudeT) * transmission;
  visual.haloMaterial.opacity = visible * THREE.MathUtils.lerp(0.34, 0.20, altitudeT) * (0.35 + transmission * 0.65);
  visual.aureoleMaterial.opacity = visible * THREE.MathUtils.lerp(0.13, 0.055, altitudeT) * (0.4 + transmission * 0.6);

  const discScale = SUN_CORE_DIAMETER * (1 + horizon * 0.045);
  const haloScale = SUN_HALO_DIAMETER * (1 + horizon * 0.28);
  const aureoleScale = SUN_AUREOLE_DIAMETER * (1 + horizon * 0.42);
  visual.disc.scale.set(discScale, discScale, 1);
  visual.halo.scale.set(haloScale, haloScale, 1);
  visual.aureole.scale.set(aureoleScale, aureoleScale, 1);

  const show = visible > 0.001;
  visual.disc.visible = show;
  visual.halo.visible = show;
  visual.aureole.visible = show;
}

function configureNaturalShadows(cycle) {
  if (!cycle || cycle.__riftNaturalShadowTuningV2) return;

  const sunShadow = cycle.sun?.shadow;
  if (sunShadow) {
    // Keep bias tiny. Large bias/normalBias values visibly detach thin palm
    // shadows from their casters at low solar angles.
    sunShadow.bias = -0.00028;
    sunShadow.normalBias = 0.018;
    sunShadow.radius = 2.0;
    if (sunShadow.camera) {
      // The light remains about one orbit radius from the player-centred target.
      // Tightening the useful depth range improves precision without increasing
      // shadow-map resolution or adding any mobile GPU cost.
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
  // The visible Sun is now handled by updateRealSun(). Keep the old object's
  // transforms untouched so legacy code still has a valid celestial position.

  const moonBody = cycle.moonBody;
  if (moonBody?.core?.scale && moonBody?.glow?.scale) {
    moonBody.core.scale.set(MOON_CORE_DIAMETER, MOON_CORE_DIAMETER, 1);
    moonBody.glow.scale.set(MOON_GLOW_DIAMETER, MOON_GLOW_DIAMETER, 1);
    if (moonBody.glow.material) moonBody.glow.material.opacity *= 0.58;
  }

  // One celestial direction owns the visible position, DirectionalLight,
  // shadows and the direction handed to the ocean.
  if (cycle.sun?.position && sunBody?.group?.position) {
    cycle.sun.position.copy(sunBody.group.position);
  }
  if (cycle.moonLight?.position && moonBody?.group?.position) {
    cycle.moonLight.position.copy(moonBody.group.position);
  }
}

function applyNaturalLightBalance(cycle) {
  if (!cycle) return;

  const visualY = cycle.sunBody?.group?.position?.y;
  if (Number.isFinite(visualY) && cycle.sun && cycle.ambient) {
    const elevation = THREE.MathUtils.clamp(
      (visualY - SUN_VISUAL_HORIZON_OFFSET) / ORBIT_RADIUS,
      -1,
      1,
    );

    const altitudeT = smoothstep01(Math.max(0, elevation) / 0.30);
    const lowSun = 1 - altitudeT;

    if (elevation > -0.08) {
      cycle.sun.intensity *= THREE.MathUtils.lerp(0.28, 1.0, altitudeT);
      cycle.sun.color.lerp(HORIZON_SUN_LIGHT, lowSun * 0.26);

      cycle.ambient.intensity *= 1 + lowSun * 0.26;
      if (cycle.ambient.color?.isColor) {
        cycle.ambient.color.lerp(HORIZON_SKY_FILL, lowSun * 0.07);
      }
    }
  }

  if (cycle.moonLight) cycle.moonLight.intensity *= 0.32;
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
  updateRealSun(cycle);
  return result;
}
