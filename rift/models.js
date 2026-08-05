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

// The source file bundles the whole tree (trunk + several frond/leaf
// clusters, ~55 meshes total) under one top-level "Palm_2" group rather
// than several separate alternate trees to choose between — cloning that
// whole group wholesale is the correct usage, not cherry-picking a
// sub-piece of it.
function createRealPalmTree() {
  if (!palmTreeGLTF) return null; // caller's responsibility to await loadPalmTreeModel() first
  const group = palmTreeGLTF.scene.clone(true); // deep clone — safe for a static (non-skinned) model, shares the underlying geometry/material buffers (cheap) but gets its own independent transform hierarchy so each placement can be positioned/rotated/scaled independently
  group.traverse((obj) => {
    if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
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

export { loadPalmTreeModel, loadAngelfishModel, createRealPalmTree, createRealAngelfish };
