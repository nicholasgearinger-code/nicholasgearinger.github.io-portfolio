import * as legacy from "./liquid_legacy.js";
import { createNextWaterSystem } from "./water_next/index.js";
import * as oceanV19 from "./gpu_fft_ocean_r185_v22.js";
import { getEffectiveValue as getBaseGraphicsEffectiveValue } from "./graphicsSettings_fft_base.js";
import { setGPUShallowWaterInteraction } from "./gpu_shallow_water.js";
import { consumeRiftWaterImpact, resetRiftWaterImpacts, emitRiftWaterImpact } from "./waterLabInteractions.js";
import { createFluidLabNearfield } from "./fluidLabNearfield.js";
import { updateFluidLabLocalOptics } from "./fluidLabLocalOptics.js";
import { createGPUFluidBreakers } from "./gpuFluidBreakers.js";

function setFFTReflectionOwnership(active) {
  if (typeof globalThis !== "undefined") {
    globalThis.__riftFFTUsesEnvironmentReflections = !!active;
  }
}

function applyFFTReflectionPreference(handle) {
  const physical = handle?.fftPhysicalMaterial;
  if (!physical) return;

  // Water Pro v19 owns Crystal reflections through the existing physical
  // environment and aligned facet glitter. Mobile SSR and planar captures stay
  // disabled so Safari keeps the proven render/compute graph.
  const enabled = getBaseGraphicsEffectiveValue("reflectionEnabled") !== false;
  if (!enabled) physical.envMapIntensity = 0;
}

function atmosphereWaterArgs(skyColor, sunDir, skyHorizon) {
  const atmosphere = typeof globalThis !== "undefined"
    ? globalThis.__riftReferenceAtmosphere
    : null;
  return {
    atmosphere,
    skyColor: atmosphere?.zenithColor?.isColor ? atmosphere.zenithColor : skyColor,
    sunDir,
    skyHorizon: atmosphere?.horizonColor?.isColor ? atmosphere.horizonColor : skyHorizon,
  };
}

function tuneAtmosphereWaterMaterial(handle, atmosphere, stormAmount = 0) {
  const physical = handle?.fftPhysicalMaterial;
  if (!physical || !atmosphere) return;
  const storm = Math.max(0, Math.min(1, Number(stormAmount) || 0));

  if (physical.attenuationColor?.isColor && atmosphere.waterMidColor?.isColor) {
    physical.attenuationColor.copy(atmosphere.waterMidColor).lerp(atmosphere.waterDeepColor, 0.18 + storm * 0.16);
  }
  physical.attenuationDistance = 58 - storm * 12;
  physical.clearcoat = 0.40;
  physical.clearcoatRoughness = 0.13 + storm * 0.05;

  // Keep reflections energetic enough to read the blue sky but slightly soften
  // the mirror response; the custom facet glitter provides the solar sparkle.
  const enabled = getBaseGraphicsEffectiveValue("reflectionEnabled") !== false;
  if (enabled) physical.envMapIntensity = Math.max(Number(physical.envMapIntensity) || 0, 1.0 - storm * 0.12);
}

export * from "./liquid_legacy.js";

export function createLiquidPlane(
  scene,
  biome,
  y,
  size,
  sampleHeight,
  flowDir = { x: 0.6, z: 0.35 },
  excludeRegions = [],
) {
  if (biome === "crystal") {
    const handle = oceanV19.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
    if (handle?.gpuFFT) {
      handle.__riftOceanBackend = "v19-water-pro";
      // Experimental renderer is opt-in and isolated per water handle.
      // Reloading in Current mode restores the untouched production shader.
      let experimental = false;
      try { experimental = localStorage.getItem("riftWaterGraphicsMode") === "experimental"; } catch (_) {}
      // A/B GPU debugging: keep the game's FFT ocean but bypass experimental
      // geometry/material graph entirely. Never rewrite persisted user choice.
      if (typeof location !== "undefined" &&
          new URLSearchParams(location.search).get("riftDebug") === "noexp") {
        experimental = false;
      }
      if (experimental) {
        try {
          handle.__riftNextWater = createNextWaterSystem({
            simulation: handle, mesh: handle.mesh, material: handle.mesh.material,
            shoreSolver: handle.fftShallowHandle,
            fftDomain: size,
            enableExperimentalGeometry: true, enableExperimentalOptics: true,
          });
          console.info("[rift-water] Experimental unified FFT geometry/optics enabled");
        } catch (error) {
          try { handle.__riftNextWater?.dispose(); } catch (_) {}
          handle.__riftNextWater = null;
          console.warn("[rift-water] Experimental setup failed; current renderer retained", error);
        }
      }
      // Physical breaking crest: the shallow solver's hydraulic jump
      // dissipates momentum and drives an overturning lip/whitewater mesh.
      // Explicit A/B flag or API fallback keeps the old scripted curl.
      const fluidBreakingEnabled = typeof location === "undefined" ||
        new URLSearchParams(location.search).get("riftBreakFluid") !== "off";
      if (fluidBreakingEnabled) {
        try {
          handle.__riftBreakFluid = createGPUFluidBreakers(scene, handle);
          if (handle.__riftBreakFluid) console.info(
            "[rift-water] Live GPU shallow-fluid breaking crest active",
          );
        } catch (error) {
          console.warn("[rift-water] GPU breaker unavailable; scripted curl retained", error);
        }
      }
      // Localized Fluid Lab PBF interaction mesh. One instanced draw with
      // ≤64 droplets on touch hardware. Ocean and distant sea stay FFT.
      const fluidLabEnabled = typeof location === "undefined" ||
        new URLSearchParams(location.search).get("riftFluidLab") !== "off";
      if (fluidLabEnabled) {
        try {
          handle.__riftFluidLabNearfield = createFluidLabNearfield(scene, handle);
        } catch (error) {
          console.warn("[rift-water] Nearfield lab splash layer disabled", error);
        }
      }
      setFFTReflectionOwnership(true);
      applyFFTReflectionPreference(handle);
      console.info(
        `[rift-water] Water Pro v19 selected (${handle.__riftWaterProBackend ?? "FFT"}); persistent breaker-driven shoreline foam`,
      );
    }
    return handle;
  }

  setFFTReflectionOwnership(false);
  return legacy.createLiquidPlane(
    scene,
    biome,
    y,
    size,
    sampleHeight,
    flowDir,
    excludeRegions,
  );
}

export function createBreakingWave() {
  return null;
}

export function updateBreakingWave(handle, ...args) {
  if (!handle) return;
  return legacy.updateBreakingWave(handle, ...args);
}

export function disposeBreakingWave(scene, handle) {
  if (!handle) return;
  return legacy.disposeBreakingWave(scene, handle);
}

export function updateLiquidPlane(
  handle,
  elapsed,
  skyColor,
  cameraY,
  playerPos,
  sunDir,
  skyHorizon,
  reflectionTexture,
  reflectionMatrix,
  refractionTexture,
  resolution,
  stormAmount = 0,
  dayAmount = 1,
) {
  const atmospheric = atmosphereWaterArgs(skyColor, sunDir, skyHorizon);

  if (handle?.gpuFFT) {
    setFFTReflectionOwnership(true);
    applyFFTReflectionPreference(handle);
    tuneAtmosphereWaterMaterial(handle, atmospheric.atmosphere, stormAmount);

    // Scene-based optics are enabled by default in Experimental Mode on all
    // platforms, including iOS, once existing scene captures are available.
    // Do not add render passes: the runtime still controls capture cadence and
    // may disable captures on resource-limited devices. Current Mode is intact.
    const canUseSceneCapture = Boolean(handle.__riftNextWater &&
      reflectionTexture?.isTexture && refractionTexture?.isTexture &&
      reflectionMatrix?.isMatrix4 &&
      getBaseGraphicsEffectiveValue("reflectionEnabled") !== false);
    if (canUseSceneCapture) {
      try { handle.__riftNextWater?.attachSceneCaptures({
        reflectionTexture, reflectionMatrix, refractionTexture
      }); } catch (error) { console.warn("[rift-water] Capture optics activation failed",error); }
    }
    handle.__riftNextWater?.update({ camera: playerPos ? { position: playerPos } : null,
      cameraY, skyColor: atmospheric.skyColor, waterY: handle.waterY,
      elapsed, sunDir: atmospheric.sunDir, dayAmount,
      reflectionMatrix: canUseSceneCapture ? reflectionMatrix : null });
    oceanV19.updateGPUFFTOceanVisuals(
      handle,
      elapsed,
      atmospheric.skyColor,
      cameraY,
      playerPos,
      atmospheric.sunDir,
      atmospheric.skyHorizon,
      null,
      null,
      null,
      resolution,
      stormAmount,
      dayAmount,
    );
    // Keep the local fluid lens centered on the live boat/rower rather
    // than a fixed world coordinate. The camera itself is sampled by TSL.
    updateFluidLabLocalOptics(handle, handle.__riftRowboatWake);
    // Experimental Mode: modestly strengthen both LIVE FFT bands after the
    // normal v9 visual update has set their baseline scales. The existing
    // depth-aware shoreline blend still suppresses offshore energy near land.
    // Current Mode and the native GPU compute workload remain unchanged.
    if (handle.__riftNextWater) {
      // These values are applied AFTER the production visual updater, so
      // adjustments are absolute relative to each frame's baseline, not
      // compounding endlessly. They never alter FFT compute resolution.
      const tuning = globalThis.__riftOceanTuning ?? {};
      const swell = Math.max(0.5, Math.min(2.8, Number(tuning.swell) || 1.65));
      const chop = Math.max(0.5, Math.min(2.6, Number(tuning.chop) || 1.5));
      if (handle.waveScale?.value != null) {
        handle.waveScale.value = Math.min(75, handle.waveScale.value * swell);
      }
      if (handle.fftDetailHandle?.waveScale?.value != null) {
        handle.fftDetailHandle.waveScale.value =
          Math.min(70, handle.fftDetailHandle.waveScale.value * chop);
      }
    }
    return;
  }

  return legacy.updateLiquidPlane(
    handle,
    elapsed,
    atmospheric.skyColor,
    cameraY,
    playerPos,
    atmospheric.sunDir,
    atmospheric.skyHorizon,
    reflectionTexture,
    reflectionMatrix,
    refractionTexture,
    resolution,
    stormAmount,
    dayAmount,
  );
}

export function updateFluidSimWater(handle, renderer, elapsedTime) {
  if (handle?.gpuFFT) {
    // Diagnostic mode freezes existing FFT buffers without destroying them.
    // If the GPU error disappears, focus on FFT/shallow-water compute dispatch.
    // Other GPU compute subsystems (e.g. rain) still run independently.
    if (typeof location !== "undefined" &&
        new URLSearchParams(location.search).get("riftDebug") === "nofft") {
      handle.__riftDiagnosticFFTDisabled = true;
      return;
    }
    return oceanV19.updateGPUFFTOcean(handle, renderer, elapsedTime);
  }
  return legacy.updateFluidSimWater(handle, renderer, elapsedTime);
}

export function updateRippleLayer(handle, renderer, cameraPos, cameraY, dt) {
  if (handle?.gpuFFT) {
    const boatWake = handle.__riftRowboatWake;
    const now = handle.fftV9Time?.value ?? 0;
    // Fluid Lab M5.7: swimmer contact seeds the same event queue as
    // boat/oar impacts. The nearfield PBF spray and the GPU shallow solver
    // both receive this event without adding an ocean simulation pass.
    if (!boatWake?.riding && cameraPos && dt > 0 &&
        Math.abs(cameraY - handle.waterY) < 0.85) {
      const prev = handle.__riftFluidLabSwimmer;
      if (prev) {
        const d = Math.hypot(cameraPos.x - prev.x, cameraPos.z - prev.z);
        const speed = d / Math.max(0.008, dt);
        if (d > 0.055 && speed > 0.6 && speed < 8.5 &&
            now - prev.lastEmit > 0.40) {
          emitRiftWaterImpact(handle, cameraPos.x, cameraPos.z, {
            strength: Math.min(0.9, 0.24 + speed * 0.085),
            radius: 1.35, foam: 0.09, kind: "swim",
          }, now);
          prev.lastEmit = now;
        }
        prev.x = cameraPos.x; prev.z = cameraPos.z;
      } else {
        handle.__riftFluidLabSwimmer = { x: cameraPos.x, z: cameraPos.z, lastEmit: now };
      }
    } else if (handle.__riftFluidLabSwimmer) {
      handle.__riftFluidLabSwimmer = null;
    }
    const lab = consumeRiftWaterImpact(handle, now);
    handle.__riftFluidLabNearfield?.update(dt, now, cameraPos);
    if (boatWake?.riding) {
      // The camera is seated within a moving boat. Do not mistake camera
      // motion for a swimmer and inject a second, exaggerated player wake.
      // Feed the SAME existing shallow solver's interaction uniform with
      // the stern displacement instead. The solver will advect/dissipate
      // it on its normal compute dispatch; this adds zero new GPU passes.
      const impact = lab ?? (boatWake.strength > 0.02 ? boatWake : null);
      if (impact?.strength > 0.02 && handle.fftShallowHandle?.gpuShallowWater) {
        setGPUShallowWaterInteraction(
          handle.fftShallowHandle, impact.x, impact.z,
          impact.strength, impact.radius,
        );
      }
      // Keep the player ripple tracker current for a smooth exit from
      // boat mode, without treating its last land position as a splash.
      if (cameraPos) {
        if (!handle.fftInteractionPrev) {
          handle.fftInteractionPrev = { x: cameraPos.x, z: cameraPos.z };
        } else {
          handle.fftInteractionPrev.x = cameraPos.x;
          handle.fftInteractionPrev.z = cameraPos.z;
        }
        handle.fftInteractionPrevY = cameraY;
      }
      return;
    }
    oceanV19.updateGPUFFTOceanRipples(handle, cameraPos, cameraY, dt);
    // Discrete lab-style drops/impacts can override the continuous swimmer
    // wake in the SAME interaction uniform. No additional GPU dispatch.
    if (lab?.strength > 0.02 && handle.fftShallowHandle?.gpuShallowWater) {
      setGPUShallowWaterInteraction(
        handle.fftShallowHandle, lab.x, lab.z, lab.strength, lab.radius,
      );
    }
    return;
  }
  return legacy.updateRippleLayer(handle, renderer, cameraPos, cameraY, dt);
}

export function disposeLiquidPlane(scene, handle) {
  if (handle?.gpuFFT) {
    setFFTReflectionOwnership(false);
    resetRiftWaterImpacts(handle);
    try { handle.__riftBreakFluid?.dispose(); } catch (error) { console.warn(error); }
    handle.__riftBreakFluid = null;
    try { handle.__riftFluidLabNearfield?.dispose(); } catch (error) { console.warn(error); }
    handle.__riftFluidLabNearfield = null;
    handle.__riftFluidLabSwimmer = null;
    try { handle.__riftNextWater?.dispose(); } catch (error) { console.warn(error); }
    return oceanV19.disposeGPUFFTOcean(scene, handle);
  }
  return legacy.disposeLiquidPlane(scene, handle);
}
