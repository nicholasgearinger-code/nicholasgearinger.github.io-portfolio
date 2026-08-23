import * as legacy from "./liquid_legacy.js";
import {
  createGPUFFTOceanPlane,
  updateGPUFFTOcean,
  updateGPUFFTOceanVisuals,
  disposeGPUFFTOcean,
} from "./gpu_fft_ocean_v2.js";
import {
  ensureRealisticWorldLighting,
  updateRealisticWorldLighting,
  updateRealisticLightingExposure,
  setRealisticLightingBiome,
} from "./worldLighting.js";
import {
  ensureUnderwaterWorld,
  updateUnderwaterWorld,
  disposeUnderwaterWorld,
} from "./underwaterWorld.js";

function attachWorldLighting(scene, biome, waterY, handle, sampleHeight = null) {
  const lighting = ensureRealisticWorldLighting(scene, biome, waterY);
  if (lighting) setRealisticLightingBiome(lighting, biome);
  if (handle && typeof handle === "object") {
    handle.worldLighting = lighting;
    handle.worldLightingBiome = biome;
    // Crystal is the only full open-ocean level. Pass the existing terrain
    // sampler into the underwater system so its moving caustic skin can conform
    // to the REAL seafloor instead of being a flat fullscreen overlay.
    handle.underwaterWorld = biome === "crystal"
      ? ensureUnderwaterWorld(scene, waterY, sampleHeight)
      : null;
  }
  return handle;
}

// Compatibility router: Crystal uses the GPU FFT ocean. Other liquid features
// remain delegated to the preserved legacy module.
function createLiquidPlane(scene, biome, y, size, sampleHeight, flowDir = { x: 0.6, z: 0.35 }, excludeRegions = []) {
  if (biome === "crystal") {
    const handle = createGPUFFTOceanPlane(scene, y, size, sampleHeight);
    return attachWorldLighting(scene, biome, y, handle, sampleHeight);
  }
  const handle = legacy.createLiquidPlane(scene, biome, y, size, sampleHeight, flowDir, excludeRegions);
  return attachWorldLighting(scene, biome, y, handle, sampleHeight);
}

function updateLiquidPlane(handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon, reflectionTexture, reflectionMatrix, refractionTexture, resolution, stormAmount = 0, dayAmount = 1) {
  let result;

  if (handle?.gpuFFT) {
    result = updateGPUFFTOceanVisuals(
      handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon,
      reflectionTexture, reflectionMatrix, refractionTexture, resolution,
      stormAmount, dayAmount,
    );
  } else {
    result = legacy.updateLiquidPlane(
      handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon,
      reflectionTexture, reflectionMatrix, refractionTexture, resolution,
      stormAmount, dayAmount,
    );
  }

  if (handle?.worldLighting) {
    updateRealisticWorldLighting(
      handle.worldLighting,
      elapsed,
      skyColor,
      skyHorizon,
      cameraY,
      dayAmount,
      stormAmount,
      handle.waterY,
      playerPos,
    );
  }

  // Apply the lightweight underwater atmosphere AFTER normal world lighting so
  // the water column filters those same lights coherently. Still no second scene
  // render: fog, horizon shell, Snell window, terrain caustic skin, motes,
  // bubbles and surface shafts all run through this existing liquid hook.
  if (handle?.underwaterWorld) {
    updateUnderwaterWorld(
      handle.underwaterWorld,
      elapsed,
      cameraY,
      playerPos,
      dayAmount,
      stormAmount,
      handle.worldLighting,
    );
  }

  return result;
}

async function updateFluidSimWater(handle, renderer) {
  if (handle?.worldLighting) {
    updateRealisticLightingExposure(handle.worldLighting, renderer);
  }

  if (handle?.gpuFFT) return updateGPUFFTOcean(handle, renderer);
  return legacy.updateFluidSimWater(handle, renderer);
}

function disposeLiquidPlane(scene, handle) {
  if (handle?.underwaterWorld) {
    disposeUnderwaterWorld(scene, handle.underwaterWorld);
    handle.underwaterWorld = null;
  }
  if (handle?.gpuFFT) return disposeGPUFFTOcean(scene, handle);
  return legacy.disposeLiquidPlane(scene, handle);
}

const {
  createWaterfall,
  updateWaterfall,
  disposeWaterfall,
  createRiverCurrent,
  updateRiverCurrent,
  disposeRiverCurrent,
  createRiverFlowStrip,
  updateRiverFlowStrip,
  disposeRiverFlowStrip,
  createCliffWall,
  disposeCliffWall,
  createSourcePond,
  updateSourcePond,
  disposeSourcePond,
  createOceanSurfaceDetail,
  updateOceanSurfaceDetail,
  disposeOceanSurfaceDetail,
} = legacy;

export {
  createLiquidPlane,
  updateLiquidPlane,
  disposeLiquidPlane,
  updateFluidSimWater,
  createWaterfall,
  updateWaterfall,
  disposeWaterfall,
  createRiverCurrent,
  updateRiverCurrent,
  disposeRiverCurrent,
  createRiverFlowStrip,
  updateRiverFlowStrip,
  disposeRiverFlowStrip,
  createCliffWall,
  disposeCliffWall,
  createSourcePond,
  updateSourcePond,
  disposeSourcePond,
  createOceanSurfaceDetail,
  updateOceanSurfaceDetail,
  disposeOceanSurfaceDetail,
};
