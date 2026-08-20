// Rift Islands lazy entry. This file is intentionally tiny: the portfolio loads
// it, but the actual game module and its large import graph are not requested
// until the visitor presses Play inside the Rift window.

const playButton = document.getElementById("rift-title-play-btn");
const viewport = document.getElementById("rift-viewport");

let loading = false;
let loaded = false;
let replaying = false;
let gameImport = null;
let overlay = null;
let bar = null;
let percent = null;
let status = null;
let detail = null;
let shownProgress = 0;

function ensureOverlay() {
  if (overlay?.isConnected) return overlay;
  if (!viewport) return null;

  overlay = document.createElement("div");
  overlay.id = "rift-preflight-loader";
  overlay.style.cssText = "position:absolute;inset:0;z-index:99997;display:none;align-items:center;justify-content:center;pointer-events:auto;background:radial-gradient(circle at 50% 38%,rgba(14,38,54,.97),rgba(3,8,14,.99) 68%);color:#e8f7f7;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;transition:opacity .28s ease;opacity:1";

  const card = document.createElement("div");
  card.style.cssText = "width:min(78%,430px);padding:22px 22px 20px;border:1px solid rgba(102,235,224,.24);border-radius:14px;background:rgba(5,15,23,.86);box-shadow:0 18px 60px rgba(0,0,0,.42)";
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
  footer.style.cssText = "display:flex;justify-content:space-between;gap:12px;margin-top:9px;font-size:10px;color:rgba(220,238,238,.56)";
  detail = document.createElement("span");
  detail.textContent = "On-demand game load";
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
  bar.style.width = `${shownProgress}%`;
  percent.textContent = `${shownProgress}%`;
  if (statusText) status.textContent = statusText;
  if (detailText) detail.textContent = detailText;
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

function showFailure(err) {
  showOverlay();
  setProgress(Math.max(shownProgress, 5), "Rift failed to load", "Reload the page to retry after an update");
  if (status) status.style.color = "#ffb4b4";
  console.error("[rift-lazy-entry] load failed:", err);
}

window.__riftLoaderSetProgress = setProgress;
window.__riftLoaderHide = hideOverlay;

async function loadRiftAndOpenMenu() {
  if (loading || loaded) return;
  loading = true;
  shownProgress = 0;
  if (playButton) playButton.disabled = true;
  showOverlay();
  setProgress(3, "Loading Rift engine…", "Game code and level systems");

  let driftTimer = setInterval(() => {
    if (shownProgress < 34) setProgress(shownProgress + 1, "Loading Rift engine…", "Game code and level systems");
  }, 180);

  try {
    gameImport = gameImport || import("./main_game.js");
    await gameImport;
    clearInterval(driftTimer);
    driftTimer = null;
    setProgress(38, "Engine ready", "Preparing all shared level assets");

    if (typeof window.__riftActivateRuntime === "function") {
      await window.__riftActivateRuntime();
    }

    setProgress(100, "Ready", "Choose any level");
    loaded = true;
    window.__riftModuleLoaded = true;
    await nextPaint();
    hideOverlay();

    replaying = true;
    if (playButton) {
      playButton.disabled = false;
      playButton.click();
    }
    replaying = false;
  } catch (err) {
    if (driftTimer) clearInterval(driftTimer);
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
