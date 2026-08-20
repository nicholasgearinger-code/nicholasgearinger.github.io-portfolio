import * as THREE from "three";
import {
  Fn, float, uint, positionWorld, floor, fract, clamp, abs,
} from "three/tsl";
import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean_v3.js";
import { setGPUShallowWaterInteraction } from "./gpu_shallow_water.js";

const WATER_IOR = 1.333;
const FFT_N = 128;
const DETAIL_DOMAIN = 260;
const SHALLOW_N = 256;
const SHALLOW_DOMAIN = 360;
const MOBILE_RENDER_N = 320;
const TOUCH_DEVICE = typeof window !== "undefined" && (
  "ontouchstart" in window || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
);

function positiveFract(v) {
  return ((v % 1) + 1) % 1;
}

function smooth01(t) {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

// v2 deliberately keeps a 512² presentation mesh on desktop. Phones were
// paying ~262k displaced water vertices every frame even though the source FFT
// is only 128². Rebuild only the PRESENTATION geometry at 320² on touch devices
// using the exact same named attributes the existing TSL displacement graph
// reads. The simulation, interpolation, normals, shallow-water coupling and
// physics remain unchanged; only rasterized vertex density drops (~61%).
function installMobileRenderGeometry(handle, size, sampleHeight) {
  if (!TOUCH_DEVICE || !handle?.mesh || handle.fftMobileGeometryApplied) return;

  const n = MOBILE_RENDER_N;
  const waterY = handle.waterY ?? 0;
  const geometry = new THREE.PlaneGeometry(size, size, n - 1, n - 1);
  geometry.rotateX(-Math.PI / 2);

  const count = geometry.attributes.position.count;
  const longCoords = new Float32Array(count * 2);
  const detailCoords = new Float32Array(count * 2);
  const shallowCoords = new Float32Array(count * 2);
  const shallowCoverage = new Float32Array(count);
  const shore = new Float32Array(count);
  const depthWorld = new Float32Array(count);
  const pos = geometry.attributes.position;

  for (let rz = 0; rz < n; rz++) {
    const fz = rz * (FFT_N - 1) / (n - 1);
    for (let rx = 0; rx < n; rx++) {
      const fx = rx * (FFT_N - 1) / (n - 1);
      const i = rz * n + rx;
      longCoords[i * 2] = fx;
      longCoords[i * 2 + 1] = fz;

      const x = pos.getX(i);
      const z = pos.getZ(i);
      detailCoords[i * 2] = positiveFract(x / DETAIL_DOMAIN + 0.5) * FFT_N;
      detailCoords[i * 2 + 1] = positiveFract(z / DETAIL_DOMAIN + 0.5) * FFT_N;

      const sgx = (x / SHALLOW_DOMAIN + 0.5) * (SHALLOW_N - 1);
      const sgz = (z / SHALLOW_DOMAIN + 0.5) * (SHALLOW_N - 1);
      shallowCoords[i * 2] = THREE.MathUtils.clamp(sgx, 0, SHALLOW_N - 1);
      shallowCoords[i * 2 + 1] = THREE.MathUtils.clamp(sgz, 0, SHALLOW_N - 1);

      const squareRadius = Math.max(Math.abs(x), Math.abs(z)) / (SHALLOW_DOMAIN * 0.5);
      shallowCoverage[i] = 1 - smooth01((squareRadius - 0.80) / 0.18);

      const groundY = sampleHeight ? sampleHeight(x, z) : null;
      const signedDepth = groundY === null ? 12 : waterY - groundY;
      const depth = Math.max(0, signedDepth);
      depthWorld[i] = Math.min(depth, 24);

      if (signedDepth <= -0.35) shore[i] = 0;
      else if (signedDepth < 0) {
        const t = (signedDepth + 0.35) / 0.35;
        shore[i] = smooth01(t) * 0.08;
      } else {
        shore[i] = 0.08 + smooth01(signedDepth / 2.5) * 0.92;
      }
    }
  }

  geometry.setAttribute("fftCoordLong", new THREE.Float32BufferAttribute(longCoords, 2));
  geometry.setAttribute("fftCoordDetail", new THREE.Float32BufferAttribute(detailCoords, 2));
  geometry.setAttribute("shallowCoord", new THREE.Float32BufferAttribute(shallowCoords, 2));
  geometry.setAttribute("shallowCoverage", new THREE.Float32BufferAttribute(shallowCoverage, 1));
  geometry.setAttribute("fftShoreDense", new THREE.Float32BufferAttribute(shore, 1));
  geometry.setAttribute("fftDepthWorld", new THREE.Float32BufferAttribute(depthWorld, 1));
  geometry.computeBoundingSphere();

  const oldGeometry = handle.mesh.geometry;
  handle.mesh.geometry = geometry;
  try { oldGeometry?.dispose?.(); } catch (_) {}
  handle.fftMobileGeometryApplied = true;
  handle.mesh.material.needsUpdate = true;
}

function installPhysicalWaterOptics(handle) {
  const mesh = handle?.mesh;
  const old = mesh?.material;
  if (!mesh || !old || handle.fftPhysicalOpticsApplied) return;

  const physical = new THREE.MeshPhysicalNodeMaterial({
    color: 0xffffff,
    roughness: 0.032,
    metalness: 0.0,
    transmission: 0.74,
    ior: WATER_IOR,
    thickness: 0.42,
    attenuationDistance: 30.0,
    attenuationColor: new THREE.Color(0x76c7d0),
    specularIntensity: 1.0,
    clearcoat: 0.72,
    clearcoatRoughness: 0.12,
    transparent: false,
    opacity: 1.0,
    side: THREE.DoubleSide,
    depthWrite: true,
  });

  physical.positionNode = old.positionNode ?? null;
  physical.normalNode = old.normalNode ?? null;
  physical.colorNode = old.colorNode ?? null;
  physical.roughnessNode = old.roughnessNode ?? null;
  physical.metalnessNode = old.metalnessNode ?? null;
  physical.emissiveNode = old.emissiveNode ?? null;
  physical.needsUpdate = true;

  mesh.material = physical;
  handle.fftPhysicalMaterial = physical;
  handle.fftPhysicalOpticsApplied = true;

  requestAnimationFrame(() => requestAnimationFrame(() => {
    try { old.dispose?.(); } catch (_) {}
  }));
}

function findExistingTerrainCausticMaterial(scene) {
  if (!scene) return null;
  let found = null;
  scene.traverse((obj) => {
    if (found || !obj?.isMesh) return;
    const mat = obj.material;
    const data = mat?.userData;
    if (
      data?.causticTimeUniform &&
      data?.causticIntensityUniform &&
      data?.causticFocusRadiusUniform
    ) {
      found = mat;
    }
  });
  return found;
}

function installFFTDrivenCaustics(handle) {
  if (!handle?.fftScene) return;

  const mat =
    handle.fftTerrainCausticMaterial ??
    findExistingTerrainCausticMaterial(handle.fftScene);
  if (!mat?.emissiveNode) return;

  handle.fftTerrainCausticMaterial = mat;
  const data = mat.userData;
  if (data?.fftCausticSyncInstalled) return;

  const detailA = handle.fftDetailHandle?.resources?.[8];
  const baseA = handle.resources?.[8];
  const source = detailA ?? baseA;
  if (!source) return;

  const baseDomain =
    handle.mesh?.geometry?.parameters?.width ??
    handle.mesh?.geometry?.parameters?.height ??
    2000;
  const domain = detailA ? DETAIL_DOMAIN : baseDomain;

  delete data.fftCausticTuneInstalled;

  data.fftOriginalCausticEmissive = mat.emissiveNode;
  data.fftOriginalCausticBeforeRender = mat.onBeforeRender;

  const fftFocus = Fn(() => {
    const n = uint(FFT_N);
    const nF = float(FFT_N);
    const gx = fract(positionWorld.x.div(float(domain)).add(0.5)).mul(nF);
    const gz = fract(positionWorld.z.div(float(domain)).add(0.5)).mul(nF);

    const x0 = floor(gx).toUint();
    const z0 = floor(gz).toUint();
    const xL = x0.add(uint(FFT_N - 1)).mod(n);
    const xR = x0.add(uint(1)).mod(n);
    const zD = z0.add(uint(FFT_N - 1)).mod(n);
    const zU = z0.add(uint(1)).mod(n);

    const c = source.element(z0.mul(n).add(x0)).x;
    const l = source.element(z0.mul(n).add(xL)).x;
    const r = source.element(z0.mul(n).add(xR)).x;
    const d = source.element(zD.mul(n).add(x0)).x;
    const u = source.element(zU.mul(n).add(x0)).x;

    const inv2dx = float(1 / (2 * (domain / FFT_N)));
    const dhdx = r.sub(l).mul(inv2dx);
    const dhdz = u.sub(d).mul(inv2dx);

    const slope = clamp(
      abs(dhdx).add(abs(dhdz)).mul(2.0),
      0,
      1,
    );
    const curvature = abs(r.add(l).sub(c.mul(2)))
      .add(abs(u.add(d).sub(c.mul(2))));
    const bend = clamp(curvature.mul(1.45), 0, 1);

    return clamp(
      float(0.82)
        .add(slope.mul(0.32))
        .add(bend.mul(0.58)),
      0.82,
      1.48,
    );
  })();

  mat.emissiveNode = data.fftOriginalCausticEmissive.mul(fftFocus);

  const previousBeforeRender = mat.onBeforeRender;
  mat.onBeforeRender = function (...args) {
    if (typeof previousBeforeRender === "function") {
      previousBeforeRender.apply(this, args);
    }

    const ud = this.userData;
    if (!ud) return;

    if (ud.causticTimeUniform && handle.fftTime) {
      ud.causticTimeUniform.value = handle.fftTime.value;
    }
    if (ud.causticFocusRadiusUniform) {
      ud.causticFocusRadiusUniform.value = 30.0;
    }
  };

  mat.needsUpdate = true;
  data.fftCausticSyncInstalled = true;
}

function tuneWaveEnergy(handle, elapsed = 0, storm = 0) {
  if (!handle?.gpuFFT) return;

  const stormT = THREE.MathUtils.clamp(storm, 0, 1);
  const longSet =
    Math.sin(elapsed * 0.071 + 0.4) * 0.90 +
    Math.sin(elapsed * 0.031 + 2.2) * 0.55;
  const detailSet =
    Math.sin(elapsed * 0.173 + 1.9) * 0.70 +
    Math.sin(elapsed * 0.289 + 0.65) * 0.40;

  if (handle.waveScale) {
    handle.waveScale.value = 28.0 + longSet + stormT * 7.0;
  }
  if (handle.fftDetailHandle?.waveScale) {
    handle.fftDetailHandle.waveScale.value = 18.0 + detailSet + stormT * 6.0;
  }

  if (handle.mesh) {
    handle.mesh.scale.y = 1.02 + stormT * 0.05;
  }
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle?.gpuFFT) return handle;

  handle.fftInteractionPrev = null;
  handle.fftInteractionPrevY = null;
  handle.fftInteractionWasSubmerged = false;
  handle.fftScene = scene;
  handle.fftTerrainCausticMaterial = null;
  handle.fftPerfFrame = 0;

  installMobileRenderGeometry(handle, size, sampleHeight);
  installPhysicalWaterOptics(handle);
  installFFTDrivenCaustics(handle);
  tuneWaveEnergy(handle, 0, 0);
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  if (!handle?.gpuFFT) return;

  handle.fftPerfFrame = (handle.fftPerfFrame ?? 0) + 1;
  const runtimeStride = typeof window !== "undefined" && Number.isFinite(window.__riftWaterDetailStride)
    ? Math.max(1, Math.floor(window.__riftWaterDetailStride))
    : (TOUCH_DEVICE ? 2 : 1);
  const detail = handle.fftDetailHandle;
  const originalDetailFlag = detail?.gpuFFT;
  const skipDetail = !!detail?.gpuFFT && runtimeStride > 1 && (handle.fftPerfFrame % runtimeStride !== 0);

  if (skipDetail) detail.gpuFFT = false;
  try {
    return updateBaseOcean(handle, renderer, elapsedTime);
  } finally {
    if (detail && originalDetailFlag !== undefined) detail.gpuFFT = originalDetailFlag;
  }
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

  tuneWaveEnergy(handle, elapsed, storm);
  installPhysicalWaterOptics(handle);
  installFFTDrivenCaustics(handle);

  const physical = handle?.fftPhysicalMaterial;
  if (physical) {
    const underwater = Number.isFinite(cameraY) && cameraY < (handle.waterY ?? 0) - 0.08;
    const stormT = THREE.MathUtils.clamp(storm, 0, 1);
    physical.transparent = false;
    physical.opacity = 1.0;
    physical.ior = WATER_IOR;

    if (underwater) {
      physical.transmission = 0.955;
      physical.thickness = 0.07;
      physical.attenuationDistance = 88.0;
      physical.attenuationColor.set(0xb6e6e8);
      physical.specularIntensity = 0.84;
      physical.roughness = 0.024;
      physical.clearcoat = 0.10;
      physical.clearcoatRoughness = 0.075;
    } else {
      physical.transmission = 0.74 - stormT * 0.10;
      physical.thickness = 0.42;
      physical.attenuationDistance = 30.0;
      physical.attenuationColor.set(0x76c7d0);
      physical.specularIntensity = 1.0;
      physical.roughness = 0.032 + stormT * 0.020;
      physical.clearcoat = 0.72;
      physical.clearcoatRoughness = 0.12 + stormT * 0.025;
    }
  }
}

export function updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt = 1 / 60) {
  const shallow = handle?.fftShallowHandle;
  if (!handle?.gpuFFT || !shallow?.gpuShallowWater || !playerPos) return;

  const safeDt = Math.max(1 / 240, Math.min(0.05, Number.isFinite(dt) ? dt : 1 / 60));
  const waterY = handle.waterY ?? 0;
  const submerged = Number.isFinite(cameraY) && cameraY < waterY;
  const nearSurface = Number.isFinite(cameraY) && Math.abs(cameraY - waterY) < 2.6;

  let horizontalSpeed = 0;
  if (handle.fftInteractionPrev) {
    const dx = playerPos.x - handle.fftInteractionPrev.x;
    const dz = playerPos.z - handle.fftInteractionPrev.z;
    horizontalSpeed = Math.hypot(dx, dz) / safeDt;
  }

  const crossedSurface = handle.fftInteractionPrevY !== null && Number.isFinite(cameraY)
    ? ((handle.fftInteractionPrevY >= waterY && cameraY < waterY) ||
       (handle.fftInteractionPrevY < waterY && cameraY >= waterY))
    : false;

  const wake = nearSurface ? Math.min(1.35, horizontalSpeed * 0.065) : 0;
  const swimWake = submerged && cameraY > waterY - 5.0 ? Math.min(0.55, horizontalSpeed * 0.025) : 0;
  const splash = crossedSurface
    ? Math.min(3.0, 1.65 + Math.abs((cameraY - (handle.fftInteractionPrevY ?? cameraY)) / safeDt) * 0.035)
    : 0;
  const strength = Math.min(3.4, Math.max(wake, swimWake) + splash);
  const radius = Math.min(6.5, 2.2 + horizontalSpeed * 0.045 + (crossedSurface ? 1.6 : 0));

  if (strength > 0.025) {
    setGPUShallowWaterInteraction(shallow, playerPos.x, playerPos.z, strength, radius);
  }

  if (!handle.fftInteractionPrev) handle.fftInteractionPrev = { x: playerPos.x, z: playerPos.z };
  else {
    handle.fftInteractionPrev.x = playerPos.x;
    handle.fftInteractionPrev.z = playerPos.z;
  }
  handle.fftInteractionPrevY = Number.isFinite(cameraY) ? cameraY : waterY;
  handle.fftInteractionWasSubmerged = submerged;
}

export function disposeGPUFFTOcean(scene, handle) {
  if (handle) {
    const mat = handle.fftTerrainCausticMaterial;
    const data = mat?.userData;
    if (data?.fftCausticSyncInstalled) {
      if (data.fftOriginalCausticEmissive) {
        mat.emissiveNode = data.fftOriginalCausticEmissive;
      }
      if ("fftOriginalCausticBeforeRender" in data) {
        mat.onBeforeRender = data.fftOriginalCausticBeforeRender;
      }
      mat.needsUpdate = true;
      delete data.fftOriginalCausticEmissive;
      delete data.fftOriginalCausticBeforeRender;
      delete data.fftCausticSyncInstalled;
    }

    handle.fftInteractionPrev = null;
    handle.fftInteractionPrevY = null;
    handle.fftPhysicalMaterial = null;
    handle.fftTerrainCausticMaterial = null;
    handle.fftScene = null;
  }
  return disposeBaseOcean(scene, handle);
}
