import * as THREE from "three";
import {
  Fn, uniform, color, float, uint, vec2, vec3,
  positionLocal, positionView, positionWorld, cameraPosition,
  attribute, floor, min, max, abs, dFdx, dFdy, cross, dot, pow, mix, clamp,
  smoothstep,
} from "three/tsl";
import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  updateGPUFFTOceanRipples as updateBaseRipples,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean_v7.js";
import {
  createOceanFFTCascade,
  updateOceanFFTCascade,
  disposeOceanFFTCascade,
} from "./ocean_fft_cascade.js";
import {
  createPersistentOceanFoam,
  updatePersistentOceanFoam,
  disposePersistentOceanFoam,
} from "./ocean_foam_field.js";

const MICRO_N = 64;
const MICRO_DOMAIN = 72;
const TOUCH_DEVICE = typeof window !== "undefined" && (
  "ontouchstart" in window || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
);

function positiveFract(v) {
  return ((v % 1) + 1) % 1;
}

function smoothWeight(t) {
  return t.mul(t).mul(float(3).sub(t.mul(2)));
}

function sampleWrapVec4(buffer, coord, N) {
  const row = uint(N);
  const x0Raw = floor(coord.x);
  const z0Raw = floor(coord.y);
  const x0 = x0Raw.toUint().mod(row);
  const z0 = z0Raw.toUint().mod(row);
  const x1 = x0.add(uint(1)).mod(row);
  const z1 = z0.add(uint(1)).mod(row);
  const tx = smoothWeight(coord.x.sub(x0Raw));
  const tz = smoothWeight(coord.y.sub(z0Raw));
  const i00 = z0.mul(row).add(x0);
  const i10 = z0.mul(row).add(x1);
  const i01 = z1.mul(row).add(x0);
  const i11 = z1.mul(row).add(x1);
  return mix(
    mix(buffer.element(i00), buffer.element(i10), tx),
    mix(buffer.element(i01), buffer.element(i11), tx),
    tz,
  );
}

function sampleWrapScalar(buffer, coord, N, component = "x") {
  const row = uint(N);
  const x0Raw = floor(coord.x);
  const z0Raw = floor(coord.y);
  const x0 = x0Raw.toUint().mod(row);
  const z0 = z0Raw.toUint().mod(row);
  const x1 = x0.add(uint(1)).mod(row);
  const z1 = z0.add(uint(1)).mod(row);
  const tx = smoothWeight(coord.x.sub(x0Raw));
  const tz = smoothWeight(coord.y.sub(z0Raw));
  const i00 = z0.mul(row).add(x0);
  const i10 = z0.mul(row).add(x1);
  const i01 = z1.mul(row).add(x0);
  const i11 = z1.mul(row).add(x1);
  return mix(
    mix(buffer.element(i00)[component], buffer.element(i10)[component], tx),
    mix(buffer.element(i01)[component], buffer.element(i11)[component], tx),
    tz,
  );
}

function sampleClampVec4(buffer, coord, N) {
  const x0 = floor(coord.x);
  const z0 = floor(coord.y);
  const x1 = min(x0.add(1), float(N - 1));
  const z1 = min(z0.add(1), float(N - 1));
  const tx = smoothWeight(coord.x.sub(x0));
  const tz = smoothWeight(coord.y.sub(z0));
  const row = uint(N);
  const i00 = z0.toUint().mul(row).add(x0.toUint());
  const i10 = z0.toUint().mul(row).add(x1.toUint());
  const i01 = z1.toUint().mul(row).add(x0.toUint());
  const i11 = z1.toUint().mul(row).add(x1.toUint());
  return mix(
    mix(buffer.element(i00), buffer.element(i10), tx),
    mix(buffer.element(i01), buffer.element(i11), tx),
    tz,
  );
}

function addMicroCoordinates(handle) {
  const geometry = handle?.mesh?.geometry;
  const pos = geometry?.getAttribute?.("position");
  if (!geometry || !pos || geometry.getAttribute("fftCoordMicro")) return;
  const coords = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    coords[i * 2] = positiveFract(pos.getX(i) / MICRO_DOMAIN + 0.5) * MICRO_N;
    coords[i * 2 + 1] = positiveFract(pos.getZ(i) / MICRO_DOMAIN + 0.5) * MICRO_N;
  }
  geometry.setAttribute("fftCoordMicro", new THREE.Float32BufferAttribute(coords, 2));
}

function installThreeScaleDisplacement(handle) {
  if (!handle?.gpuFFT || !handle.fftMicroHandle?.gpuFFTStandalone || handle.fftThreeScaleGeometryInstalled) return;
  const material = handle.mesh?.material;
  const geometry = handle.mesh?.geometry;
  const shallow = handle.fftShallowHandle;
  const detail = handle.fftDetailHandle;
  if (!material || !geometry || !shallow?.gpuShallowWater || !detail?.gpuFFT) return;

  addMicroCoordinates(handle);
  if (!geometry.getAttribute("fftCoordMicro")) return;

  const longA = handle.resources?.[8];
  const longB = handle.resources?.[9];
  const detailA = detail.resources?.[8];
  const detailB = detail.resources?.[9];
  const microA = handle.fftMicroHandle.spatialA;
  const microB = handle.fftMicroHandle.spatialB;
  if (!longA || !longB || !detailA || !detailB || !microA || !microB) return;

  const longCoord = attribute("fftCoordLong", "vec2");
  const detailCoord = attribute("fftCoordDetail", "vec2");
  const microCoord = attribute("fftCoordMicro", "vec2");
  const shallowCoord = attribute("shallowCoord", "vec2");
  const coverage = attribute("shallowCoverage", "float");
  const shore = attribute("fftShoreDense", "float");
  const depth = attribute("fftDepthWorld", "float");
  const shallowState = shallow.state;
  const shallowN = shallow.N ?? 256;

  material.positionNode = Fn(() => {
    const la = sampleWrapVec4(longA, longCoord, 128);
    const ldz = sampleWrapScalar(longB, longCoord, 128, "x");
    const da = sampleWrapVec4(detailA, detailCoord, 128);
    const ddz = sampleWrapScalar(detailB, detailCoord, 128, "x");
    const ma = sampleWrapVec4(microA, microCoord, MICRO_N);
    const mdz = sampleWrapScalar(microB, microCoord, MICRO_N, "x");
    const s = sampleClampVec4(shallowState, shallowCoord, shallowN);

    const longAmp = smoothstep(float(2.4), float(11.0), depth);
    const detailAmp = smoothstep(float(5.0), float(15.0), depth);
    const microAmp = smoothstep(float(3.0), float(9.0), depth);
    const shallowBlend = float(1).sub(smoothstep(float(6.0), float(14.0), depth)).mul(coverage);

    const fftX = la.z.mul(longAmp).mul(0.40)
      .add(da.z.mul(detailAmp).mul(0.15))
      .add(ma.z.mul(microAmp).mul(0.055));
    const fftY = la.x.mul(longAmp).mul(1.02)
      .add(da.x.mul(detailAmp).mul(0.47))
      .add(ma.x.mul(microAmp).mul(0.20));
    const fftZ = ldz.mul(longAmp).mul(0.40)
      .add(ddz.mul(detailAmp).mul(0.15))
      .add(mdz.mul(microAmp).mul(0.055));

    const horizontalFade = float(1).sub(shallowBlend.mul(0.985));
    const yDisp = mix(fftY, s.x, shallowBlend);
    return positionLocal.add(vec3(
      fftX.mul(shore).mul(horizontalFade),
      yDisp.mul(shore),
      fftZ.mul(shore).mul(horizontalFade),
    ));
  })();

  material.normalNode = Fn(() => cross(dFdx(positionView), dFdy(positionView)).normalize())();
  material.needsUpdate = true;
  handle.fftThreeScaleGeometryInstalled = true;
}

function installWaterProStyleOptics(handle) {
  if (!handle?.gpuFFT || !handle.fftPersistentFoam?.gpuOceanFoam || handle.fftV8OpticsInstalled) return;
  const material = handle.fftPhysicalMaterial ?? handle.mesh?.material;
  if (!material || !handle.mesh?.geometry?.getAttribute?.("fftCoordMicro")) return;

  const micro = handle.fftMicroHandle;
  const foamField = handle.fftPersistentFoam;
  const coord = attribute("fftCoordMicro", "vec2");
  const depth = attribute("fftDepthWorld", "float");
  const spacing = MICRO_DOMAIN / MICRO_N;
  const originalColor = material.colorNode ?? uniform(color(0x2f7478));
  const originalRoughness = material.roughnessNode ?? float(0.045);
  const originalEmissive = material.emissiveNode ?? uniform(color(0x000000));
  const lightDirection = handle.fftLightDirection ?? uniform(new THREE.Vector3(0.35, 0.8, 0.3));
  const daylight = handle.fftDaylight ?? uniform(1.0);
  const underwaterMix = handle.fftUnderwaterMix ?? uniform(0.0);
  const foamColor = handle.fftFoamColor ?? uniform(color(0xfafcf8));
  const waterLevel = uniform(handle.waterY ?? 0);
  const skyTint = uniform(color(0x7fb8d6));
  const sunTint = uniform(color(0xffe6bb));
  const crestTransmission = uniform(color(0xa8eadb));
  const stormLevel = uniform(0.0);

  const hL = sampleWrapScalar(micro.spatialA, coord.add(vec2(-1, 0)), MICRO_N, "x");
  const hR = sampleWrapScalar(micro.spatialA, coord.add(vec2(1, 0)), MICRO_N, "x");
  const hD = sampleWrapScalar(micro.spatialA, coord.add(vec2(0, -1)), MICRO_N, "x");
  const hU = sampleWrapScalar(micro.spatialA, coord.add(vec2(0, 1)), MICRO_N, "x");
  const dhdx = hR.sub(hL).mul(float(1 / (2 * spacing)));
  const dhdz = hU.sub(hD).mul(float(1 / (2 * spacing)));
  const microSlope = clamp(abs(dhdx).add(abs(dhdz)).mul(0.86), 0, 1);

  const geometricWorldNormal = Fn(() => cross(dFdx(positionWorld), dFdy(positionWorld)).normalize())();
  const opticalNormal = vec3(
    geometricWorldNormal.x.sub(dhdx.mul(0.28)),
    geometricWorldNormal.y,
    geometricWorldNormal.z.sub(dhdz.mul(0.28)),
  ).normalize();
  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const ndv = clamp(abs(dot(opticalNormal, viewDir)), 0, 1);
  const fresnel = float(0.02037).add(float(0.97963).mul(pow(float(1).sub(ndv), float(5))));

  const lightDir = lightDirection.normalize();
  const halfDir = lightDir.add(viewDir).normalize();
  const ndh = clamp(dot(opticalNormal, halfDir), 0, 1);
  const tightGlitter = pow(ndh, float(176))
    .mul(float(0.40).add(microSlope.mul(1.25)))
    .mul(daylight)
    .mul(float(1).sub(stormLevel.mul(0.62)));
  const broadSheen = pow(ndh, float(28))
    .mul(0.12)
    .mul(daylight)
    .mul(float(1).sub(stormLevel.mul(0.35)));
  const glitter = tightGlitter.add(broadSheen).mul(float(1).sub(underwaterMix));

  const persistentFoam = sampleWrapScalar(foamField.foam, coord, MICRO_N, "x")
    .mul(float(1).sub(smoothstep(float(0.0), float(4.5), depth).mul(0.12)))
    .mul(float(1).sub(underwaterMix));
  const nearShore = float(1).sub(smoothstep(float(2.4), float(11.0), depth));
  const crest = smoothstep(waterLevel.add(0.10), waterLevel.add(1.45), positionWorld.y)
    .mul(float(1).sub(underwaterMix));
  const backLight = float(1).sub(clamp(dot(opticalNormal, lightDir), 0, 1));
  const transmitted = backLight.mul(crest).mul(daylight).mul(float(1).sub(stormLevel.mul(0.55)));

  material.colorNode = Fn(() => {
    const reflectedBody = mix(
      originalColor,
      skyTint,
      clamp(fresnel.mul(float(0.10).add(daylight.mul(0.24))), 0, 0.28),
    );
    const crestLit = mix(
      reflectedBody,
      crestTransmission,
      clamp(transmitted.mul(float(0.10).add(nearShore.mul(0.05))), 0, 0.17),
    );
    const foamed = mix(crestLit, foamColor, clamp(persistentFoam.mul(0.68), 0, 0.58));
    return foamed.add(sunTint.mul(glitter.mul(0.30)));
  })();

  const cleanRoughness = mix(originalRoughness, float(0.075), microSlope.mul(0.18));
  material.roughnessNode = mix(cleanRoughness, float(0.47), persistentFoam.mul(0.72));
  material.emissiveNode = originalEmissive
    .add(crestTransmission.mul(transmitted.mul(0.010)))
    .add(sunTint.mul(glitter.mul(0.010)));
  material.needsUpdate = true;

  handle.fftV8SkyTint = skyTint;
  handle.fftV8SunTint = sunTint;
  handle.fftV8CrestTransmission = crestTransmission;
  handle.fftV8Storm = stormLevel;
  handle.fftV8OpticsInstalled = true;
}

function tuneStableSeaState(handle, skyColor, storm = 0, day = 1) {
  if (!handle?.gpuFFT) return;
  const stormT = THREE.MathUtils.clamp(storm, 0, 1);
  const dayT = THREE.MathUtils.clamp(day, 0, 1);
  if (handle.waveScale) handle.waveScale.value = 24.4 + stormT * 5.6;
  if (handle.fftDetailHandle?.waveScale) handle.fftDetailHandle.waveScale.value = 22.2 + stormT * 5.8;
  if (handle.fftMicroHandle?.waveScale) handle.fftMicroHandle.waveScale.value = 10.8 + stormT * 3.2;
  handle.fftV8StormValue = stormT;
  if (handle.fftV8Storm) handle.fftV8Storm.value = stormT;

  if (handle.fftV8SkyTint?.value) {
    if (skyColor?.isColor) handle.fftV8SkyTint.value.copy(skyColor);
    else handle.fftV8SkyTint.value.set(0x78b7d8);
  }
  if (handle.fftV8SunTint?.value) {
    handle.fftV8SunTint.value.set(0xa9c9df).lerp(new THREE.Color(0xffe4b1), dayT);
  }
  if (handle.fftV8CrestTransmission?.value) {
    handle.fftV8CrestTransmission.value.set(0x6c9ca1).lerp(new THREE.Color(0xa9eadb), dayT);
  }

  const physical = handle.fftPhysicalMaterial;
  if (physical) {
    if ("envMapIntensity" in physical) physical.envMapIntensity = 1.15 + dayT * 0.25 - stormT * 0.12;
    physical.specularIntensity = 1.0;
    physical.clearcoat = (typeof window !== "undefined" && window.__riftReducedEffects) ? 0.30 : 0.64;
    physical.clearcoatRoughness = 0.070 + stormT * 0.032;
  }
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle?.gpuFFT) return handle;

  handle.fftMicroHandle = createOceanFFTCascade({
    N: MICRO_N,
    domain: MICRO_DOMAIN,
    seed: 90210,
    windSpeed: 11.5,
    windDirection: [1.0, 0.23],
    amplitude: 0.00016,
    highFrequencyDamping: 0.00055,
    choppiness: 1.65,
    waveScale: 10.8,
  });
  handle.fftPersistentFoam = createPersistentOceanFoam(handle.fftMicroHandle);
  handle.fftV8Frame = 0;
  handle.fftV8StormValue = 0;

  addMicroCoordinates(handle);
  installThreeScaleDisplacement(handle);
  installWaterProStyleOptics(handle);
  tuneStableSeaState(handle, null, 0, 1);

  console.info("[gpu-fft-ocean] ACTIVE v8: 128 swell + 128 mid + 64 wind chop, persistent Jacobian whitecaps, physical Fresnel/glitter");
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  const result = updateBaseOcean(handle, renderer, elapsedTime);
  if (!handle?.gpuFFT || !handle.fftMicroHandle?.gpuFFTStandalone) return result;

  handle.fftV8Frame = (handle.fftV8Frame ?? 0) + 1;
  const reduced = typeof window !== "undefined" && window.__riftReducedEffects === true;
  const detailStride = typeof window !== "undefined" && Number.isFinite(window.__riftWaterDetailStride)
    ? Math.max(1, Math.floor(window.__riftWaterDetailStride))
    : (TOUCH_DEVICE ? 2 : 1);
  const microStride = reduced ? Math.max(3, detailStride) : (TOUCH_DEVICE ? Math.max(2, detailStride) : 1);

  if (handle.fftV8Frame % microStride === 0) {
    updateOceanFFTCascade(handle.fftMicroHandle, renderer, elapsedTime);
  }
  if (handle.fftPersistentFoam?.gpuOceanFoam) {
    updatePersistentOceanFoam(handle.fftPersistentFoam, renderer, elapsedTime, handle.fftV8StormValue ?? 0);
  }
  return result;
}

export function updateGPUFFTOceanVisuals(
  handle,
  elapsed,
  skyColor,
  cameraY,
  playerPos,
  sunDir,
  skyHorizon,
  reflectionTexture,
  reflectionMatrix,
  refractionTexture,
  resolution,
  storm = 0,
  day = 1,
) {
  updateBaseVisuals(
    handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon,
    reflectionTexture, reflectionMatrix, refractionTexture, resolution,
    storm, day,
  );
  installThreeScaleDisplacement(handle);
  installWaterProStyleOptics(handle);
  tuneStableSeaState(handle, skyColor, storm, day);
}

export function updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt = 1 / 60) {
  return updateBaseRipples(handle, playerPos, cameraY, dt);
}

export function disposeGPUFFTOcean(scene, handle) {
  if (handle?.fftPersistentFoam?.gpuOceanFoam) disposePersistentOceanFoam(handle.fftPersistentFoam);
  if (handle?.fftMicroHandle?.gpuFFTStandalone) disposeOceanFFTCascade(handle.fftMicroHandle);
  if (handle) {
    handle.fftPersistentFoam = null;
    handle.fftMicroHandle = null;
  }
  return disposeBaseOcean(scene, handle);
}
