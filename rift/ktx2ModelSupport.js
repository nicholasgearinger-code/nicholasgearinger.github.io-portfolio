import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";

// Environment Performance KTX2 support.
//
// The performance Pages build replaces embedded PNG/JPEG material textures in
// selected GLBs with KTX2/Basis Universal images. GLTFLoader only decodes the
// KHR_texture_basisu extension when a KTX2Loader has been attached, and the
// KTX2Loader must detect GPU format support from the initialized renderer.
//
// Runtime preflight intentionally fetches model bytes before the game renderer
// exists. models.js therefore performs fetch-only warming during that stage and
// does not enter GLTFLoader until WebGPURenderer.init() has completed. Once the
// renderer exists, this small prototype hook transparently attaches the shared
// KTX2 loader to every GLTFLoader instance used by the existing model code,
// including the tree path that calls GLTFLoader.parse() directly.

const THREE_VERSION = "0.185.1";
const TRANSCODER_PATH = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/libs/basis/`;

let sharedKTX2Loader = null;
let detectedRenderer = null;
let installed = false;

function getRenderer() {
  const runtime = globalThis.__riftRuntimePreloader;
  return runtime?.rendererReady ? runtime.renderer : null;
}

function ensureKTX2(loader) {
  const renderer = getRenderer();
  if (!renderer || !loader?.setKTX2Loader) return false;

  if (!sharedKTX2Loader || detectedRenderer !== renderer) {
    try {
      sharedKTX2Loader?.dispose?.();
    } catch (_) {
      // Best effort only; a stale loader is replaced below.
    }

    sharedKTX2Loader = new KTX2Loader()
      .setTranscoderPath(TRANSCODER_PATH)
      // Two workers avoids a large decompression burst on iPhone while still
      // allowing parallel model material setup.
      .setWorkerLimit(2)
      .detectSupport(renderer);

    detectedRenderer = renderer;

    globalThis.__riftKTX2Performance = {
      enabled: true,
      version: "1.2-ktx2",
      rendererRevision: renderer?.constructor?.name || "WebGPURenderer",
      transcoderPath: TRANSCODER_PATH,
      workerLimit: 2,
      attachedLoads: 0,
    };
  }

  loader.setKTX2Loader(sharedKTX2Loader);
  if (globalThis.__riftKTX2Performance) {
    globalThis.__riftKTX2Performance.attachedLoads++;
  }
  return true;
}

function installPrototypeHook() {
  if (installed || GLTFLoader.prototype.__riftKTX2PerformancePatched) return;
  installed = true;
  GLTFLoader.prototype.__riftKTX2PerformancePatched = true;

  const originalLoad = GLTFLoader.prototype.load;
  GLTFLoader.prototype.load = function (...args) {
    ensureKTX2(this);
    return originalLoad.apply(this, args);
  };

  const originalLoadAsync = GLTFLoader.prototype.loadAsync;
  if (typeof originalLoadAsync === "function") {
    GLTFLoader.prototype.loadAsync = function (...args) {
      ensureKTX2(this);
      return originalLoadAsync.apply(this, args);
    };
  }

  const originalParse = GLTFLoader.prototype.parse;
  GLTFLoader.prototype.parse = function (...args) {
    ensureKTX2(this);
    return originalParse.apply(this, args);
  };

  const originalParseAsync = GLTFLoader.prototype.parseAsync;
  if (typeof originalParseAsync === "function") {
    GLTFLoader.prototype.parseAsync = function (...args) {
      ensureKTX2(this);
      return originalParseAsync.apply(this, args);
    };
  }
}

installPrototypeHook();

export function getRiftKTX2PerformanceState() {
  return globalThis.__riftKTX2Performance || {
    enabled: false,
    version: "1.2-ktx2",
    rendererReady: !!getRenderer(),
  };
}
