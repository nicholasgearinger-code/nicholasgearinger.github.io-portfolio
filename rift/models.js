import * as THREE from "three";
import * as current from "./models_lighting_base.js";

export * from "./models_lighting_base.js";

// -----------------------------------------------------------------------------
// Natural foliage material response
// -----------------------------------------------------------------------------
// The source palm GLBs use their authored PBR values almost untouched. Some
// frond materials are glossy enough to catch the environment/sun as hard white
// patches, especially at dawn/dusk when the rest of the scene is dark. This
// wrapper keeps all geometry/textures/instancing intact and only makes tree
// materials behave like real matte vegetation.

function tuneFoliageMaterial(material) {
  if (!material) return;
  if (Array.isArray(material)) {
    for (const mat of material) tuneFoliageMaterial(mat);
    return;
  }

  material.userData = material.userData || {};
  if (material.userData.riftNaturalFoliageLighting) return;

  material.side = THREE.DoubleSide;
  material.toneMapped = true;

  if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;

  // Real leaves/fronds are strongly non-metallic and broadly rough. Keeping
  // environment/specular response restrained prevents clipped white highlights
  // while preserving believable soft sheen on wet or sun-facing surfaces.
  if ("metalness" in material) material.metalness = 0.0;
  if ("roughness" in material) {
    const roughness = Number.isFinite(material.roughness) ? material.roughness : 0.85;
    material.roughness = Math.max(0.9, roughness);
  }
  if ("envMapIntensity" in material) {
    const env = Number.isFinite(material.envMapIntensity) ? material.envMapIntensity : 0.35;
    material.envMapIntensity = Math.min(0.35, env);
  }
  if ("specularIntensity" in material) {
    const spec = Number.isFinite(material.specularIntensity) ? material.specularIntensity : 0.25;
    material.specularIntensity = Math.min(0.25, spec);
  }
  if ("clearcoat" in material) material.clearcoat = 0.0;
  if ("clearcoatRoughness" in material) material.clearcoatRoughness = 1.0;
  if ("iridescence" in material) material.iridescence = 0.0;
  if ("sheen" in material) material.sheen = 0.0;

  if (material.emissive?.isColor) material.emissive.set(0x000000);
  if ("emissiveIntensity" in material) material.emissiveIntensity = 0.0;

  // Slightly lower the raw albedo ceiling so bright source textures still retain
  // color/detail under strong daylight instead of clipping to paper-white.
  if (material.color?.isColor) material.color.multiplyScalar(0.92);

  material.userData.riftNaturalFoliageLighting = true;
  material.needsUpdate = true;
}

function tuneTreeObject(object) {
  object?.traverse?.((child) => {
    if (child?.isMesh) tuneFoliageMaterial(child.material);
  });
  return object;
}

export function createRealTree(species) {
  return tuneTreeObject(current.createRealTree(species));
}

export function buildTreeInstances(speciesPlacements) {
  const handle = current.buildTreeInstances(speciesPlacements);
  if (!handle?.meshesBySpecies) return handle;

  for (const meshes of Object.values(handle.meshesBySpecies)) {
    for (const mesh of meshes || []) tuneFoliageMaterial(mesh?.material);
  }

  return handle;
}
