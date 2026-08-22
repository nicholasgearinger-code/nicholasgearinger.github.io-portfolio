// Rift Islands lazy launcher. The portfolio loads only this tiny module.
// The heavy WebGPU/runtime graph is imported only after the visitor presses Play.

const playButton = document.getElementById("rift-title-play-btn");
const viewport = document.getElementById("rift-viewport");

// index.html still contains an older global error overlay that listens to every
// uncaught page error. A cross-origin error from an unrelated portfolio script
// can therefore be reported as "Rift Islands module failed to load / Script
// error." even when Rift has not been touched. Detach that legacy overlay here;
// this launcher reports only errors from the actual Rift import promise below.
const legacyGlobalErrorOverlay = document.getElementById("rift-module-error-overlay");
if (legacyGlobalErrorOverlay) legacyGlobalErrorOverlay.remove();

let loading = false;
let loaded = false;
let replaying = false;
let runtimeImport = null;
let gameImport = null;
let overlay = null;
let bar = null;
let percent = null;
let status = null;
let detail = null;
let shownProgress = 0;

// ---------------------------------------------------------------------------
// Water backend test switch.
// One small developer pill is available before the heavy game modules load, so
// an iPhone can deliberately boot the desktop three-FFT + SSR path (and can
// always switch back even if that experimental path fails during startup).
// AUTO follows the real hardware; each tap moves to the opposite profile first,
// then the native profile, then back to AUTO.
// ---------------------------------------------------------------------------
const WATER_TEST_MODE_KEY = "riftWaterTestMode";
const HARDWARE_WATER_PROFILE = (
  typeof window !== "undefined" &&
  ("ontouchstart" in window ||
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0))
) ? "mobile" : "desktop";

function readWaterTestSelection() {
  try {
    const saved = localStorage.getItem(WATER_TEST_MODE_KEY);
    return saved === "mobile" || saved === "desktop" ? saved : "auto";
  } catch (_) {
    return "auto";
  }
}

function resolveWaterProfile(selection) {
  return selection === "auto" ? HARDWARE_WATER_PROFILE : selection;
}

function nextWaterTestSelection(selection) {
  const alternate = HARDWARE_WATER_PROFILE === "mobile" ? "desktop" : "mobile";
  if (selection === "auto") return alternate;
  if (selection === alternate) return HARDWARE_WATER_PROFILE;
  return "auto";
}

let waterTestSelection = readWaterTestSelection();

function applyWaterTestGlobals() {
  const resolved = resolveWaterProfile(waterTestSelection);
  window.__riftWaterTestMode = resolved;
  window.__riftWaterTestForced = waterTestSelection !== "auto";
  window.__riftWaterTestSelection = waterTestSelection;
  return resolved;
}

function persistWaterTestSelection() {
  try {
    if (waterTestSelection === "auto") localStorage.removeItem(WATER_TEST_MODE_KEY);
    else localStorage.setItem(WATER_TEST_MODE_KEY, waterTestSelection);
  } catch (_) {
    // If storage is blocked the current page still uses the chosen profile.
  }
}

const waterProfileButton = document.createElement("button");
waterProfileButton.type = "button";
waterProfileButton.id = "rift-water-profile-test";
waterProfileButton.title = "Switch Water Pro between the mobile and desktop rendering backends.";
waterProfileButton.style.cssText =
  "position:absolute;top:96px;left:8px;z-index:99999;padding:5px 9px;" +
  "border:1px solid rgba(90,235,226,.55);border-radius:999px;" +
  "background:rgba(3,12,20,.78);color:#8ff6ee;font:9px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;" +
  "letter-spacing:.08em;cursor:pointer;touch-action:manipulation;backdrop-filter:blur(4px);";

function refreshWaterProfileButton() {
  const resolved = applyWaterTestGlobals();
  const suffix = waterTestSelection === "auto" ? "AUTO" : "TEST";
  waterProfileButton.textContent = `WATER: ${resolved.toUpperCase()} · ${suffix}`;
}

waterProfileButton.addEventListener("click", () => {
  waterTestSelection = nextWaterTestSelection(waterTestSelection);
  persistWaterTestSelection();
  refreshWaterProfileButton();

  // Once runtime loading has begun, backend modules may already be evaluated.
  // Reload so the newly selected FFT/SSR profile is guaranteed to initialize
  // from a clean WebGPU state. Before Play, no reload is necessary.
  if (loading || loaded || window.__riftLoadAttempted) {
    waterProfileButton.textContent += " ↻";
    setTimeout(() => location.reload(), 80);
  }
});

refreshWaterProfileButton();
if (viewport) viewport.appendChild(waterProfileButton);


window.__riftLazyLauncherReady = true;
window.__riftLoadAttempted = false;
window.__riftLoadError = null;

function ensureOverlay() {
  if (overlay?.isConnected) return overlay;
  if (!viewport) return null;

  overlay = document.createElement("div");
  overlay.id = "rift-preflight-loader";
  overlay.style.cssText = "position:absolute;inset:0;z-index:99997;display:none;align-items:center;justify-content:center;pointer-events:auto;background:radial-gradient(circle at 50% 38%,rgba(14,38,54,.97),rgba(3,8,14,.99) 68%);color:#e8f7f7;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;transition:opacity .28s ease;opacity:1";

  const card = document.createElement("div");
  card.style.cssText = "width:min(82%,440px);padding:22px 22px 20px;border:1px solid rgba(102,235,224,.24);border-radius:14px;background:rgba(5,15,23,.88);box-shadow:0 18px 60px rgba(0,0,0,.42)";

  const title = document.createElement("div");
  title.textContent = "RIFT ISLANDS";
  title.style.cssText = "font-size:13px;letter-spacing:.22em;color:#70e7dd;margin-bottom:12px";

  status = document.createElement("div");
  status.textContent = "Starting…";
  status.style.cssText = "font-size:12px;margin-bottom:10px;color:rgba(235,247,247,.92)";

  const track = document.createElement("div");
  track.style.cssText = "height:7px;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.10);box-shadow:inset 0 0 0 1px rgba(255,255,255,.05)";

  bar = document.createElement("div");
  bar.style.cssText = "height:100%;width:0%;border-radius:inherit;background:linear-gradient(90deg,#35cfc3,#a8fff4);box-shadow:0 0 16px rgba(80,235,220,.52);transition:width .18s ease";
  track.appendChild(bar);

  const footer = document.createElement("div");
  footer.style.cssText = "display:flex;justify-content:space-between;gap:12px;margin-top:9px;font-size:10px;color:rgba(220,238,238,.62)";
  detail = document.createElement("span");
  detail.textContent = "On-demand game load";
  detail.style.cssText = "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
  percent = document.createElement("span");
  percent.textContent = "0%";
  footer.append(detail, percent);

  card.append(title, status, track, footer);
  overlay.appendChild(card);
  viewport.appendChild(overlay);
  return overlay;
}

function setProgress(value, statusText, detailText) {
  const el = ensureOverlay();
  if (!el) return;
  shownProgress = Math.max(shownProgress, Math.min(100, Math.round(value)));
  if (bar) bar.style.width = `${shownProgress}%`;
  if (percent) percent.textContent = `${shownProgress}%`;
  if (statusText && status) status.textContent = statusText;
  if (detailText && detail) detail.textContent = detailText;
}

function showOverlay() {
  const el = ensureOverlay();
  if (!el) return;
  el.style.display = "flex";
  el.style.pointerEvents = "auto";
  el.style.opacity = "1";
}

function hideOverlay() {
  if (!overlay) return;
  overlay.style.pointerEvents = "none";
  overlay.style.opacity = "0";
  setTimeout(() => {
    if (overlay && loaded) overlay.style.display = "none";
  }, 300);
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function describeError(err) {
  if (!err) return "Unknown module error";
  const name = err.name || "Error";
  const message = err.message || String(err);
  return `${name}: ${message}`;
}

function showFailure(err) {
  window.__riftLoadError = err || new Error("Unknown Rift load failure");
  showOverlay();
  if (status) {
    status.textContent = "Rift failed to load";
    status.style.color = "#ffb4b4";
  }
  if (detail) {
    detail.textContent = describeError(err);
    detail.style.whiteSpace = "normal";
    detail.style.overflow = "visible";
  }
  if (percent) percent.textContent = "ERR";
  console.error("[rift-lazy-entry] load failed:", err);
}

window.__riftLoaderSetProgress = setProgress;
window.__riftLoaderHide = hideOverlay;

async function loadRiftAndOpenMenu() {
  if (loading || loaded) return;
  loading = true;
  shownProgress = 0;
  window.__riftLoadAttempted = true;
  window.__riftLoadError = null;

  if (playButton) playButton.disabled = true;
  showOverlay();
  setProgress(3, "Loading Rift runtime…", "Initializing WebGPU support");
  await nextPaint();

  let driftTimer = setInterval(() => {
    if (shownProgress < 18) setProgress(shownProgress + 1, "Loading Rift runtime…", "Initializing WebGPU support");
  }, 220);

  try {
    // Import the runtime controller first. This installs the WebGPU performance
    // hooks before the full game creates its renderer, and preloads all shared
    // textures/models before the level menu becomes available.
    runtimeImport = runtimeImport || import("./runtime_bootstrap_v3.js");
    const runtime = await runtimeImport;
    setProgress(24, "Runtime ready", "Loading all shared level assets");

    const activateRuntime = runtime?.activateRuntime || window.__riftActivateRuntime;
    if (typeof activateRuntime === "function") {
      await activateRuntime();
    }

    setProgress(95, "Assets ready", "Loading Rift game module");
    gameImport = gameImport || import("./main_game.js");
    await gameImport;

    if (driftTimer) {
      clearInterval(driftTimer);
      driftTimer = null;
    }

    setProgress(100, "Ready", "Choose any level");
    loaded = true;
    window.__riftModuleLoaded = true;
    await nextPaint();
    hideOverlay();

    // main_game.js has now attached the original title-screen Play handler.
    // Replay exactly once to open the normal level menu; level buttons after
    // this are direct game clicks and are never intercepted by the launcher.
    replaying = true;
    try {
      if (playButton) {
        playButton.disabled = false;
        playButton.click();
      }
    } finally {
      replaying = false;
    }
  } catch (err) {
    if (driftTimer) clearInterval(driftTimer);
    runtimeImport = null;
    gameImport = null;
    loading = false;
    if (playButton) playButton.disabled = false;
    showFailure(err);
    return;
  }

  loading = false;
}

if (playButton) {
  playButton.addEventListener("click", (event) => {
    if (replaying || loaded) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    loadRiftAndOpenMenu();
  }, true);
}