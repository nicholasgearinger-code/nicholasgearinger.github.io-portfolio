import * as THREE from "three";
import {
  Fn, uniform, color, float, vec3,
  positionWorld, cameraPosition,
  attribute, dFdx, dFdy, cross, dot, pow, mix, clamp, smoothstep,
  sin, cos, abs, max,
} from "three/tsl";
import * as oceanV7 from "./gpu_fft_ocean_v7.js";
import * as oceanV8 from "./gpu_fft_ocean_v8.js";
import {
  getGraphicsTier,
  getEffectiveValue,
} from "./graphicsSettings_fft_base.js";

// -----------------------------------------------------------------------------
// Water Pro v9 — one visual model for both the stable mobile FFT path and the
// three-cascade desktop FFT path.
//
// Desktop keeps v8's genuine third 64x64 FFT cascade and persistent whitecaps.
// iOS/touch stays on the proven v7 two-cascade compute path (v8's standalone
// micro FFT previously invalidated Safari's WebGPU command encoder), but gets
// the same fine-scale appearance from cheap analytic micro slopes in this
// fragment/node layer. That preserves stability while adding the surface detail
// that visually separates a flat FFT heightfield from photographic ocean water.
// -----------------------------------------------------------------------------

const HARDWARE_TOUCH_DEVICE = typeof window !== "undefined" && (
  "ontouchstart" in window ||
  (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
);

function readWaterTestMode() {
  const globalMode = typeof globalThis !== "undefined"
    ? globalThis.__riftWaterTestMode
    : null;
  if (globalMode === "mobile" || globalMode === "desktop") return globalMode;
  try {
    const stored = localStorage.getItem("riftWaterTestMode");
    if (stored === "mobile" || stored === "desktop") return stored;
  } catch (_) {
    // Storage can be unavailable in private/embedded contexts; hardware auto
    // detection below remains the safe fallback.
  }
  return HARDWARE_TOUCH_DEVICE ? "mobile" : "desktop";
}

const WATER_TEST_MODE = readWaterTestMode();
const TOUCH_DEVICE = WATER_TEST_MODE === "mobile";

if (typeof globalThis !== "undefined") {
  globalThis.__riftWaterTestMode = WATER_TEST_MODE;
}

function backendForHandle(handle) {
  return handle?.__riftWaterProBackend === "v8-three-fft" ? oceanV8 : oceanV7;
}

function chooseBackend() {
  // Normal play still follows hardware detection. The developer water switch
  // can deliberately force either path so the desktop three-FFT build can be
  // exercised from a phone and the mobile two-FFT build can be checked from a
  // desktop browser.
  return TOUCH_DEVICE ? oceanV7 : oceanV8;
}

function installWaterProOptics(handle) {
  if (!handle?.gpuFFT || handle.fftWaterProV9Installed) return;

  const geometry = handle.mesh?.geometry;
  const material = handle.fftPhysicalMaterial ?? handle.mesh?.material;
  if (!geometry || !material || !geometry.getAttribute?.("fftDepthWorld")) return;

  const depth = attribute("fftDepthWorld", "float");
  const time = uniform(0.0);
  const storm = uniform(0.0);
  const day = handle.fftDaylight ?? uniform(1.0);
  const underwater = handle.fftUnderwaterMix ?? uniform(0.0);
  const lightDirection = handle.fftLightDirection ?? uniform(new THREE.Vector3(0.35, 0.8, 0.3));
  const waterLevel = uniform(handle.waterY ?? 0);

  const shallowColor = uniform(color(0x58d7d2));
  const midColor = uniform(color(0x167f99));
  const deepColor = uniform(color(0x07384f));
  const skyColor = uniform(color(0x78b8d6));
  const sunColor = uniform(color(0xffedd0));
  const crestColor = uniform(color(0xa8eee0));
  const foamColor = handle.fftFoamColor ?? uniform(color(0xfafcf8));

  const originalColor = material.colorNode ?? uniform(color(0x246c78));
  const originalRoughness = material.roughnessNode ?? float(0.05);
  const originalEmissive = material.emissiveNode ?? uniform(color(0x000000));
  const originalTransmission = material.transmissionNode ?? float(
    Number.isFinite(material.transmission) ? material.transmission : 0.68,
  );
  const originalThickness = material.thicknessNode ?? float(
    Number.isFinite(material.thickness) ? material.thickness : 0.24,
  );

  // Reconstruct the actual displaced FFT surface normal in world space, then
  // perturb only the optical calculations with three tiny crossing ripple
  // bands. No new FFT buffers, compute dispatches, textures or draw calls.
  const worldNormal = Fn(() => cross(dFdx(positionWorld), dFdy(positionWorld)).normalize())();

  const phaseA = positionWorld.x.mul(2.15)
    .add(positionWorld.z.mul(1.07))
    .add(time.mul(1.24));
  const phaseB = positionWorld.x.mul(-1.26)
    .add(positionWorld.z.mul(2.72))
    .sub(time.mul(1.61))
    .add(1.73);
  const phaseC = positionWorld.x.mul(4.62)
    .add(positionWorld.z.mul(-3.11))
    .add(time.mul(2.08))
    .add(4.21);

  const microX = TOUCH_DEVICE
    ? cos(phaseA).mul(0.050).add(cos(phaseB).mul(0.036))
    : cos(phaseA).mul(0.050)
      .add(cos(phaseB).mul(0.036))
      .add(cos(phaseC).mul(0.018));
  const microZ = TOUCH_DEVICE
    ? sin(phaseA).mul(0.047).add(sin(phaseB).mul(0.034))
    : sin(phaseA).mul(0.047)
      .add(sin(phaseB).mul(0.034))
      .add(sin(phaseC).mul(0.020));
  const microEnergy = clamp(abs(microX).add(abs(microZ)).mul(5.6), 0, 1);

  const opticalNormal = vec3(
    worldNormal.x.add(microX),
    max(worldNormal.y, float(0.12)),
    worldNormal.z.add(microZ),
  ).normalize();

  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const lightDir = lightDirection.normalize();
  const halfDir = lightDir.add(viewDir).normalize();
  const ndv = clamp(abs(dot(opticalNormal, viewDir)), 0, 1);
  const ndh = clamp(dot(opticalNormal, halfDir), 0, 1);
  const ndl = clamp(dot(opticalNormal, lightDir), 0, 1);
  const fresnel = float(0.02037)
    .add(float(0.97963).mul(pow(float(1).sub(ndv), float(5))));

  // Depth-driven tropical water color. Near-shore water reads turquoise because
  // the sand contributes strongly; offshore water loses red/green energy and
  // settles into a much darker blue body color.
  const shallow = float(1).sub(smoothstep(float(3.0), float(17.0), depth));
  const deep = smoothstep(float(18.0), float(52.0), depth);
  const depthBody = mix(midColor, shallowColor, shallow);
  const depthColor = mix(depthBody, deepColor, deep);
  const depthMix = clamp(
    float(0.28).add(shallow.mul(0.34)).add(deep.mul(0.18)),
    0,
    0.72,
  );

  // Thousands of tiny sun facets rather than one painted streak. The facet mask
  // breaks the highlight into discrete sparkling patches while two BRDF lobes
  // keep a softer solar path underneath them.
  const facetNoise = TOUCH_DEVICE
    ? abs(sin(phaseA.mul(1.37)).mul(sin(phaseB.mul(1.21))))
    : abs(
      sin(phaseA.mul(1.37).add(phaseC.mul(0.31)))
        .mul(sin(phaseB.mul(1.21).sub(phaseC.mul(0.23)))),
    );
  const facetMask = smoothstep(float(0.35), float(0.92), facetNoise);
  const tightGlitter = pow(ndh, float(190))
    .mul(float(0.28).add(microEnergy.mul(1.45)))
    .mul(float(0.42).add(facetMask.mul(0.92)));
  const broadGlitter = pow(ndh, float(34))
    .mul(float(0.085).add(microEnergy.mul(0.055)));
  const glitter = tightGlitter.add(broadGlitter)
    .mul(day)
    .mul(float(1).sub(storm.mul(0.52)))
    .mul(float(1).sub(underwater));

  // Thin crests transmit warm daylight through the blue water volume. This is
  // what makes back-lit wave tips glow turquoise instead of becoming opaque
  // blue geometry.
  const crestHeight = smoothstep(
    waterLevel.add(0.16),
    waterLevel.add(1.18),
    positionWorld.y,
  );
  const backLight = float(1).sub(ndl);
  const translucency = crestHeight
    .mul(backLight)
    .mul(day)
    .mul(float(0.08).add(shallow.mul(0.14)))
    .mul(float(1).sub(storm.mul(0.34)))
    .mul(float(1).sub(underwater));

  // Open-water whitecaps come only from genuinely steep, elevated facets and
  // are broken up spatially. Calm seas get sparse flecks; storms expose many
  // more caps. Shoreline wash remains the separate physical swash solver.
  const geometricSlope = clamp(
    abs(worldNormal.x).add(abs(worldNormal.z)).mul(0.92),
    0,
    1,
  );
  const steep = smoothstep(float(0.30), float(0.70), geometricSlope);
  const capNoise = TOUCH_DEVICE
    ? abs(sin(phaseA.mul(0.71).add(phaseB.mul(0.44))))
    : abs(sin(phaseA.mul(0.71).add(phaseB.mul(0.44))).mul(cos(phaseC.mul(0.53))));
  const capBreakup = smoothstep(float(0.38), float(0.88), capNoise);
  const whitecap = clamp(
    steep
      .mul(crestHeight)
      .mul(float(0.11).add(storm.mul(0.82)))
      .mul(float(0.48).add(capBreakup.mul(0.62)))
      .mul(float(1).sub(underwater)),
    0,
    0.86,
  );

  material.colorNode = Fn(() => {
    let body = mix(originalColor, depthColor, depthMix);
    body = mix(
      body,
      skyColor,
      clamp(fresnel.mul(float(0.09).add(day.mul(0.18))), 0, 0.28),
    );
    body = mix(body, crestColor, clamp(translucency, 0, 0.20));
    body = mix(body, foamColor, whitecap.mul(0.94));
    return body.add(sunColor.mul(glitter.mul(0.42)));
  })();

  const microRoughness = mix(
    originalRoughness,
    float(0.082),
    microEnergy.mul(0.20),
  );
  material.roughnessNode = mix(microRoughness, float(0.46), whitecap.mul(0.86));
  material.emissiveNode = originalEmissive
    .add(crestColor.mul(translucency.mul(0.012)))
    .add(sunColor.mul(glitter.mul(0.014)));

  // MeshPhysicalNodeMaterial supports per-pixel transmission/thickness. Shallow
  // and back-lit crests become clearer, while foam suppresses transmission.
  const aboveTransmission = mix(
    originalTransmission,
    float(0.86),
    clamp(shallow.mul(0.46).add(translucency.mul(0.75)), 0, 0.72),
  ).mul(float(1).sub(whitecap.mul(0.86)));
  material.transmissionNode = mix(aboveTransmission, float(0.94), underwater);
  material.thicknessNode = mix(
    mix(originalThickness, float(0.075), shallow.mul(0.66)),
    float(0.045),
    translucency.mul(0.72),
  );

  material.needsUpdate = true;

  handle.fftV9Time = time;
  handle.fftV9Storm = storm;
  handle.fftV9ShallowColor = shallowColor;
  handle.fftV9MidColor = midColor;
  handle.fftV9DeepColor = deepColor;
  handle.fftV9SkyColor = skyColor;
  handle.fftV9SunColor = sunColor;
  handle.fftV9CrestColor = crestColor;
  handle.fftWaterProV9Installed = true;
}

function tuneWaterProState(handle, elapsed = 0, sky = null, storm = 0, day = 1) {
  if (!handle?.gpuFFT) return;
  installWaterProOptics(handle);

  const stormT = THREE.MathUtils.clamp(Number(storm) || 0, 0, 1);
  const dayT = THREE.MathUtils.clamp(Number(day) || 0, 0, 1);
  if (handle.fftV9Time) handle.fftV9Time.value = Number.isFinite(elapsed) ? elapsed : 0;
  if (handle.fftV9Storm) handle.fftV9Storm.value = stormT;

  if (handle.fftV9SkyColor?.value) {
    if (sky?.isColor) handle.fftV9SkyColor.value.copy(sky);
    else handle.fftV9SkyColor.value.set(0x78b8d6);
  }
  if (handle.fftV9SunColor?.value) {
    handle.fftV9SunColor.value
      .set(0xbad8ef)
      .lerp(new THREE.Color(0xffedd0), dayT);
  }
  if (handle.fftV9CrestColor?.value) {
    handle.fftV9CrestColor.value
      .set(0x5b9fb0)
      .lerp(new THREE.Color(0xa8eee0), dayT);
  }

  // Make both real FFT bands more legible on mobile. Desktop additionally has
  // v8's genuine third 64x64 micro cascade; tune it here after the base update.
  if (handle.waveScale) handle.waveScale.value = 25.2 + stormT * 6.4;
  if (handle.fftDetailHandle?.waveScale) {
    handle.fftDetailHandle.waveScale.value = 24.4 + stormT * 7.0;
  }
  if (handle.fftMicroHandle?.waveScale) {
    handle.fftMicroHandle.waveScale.value = 12.4 + stormT * 4.0;
  }

  const physical = handle.fftPhysicalMaterial;
  if (physical) {
    physical.ior = 1.333;
    physical.attenuationDistance = TOUCH_DEVICE ? 52 : 64;
    physical.attenuationColor.set(0x86cbc6);
    physical.clearcoat = TOUCH_DEVICE ? 0.34 : 0.48;
    physical.clearcoatRoughness = 0.10 + stormT * 0.045;

    const reflectionsOn = getEffectiveValue("reflectionEnabled") !== false;
    const tier = getGraphicsTier();
    const envStrength = tier === "high" ? 1.35 : tier === "medium" ? 1.10 : 0.88;
    physical.envMapIntensity = reflectionsOn ? envStrength : 0;
  }
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const backend = chooseBackend();
  const handle = backend.createGPUFFTOceanPlane(scene, y, size, sampleHeight);
  if (!handle?.gpuFFT) return handle;

  handle.__riftWaterProBackend = backend === oceanV8 ? "v8-three-fft" : "v7-two-fft-mobile";
  installWaterProOptics(handle);
  tuneWaterProState(handle, 0, null, 0, 1);
  console.info(
    `[gpu-fft-ocean] ACTIVE v9 Water Pro: ${handle.__riftWaterProBackend} (test profile: ${WATER_TEST_MODE}) + depth color + translucent crests + whitecaps + facet glitter`,
  );
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  return backendForHandle(handle).updateGPUFFTOcean(handle, renderer, elapsedTime);
}

export function updateGPUFFTOceanVisuals(
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
  storm = 0,
  day = 1,
) {
  backendForHandle(handle).updateGPUFFTOceanVisuals(
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
    storm,
    day,
  );
  tuneWaterProState(handle, elapsed, skyColor, storm, day);
}

export function updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt = 1 / 60) {
  return backendForHandle(handle).updateGPUFFTOceanRipples(handle, playerPos, cameraY, dt);
}

export function disposeGPUFFTOcean(scene, handle) {
  return backendForHandle(handle).disposeGPUFFTOcean(scene, handle);
}