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
// Never change WebGPU canvas DPR from the adaptive controller while gameplay is
// active. WebGPU canvas textures are short-lived swapchain resources; resizing
// or changing pixel ratio destroys the current BGRA8 canvas texture. If a queued
// command buffer still references that texture, Queue.submit() correctly raises
// "Destroyed texture ... used in a submit". Runtime adaptation therefore only
// changes simulation/effect quality. Display resolution changes remain owned by
// the game's normal initialization / explicit graphics / resize paths.
window.__riftAdaptiveResolutionDisabled = true;

function showMigrationDiagnostic(label, message) {
  const text = String(message || "Unknown error");
  window.__riftR185LastDiagnostic = {
    label,
    message: text,
    time: performance.now(),
    threeRevision: THREE.REVISION,
  };
  const overlay = document.getElementById("rift-error-overlay");
  if (overlay && overlay.style.display === "block" && overlay.textContent?.includes("Script error.")) {
    overlay.textContent += `\n\n[r185 diagnostic]\n${label}: ${text}`;
  }
}

// r185 migration diagnostics. Safari can reduce some cross-origin module/shader
// failures to the unhelpful string "Script error.". Capture WebGPU uncaptured
// errors separately so the next device failure leaves a real message even when
// window.onerror is opaque.
try {
  if (navigator?.gpu?.addEventListener) {
    navigator.gpu.addEventListener("uncapturederror", (event) => {
      const message = event?.error?.message || String(event?.error || "Unknown WebGPU error");
      window.__riftR185GPUError = {
        message,
        time: performance.now(),
        threeRevision: THREE.REVISION,
      };
      showMigrationDiagnostic("WebGPU uncaptured error", message);
      console.error("[rift-r185] WebGPU uncaptured error:", event?.error || event);
    });
  }
} catch (err) {
  console.warn("[rift-r185] WebGPU diagnostic hook unavailable:", err);
}

window.addEventListener("unhandledrejection", (event) => {
  const reason = event?.reason;
  const message = reason?.stack || reason?.message || String(reason || "Unknown rejected promise");
  showMigrationDiagnostic("Unhandled promise rejection", message);
});

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

// Frame-scoped CPU submission counts, enabled only by ?riftPerf=1.
const riftPerfProbe = typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("riftPerf") === "1";
let riftRenderSubmitCalls = 0;
let riftComputeSubmitCalls = 0;
let riftSubmitCPUms = 0;
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
      const started = riftPerfProbe ? performance.now() : 0;
      const result = originalRender.apply(this, args);
      if (riftPerfProbe && state.gameStarted) {
        riftRenderSubmitCalls++;
        riftSubmitCPUms += performance.now() - started;
      }
      state.renderer = this;

      if (state.levelWarming) {
        const now = performance.now();

        // Do not run compileAsync concurrently with the live render/compute
        // command stream. Sequential warm-up frames compile the same pipelines
        // without risking an overlapping encoder on WebGPU.
        if (!state.compileStarted) {
          state.compileStarted = true;
          state.compileReady = true;
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
      const started = riftPerfProbe ? performance.now() : 0;
      const result = original.apply(this, args);
      if (riftPerfProbe && state.gameStarted) {
        riftComputeSubmitCalls++;
        riftSubmitCPUms += performance.now() - started;
      }
      return result;
    };
  }

  // Intentionally DO NOT patch renderer.setPixelRatio(). The prior adaptive
  // wrapper changed DPR during active WebGPU frames and could destroy the
  // swapchain texture before the encoded command buffer was submitted.
}

// Optional mobile performance overlay: ?riftPerf=1. Frame cadence measures
// total browser/renderer workload, not a GPU timestamp. No GPU readbacks.
const riftPerfOverlayEnabled = typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("riftPerf") === "1";
let riftPerfOverlay = null;
function updateRiftPerfOverlay(stats) {
  if (!riftPerfOverlayEnabled || !document.body) return;
  if (!riftPerfOverlay) {
    riftPerfOverlay = document.createElement("div");
    riftPerfOverlay.id = "rift-phase-a-perf";
    // Compact panel placed above the controls, and away from the horizon.
    riftPerfOverlay.style.cssText =
      "position:fixed;top:95px;right:8px;bottom:auto;left:auto;" +
      "z-index:9990;width:min(184px,43vw);max-width:43vw;" +
      "background:rgba(2,20,30,.84);border:1px solid #55d5cf;" +
      "border-radius:7px;padding:6px 8px;color:#d5fffc;" +
      "font:10px/1.35 monospace;pointer-events:none;white-space:pre-line;" +
      "overflow-wrap:anywhere";
    document.body.appendChild(riftPerfOverlay);
  }
  riftPerfOverlay.textContent = [
    "Build: coral-isolation-v6",
    "PERF  " + stats.avgFPS + " fps / " + stats.avgFrameMs + " ms",
    "Render/frame " + (stats.renderSubmitsPerFrame ?? "-") +
      "  Compute/frame " + (stats.computeSubmitsPerFrame ?? "-"),
    "CPU submit/frame " + (stats.cpuSubmitMsPerFrame ?? "-") + " ms",
    "FFT dispatches " + (globalThis.__riftIOSFFTSafeV22?.dispatchCount ?? "-"),
    "Water stride " + stats.waterDetailStride +
      " | Reduced " + (stats.reducedEffects ? "on" : "off"),
    "FFT cap " + (globalThis.__riftIOSFFTSafeV22?.targetHz ?? "-") + " Hz",
    "Swash compute " + (globalThis.__riftSwashPerf?.targetHz ?? "-") + " Hz",
    "Shallow compute " + (globalThis.__riftShallowPerf?.targetHz ?? "-") + " Hz",
    "Ocean LOD " + (globalThis.__riftOceanLOD?.active ?
      globalThis.__riftOceanLOD.vertices + " verts" : "legacy")
  ].join(String.fromCharCode(10));
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

    // Phase A diagnostic: sampled frame cadence and adaptive simulation budget.
    // This is NOT a GPU timestamp measurement and does not resize the swapchain.
    window.__riftPerfA = {
      enabled: true,
      targetFPS: 30,
      avgFPS: Math.round(fps * 10) / 10,
      avgFrameMs: Math.round(elapsed / perfFrames * 10) / 10,
      waterDetailStride: window.__riftWaterDetailStride,
      reducedEffects: window.__riftReducedEffects,
      adaptiveQuality: Math.round(state.adaptiveScale * 100) / 100,
      canvasResizingDuringFrames: false,
      sampleFrames: perfFrames,
      gpuTimingAvailable: false,
      renderSubmitCalls: riftPerfProbe ? riftRenderSubmitCalls : null,
      computeSubmitCalls: riftPerfProbe ? riftComputeSubmitCalls : null,
      renderSubmitsPerFrame: riftPerfProbe
        ? Math.round(riftRenderSubmitCalls / Math.max(1, perfFrames) * 10) / 10 : null,
      computeSubmitsPerFrame: riftPerfProbe
        ? Math.round(riftComputeSubmitCalls / Math.max(1, perfFrames) * 10) / 10 : null,
      cpuSubmitMsPerFrame: riftPerfProbe
        ? Math.round(riftSubmitCPUms / Math.max(1,perfFrames) * 10) / 10
        : null,
      renderDrawCalls: state.renderer?.info?.render?.calls ?? null,
      renderTriangles: state.renderer?.info?.render?.triangles ?? null,
    };
    riftRenderSubmitCalls = 0;
    riftComputeSubmitCalls = 0;
    riftSubmitCPUms = 0;
    updateRiftPerfOverlay(window.__riftPerfA);

    // No live renderer.setPixelRatio()/setSize() calls here. Adaptive quality is
    // intentionally restricted to shader/compute/effect cost so the active
    // WebGPU canvas texture remains valid until the frame is submitted.
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
    event.stopImmediatePropagation();
    return;
  }
  state.levelClickLockUntil = now + 900;

  state.gameStarted = true;
  state.levelWarming = true;
  state.warmRenderFrames = 0;
  state.warmComputeCalls = 0;
  state.compileStarted = false;
  state.compileReady = false;
  state.levelWarmStartedAt = now;
}, true);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", activateRuntime, { once: true });
} else {
  activateRuntime();
}
