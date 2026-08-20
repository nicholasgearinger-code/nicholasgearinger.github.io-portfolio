import * as THREE from "three";

// -----------------------------------------------------------------------------
// Rift startup preflight + adaptive performance controller.
//
// This module is imported by levels.js, which is itself a static dependency of
// main.js. That means this code executes before main.js constructs the renderer
// or level-select buttons, giving us one safe place to install startup progress,
// WebGPU warm-up tracking and conservative runtime quality adaptation.
// -----------------------------------------------------------------------------

const isTouch = typeof window !== "undefined" && (
  "ontouchstart" in window || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
);

const state = {
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
};

window.__riftRuntimePreloader = state;
window.__riftWaterDetailStride = isTouch ? 2 : 1;
window.__riftReducedEffects = false;

function ensureOverlay() {
  if (state.overlay?.isConnected) return state.overlay;

  const root = document.createElement("div");
  root.id = "rift-preflight-loader";
  root.style.cssText = [
    "position:fixed", "inset:0", "z-index:99997", "display:flex",
    "align-items:center", "justify-content:center", "pointer-events:auto",
    "background:radial-gradient(circle at 50% 38%,rgba(14,38,54,.96),rgba(3,8,14,.985) 68%)",
    "color:#e8f7f7", "font-family:ui-monospace,SFMono-Regular,Menlo,monospace",
    "transition:opacity .28s ease", "opacity:1"
  ].join(";");

  const card = document.createElement("div");
  card.style.cssText = "width:min(78vw,430px);padding:22px 22px 20px;border:1px solid rgba(102,235,224,.24);border-radius:14px;background:rgba(5,15,23,.76);box-shadow:0 18px 60px rgba(0,0,0,.42);backdrop-filter:blur(10px)";

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
  (document.body || document.documentElement).appendChild(root);

  state.overlay = root;
  state.bar = bar;
  state.percent = percent;
  state.status = status;
  state.detail = detail;
  return root;
}

function setProgress(value, statusText, detailText) {
  ensureOverlay();
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  state.bar.style.width = `${pct}%`;
  state.percent.textContent = `${pct}%`;
  if (statusText) state.status.textContent = statusText;
  if (detailText) state.detail.textContent = detailText;
}

function showOverlay(value = 0, statusText = "Preparing world systems…", detailText = "WebGPU preflight") {
  const el = ensureOverlay();
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
  // Two frames: one to commit styles/layout, one to guarantee the progress bar
  // has actually painted before the synchronous level builder gets CPU time.
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

const MODULES = [
  "main.js", "terrain.js", "levels.js", "graphicsSettings.js", "models.js",
  "decorations.js", "liquid.js", "liquid_legacy.js", "gpu_fft_ocean.js",
  "gpu_fft_ocean_v2.js", "gpu_fft_ocean_v3.js", "gpu_fft_ocean_v4.js",
  "gpu_fft_ocean_v5.js", "gpu_shallow_water.js", "gpu_surf_system_v4.js",
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

  // Module/textures first. Keep concurrency bounded so mobile Safari doesn't
  // decode/allocate a large stack of resources simultaneously.
  const coreTasks = [];
  for (const path of MODULES) coreTasks.push({ label: path, run: () => timeout(preloadFetch(path), 15000, path) });
  for (const path of TEXTURES) coreTasks.push({ label: path, run: () => timeout(preloadFetch(path), 15000, path) });

  let done = 0;
  let total = coreTasks.length;
  await runTaskPool(coreTasks, isTouch ? 4 : 6, (task) => {
    done++;
    setProgress(4 + (done / Math.max(1, total)) * 40, "Loading level systems…", task.label);
  });

  // Give renderer/device creation priority before starting the heavier GLB parse
  // work. If renderer init is slow, the loader continues to show progress rather
  // than competing with a dozen model decoders at the same time.
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
      const pct = 48 + (modelDone / models.length) * 28;
      setProgress(pct, "Loading 3D assets…", task.label);
    });
  }

  state.coreReady = true;
  setProgress(
    78,
    "World data ready",
    state.failedOptionalAssets ? `${state.failedOptionalAssets} optional asset(s) unavailable` : "Modules, textures and models cached",
  );
  if (!state.levelWarming) setTimeout(hideOverlay, 220);
}

// Patch the renderer BEFORE main.js constructs it. Static dependencies execute
// before the importing module's body, so levels.js importing this file makes the
// patch early enough for the live renderer instance.
const proto = THREE.WebGPURenderer?.prototype;
if (proto && !proto.__riftBootstrapPatched) {
  proto.__riftBootstrapPatched = true;

  const originalInit = proto.init;
  if (typeof originalInit === "function") {
    proto.init = async function (...args) {
      state.renderer = this;
      const result = await originalInit.apply(this, args);
      state.rendererReady = true;
      if (!state.coreReady) setProgress(46, "WebGPU ready", "Graphics device initialized");
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

        // WebGPU/NodeMaterial compilers are lazy. compileAsync, when available,
        // explicitly walks the selected level scene after its first real render.
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

        // Reflection/refraction can call renderer.render several times inside one
        // display frame. Don't let those sub-renders fake loader progress.
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
        // Crystal should hit compute immediately; purely procedural non-water
        // levels may not. Ten warm frames is the fallback for those levels.
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
      if (state.levelWarming) state.warmComputeCalls++;
      return original.apply(this, args);
    };
  }

  // main.js remains authoritative about the graphics tier. This wrapper only
  // scales its requested pixel ratio downward after sustained missed frame
  // budgets; it never changes or persists the user's chosen quality tier.
  const originalSetPixelRatio = proto.setPixelRatio;
  if (typeof originalSetPixelRatio === "function") {
    proto.setPixelRatio = function (ratio) {
      state.renderer = this;
      if (Number.isFinite(ratio) && ratio > 0) state.requestedPixelRatio = ratio;
      const effective = Math.max(0.65, state.requestedPixelRatio * state.adaptiveScale);
      return originalSetPixelRatio.call(this, effective);
    };
  }
}

// Intercept the FIRST level-button click, paint the loader, wait for preflight,
// then replay the same click. Without this interception buildLevel() runs
// synchronously inside the original click handler, which can block Safari before
// it ever gets one frame to display the progress UI.
let replayingLevelClick = false;
document.addEventListener("click", (event) => {
  const button = event.target?.closest?.(".rift-level-btn");
  if (!button || replayingLevelClick) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  state.levelWarming = true;
  state.warmRenderFrames = 0;
  state.warmComputeCalls = 0;
  state.compileStarted = false;
  state.compileReady = false;
  state._lastWarmRender = 0;
  state.levelWarmStartedAt = performance.now();

  const name = button.querySelector("strong")?.textContent || "selected level";
  showOverlay(79, `Preparing ${name}…`, state.coreReady ? "Building level" : "Finishing asset preload");

  (async () => {
    try {
      await state.corePromise;
    } catch (_) {
      // runPreflight already logs individual failures and always degrades to
      // runtime loading. Don't strand the button on a nonessential asset error.
    }
    setProgress(81, `Building ${name}…`, "Creating terrain and level objects");
    await nextPaint();

    replayingLevelClick = true;
    try {
      button.click();
    } finally {
      replayingLevelClick = false;
    }

    // Hard failsafe: shader warm-up should normally finish in under a second,
    // but never leave a permanent opaque loader if a browser doesn't expose the
    // expected compile/render callbacks.
    setTimeout(() => {
      if (!state.levelWarming || !state.coreReady) return;
      state.levelWarming = false;
      setProgress(100, "Ready", "Warm-up timeout reached; continuing");
      setTimeout(hideOverlay, 180);
    }, 7000);
  })();
}, true);

// Independent FPS sampler so adaptive resolution still works with the HUD off.
// It reacts over multi-second windows, not frame-by-frame, to avoid resolution
// oscillation and visual pumping.
let perfStart = performance.now();
let perfFrames = 0;
let goodWindows = 0;
function monitorPerformance(now) {
  if (!state.coreReady || state.levelWarming) {
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

showOverlay(1, "Preparing Rift Islands…", "Starting preload");
state.corePromise = runPreflight().catch((err) => {
  console.warn("[rift-preflight] preload failed; continuing with runtime loading:", err);
  state.coreReady = true;
  setProgress(78, "Core preload incomplete", "Continuing with runtime loading");
  if (!state.levelWarming) setTimeout(hideOverlay, 400);
});
requestAnimationFrame(monitorPerformance);
