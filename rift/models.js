import * as THREE from "three";
import * as current from "./models_lighting_base.js";

export * from "./models_lighting_base.js";

function tuneFoliageMaterial(material) {
  if (!material) return;
  if (Array.isArray(material)) {
    for (const mat of material) tuneFoliageMaterial(mat);
    return;
  }

  material.userData = material.userData || {};
  if (material.userData.riftNaturalFoliageLightingV2) return;

  material.side = THREE.DoubleSide;
  material.toneMapped = true;
  if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;

  // Palm leaves are broad, rough dielectric surfaces. Clamp all of the glossy
  // PBR channels so low-angle sun/environment light cannot clip fronds white.
  if ("metalness" in material) material.metalness = 0.0;
  if ("roughness" in material) material.roughness = Math.max(0.97, Number(material.roughness) || 0);
  if ("envMapIntensity" in material) material.envMapIntensity = Math.min(0.14, Number(material.envMapIntensity) || 0.14);
  if ("specularIntensity" in material) material.specularIntensity = Math.min(0.08, Number(material.specularIntensity) || 0.08);
  if ("clearcoat" in material) material.clearcoat = 0.0;
  if ("clearcoatRoughness" in material) material.clearcoatRoughness = 1.0;
  if ("iridescence" in material) material.iridescence = 0.0;
  if ("sheen" in material) material.sheen = 0.0;
  if (material.emissive?.isColor) material.emissive.set(0x000000);
  if ("emissiveIntensity" in material) material.emissiveIntensity = 0.0;

  // Leave authored texture hue intact, but lower the reflectance ceiling enough
  // that sun-facing texels retain green/brown detail instead of becoming white.
  if (material.color?.isColor) material.color.multiplyScalar(0.84);

  material.userData.riftNaturalFoliageLightingV2 = true;
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
