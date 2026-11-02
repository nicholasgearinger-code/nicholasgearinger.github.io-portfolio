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
  if (enableExperimentalGeometry) geometry.apply();
  const optics = createOpticsAdapter({ field, material: material ?? mesh.material, geometry,
    reflectionTexture, reflectionMatrix, refractionTexture });
  if (enableExperimentalGeometry && enableExperimentalOptics) optics.apply();
  const caustics = createCausticsAdapter({ field, terrainMaterial });
  const foam = createFoamAdapter({ field, shoreSolver });
  return {
    field, geometry, optics, caustics, foam,
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
