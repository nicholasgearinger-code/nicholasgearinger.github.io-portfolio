import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";

// -----------------------------------------------------------------------------
// SWAP POINT: real GLB/GLTF model loading — Coral Shallows only so far (a
// realistic palm tree, an animated reef fish). Distinct from every other
// decoration/wildlife in this project, which are all procedurally built
// from primitive THREE.js geometry (see decorations.js/wildlife.js).
// Loading is genuinely ASYNC (GLTFLoader.load, not the synchronous
// procedural-creation pattern everywhere else) — a model arrives whenever
// the browser finishes fetching/parsing it, not necessarily before the
// rest of the level has finished building. Each loader caches its result
// at module level (load once, reuse the same parsed scene/animations for
// every future instance, including across level reloads) so re-entering
// this biome doesn't re-fetch a multi-megabyte asset a second time.
//
// NOT VERIFIED IN-BROWSER — this whole file is new, higher-risk territory
// than anything else touched this session (external binary assets,
// genuine async loading with a level-switch race condition to guard
// against, skeletal animation cloning). Inspected both .glb files'
// internal JSON structure directly (struct/json, no live three.js
// available in this environment) to get node names, mesh/animation
// counts, and the skin right, but the actual load/render was never
// exercised.
// -----------------------------------------------------------------------------

// REMOVED per explicit "remove the old tree models since it's not
// working" — loadPalmTreeModel/createRealPalmTree (palmtree.glb) are
// gone. See createRealTree/TREE_FILES below for the replacement set.

let angelfishGLTF = null;
let angelfishLoadPromise = null;
function loadAngelfishModel() {
  if (angelfishGLTF) return Promise.resolve(angelfishGLTF);
  if (angelfishLoadPromise) return angelfishLoadPromise;
  const url = new URL("models/angelfish.glb", import.meta.url).href;
  angelfishLoadPromise = new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => { angelfishGLTF = gltf; console.log("[models] angelfish loaded:", url, "animations:", gltf.animations.map((a) => a.name)); resolve(gltf); },
      undefined,
      (err) => { console.error("[models] angelfish FAILED to load:", url, err); reject(err); }
    );
  });
  return angelfishLoadPromise;
}

let reefGLTF = null;
let reefLoadPromise = null;
// DRACOLoader wiring TEMPORARILY REMOVED — right after adding it, the
// whole game stopped loading. Since ES module imports fail all-or-
// nothing, a bad import path here is a far more likely explanation than
// a scoped reef-only bug, and it's a much more severe failure mode than
// anything else touched this session. Reverted to plain GLTFLoader
// (which will fail to load the Draco-compressed reef.glb specifically,
// caught by the existing .catch() below — the reef just won't appear)
// so the REST of the game works again while this gets properly diagnosed
// from an actual browser console error rather than guessed at blind.
function loadReefModel() {
  if (reefGLTF) return Promise.resolve(reefGLTF);
  if (reefLoadPromise) return reefLoadPromise;
  const url = new URL("models/reef.glb", import.meta.url).href;
  reefLoadPromise = new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => { reefGLTF = gltf; console.log("[models] reef loaded:", url); resolve(gltf); },
      undefined,
      (err) => { console.error("[models] reef FAILED to load:", url, err); reject(err); }
    );
  });
  return reefLoadPromise;
}



/**
 * Creates ONE real animated angelfish instance — a genuine skeletal clone
 * (SkeletonUtils.clone, NOT a plain Object3D/scene.clone, which does not
 * correctly duplicate bone/skin bindings) so multiple fish can share the
 * same loaded mesh/skin data while each animates completely
 * independently, plus its own AnimationMixer/action so instances can be
 * phase-offset (started at a random point in the swim cycle) rather than
 * all swimming in perfect unison.
 * @returns {{group: THREE.Group, mixer: THREE.AnimationMixer}|null}
 */
function createRealAngelfish() {
  if (!angelfishGLTF) return null; // caller's responsibility to await loadAngelfishModel() first
  const group = skeletonClone(angelfishGLTF.scene);
  group.traverse((obj) => {
    if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = false; } // fish don't need to receive their own shadow — keeps this cheap
  });
  const mixer = new THREE.AnimationMixer(group);
  const clip = angelfishGLTF.animations[0]; // "Swim3_Long_Wide" — the only clip in this file
  let action = null;
  if (clip) {
    action = mixer.clipAction(clip);
    action.time = Math.random() * clip.duration; // phase-offset so multiple fish don't swim in lockstep
    action.play();
  }
  return { group, mixer, action };
}

/**
 * Creates ONE real reef structure instance — unlike the palm tree's
 * source file, this one's node hierarchy checks out as genuine geometry:
 * 33 submeshes sharing a single material, bounds NOT suspiciously cubic
 * (10.18 x 10.17 x 3.3 — a real elongated ledge shape, matching the
 * source filename "long_ledges_reef_community"), so the whole loaded
 * scene is cloned wholesale rather than needing to cherry-pick one named
 * child the way the palm tree did.
 */
let reefLitMaterial = null; // built once, lazily, reused across every reef clone — see its own comment below

function createRealReef() {
  if (!reefGLTF) return null; // caller's responsibility to await loadReefModel() first
  const group = reefGLTF.scene.clone(true);
  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      // The optimized/decimated source file (111MB -> 5.6MB) dropped
      // vertex normals entirely and converted the material to
      // KHR_materials_unlit — presumably part of how the optimizer got
      // the size down. THREE's GLTFLoader turns that into a
      // MeshBasicMaterial, which doesn't react to the scene's real
      // sun/moon lighting at all — every other real GLB model in this
      // project (palm tree, fish) IS properly lit, so left as-is this
      // would be the one flat/unlit exception. Two real fixes: (1)
      // geometry has no NORMAL attribute anymore, so
      // computeVertexNormals() rebuilds one directly from the (still
      // fully intact) triangle data — a standard, safe operation, not
      // guessing at anything; (2) material swapped to a real
      // MeshStandardMaterial that reuses the SAME diffuse texture the
      // unlit material was already using, built ONCE and reused across
      // every clone (not per-instance) since all 15 reef pieces share
      // the identical look anyway.
      if (obj.geometry && !obj.geometry.attributes.normal) {
        obj.geometry.computeVertexNormals();
      }
      if (obj.material) {
        if (!reefLitMaterial) {
          reefLitMaterial = new THREE.MeshStandardMaterial({
            map: obj.material.map || null,
            roughness: 0.95,
            metalness: 0.02,
            side: THREE.DoubleSide, // same defensive reasoning as the palm tree's own fronds — thin ledge/coral geometry can be single-sided in the source file
          });
        }
        obj.material = reefLitMaterial;
      }
      if (obj.geometry) { obj.geometry.computeBoundingSphere(); obj.geometry.computeBoundingBox(); }
    }
  });
  return group;
}

// Coral pieces — 3 real species (stylaster, pocillopora, goniastrea),
// all sharing the same clean structure (unlike the palm tree/reef, no
// fixups needed: normals intact, standard lit PBR materials, no
// suspicious bundled variants) so ONE generic implementation handles all
// three rather than tripling near-identical code. The one real gotcha:
// raw bounds are genuinely tiny (0.02-0.24 units) — these are authored
// at true real-world scale (real coral colonies really are centimeter-
// to-decimeter sized), not a broken export like the palm tree/fish were,
// so this just needs a real upscale multiplier at placement time, not a
// structural fix.
const CORAL_FILES = {
  stylaster: "stylaster.glb",
  pocillopora: "pocillopora.glb",
  goniastrea: "goniastrea.glb",
  meandrina: "meandrina.glb",
  heliopora: "heliopora.glb",
  acropora: "acropora.glb",
  distichopora: "distichopora.glb",
};
const coralGLTFs = {};
const coralLoadPromises = {};
function loadCoralModel(species) {
  if (coralGLTFs[species]) return Promise.resolve(coralGLTFs[species]);
  if (coralLoadPromises[species]) return coralLoadPromises[species];
  const filename = CORAL_FILES[species];
  const url = new URL(`models/${filename}`, import.meta.url).href;
  coralLoadPromises[species] = new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => { coralGLTFs[species] = gltf; console.log(`[models] coral (${species}) loaded:`, url); resolve(gltf); },
      undefined,
      (err) => { console.error(`[models] coral (${species}) FAILED to load:`, url, err); reject(err); }
    );
  });
  return coralLoadPromises[species];
}

function createRealCoral(species) {
  const gltf = coralGLTFs[species];
  if (!gltf) return null; // caller's responsibility to await loadCoralModel(species) first
  const group = gltf.scene.clone(true);
  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      if (obj.material) {
        obj.material.side = THREE.DoubleSide; // same defensive reasoning as the palm tree/reef — coral branch geometry can be thin/single-sided
        // Defensive, per "appears black, no color" report — GLTFLoader
        // is SUPPOSED to set this correctly on its own for a baseColor
        // texture, and the source files' embedded images decode cleanly
        // on inspection, so this alone probably isn't the real cause
        // (most likely still a texture-decode issue from the same
        // upload-corruption class as the earlier RangeError) — but
        // forcing it explicitly costs nothing and rules this out as a
        // contributing factor either way.
        if (obj.material.map) obj.material.map.colorSpace = THREE.SRGBColorSpace;
      }
      if (obj.geometry) { obj.geometry.computeBoundingSphere(); obj.geometry.computeBoundingBox(); }
    }
  });
  return group;
}

// New tree set, replacing the old palm tree entirely. 3 source files, 4
// usable trees: coconut_low_poly and coconut_palm each load+clone their
// WHOLE scene (single cohesive tree, verified — coconut_palm's 5
// "Tree_N" meshes overlap/stack by height rather than sitting at
// separate offsets, i.e. they're the bark+multiple-frond-layer PARTS of
// ONE tree, not 5 duplicate variants the way the old palm bundle was).
// palm_trees.glb is genuinely different: it bundles TWO distinct tree
// variants ("Palm_tree_001_v2" and "Palm_tree_002_v2", each internally
// made of ~5 material-part sub-meshes) both anchored at the same shared
// origin — verified via each mesh's own accessor bounds, same diagnostic
// approach the old palm bundle needed. Extracted as two separate usable
// trees (palm_001/palm_002) via getObjectByName, not merged.
//
// SCALE: all three files carry a root FBX-style Z-up-to-Y-up correction
// matrix, which makes raw pre-transform accessor bounds unreliable for
// figuring out true rendered height by eye (an axis mix-up here would
// repeat the exact float/sink mistake the original palm tree made).
// Sidestepped entirely rather than risked: createRealTree measures each
// tree's ACTUAL height via Box3.setFromObject AFTER cloning (which
// correctly composes every parent transform, including that correction
// matrix) and normalizes it to exactly 1 world unit tall. The caller
// (main.js) then applies its own real target scale on top of that
// normalized size — the same division of responsibility already used
// for coral (models.js corrects/normalizes the source data, main.js
// picks the natural in-game size and variety).
const TREE_FILES = {
  coconut_low_poly: { file: "coconut_low_poly.glb", nodeName: null },
  coconut_palm: { file: "coconut_palm.glb", nodeName: null },
  palm_001: { file: "palm_trees.glb", nodeName: "Palm_tree_001_v2" },
  palm_002: { file: "palm_trees.glb", nodeName: "Palm_tree_002_v2" },
};
const treeGLTFs = {}; // keyed by FILE (not species) — palm_001/palm_002 share one loaded file
const treeLoadPromises = {};
function loadTreeModel(species) {
  const { file } = TREE_FILES[species];
  if (treeGLTFs[file]) return Promise.resolve(treeGLTFs[file]);
  if (treeLoadPromises[file]) return treeLoadPromises[file];
  const url = new URL(`models/${file}`, import.meta.url).href;
  treeLoadPromises[file] = new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => { treeGLTFs[file] = gltf; console.log(`[models] tree file loaded:`, url); resolve(gltf); },
      undefined,
      (err) => { console.error(`[models] tree file FAILED to load:`, url, err); reject(err); }
    );
  });
  return treeLoadPromises[file];
}

function createRealTree(species) {
  const { file, nodeName } = TREE_FILES[species];
  const gltf = treeGLTFs[file];
  if (!gltf) return null; // caller's responsibility to await loadTreeModel(species) first
  const source = nodeName ? gltf.scene.getObjectByName(nodeName) : gltf.scene;
  if (!source) { console.error(`[models] tree (${species}): node '${nodeName}' not found in loaded scene`); return null; }
  const group = source.clone(true);
  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      // Same defensive reasoning as every other real GLB in this project
      // — thin frond/leaf geometry is very commonly single-sided, and
      // whichever way it happens to face relative to the sun breaks
      // shadow casting from the other side otherwise.
      if (obj.material) obj.material.side = THREE.DoubleSide;
      if (obj.geometry) { obj.geometry.computeBoundingSphere(); obj.geometry.computeBoundingBox(); }
    }
  });
  // Height-normalize to exactly 1 world unit — see this block's own
  // top-of-section comment for why this is measured at runtime instead
  // of computed from raw accessor numbers.
  group.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(group);
  const rawHeight = bbox.max.y - bbox.min.y;
  if (rawHeight > 0.0001) group.scale.multiplyScalar(1 / rawHeight);
  // Re-measure after normalizing so the caller gets an accurate ground-
  // contact offset regardless of whether this tree's origin sits at its
  // base or its center (varies per source file — palm_001/palm_002 in
  // particular are unlikely to be base-aligned given they're cherry-
  // picked sub-nodes, not the file's own designed-to-be-placed root).
  group.updateMatrixWorld(true);
  const normalizedBbox = new THREE.Box3().setFromObject(group);
  group.userData.groundOffset = -normalizedBbox.min.y; // caller adds this (scaled by their own final size) to groundY so the trunk base sits at the sand, not floating or sunk in
  return group;
}

export { loadAngelfishModel, loadReefModel, loadCoralModel, loadTreeModel, createRealAngelfish, createRealReef, createRealCoral, createRealTree };
