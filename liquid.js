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

function attachWorldLighting(scene, biome, waterY, handle) {
  const lighting = ensureRealisticWorldLighting(scene, biome, waterY);
  if (lighting) setRealisticLightingBiome(lighting, biome);
  if (handle && typeof handle === "object") {
    handle.worldLighting = lighting;
    handle.worldLightingBiome = biome;
    // Crystal is the only full open-ocean level. Give it a dedicated, cheap
    // underwater atmosphere that runs through this same already-existing liquid
    // update hook instead of adding another hot-loop dependency to main.js.
    handle.underwaterWorld = biome === "crystal"
      ? ensureUnderwaterWorld(scene, waterY)
      : null;
  }
  return handle;
}

// Compatibility router: Crystal uses the new GPU FFT ocean. Ember, Verdant,
// waterfalls, rivers, ponds, cliff helpers, and every other liquid feature
// remain delegated to the exact preserved legacy module. The realistic world
// lighting pass is attached here because every playable biome already routes its
// primary liquid surface through this function, letting us improve lighting
// without disturbing the large, battle-tested main.js render loop.
function createLiquidPlane(scene, biome, y, size, sampleHeight, flowDir = { x: 0.6, z: 0.35 }, excludeRegions = []) {
  if (biome === "crystal") {
    const handle = createGPUFFTOceanPlane(scene, y, size, sampleHeight);
    return attachWorldLighting(scene, biome, y, handle);
  }
  const handle = legacy.createLiquidPlane(scene, biome, y, size, sampleHeight, flowDir, excludeRegions);
  return attachWorldLighting(scene, biome, y, handle);
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

  // Run after dayNightCycle has authored this frame's base sun/ambient values.
  // v4 also keeps the visible sun/moon camera-relative to the player so the
  // celestial discs stay aligned with the actual lighting direction while the
  // player moves around the world.
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

  // Underwater atmosphere is deliberately applied AFTER the normal world-light
  // pass. Above water it becomes a no-op; below the Crystal ocean it filters the
  // existing key light, adds cheap diffuse water-column fill, depth fog, motes,
  // and a few soft surface shafts. No second scene render is introduced.
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
  // This is the one existing liquid hook that already receives the renderer.
  // Use it to apply smooth eye adaptation and the WebGPU-safe real-shadow
  // configuration without adding another dependency to main.js's hot loop.
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
