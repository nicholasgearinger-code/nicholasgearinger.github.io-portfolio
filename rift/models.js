import * as THREE from "three";
import * as current from "./models_lighting_base.js";

export * from "./models_lighting_base.js";

// These two source assets are not currently usable in the deployed repo:
// - models/reef.glb is absent, so requesting it always produces a 404.
// - models/animated_swimming_tropical_fish_school_loop.glb is only a 2-byte
//   placeholder, not a binary glTF, so GLTFLoader cannot parse it.
// Both features were already optional at their call sites. Resolve them as
// unavailable without making doomed network requests; createRealReef() and
// createRealFishSchool() naturally return null because their base caches remain
// empty. Re-enable the base loaders once real assets are committed.
export function loadReefModel() {
  return Promise.resolve(null);
}

export function loadFishSchoolModel() {
  return Promise.resolve(null);
}

function tuneFoliageMaterial(material) {
  if (!material) return;
  if (Array.isArray(material)) {
    for (const mat of material) tuneFoliageMaterial(mat);
    return;
  }

  material.userData = material.userData || {};
  if (material.userData.riftNaturalFoliageLightingV3) return;

  material.side = THREE.DoubleSide;
  material.toneMapped = true;
  if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;

  // Palm leaves are broad, rough dielectric surfaces. Clamp glossy PBR channels
  // hard enough that low-angle sun/environment light cannot bleach fronds white.
  if ("metalness" in material) material.metalness = 0.0;
  if ("roughness" in material) {
    material.roughness = Math.max(0.99, Number(material.roughness) || 0);
  }
  if ("envMapIntensity" in material) {
    material.envMapIntensity = Math.min(0.06, Number(material.envMapIntensity) || 0.06);
  }
  if ("specularIntensity" in material) {
    material.specularIntensity = Math.min(0.04, Number(material.specularIntensity) || 0.04);
  }
  if ("clearcoat" in material) material.clearcoat = 0.0;
  if ("clearcoatRoughness" in material) material.clearcoatRoughness = 1.0;
  if ("iridescence" in material) material.iridescence = 0.0;
  if ("sheen" in material) material.sheen = 0.0;
  if (material.emissive?.isColor) material.emissive.set(0x000000);
  if ("emissiveIntensity" in material) material.emissiveIntensity = 0.0;

  // Preserve authored hue/detail but keep the albedo ceiling below white clipping.
  if (material.color?.isColor) material.color.multiplyScalar(0.90);

  material.userData.riftNaturalFoliageLightingV3 = true;
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
