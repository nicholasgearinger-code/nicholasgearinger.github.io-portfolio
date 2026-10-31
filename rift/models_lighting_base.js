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
  // Fetch as raw bytes first and sanity-check the binary-glTF magic
  // number before handing anything to GLTFLoader. The plain .load(url)
  // version of this (still used elsewhere in this file) surfaces a
  // "RangeError: Length out of range of buffer" for coconut_palm.glb and
  // palm_trees.glb specifically — that exact error, from that specific
  // loader, on a file that's genuinely present in the repo, is the
  // classic signature of Git LFS: GitHub Pages serves the small text
  // pointer file instead of the real binary blob, and GLTFLoader tries
  // to read a binary chunk-length header out of that text and blows up.
  // Checking here turns a useless RangeError into an actionable message.
  treeLoadPromises[file] = fetch(url)
    .then((res) => res.arrayBuffer())
    .then((buffer) => new Promise((resolve, reject) => {
      const headerBytes = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
      const magic = String.fromCharCode(...headerBytes);
      if (magic !== "glTF") {
        const preview = new TextDecoder().decode(buffer.slice(0, 200));
        const isLfsPointer = preview.startsWith("version https://git-lfs.github.com/spec");
        const reason = isLfsPointer
          ? `${file} is a Git LFS pointer file (text), not the real binary model — GitHub Pages does not serve LFS content directly. Run "git lfs untrack '${file}'" (or the matching glob), then re-add and commit the actual binary so it's a normal tracked file.`
          : `${file} does not start with the glTF binary magic number (got "${magic}"); first bytes: "${preview.slice(0, 80)}". This is not a valid .glb at this URL.`;
        reject(new Error(reason));
        return;
      }
      new GLTFLoader().parse(
        buffer,
        url,
        (gltf) => { treeGLTFs[file] = gltf; console.log(`[models] tree file loaded:`, url); resolve(gltf); },
        (err) => reject(err)
      );
    }))
    .catch((err) => { console.error(`[models] tree file FAILED to load:`, url, err.message || err); throw err; });
  return treeLoadPromises[file];
}

function createRealTree(species) {
  const { file, nodeName } = TREE_FILES[species];
  const gltf = treeGLTFs[file];
  if (!gltf) return null; // caller's responsibility to await loadTreeModel(species) first
  // REAL BUG FIXED HERE: previously cloned the found sub-node directly
  // (source.clone(true)) for palm_001/palm_002 — but a node found via
  // getObjectByName and cloned on its own loses its ANCESTORS' transforms
  // entirely, including the file's root FBX Z-up-to-Y-up correction
  // matrix (which lives above the per-variant nodes, not on them). That
  // clone's geometry ended up effectively un-rotated, so the height
  // measurement below was measuring the WRONG axis as "height" for those
  // two species specifically — exactly matching "one comically enormous,
  // one failed to load" (a near-zero or wildly wrong measured height
  // produces a wildly wrong or non-finite scale). Fixed by cloning the
  // WHOLE scene (correction matrix included) and then removing sibling
  // tree variants from within that correctly-transformed clone, rather
  // than extracting the target node in isolation.
  const group = gltf.scene.clone(true);
  if (nodeName) {
    const target = group.getObjectByName(nodeName);
    if (!target) { console.error(`[models] tree (${species}): node '${nodeName}' not found in loaded scene`); return null; }
    for (const sib of [...target.parent.children]) {
      if (sib !== target) target.parent.remove(sib);
    }
  }
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
  // DIAGNOSTIC per "two trees enormous, one tiny, confirmed not just
  // perspective" — coconut_palm/palm_001/palm_002 have never actually
  // rendered successfully before now (blocked by unrelated file-corruption
  // issues all session), so this exact normalization step has genuinely
  // never been observed live for those 3 species until this test. Logs
  // the RAW pre-normalization height and mesh count per species so the
  // next console check pinpoints exactly which one is measuring wrong,
  // instead of guessing again — a stray extra node with an outlier
  // bounding footprint (a leftover light/camera/empty from the source
  // export) is a real, concrete candidate here, the same category of bug
  // just found and fixed in a completely different file this session
  // (tropical_plant.glb's leftover "Lamp" node).
  let meshCount = 0;
  group.traverse((obj) => { if (obj.isMesh) meshCount++; });
  console.log(`[models] tree (${species}) raw height: ${rawHeight.toFixed(4)}, meshes: ${meshCount}, bbox min/max Y: ${bbox.min.y.toFixed(3)}/${bbox.max.y.toFixed(3)}`);
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

// -----------------------------------------------------------------------------
// Real instancing — per explicit "instance all objects... start with static
// objects like coral and trees." Converts many separate scene objects (each
// today a full GLTF scene clone, each its own draw call) into a handful of
// THREE.InstancedMesh objects — one per unique sub-mesh a model contains,
// batching every PLACED instance of that species into a single draw call.
//
// Deliberately reuses createRealCoral/createRealTree EXACTLY as they
// already work today — called ONCE per species (not once per placement) to
// build a single correctly-normalized "reference" object, never added to
// the scene itself, whose mesh parts (geometry/material/local transform)
// are extracted and cached. This does NOT reimplement any of the existing
// species-specific logic (palm_001/palm_002's sibling-node removal, the
// height-normalize-to-1-unit pass, coral's DoubleSide/colorSpace fixups) —
// all of that keeps running exactly as before, completely untouched; only
// the "clone the whole thing again for every single placement" part is
// being replaced with "clone it once per species, then just place it many
// times via lightweight per-instance matrices."
//
// NOT VERIFIED IN-BROWSER — first use of THREE.InstancedMesh in this
// project. Lower architectural risk than anything TSL/compute-related
// attempted this session (InstancedMesh is a long-standing, renderer-
// agnostic Three.js feature, not WebGPU/compute-specific), but still a
// real, untested code path.
function extractInstanceParts(referenceGroup) {
  referenceGroup.updateMatrixWorld(true);
  const parts = [];
  referenceGroup.traverse((obj) => {
    if (obj.isMesh) {
      parts.push({ geometry: obj.geometry, material: obj.material, localMatrix: obj.matrixWorld.clone() });
    }
  });
  return parts;
}

const instancePartsCache = {}; // keyed by a caller-provided cache key ("coral:acropora", "tree:palm_001") — the one reference object's parts, reused for every placement of that species
const instanceGroundOffsetCache = {};

function getInstanceParts(cacheKey, buildReferenceFn) {
  if (instancePartsCache[cacheKey]) return instancePartsCache[cacheKey];
  const referenceGroup = buildReferenceFn();
  if (!referenceGroup) return null;
  instancePartsCache[cacheKey] = extractInstanceParts(referenceGroup);
  instanceGroundOffsetCache[cacheKey] = referenceGroup.userData.groundOffset || 0;
  return instancePartsCache[cacheKey];
}

// Scratch objects reused across calls rather than allocated fresh each
// time — this runs once per PLACEMENT (hundreds of times per species at
// build time), and per-instance-per-frame for swaying trees, so allocation
// here is worth avoiding (same reasoning as main.js's own tempSunProjection
// and similar module-level scratch vectors).
const _instTempMatrix = new THREE.Matrix4();
const _instTempPartMatrix = new THREE.Matrix4();
const _instTempPos = new THREE.Vector3();
const _instTempQuat = new THREE.Quaternion();
const _instTempScale = new THREE.Vector3();
const _instTempEuler = new THREE.Euler();

function buildInstancedMeshesFromParts(parts, count) {
  return parts.map((part) => {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // frustumCulled stays at its default (true) — see finalizeInstancedMeshes below for why disabling it entirely was the wrong fix for the real concern that motivated it.
    return mesh;
  });
}

// Sets ONE placement's matrix across every sub-mesh of a model at once —
// composes the placement's own transform (position/rotation/scale) with
// each sub-mesh's own local transform within the model, so a multi-part
// model (e.g. coral made of several differently-positioned/materialed
// pieces) still holds together correctly once instanced.
function setInstanceMatrixAt(meshes, parts, index, position, quaternion, scale) {
  _instTempMatrix.compose(position, quaternion, scale);
  for (let j = 0; j < parts.length; j++) {
    _instTempPartMatrix.multiplyMatrices(_instTempMatrix, parts[j].localMatrix);
    meshes[j].setMatrixAt(index, _instTempPartMatrix);
  }
}

// Per real "used to be 45-60fps, now 10-15fps" — a genuine regression, not
// a tradeoff worth accepting. The original mesh.frustumCulled = false was
// solving a real problem (InstancedMesh's default bounding volume doesn't
// know about scattered instance positions and would cull the WHOLE mesh
// incorrectly) but with the wrong fix — disabling culling entirely means
// EVERY instance across the ENTIRE map now submits to the GPU every frame
// regardless of camera direction, when the previous per-object approach
// culled off-screen coral/trees/sponges/plants individually and for free.
// The correct fix, confirmed directly against Three.js's own official
// docs (InstancedMesh#computeBoundingSphere: "This bounding sphere
// encloses all instances... must be computed by your app" after
// setMatrixAt calls): explicitly compute a real bounding sphere spanning
// every instance actually placed, right after they're all set. This lets
// the engine correctly skip the WHOLE InstancedMesh only when NONE of its
// instances could be visible — coarser than the old per-object culling
// (a coral instance right at the edge of view still submits if ANY other
// instance in that same InstancedMesh is visible), but a real, working
// middle ground instead of no culling at all.
function finalizeInstancedMeshes(meshes) {
  for (const mesh of meshes) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
}

// Real static coral instancing. placements: array of
// {x, z, groundY, rotationY, scale}. Returns an array of
// THREE.InstancedMesh (one per coral sub-mesh) ready to add to the scene —
// replaces up to 220 individual createRealCoral() calls + scene.add() with
// a handful of draw calls total (one per unique sub-mesh per species
// actually placed, not one per placement).
//
// Embed-depth math: the original per-instance code computed each coral's
// real bounding box AFTER its own rotation+scale were applied
// (coral.updateMatrixWorld(true); Box3.setFromObject(coral)). A pure
// Y-axis rotation leaves an object's Y-extent unchanged (it only mixes X
// and Z), so that per-instance recomputation was always producing the
// EXACT SAME below-origin depth regardless of that instance's own
// rotationY — genuinely redundant work, not something this simplification
// changes the result of. Computed once per species at scale 1 here
// (instanceGroundOffsetCache) and multiplied by each instance's own scale
// below, which is mathematically identical to the original per-instance
// result, just computed once instead of 220 times.
function buildCoralInstances(species, placements) {
  const cacheKey = `coral:${species}`;
  const parts = getInstanceParts(cacheKey, () => createRealCoral(species));
  if (!parts || placements.length === 0) return [];
  const groundOffset = instanceGroundOffsetCache[cacheKey];
  const meshes = buildInstancedMeshesFromParts(parts, placements.length);
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const belowOrigin = groundOffset * p.scale;
    _instTempPos.set(p.x, p.groundY + belowOrigin * 0.4, p.z);
    _instTempEuler.set(0, p.rotationY, 0);
    _instTempQuat.setFromEuler(_instTempEuler);
    _instTempScale.setScalar(p.scale);
    setInstanceMatrixAt(meshes, parts, i, _instTempPos, _instTempQuat, _instTempScale);
  }
  finalizeInstancedMeshes(meshes);
  return meshes;
}

// Real static instancing for any HEIGHT-NORMALIZED single-species model —
// createRealSponge/createRealPlant both already follow the exact same
// pattern createRealTree does (clone, normalize to 1 world unit tall,
// expose userData.groundOffset), just without wind-sway, so this is the
// same math as buildTreeInstances' own per-placement Y calculation,
// generalized here rather than duplicated per model type. embedFraction
// matches each model's own original per-instance value (sponge: 0.5 —
// "sits more anchored into the substrate than a coral head"; plant: 1.0 —
// "fully based at ground level... grows FROM the substrate, doesn't sink
// into it") — NOT a shared constant, since these were deliberately
// different per model type before this conversion and should stay that
// way. placements: array of {x, z, groundY, rotationY, scale}. Returns an
// array of THREE.InstancedMesh.
function buildNormalizedInstances(cacheKey, buildReferenceFn, placements, embedFraction) {
  const parts = getInstanceParts(cacheKey, buildReferenceFn);
  if (!parts || placements.length === 0) return [];
  const groundOffset = instanceGroundOffsetCache[cacheKey];
  const meshes = buildInstancedMeshesFromParts(parts, placements.length);
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const y = p.groundY + groundOffset * p.scale * embedFraction;
    _instTempPos.set(p.x, y, p.z);
    _instTempEuler.set(0, p.rotationY, 0);
    _instTempQuat.setFromEuler(_instTempEuler);
    _instTempScale.setScalar(p.scale);
    setInstanceMatrixAt(meshes, parts, i, _instTempPos, _instTempQuat, _instTempScale);
  }
  finalizeInstancedMeshes(meshes);
  return meshes;
}

function buildSpongeInstances(placements) {
  return buildNormalizedInstances("sponge", () => createRealSponge(), placements, 0.5);
}

function buildPlantInstances(placements) {
  return buildNormalizedInstances("plant", () => createRealPlant(), placements, 1.0);
}

// Real tree instancing, WITH per-frame wind-sway support (trees are not
// purely static — see main.js's existing sway update, preserved below
// rather than dropped). speciesPlacements: an object keyed by species,
// each value an array of {x, z, groundY, rotationY, scale, swaySeed} —
// same groundY-based interface as buildCoralInstances, for consistency;
// the species' own userData.groundOffset (from createRealTree) is looked
// up internally here, not by the caller. Returns { meshesBySpecies,
// instances } — instances is a flat array (one entry per placement) that
// updateTreeInstanceSway (below) uses to recompute each instance's matrix
// every frame without needing to re-walk placements.
function buildTreeInstances(speciesPlacements) {
  const meshesBySpecies = {};
  const instances = [];
  for (const species in speciesPlacements) {
    const placements = speciesPlacements[species];
    if (placements.length === 0) continue;
    const cacheKey = `tree:${species}`;
    const parts = getInstanceParts(cacheKey, () => createRealTree(species));
    if (!parts) continue;
    const groundOffset = instanceGroundOffsetCache[cacheKey];
    const meshes = buildInstancedMeshesFromParts(parts, placements.length);
    meshesBySpecies[species] = meshes;
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      const y = p.groundY + groundOffset * p.scale;
      _instTempPos.set(p.x, y, p.z);
      _instTempEuler.set(0, p.rotationY, 0);
      _instTempQuat.setFromEuler(_instTempEuler);
      _instTempScale.setScalar(p.scale);
      setInstanceMatrixAt(meshes, parts, i, _instTempPos, _instTempQuat, _instTempScale);
      instances.push({ meshes, parts, indexInSpecies: i, position: _instTempPos.clone(), baseYaw: p.rotationY, scale: p.scale, swaySeed: p.swaySeed });
    }
    finalizeInstancedMeshes(meshes);
  }
  return { meshesBySpecies, instances };
}

// Per-frame tree wind sway — replaces the original per-object
// `tree.rotation.x = ...; tree.rotation.z = ...` loop. Recomputes each
// instance's FULL matrix (position + composed tilt-X/yaw-Y/tilt-Z rotation
// + scale) since InstancedMesh has no equivalent of a live "just nudge
// this one object's own .rotation" shortcut — the whole matrix has to be
// rebuilt and re-set each time. Euler order 'XYZ' explicitly matches
// Three.js's own default Euler composition order, so this produces the
// IDENTICAL final orientation the original per-object rotation.x/z
// assignment would have, not just a visually-similar approximation.
function updateTreeInstanceSway(treeInstanceHandle, elapsedTime, wind) {
  if (!treeInstanceHandle || wind.windStrength <= 0.001) return;
  const windDirX = wind.windX / wind.windStrength;
  const windDirZ = wind.windZ / wind.windStrength;
  const leanAmount = Math.min(0.11, wind.windStrength * 0.02);
  const swayAmount = Math.min(0.05, wind.windStrength * 0.012);
  const touchedMeshSets = new Set();
  for (const inst of treeInstanceHandle.instances) {
    const phase = elapsedTime * 1.4 + (inst.swaySeed || 0);
    const totalTilt = leanAmount + Math.sin(phase) * swayAmount;
    const tiltX = -windDirZ * totalTilt;
    const tiltZ = windDirX * totalTilt;
    _instTempEuler.set(tiltX, inst.baseYaw, tiltZ, "XYZ");
    _instTempQuat.setFromEuler(_instTempEuler);
    _instTempScale.setScalar(inst.scale);
    setInstanceMatrixAt(inst.meshes, inst.parts, inst.indexInSpecies, inst.position, _instTempQuat, _instTempScale);
    touchedMeshSets.add(inst.meshes);
  }
  for (const meshes of touchedMeshSets) finalizeInstancedMeshes(meshes);
}

let spongeGLTF = null;
let spongeLoadPromise = null;
function loadSpongeModel() {
  if (spongeGLTF) return Promise.resolve(spongeGLTF);
  if (spongeLoadPromise) return spongeLoadPromise;
  const url = new URL("models/9_aplysina_fistularis.glb", import.meta.url).href;
  spongeLoadPromise = new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => { spongeGLTF = gltf; console.log("[models] sponge loaded:", url); resolve(gltf); },
      undefined,
      (err) => { console.error("[models] sponge FAILED to load:", url, err); reject(err); }
    );
  });
  return spongeLoadPromise;
}

/**
 * A yellow tube sponge (Aplysina fistularis) — 16 submeshes (separate
 * tube/branch pieces of one sponge cluster), no skin/animation, so this
 * follows the same plain-clone pattern as createRealReef rather than
 * createRealAngelfish's skeletal one. Inspected accessor bounds land in
 * the ~0.5-1 unit range already — plausibly close to real-world-meter
 * scale on its own — but height-normalized the same defensive way as
 * every other real GLB in this project rather than trusted by eye,
 * per this file's own standing methodology (raw numbers looking
 * plausible has been wrong before — see the tree saga above).
 */
function createRealSponge() {
  if (!spongeGLTF) return null; // caller's responsibility to await loadSpongeModel() first
  const group = spongeGLTF.scene.clone(true);
  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      if (obj.geometry) { obj.geometry.computeBoundingSphere(); obj.geometry.computeBoundingBox(); }
    }
  });
  group.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(group);
  const rawHeight = bbox.max.y - bbox.min.y;
  if (rawHeight > 0.0001) group.scale.multiplyScalar(1 / rawHeight);
  group.updateMatrixWorld(true);
  const normalizedBbox = new THREE.Box3().setFromObject(group);
  group.userData.groundOffset = -normalizedBbox.min.y;
  return group;
}

let plantGLTF = null;
let plantLoadPromise = null;
function loadPlantModel() {
  if (plantGLTF) return Promise.resolve(plantGLTF);
  if (plantLoadPromise) return plantLoadPromise;
  const url = new URL("models/tropical_plant.glb", import.meta.url).href;
  plantLoadPromise = new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => { plantGLTF = gltf; console.log("[models] tropical plant loaded:", url); resolve(gltf); },
      undefined,
      (err) => { console.error("[models] tropical plant FAILED to load:", url, err); reject(err); }
    );
  });
  return plantLoadPromise;
}

/**
 * A tropical leaf cluster (seafloor plant/seaweed accent). The source
 * file carries a leftover "Lamp" node alongside the actual leaf mesh — a
 * studio light left over from whatever Sketchfab scene this was
 * originally exported from, not part of the intended asset — explicitly
 * removed before use so it doesn't add a stray unwanted light source or
 * an empty lamp-shaped node into the game's scene graph.
 */
function createRealPlant() {
  if (!plantGLTF) return null; // caller's responsibility to await loadPlantModel() first
  const group = plantGLTF.scene.clone(true);
  const lamp = group.getObjectByName("Lamp");
  if (lamp && lamp.parent) lamp.parent.remove(lamp);
  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      // Thin leaf geometry — same single-sided risk as tree fronds.
      if (obj.material) obj.material.side = THREE.DoubleSide;
      if (obj.geometry) { obj.geometry.computeBoundingSphere(); obj.geometry.computeBoundingBox(); }
    }
  });
  group.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(group);
  const rawHeight = bbox.max.y - bbox.min.y;
  if (rawHeight > 0.0001) group.scale.multiplyScalar(1 / rawHeight);
  group.updateMatrixWorld(true);
  const normalizedBbox = new THREE.Box3().setFromObject(group);
  group.userData.groundOffset = -normalizedBbox.min.y;
  return group;
}

let fishSchoolGLTF = null;
let fishSchoolLoadPromise = null;
function loadFishSchoolModel() {
  if (fishSchoolGLTF) return Promise.resolve(fishSchoolGLTF);
  if (fishSchoolLoadPromise) return fishSchoolLoadPromise;
  const url = new URL("models/animated_swimming_tropical_fish_school_loop.glb", import.meta.url).href;
  fishSchoolLoadPromise = new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => { fishSchoolGLTF = gltf; console.log("[models] fish school loaded:", url, "animations:", gltf.animations.map((a) => a.name)); resolve(gltf); },
      undefined,
      (err) => { console.error("[models] fish school FAILED to load:", url, err); reject(err); }
    );
  });
  return fishSchoolLoadPromise;
}

/**
 * A pre-animated school of 9 named reef fish (3 clownfish, 2 blue tang,
 * 2 moorish idol, 2 yellow tang) sharing ONE skeleton and ONE swim clip
 * (228 channels), plus 4 additional mesh objects. Inspected structure
 * directly: those 4 meshes are NOT one-per-fish — the file only has 4
 * mesh objects total for 9 skeletal characters, and their vertex bounds
 * span the same huge range (0 to ~1680 units) as the whole laid-out
 * school, meaning the fish bodies are batched together across meshes
 * (grouped some other way, not by individual character) and bound to
 * the shared skin. That means a single fish CANNOT be cleanly cut out of
 * this file the way createRealAngelfish extracts its one character —
 * doing so would risk breaking skin bindings between a mesh's vertices
 * and bones outside whatever subset got kept. Used instead as ONE
 * cohesive "school" prefab: the whole clone (all 9 fish + shared
 * animation) is treated as a single placeable/animatable unit, which is
 * actually a good fit for how a real fish school reads in a reef scene
 * anyway — a tight group moving together, not scattered individuals.
 * Bone translations and mesh bounds both run in the hundreds/thousands
 * (e.g. a single spine bone segment ~110-140 "units") — a real, large
 * unit-scale mismatch with this project (1 unit β‰ˆ 1 meter), similar in
 * kind to the tree files' FBX correction issue though this file has no
 * separate correction matrix to blame; normalized the same defensive
 * way regardless; using the OVERALL bounding box's largest dimension
 * (the school's horizontal spread) as the reference size, since that's
 * this prefab's defining dimension, not its height the way a tree's is.
 */
function createRealFishSchool() {
  if (!fishSchoolGLTF) return null; // caller's responsibility to await loadFishSchoolModel() first
  const group = skeletonClone(fishSchoolGLTF.scene);
  group.traverse((obj) => {
    if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = false; }
  });
  group.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const rawSpan = Math.max(size.x, size.y, size.z);
  if (rawSpan > 0.0001) group.scale.multiplyScalar(1 / rawSpan);
  group.updateMatrixWorld(true);
  const normalizedBbox = new THREE.Box3().setFromObject(group);
  group.userData.groundOffset = -normalizedBbox.min.y; // in case the whole formation needs to sit at a specific depth relative to its own lowest point
  const mixer = new THREE.AnimationMixer(group);
  const clip = fishSchoolGLTF.animations[0];
  if (clip) {
    const action = mixer.clipAction(clip);
    action.time = Math.random() * clip.duration; // phase-offset so multiple placed schools don't swim in lockstep
    action.play();
  }
  return { group, mixer };
}

export { loadAngelfishModel, loadReefModel, loadCoralModel, loadTreeModel, loadSpongeModel, loadPlantModel, loadFishSchoolModel, createRealAngelfish, createRealReef, createRealCoral, createRealTree, createRealSponge, createRealPlant, createRealFishSchool, buildCoralInstances, buildTreeInstances, updateTreeInstanceSway, buildSpongeInstances, buildPlantInstances };
