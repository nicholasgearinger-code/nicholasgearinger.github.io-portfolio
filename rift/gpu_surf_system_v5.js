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

function suppressProceduralWash(handle) {
  if (handle?.wash?.mesh) handle.wash.mesh.visible = false;
  if (handle?.wetSand?.mesh) handle.wetSand.mesh.visible = false;
}

export function createGPUSurfSystem(scene, sampleHeight, waterY, shallowHandle) {
  const handle = createBaseSurf(scene, sampleHeight, waterY, shallowHandle);
  if (!handle?.gpuSurfSystem) return handle;

  suppressProceduralWash(handle);
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

  // Breaker crest geometry and spray remain from v4. Immediately suppress the
  // old procedural wash again because v4's updater intentionally re-enables it
  // whenever the camera is above water.
  updateBaseSurf(handle, elapsed, cameraY, storm, day, sunDir);
  suppressProceduralWash(handle);

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
