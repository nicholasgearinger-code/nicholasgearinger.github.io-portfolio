import * as THREE from "three";

// -----------------------------------------------------------------------------
// Rift startup preflight + adaptive performance controller (v2).
//
// IMPORTANT: this module is still imported early so it can patch WebGPURenderer
// before main.js creates the live renderer, but it performs NO asset preloads,
// progress UI work, model decoding or FPS monitoring until the user explicitly
// presses the Rift Islands Play button. This keeps the portfolio page responsive
// while Rift is merely visible further down the page.
// -----------------------------------------------------------------------------

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
  overlay: null,
  bar: null,
  percent: null,
  status: null,
  detail: null,
  failedOptionalAssets: 0,
  corePromise: null,
  perfMonitorStarted: false,
};

window.__riftRuntimePreloader = state;
window.__riftWaterDetailStride = isTouch ? 2 : 1;
window.__riftReducedEffects = false;

function ensureOverlay() {
  if (!state.activated) return null;
  if (state.overlay?.isConnected) return state.overlay;

  const viewport = document.getElementById("rift-viewport");
  const host = viewport || document.body || document.documentElement;
  const root = document.createElement("div");
  root.id = "rift-preflight-loader";
  root.style.cssText = [
    viewport ? "position:absolute" : "position:fixed",
    "inset:0", "z-index:99997", "display:flex",
    "align-items:center", "justify-content:center", "pointer-events:auto",
    "background:radial-gradient(circle at 50% 38%,rgba(14,38,54,.96),rgba(3,8,14,.985) 68%)",
    "color:#e8f7f7", "font-family:ui-monospace,SFMono-Regular,Menlo,monospace",
    "transition:opacity .28s ease", "opacity:1"
  ].join(";");

  const card = document.createElement("div");
  card.style.cssText = "width:min(78%,430px);padding:22px 22px 20px;border:1px solid rgba(102,235,224,.24);border-radius:14px;background:rgba(5,15,23,.84);box-shadow:0 18px 60px rgba(0,0,0,.42);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)";

  const title = document.createElement("div");
  title.textContent = "RIFT ISLANDS";
  title.style.cssText = "font-size:13px;letter-spacing:.22em;color:#70e7dd;margin-bottom:12px";

  const status = document.createElement("div");
  status.textContent = "Preparing world systems…";
  status.style.cssText = "font-size:12px;margin-bottom:10px;color:rgba(235,247,247,.92)";

  const track = document.createElement("div");
  track.style.cssText = "height:7px;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.10);box-shadow:inset 0 0 0 1px rgba(255,255,255,.05)";
  const bar = document.createElement("div");
  bar.style.cssText = "height:100%;width:0%;border-radius:inherit;background:linear-gradient(90deg,#35cfc3,#a8fff4);box-shadow:0 0 16px rgba(80,235,220,.52);transition:width .18s ease";
  track.appendChild(bar);

  const footer = document.createElement("div");
  footer.style.cssText = "display:flex;justify-content:space-between;gap:12px;margin-top:9px;font-size:10px;color:rgba(220,238,238,.56)";
  const detail = document.createElement("span");
  detail.textContent = "WebGPU preflight";
  const percent = document.createElement("span");
  percent.textContent = "0%";
  footer.append(detail, percent);

  card.append(title, status, track, footer);
  root.appendChild(card);
  host.appendChild(root);

  state.overlay = root;
  state.bar = bar;
  state.percent = percent;
  state.status = status;
  state.detail = detail;
  return root;
}

function setProgress(value, statusText, detailText) {
  if (!state.activated) return;
  const overlay = ensureOverlay();
  if (!overlay || !state.bar || !state.percent) return;
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  state.bar.style.width = `${pct}%`;
  state.percent.textContent = `${pct}%`;
  if (statusText && state.status) state.status.textContent = statusText;
  if (detailText && state.detail) state.detail.textContent = detailText;
}

function showOverlay(value = 0, statusText = "Preparing world systems…", detailText = "WebGPU preflight") {
  if (!state.activated) return;
  const el = ensureOverlay();
  if (!el) return;
  el.style.display = "flex";
  el.style.opacity = "1";
  setProgress(value, statusText, detailText);
}

function hideOverlay() {
  if (!state.overlay) return;
  state.overlay.style.opacity = "0";
  setTimeout(() => {
    if (!state.levelWarming && state.overlay) state.overlay.style.display = "none";
  }, 300);
}

function timeout(promise, ms, label) {
  let id;
  const timer = new Promise((_, reject) => {
    id = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(id));
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function waitForRendererReady(maxMs = 12000) {
  if (state.rendererReady) return Promise.resolve();
  const started = performance.now();
  return new Promise((resolve) => {
    const poll = () => {
      if (state.rendererReady || performance.now() - started >= maxMs) resolve();
      else setTimeout(poll, 25);
    };
    poll();
  });
}

// Current live dependency chain. These are fetched only AFTER Play is pressed.
// Fetching warms the HTTP/service-worker cache; actual selected-level shaders are
// still compiled by the renderer warm-up below.
const MODULES = [
  "terrain.js", "levels.js", "graphicsSettings.js", "models.js",
  "decorations.js", "liquid.js", "liquid_legacy.js", "gpu_fft_ocean.js",
  "gpu_fft_ocean_v2.js", "gpu_fft_ocean_v3.js", "gpu_fft_ocean_v4.js",
  "gpu_fft_ocean_v5.js", "gpu_shallow_water.js", "gpu_surf_system_v4.js",
  "gpu_surf_system_v5.js", "gpu_swash_solver.js", "gpu_swash_solver_v2.js",
  "dayNightCycle.js", "atmosphericParticles.js", "vegetation.js",
  "horizonSilhouettes.js", "wildlife.js", "landmarks.js", "weather.js",
  "volumetricClouds.js", "clouds.js", "effects.js", "audio.js", "physics.js",
  "touchControls.js", "crystals.js", "worldgen.js", "lore.js", "hitPrediction.js"
];

const TEXTURES = [
  "textures/sandnormals.jpg", "textures/sandcolor.jpg", "textures/sandbump.jpg",
  "textures/seafloor_sand_color.jpg", "textures/seafloor_sand_normal.jpg",
  "textures/seafloor_sand_roughness.jpg", "textures/caustics_pattern.jpg"
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
  const workers = [];
  const workerCount = Math.min(concurrency, Math.max(1, tasks.length));
  for (let i = 0; i < workerCount; i++) workers.push(worker());
  await Promise.all(workers);
}

async function runPreflight() {
  showOverlay(2, "Loading level systems…", "Caching modules");

  const coreTasks = [];
  for (const path of MODULES) coreTasks.push({ label: path, run: () => timeout(preloadFetch(path), 15000, path) });
  for (const path of TEXTURES) coreTasks.push({ label: path, run: () => timeout(preloadFetch(path), 15000, path) });

  let done = 0;
  const total = coreTasks.length;
  await runTaskPool(coreTasks, isTouch ? 4 : 6, (task) => {
    done++;
    setProgress(4 + (done / Math.max(1, total)) * 40, "Loading level systems…", task.label);
  });

  setProgress(46, "Initializing graphics device…", "Waiting for WebGPU renderer");
  await waitForRendererReady();

  let models = [];
  try {
    models = await modelTasks();
  } catch (err) {
    state.failedOptionalAssets++;
    console.warn("[rift-preflight] model task discovery failed:", err);
  }

  if (models.length) {
    let modelDone = 0;
    await runTaskPool(models, isTouch ? 3 : 5, (task) => {
      modelDone++;
      setProgress(48 + (modelDone / models.length) * 28, "Loading 3D assets…", task.label);
    });
  }

  state.coreReady = true;
  setProgress(
    78,
    "World data ready",
    state.failedOptionalAssets ? `${state.failedOptionalAssets} optional asset(s) unavailable` : "Modules, textures and models cached",
  );
}

// Patch early, but remain passive until state.activated becomes true.
const proto = THREE.WebGPURenderer?.prototype;
if (proto && !proto.__riftBootstrapV2Patched) {
  proto.__riftBootstrapV2Patched = true;

  const originalInit = proto.init;
  if (typeof originalInit === "function") {
    proto.init = async function (...args) {
      state.renderer = this;
      const result = await originalInit.apply(this, args);
      state.rendererReady = true;
      if (state.activated && !state.coreReady) {
        setProgress(46, "WebGPU ready", "Graphics device initialized");
      }
      return result;
    };
  }

  const originalRender = proto.render;
  if (typeof originalRender === "function") {
    proto.render = function (...args) {
      const result = originalRender.apply(this, args);
      state.renderer = this;

      if (state.activated && state.levelWarming) {
        const now = performance.now();

        if (!state.compileStarted) {
          state.compileStarted = true;
          if (typeof this.compileAsync === "function" && args[0] && args[1]) {
            timeout(Promise.resolve(this.compileAsync(args[0], args[1])), 9000, "renderer.compileAsync()")
              .then(() => { state.compileReady = true; })
              .catch((err) => {
                console.warn("[rift-preflight] compileAsync warm-up skipped:", err);
                state.compileReady = true;
              });
          } else {
            state.compileReady = true;
          }
        }

        if (!state._lastWarmRender || now - state._lastWarmRender > 8) {
          state._lastWarmRender = now;
          state.warmRenderFrames++;
          const compileBonus = state.compileReady ? 3 : 0;
          const pct = Math.min(98, 82 + state.warmRenderFrames * 1.35 + Math.min(4, state.warmComputeCalls * 0.22) + compileBonus);
          setProgress(
            pct,
            state.compileReady ? "Warming GPU pipelines…" : "Compiling shaders…",
            `${state.warmRenderFrames} warm frame${state.warmRenderFrames === 1 ? "" : "s"} · ${state.warmComputeCalls} compute dispatches`,
          );
        }

        const warmedLongEnough = now - state.levelWarmStartedAt > 650;
        const computeOrFallback = state.warmComputeCalls > 0 || state.warmRenderFrames >= 10;
        const pipelinesTouched = state.warmRenderFrames >= 6 && state.compileReady && computeOrFallback;
        if (state.coreReady && state.rendererReady && warmedLongEnough && pipelinesTouched) {
          state.levelWarming = false;
          setProgress(100, "Ready", "Shaders and compute pipelines warmed");
          setTimeout(hideOverlay, 180);
        }
      }

      return result;
    };
  }

  for (const methodName of ["compute", "computeAsync"]) {
    const original = proto[methodName];
    if (typeof original !== "function") continue;
    proto[methodName] = function (...args) {
      if (state.activated && state.levelWarming) state.warmComputeCalls++;
      return original.apply(this, args);
    };
  }

  const originalSetPixelRatio = proto.setPixelRatio;
  if (typeof originalSetPixelRatio === "function") {
    proto.setPixelRatio = function (ratio) {
      state.renderer = this;
      if (Number.isFinite(ratio) && ratio > 0) state.requestedPixelRatio = ratio;
      const scale = state.activated && state.gameStarted ? state.adaptiveScale : 1;
      const effective = Math.max(0.65, state.requestedPixelRatio * scale);
      return originalSetPixelRatio.call(this, effective);
    };
  }
}

let perfStart = performance.now();
let perfFrames = 0;
let goodWindows = 0;
function monitorPerformance(now) {
  if (!state.activated || !state.gameStarted || state.levelWarming) {
    perfStart = now;
    perfFrames = 0;
    requestAnimationFrame(monitorPerformance);
    return;
  }

  perfFrames++;
  const elapsed = now - perfStart;
  if (elapsed >= 2200) {
    const fps = perfFrames * 1000 / elapsed;
    const renderer = state.renderer;

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

    if (renderer && typeof renderer.setPixelRatio === "function") {
      renderer.setPixelRatio(state.requestedPixelRatio);
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
  perfFrames = 0;
  requestAnimationFrame(monitorPerformance);
}

function activateRuntime() {
  if (state.activated) return state.corePromise || Promise.resolve();
  state.activated = true;
  startPerformanceMonitor();
  showOverlay(1, "Preparing Rift Islands…", "Starting on-demand preload");
  state.corePromise = runPreflight().catch((err) => {
    console.warn("[rift-preflight] preload failed; continuing with runtime loading:", err);
    state.coreReady = true;
    setProgress(78, "Core preload incomplete", "Continuing with runtime loading");
  });
  return state.corePromise;
}

// First Play press starts the entire preflight. The original main.js Play handler
// is replayed only after preflight, so no Rift loader appears or asset work begins
// merely because the visitor loaded/scrolled the portfolio.
let replayingTitleClick = false;
document.addEventListener("click", (event) => {
  const button = event.target?.closest?.("#rift-title-play-btn");
  if (!button || replayingTitleClick || state.activated) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  (async () => {
    await activateRuntime();
    setProgress(100, "Ready", "Rift systems cached");
    await nextPaint();
    replayingTitleClick = true;
    try {
      button.click();
    } finally {
      replayingTitleClick = false;
    }
    setTimeout(hideOverlay, 180);
  })();
}, true);

// Selected-level construction gets a second in-viewport warm-up stage. If a
// level-select button is somehow reached without the title gate, activate lazily
// here as a safe fallback.
let replayingLevelClick = false;
document.addEventListener("click", (event) => {
  const button = event.target?.closest?.(".rift-level-btn");
  if (!button || replayingLevelClick) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  (async () => {
    await activateRuntime();

    state.gameStarted = true;
    state.levelWarming = true;
    state.warmRenderFrames = 0;
    state.warmComputeCalls = 0;
    state.compileStarted = false;
    state.compileReady = false;
    state._lastWarmRender = 0;
    state.levelWarmStartedAt = performance.now();

    const name = button.querySelector("strong")?.textContent || "selected level";
    showOverlay(79, `Preparing ${name}…`, state.coreReady ? "Building level" : "Finishing asset preload");
    setProgress(81, `Building ${name}…`, "Creating terrain and level objects");
    await nextPaint();

    replayingLevelClick = true;
    try {
      button.click();
    } finally {
      replayingLevelClick = false;
    }

    setTimeout(() => {
      if (!state.levelWarming) return;
      state.levelWarming = false;
      setProgress(100, "Ready", "Warm-up timeout reached; continuing");
      setTimeout(hideOverlay, 180);
    }, 7000);
  })();
}, true);

export { activateRuntime };
