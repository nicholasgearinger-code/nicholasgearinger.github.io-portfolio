import * as THREE from "three";
import * as current from "./models_lighting_base.js";
import "./ktx2ModelSupport.js";

export * from "./models_lighting_base.js";

// -----------------------------------------------------------------------------
// Environment Performance 1.2 — KTX2-safe model warm-up.
//
// runtime_bootstrap_v3 intentionally preloads models before main_game creates the
// WebGPU renderer. That was fine for ordinary embedded PNG/JPEG GLBs, but a KTX2
// GLB needs KTX2Loader.detectSupport(renderer) before GLTFLoader can decode the
// KHR_texture_basisu images. During preflight we therefore FETCH ONLY. The exact
// compressed GLB bytes are warmed into the browser cache, then the original model
// loaders parse them after WebGPURenderer.init() has completed. ktx2ModelSupport.js
// transparently attaches a shared KTX2Loader at that point.
// -----------------------------------------------------------------------------

const prefetchPromises = new Map();

function rendererReady() {
  return globalThis.__riftRuntimePreloader?.rendererReady === true;
}

function prefetchModel(filename) {
  const url = new URL(`models/${filename}`, import.meta.url).href;
  if (prefetchPromises.has(url)) return prefetchPromises.get(url);

  const promise = fetch(url, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`${filename}: HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then((buffer) => {
      globalThis.__riftKTX2Prefetch = globalThis.__riftKTX2Prefetch || {
        files: 0,
        bytes: 0,
      };
      globalThis.__riftKTX2Prefetch.files++;
      globalThis.__riftKTX2Prefetch.bytes += buffer.byteLength;
      return null;
    });

  prefetchPromises.set(url, promise);
  return promise;
}

const CORAL_FILES = {
  stylaster: "stylaster.glb",
  pocillopora: "pocillopora.glb",
  goniastrea: "goniastrea.glb",
  meandrina: "meandrina.glb",
  heliopora: "heliopora.glb",
  acropora: "acropora.glb",
  distichopora: "distichopora.glb",
};

const TREE_FILES = {
  coconut_low_poly: "coconut_low_poly.glb",
  coconut_palm: "coconut_palm.glb",
  palm_001: "palm_trees.glb",
  palm_002: "palm_trees.glb",
};

export function loadAngelfishModel() {
  return rendererReady()
    ? current.loadAngelfishModel()
    : prefetchModel("angelfish.glb");
}

export function loadCoralModel(species) {
  const filename = CORAL_FILES[species];
  if (!filename) return Promise.reject(new Error(`Unknown coral species: ${species}`));
  return rendererReady()
    ? current.loadCoralModel(species)
    : prefetchModel(filename);
}

export function loadTreeModel(species) {
  const filename = TREE_FILES[species];
  if (!filename) return Promise.reject(new Error(`Unknown tree species: ${species}`));
  return rendererReady()
    ? current.loadTreeModel(species)
    : prefetchModel(filename);
}

export function loadSpongeModel() {
  return rendererReady()
    ? current.loadSpongeModel()
    : prefetchModel("9_aplysina_fistularis.glb");
}

export function loadPlantModel() {
  return rendererReady()
    ? current.loadPlantModel()
    : prefetchModel("tropical_plant.glb");
}

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
