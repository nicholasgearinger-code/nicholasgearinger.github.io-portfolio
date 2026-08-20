// Capture-phase guard registered before the Rift runtime's own click interceptors.
// Mobile double-taps must not bypass a running preflight or queue two synchronous
// level builds. State is looked up at event time so this module can register
// before runtime_bootstrap_v2 initializes it.
document.addEventListener("click", (event) => {
  const state = window.__riftRuntimePreloader;
  if (!state) return;

  const titleButton = event.target?.closest?.("#rift-title-play-btn");
  if (titleButton && state.activated && !state.coreReady) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    return;
  }

  const levelButton = event.target?.closest?.(".rift-level-btn");
  if (levelButton && state.levelWarming) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }
}, true);
