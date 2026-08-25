import * as current from "./weather.js";

export * from "./weather.js";

// -----------------------------------------------------------------------------
// Stable-lighting weather wrapper
// -----------------------------------------------------------------------------
// The visible lightning bolt may change quickly, but no separate scene light or
// giant additive sky sprite is allowed to flash with it. Those secondary flash
// layers were the source of the full-frame/large-area brightness flicker that
// returned after the older storm-flicker fix had already disabled legacy global
// lightning illumination.
// -----------------------------------------------------------------------------

function stabilizeLightningLighting(handle) {
  if (!handle) return;

  const rig = handle.__riftLightningFlashRig;
  if (rig) {
    // Remove every environmental flash object from the scene. weather.js can
    // continue advancing its internal envelope, but none of these objects can
    // reach the renderer. The actual depth-tested lightning bolt lives in the
    // underlying weather_lightning_visible_base.js path and is unaffected.
    rig.strikeLight?.removeFromParent?.();
    rig.skyFill?.removeFromParent?.();
    rig.skyGlow?.removeFromParent?.();

    if (rig.strikeLight) rig.strikeLight.intensity = 0;
    if (rig.skyFill) rig.skyFill.intensity = 0;
    if (rig.glowMaterial) rig.glowMaterial.opacity = 0;
    if (rig.skyGlow) rig.skyGlow.visible = false;
  }

  // Preserve the established no-global-flash contract from
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
