import * as THREE from "three";

const isTouch = typeof window !== "undefined" && (
  "ontouchstart" in window || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
);

const state = {
  activated: false,
  gameStarted: false,
  coreReady: false,
  rendererReady: false,
  levelWarming: false,
  warmRenderFrames: 0,
  warmComputeCalls: 0,
  levelWarmStartedAt: 0,
  compileStarted: false,
  compileReady: false,
  requestedPixelRatio: 1,
  adaptiveScale: 1,
  renderer: null,
  failedOptionalAssets: 0,
  corePromise: null,
  perfMonitorStarted: false,
  levelClickLockUntil: 0,
};

window.__riftRuntimePreloader = state;
window.__riftWaterDetailStride = isTouch ? 2 : 1;
window.__riftReducedEffects = false;

function setProgress(value, status, detail) {
  const fn = window.__riftLoaderSetProgress;
  if (typeof fn === "function") fn(value, status, detail);
}

function timeout(promise, ms, label) {
  let timerId;
  const timer = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(timerId));
}

const TEXTURES = [
  "textures/sandnormals.jpg",
  "textures/sandcolor.jpg",
  "textures/sandbump.jpg",
  "textures/seafloor_sand_color.jpg",
  "textures/seafloor_sand_normal.jpg",
  "textures/seafloor_sand_roughness.jpg",
  "textures/caustics_pattern.jpg",
];

async function preloadFetch(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`${relativePath}: HTTP ${response.status}`);
  await response.arrayBuffer();
}

async function modelTasks() {
  const models = await import("./models.js");
  const tasks = [];
  const add = (label, fn) => {
    if (typeof fn === "function") {
      tasks.push({ label, run: () => timeout(Promise.resolve().then(fn), 30000, label) });
    }
  };

  add("angelfish", models.loadAngelfishModel);
  add("reef", models.loadReefModel);
  for (const species of ["stylaster", "pocillopora", "goniastrea", "meandrina", "heliopora", "acropora", "distichopora"]) {
    add(`coral:${species}`, () => models.loadCoralModel(species));
  }
  for (const species of ["coconut_low_poly", "coconut_palm", "palm_001", "palm_002"]) {
    add(`tree:${species}`, () => models.loadTreeModel(species));
  }
  add("sponge", models.loadSpongeModel);
  add("reef plant", models.loadPlantModel);
  add("fish school", models.loadFishSchoolModel);
  return tasks;
}

async function runTaskPool(tasks, concurrency, onDone) {
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= tasks.length) return;
      const task = tasks[index];
      try {
        await task.run();
      } catch (err) {
        state.failedOptionalAssets++;
        console.warn(`[rift-preflight] optional preload skipped (${task.label}):`, err);
      } finally {
        onDone(task);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, tasks.length)) }, worker));
}

async function runPreflight() {
  setProgress(42, "Loading level assets…", "Textures");

  let done = 0;
  const textureTasks = TEXTURES.map((path) => ({
    label: path,
    run: () => timeout(preloadFetch(path), 15000, path),
  }));
  await runTaskPool(textureTasks, isTouch ? 3 : 5, (task) => {
    done++;
    setProgress(42 + (done / Math.max(1, textureTasks.length)) * 16, "Loading level assets…", task.label);
  });

  let models = [];
  try {
    models = await modelTasks();
  } catch (err) {
    state.failedOptionalAssets++;
    console.warn("[rift-preflight] model task discovery failed:", err);
  }

  if (models.length) {
    let modelDone = 0;
    await runTaskPool(models, isTouch ? 2 : 4, (task) => {
      modelDone++;
      setProgress(58 + (modelDone / models.length) * 34, "Loading 3D assets…", task.label);
    });
  }

  state.coreReady = true;
  setProgress(
    94,
    "All level assets ready",
    state.failedOptionalAssets ? `${state.failedOptionalAssets} optional asset(s) unavailable` : "Models and textures cached",
  );
}

const proto = THREE.WebGPURenderer?.prototype;
if (proto && !proto.__riftBootstrapV3Patched) {
  proto.__riftBootstrapV3Patched = true;

  const originalInit = proto.init;
  if (typeof originalInit === "function") {
    proto.init = async function (...args) {
      state.renderer = this;
      const result = await originalInit.apply(this, args);
      state.rendererReady = true;
      return result;
    };
  }

  const originalRender = proto.render;
  if (typeof originalRender === "function") {
    proto.render = function (...args) {
      const result = originalRender.apply(this, args);
      state.renderer = this;

      if (state.levelWarming) {
        const now = performance.now();
        if (!state.compileStarted) {
          state.compileStarted = true;
          if (typeof this.compileAsync === "function" && args[0] && args[1]) {
            timeout(Promise.resolve(this.compileAsync(args[0], args[1])), 9000, "renderer.compileAsync()")
              .then(() => { state.compileReady = true; })
              .catch((err) => {
                console.warn("[rift-preflight] background compile warm-up skipped:", err);
                state.compileReady = true;
              });
          } else {
            state.compileReady = true;
          }
        }

        if (!state._lastWarmRender || now - state._lastWarmRender > 8) {
          state._lastWarmRender = now;
          state.warmRenderFrames++;
        }

        const warmedLongEnough = now - state.levelWarmStartedAt > 650;
        const computeOrFallback = state.warmComputeCalls > 0 || state.warmRenderFrames >= 10;
        if (warmedLongEnough && state.compileReady && state.warmRenderFrames >= 6 && computeOrFallback) {
          state.levelWarming = false;
        }
      }
      return result;
    };
  }

  for (const methodName of ["compute", "computeAsync"]) {
    const original = proto[methodName];
    if (typeof original !== "function") continue;
    proto[methodName] = function (...args) {
      if (state.levelWarming) state.warmComputeCalls++;
      return original.apply(this, args);
    };
  }

  const originalSetPixelRatio = proto.setPixelRatio;
  if (typeof originalSetPixelRatio === "function") {
    proto.setPixelRatio = function (ratio) {
      state.renderer = this;
      if (Number.isFinite(ratio) && ratio > 0) state.requestedPixelRatio = ratio;
      const scale = state.gameStarted ? state.adaptiveScale : 1;
      return originalSetPixelRatio.call(this, Math.max(0.65, state.requestedPixelRatio * scale));
    };
  }
}

let perfStart = performance.now();
let perfFrames = 0;
let goodWindows = 0;
function monitorPerformance(now) {
  if (!state.gameStarted || state.levelWarming || document.visibilityState === "hidden") {
    perfStart = now;
    perfFrames = 0;
    requestAnimationFrame(monitorPerformance);
    return;
  }

  perfFrames++;
  const elapsed = now - perfStart;
  if (elapsed >= 2200) {
    const fps = perfFrames * 1000 / elapsed;
    if (fps < 18) {
      state.adaptiveScale = Math.max(isTouch ? 0.68 : 0.76, state.adaptiveScale - 0.12);
      window.__riftWaterDetailStride = 3;
      window.__riftReducedEffects = true;
      goodWindows = 0;
    } else if (fps < 25) {
      state.adaptiveScale = Math.max(isTouch ? 0.74 : 0.82, state.adaptiveScale - 0.07);
      window.__riftWaterDetailStride = 2;
      window.__riftReducedEffects = true;
      goodWindows = 0;
    } else if (fps > 38) {
      goodWindows++;
      if (goodWindows >= 2) {
        state.adaptiveScale = Math.min(1, state.adaptiveScale + 0.04);
        window.__riftWaterDetailStride = isTouch ? 2 : 1;
        window.__riftReducedEffects = state.adaptiveScale < 0.96;
        goodWindows = 0;
      }
    } else {
      goodWindows = 0;
    }

    if (state.renderer && typeof state.renderer.setPixelRatio === "function") {
      state.renderer.setPixelRatio(state.requestedPixelRatio);
    }
    perfStart = now;
    perfFrames = 0;
  }
  requestAnimationFrame(monitorPerformance);
}

function startPerformanceMonitor() {
  if (state.perfMonitorStarted) return;
  state.perfMonitorStarted = true;
  perfStart = performance.now();
  requestAnimationFrame(monitorPerformance);
}

function activateRuntime() {
  if (state.activated) return state.corePromise || Promise.resolve();
  state.activated = true;
  startPerformanceMonitor();
  state.corePromise = runPreflight().catch((err) => {
    console.warn("[rift-preflight] asset preload incomplete; continuing:", err);
    state.coreReady = true;
    setProgress(94, "Level assets mostly ready", "Continuing with runtime loading");
  });
  return state.corePromise;
}

window.__riftActivateRuntime = activateRuntime;

document.addEventListener("click", (event) => {
  const button = event.target?.closest?.(".rift-level-btn");
  if (!button || !state.coreReady) return;

  const now = performance.now();
  if (now < state.levelClickLockUntil) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    return;
  }
  state.levelClickLockUntil = now + 650;
  state.gameStarted = true;
  state.levelWarming = true;
  state.warmRenderFrames = 0;
  state.warmComputeCalls = 0;
  state.compileStarted = false;
  state.compileReady = false;
  state._lastWarmRender = 0;
  state.levelWarmStartedAt = now;

  setTimeout(() => {
    if (state.levelWarming) state.levelWarming = false;
  }, 7000);
}, true);

export { activateRuntime };
