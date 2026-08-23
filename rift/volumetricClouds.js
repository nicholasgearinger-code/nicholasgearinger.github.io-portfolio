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
// Natural mobile volumetric-cloud presentation layer.
//
// proceduralClouds.js continues to own the weather state, 3D noise volume,
// wind and cloud-occlusion model. This wrapper keeps Low at the same eight
// primary raymarch steps, but improves the way those samples are launched,
// shaped and lit:
//   * a single horizontal launch plane replaces the old box faces, removing
//     vertical/horizon wall artifacts while the cloud density remains fully 3D;
//   * stable weather-texture jitter hides the eight-step shelves;
//   * restrained domain warping changes shape without the melted/blobby look;
//   * Beer-Lambert extinction + a cheap powder term produces softer interiors;
//   * cloud density is allowed to breathe and reform without cumulative UV drift;
//   * thin procedural cirrus remains a separate one-draw high-altitude layer.
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
      const wispy = smooth01((field - 0.51) / 0.20);
      const breakup = smooth01((streak - 0.40) / 0.32);
      const alpha = Math.pow(clamp01(wispy * (0.58 + breakup * 0.42)), 1.55);
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
  texture.repeat.set(1.45, 1.00);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xe9f2fa,
    transparent: true,
    opacity: 0.10,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
  });
  const geometry = new THREE.PlaneGeometry(1900, 1900, 1, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "rift-procedural-cirrus";
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 180;
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

function installNaturalCloudShader(handle) {
  if (!handle?.material || handle.__riftNaturalCloudShaderInstalled) return;

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

    // Stable spatial jitter hides Low's eight discrete intervals without the
    // sparkle that time-randomized noise would cause on a phone display.
    const jitterUV = vec2(positionWorld.x, positionWorld.z)
      .mul(0.0129)
      .add(uniforms.weatherOffset.mul(2.91))
      .fract();
    const jitterSeed = texture(weatherTex, jitterUV).g;
    const jitter = float(0.10).add(jitterSeed.mul(0.80));
    const t = tStart.add(stepSize.mul(jitter)).toVar();
    const transmittance = float(1).toVar();
    const scattered = vec3(0, 0, 0).toVar();

    // A broad forward-scattering lobe gives the characteristic bright side of
    // sunlit cumulus without a costly full phase-function evaluation.
    const sunFacing = clamp(dot(rayDir, uniforms.sunDir), 0, 1);
    const forwardPhase = pow(sunFacing, 4).mul(1.95).add(0.20);

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
        coverageThreshold.sub(0.11),
        coverageThreshold.add(0.15),
        weatherSample.r,
      );

      // Flatter bases, rounder tops. Convection raises the upper fade and narrows
      // the base transition, creating towers without stretching every cloud.
      const convectiveLocal = mix(float(0.52), float(1.22), weatherSample.g)
        .mul(uniforms.convection);
      const lowerFade = smoothstep(
        float(0.012),
        mix(float(0.115), float(0.050), convectiveLocal),
        height01,
      );
      const topStart = mix(float(0.66), float(0.86), convectiveLocal);
      const upperFade = float(1).sub(smoothstep(topStart, float(0.995), height01));
      const verticalProfile = lowerFade.mul(upperFade);

      const baseShapeUV = pos.mul(TILE_SCALE).add(uniforms.scrollOffset).fract();
      const warp = texture3D(
        shapeTex,
        baseShapeUV.add(uniforms.morphOffset).fract(),
      );

      // Restraint matters here. The previous 0.06/0.14 warp was large enough to
      // turn cumulus into stretched liquid blobs. These offsets are intentionally
      // small: enough to make lobes evolve, not enough to reveal the distortion.
      const warpedUV = baseShapeUV
        .add(vec3(
          warp.g.sub(0.5).mul(0.035),
          warp.b.sub(0.5).mul(0.020),
          warp.r.sub(0.5).mul(0.035),
        ))
        .add(uniforms.secondaryMorph.mul(0.08))
        .fract();
      const shape = texture3D(shapeTex, warpedUV);

      const baseThreshold = mix(float(0.65), float(0.43), uniforms.density);
      const broadMass = smoothstep(baseThreshold, baseThreshold.add(0.27), shape.r);
      const erosionAmount = uniforms.erosion
        .mul(mix(float(0.42), float(0.17), uniforms.stormDarken));
      const erodedMass = clamp(
        broadMass
          .sub(shape.g.mul(erosionAmount))
          .add(shape.b.mul(0.05))
          .add(warp.b.mul(0.02)),
        0,
        1,
      );

      const moistureBoost = mix(
        float(0.76),
        float(1.15),
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
            .add(uniforms.secondaryMorph.mul(0.05))
            .fract(),
        );
        lightAccum.addAssign(shadowShape.r.mul(0.72).add(shadowShape.a.mul(0.28)));
      });
      const selfShadow = exp(lightAccum.mul(-0.42));

      // Powder approximation: optically thicker cloud regions receive a little
      // extra diffuse bounce, avoiding gray cardboard interiors with only one
      // sun-shadow sample on Low.
      const powder = float(1).sub(exp(localDensity.mul(-2.4)));
      const underside = mix(float(0.48), float(1.0), smoothstep(0.04, 0.62, height01));
      const silverEdge = pow(float(1).sub(erodedMass), 2)
        .mul(forwardPhase)
        .mul(0.30)
        .mul(float(1).sub(uniforms.stormDarken.mul(0.62)));
      const ambientTerm = uniforms.ambientColor
        .mul(mix(float(0.70), float(1.02), underside))
        .mul(float(0.90).add(powder.mul(0.16)));
      const sunTerm = uniforms.sunColor
        .mul(forwardPhase)
        .mul(selfShadow)
        .mul(mix(float(0.76), float(1.16), underside))
        .mul(float(0.86).add(powder.mul(0.18)));
      const clearLit = ambientTerm.add(sunTerm).add(uniforms.sunColor.mul(silverEdge));
      const stormLit = mix(clearLit, vec3(0.19, 0.22, 0.28), uniforms.stormDarken.mul(0.84));
      const flash = uniforms.lightningColor
        .mul(uniforms.lightningFlash)
        .mul(mix(float(0.7), float(1.55), localDensity));

      const extinctionScale = mix(float(0.040), float(0.078), uniforms.stormDarken);
      const sampleAlpha = float(1).sub(
        exp(localDensity.mul(stepSize).mul(extinctionScale).negate()),
      );
      scattered.addAssign(stormLit.add(flash).mul(sampleAlpha).mul(transmittance));
      transmittance.mulAssign(float(1).sub(sampleAlpha));
      t.addAssign(stepSize);
    });

    // Extremely grazing Low-tier rays are where eight samples become visibly
    // stair-stepped. Fade them naturally into atmospheric haze instead of
    // drawing a serrated stack of cloud slices at the horizon.
    const horizonFade = smoothstep(float(0.018), float(0.095), rayDir.y.abs());
    const alpha = float(1).sub(transmittance)
      .mul(signedY.abs())
      .mul(horizonFade);
    return vec4(scattered, alpha);
  })();

  handle.material.needsUpdate = true;
  handle.__riftNaturalCloudShaderInstalled = true;
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
  cirrus.offsetX += (windX + 0.30) * safeDt * 0.00030;
  cirrus.offsetY += (windZ + 0.11) * safeDt * 0.00022;
  cirrus.texture.offset.set(
    cirrus.offsetX + Math.sin(cirrus.age * 0.011) * 0.010,
    cirrus.offsetY + Math.cos(cirrus.age * 0.009) * 0.008,
  );
  cirrus.mesh.rotation.z = Math.sin(cirrus.age * 0.004) * 0.028;
  cirrus.material.opacity = THREE.MathUtils.lerp(0.10, 0.03, clamp01(storm));

  const atmosphere = globalThis.__riftSkyAtmosphere;
  const daylightColor = atmosphere?.cloudLight?.isColor
    ? atmosphere.cloudLight.clone()
    : new THREE.Color(0xf7fbff);
  if (!atmosphere && sunColor?.isColor) daylightColor.lerp(sunColor, 0.10);
  if (ambientColor?.isColor) daylightColor.lerp(ambientColor, 0.10);
  cirrus.material.color.copy(daylightColor);
}

export function createVolumetricClouds(scene) {
  const handle = createProceduralClouds(scene);
  if (!handle) return handle;

  // The old box was useful during debugging, but its side faces can launch
  // near-horizontal marches that appear as vertical cloud walls. A plane at the
  // cloud base is only the rasterization entry surface; the shader still marches
  // all the way to cloudTopY, so the cloud itself remains a genuine 3D volume.
  if (handle.mesh) {
    handle.mesh.geometry?.dispose();
    handle.mesh.geometry = new THREE.PlaneGeometry(
      handle.quality.boxSize,
      handle.quality.boxSize,
      1,
      1,
    );
    handle.mesh.rotation.set(-Math.PI / 2, 0, 0);
    handle.mesh.scale.set(1, 1, 1);
    handle.mesh.frustumCulled = false;
  }

  handle.material.side = THREE.DoubleSide;
  handle.material.forceSinglePass = true;
  handle.material.opacity = 0.90;
  handle.material.needsUpdate = true;
  handle.__riftCirrus = createCirrusLayer(scene);
  handle.__riftMorphAge = Math.random() * 100;
  installNaturalCloudShader(handle);
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
  installNaturalCloudShader(handle);

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

  // Fair-weather clouds should occupy only part of the sky. Storms naturally
  // raise these floors through the same weather state rather than every day
  // beginning as forced overcast.
  const fairCoverageFloor = THREE.MathUtils.lerp(0.40, 0.68, storm);
  const fairDensityFloor = THREE.MathUtils.lerp(0.36, 0.62, storm);
  const humidityFloor = THREE.MathUtils.lerp(0.50, 0.74, storm);
  const erosionCeiling = THREE.MathUtils.lerp(0.58, 0.34, storm);
  const fairPulse = 1 - smooth01(storm);
  const coveragePulse = (
    Math.sin(age * 0.060) * 0.014 +
    Math.sin(age * 0.021 + 1.8) * 0.009
  ) * fairPulse;
  const densityPulse = (
    Math.sin(age * 0.052 + 0.7) * 0.015 +
    Math.sin(age * 0.018 + 2.4) * 0.008
  ) * fairPulse;

  u.coverage.value = clamp01(Math.max(Number(u.coverage.value) || 0, fairCoverageFloor) + coveragePulse);
  u.density.value = clamp01(Math.max(Number(u.density.value) || 0, fairDensityFloor) + densityPulse);
  u.humidity.value = clamp01(Math.max(Number(u.humidity.value) || 0, humidityFloor));
  u.erosion.value = Math.min(
    Number.isFinite(Number(u.erosion.value)) ? Number(u.erosion.value) : 0.70,
    erosionCeiling,
  );

  // Shape evolution lives only in these bounded morph offsets. The previous
  // implementation repeatedly ADDED sine offsets into scrollOffset every frame,
  // which accumulated into large unintended distortion over time. Wind advection
  // remains entirely owned by proceduralClouds.js and never accumulates a wobble.
  u.morphOffset.value.set(
    Math.sin(age * 0.026) * 0.065,
    Math.sin(age * 0.019 + 1.7) * 0.045,
    Math.cos(age * 0.023 + 0.5) * 0.065,
  );
  u.secondaryMorph.value.set(
    Math.cos(age * 0.014 + 2.1) * 0.050,
    Math.sin(age * 0.016 + 0.4) * 0.035,
    Math.sin(age * 0.013 + 1.2) * 0.050,
  );
  u.timePhase.value = age;

  // More modest vertical growth. Scattered cumulus keeps a plausible 70-ish unit
  // thickness; only real convection/storm state grows tall towers.
  const originalBase = Number(u.cloudBaseY.value) || 58;
  const originalTop = Number(u.cloudTopY.value) || 108;
  const visualBase = Math.min(originalBase, THREE.MathUtils.lerp(54, 42, storm));
  const towerPulse = (0.5 + 0.5 * Math.sin(age * 0.028 + 0.9))
    * convection
    * (4 + storm * 10);
  const visualTop = Math.max(
    originalTop,
    THREE.MathUtils.lerp(126, 170, storm) + towerPulse,
  );
  u.cloudBaseY.value = visualBase;
  u.cloudTopY.value = visualTop;

  // Keep the launch plane exactly at the cloud base. It follows the camera in X/Z
  // through the base updater but no longer has box thickness or side faces.
  handle.mesh.position.y = visualBase;
  handle.mesh.rotation.set(-Math.PI / 2, 0, 0);
  handle.mesh.scale.set(1, 1, 1);

  // Sunrise/sunset colors are authored by dayNightCycle.js and reused here so
  // cloud illumination, Sun glare and atmospheric horizon remain coherent.
  const atmosphere = globalThis.__riftSkyAtmosphere;
  if (atmosphere) {
    if (atmosphere.cloudLight?.isColor) u.sunColor.value.copy(atmosphere.cloudLight);
    if (atmosphere.cloudShadow?.isColor) {
      u.ambientColor.value.copy(atmosphere.cloudShadow);
      if (atmosphere.skyZenith?.isColor) u.ambientColor.value.lerp(atmosphere.skyZenith, 0.28);
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
    launchSurface: "plane",
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
