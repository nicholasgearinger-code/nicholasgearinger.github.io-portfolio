import * as current from "./weather.js";

export * from "./weather.js";

// -----------------------------------------------------------------------------
// Stable-lighting weather wrapper
// -----------------------------------------------------------------------------
// weather_lightning_visible_base.js deliberately disabled the old whole-scene
// lightning flash because rapidly changing scene lights brought back the exact
// full-frame flashing/flicker artifact we had already removed. weather.js later
// added a second environmental flash rig (15,000-intensity PointLight plus a
// HemisphereLight), unintentionally reintroducing that problem.
//
// Keep the visible, depth-tested lightning bolt and its localized sky-glow sprite,
// but permanently remove the two rapidly changing scene lights from the scene.
// The bolt remains bright/emissive; terrain, sun/moon lighting and shadow maps stay
// stable from frame to frame.
// -----------------------------------------------------------------------------

function stabilizeLightningLighting(handle) {
  if (!handle) return;

  const rig = handle.__riftLightningFlashRig;
  if (rig) {
    // Removing these from the scene is stronger than merely setting intensity=0:
    // weather.js can continue updating its private flash envelope without ever
    // putting a rapidly changing light back into the renderer's lighting graph.
    rig.strikeLight?.removeFromParent?.();
    rig.skyFill?.removeFromParent?.();
    if (rig.strikeLight) rig.strikeLight.intensity = 0;
    if (rig.skyFill) rig.skyFill.intensity = 0;
  }

  // Preserve the already-established no-global-flash contract from
  // weather_lightning_visible_base.js as well.
  handle.lightningFlash = 0;
  if (handle.lightningLight) handle.lightningLight.intensity = 0;
}

export function createWeatherSystem(scene, biome, ...args) {
  const handle = current.createWeatherSystem(scene, biome, ...args);
  stabilizeLightningLighting(handle);
  return handle;
}

export function updateWeatherSystem(
  handle,
  dt,
  erupting = false,
  dayAmount = 0,
  playerPos = null,
) {
  const result = current.updateWeatherSystem(
    handle,
    dt,
    erupting,
    dayAmount,
    playerPos,
  );
  stabilizeLightningLighting(handle);
  return result;
}

export function disposeWeatherSystem(scene, handle) {
  return current.disposeWeatherSystem(scene, handle);
}
