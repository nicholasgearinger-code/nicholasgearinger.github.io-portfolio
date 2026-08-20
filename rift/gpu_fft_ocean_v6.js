import * as THREE from "three";
import {
  Fn, uniform, color, float, uint,
  positionWorld, attribute, floor, abs, pow, mix, clamp, smoothstep,
} from "three/tsl";
import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  updateGPUFFTOceanRipples as updateBaseRipples,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean_v4.js";
import {
  createGPUSurfSystem,
  updateGPUSurfCompute,
  updateGPUSurfSystem,
  disposeGPUSurfSystem,
} from "./gpu_surf_system_v8.js";

const FFT_N = 128;
const DAY_SURFACE = new THREE.Color(0x23666a);
const NIGHT_SURFACE = new THREE.Color(0x071a22);
const STORM_SURFACE = new THREE.Color(0x173b41);
const DAY_CREST = new THREE.Color(0xd2ebe7);
const NIGHT_CREST = new THREE.Color(0x738f98);
const DAY_FOAM = new THREE.Color(0xf8faf6);
const NIGHT_FOAM = new THREE.Color(0x91a0a3);

// Three r182's instancedArray(TypedArray, type) builds the underlying
// StorageInstancedBufferAttribute correctly, but passes the TypedArray itself
// into StorageBufferNode.bufferCount. r183 changed that argument to
// buffer.count. Safari/iOS reaches the bad r182 path while materializing these
// storage attributes for the first compute dispatch and can fail inside the
// backend's native TypedArray.set(). Repair the node metadata in-place before
// any FFT/shallow/surf compute is submitted. This preserves the exact GPU FFT
// buffers and avoids a risky library-wide upgrade while matching r183 behavior.
function repairR182StorageBufferCounts(root) {
  const seen = new WeakSet();

  const visit = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 8 || seen.has(value)) return;
    seen.add(value);

    if (value.isStorageBufferNode === true) {
      const count = value.value?.count;
      if (Number.isFinite(count) && value.bufferCount !== count) {
        value.bufferCount = count;
      }
      return;
    }

    // Do not descend through TSL graphs or Three scene/render objects. The
    // storage nodes we need are exposed directly on the simulation handles and
    // in their resources arrays.
    if (
      value.isNode === true ||
      value.isObject3D === true ||
      value.isMaterial === true ||
      value.isBufferGeometry === true ||
      value.isTexture === true
    ) return;

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }

    for (const child of Object.values(value)) visit(child, depth + 1);
  };

  visit(root);
}

function installSpectralOpticalDetail(handle) {
  if (!handle?.gpuFFT || handle.fftSpectralOpticsV6Installed) return;
  const material = handle.fftPhysicalMaterial ?? handle.mesh?.material;
  const source = handle.fftDetailHandle?.resources?.[8];
  if (!material || !source || !handle.mesh?.geometry?.getAttribute?.("fftCoordDetail")) return;

  const coord = attribute("fftCoordDetail", "vec2");
  const depth = attribute("fftDepthWorld", "float");
  const n = uint(FFT_N);
  const x0 = floor(coord.x).toUint().mod(n);
  const z0 = floor(coord.y).toUint().mod(n);
  const xL = x0.add(uint(FFT_N - 1)).mod(n);
  const xR = x0.add(uint(1)).mod(n);
  const zD = z0.add(uint(FFT_N - 1)).mod(n);
  const zU = z0.add(uint(1)).mod(n);

  const c = source.element(z0.mul(n).add(x0)).x;
  const l = source.element(z0.mul(n).add(xL)).x;
  const r = source.element(z0.mul(n).add(xR)).x;
  const d = source.element(zD.mul(n).add(x0)).x;
  const u = source.element(zU.mul(n).add(x0)).x;

  const localSlope = abs(r.sub(l)).add(abs(u.sub(d)));
  const curvature = abs(r.add(l).sub(c.mul(2)))
    .add(abs(u.add(d).sub(c.mul(2))));
  const micro = clamp(
    smoothstep(float(0.035), float(0.72), localSlope)
      .mul(0.72)
      .add(smoothstep(float(0.020), float(0.52), curvature).mul(0.28)),
    0,
    1,
  );

  const shallowTint = uniform(color(0x55aeb0));
  const transmissionTint = uniform(color(0x9bd8cf));
  const sparkleTint = uniform(color(0xffe6c2));
  const stormLevel = uniform(0.0);
  const waterLevel = uniform(handle.waterY ?? 0);

  const daylight = handle.fftDaylight ?? uniform(1.0);
  const underwaterMix = handle.fftUnderwaterMix ?? uniform(0.0);
  const originalColor = material.colorNode ?? uniform(color(0x245b63));
  const originalRoughness = material.roughnessNode ?? float(0.065);
  const originalEmissive = material.emissiveNode ?? uniform(color(0x000000));

  const nearShore = float(1).sub(smoothstep(float(2.2), float(11.0), depth));
  const crest = smoothstep(waterLevel.add(0.20), waterLevel.add(1.65), positionWorld.y)
    .mul(float(1).sub(underwaterMix));
  const stormClear = float(1).sub(stormLevel.mul(0.62));
  const sparkle = pow(micro, float(2.2))
    .mul(daylight)
    .mul(stormClear)
    .mul(float(1).sub(underwaterMix));

  material.colorNode = Fn(() => {
    const shallowBody = mix(
      originalColor,
      shallowTint,
      nearShore.mul(daylight).mul(float(0.10).add(micro.mul(0.08))),
    );
    const transmitted = mix(
      shallowBody,
      transmissionTint,
      crest.mul(daylight).mul(float(0.045).add(nearShore.mul(0.045))),
    );
    return mix(transmitted, sparkleTint, clamp(sparkle.mul(0.050), 0, 0.07));
  })();

  material.roughnessNode = mix(
    originalRoughness,
    float(0.125),
    micro.mul(float(0.12).add(stormLevel.mul(0.10))),
  );
  material.emissiveNode = originalEmissive.add(
    transmissionTint.mul(crest.mul(daylight).mul(stormClear).mul(0.010)),
  );
  material.needsUpdate = true;

  handle.fftOpticalShallowTint = shallowTint;
  handle.fftOpticalTransmissionTint = transmissionTint;
  handle.fftOpticalSparkleTint = sparkleTint;
  handle.fftOpticalStorm = stormLevel;
  handle.fftSpectralOpticsV6Installed = true;
}

function tuneReferenceOcean(handle, elapsed = 0, cameraY = Infinity, storm = 0, day = 1) {
  if (!handle?.gpuFFT) return;

  const stormT = THREE.MathUtils.clamp(storm, 0, 1);
  const dayT = THREE.MathUtils.clamp(day, 0, 1);
  const t = Number.isFinite(elapsed) ? elapsed : 0;
  const reduced = typeof window !== "undefined" && window.__riftReducedEffects === true;

  const longSet =
    Math.sin(t * 0.059 + 0.4) * 0.66 +
    Math.sin(t * 0.026 + 2.1) * 0.38;
  const detailSet =
    Math.sin(t * 0.173 + 1.3) * 0.88 +
    Math.sin(t * 0.293 + 0.6) * 0.52 +
    Math.sin(t * 0.419 + 2.8) * 0.24;

  if (handle.waveScale) handle.waveScale.value = 24.5 + longSet + stormT * 5.8;
  if (handle.fftDetailHandle?.waveScale) {
    handle.fftDetailHandle.waveScale.value = 22.5 + detailSet + stormT * 6.2;
  }
  if (handle.mesh) handle.mesh.scale.y = 1.005 + stormT * 0.05;
  if (handle.fftFoamStrength) handle.fftFoamStrength.value = 0.56 + stormT * 0.72;

  if (handle.fftSurfaceColor?.value) {
    handle.fftSurfaceColor.value.copy(NIGHT_SURFACE)
      .lerp(DAY_SURFACE, dayT)
      .lerp(STORM_SURFACE, stormT * 0.58);
  }
  if (handle.fftCrestColor?.value) {
    handle.fftCrestColor.value.copy(NIGHT_CREST).lerp(DAY_CREST, dayT);
  }
  if (handle.fftFoamColor?.value) {
    handle.fftFoamColor.value.copy(NIGHT_FOAM).lerp(DAY_FOAM, dayT);
  }

  if (handle.fftOpticalStorm) handle.fftOpticalStorm.value = stormT;
  if (handle.fftOpticalShallowTint?.value) {
    handle.fftOpticalShallowTint.value.set(0x315d65).lerp(new THREE.Color(0x62b9b8), dayT);
  }
  if (handle.fftOpticalTransmissionTint?.value) {
    handle.fftOpticalTransmissionTint.value.set(0x5b7e83).lerp(new THREE.Color(0xa7ddd2), dayT);
  }
  if (handle.fftOpticalSparkleTint?.value) {
    handle.fftOpticalSparkleTint.value.set(0xaec7da).lerp(new THREE.Color(0xffe5ba), dayT);
  }

  const physical = handle.fftPhysicalMaterial;
  const underwater = Number.isFinite(cameraY) && cameraY < (handle.waterY ?? 0) - 0.08;
  if (physical) {
    physical.transparent = false;
    physical.opacity = 1.0;
    physical.ior = 1.333;

    if (underwater) {
      physical.transmission = 0.95;
      physical.thickness = 0.065;
      physical.attenuationDistance = 92.0;
      physical.attenuationColor.set(0xb8e3e0);
      physical.specularIntensity = 0.84;
      physical.roughness = 0.026;
      physical.clearcoat = 0.08;
      physical.clearcoatRoughness = 0.08;
    } else {
      physical.transmission = reduced ? 0.0 : (0.60 - stormT * 0.08);
      physical.thickness = reduced ? 0.10 : 0.34;
      physical.attenuationDistance = 32.0;
      physical.attenuationColor.set(0x7fc3c0);
      physical.specularIntensity = 1.0;
      physical.roughness = (reduced ? 0.060 : 0.042) + stormT * 0.026;
      physical.clearcoat = reduced ? 0.30 : 0.56;
      physical.clearcoatRoughness = (reduced ? 0.115 : 0.090) + stormT * 0.030;
    }
  }
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle?.gpuFFT) return handle;

  handle.fftSurfSystem = createGPUSurfSystem(
    scene,
    sampleHeight,
    y,
    handle.fftShallowHandle,
  );

  repairR182StorageBufferCounts(handle);
  installSpectralOpticalDetail(handle);
  tuneReferenceOcean(handle, 0, Infinity, 0, 1);

  if (handle.fftSurfSystem) {
    console.info("[gpu-fft-ocean] ACTIVE v6: spectral optical detail + surf v8 + physical swash v5");
  }
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  const result = updateBaseOcean(handle, renderer, elapsedTime);
  if (handle?.fftSurfSystem?.gpuSurfSystem) {
    updateGPUSurfCompute(handle.fftSurfSystem, renderer, elapsedTime);
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
    storm,
    day,
  );

  installSpectralOpticalDetail(handle);
  tuneReferenceOcean(handle, elapsed, cameraY, storm, day);

  if (handle?.fftSurfSystem?.gpuSurfSystem) {
    updateGPUSurfSystem(handle.fftSurfSystem, elapsed, cameraY, storm, day, sunDir);

    const reduced = typeof window !== "undefined" && window.__riftReducedEffects === true;
    const underwater = Number.isFinite(cameraY) && cameraY < (handle.waterY ?? 0) - 0.10;
    const dayT = THREE.MathUtils.clamp(day, 0, 1);
    const stormT = THREE.MathUtils.clamp(storm, 0, 1);

    if (handle.fftSurfSystem.mist?.points) {
      handle.fftSurfSystem.mist.points.visible = !underwater && !reduced;
      if (handle.fftSurfSystem.mist.material) {
        handle.fftSurfSystem.mist.material.opacity = reduced ? 0 : (0.04 + dayT * 0.055 + stormT * 0.075);
      }
    }
    if (handle.fftSurfSystem.spray?.points) {
      handle.fftSurfSystem.spray.points.visible = !underwater;
    }
    if (handle.fftSurfSystem.spray?.material) {
      const baseOpacity = 0.22 + dayT * 0.16 + stormT * 0.14;
      handle.fftSurfSystem.spray.material.opacity = baseOpacity * (reduced ? 0.78 : 1.0);
    }
  }
}

export function updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt = 1 / 60) {
  return updateBaseRipples(handle, playerPos, cameraY, dt);
}

export function disposeGPUFFTOcean(scene, handle) {
  if (handle?.fftSurfSystem?.gpuSurfSystem) {
    disposeGPUSurfSystem(scene, handle.fftSurfSystem);
  }
  if (handle) handle.fftSurfSystem = null;
  return disposeBaseOcean(scene, handle);
}
