import * as current from "./clouds_storm_base.js";
export * from "./clouds_storm_base.js";

// Storm presentation must have one owner. The base cloud system still changes
// time-of-day mood textures, but during rain we keep the already-visible sky
// texture and let stormAmount drive only smooth color/density changes. This
// prevents a panorama swap or opacity fade from reading as a full-screen flash.
const STORM_SKY_THRESHOLD = 0.01;
const STORM_SKY_HOLD_SECONDS = 4.0;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function updateRealisticCloudDome(
  handle,
  dt,
  dayAmount,
  skyHorizonColor,
  skyZenithColor,
  stormAmount,
  phaseT,
) {
  if (!handle) {
    return current.updateRealisticCloudDome(
      handle,
      dt,
      dayAmount,
      skyHorizonColor,
      skyZenithColor,
      stormAmount,
      phaseT,
    );
  }

  const storm = clamp01(stormAmount);
  const safeDt = Math.max(0, Number(dt) || 0);
  const storming = storm > STORM_SKY_THRESHOLD;

  if (storming && !handle.__riftStormSkyLocked) {
    handle.__riftStormSkyMap = handle.mat?.map ?? null;
    handle.__riftStormSkyMoodTextureName = handle.moodTextureName;
  }

  if (storming) {
    handle.__riftStormSkyLocked = true;
    handle.__riftStormSkyHold = STORM_SKY_HOLD_SECONDS;
  } else if (handle.__riftStormSkyLocked) {
    handle.__riftStormSkyHold = Math.max(
      0,
      (handle.__riftStormSkyHold || 0) - safeDt,
    );
  }

  const hold = Math.max(0, handle.__riftStormSkyHold || 0);
  const lockSky = storming || (handle.__riftStormSkyLocked && hold > 0);
  const stableMap = handle.__riftStormSkyMap ?? null;
  const stableMoodTextureName = handle.__riftStormSkyMoodTextureName;

  const result = current.updateRealisticCloudDome(
    handle,
    dt,
    dayAmount,
    skyHorizonColor,
    skyZenithColor,
    stormAmount,
    phaseT,
  );

  if (lockSky) {
    // Never let the storm transition replace the whole panorama while it is
    // visible. The base update may have attempted the swap already this frame,
    // so restore the pre-storm texture before rendering.
    if (handle.mat && stableMap && handle.mat.map !== stableMap) {
      handle.mat.map = stableMap;
      handle.mat.needsUpdate = true;
    }

    // Cancel any queued storm/time-of-day crossfade. Leaving moodBucket alone
    // means the base module will not continually re-queue the same transition.
    handle.moodPendingTexture = null;
    handle.moodTransitionT = 0;
    if (stableMoodTextureName !== undefined) {
      handle.moodTextureName = stableMoodTextureName;
    }

    // No opacity breathing while storming. Brightness now follows only the
    // smoothly-eased rain intensity instead of a second independent sine wave.
    const holdAmount = storming ? 1 : clamp01(hold / STORM_SKY_HOLD_SECONDS);
    const stableOpacity = 0.94 + 0.05 * Math.max(storm, holdAmount);
    if (handle.mat) handle.mat.opacity = stableOpacity;
    if (handle.capMat) handle.capMat.opacity = stableOpacity;
  } else if (handle.__riftStormSkyLocked) {
    handle.__riftStormSkyLocked = false;
    handle.__riftStormSkyHold = 0;
    handle.__riftStormSkyMap = null;
    handle.__riftStormSkyMoodTextureName = undefined;
  }

  return result;
}
