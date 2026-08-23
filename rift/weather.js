import * as THREE from "three";
import * as current from "./weather_lightning_visible_base.js";

export * from "./weather_lightning_visible_base.js";

// -----------------------------------------------------------------------------
// Unified atmospheric state
// -----------------------------------------------------------------------------
// The legacy weather module still owns rain particles, wind and its established
// storm timing. This wrapper translates that live state into slow atmospheric
// variables consumed by proceduralClouds.js. Clouds therefore build before and
// around precipitation instead of simply becoming a darker decorative layer.
// -----------------------------------------------------------------------------

const CLOUD_CLIMATES = {
  crystal: {
    fairCoverage: 0.27,
    fairDensity: 0.49,
    humidity: 0.54,
    convection: 0.38,
    cloudBase: 58,
    fairThickness: 42,
    stormThickness: 122,
  },
  verdant: {
    fairCoverage: 0.40,
    fairDensity: 0.57,
    humidity: 0.68,
    convection: 0.46,
    cloudBase: 54,
    fairThickness: 48,
    stormThickness: 116,
  },
  ember: {
    fairCoverage: 0.22,
    fairDensity: 0.48,
    humidity: 0.34,
    convection: 0.58,
    cloudBase: 64,
    fairThickness: 48,
    stormThickness: 132,
  },
  abyssal: {
    fairCoverage: 0.52,
    fairDensity: 0.62,
    humidity: 0.72,
    convection: 0.35,
    cloudBase: 50,
    fairThickness: 48,
    stormThickness: 108,
  },
  ashen: {
    fairCoverage: 0.46,
    fairDensity: 0.59,
    humidity: 0.42,
    convection: 0.48,
    cloudBase: 56,
    fairThickness: 50,
    stormThickness: 118,
  },
  frost: {
    fairCoverage: 0.44,
    fairDensity: 0.55,
    humidity: 0.64,
    convection: 0.28,
    cloudBase: 48,
    fairThickness: 42,
    stormThickness: 92,
  },
  default: {
    fairCoverage: 0.34,
    fairDensity: 0.53,
    humidity: 0.55,
    convection: 0.40,
    cloudBase: 58,
    fairThickness: 44,
    stormThickness: 112,
  },
};

const STRIKE_COOLDOWNS = {
  ember: [25, 40],
  verdant: [23, 38],
  crystal: [18, 30],
  abyssal: [34, 52],
  ashen: [28, 44],
  frost: [38, 58],
};

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function expApproach(currentValue, targetValue, dt, seconds) {
  const t = 1 - Math.exp(-Math.max(0, dt) / Math.max(0.001, seconds));
  return THREE.MathUtils.lerp(currentValue, targetValue, t);
}

function weatherLabel(coverage, storm, precipitation, convection) {
  if (storm > 0.67 || precipitation > 0.62) return "storm";
  if (coverage > 0.78) return "overcast";
  if (convection > 0.62 && coverage > 0.48) return "growing-cumulus";
  if (coverage > 0.43) return "partly-cloudy";
  if (coverage > 0.18) return "scattered";
  return "clear";
}

function createProceduralWeatherState(handle) {
  const climate = CLOUD_CLIMATES[handle?.biome] || CLOUD_CLIMATES.default;
  const phase = Math.random() * Math.PI * 2;
  const state = {
    biome: handle?.biome || "default",
    age: 0,
    phase,
    cloudCoverage: climate.fairCoverage,
    cloudDensity: climate.fairDensity,
    humidity: climate.humidity,
    convection: climate.convection,
    erosion: 0.72,
    stormIntensity: 0,
    precipitation: 0,
    cloudBase: climate.cloudBase,
    cloudTop: climate.cloudBase + climate.fairThickness,
    windX: 0,
    windZ: 0,
    weatherType: "scattered",
  };
  handle.__riftProceduralWeather = state;
  globalThis.__riftProceduralWeatherState = state;
  return state;
}

function updateProceduralWeatherState(handle, result, dt, dayAmount) {
  if (!handle) return null;
  const state = handle.__riftProceduralWeather || createProceduralWeatherState(handle);
  const climate = CLOUD_CLIMATES[handle.biome] || CLOUD_CLIMATES.default;
  const safeDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
  state.age += safeDt;

  const rain = clamp01(handle.rainIntensity ?? result?.rainIntensity ?? 0);
  const rainActive = !!handle.rainActive;
  // Rain-active is an early warning before rainIntensity fully ramps. That lets
  // cloud mass thicken first instead of precipitation appearing under fair sky.
  const stormSignal = clamp01(Math.max(rain, rainActive ? 0.56 : 0));

  // Slow clear-weather evolution: a broad humidity wave plus a second offset
  // oscillator changes coverage over minutes, not seconds. This keeps fair sky
  // alive even when no scripted weather event is running.
  const synoptic = 0.5 + 0.5 * Math.sin(state.age * 0.0075 + state.phase);
  const mesoscale = 0.5 + 0.5 * Math.sin(state.age * 0.017 + state.phase * 1.73 + 1.4);
  const fairVariation = (synoptic - 0.5) * 0.18 + (mesoscale - 0.5) * 0.10;

  const targetCoverage = clamp01(
    climate.fairCoverage + fairVariation + stormSignal * 0.62,
  );
  const targetHumidity = clamp01(
    climate.humidity + fairVariation * 0.55 + stormSignal * 0.38,
  );
  const targetConvection = clamp01(
    climate.convection + mesoscale * 0.13 + stormSignal * 0.47,
  );
  const targetDensity = clamp01(
    climate.fairDensity + targetHumidity * 0.12 + stormSignal * 0.32,
  );

  // Cloud edges are highly eroded in fair weather and become connected/solid as
  // humidity and precipitation rise.
  const targetErosion = clamp01(
    0.78 - targetHumidity * 0.22 - stormSignal * 0.30,
  );

  // Cloud base lowers ahead of rain while convective tops rise dramatically.
  // At full storm Crystal, for example, the layer can grow from ~58-100 up to
  // roughly 42-170 world units, producing a genuine towering thunderhead band.
  const targetBase = climate.cloudBase - stormSignal * 16 - targetHumidity * 3;
  const thicknessBlend = clamp01(stormSignal * 0.86 + targetConvection * 0.24);
  const targetThickness = THREE.MathUtils.lerp(
    climate.fairThickness,
    climate.stormThickness,
    thicknessBlend,
  );
  const targetTop = targetBase + targetThickness;

  // Storm build is faster than fair-weather drift but still gradual enough to
  // watch cumulus grow before rain. Clearing intentionally takes longer.
  const building = stormSignal > state.stormIntensity;
  const weatherTau = building ? 7.5 : 18.0;
  state.cloudCoverage = expApproach(state.cloudCoverage, targetCoverage, safeDt, weatherTau);
  state.cloudDensity = expApproach(state.cloudDensity, targetDensity, safeDt, weatherTau * 0.82);
  state.humidity = expApproach(state.humidity, targetHumidity, safeDt, weatherTau * 0.9);
  state.convection = expApproach(state.convection, targetConvection, safeDt, weatherTau * 0.72);
  state.erosion = expApproach(state.erosion, targetErosion, safeDt, weatherTau);
  state.stormIntensity = expApproach(state.stormIntensity, stormSignal, safeDt, building ? 5.5 : 15.0);
  state.precipitation = expApproach(state.precipitation, rain, safeDt, rain > state.precipitation ? 2.8 : 6.0);
  state.cloudBase = expApproach(state.cloudBase, targetBase, safeDt, weatherTau * 0.8);
  state.cloudTop = expApproach(state.cloudTop, targetTop, safeDt, weatherTau * 0.9);

  state.windX = Number(result?.windX) || 0;
  state.windZ = Number(result?.windZ) || 0;
  state.dayAmount = clamp01(dayAmount);
  state.weatherType = weatherLabel(
    state.cloudCoverage,
    state.stormIntensity,
    state.precipitation,
    state.convection,
  );

  globalThis.__riftProceduralWeatherState = state;

  // Surface the atmospheric state on the already-returned wind object too. The
  // existing loop can continue treating it as ordinary weather while new systems
  // optionally read these fields without another dependency.
  if (result && typeof result === "object") {
    result.cloudCoverage = state.cloudCoverage;
    result.cloudDensity = state.cloudDensity;
    result.humidity = state.humidity;
    result.convection = state.convection;
    result.stormIntensity = state.stormIntensity;
    result.cloudBase = state.cloudBase;
    result.cloudTop = state.cloudTop;
    result.weatherType = state.weatherType;
  }
  return state;
}

// -----------------------------------------------------------------------------
// Lightning cadence + environmental flash layer
// -----------------------------------------------------------------------------

function createRadialGlowTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) * 0.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const r = Math.min(1, Math.hypot(dx, dy));
      const alpha = Math.pow(1 - r, 2.2);
      const i = (y * size + x) * 4;
      data[i] = 235;
      data[i + 1] = 248;
      data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createLightningFlashRig(scene) {
  const strikeLight = new THREE.PointLight(0xeaf8ff, 0, 260, 2);
  strikeLight.castShadow = false;
  scene.add(strikeLight);

  const skyFill = new THREE.HemisphereLight(0xf2fbff, 0x526073, 0);
  scene.add(skyFill);

  const glowTexture = createRadialGlowTexture();
  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xdff4ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const skyGlow = new THREE.Sprite(glowMaterial);
  skyGlow.visible = false;
  scene.add(skyGlow);

  return { strikeLight, skyFill, skyGlow, glowMaterial, glowTexture };
}

function positionFlashRig(handle) {
  const bolt = handle?.realLightningBolt;
  const rig = handle?.__riftLightningFlashRig;
  const end = bolt?.__riftStrikeEnd;
  if (!rig || !end) return;

  rig.strikeLight.position.copy(end);
  rig.strikeLight.position.y += 22;

  rig.skyGlow.position.copy(end);
  rig.skyGlow.position.y += 34;

  const strikeDistance = Number(bolt.__riftStrikeDistance) || 90;
  const size = THREE.MathUtils.clamp(strikeDistance * 0.82, 62, 96);
  rig.skyGlow.scale.set(size, size * 0.82, 1);
  rig.skyGlow.visible = true;
}

function updateEnvironmentalFlash(handle) {
  const rig = handle?.__riftLightningFlashRig;
  const bolt = handle?.realLightningBolt;
  if (!rig || !bolt) return;

  const active = !!(bolt.group?.visible && bolt.life > 0);
  if (!active) {
    rig.strikeLight.intensity = 0;
    rig.skyFill.intensity = 0;
    rig.glowMaterial.opacity = 0;
    rig.skyGlow.visible = false;
    return;
  }

  const boltIntensity = clamp01(bolt.coreMaterial?.opacity);
  const age = Math.max(0, Number(bolt.__riftVisualAge) || 0);
  const returnStrokeScale = age < 0.12 ? 1 : 0.48;
  const flash = Math.pow(boltIntensity, 1.18) * returnStrokeScale;

  rig.strikeLight.intensity = 15000 * flash;
  rig.skyFill.intensity = 0.58 * flash;
  rig.glowMaterial.opacity = 0.24 * flash;
  rig.skyGlow.visible = flash > 0.005;
}

function disposeLightningFlashRig(scene, rig) {
  if (!rig) return;
  scene.remove(rig.strikeLight);
  scene.remove(rig.skyFill);
  scene.remove(rig.skyGlow);
  rig.glowMaterial.dispose();
  rig.glowTexture.dispose();
}

export function createWeatherSystem(scene, biome, ...args) {
  const handle = current.createWeatherSystem(scene, biome, ...args);
  if (handle) {
    handle.__riftLightningFlashRig = createLightningFlashRig(scene);
    createProceduralWeatherState(handle);
  }
  return handle;
}

export function updateWeatherSystem(
  handle,
  dt,
  erupting = false,
  dayAmount = 0,
  playerPos = null,
) {
  const boltBefore = handle?.realLightningBolt;
  const wasVisible = !!(boltBefore?.group?.visible && boltBefore.life > 0);

  const result = current.updateWeatherSystem(handle, dt, erupting, dayAmount, playerPos);
  updateProceduralWeatherState(handle, result, dt, dayAmount);

  const bolt = handle?.realLightningBolt;
  const isVisible = !!(bolt?.group?.visible && bolt.life > 0);
  if (isVisible && !wasVisible) {
    positionFlashRig(handle);
    const range = STRIKE_COOLDOWNS[handle?.biome] ?? [24, 40];
    handle.__riftDistantStrikeTimer = randRange(range[0], range[1]);
  }

  updateEnvironmentalFlash(handle);
  return result;
}

export function disposeWeatherSystem(scene, handle) {
  disposeLightningFlashRig(scene, handle?.__riftLightningFlashRig);
  if (handle) {
    handle.__riftLightningFlashRig = null;
    if (globalThis.__riftProceduralWeatherState === handle.__riftProceduralWeather) {
      delete globalThis.__riftProceduralWeatherState;
    }
    handle.__riftProceduralWeather = null;
  }
  return current.disposeWeatherSystem(scene, handle);
}
