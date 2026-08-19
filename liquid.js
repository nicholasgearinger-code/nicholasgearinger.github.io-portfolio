import * as legacy from "./liquid_legacy.js";
import {
  createGPUFFTOceanPlane,
  updateGPUFFTOcean,
  updateGPUFFTOceanVisuals,
  disposeGPUFFTOcean,
} from "./gpu_fft_ocean.js";

// Compatibility router: Crystal uses the new GPU FFT ocean. Ember, Verdant,
// waterfalls, rivers, ponds, cliff helpers, and every other liquid feature
// remain delegated to the exact preserved legacy module.
function createLiquidPlane(scene, biome, y, size, sampleHeight, flowDir = { x: 0.6, z: 0.35 }, excludeRegions = []) {
  if (biome === "crystal") {
    return createGPUFFTOceanPlane(scene, y, size, sampleHeight);
  }
  return legacy.createLiquidPlane(scene, biome, y, size, sampleHeight, flowDir, excludeRegions);
}

function updateLiquidPlane(handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon, reflectionTexture, reflectionMatrix, refractionTexture, resolution, stormAmount = 0, dayAmount = 1) {
  if (handle?.gpuFFT) {
    updateGPUFFTOceanVisuals(
      handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon,
      reflectionTexture, reflectionMatrix, refractionTexture, resolution,
      stormAmount, dayAmount,
    );
    return;
  }
  return legacy.updateLiquidPlane(
    handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon,
    reflectionTexture, reflectionMatrix, refractionTexture, resolution,
    stormAmount, dayAmount,
  );
}

async function updateFluidSimWater(handle, renderer) {
  if (handle?.gpuFFT) return updateGPUFFTOcean(handle, renderer);
  return legacy.updateFluidSimWater(handle, renderer);
}

function disposeLiquidPlane(scene, handle) {
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
