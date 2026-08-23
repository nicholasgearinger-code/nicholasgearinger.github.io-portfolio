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
import { getGraphicsTier } from "./graphicsSettings.js";
import { LIQUID_LEVEL } from "./terrain.js";

// -----------------------------------------------------------------------------
// Unified procedural cloud atmosphere.
//
// One system now owns visible cloud density, wind advection, storm growth,
// self-shadowing, day/night color response, lightning illumination and the
// coarse cloud-occlusion value consumed by the existing sun/water/caustic code.
// The old sprite layer / cloud sheet / panorama cloud dome are kept only as API
// compatibility shims in clouds.js and no longer draw cloud geometry.
//
// Mobile strategy:
//   Low    : 8 view samples, 1 sun sample, 32^3 shape volume
//   Medium : 12 view samples, 2 sun samples, 40^3 shape volume
//   High   : 18 view samples, 3 sun samples, 48^3 shape volume
//
// Density textures are generated once on the CPU, then the GPU only scrolls and
// lights them. There is no per-frame cloud texture generation and no extra scene
// render pass.
// -----------------------------------------------------------------------------

const QUALITY = {
  low: {
    volumeSize: 32,
    weatherSize: 96,
    raySteps: 8,
    shadowSteps: 1,
    tileScale: 0.00255,
    weatherScale: 0.00175,
    maxRayDistance: 390,
    boxSize: 1900,
  },
  medium: {
    volumeSize: 40,
    weatherSize: 128,
    raySteps: 12,
    shadowSteps: 2,
    tileScale: 0.00225,
    weatherScale: 0.00155,
    maxRayDistance: 480,
    boxSize: 2400,
  },
  high: {
    volumeSize: 48,
    weatherSize: 160,
    raySteps: 18,
    shadowSteps: 3,
    tileScale: 0.00195,
    weatherScale: 0.00135,
    maxRayDistance: 620,
    boxSize: 3000,
  },
};

function clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function smooth01(v) {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
}

function fract(v) {
  return v - Math.floor(v);
}

function hash3(x, y, z, seed = 0) {
  let h = (
    Math.imul((x + seed * 31) | 0, 374761393) +
    Math.imul((y + seed * 47) | 0, 668265263) +
    Math.imul((z + seed * 61) | 0, 1442695041)
  ) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function hash2(x, y, seed = 0) {
  return hash3(x, y, seed * 17 + 7, seed);
}

function smoother(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function valueNoise2D(cells, x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smoother(x - xi);
  const yf = smoother(y - yi);
  const wrap = (n) => ((n % cells) + cells) % cells;
  const a = hash2(wrap(xi), wrap(yi), seed);
  const b = hash2(wrap(xi + 1), wrap(yi), seed);
  const c = hash2(wrap(xi), wrap(yi + 1), seed);
  const d = hash2(wrap(xi + 1), wrap(yi + 1), seed);
  return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
}

function valueNoise3D(size, frequency, x, y, z, seed) {
  const scale = frequency / size;
  const px = x * scale;
  const py = y * scale;
  const pz = z * scale;
  const xi = Math.floor(px);
  const yi = Math.floor(py);
  const zi = Math.floor(pz);
  const xf = smoother(px - xi);
  const yf = smoother(py - yi);
  const zf = smoother(pz - zi);
  const wrap = (n) => ((n % frequency) + frequency) % frequency;
  const h = (xx, yy, zz) => hash3(wrap(xx), wrap(yy), wrap(zz), seed);

  const c000 = h(xi, yi, zi);
  const c100 = h(xi + 1, yi, zi);
  const c010 = h(xi, yi + 1, zi);
  const c110 = h(xi + 1, yi + 1, zi);
  const c001 = h(xi, yi, zi + 1);
  const c101 = h(xi + 1, yi, zi + 1);
  const c011 = h(xi, yi + 1, zi + 1);
  const c111 = h(xi + 1, yi + 1, zi + 1);

  const x00 = lerp(c000, c100, xf);
  const x10 = lerp(c010, c110, xf);
  const x01 = lerp(c001, c101, xf);
  const x11 = lerp(c011, c111, xf);
  const y0 = lerp(x00, x10, yf);
  const y1 = lerp(x01, x11, yf);
  return lerp(y0, y1, zf);
}

function worleyNoise3D(size, cells, x, y, z, seed) {
  const scale = cells / size;
  const px = x * scale;
  const py = y * scale;
  const pz = z * scale;
  const xi = Math.floor(px);
  const yi = Math.floor(py);
  const zi = Math.floor(pz);
  let minDist = 999;

  for (let oz = -1; oz <= 1; oz++) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = ((xi + ox) % cells + cells) % cells;
        const cy = ((yi + oy) % cells + cells) % cells;
        const cz = ((zi + oz) % cells + cells) % cells;
        const fx = hash3(cx, cy, cz, seed + 1);
        const fy = hash3(cx, cy, cz, seed + 7);
        const fz = hash3(cx, cy, cz, seed + 13);
        const dx = xi + ox + fx - px;
        const dy = yi + oy + fy - py;
        const dz = zi + oz + fz - pz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < minDist) minDist = d;
      }
    }
  }
  return Math.min(1, minDist);
}

function buildShapeTexture(size) {
  // RGBA packs four useful channels into one 3D fetch:
  // R = broad billowy mass, G = erosion, B = fine breakup, A = secondary mass.
  const data = new Uint8Array(size * size * size * 4);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const broad = 1 - worleyNoise3D(size, 3, x, y, z, 3);
        const mid = 1 - worleyNoise3D(size, 7, x, y, z, 11);
        const fineCell = 1 - worleyNoise3D(size, 12, x, y, z, 19);

        let fbm = 0;
        let amp = 0.56;
        let totalAmp = 0;
        const freqs = [4, 8, 16];
        for (let o = 0; o < freqs.length; o++) {
          // Skip octaves that exceed a tiny Low texture's safe tile frequency.
          const freq = Math.min(freqs[o], size / 2);
          fbm += valueNoise3D(size, freq, x, y, z, 31 + o) * amp;
          totalAmp += amp;
          amp *= 0.5;
        }
        fbm /= Math.max(0.001, totalAmp);

        const mass = clamp01(broad * 0.56 + mid * 0.24 + fbm * 0.20);
        const erosion = clamp01((1 - mid) * 0.52 + (1 - fineCell) * 0.30 + (1 - fbm) * 0.18);
        const detail = clamp01(fineCell * 0.58 + fbm * 0.42);
        const secondary = clamp01(broad * 0.72 + fbm * 0.28);

        const i = (x + y * size + z * size * size) * 4;
        data[i] = Math.round(mass * 255);
        data[i + 1] = Math.round(erosion * 255);
        data[i + 2] = Math.round(detail * 255);
        data[i + 3] = Math.round(secondary * 255);
      }
    }
  }

  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.wrapR = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function buildWeatherTexture(size) {
  const data = new Uint8Array(size * size * 4);
  const cellsA = 8;
  const cellsB = 16;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ax = x / size * cellsA;
      const ay = y / size * cellsA;
      const bx = x / size * cellsB;
      const by = y / size * cellsB;
      const n0 = valueNoise2D(cellsA, ax, ay, 51);
      const n1 = valueNoise2D(cellsB, bx, by, 73);
      const n2 = valueNoise2D(cellsA, ax + 2.7, ay - 1.8, 97);
      const coverage = clamp01(n0 * 0.62 + n1 * 0.24 + n2 * 0.14);
      const convection = clamp01(n1 * 0.55 + n2 * 0.45);
      const moisture = clamp01(n0 * 0.48 + n2 * 0.52);
      const i = (x + y * size) * 4;
      data[i] = Math.round(coverage * 255);
      data[i + 1] = Math.round(convection * 255);
      data[i + 2] = Math.round(moisture * 255);
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return { texture: tex, data, size };
}

function sampleWeatherCPU(handle, worldX, worldZ) {
  const size = handle.weatherSize;
  const u = fract(worldX * handle.quality.weatherScale + handle.weatherOffsetX);
  const v = fract(worldZ * handle.quality.weatherScale + handle.weatherOffsetZ);
  const x = Math.floor(u * size) % size;
  const y = Math.floor(v * size) % size;
  const i = (x + y * size) * 4;
  return {
    coverage: handle.weatherData[i] / 255,
    convection: handle.weatherData[i + 1] / 255,
    moisture: handle.weatherData[i + 2] / 255,
  };
}

function weatherStateOrFallback(rainIntensity, currentBiome) {
  const state = globalThis.__riftProceduralWeatherState;
  if (state && (!currentBiome || state.biome === currentBiome)) return state;
  const rain = clamp01(rainIntensity);
  return {
    biome: currentBiome || "default",
    cloudCoverage: THREE.MathUtils.lerp(0.34, 0.93, rain),
    cloudDensity: THREE.MathUtils.lerp(0.52, 0.91, rain),
    humidity: THREE.MathUtils.lerp(0.48, 0.96, rain),
    convection: THREE.MathUtils.lerp(0.30, 0.92, rain),
    stormIntensity: rain,
    precipitation: rain,
    cloudBase: THREE.MathUtils.lerp(62, 42, rain),
    cloudTop: THREE.MathUtils.lerp(102, 168, rain),
    erosion: THREE.MathUtils.lerp(0.72, 0.34, rain),
  };
}

export function createVolumetricClouds(scene) {
  const tier = getGraphicsTier();
  const quality = QUALITY[tier] || QUALITY.medium;
  const shapeTexture = buildShapeTexture(quality.volumeSize);
  const weather = buildWeatherTexture(quality.weatherSize);

  const uniforms = {
    sunDir: uniform(new THREE.Vector3(0.35, 0.82, 0.25).normalize()),
    sunColor: uniform(new THREE.Color(0xfff1d0)),
    ambientColor: uniform(new THREE.Color(0x8aa5ba)),
    lightningFlash: uniform(0),
    lightningColor: uniform(new THREE.Color(0xeaf8ff)),
    scrollOffset: uniform(new THREE.Vector3()),
    weatherOffset: uniform(new THREE.Vector2()),
    coverage: uniform(0.36),
    density: uniform(0.56),
    humidity: uniform(0.50),
    convection: uniform(0.32),
    erosion: uniform(0.70),
    stormDarken: uniform(0),
    cloudBaseY: uniform(58),
    cloudTopY: uniform(108),
  };

  const RAY_STEPS = quality.raySteps;
  const SHADOW_STEPS = quality.shadowSteps;
  const TILE_SCALE = float(quality.tileScale);
  const WEATHER_SCALE = float(quality.weatherScale);
  const MAX_DISTANCE = float(quality.maxRayDistance);
  const shapeTex = shapeTexture;
  const weatherTex = weather.texture;

  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.BackSide;
  material.fog = false;

  material.colorNode = Fn(() => {
    const rayOrigin = cameraPosition;
    const rayDir = normalize(positionWorld.sub(cameraPosition));

    // Horizontal cloud slab intersection.
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
    const t = tStart.add(stepSize.mul(0.5)).toVar();
    const transmittance = float(1).toVar();
    const scattered = vec3(0, 0, 0).toVar();

    // Mie-like forward lobe plus a broad base term. This gives silver linings
    // without another expensive phase-function implementation.
    const sunFacing = clamp(dot(rayDir, uniforms.sunDir), 0, 1);
    const forwardPhase = pow(sunFacing, 5).mul(2.4).add(0.16);

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

      // Coverage is a true large-scale weather mask, not a multiplier over the
      // entire sky. Increasing coverage grows cloud regions into surrounding
      // clear space, so storms visibly build instead of simply darkening.
      const coverageThreshold = float(1).sub(uniforms.coverage);
      const coverageMask = smoothstep(
        coverageThreshold.sub(0.10),
        coverageThreshold.add(0.13),
        weatherSample.r,
      );

      const convectiveLocal = mix(float(0.55), float(1.28), weatherSample.g)
        .mul(uniforms.convection);
      const lowerFade = smoothstep(float(0.015), mix(float(0.13), float(0.055), convectiveLocal), height01);
      const topStart = mix(float(0.68), float(0.86), convectiveLocal);
      const upperFade = float(1).sub(smoothstep(topStart, float(0.995), height01));
      const verticalProfile = lowerFade.mul(upperFade);

      const shapeUV = pos.mul(TILE_SCALE).add(uniforms.scrollOffset).fract();
      const shape = texture3D(shapeTex, shapeUV);
      const baseThreshold = mix(float(0.66), float(0.40), uniforms.density);
      const broadMass = smoothstep(baseThreshold, baseThreshold.add(0.27), shape.r);

      // Edge erosion is strong in fair weather and retreats during storms. This
      // is what changes cottony broken cumulus into denser connected overcast.
      const erosionAmount = uniforms.erosion
        .mul(mix(float(0.42), float(0.16), uniforms.stormDarken));
      const erodedMass = clamp(
        broadMass.sub(shape.g.mul(erosionAmount)).add(shape.b.mul(0.07)),
        0,
        1,
      );
      const moistureBoost = mix(float(0.76), float(1.20), uniforms.humidity.mul(weatherSample.b));
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
          shadowPos.mul(TILE_SCALE).add(uniforms.scrollOffset).fract(),
        );
        lightAccum.addAssign(shadowShape.r.mul(0.72).add(shadowShape.a.mul(0.28)));
      });
      const selfShadow = exp(lightAccum.mul(-0.42));

      const underside = mix(float(0.53), float(1.0), smoothstep(0.04, 0.60, height01));
      const silverEdge = pow(float(1).sub(erodedMass), 2)
        .mul(forwardPhase)
        .mul(0.48)
        .mul(float(1).sub(uniforms.stormDarken.mul(0.55)));
      const ambientTerm = uniforms.ambientColor.mul(mix(float(0.72), float(1.05), underside));
      const sunTerm = uniforms.sunColor
        .mul(forwardPhase)
        .mul(selfShadow)
        .mul(mix(float(0.82), float(1.22), underside));
      const clearLit = ambientTerm.add(sunTerm).add(uniforms.sunColor.mul(silverEdge));
      const stormLit = mix(clearLit, vec3(0.22, 0.25, 0.31), uniforms.stormDarken.mul(0.82));
      const flash = uniforms.lightningColor
        .mul(uniforms.lightningFlash)
        .mul(mix(float(0.7), float(1.6), localDensity));

      const extinctionScale = mix(float(0.050), float(0.088), uniforms.stormDarken);
      const sampleAlpha = float(1).sub(exp(localDensity.mul(stepSize).mul(extinctionScale).negate()));
      scattered.addAssign(stormLit.add(flash).mul(sampleAlpha).mul(transmittance));
      transmittance.mulAssign(float(1).sub(sampleAlpha));
      t.addAssign(stepSize);
    });

    // signedY is intentionally referenced so the node graph keeps the safe-y
    // branch live on WebGPU compilers that aggressively prune unused guards.
    const alpha = float(1).sub(transmittance).mul(signedY.abs());
    return vec4(scattered, alpha);
  })();

  const geometry = new THREE.BoxGeometry(
    quality.boxSize,
    430,
    quality.boxSize,
    1,
    1,
    1,
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "rift-procedural-cloud-volume";
  mesh.renderOrder = -88;
  mesh.frustumCulled = false;
  scene.add(mesh);

  const handle = {
    scene,
    mesh,
    material,
    uniforms,
    shapeTexture,
    weatherTexture: weather.texture,
    weatherData: weather.data,
    weatherSize: weather.size,
    quality,
    weatherOffsetX: 0,
    weatherOffsetZ: 0,
    scrollX: 0,
    scrollY: 0,
    scrollZ: 0,
    evolution: 0,
    cloudOcclusion: 0,
    currentWeatherType: "scattered",
  };

  globalThis.__riftProceduralCloudHandle = handle;
  globalThis.__riftProceduralCloudOcclusion = 0;
  console.info(`[clouds] unified procedural atmosphere active (${tier}, ${quality.raySteps}x${quality.shadowSteps})`);
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
  if (!handle || !camera) return;

  const waterY = LIQUID_LEVEL?.[currentBiome];
  const underwater = Number.isFinite(waterY) && camera.position.y < waterY - 0.15;
  handle.mesh.visible = !underwater;
  if (underwater) {
    handle.cloudOcclusion *= 0.92;
    globalThis.__riftProceduralCloudOcclusion = handle.cloudOcclusion;
    return;
  }

  const state = weatherStateOrFallback(rainIntensity, currentBiome);
  const storm = clamp01(state.stormIntensity ?? rainIntensity);
  const coverage = clamp01(state.cloudCoverage ?? 0.36);
  const density = clamp01(state.cloudDensity ?? 0.56);
  const humidity = clamp01(state.humidity ?? 0.50);
  const convection = clamp01(state.convection ?? 0.32);
  const erosion = clamp01(state.erosion ?? 0.70);
  const cloudBase = Number.isFinite(state.cloudBase) ? state.cloudBase : 58;
  const cloudTop = Math.max(cloudBase + 18, Number.isFinite(state.cloudTop) ? state.cloudTop : 108);
  handle.currentWeatherType = state.weatherType || "scattered";

  // The box follows X/Z only. Cloud altitude is world-space, so climbing a hill
  // really moves the player closer to the cloud base instead of dragging the
  // atmosphere upward with them.
  handle.mesh.position.x = camera.position.x;
  handle.mesh.position.z = camera.position.z;
  handle.mesh.position.y = (cloudBase + cloudTop) * 0.5;
  handle.mesh.scale.y = Math.max(1, (cloudTop - cloudBase) / 430);

  handle.uniforms.cloudBaseY.value = cloudBase;
  handle.uniforms.cloudTopY.value = cloudTop;
  handle.uniforms.coverage.value = coverage;
  handle.uniforms.density.value = density;
  handle.uniforms.humidity.value = humidity;
  handle.uniforms.convection.value = convection;
  handle.uniforms.erosion.value = erosion;
  handle.uniforms.stormDarken.value = storm;
  if (sunDirection?.isVector3) handle.uniforms.sunDir.value.copy(sunDirection).normalize();
  if (sunColor?.isColor) handle.uniforms.sunColor.value.copy(sunColor);
  if (ambientColor?.isColor) handle.uniforms.ambientColor.value.copy(ambientColor);
  handle.uniforms.lightningFlash.value = clamp01(lightningFlash);
  if (lightningColor?.isColor) handle.uniforms.lightningColor.value.copy(lightningColor);

  const safeDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
  // Advect both scales with the same wind, but at different rates. A tiny Y
  // evolution makes masses boil/grow rather than looking like a texture sliding
  // rigidly across the sky.
  handle.scrollX += (windX + 0.42) * safeDt * 0.00072;
  handle.scrollZ += (windZ + 0.16) * safeDt * 0.00072;
  handle.evolution += safeDt * (0.00055 + convection * 0.0011);
  handle.scrollY = Math.sin(handle.evolution * 7.0) * 0.012 + handle.evolution;
  handle.weatherOffsetX += (windX + 0.22) * safeDt * 0.00010;
  handle.weatherOffsetZ += (windZ + 0.08) * safeDt * 0.00010;
  handle.uniforms.scrollOffset.value.set(handle.scrollX, handle.scrollY, handle.scrollZ);
  handle.uniforms.weatherOffset.value.set(handle.weatherOffsetX, handle.weatherOffsetZ);

  // CPU-side shadow/occlusion approximation samples the SAME large-scale
  // weather map as the renderer. This lets the existing world-lighting/water
  // code react to a cloud passing overhead without rendering clouds into a
  // shadow map.
  let projectedX = camera.position.x;
  let projectedZ = camera.position.z;
  if (sunDirection?.isVector3 && Math.abs(sunDirection.y) > 0.08) {
    const midCloudY = (cloudBase + cloudTop) * 0.5;
    const rise = Math.max(0, midCloudY - camera.position.y);
    const along = rise / Math.max(0.08, Math.abs(sunDirection.y));
    projectedX += sunDirection.x * along;
    projectedZ += sunDirection.z * along;
  }
  const localWeather = sampleWeatherCPU(handle, projectedX, projectedZ);
  const threshold = 1 - coverage;
  const weatherMask = smooth01((localWeather.coverage - (threshold - 0.10)) / 0.23);
  const densityMask = clamp01(density * (0.70 + humidity * 0.30));
  const targetOcclusion = clamp01(
    weatherMask * densityMask * THREE.MathUtils.lerp(0.56, 0.91, storm),
  );
  const response = 1 - Math.exp(-safeDt * (storm > 0.4 ? 3.6 : 2.0));
  handle.cloudOcclusion = THREE.MathUtils.lerp(handle.cloudOcclusion, targetOcclusion, response);
  globalThis.__riftProceduralCloudOcclusion = handle.cloudOcclusion;
  globalThis.__riftProceduralCloudWeatherSample = {
    ...localWeather,
    occlusion: handle.cloudOcclusion,
    weatherType: handle.currentWeatherType,
    coverage,
    storm,
  };
}

export function disposeVolumetricClouds(handle) {
  if (!handle) return;
  handle.scene?.remove(handle.mesh);
  handle.mesh?.geometry?.dispose();
  handle.material?.dispose();
  handle.shapeTexture?.dispose();
  handle.weatherTexture?.dispose();
  if (globalThis.__riftProceduralCloudHandle === handle) {
    delete globalThis.__riftProceduralCloudHandle;
    globalThis.__riftProceduralCloudOcclusion = 0;
  }
}
