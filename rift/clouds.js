// Storm-stable wrapper around the existing cloud implementation.
//
// The legacy realistic-cloud dome intentionally fades its entire panorama to
// opacity 0 while changing mood textures. During a dark storm that exposes the
// brighter day/night background for a frame sequence and reads as a full-screen
// flash. Keep the existing cloud implementation intact, but clamp the dome back
// to an opaque storm presentation after each legacy update so rendering never
// sees that fade-to-zero state.

import * as legacy from "./clouds_current.js";
export * from "./clouds_current.js";

const STORM_SKY_HOLD_SECONDS = 3.5;
const STORM_SKY_MIN_OPACITY = 0.94;
const STORM_SKY_MAX_OPACITY = 0.99;

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
    return legacy.updateRealisticCloudDome(
      handle,
      dt,
      dayAmount,
      skyHorizonColor,
      skyZenithColor,
      stormAmount,
      phaseT,
    );
  }

  const storm = Math.max(0, Math.min(1, Number(stormAmount) || 0));

  // Hold the clamp briefly after rain falls below the storm threshold. This
  // covers the legacy storm -> time-of-day mood transition too, so the dome
  // cannot briefly reveal the much brighter fallback sky as the storm ends.
  if (storm > 0.01) {
    handle.__stormSkyHold = STORM_SKY_HOLD_SECONDS;
  } else {
    handle.__stormSkyHold = Math.max(0, (handle.__stormSkyHold || 0) - Math.max(0, dt || 0));
  }

  const result = legacy.updateRealisticCloudDome(
    handle,
    dt,
    dayAmount,
    skyHorizonColor,
    skyZenithColor,
    stormAmount,
    phaseT,
  );

  if (storm > 0.01 || handle.__stormSkyHold > 0) {
    const opacity = STORM_SKY_MIN_OPACITY
      + (STORM_SKY_MAX_OPACITY - STORM_SKY_MIN_OPACITY) * storm;

    if (handle.mat) {
      handle.mat.opacity = Math.max(handle.mat.opacity || 0, opacity);
    }

    if (handle.capMat) {
      handle.capMat.opacity = Math.max(handle.capMat.opacity || 0, opacity);
    }
  }

  return result;
}
