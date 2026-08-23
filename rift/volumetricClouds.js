import * as THREE from "three";
import {
  createVolumetricClouds as createProceduralClouds,
  updateVolumetricClouds as updateProceduralClouds,
  disposeVolumetricClouds as disposeProceduralClouds,
} from "./proceduralClouds.js";

// Compatibility entry point retained because the stable Rift runtime already
// imports ./volumetricClouds.js. The implementation now lives in the unified
// procedural atmosphere module. This wrapper adds a very cheap high-altitude
// cirrus component and tunes the Low/mobile volume so visibility comes from
// broader coverage rather than over-dense 8-step slices.

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function smooth01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise2D(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, u),
    THREE.MathUtils.lerp(c, d, u),
    v,
  );
}

function fbm2D(x, y) {
  let value = 0;
  let amp = 0.56;
  let norm = 0;
  for (let octave = 0; octave < 4; octave++) {
    value += valueNoise2D(x, y) * amp;
    norm += amp;
    x = x * 2.03 + 11.7;
    y = y * 2.01 - 7.4;
    amp *= 0.5;
  }
  return value / Math.max(0.001, norm);
}

function createCirrusTexture(size = 192) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      // Two anisotropic fields create long torn streaks instead of another
      // cotton-ball layer. A slow broad field decides where cirrus exists; the
      // finer field erodes holes into it.
      const broad = fbm2D(u * 3.1, v * 9.4);
      const streak = fbm2D(u * 10.5 + broad * 1.7, v * 2.2 - broad * 0.9);
      const detail = fbm2D(u * 18.0 - 3.2, v * 5.0 + 4.7);
      const field = broad * 0.54 + streak * 0.34 + detail * 0.12;
      const wispy = smooth01((field - 0.49) / 0.22);
      const breakup = smooth01((streak - 0.38) / 0.34);
      const alpha = Math.pow(clamp01(wispy * (0.55 + breakup * 0.45)), 1.35);

      const i = (x + y * size) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createCirrusLayer(scene) {
  const texture = createCirrusTexture();
  texture.repeat.set(1.55, 1.05);

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xe9f2fa,
    transparent: true,
    opacity: 0.20,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
  });

  const geometry = new THREE.PlaneGeometry(1900, 1900, 1, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "rift-procedural-cirrus";
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 176;
  mesh.renderOrder = -90;
  mesh.frustumCulled = false;
  scene.add(mesh);

  return { mesh, material, texture, geometry, offsetX: 0, offsetY: 0 };
}

function updateCirrus(handle, dt, camera, sunColor, ambientColor, windX, windZ, storm, underwater) {
  const cirrus = handle?.__riftCirrus;
  if (!cirrus) return;

  cirrus.mesh.visible = !underwater;
  if (underwater) return;

  cirrus.mesh.position.x = camera.position.x;
  cirrus.mesh.position.z = camera.position.z;

  const safeDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
  cirrus.offsetX += (windX + 0.30) * safeDt * 0.00033;
  cirrus.offsetY += (windZ + 0.11) * safeDt * 0.00024;
  cirrus.texture.offset.set(cirrus.offsetX, cirrus.offsetY);

  // High cirrus remains subtle in fair weather and fades under a thick storm
  // deck so the sky never becomes two unrelated cloud systems at once.
  cirrus.material.opacity = THREE.MathUtils.lerp(0.23, 0.055, clamp01(storm));

  const daylightColor = new THREE.Color(0xf7fbff);
  if (sunColor?.isColor) daylightColor.lerp(sunColor, 0.12);
  if (ambientColor?.isColor) daylightColor.lerp(ambientColor, 0.16);
  cirrus.material.color.copy(daylightColor);
}

export function createVolumetricClouds(scene) {
  const handle = createProceduralClouds(scene);
  if (!handle) return handle;

  if (handle.material) {
    // The cloud volume can be viewed from below, from inside the layer while
    // climbing terrain, and from glancing angles near the horizon. DoubleSide
    // avoids an iOS/WebGPU face-culling edge case that can otherwise make the
    // entire volume disappear depending on which box face launches the march.
    // forceSinglePass keeps this at one transparent draw instead of paying the
    // normal two-pass cost of a double-sided transparent material.
    handle.material.side = THREE.DoubleSide;
    handle.material.forceSinglePass = true;
    handle.material.opacity = 0.94;
    handle.material.needsUpdate = true;
  }

  handle.__riftCirrus = createCirrusLayer(scene);
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
  updateProceduralClouds(
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

  if (!handle?.uniforms || !camera) return;

  const waterY = currentBiome === "crystal" ? 8 : null;
  const underwater = Number.isFinite(waterY) && camera.position.y < waterY - 0.15;
  const state = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(state?.stormIntensity ?? rainIntensity);

  updateCirrus(
    handle,
    dt,
    camera,
    sunColor,
    ambientColor,
    windX,
    windZ,
    storm,
    underwater,
  );

  if (!handle.mesh?.visible) return;

  const u = handle.uniforms;

  // The first visibility fix made fair-weather clouds visible by forcing high
  // density. On an 8-step mobile raymarch, that makes every sample nearly opaque
  // and exposes the march planes as horizontal white bands near the horizon.
  // Visibility now comes from broader weather COVERAGE while density stays soft.
  // This keeps scattered clouds present without turning each ray step into a
  // visible slice.
  const fairCoverageFloor = THREE.MathUtils.lerp(0.58, 0.72, storm);
  const fairDensityFloor = THREE.MathUtils.lerp(0.50, 0.68, storm);
  const humidityFloor = THREE.MathUtils.lerp(0.56, 0.76, storm);
  const erosionCeiling = THREE.MathUtils.lerp(0.42, 0.29, storm);

  u.coverage.value = Math.max(Number(u.coverage.value) || 0, fairCoverageFloor);
  u.density.value = Math.max(Number(u.density.value) || 0, fairDensityFloor);
  u.humidity.value = Math.max(Number(u.humidity.value) || 0, humidityFloor);
  u.erosion.value = Math.min(
    Number.isFinite(Number(u.erosion.value)) ? Number(u.erosion.value) : 0.70,
    erosionCeiling,
  );

  // Give fair-weather cumulus more real vertical body. The original thin
  // 58-100 band pushed nearly all visible cloud structure down toward the
  // horizon. Storm values already exceed these limits and remain untouched.
  const originalBase = Number(u.cloudBaseY.value) || 58;
  const originalTop = Number(u.cloudTopY.value) || 108;
  const visualBase = Math.min(originalBase, THREE.MathUtils.lerp(52, 42, storm));
  const visualTop = Math.max(originalTop, THREE.MathUtils.lerp(124, 166, storm));
  u.cloudBaseY.value = visualBase;
  u.cloudTopY.value = visualTop;
  handle.mesh.position.y = (visualBase + visualTop) * 0.5;
  handle.mesh.scale.y = Math.max(1, (visualTop - visualBase) / 430);

  globalThis.__riftCloudVisibilityState = {
    visible: true,
    coverage: u.coverage.value,
    density: u.density.value,
    humidity: u.humidity.value,
    erosion: u.erosion.value,
    cloudBase: visualBase,
    cloudTop: visualTop,
    weatherType: handle.currentWeatherType,
  };
}

export function disposeVolumetricClouds(handle) {
  if (handle?.__riftCirrus) {
    const cirrus = handle.__riftCirrus;
    handle.scene?.remove(cirrus.mesh);
    cirrus.geometry?.dispose();
    cirrus.material?.dispose();
    cirrus.texture?.dispose();
    handle.__riftCirrus = null;
  }
  if (globalThis.__riftCloudVisibilityState) delete globalThis.__riftCloudVisibilityState;
  return disposeProceduralClouds(handle);
}
