import * as THREE from "three";
import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean_v3.js";
import { setGPUShallowWaterInteraction } from "./gpu_shallow_water.js";
import {
  createGPUUnderwaterLighting,
  updateGPUUnderwaterLighting,
  disposeGPUUnderwaterLighting,
} from "./gpu_underwater_lighting.js";

const WATER_IOR = 1.333;

function installPhysicalWaterOptics(handle) {
  const mesh = handle?.mesh;
  const old = mesh?.material;
  if (!mesh || !old || handle.fftPhysicalOpticsApplied) return;

  const physical = new THREE.MeshPhysicalNodeMaterial({
    color: 0xffffff,
    roughness: 0.045,
    metalness: 0.0,
    transmission: 0.82,
    ior: WATER_IOR,
    thickness: 0.34,
    attenuationDistance: 38.0,
    attenuationColor: new THREE.Color(0x8ad6db),
    specularIntensity: 0.92,
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

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle?.gpuFFT) return handle;

  handle.fftInteractionPrev = null;
  handle.fftInteractionPrevY = null;
  handle.fftInteractionWasSubmerged = false;

  installPhysicalWaterOptics(handle);

  handle.fftUnderwaterLighting = createGPUUnderwaterLighting(
    scene,
    sampleHeight,
    y,
    handle.fftShallowHandle,
  );
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  return updateBaseOcean(handle, renderer, elapsedTime);
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

  installPhysicalWaterOptics(handle);

  const physical = handle?.fftPhysicalMaterial;
  if (physical) {
    const underwater = Number.isFinite(cameraY) && cameraY < (handle.waterY ?? 0) - 0.08;
    const stormT = THREE.MathUtils.clamp(storm, 0, 1);
    physical.transparent = false;
    physical.opacity = 1.0;
    physical.ior = WATER_IOR;

    if (underwater) {
      // Treat the underside as a thin optical boundary rather than a thick cyan
      // volume. High transmission + long attenuation distance keeps refraction
      // visible without turning the horizon into an opaque turquoise wall.
      physical.transmission = 0.965;
      physical.thickness = 0.075;
      physical.attenuationDistance = 90.0;
      physical.attenuationColor.set(0xb6e6e8);
      physical.specularIntensity = 0.82;
      physical.roughness = 0.028;
    } else {
      physical.transmission = 0.82 - stormT * 0.12;
      physical.thickness = 0.34;
      physical.attenuationDistance = 38.0;
      physical.attenuationColor.set(0x8ad6db);
      physical.specularIntensity = 0.92;
      physical.roughness = 0.045 + stormT * 0.025;
    }
  }

  if (handle?.fftUnderwaterLighting?.gpuUnderwaterLighting) {
    updateGPUUnderwaterLighting(
      handle.fftUnderwaterLighting,
      elapsed,
      cameraY,
      day,
      storm,
      sunDir,
    );
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
  if (handle?.fftUnderwaterLighting?.gpuUnderwaterLighting) {
    disposeGPUUnderwaterLighting(scene, handle.fftUnderwaterLighting);
  }
  if (handle) {
    handle.fftUnderwaterLighting = null;
    handle.fftInteractionPrev = null;
    handle.fftInteractionPrevY = null;
    handle.fftPhysicalMaterial = null;
  }
  return disposeBaseOcean(scene, handle);
}
