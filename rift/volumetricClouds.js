import * as THREE from "three";
import {
  Fn,
  uniform,
  vec2,
  vec3,
  vec4,
  float,
  texture,
  texture3D,
  dot,
  mix,
  clamp,
  pow,
  exp,
  normalize,
  smoothstep,
  Loop,
  positionWorld,
  cameraPosition,
  max as tslMax,
  min as tslMin,
} from "three/tsl";
import {
  createVolumetricClouds as createProceduralClouds,
  updateVolumetricClouds as updateProceduralClouds,
  disposeVolumetricClouds as disposeProceduralClouds,
} from "./proceduralClouds.js";
import { LIQUID_LEVEL } from "./terrain.js";

// -----------------------------------------------------------------------------
// Dynamic cloud presentation layer.
//
// proceduralClouds.js owns the persistent weather volume/state. This wrapper
// upgrades the live shader with stable per-ray jitter and slowly morphing volume
// coordinates, then adds a cheap procedural cirrus deck. The important mobile
// constraint remains unchanged: Low keeps the same eight primary march steps.
// Shape evolution comes from moving through the 3D field and changing its cross
// section over time instead of increasing the brute-force sample count.
// -----------------------------------------------------------------------------

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
  return {
    mesh,
    material,
    texture,
    geometry,
    offsetX: 0,
    offsetY: 0,
    age: Math.random() * 40,
  };
}

function installDynamicCloudShader(handle) {
  if (!handle?.material || handle.__riftDynamicShaderInstalled) return;

  const uniforms = handle.uniforms;
  uniforms.morphOffset = uniform(new THREE.Vector3());
  uniforms.secondaryMorph = uniform(new THREE.Vector3());
  uniforms.timePhase = uniform(0);

  const shapeTex = handle.shapeTexture;
  const weatherTex = handle.weatherTexture;
  const RAY_STEPS = handle.quality.raySteps;
  const SHADOW_STEPS = handle.quality.shadowSteps;
  const TILE_SCALE = float(handle.quality.tileScale);
  const WEATHER_SCALE = float(handle.quality.weatherScale);
  const MAX_DISTANCE = float(handle.quality.maxRayDistance);

  handle.material.colorNode = Fn(() => {
    const rayOrigin = cameraPosition;
    const rayDir = normalize(positionWorld.sub(cameraPosition));
    const safeY = rayDir.y.abs().max(0.001);
    const signedY = rayDir.y.div(safeY);
    const t0Raw = uniforms.cloudBaseY.sub(rayOrigin.y).div(rayDir.y);
    const t1Raw = uniforms.cloudTopY.sub(rayOrigin.y).div(rayDir.y);
    const tNear = tslMin(t0Raw, t1Raw);
    const tFar = tslMax(t0Raw, t1Raw);
    const tStart = tslMax(tNear, float(0));
    const tEnd = tslMin(tFar, tStart.add(MAX_DISTANCE));
    const marchLength = tslMax(tEnd.sub(tStart), float(0));
    const stepSize = marchLength.div(RAY_STEPS).toVar();

    // Low uses only eight view samples. Starting every ray at the same fraction
    // of its first interval makes those samples line up as horizontal shelves at
    // grazing angles. One weather-texture lookup produces a stable per-pixel
    // jitter without temporal sparkle or another raymarch step.
    const jitterUV = vec2(positionWorld.x, positionWorld.z)
      .mul(0.0137)
      .add(uniforms.weatherOffset.mul(3.17))
      .fract();
    const jitterSeed = texture(weatherTex, jitterUV).g;
    const jitter = float(0.12).add(jitterSeed.mul(0.76));
    const t = tStart.add(stepSize.mul(jitter)).toVar();
    const transmittance = float(1).toVar();
    const scattered = vec3(0, 0, 0).toVar();

    const sunFacing = clamp(dot(rayDir, uniforms.sunDir), 0, 1);
    const forwardPhase = pow(sunFacing, 5).mul(2.25).add(0.18);

    Loop(RAY_STEPS, () => {
      const pos = rayOrigin.add(rayDir.mul(t));
      const height01 = clamp(
        pos.y.sub(uniforms.cloudBaseY)
          .div(uniforms.cloudTopY.sub(uniforms.cloudBaseY).max(1)),
        0,
        1,
      );

      const weatherUV = vec2(pos.x, pos.z)
        .mul(WEATHER_SCALE)
        .add(uniforms.weatherOffset)
        .fract();
      const weatherSample = texture(weatherTex, weatherUV);
      const coverageThreshold = float(1).sub(uniforms.coverage);
      const coverageMask = smoothstep(
        coverageThreshold.sub(0.14),
        coverageThreshold.add(0.16),
        weatherSample.r,
      );

      const convectiveLocal = mix(float(0.58), float(1.32), weatherSample.g)
        .mul(uniforms.convection);
      const lowerFade = smoothstep(
        float(0.01),
        mix(float(0.105), float(0.040), convectiveLocal),
        height01,
      );
      const topStart = mix(float(0.64), float(0.88), convectiveLocal);
      const upperFade = float(1).sub(smoothstep(topStart, float(0.997), height01));
      const verticalProfile = lowerFade.mul(upperFade);

      const baseShapeUV = pos.mul(TILE_SCALE).add(uniforms.scrollOffset).fract();

      // One extra 3D fetch is enough to bend the coordinates of the main sample.
      // Because the offset itself evolves in three dimensions, billows swell,
      // split and dissolve instead of the whole texture merely sliding sideways.
      const warp = texture3D(
        shapeTex,
        baseShapeUV.add(uniforms.morphOffset).fract(),
      );
      const warpedUV = baseShapeUV
        .add(vec3(
          warp.g.sub(0.5).mul(0.060),
          warp.b.sub(0.5).mul(0.035),
          warp.r.sub(0.5).mul(0.060),
        ))
        .add(uniforms.secondaryMorph.mul(0.14))
        .fract();
      const shape = texture3D(shapeTex, warpedUV);

      const baseThreshold = mix(float(0.62), float(0.41), uniforms.density);
      const broadMass = smoothstep(baseThreshold, baseThreshold.add(0.28), shape.r);
      const erosionAmount = uniforms.erosion
        .mul(mix(float(0.36), float(0.13), uniforms.stormDarken));
      const erodedMass = clamp(
        broadMass
          .sub(shape.g.mul(erosionAmount))
          .add(shape.b.mul(0.09))
          .add(warp.b.mul(0.035)),
        0,
        1,
      );

      const moistureBoost = mix(
        float(0.80),
        float(1.18),
        uniforms.humidity.mul(weatherSample.b),
      );
      const localDensity = erodedMass
        .mul(coverageMask)
        .mul(verticalProfile)
        .mul(moistureBoost)
        .mul(uniforms.density);

      const lightAccum = float(0).toVar();
      Loop(SHADOW_STEPS, ({ i }) => {
        const shadowDist = float(8).mul(float(i).add(1));
        const shadowPos = pos.add(uniforms.sunDir.mul(shadowDist));
        const shadowShape = texture3D(
          shapeTex,
          shadowPos
            .mul(TILE_SCALE)
            .add(uniforms.scrollOffset)
            .add(uniforms.secondaryMorph.mul(0.08))
            .fract(),
        );
        lightAccum.addAssign(shadowShape.r.mul(0.70).add(shadowShape.a.mul(0.30)));
      });
      const selfShadow = exp(lightAccum.mul(-0.40));

      const underside = mix(float(0.50), float(1.0), smoothstep(0.03, 0.62, height01));
      const silverEdge = pow(float(1).sub(erodedMass), 2)
        .mul(forwardPhase)
        .mul(0.42)
        .mul(float(1).sub(uniforms.stormDarken.mul(0.58)));
      const ambientTerm = uniforms.ambientColor.mul(mix(float(0.72), float(1.03), underside));
      const sunTerm = uniforms.sunColor
        .mul(forwardPhase)
        .mul(selfShadow)
        .mul(mix(float(0.80), float(1.22), underside));
      const clearLit = ambientTerm.add(sunTerm).add(uniforms.sunColor.mul(silverEdge));
      const stormLit = mix(clearLit, vec3(0.20, 0.23, 0.29), uniforms.stormDarken.mul(0.84));
      const flash = uniforms.lightningColor
        .mul(uniforms.lightningFlash)
        .mul(mix(float(0.7), float(1.6), localDensity));

      const extinctionScale = mix(float(0.043), float(0.082), uniforms.stormDarken);
      const sampleAlpha = float(1).sub(
        exp(localDensity.mul(stepSize).mul(extinctionScale).negate()),
      );
      scattered.addAssign(stormLit.add(flash).mul(sampleAlpha).mul(transmittance));
      transmittance.mulAssign(float(1).sub(sampleAlpha));
      t.addAssign(stepSize);
    });

    const alpha = float(1).sub(transmittance).mul(signedY.abs());
    return vec4(scattered, alpha);
  })();

  handle.material.needsUpdate = true;
  handle.__riftDynamicShaderInstalled = true;
}

function updateCirrus(handle, dt, camera, sunColor, ambientColor, windX, windZ, storm, underwater) {
  const cirrus = handle?.__riftCirrus;
  if (!cirrus) return;
  cirrus.mesh.visible = !underwater;
  if (underwater) return;

  cirrus.mesh.position.x = camera.position.x;
  cirrus.mesh.position.z = camera.position.z;
  const safeDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
  cirrus.age += safeDt;
  cirrus.offsetX += (windX + 0.30) * safeDt * 0.00033;
  cirrus.offsetY += (windZ + 0.11) * safeDt * 0.00024;

  // Offset and a barely perceptible rotation change the high streaks as they
  // advect, avoiding a static wallpaper look while remaining one cheap plane.
  cirrus.texture.offset.set(
    cirrus.offsetX + Math.sin(cirrus.age * 0.017) * 0.018,
    cirrus.offsetY + Math.cos(cirrus.age * 0.013) * 0.012,
  );
  cirrus.mesh.rotation.z = Math.sin(cirrus.age * 0.006) * 0.045;
  cirrus.material.opacity = THREE.MathUtils.lerp(0.22, 0.05, clamp01(storm));

  const atmosphere = globalThis.__riftSkyAtmosphere;
  const daylightColor = atmosphere?.cloudLight?.isColor
    ? atmosphere.cloudLight.clone()
    : new THREE.Color(0xf7fbff);
  if (!atmosphere && sunColor?.isColor) daylightColor.lerp(sunColor, 0.12);
  if (ambientColor?.isColor) daylightColor.lerp(ambientColor, 0.12);
  cirrus.material.color.copy(daylightColor);
}

export function createVolumetricClouds(scene) {
  const handle = createProceduralClouds(scene);
  if (!handle) return handle;

  handle.material.side = THREE.DoubleSide;
  handle.material.forceSinglePass = true;
  handle.material.opacity = 0.94;
  handle.material.needsUpdate = true;
  handle.__riftCirrus = createCirrusLayer(scene);
  handle.__riftMorphAge = Math.random() * 100;
  installDynamicCloudShader(handle);
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
  installDynamicCloudShader(handle);

  const waterY = LIQUID_LEVEL?.[currentBiome];
  const underwater = Number.isFinite(waterY) && camera.position.y < waterY - 0.15;
  const state = globalThis.__riftProceduralWeatherState;
  const storm = clamp01(state?.stormIntensity ?? rainIntensity);
  const convection = clamp01(state?.convection ?? handle.uniforms.convection.value ?? 0.35);
  const safeDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);

  updateCirrus(
    handle,
    safeDt,
    camera,
    sunColor,
    ambientColor,
    windX,
    windZ,
    storm,
    underwater,
  );

  if (!handle.mesh?.visible || underwater) return;

  const u = handle.uniforms;
  handle.__riftMorphAge += safeDt;
  const age = handle.__riftMorphAge;

  // Fair weather remains visibly populated, but density is deliberately softer
  // than the previous visibility fix. Broader coverage plus ray jitter gives
  // solid-looking cloud bodies without exposing each Low-tier march interval.
  const fairCoverageFloor = THREE.MathUtils.lerp(0.54, 0.76, storm);
  const fairDensityFloor = THREE.MathUtils.lerp(0.47, 0.70, storm);
  const humidityFloor = THREE.MathUtils.lerp(0.55, 0.79, storm);
  const erosionCeiling = THREE.MathUtils.lerp(0.47, 0.29, storm);
  const fairPulse = 1 - smooth01(storm);
  const coveragePulse = (
    Math.sin(age * 0.085) * 0.022 +
    Math.sin(age * 0.031 + 1.8) * 0.016
  ) * fairPulse;
  const densityPulse = (
    Math.sin(age * 0.071 + 0.7) * 0.024 +
    Math.sin(age * 0.023 + 2.4) * 0.014
  ) * fairPulse;

  u.coverage.value = clamp01(Math.max(Number(u.coverage.value) || 0, fairCoverageFloor) + coveragePulse);
  u.density.value = clamp01(Math.max(Number(u.density.value) || 0, fairDensityFloor) + densityPulse);
  u.humidity.value = clamp01(Math.max(Number(u.humidity.value) || 0, humidityFloor));
  u.erosion.value = Math.min(
    Number.isFinite(Number(u.erosion.value)) ? Number(u.erosion.value) : 0.70,
    erosionCeiling,
  );

  // The base updater already performs wind advection. These small non-linear
  // offsets are applied AFTER it, so the 3D cross-section bends and breathes
  // rather than following one rigid translation vector forever.
  u.scrollOffset.value.x += Math.sin(age * 0.057) * 0.034 + Math.sin(age * 0.019) * 0.021;
  u.scrollOffset.value.y += Math.sin(age * 0.043 + 0.8) * (0.018 + convection * 0.018);
  u.scrollOffset.value.z += Math.cos(age * 0.051) * 0.034 + Math.sin(age * 0.017 + 2.0) * 0.020;
  u.weatherOffset.value.x += Math.sin(age * 0.009) * 0.0009;
  u.weatherOffset.value.y += Math.cos(age * 0.011) * 0.0007;

  u.morphOffset.value.set(
    Math.sin(age * 0.031) * 0.105,
    Math.sin(age * 0.023 + 1.7) * 0.075,
    Math.cos(age * 0.027 + 0.5) * 0.105,
  );
  u.secondaryMorph.value.set(
    Math.cos(age * 0.017 + 2.1) * 0.075,
    Math.sin(age * 0.019 + 0.4) * 0.055,
    Math.sin(age * 0.015 + 1.2) * 0.075,
  );
  u.timePhase.value = age;

  // More vertical room keeps cumulus out of the flat horizon strip. Convective
  // weather additionally grows the top in a slow pulse, so towers visibly build
  // before a storm instead of just getting darker.
  const originalBase = Number(u.cloudBaseY.value) || 58;
  const originalTop = Number(u.cloudTopY.value) || 108;
  const visualBase = Math.min(originalBase, THREE.MathUtils.lerp(50, 40, storm));
  const towerPulse = (0.5 + 0.5 * Math.sin(age * 0.038 + 0.9)) * convection * (6 + storm * 14);
  const visualTop = Math.max(
    originalTop,
    THREE.MathUtils.lerp(138, 180, storm) + towerPulse,
  );
  u.cloudBaseY.value = visualBase;
  u.cloudTopY.value = visualTop;
  handle.mesh.position.y = (visualBase + visualTop) * 0.5;
  handle.mesh.scale.y = Math.max(1, (visualTop - visualBase) / 430);

  // Sunrise/sunset colors are authored by dayNightCycle.js and reused here so
  // cloud illumination, the visible Sun and the fallback sky are one atmosphere.
  const atmosphere = globalThis.__riftSkyAtmosphere;
  if (atmosphere) {
    if (atmosphere.cloudLight?.isColor) u.sunColor.value.copy(atmosphere.cloudLight);
    if (atmosphere.cloudShadow?.isColor) {
      u.ambientColor.value.copy(atmosphere.cloudShadow);
      if (atmosphere.skyZenith?.isColor) u.ambientColor.value.lerp(atmosphere.skyZenith, 0.30);
    }
  }

  globalThis.__riftCloudVisibilityState = {
    visible: true,
    coverage: u.coverage.value,
    density: u.density.value,
    humidity: u.humidity.value,
    erosion: u.erosion.value,
    cloudBase: visualBase,
    cloudTop: visualTop,
    weatherType: handle.currentWeatherType,
    morphAge: age,
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
