import * as THREE from "three";

// Lightweight guard around the Rift renderer. The main game module still exists
// on the portfolio page, but it does not need to submit GPU frames while the
// visitor has not pressed Play, or while an already-started Rift viewport is
// scrolled completely off-screen.
const state = typeof window !== "undefined" ? window.__riftRuntimePreloader : null;
if (state && state.viewportVisible === undefined) state.viewportVisible = true;

const viewport = typeof document !== "undefined" ? document.getElementById("rift-viewport") : null;
if (state && viewport && typeof IntersectionObserver !== "undefined") {
  const observer = new IntersectionObserver((entries) => {
    const entry = entries[0];
    state.viewportVisible = !!entry?.isIntersecting && (entry.intersectionRatio ?? 0) > 0.01;
  }, { threshold: [0, 0.01, 0.1] });
  observer.observe(viewport);
  state.viewportObserver = observer;
}

function shouldPause(renderer) {
  if (!state || state.renderer !== renderer) return false;
  if (!state.activated) return true;
  if (state.gameStarted && state.viewportVisible === false) return true;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return true;
  return false;
}

const proto = THREE.WebGPURenderer?.prototype;
if (proto && !proto.__riftIdleGatePatched) {
  proto.__riftIdleGatePatched = true;

  for (const methodName of ["render", "compute"]) {
    const original = proto[methodName];
    if (typeof original !== "function") continue;
    proto[methodName] = function (...args) {
      if (shouldPause(this)) return undefined;
      return original.apply(this, args);
    };
  }

  for (const methodName of ["renderAsync", "computeAsync"]) {
    const original = proto[methodName];
    if (typeof original !== "function") continue;
    proto[methodName] = function (...args) {
      if (shouldPause(this)) return Promise.resolve();
      return original.apply(this, args);
    };
  }
}
