import * as THREE from "three";
import * as current from "./weather_storm_base.js";
export * from "./weather_storm_base.js";

// The base weather module contains the existing rain/wind/lightning behavior.
// This thin wrapper owns storm-light stability only: it removes the old cloud
// material accessor guard (clouds.js now owns that concern), hard-disables every
// scene-wide lightning flash channel, and gives the visible bolt a soft envelope
// so it cannot pop the whole frame white on mobile displays.

function hardDisableSceneFlash(handle) {
  if (!handle) return;
  handle.lightningFlash = 0;
  if (handle.lightningLight) handle.lightningLight.intensity = 0;

  const distant = handle.distantLightning;
  if (distant) {
    distant.flash = 0;
    distant.timer = Number.POSITIVE_INFINITY;
    if (distant.sprite) {
      distant.sprite.visible = false;
      if (distant.sprite.material) distant.sprite.material.opacity = 0;
    }
  }
}

function neutralizeOldCrystalSkyGuard(handle) {
  const guarded = handle?.crystalStormSkyMaterials;
  if (!guarded || guarded.length === 0) return;

  for (const material of guarded) {
    if (!material) continue;
    const opacity = material.opacity;
    const map = material.map;

    try {
      delete material.opacity;
      material.opacity = opacity;
      if ("map" in material || map) {
        delete material.map;
        material.map = map;
      }
    } catch (_) {
      // Best effort only. A failed cleanup must never interrupt the weather
      // update; the hard lightning suppression below still remains active.
    }

    // The base wrapper checks this sentinel before installing its accessor
    // guard. Keep the sentinel but remove the accessors so it stays disabled on
    // later frames without repeatedly redefining material properties.
    material.userData = material.userData || {};
    material.userData.riftCrystalStormSkyGuard = true;
  }

  handle.crystalStormSkyMaterials = [];
}

function configureStableBolt(handle) {
  const bolt = handle?.realLightningBolt;
  if (!bolt || bolt.__riftStableLightingConfigured) return;

  if (bolt.coreMaterial) {
    bolt.coreMaterial.blending = THREE.NormalBlending;
    bolt.coreMaterial.depthTest = true;
    bolt.coreMaterial.depthWrite = false;
    bolt.coreMaterial.toneMapped = true;
    bolt.coreMaterial.needsUpdate = true;
  }

  if (bolt.glowMaterial) {
    bolt.glowMaterial.blending = THREE.AdditiveBlending;
    bolt.glowMaterial.depthTest = true;
    bolt.glowMaterial.depthWrite = false;
    bolt.glowMaterial.toneMapped = true;
    bolt.glowMaterial.needsUpdate = true;
  }

  bolt.__riftStableLightingConfigured = true;
}

function smooth01(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function stabilizeVisibleBolt(handle) {
  const bolt = handle?.realLightningBolt;
  if (!bolt || !bolt.group?.visible || !(bolt.life > 0)) return;

  const duration = Math.max(0.001, Number(bolt.duration) || 0.5);
  const age = Math.max(0, duration - bolt.life);

  // About a tenth-second attack removes the one-frame hard pop. The short
  // release preserves the readable strike shape without a strobing plateau.
  const attack = smooth01(age / 0.10);
  const release = smooth01(Math.min(1, bolt.life / 0.18));
  const envelope = attack * release;

  if (bolt.coreMaterial) {
    bolt.coreMaterial.opacity = Math.min(
      Number.isFinite(bolt.coreMaterial.opacity) ? bolt.coreMaterial.opacity : 1,
      0.58 * envelope,
    );
  }

  if (bolt.glowMaterial) {
    bolt.glowMaterial.opacity = Math.min(
      Number.isFinite(bolt.glowMaterial.opacity) ? bolt.glowMaterial.opacity : 1,
      0.045 * envelope,
    );
  }
}

export function createWeatherSystem(scene, biome) {
  const handle = current.createWeatherSystem(scene, biome);
  configureStableBolt(handle);
  hardDisableSceneFlash(handle);
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

  neutralizeOldCrystalSkyGuard(handle);
  configureStableBolt(handle);
  hardDisableSceneFlash(handle);
  stabilizeVisibleBolt(handle);
  return result;
}

export function disposeWeatherSystem(scene, handle) {
  return current.disposeWeatherSystem(scene, handle);
}
