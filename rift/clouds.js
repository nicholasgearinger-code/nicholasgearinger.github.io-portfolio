import * as THREE from "three";
import * as base from "./clouds_storm_base.js";

// Keep the full cloud implementation in the exact known-good base snapshot.
// This wrapper changes only the photoreal sky dome's behavior while a storm is
// active. Everything else (cloud creation, clear-weather mood sequence,
// disposal, cloud occlusion, etc.) is exported unchanged.
export * from "./clouds_storm_base.js";

const STABLE_STORM_COLOR = new THREE.Color(0x292f35);
const PHASE_SEQUENCE = ["midnight", "night", "sunrise", "morning", "noon", "afternoon", "sunset", "twilight"];

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function phaseBucket(phaseT) {
  const t = Number.isFinite(phaseT) ? phaseT : 0;
  const shifted = (t + 1 / 16 + 1) % 1;
  const idx = Math.floor(shifted * PHASE_SEQUENCE.length) % PHASE_SEQUENCE.length;
  return PHASE_SEQUENCE[idx];
}

/**
 * Storm-stable wrapper around the original realistic cloud-dome update.
 *
 * The base implementation deliberately fades the entire dome to opacity 0
 * whenever its mood texture changes. That looks fine for a slow time-of-day
 * transition, but during rain it exposes the brighter day/night background
 * underneath and reads as a full-scene flash. Storms can also begin while a
 * normal mood fade is already in progress.
 *
 * While rain is active we therefore:
 *   1. freeze the current time-of-day mood bucket,
 *   2. cancel any queued opacity-to-zero texture transition,
 *   3. run the base dome update as clear weather so it cannot enter the
 *      special storm texture bucket,
 *   4. apply storm darkness and density smoothly after the base update, and
 *   5. remove the normal ±6% opacity breathing pulse by assigning one stable
 *      storm opacity for the frame.
 *
 * Hysteresis (enter > 0.02, leave < 0.005) prevents threshold chatter while
 * rain intensity is easing in/out.
 */
export function updateRealisticCloudDome(
  handle,
  dt,
  dayAmount,
  skyHorizonColor,
  skyZenithColor,
  stormAmount = 0,
  phaseT = 0,
) {
  if (!handle) return;

  const storm = clamp01(stormAmount);
  const wasStableStorm = !!handle.__riftStableStormActive;
  const stableStormActive = wasStableStorm ? storm > 0.005 : storm > 0.02;

  if (!stableStormActive) {
    handle.__riftStableStormActive = false;
    handle.__riftLastClearPhaseT = phaseT;
    return base.updateRealisticCloudDome(
      handle,
      dt,
      dayAmount,
      skyHorizonColor,
      skyZenithColor,
      storm,
      phaseT,
    );
  }

  if (!wasStableStorm) {
    handle.__riftStableStormActive = true;
    handle.__riftStormFrozenPhaseT = Number.isFinite(handle.__riftLastClearPhaseT)
      ? handle.__riftLastClearPhaseT
      : phaseT;

    // If the storm arrives during an ordinary day/night mood crossfade,
    // abandon that crossfade immediately instead of letting it continue down
    // toward zero opacity behind the storm-darkened sky.
    handle.moodPendingTexture = null;
    handle.moodTransitionT = 0;

    // On a first-frame/debug-forced storm the base may not have selected any
    // mood bucket yet. Seed the frozen bucket so the base update below does not
    // immediately queue a new fade on that first storm frame.
    if (!handle.moodBucket) {
      handle.moodBucket = phaseBucket(handle.__riftStormFrozenPhaseT);
    }
  }

  const frozenPhaseT = Number.isFinite(handle.__riftStormFrozenPhaseT)
    ? handle.__riftStormFrozenPhaseT
    : phaseT;

  // Passing stormAmount=0 is intentional: it prevents the base implementation
  // from switching into its storm mood bucket (the path that queues the
  // fade-to-zero panorama swap). We add the storm appearance ourselves below.
  base.updateRealisticCloudDome(
    handle,
    dt,
    dayAmount,
    skyHorizonColor,
    skyZenithColor,
    0,
    frozenPhaseT,
  );

  // Continuous storm darkening. This is deliberately smooth and monotonic with
  // rain intensity; no strike timer, texture swap, or sine pulse can affect it.
  const darkness = storm * 0.72 * (0.4 + clamp01(dayAmount) * 0.6);
  handle.mat.color.lerp(STABLE_STORM_COLOR, darkness);

  // Stable storm coverage: remove the base dome's ±6% breathing term. A tiny
  // intensity-driven increase still makes heavier rain feel denser without any
  // periodic brightness oscillation.
  const stableOpacity = 0.96 + storm * 0.03;
  handle.mat.opacity = stableOpacity;

  if (handle.capMat) {
    handle.capMat.color.copy(handle.mat.color);
    handle.capMat.opacity = stableOpacity;
  }

  // Preserve some extra storm motion without letting motion influence
  // brightness. The base call above already applied the normal clear-sky drift;
  // this is only the storm-speed increment.
  if (handle.mesh) handle.mesh.rotation.y += Math.max(0, dt) * storm * 0.012;
  if (handle.mat.map?.offset) {
    handle.driftOffset = (handle.driftOffset || 0) + Math.max(0, dt) * storm * 0.003;
    handle.mat.map.offset.x = handle.driftOffset;
  }
}
