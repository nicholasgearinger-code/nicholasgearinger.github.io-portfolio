import * as THREE from "three";
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
} from "./gpu_swash_solver_v3.js";

// -----------------------------------------------------------------------------
// Surf v6
//
// Keep v4's bounded rolling breaker geometry and inexpensive spray, but:
//   • remove the old painted wash/wet-sand layers;
//   • use the v3 wet/dry swash solver for actual run-up/backwash foam;
//   • extend the last part of the breaker mesh slightly past mean shore so the
//     crest visibly collapses onto the beach instead of stopping at the line;
//   • push active spray/mist a little inland at impact.
//
// The beach water/foam itself still comes only from the GPU fluid state.
// -----------------------------------------------------------------------------

function smooth01(t) {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

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

function extendBreakerOntoBeach(handle) {
  const geometry = handle?.waves?.geometry;
  const pos = geometry?.getAttribute?.("position");
  const profile = geometry?.getAttribute?.("surfProfile");
  const shoreDir = geometry?.getAttribute?.("surfShoreDir");
  if (!pos || !profile || !shoreDir || handle.breakerBeachExtensionApplied) return;

  for (let i = 0; i < pos.count; i++) {
    const p = profile.getX(i);
    if (p <= 0.70) continue;

    const t = smooth01((p - 0.70) / 0.30);
    const shift = 1.35 * t;
    pos.setX(i, pos.getX(i) + shoreDir.getX(i) * shift);
    pos.setZ(i, pos.getZ(i) + shoreDir.getY(i) * shift);
  }

  pos.needsUpdate = true;
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  handle.breakerBeachExtensionApplied = true;
}

function pushImpactParticles(layer, elapsed, storm) {
  if (!layer?.points?.visible || !layer.geometry?.attributes?.position || !Array.isArray(layer.particles)) return;

  const arr = layer.geometry.attributes.position.array;
  for (let i = 0; i < layer.particles.length; i++) {
    const p = layer.particles[i];
    const idx = i * 3;
    if (arr[idx + 1] < -100) continue;

    const life = ((elapsed * p.speed + p.seed) % 1 + 1) % 1;
    const shore = p.shore;
    if (!shore) continue;

    const push = life * (layer.mist ? 0.42 : 0.82) * (1 + storm * 0.34);
    arr[idx] += shore.inwardX * push;
    arr[idx + 2] += shore.inwardZ * push;

    if (!layer.mist) {
      arr[idx + 1] += Math.sin(Math.PI * Math.min(1, life / 0.68)) * 0.10;
    }
  }

  layer.geometry.attributes.position.needsUpdate = true;
}

export function createGPUSurfSystem(scene, sampleHeight, waterY, shallowHandle) {
  const handle = createBaseSurf(scene, sampleHeight, waterY, shallowHandle);
  if (!handle?.gpuSurfSystem) return handle;

  removeProceduralWash(scene, handle);
  extendBreakerOntoBeach(handle);

  handle.fluidSwash = createGPUSwashSolver(
    scene,
    sampleHeight,
    waterY,
    shallowHandle,
    handle.shoreline,
  );
  handle.fluidFoam = !!handle.fluidSwash;

  if (handle.fluidSwash) {
    console.info("[gpu-surf] ACTIVE v6: breakers over shore + simulated run-up/backwash foam");
  }
  return handle;
}

export function updateGPUSurfCompute(handle, renderer, elapsedTime = 0) {
  if (!handle?.gpuSurfSystem || !handle.fluidSwash?.gpuSwash) return;
  updateGPUSwashSolver(handle.fluidSwash, renderer, elapsedTime);
}

export function updateGPUSurfSystem(handle, elapsed, cameraY, storm = 0, day = 1, sunDir = null) {
  if (!handle?.gpuSurfSystem) return;

  updateBaseSurf(handle, elapsed, cameraY, storm, day, sunDir);

  if (handle.fluidSwash?.gpuSwash) {
    updateGPUSwashVisuals(handle.fluidSwash, cameraY, storm, day);
    const underwater = Number.isFinite(cameraY) && cameraY < handle.waterY - 0.10;
    handle.fluidSwash.mesh.visible = !underwater;
  }

  const underwater = Number.isFinite(cameraY) && cameraY < handle.waterY - 0.10;
  if (!underwater) {
    const t = Number.isFinite(elapsed) ? elapsed : 0;
    const stormT = THREE.MathUtils.clamp(storm, 0, 1);
    pushImpactParticles(handle.spray, t, stormT);
    pushImpactParticles(handle.mist, t, stormT);
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
