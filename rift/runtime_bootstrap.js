import * as THREE from "three";

// -----------------------------------------------------------------------------
// Rift startup preflight + adaptive performance controller.
//
// Goals:
// 1) Never leave a player staring at a canvas that looks frozen while WebGPU,
//    model parsing, shaders, and compute pipelines are warming.
// 2) Preload the shared level modules + binary model assets once, before a
//    level is entered, so level construction mostly hits memory/browser cache.
// 3) Keep a loading overlay over the game for a few real rendered frames after
//    a level selection. Three/WebGPU lazily compiles many material/compute
//    pipelines on first use; those warm-up frames happen behind the overlay.
// 4) Adapt render resolution conservatively on sustained low FPS. This does not
//    change gameplay simulation state or graphics-tier preferences.
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
  requestedPixelRatio: 1,
  adaptiveScale: 1,
  renderer: null,
  overlay: null,
  bar: null,
  percent: null,
  status: null,
  detail: null,
  failedOptionalAssets: 0,
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
  // Drain the body so the browser actually stores the complete response in its
  // cache rather than only resolving after headers.
  await response.arrayBuffer();
}

async function modelTasks() {
  const models = await import("./models.js");
  const tasks = [];
  const add = (label, fn) => {
    if (typeof fn === "function") tasks.push({ label, run: () => timeout(Promise.resolve().then(fn), 30000, label) });
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

async function runPreflight() {
  showOverlay(2, "Loading level systems…", "Caching modules");
  const tasks = [];
  for (const path of MODULES) tasks.push({ label: path, run: () => timeout(preloadFetch(path), 15000, path) });
  for (const path of TEXTURES) tasks.push({ label: path, run: () => timeout(preloadFetch(path), 15000, path) });

  try {
    tasks.push(...await modelTasks());
  } catch (err) {
    console.warn("[rift-preflight] model task discovery failed:", err);
    state.failedOptionalAssets++;
  }

  let done = 0;
  const total = Math.max(1, tasks.length);
  const workers = tasks.map(async (task) => {
    try {
      await task.run();
    } catch (err) {
      state.failedOptionalAssets++;
      console.warn(`[rift-preflight] optional preload skipped (${task.label}):`, err);
    } finally {
      done++;
      const pct = 4 + (done / total) * 72;
      setProgress(pct, "Loading levels and assets…", task.label);
    }
  });
  await Promise.all(workers);
  state.coreReady = true;
  setProgress(78, "Core assets ready", state.failedOptionalAssets ? `${state.failedOptionalAssets} optional asset(s) unavailable` : "All preload tasks complete");
  if (!state.levelWarming) setTimeout(hideOverlay, 220);
}

// Capture level selection globally. The buttons are created later by main.js,
// so a delegated listener is safer than trying to bind them during this module.
document.addEventListener("click", (event) => {
  const button = event.target?.closest?.(".rift-level-btn");
  if (!button) return;
  state.levelWarming = true;
  state.warmRenderFrames = 0;
  state.warmComputeCalls = 0;
  state.levelWarmStartedAt = performance.now();
  const name = button.querySelector("strong")?.textContent || "selected level";
  showOverlay(80, `Building ${name}…`, "Creating terrain and level objects");
}, true);

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
      if (!state.coreReady) setProgress(76, "Initializing WebGPU…", "Renderer device ready");
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
        // Count no more than one warm-up frame every ~8ms so reflection and
        // refraction sub-renders in the same display frame don't fake progress.
        if (!state._lastWarmRender || now - state._lastWarmRender > 8) {
          state._lastWarmRender = now;
          state.warmRenderFrames++;
          const pct = Math.min(98, 83 + state.warmRenderFrames * 1.5 + Math.min(4, state.warmComputeCalls * 0.25));
          setProgress(pct, "Compiling shaders and GPU pipelines…", `${state.warmRenderFrames} warm-up frame${state.warmRenderFrames === 1 ? "" : "s"}`);
        }
        const warmedLongEnough = now - state.levelWarmStartedAt > 520;
        const pipelinesTouched = state.warmRenderFrames >= 6 && (state.warmComputeCalls > 0 || state.warmRenderFrames >= 10);
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

  // Dynamic pixel-ratio cap. main.js remains authoritative about the requested
  // graphics-tier resolution; this wrapper only scales it downward when a phone
  // is demonstrably missing frame budget for several seconds.
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

// Independent FPS sampler so adaptive resolution still works even if the debug
// FPS HUD is disabled. It is intentionally slow-reacting: quality only drops
// after sustained misses and recovers even more slowly to avoid oscillation.
let perfStart = performance.now();
let perfFrames = 0;
let goodWindows = 0;
function monitorPerformance(now) {
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
      window.__riftWaterDetailStride = isTouch ? 2 : 2;
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
queueMicrotask(() => runPreflight().catch((err) => {
  console.warn("[rift-preflight] preload failed; continuing with runtime loading:", err);
  state.coreReady = true;
  setProgress(78, "Core preload incomplete", "The game can continue using runtime loading");
  if (!state.levelWarming) setTimeout(hideOverlay, 400);
}));
requestAnimationFrame(monitorPerformance);
