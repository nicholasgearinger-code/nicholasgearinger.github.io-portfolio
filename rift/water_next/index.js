// Experimental water-system composition root. NOT enabled in production.
// Safe to initialize alongside legacy water; this does not modify GPU state.
import { createWaveField, validateWaveField } from "./wave_field.js";
import { createWaterGeometryAdapter } from "./geometry.js";
import { createOpticsAdapter } from "./optics.js";
import { createCausticsAdapter } from "./caustics.js";
import { createFoamAdapter } from "./foam.js";

export function createNextWaterSystem({ simulation, mesh, material, terrainMaterial, shoreSolver, fftDomain = null, enableExperimentalGeometry = false, enableExperimentalOptics = false, reflectionTexture = null, reflectionMatrix = null, refractionTexture = null } = {}) {
  const field = createWaveField(simulation, { domain: fftDomain });
  if (!validateWaveField(field)) throw new Error("Invalid wave field");
  const geometry = createWaterGeometryAdapter({ mesh, field, shoreSolver });
  let optics;
  try {
    optics = createOpticsAdapter({ field, material: material ?? mesh.material, geometry,
      reflectionTexture, reflectionMatrix, refractionTexture });
    if (enableExperimentalGeometry) geometry.apply();
    if (enableExperimentalGeometry && enableExperimentalOptics) optics.apply();
  } catch (error) {
    try { optics?.restore(); } catch (_) {}
    try { geometry.restore(); } catch (_) {}
    throw error;
  }
  let sceneCaptureEnabled = false;
  function attachSceneCaptures({ reflectionTexture, reflectionMatrix, refractionTexture } = {}) {
    if (sceneCaptureEnabled || !geometry.active) return false;
    if (!reflectionTexture?.isTexture || !reflectionMatrix?.isMatrix4 ||
        !refractionTexture?.isTexture) return false;
    // Replace the lightweight fallback graph with scene-based optics once
    // textures are populated. Never switch the current production renderer.
    const replacement = createOpticsAdapter({ field, material: material ?? mesh.material,
      geometry, reflectionTexture, reflectionMatrix, refractionTexture });
    optics.restore();
    optics = replacement;
    optics.apply();
    sceneCaptureEnabled = true;
    return true;
  }
  const caustics = createCausticsAdapter({ field, terrainMaterial });
  const foam = createFoamAdapter({ field, shoreSolver });
  return {
    field, geometry, get optics() { return optics; }, caustics, foam,
    get sceneCaptureEnabled() { return sceneCaptureEnabled; },
    attachSceneCaptures,
    update(context = {}) {
      geometry.update(context);
      optics.update(context);
      caustics.update(context);
      foam.update(context);
    },
    dispose() {
      foam.dispose(); caustics.dispose(); optics.dispose(); geometry.dispose();
    },
  };
}
