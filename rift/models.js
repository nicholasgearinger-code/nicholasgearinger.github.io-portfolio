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

let palmTreeGLTF = null;
let palmTreeLoadPromise = null;
function loadPalmTreeModel() {
  if (palmTreeGLTF) return Promise.resolve(palmTreeGLTF);
  if (palmTreeLoadPromise) return palmTreeLoadPromise;
  const url = new URL("models/palmtree.glb", import.meta.url).href;
  palmTreeLoadPromise = new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => { palmTreeGLTF = gltf; console.log("[models] palm tree loaded:", url); resolve(gltf); },
      undefined,
      (err) => { console.error("[models] palm tree FAILED to load:", url, err); reject(err); }
    );
  });
  return palmTreeLoadPromise;
}

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

// The source file's "Palm_2" group bundles the FINAL baked/lit tree mesh
// ("Palm_2_Lit_0") alongside ~26 separate, much larger overlapping
// variant/source sub-groups (M_Palm_P2_31, M_Palm_P2_30, ... all sharing
// the same origin, no spatial offset between them) — almost certainly
// leftover modeling-process source meshes, not meant to be rendered
// together. Verified via direct inspection of the glTF JSON (node
// hierarchy + accessor min/max bounds): "Palm_2_Lit_0" measures ~100
// units across, the 26 variant groups each measure roughly 1500-4000
// units across on their own — using the WHOLE "Palm_2" parent (as an
// earlier version of this function did) clones all 27 overlapping,
// wildly oversized pieces at once. Using just the named "Palm_2_Lit_0"
// child is both correct (one tree, not 27 stacked on each other) and far
// cheaper (1 mesh instead of 55).
function createRealPalmTree() {
  if (!palmTreeGLTF) return null; // caller's responsibility to await loadPalmTreeModel() first
  const source = palmTreeGLTF.scene.getObjectByName("Palm_2_Lit_0");
  if (!source) { console.error("[models] palm tree: 'Palm_2_Lit_0' not found in loaded scene — falling back to null rather than the oversized full bundle"); return null; }
  const group = source.clone(true); // deep clone — safe for a static (non-skinned) model, shares the underlying geometry/material buffers (cheap) but gets its own independent transform hierarchy so each placement can be positioned/rotated/scaled independently
  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      // Defensive, per "still no shadow under the trees in daylight"
      // report: thin frond/leaf geometry authored as flat planes is very
      // commonly single-sided (THREE's own FrontSide default) — whichever
      // way its winding happens to face relative to the sun's current
      // direction, the OTHER side contributes nothing to the shadow depth
      // pass. DoubleSide costs a bit more fragment work but guarantees
      // foliage shadows regardless of the sun's angle or the source
      // asset's own winding. Geometry bounds explicitly recomputed too —
      // shared by reference from the cached source (clone() doesn't
      // duplicate geometry data), so if the ORIGINAL never had correct
      // bounds this makes every instance correct rather than trusting it
      // carried over right.
      if (obj.material) obj.material.side = THREE.DoubleSide;
      if (obj.geometry) { obj.geometry.computeBoundingSphere(); obj.geometry.computeBoundingBox(); }
    }
  });
  return group;
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
function createRealReef() {
  if (!reefGLTF) return null; // caller's responsibility to await loadReefModel() first
  const group = reefGLTF.scene.clone(true);
  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      if (obj.material) obj.material.side = THREE.DoubleSide; // same defensive reasoning as the palm tree's own fronds — thin ledge/coral geometry can be single-sided in the source file
      if (obj.geometry) { obj.geometry.computeBoundingSphere(); obj.geometry.computeBoundingBox(); }
    }
  });
  return group;
}

export { loadPalmTreeModel, loadAngelfishModel, loadReefModel, createRealPalmTree, createRealAngelfish, createRealReef };
