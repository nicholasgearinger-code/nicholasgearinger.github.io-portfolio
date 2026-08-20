import {
  createGPUSurfSystem as createBaseSurf,
  updateGPUSurfSystem as updateBaseSurf,
  disposeGPUSurfSystem as disposeBaseSurf,
} from "./gpu_surf_system_v4.js";
import {
  createGPUSwashSolver,
  updateGPUSwashSolver,
  updateGPUSwashVisuals,
  disposeGPUSwashSolver,
} from "./gpu_swash_solver_v2.js";

// -----------------------------------------------------------------------------
// Surf v5: keep v4's bounded rolling breaker geometry + lightweight spray, but
// replace its painted/procedural beach wash with a real GPU swash simulation.
// The fluid strip is driven from the existing shallow-water solution, supports
// wetting/drying on the sampled beach slope, and advects foam concentration with
// the solved velocity field during both run-up and backwash.
// -----------------------------------------------------------------------------

function disposeProceduralLayer(scene, layer) {
  if (!layer) return;
  if (layer.mesh) scene?.remove(layer.mesh);
  try { layer.geometry?.dispose?.(); } catch (_) {}
  try { layer.material?.dispose?.(); } catch (_) {}
}

function removeProceduralWash(scene, handle) {
  if (!handle) return;
  disposeProceduralLayer(scene, handle.wash);
  disposeProceduralLayer(scene, handle.wetSand);
  handle.wash = null;
  handle.wetSand = null;
}

export function createGPUSurfSystem(scene, sampleHeight, waterY, shallowHandle) {
  const handle = createBaseSurf(scene, sampleHeight, waterY, shallowHandle);
  if (!handle?.gpuSurfSystem) return handle;

  // v4 constructs its historical painted wash/wet-sand layers as part of the
  // base surf bundle. They are no longer merely hidden: remove and dispose them
  // immediately so only the simulated swash owns beach water/foam resources.
  removeProceduralWash(scene, handle);

  handle.fluidSwash = createGPUSwashSolver(
    scene,
    sampleHeight,
    waterY,
    shallowHandle,
    handle.shoreline,
  );
  handle.fluidFoam = !!handle.fluidSwash;

  if (handle.fluidSwash) {
    console.info("[gpu-surf] ACTIVE: simulated swash + transported whitewater on sand");
  }
  return handle;
}

export function updateGPUSurfCompute(handle, renderer, elapsedTime = 0) {
  if (!handle?.gpuSurfSystem || !handle.fluidSwash?.gpuSwash) return;
  updateGPUSwashSolver(handle.fluidSwash, renderer, elapsedTime);
}

export function updateGPUSurfSystem(handle, elapsed, cameraY, storm = 0, day = 1, sunDir = null) {
  if (!handle?.gpuSurfSystem) return;

  // v4 still owns the bounded breaker crest geometry and spray/mist animation.
  // wash/wetSand are null, so its update loop naturally skips those obsolete
  // resources instead of touching invisible materials every frame.
  updateBaseSurf(handle, elapsed, cameraY, storm, day, sunDir);

  if (handle.fluidSwash?.gpuSwash) {
    updateGPUSwashVisuals(handle.fluidSwash, cameraY, storm, day);
    const underwater = Number.isFinite(cameraY) && cameraY < handle.waterY - 0.10;
    handle.fluidSwash.mesh.visible = !underwater;
  }
}

export function disposeGPUSurfSystem(scene, handle) {
  if (!handle?.gpuSurfSystem) return;
  if (handle.fluidSwash?.gpuSwash) {
    disposeGPUSwashSolver(scene, handle.fluidSwash);
  }
  handle.fluidSwash = null;
  disposeBaseSurf(scene, handle);
}
