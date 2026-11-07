import * as THREE from "three";
// Namespace import allows a clean fallback when the r182 TSL viewport
// features are unavailable on a device, without a missing-export crash.
import * as WaterTSL from "three/tsl";
import {
  Fn, uniform, color, float, vec2, vec3, texture,
  positionWorld, cameraPosition,
  attribute, dFdx, dFdy, cross, dot, pow, mix, clamp, smoothstep,
  sin, cos, abs, max, exp,
} from "three/tsl";
import * as oceanV7 from "./gpu_fft_ocean_v7.js";
import * as oceanV8 from "./gpu_fft_ocean_v8.js";
import { getRealisticCloudTexture } from "./clouds_storm_base.js";
import { createFluidLabShoreFlow } from "./fluidLabShoreFlow.js";
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
// Art-target pass: glassy blue-green water, visible seabed, bright local
// highlights, and Fresnel reflection without a flat opaque color sheet.
// ?riftGlassLook=off reverts this pass for direct visual A/B comparisons.
const REFERENCE_GLASS_LOOK = typeof location === "undefined" ||
  new URLSearchParams(location.search).get("riftGlassLook") !== "off";

// Phase 1's experimental Beer-Lambert/viewport transparency branch caused
// a regression on the live iPhone path. Restore the previously working glass
// optics by default; Phase 2 animation remains active independently.
// Explicitly opt in with ?riftPhysics1=on to test the isolated Phase 1 path.
// Keep ?riftPhysics1=off as a backwards-compatible safe setting.
const PHYSICAL_OPTICS_PHASE1 = typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("riftPhysics1") === "on";
const WATER_IOR = 1.333;
// Fallback for the fragile mobile/WebGPU shader path: append
// ?riftLabOptics=off to compile out the lab-derived local foam math.
const RIFT_LAB_OPTICS = typeof location === "undefined" ||
  new URLSearchParams(location.search).get("riftLabOptics") !== "off";
// Fluid Lab-derived surface hydrodynamics: read solved shallow water velocity
// and aeration in the vertex stage. Revert with ?riftFluidLab=off.
const RIFT_FLUID_LAB_SURFACE = typeof location === "undefined" ||
  new URLSearchParams(location.search).get("riftFluidLab") !== "off";
// Pool-inspired shore optics: clear thin-water absorption, water-column
// transmission, and normal-based focusing instead of tiled marble bands.
// ?riftPoolShore=off compiles the previous shoreline look for A/B testing.
const POOL_SHORE_OPTICS = typeof location === "undefined" ||
  new URLSearchParams(location.search).get("riftPoolShore") !== "off";
// Phase 2 adds a coherent multi-scale normal field over the existing two
// REAL geometry FFT cascades; ?riftWaves2=off restores legacy optical chop.
const PHASE2_WAVE_MOTION = typeof location === "undefined" ||
  new URLSearchParams(location.search).get("riftWaves2") !== "off";
// Phase 3 acts ONLY on the underside light transport; it is independent of
// the failed Phase 1 physical optics branch, which remains opt-in.
// ?riftUnderwater3=off restores the prior underwater surface illumination.
const PHASE3_UNDERWATER_TRANSPORT = typeof location === "undefined" ||
  new URLSearchParams(location.search).get("riftUnderwater3") !== "off";
// A/B switch for coherent small-wave reflection, refracted distortion,
// and crest-localized microfoam. Uses the existing FFT material and wave
// phases: no extra mesh, texture, compute step or render pass.
// ?riftWaveLens=off keeps the last working Phases 2/3 water unmodified.
const WAVE_LENS_LAYER = typeof location === "undefined" ||
  new URLSearchParams(location.search).get("riftWaveLens") !== "off";
// Stronger, camera-stable refraction on BOTH sides of the real FFT surface.
// A separate switch makes it possible to isolate refraction from PBR normal
// shading and foam: ?riftDistortion2=off restores the original bend amounts.
const WAVE_DISTORTION_2 = typeof location === "undefined" ||
  new URLSearchParams(location.search).get("riftDistortion2") !== "off";
// Stage: one coherent glossy surface + actively spilling, matte foam crests.
// The reflected sky reuses the underside's EXISTING cloud texture sample;
// no extra render passes, FFT cascades, texture fetches or draw calls.
// ?riftCrestReflect=off restores the prior shading/foam and breaker mesh.
const REFLECTIVE_CRESTS = typeof location === "undefined" ||
  new URLSearchParams(location.search).get("riftCrestReflect") !== "off";
// Shallow breaking surf v2: depth-localized wave faces and fractured crest
// foam rather than a uniform white band at the sand line. The existing
// seafloor-depth vertex attribute and shoreline clock are reused.
// ?riftSurf2=off restores previous offshore/shoreline surface shading.
const SURF_REALISM_V2 = typeof location === "undefined" ||
  new URLSearchParams(location.search).get("riftSurf2") !== "off";
// Fix drone-view rows of white oval reflections: the old MOBILE facet mask
// multiplied two spatially periodic sinusoids. Their intersections formed
// a mathematically regular lattice, emphasized by the 0.052 glossy BRDF.
// This replaces that synthetic sparkle grid with wave-normal highlights,
// gently dithered facet response, and distance-dependent roughness/LOD.
// No new texture fetches/compute/geometry. A/B: ?riftGridFix=off.
const GRID_FREE_WATER_HIGHLIGHTS = typeof location === "undefined" ||
  new URLSearchParams(location.search).get("riftGridFix") !== "off";
const AIR_WATER_R0 = ((WATER_IOR - 1) / (WATER_IOR + 1)) ** 2;

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
  const labHydro = RIFT_FLUID_LAB_SURFACE
    ? createFluidLabShoreFlow(handle, geometry) : null;
  const time = uniform(0.0);
  const storm = uniform(0.0);
  // Driven by the shoreline solver after each visual update. These are
  // scalar uniforms, not a new texture, buffer, or WebGPU compute pass.
  const surfPhase = uniform(0.0);
  const surfSetStrength = uniform(0.73);
  const surfPulse = uniform(0.0);
  const surfFront = uniform(3.3);
  const surfStrength = uniform(0.73);
  const day = handle.fftDaylight ?? uniform(1.0);
  const underwater = handle.fftUnderwaterMix ?? uniform(0.0);
  const lightDirection = handle.fftLightDirection ?? uniform(new THREE.Vector3(0.35, 0.8, 0.3));
  const waterLevel = uniform(handle.waterY ?? 0);

  const shallowColor = uniform(color(0x2fc6c7));
  const midColor = uniform(color(0x16689d));
  const deepColor = uniform(color(0x0c4f83));
  const skyColor = uniform(color(0xa9ddf6));
  // Respect the existing Graphics > Reflections switch at runtime.
  const reflectionStrength = uniform(1.0);
  // Share the exact cloud panorama already rendered by the sky dome.
  // The texture is globally cached by the cloud module and not owned here.
  const cloudSkyTexture = getRealisticCloudTexture();

  const sunColor = uniform(color(0xfff6de));
  const crestColor = uniform(color(0x71ead5));
  const foamColor = handle.fftFoamColor ?? uniform(color(0xfafcf8));
  // Fluid Lab M5.7/M4.1: a short-lived, event-driven whitened patch at
  // paddle/splash impact points. The actual propagating wave is injected
  // into Rift's existing GPU shallow-water solver, not this shader.
  // Only three uniforms and simple squared-distance math; no textures,
  // render targets, compute dispatches or shader replacement.
  const labImpactCenter = uniform(new THREE.Vector2(0, 0));
  const labImpactEnergy = uniform(0);
  const labImpactInvRadiusSq = uniform(0.25);

  const originalColor = material.colorNode ?? uniform(color(0x247b99));
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
  // The densely tessellated FFT mesh still has a finite sampling pitch.
  // Avoid amplifying face-to-face derivative changes into broad underwater
  // reflection polygons. Keep the real normal above water and preserve a
  // moderated slope beneath it for continuous, stable sky distortion.
  const underwaterOpticalNormal = mix(
    worldNormal,
    vec3(0, 1, 0),
    underwater.mul(0.38)
  ).normalize(); // retain more live FFT slope below water for undulating overhead waves

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

  // Phase 2: coherent directional waves with mathematically matched X/Z
  // gradients. The two existing FFT cascades carry LARGE and MEDIUM geometry.
  // These two crossing bands supply short wavelets; phaseA/B contribute
  // finer capillary-scale normal slopes. Both slope components are derived
  // from the SAME wave phases, unlike the old unrelated sine/cosine ripple
  // offsets. No new FFT kernels, material textures or surface vertices.
  const fineRippleA = sin(phaseA.mul(0.66).sub(phaseB.mul(0.29)));
  const fineRippleB = cos(phaseB.mul(0.73).add(phaseA.mul(0.22)));
  const shortSlopeA = cos(phaseA);
  const shortSlopeB = cos(phaseB);
  // Wave vectors approximately (1.25,-0.08) and (0.04,1.29) rad/m.
  // 0.056m / 0.048m virtual ripple heights produce modest coherent slopes.
  const mediumA = cos(phaseA.mul(0.46).sub(phaseB.mul(0.21)));
  const mediumB = sin(phaseA.mul(0.24).add(phaseB.mul(0.38)));
  const phase2SlopeX = mediumA.mul(0.071)
    .add(mediumB.mul(-0.002))
    .add(shortSlopeA.mul(0.043))
    .add(shortSlopeB.mul(-0.019))
    .add(TOUCH_DEVICE ? float(0) : cos(phaseC).mul(0.009));
  const phase2SlopeZ = mediumA.mul(-0.0045)
    .add(mediumB.mul(0.062))
    .add(shortSlopeA.mul(0.021))
    .add(shortSlopeB.mul(0.042))
    .add(TOUCH_DEVICE ? float(0) : cos(phaseC).mul(-0.006));
  const legacyX = TOUCH_DEVICE
    ? shortSlopeA.mul(0.054).add(shortSlopeB.mul(0.037))
      .add(fineRippleA.mul(0.040))
    : shortSlopeA.mul(0.054)
      .add(shortSlopeB.mul(0.037))
      .add(cos(phaseC).mul(0.021))
      .add(fineRippleA.mul(0.043));
  const legacyZ = TOUCH_DEVICE
    ? sin(phaseA).mul(0.049).add(sin(phaseB).mul(0.035))
      .add(fineRippleB.mul(0.036))
    : sin(phaseA).mul(0.049)
      .add(sin(phaseB).mul(0.035))
      .add(sin(phaseC).mul(0.022))
      .add(fineRippleB.mul(0.041));
  const microX = PHASE2_WAVE_MOTION ? phase2SlopeX : legacyX;
  const microZ = PHASE2_WAVE_MOTION ? phase2SlopeZ : legacyZ;
  const microEnergy = clamp(abs(microX).add(abs(microZ)).mul(
    PHASE2_WAVE_MOTION ? 4.65 : 5.1), 0, 1);

  // Anti-alias distant optical chop so the horizon has broad swells but does
  // not turn into a dense moving stripe grid. L1 distance avoids per-pixel
  // square roots on mobile; the wavelet effect is strongest close to the eye.
  const horizontalRange = abs(positionWorld.x.sub(cameraPosition.x))
    .add(abs(positionWorld.z.sub(cameraPosition.z)));
  const detailVisibility = PHASE2_WAVE_MOTION
    ? mix(float(GRID_FREE_WATER_HIGHLIGHTS && TOUCH_DEVICE ? 0.045 : 0.32),
        float(1),
        float(1).sub(smoothstep(
          float(GRID_FREE_WATER_HIGHLIGHTS && TOUCH_DEVICE ? 15 : 24),
          float(GRID_FREE_WATER_HIGHLIGHTS && TOUCH_DEVICE ? 95 : 145),
          horizontalRange)))
    : float(1);
  // Underwater keeps the real displaced surface primary; a fraction of the
  // wavelet slope now affects surface refraction and reflected sky on both
  // sides without exposing high-frequency diamonds from the old optics.
  const opticalDetail = PHASE2_WAVE_MOTION
    ? mix(float(1), float(WAVE_DISTORTION_2 ? 0.51 : 0.26), underwater)
        .mul(detailVisibility)
    : float(1).sub(underwater);
  // Fluid Lab M5 principle: the real solved nearshore flow participates
  // in optical normals. This shifts refraction and sun glints with the
  // shallow solver's moving water, not only the FFT wave pattern. Limit
  // the gradient to avoid sharp grid-cell seams on low-quality phones.
  const labFlowNormalX = labHydro
    ? clamp(labHydro.state.y.mul(0.020), -0.045, 0.045)
        .mul(labHydro.coverage)
    : float(0);
  const labFlowNormalZ = labHydro
    ? clamp(labHydro.state.z.mul(0.020), -0.045, 0.045)
        .mul(labHydro.coverage)
    : float(0);
  const opticalNormal = vec3(
    worldNormal.x.add(microX.mul(opticalDetail)).add(labFlowNormalX),
    max(worldNormal.y, float(0.12)),
    worldNormal.z.add(microZ.mul(opticalDetail)).add(labFlowNormalZ),
  ).normalize();
  // Critical optical link: the moving directional wavelets must affect the
  // PBR surface normal as well as our custom color/refraction calculations.
  // The normal input is in VIEW space; opticalNormal is a WORLD derivative.
  // Existing shader code can keep worldNormal for slope-driven foam gating.
  // This uses the existing computed slopes, not an extra normal texture.
  if (WAVE_LENS_LAYER) {
    material.normalNode = opticalNormal
      .transformNormalByViewMatrix(WaterTSL.cameraViewMatrix).normalize();
  }
  // The underside samples the SAME travelling directional normals, but
  // blends them with the moderated FFT surface to avoid underwater gridding.
  // This also affects Snell's exit ray and reflected cloud direction.
  const undersideWaveNormal = PHASE2_WAVE_MOTION
    ? mix(underwaterOpticalNormal, opticalNormal,
        float(WAVE_DISTORTION_2 ? 0.68 : 0.42)).normalize()
    : underwaterOpticalNormal;

  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const lightDir = lightDirection.normalize();
  const halfDir = lightDir.add(viewDir).normalize();
  const ndv = clamp(abs(dot(opticalNormal, viewDir)), 0, 1);
  const ndh = clamp(dot(opticalNormal, halfDir), 0, 1);
  const ndl = clamp(dot(opticalNormal, lightDir), 0, 1);
  const fresnel = float(AIR_WATER_R0)
    .add(float(1 - AIR_WATER_R0).mul(
      pow(float(1).sub(ndv), float(5))));

  // Depth-driven tropical water color. Near-shore water reads turquoise because
  // the sand contributes strongly; offshore water loses red/green energy and
  // settles into a much darker blue body color.
  const shallow = float(1).sub(smoothstep(float(3.0), float(17.0), depth));
  const deep = smoothstep(float(18.0), float(52.0), depth);
  const depthBody = mix(midColor, shallowColor, shallow);
  const depthColor = mix(depthBody, deepColor, deep);
  const depthMix = clamp(
    float(0.57).add(shallow.mul(0.22)).add(deep.mul(0.10)),
    0,
    0.88,
  );

  // Fluid Lab M7.4.8 clear-pool optical approach adapted to the ocean:
  // Beer-Lambert attenuation controls how much sand light survives a shallow
  // water path. Normal/sun alignment focuses light rather than painting a
  // repeating pair of world-space sine grids over every beach.
  // We reuse the existing FFT/TSL optical normal, sun and depth attribute:
  // no caustic textures, additional screen capture or GPU compute passes.
  const shoreTransmission = exp(depth.mul(float(-0.17)));
  const poolFocus = clamp(
    dot(opticalNormal, lightDir).mul(0.67)
      .add(ndv.mul(0.12)).add(surfPulse.mul(0.08))
      .sub(float(0.42)), -0.5, 0.62,
  );
  // Legacy marble for A/B only. The default clear-pool shore path compiles
  // out these periodic crossing sinusoids on mobile.
  const depthMarble = POOL_SHORE_OPTICS ? poolFocus : (
    sin(positionWorld.x.mul(0.39).add(positionWorld.z.mul(0.57))
      .add(time.mul(0.065))).mul(0.60)
    .add(sin(positionWorld.x.mul(-0.71).add(positionWorld.z.mul(0.27))
      .sub(time.mul(0.08))).mul(0.40))
  );
  const marbleMask = smoothstep(float(-0.52), float(0.65), depthMarble)
    .mul(shallow).mul(day).mul(float(1).sub(underwater))
    .mul(POOL_SHORE_OPTICS ? shoreTransmission : float(1));
  const broadTone = depthMarble.mul(POOL_SHORE_OPTICS ? 0.022 : 0.052)
    .mul(float(1).sub(underwater));

  // Thin water over pale sand transmits more turquoise-white daylight.
  // Constrain it to the final few meters of seabed depth, avoiding the flat
  // milky surface band that occurred when all shallow water was tinted.
  const sunlitSand = float(1).sub(smoothstep(
    float(0.20), float(3.1), depth))
    .mul(day).mul(float(1).sub(underwater));
  // Refracted sunlight and pale seabed are most visible from overhead.
  // On iPhone this is an optical approximation, not a sampled scene refraction.
  const shallowVisibility = float(1).sub(smoothstep(
    float(0.15), float(5.0), depth))
    .mul(day).mul(float(1).sub(underwater))
    .mul(smoothstep(float(0.12), float(0.85), ndv))
    .mul(POOL_SHORE_OPTICS ? shoreTransmission : float(1));
  // Clear-pool optics adapted to a sandy shoreline, not a tiled pool liner:
  // attenuate seabed light with Beer-Lambert absorption and make the
  // transmitted brightness track the actual moving surface normal.
  // Irregular wave phases already exist in this shader; reuse them without
  // new texture fetches or passes. Gentle variation interrupts broad
  // mechanically straight aqua bands on a slowly shelving beach.
  const poolSurfaceLensing = clamp(
    dot(opticalNormal, lightDir).mul(0.60)
      .add(ndv.mul(0.20))
      .add(mediumA.mul(0.045))
      .add(mediumB.mul(0.035)), 0, 1);
  const thinWaterTransmission = exp(depth.mul(float(-0.23)))
    .mul(float(0.76).add(poolSurfaceLensing.mul(0.24)));
  const refractedShallow = mix(color(0x399caa), color(0xc4ebdb),
    POOL_SHORE_OPTICS
      ? clamp(thinWaterTransmission.mul(0.78)
        .add(poolFocus.mul(0.14)), 0, 1)
      : smoothstep(float(-0.40), float(0.72), depthMarble));

  // The old mobile formula abs(sin(A) * sin(B)) created a PERFECT
  // rectangular lattice of bright ellipses from the drone: it is a pattern
  // generator, not a statistical model of water glints. Vary one single
  // wave phase with an existing second-order swell. Do not multiply two
  // periodic signals into discs. Keep the prior mode for A/B comparisons.
  const facetNoise = GRID_FREE_WATER_HIGHLIGHTS && TOUCH_DEVICE
    ? abs(sin(phaseA.mul(0.83).add(phaseB.mul(0.37))
        .add(mediumB.mul(1.19))))
    : TOUCH_DEVICE
      ? abs(sin(phaseA.mul(1.37)).mul(sin(phaseB.mul(1.21))))
      : abs(
          sin(phaseA.mul(1.37).add(phaseC.mul(0.31)))
            .mul(sin(phaseB.mul(1.21).sub(phaseC.mul(0.23))))
        );
  const facetMask = smoothstep(
    float(GRID_FREE_WATER_HIGHLIGHTS && TOUCH_DEVICE ? 0.57 : 0.35),
    float(0.92), facetNoise);
  // The clean moving FFT normal and actual sun-facing half-vector own the
  // highlight. Fade the synthetic pinpricks with existing distance LOD.
  const sparkleDistanceFade = GRID_FREE_WATER_HIGHLIGHTS && TOUCH_DEVICE
    ? detailVisibility.mul(0.62)
    : float(1);
  const tightGlitter = pow(ndh, float(190))
    .mul(float(0.28).add(microEnergy.mul(1.45)))
    .mul(float(0.42).add(facetMask.mul(
      GRID_FREE_WATER_HIGHLIGHTS && TOUCH_DEVICE ? 0.16 : 0.92)));
  const broadGlitter = pow(ndh, float(34))
    .mul(float(0.085).add(microEnergy.mul(0.055)));
  const glitter = tightGlitter.mul(sparkleDistanceFade)
    .add(broadGlitter)
    .mul(day)
    .mul(float(1).sub(storm.mul(0.52)))
    .mul(float(1).sub(underwater));

  // No separate dot field at drone heights. A restrained sparkle remains
  // near the camera, where its spacing cannot form a broad visible grid.
  const sparkleFlecks = smoothstep(float(0.73), float(0.95),
      facetMask.mul(0.60).add(microEnergy.mul(0.23))
        .add(ndh.mul(0.23)))
    .mul(pow(ndh, float(42)))
    .mul(sparkleDistanceFade)
    .mul(day).mul(float(1).sub(storm.mul(0.48)))
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

  // Option B / Part 3: shared shoreline timing. Both the pitching foam mesh
  // and the surface shader read the same authoritative surf cycle (v19 syncs
  // the uniforms after the persistent foam simulation). The existing depth
  // attribute supplies a cheap approximation of offshore distance: this is
  // shading synchronization, not a new FFT displacement simulation.
  const surfZone = float(1).sub(smoothstep(
    float(SURF_REALISM_V2 ? 0.30 : 0.55),
    float(SURF_REALISM_V2 ? 5.2 : 4.2), depth));
  // There is no breaking lip in dry sand or fully submerged deep water.
  // Shift maximum whitewater toward actual shoaling water 0.4–2.5m deep.
  const surfBreakBand = SURF_REALISM_V2
    ? smoothstep(float(0.12), float(0.52), depth)
        .mul(float(1).sub(smoothstep(float(2.25), float(5.0), depth)))
    : surfZone;
  // Approximate shore-normal distance from the already sampled seabed depth.
  // The crest's front position comes directly from the active shoreline wave.
  const offshoreDistance = clamp(depth.mul(1.0), 0, 3.8);
  const distanceToCrest = abs(offshoreDistance.sub(surfFront));
  const crestGate = float(1).sub(smoothstep(
    float(0.15), float(1.05), distanceToCrest));
  // Foam follows the crest but lingers after the raised lip has passed.
  const wakeDistance = offshoreDistance.sub(surfFront);
  const foamWake = smoothstep(float(-0.25), float(0.75), wakeDistance)
    .mul(float(1).sub(smoothstep(float(1.0), float(3.2), wakeDistance)));
  const breakerSlope = smoothstep(float(0.18), float(0.67), geometricSlope);
  const crestActivity = clamp(surfPulse.mul(0.65)
    .add(crestGate.mul(0.55)).add(foamWake.mul(0.24)), 0, 1);
  const breakerEnergy = clamp(surfBreakBand.mul(surfSetStrength)
    .mul(surfStrength)
    .mul(float(SURF_REALISM_V2 ? 0.045 : 0.12)
      .add(crestActivity.mul(SURF_REALISM_V2 ? 0.51 : 0.65))
      .add(breakerSlope.mul(SURF_REALISM_V2 ? 0.37 : 0.23)))
    .mul(float(0.70).add(storm.mul(0.42)))
    .mul(float(1).sub(underwater)), 0, 0.90);
  // Spilling crests turn into aerated whitewater, particularly on the
  // shallow FFT facets that coincide with the shared shoreline breaker.
  // Crumpled whitewater exists only on steep, noisy, advancing crests and
  // their trailing wash. Don't tint an entire shoreline depth band white.
  const crestBreakup = SURF_REALISM_V2
    ? smoothstep(float(0.27), float(0.70),
        capBreakup.mul(0.72).add(facetMask.mul(0.28)))
    : float(1);
  const brokenFoam = clamp(breakerEnergy
    .mul(float(0.52).add(capBreakup.mul(0.72)))
    .mul(float(0.34).add(steep.mul(0.62))
      .add(foamWake.mul(0.48)))
    .mul(crestBreakup), 0, 0.84);
  // The cinematic breaking-wave reference has rolling whitecaps far beyond
  // the beach. Use existing FFT slope, crest height and breakup noise to add
  // scattered foam across the whole ocean, with NO additional sin(), texture
  // fetch, FFT cascade, geometry or draw call on iPhone.
  const openSeaFoam = clamp(steep.mul(capBreakup).mul(crestHeight)
    .mul(float(0.11).add(day.mul(0.20)))
    .mul(float(1).sub(surfZone.mul(0.55)))
    .mul(float(1).sub(underwater)), 0, 0.32);
  // Crest-gated white flecks: reduce foam from the uniform pulse across
  // an entire depth band. Each fleck follows an actual moving crest or its
  // collapsing wake, broken up by the FFT slope and cap noise.
  const shoreSpill = clamp(
    (SURF_REALISM_V2 ? surfBreakBand : surfZone).mul(capBreakup)
      .mul(crestGate.mul(0.70).add(foamWake.mul(0.30)))
      .mul(float(SURF_REALISM_V2 ? 0.05 : 0.10)
        .add(steep.mul(SURF_REALISM_V2 ? 0.39 : 0.29))),
    0, 0.25);
  // Thin, animated spindrift on the tops of individual rolling wavelets.
  // Gate it by the actual FFT crest, displacement slope and existing
  // irregular foam breakup, then fade outside the shallow surf zone.
  // Avoid opaque horizontal stripes: open water retains clear glassy faces.
  const waveLensFoam = WAVE_LENS_LAYER ? clamp(
    float(1).sub(smoothstep(float(3), float(24), depth))
      .mul(smoothstep(float(0.22), float(0.65),
        geometricSlope.add(microEnergy.mul(0.06))))
      .mul(float(0.22).add(crestHeight.mul(0.55))
        .add(crestGate.mul(0.30)).add(foamWake.mul(0.20)))
      .mul(smoothstep(float(0.30), float(0.81),
        capBreakup.mul(0.68).add(facetMask.mul(0.32))))
      .mul(float(0.22).add(storm.mul(0.14)))
      .mul(float(1).sub(underwater)),
    0, 0.19) : float(0);
  // Breaking white ridge: require the REAL FFT surface to be both high and
  // steep, AND the active shoreline breaker to be spilling. The shoreline
  // phase, residual wake and noisy cap mask prevent solid white stripes.
  // The existing persistent swash solver still handles downstream foam life.
  const crestCrown = smoothstep(waterLevel.add(0.10),
    waterLevel.add(0.70), positionWorld.y);
  const breakingLip = REFLECTIVE_CRESTS ? clamp(
    crestCrown.mul(smoothstep(float(0.16), float(0.55), geometricSlope))
      .mul((SURF_REALISM_V2 ? surfBreakBand : surfZone)
        .mul(0.86).add(storm.mul(0.18)))
      .mul(clamp(surfPulse.mul(0.62).add(crestGate.mul(0.42))
        .add(foamWake.mul(0.22)), 0, 1))
      .mul(smoothstep(float(0.35), float(0.78),
        capBreakup.mul(0.72).add(facetMask.mul(0.28))))
      .mul(float(1).sub(underwater))
      .mul(0.66),
    0, 0.66) : float(0);
  // One localized optical foam response shared with the physical
  // shallow-water ripple. Squared distance avoids sqrt() per fragment.
  // Smooth falloff prevents hard circular decals and disappears quickly.
  const labDx = positionWorld.x.sub(labImpactCenter.x);
  const labDz = positionWorld.z.sub(labImpactCenter.y);
  const labDistSq = labDx.mul(labDx).add(labDz.mul(labDz))
    .mul(labImpactInvRadiusSq);
  const labFoam = RIFT_LAB_OPTICS
    ? float(1).sub(smoothstep(float(0.08), float(1), labDistSq))
      .mul(labImpactEnergy)
      .mul(float(1).sub(underwater))
    : float(0);
  // Physically coupled nearshore whitewater: the M8/M5 lab behavior
  // follows the actual finite-depth solver's aeration (W), height (X)
  // and horizontal flow (Y/Z), not periodic painted wave bands.
  // Sampling was performed per-vertex; no storage-buffer reads per pixel.
  const labDepthGate = float(1).sub(smoothstep(float(1.1), float(6.2), depth));
  const labHydroFlow = labHydro
    ? clamp(abs(labHydro.state.y).add(abs(labHydro.state.z)), 0, 4)
    : float(0);
  const labHydroFoam = labHydro
    ? clamp(
        labHydro.state.w.mul(0.72)
          .add(smoothstep(float(0.28), float(1.35), labHydroFlow)
            .mul(0.12))
          .add(smoothstep(float(0.075), float(0.32), abs(labHydro.state.x))
            .mul(0.075)),
        0, 0.75,
      ).mul(labHydro.coverage).mul(labDepthGate)
        .mul(float(1).sub(underwater.mul(0.9)))
    : float(0);
  const combinedFoam = clamp(
    whitecap.add(openSeaFoam).add(brokenFoam.mul(0.87))
      .add(shoreSpill).add(waveLensFoam).add(breakingLip)
      .add(labFoam).add(labHydroFoam), 0, 0.97);

  // View-dependent Fresnel / wavelet sky reflection. This uses the already
  // available sky and FFT normals, avoiding additional sky texture fetches
  // or a separate mobile scene-reflection target. Foam suppresses the mirror.
  // Common controls must apply to BOTH branches. Previously the new
  // Phase 1 branch escaped the reflection toggle, foam suppression, and
  // underwater mask due to JS ternary/operator precedence.
  const reflectionBase = PHYSICAL_OPTICS_PHASE1
    ? clamp(
        fresnel.mul(0.62).add(microEnergy.mul(0.022))
          .add(geometricSlope.mul(0.024)),
        0, 0.60,
      )
    : clamp(
        fresnel.mul(REFERENCE_GLASS_LOOK ? 0.38 : 0.32)
          .add(microEnergy.mul(REFERENCE_GLASS_LOOK ? 0.055 : 0.050))
          .add(geometricSlope.mul(REFERENCE_GLASS_LOOK ? 0.060 : 0.040)),
        0, REFERENCE_GLASS_LOOK ? 0.44 : 0.39,
      );
  // The steep but clean *face* of the rolling FFT wave reads as a glossy
  // tilted mirror. Foam reverses that response. Schlick Fresnel still owns
  // the grazing-angle part; this adds a restrained visible face response.
  const glossyFace = REFLECTIVE_CRESTS
    ? smoothstep(float(0.16), float(0.58), geometricSlope)
        .mul(float(0.20).add(crestHeight.mul(0.80)))
        .mul(float(1).sub(combinedFoam))
    : float(0);
  const reflectionGain = clamp(
      reflectionBase.add(glossyFace.mul(0.16)), 0,
      REFLECTIVE_CRESTS ? 0.59 : 0.44)
    .mul(day.mul(0.72).add(0.28))
    .mul(reflectionStrength)
    .mul(float(1).sub(combinedFoam.mul(REFLECTIVE_CRESTS ? 0.97 : 0.88)))
    .mul(float(1).sub(underwater));
  // Make nearby individual FFT crests readable without painting dark
  // stripes over the entire ocean.
  const waveFace = smoothstep(float(0.14), float(0.61), geometricSlope)
    .mul(smoothstep(waterLevel.add(0.02),
      waterLevel.add(0.86), positionWorld.y))
    .mul(day).mul(float(1).sub(underwater));
  const troughShadow = float(1).sub(smoothstep(
    waterLevel.sub(0.26), waterLevel.add(0.18), positionWorld.y))
    .mul(day).mul(float(1).sub(underwater));

  // One shared sky-cloud lookup for glossy surface faces and the existing
  // underside reflection. Previously the water body reflected a FLAT skyColor
  // regardless of wave direction. The moving normal now controls a real
  // sky panorama lookup. Reusing the underside sample avoids extra iPhone
  // texture fetches; angular reflection remains suppressed under white foam.
  const cosI = clamp(dot(undersideWaveNormal, viewDir), 0, 1);
  const underwaterMirrorRay = undersideWaveNormal.mul(cosI.mul(2))
    .sub(viewDir).normalize();
  const aboveMirrorRay = opticalNormal.mul(ndv.mul(2))
    .sub(viewDir).normalize();
  const mirrorRay = REFLECTIVE_CRESTS
    ? mix(underwaterMirrorRay, aboveMirrorRay,
        float(1).sub(underwater)).normalize()
    : underwaterMirrorRay;
  const reflectedUV = REFLECTIVE_CRESTS
    ? vec2(
        mirrorRay.x.mul(0.255).add(time.mul(0.002)).add(0.5),
        clamp(float(0.64).add(mirrorRay.y.mul(0.24)),
          float(0.45), float(0.92)))
    : vec2(
        mirrorRay.x.mul(0.26).add(time.mul(0.002)),
        mirrorRay.z.mul(0.14).add(0.80)
      ).add(vec2(0.5, 0));
  const reflectedSample = texture(cloudSkyTexture, reflectedUV);
  const movingSkyReflection = REFLECTIVE_CRESTS
    ? mix(skyColor, reflectedSample.rgb,
        reflectedSample.a.mul(0.72))
    : skyColor;

  material.colorNode = Fn(() => {
    let body = mix(originalColor, depthColor, depthMix);
    // Reflected sky is strongest at grazing view angles. Its intensity
    // changes with the actual displaced FFT slope and the smaller wavelets.
    body = mix(body, movingSkyReflection, reflectionGain);
    if (PHASE2_WAVE_MOTION) {
      // Wave-face illumination tracks the same coherent slopes as Fresnel,
      // optical distortion, and the sun glints. No artificial white stripes.
      const slopeLighting = clamp(
        dot(opticalNormal, lightDir).sub(dot(worldNormal, lightDir))
          .mul(WAVE_LENS_LAYER ? 0.28 : 0.19),
        WAVE_LENS_LAYER ? -0.08 : -0.060,
        WAVE_LENS_LAYER ? 0.08 : 0.060);
      body = body.mul(float(1).add(slopeLighting.mul(day)
        .mul(float(1).sub(combinedFoam.mul(0.85)))));
    }
    // Under a spilling crest the front remains a translucent turquoise
    // sheet while aerated bubbles scatter white light at the narrow lip.
    const lipGlow = breakerEnergy.mul(crestHeight).mul(backLight).mul(day)
      .mul(float(1).sub(brokenFoam));
    const shoalFace = SURF_REALISM_V2
      ? surfBreakBand.mul(crestHeight)
          .mul(smoothstep(float(0.12), float(0.56), geometricSlope))
          .mul(float(1).sub(combinedFoam))
          .mul(day).mul(float(1).sub(underwater))
      : float(0);
    // Lit, sloping wave faces stay blue-green rather than only whitening
    // once they break. The animated FFT normal drives every highlight.
    const rollingFace = smoothstep(float(0.16), float(0.68), geometricSlope)
      .mul(crestHeight).mul(day).mul(float(1).sub(underwater));
    body = mix(body, shallowColor,
      clamp(lipGlow.mul(SURF_REALISM_V2 ? 0.52 : 0.38)
        .add(rollingFace.mul(float(0.08).add(shallow.mul(0.16))))
        .add(shoalFace.mul(0.26)), 0, 0.36));
    // Subtle trough darkening and a brighter inclined face reveal the
    // moving wave shape, even when no foam is produced.
    body = mix(body, deepColor, troughShadow.mul(0.065));
    body = mix(body, shallowColor, waveFace.mul(0.16));
    // Warped shallow light transmission is strongest at overhead angles;
    // keep the existing whitewater masks separate to avoid broad white bands.
    body = body.mul(float(1).add(broadTone));
    body = mix(body, refractedShallow,
      shallowVisibility.mul(float(1).sub(combinedFoam.mul(0.72)))
        .mul(POOL_SHORE_OPTICS ? float(0.32) : float(0.24))
        .add(labHydro
          ? smoothstep(float(0.20), float(1.65), labHydroFlow)
            .mul(labDepthGate).mul(labHydro.coverage).mul(0.065)
          : float(0)));
    // At the sand-water interface, clarity comes from the visible
    // seabed, not an opaque turquoise stripe painted across the surface.
    body = mix(body, color(0xa8e9dc),
      sunlitSand.mul(POOL_SHORE_OPTICS
        ? thinWaterTransmission.mul(0.075) : float(0.13)));
    body = mix(body, crestColor, marbleMask.mul(POOL_SHORE_OPTICS ? 0.065 : 0.16));
    body = mix(body, crestColor,
      clamp(translucency.add(lipGlow.mul(0.20)), 0, 0.34));
    body = mix(body, color(0xb6ebe6),
      brokenFoam.mul(foamWake).mul(0.14));
    body = mix(body, foamColor, combinedFoam.mul(0.94));
    // Underwater: diffuse transmitted skylight from the real displaced
    // FFT normal. Avoid screen-derivative curvature and thresholded bands,
    // which magnified the regular mesh sampling into diamond patterns.
    // Snell-inspired water-to-air transmission based on the REAL FFT
    // face normal. Use broad, low-contrast angular transitions only;
    // sharp thresholds revealed the periodic FFT sampling grid.
    const overheadView = smoothstep(float(0.14), float(0.91), ndv);
    // Shared, moderated FFT surface normal: transmitted sunlight, sky
    // refraction and reflected sky all follow the same displaced geometry.
    const sunFacing = clamp(dot(undersideWaveNormal, lightDir), 0, 1);
    const clearWater = clamp(shallow.mul(0.42).add(day.mul(0.20))
      .add(overheadView.mul(0.32)), 0, 1);
    // Approximate transmitted SKY radiance through a wave-normal-warped
    // underwater view. This uses the live skyColor uniform and real FFT
    // geometry: unlike a painted highlight, it changes with the sky cycle.
    // No extra scene capture or WebGPU pass is required.
    const skyWindow = PHASE3_UNDERWATER_TRANSPORT
      ? clamp(overheadView.mul(0.72)
          .add(sunFacing.mul(0.16)).add(shallow.mul(0.08)), 0, 0.94)
      : clamp(overheadView.mul(0.62)
          .add(sunFacing.mul(0.22)).add(shallow.mul(0.10)), 0, 0.92);
    // Distort the cloud-bearing sky atlas with genuine FFT slope. This is
    // directional sky refraction, not a capture of the above-water scene.
    // Refraction follows the *relative* view and FFT face direction.
    // Use a smooth slope-dependent offset rather than independent periodic
    // waves, which previously produced tiled diamond artifacts.
    const slopeX = clamp(undersideWaveNormal.x, -0.65, 0.65);
    const slopeZ = clamp(undersideWaveNormal.z, -0.65, 0.65);
    // Water -> air refraction (Snell's law). Derive a real outgoing
    // direction from the FFT normal rather than shifting the sky by slope.
    // The cloud panorama remains an approximation of the exterior scene.
    const eta = float(1.333);
    const sinT2 = eta.mul(eta).mul(float(1).sub(cosI.mul(cosI)));
    const cosT = float(1).sub(clamp(sinT2, 0, 1)).sqrt();
    const exitRay = undersideWaveNormal.mul(
      eta.mul(cosI).sub(cosT)
    ).sub(viewDir.mul(eta)).normalize();
    const skyUV = vec2(
      exitRay.x.mul(0.36).add(time.mul(0.003)),
      exitRay.z.mul(0.22).add(float(0.30))
    ).add(vec2(0.5, 0));
    const cloudSample = texture(cloudSkyTexture, skyUV);
    const skyRadiance = mix(skyColor, cloudSample.rgb,
      cloudSample.a.mul(WAVE_DISTORTION_2 ? 0.68 : 0.52));
    const refractedSky = mix(color(0x267c96), skyRadiance, skyWindow);
    // Refracted illumination: projected sunlight is stronger where the
    // deformed FFT face bends toward the sun. Keep the lobe broad and
    // energy-limited; sharp thresholds previously exposed a diamond grid.
    const projectedSun = clamp(dot(undersideWaveNormal, lightDir), 0, 1);
    const sunFlux = projectedSun.mul(projectedSun)
      .mul(float(0.70).add(overheadView.mul(0.30)))
      .mul(day).mul(float(1).sub(storm.mul(0.65)));
    // Continuous wave-phase glints: driven by the actual FFT surface normal
    // plus restrained moving ripples; no new noise textures or passes.
    const rippleLight = clamp(
      sin(phaseA.mul(0.73)).mul(cos(phaseB.mul(0.66)))
        .mul(0.5).add(0.5), 0, 1);
    const lightFocus = smoothstep(float(0.28), float(0.88), rippleLight)
      .mul(sunFlux).mul(overheadView)
      .mul(float(1).sub(storm.mul(0.6)));
    const transmitted = mix(refractedSky, color(0x7fd9db),
      clamp(float(1).sub(clearWater).mul(0.27), 0, 0.27))
      .add(color(0xfff3df).mul(sunFlux.mul(
        PHASE3_UNDERWATER_TRANSPORT ? 0.26 : 0.20)))
      .add(sunColor.mul(lightFocus.mul(
        PHASE3_UNDERWATER_TRANSPORT ? 0.13 : 0.10)));
    // Soft water-to-air reflection at grazing incidence, preserving sky
    // transmission overhead without accentuating regular FFT sampling.
    // Schlick approximation for water/air, with total internal reflection
    // at the critical angle (sin(theta_c)=1/1.333). A narrow soft band
    // helps prevent abrupt aliasing on the mobile presentation mesh.
    const r0 = float(0.0204);
    const fresnelWaterAir = r0.add(float(1).sub(r0).mul(
      pow(float(1).sub(cosI), float(5))
    ));
    const tir = smoothstep(float(0.91), float(1.045), sinT2);
    // At the underwater critical angle light cannot escape into air:
    // preserve the existing smooth mobile-safe transition but approach
    // genuinely strong total internal reflection instead of stopping at 64%.
    const angleReflection = mix(fresnelWaterAir,
      float(PHASE3_UNDERWATER_TRANSPORT ? 0.92 : 0.64), tir);
    // Reuse the same reflectedSample from the above-water glossy face;
    // underwater total-internal reflection still uses the underside normal.
    const reflectedUnderwater = mix(color(0x19536b), skyColor,
        float(WAVE_DISTORTION_2 ? 0.32 : 0.25))
      .add(reflectedSample.rgb.mul(reflectedSample.a)
        .mul(WAVE_DISTORTION_2 ? 0.28 : 0.18));
    const underside = mix(transmitted, reflectedUnderwater, angleReflection);
    // Soft fragmented refraction shimmer is strongest toward the surface.
    // This shares the exact FFT-driven transmission/reflection normal.
    const undersideShimmer = lightFocus.mul(float(
      PHASE3_UNDERWATER_TRANSPORT ? 0.080 : 0.065))
      .mul(float(1).sub(angleReflection));
    const illuminatedUnderside = underside.add(sunColor.mul(undersideShimmer));
    const nonFoamGlint = REFLECTIVE_CRESTS
      ? float(1).sub(combinedFoam.mul(0.96))
      : float(1);
    return mix(body.add(sunColor.mul(glitter.mul(
        REFLECTIVE_CRESTS ? 0.36 : REFERENCE_GLASS_LOOK ? 0.29 : 0.24)
        .mul(nonFoamGlint)))
        .add(sunColor.mul(sparkleFlecks.mul(
          REFLECTIVE_CRESTS ? 0.095 : REFERENCE_GLASS_LOOK ? 0.078 : 0.060)
          .mul(nonFoamGlint))), illuminatedUnderside,
      underwater.mul(float(0.97)));

  })();

  const microRoughness = mix(
    originalRoughness,
    float(REFERENCE_GLASS_LOOK ? 0.078 : 0.096),
    clamp(microEnergy.mul(REFERENCE_GLASS_LOOK ? 0.34 : 0.31)
      .add(geometricSlope.mul(0.08)), 0, 0.45),
  );
  // Water faces are mirror-smooth; aerated foam is a diffuse, rough layer.
  // Preserve the pre-change roughness mix behind ?riftCrestReflect=off.
  const glossyRoughness = REFLECTIVE_CRESTS
    ? mix(microRoughness, float(0.052), glossyFace.mul(0.75))
    : microRoughness;
  // The PBR BRDF itself can alias on a nearly-perfect mirror populated by
  // periodic micro-normals at aerial distances. Increase the footprint of
  // distant specular reflections (microfacet anti-aliasing approximation)
  // while preserving near-surface sharp glassy wave faces.
  const glintFootprint = GRID_FREE_WATER_HIGHLIGHTS && TOUCH_DEVICE
    ? smoothstep(float(13), float(95), horizontalRange)
    : float(0);
  const antiAliasedRoughness = mix(glossyRoughness,
    float(TOUCH_DEVICE ? 0.17 : 0.12), glintFootprint);
  material.roughnessNode = REFLECTIVE_CRESTS
    ? mix(antiAliasedRoughness, float(0.89),
        combinedFoam.mul(0.97))
    : mix(antiAliasedRoughness, float(0.62), combinedFoam.mul(0.90));
  // A restrained daylight volume-fill prevents the body from becoming a
  // black mirror on iOS when no scene refraction texture is supplied. It
  // follows the same depth palette and does not brighten night/underwater.
  const daylightFill = depthColor.mul(day)
    .mul(float(PHYSICAL_OPTICS_PHASE1 ? 0.15 : 0.22)
      .add(shallow.mul(PHYSICAL_OPTICS_PHASE1 ? 0.08 : 0.12)))
    .mul(float(1).sub(underwater));
  material.emissiveNode = originalEmissive
    .add(daylightFill)
    .add(crestColor.mul(translucency.mul(0.012)))
    .add(sunColor.mul(glitter.mul(0.012)))
    .add(foamColor.mul(brokenFoam.mul(day).mul(0.016)));

  // r182 critical: MeshPhysicalNodeMaterial.useTransmission is TRUE whenever
  // transmissionNode is non-null, EVEN when set to float(0). That silently
  // overrides lightingContext.backdrop and prevents our scene refraction.
  // Remove the node altogether and disable the physical path *before*
  // shader graph compilation; backdrop and alpha fallback own refraction.
  material.transmission = 0;
  material.transmissionNode = null;
  // Scene-aware backdrop refraction, when supported, replaces native physical
  // transmission. Mobile physical transmission previously made the ocean a
  // dark opaque mirror, while the viewport samples the real scene already
  // behind this transparent water in the same render (no second scene pass).
  const backdropAvailable =
    globalThis.__riftNativeWebGPUActive === true &&
    typeof WaterTSL.viewportSharedTexture === "function" &&
    WaterTSL.screenUV && WaterTSL.normalView &&
    "backdropNode" in material && "backdropAlphaNode" in material &&
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("riftRefraction") !== "off";
  if (backdropAvailable) {
    // Distort screen-space objects with the live wave normal; a small ripple
    // contribution adds moving refraction without looking like a tiled grid.
    // Screen-space UV shift is intentionally limited for iPhone stability.
    // When the new PBR normal is active it already contains the short
    // travelling wave slopes in camera space. Do not add the old WORLD X/Z
    // ripple offsets a second time to the screen X/Y components.
    const distortionNormal = WAVE_LENS_LAYER
      ? vec2(WaterTSL.normalView.x, WaterTSL.normalView.y)
      : vec2(
          WaterTSL.normalView.x.add(microX.mul(REFERENCE_GLASS_LOOK ? 0.32 : 0.26)),
          WaterTSL.normalView.y.add(microZ.mul(REFERENCE_GLASS_LOOK ? 0.32 : 0.26))
        );
    // Subtract the FLAT surface normal in view space. Warping with the full
    // normal dragged the background uniformly when the camera pitched and
    // hardly showed the small wavelets in the screenshots. Difference slopes
    // isolate actual changing FFT faces and short-wave lensing.
    const flatViewNormal = vec3(0, 1, 0)
      .transformNormalByViewMatrix(WaterTSL.cameraViewMatrix).normalize();
    const movingNormal = WAVE_DISTORTION_2 && WAVE_LENS_LAYER
      ? vec2(
          WaterTSL.normalView.x.sub(flatViewNormal.x),
          WaterTSL.normalView.y.sub(flatViewNormal.y))
      : distortionNormal;
    const bendStrength = WAVE_DISTORTION_2 && WAVE_LENS_LAYER
      ? clamp(float(0.090).add(shallow.mul(0.060))
          .add(microEnergy.mul(0.018)), 0.075, 0.168)
      : clamp(float(0.003)
          .add(shallow.mul(WAVE_LENS_LAYER ? 0.013 : REFERENCE_GLASS_LOOK ? 0.012 : 0.010))
          .add(microEnergy.mul(WAVE_LENS_LAYER ? 0.005 : REFERENCE_GLASS_LOOK ? 0.0035 : 0.003)),
          0.003, WAVE_LENS_LAYER ? 0.021 : REFERENCE_GLASS_LOOK ? 0.020 : 0.018);
    // More visible when looking down into shallow water; foam suppresses
    // distortion as air bubbles obscure the clear refracting face.
    const offset = clamp(movingNormal.mul(bendStrength)
      .mul(float(1).sub(combinedFoam.mul(0.88)))
      .mul(PHYSICAL_OPTICS_PHASE1
        ? clamp(float(1.12).sub(fresnel.mul(0.42)), 0.75, 1.12)
        : float(1)),
      vec2(WAVE_DISTORTION_2 && WAVE_LENS_LAYER ? -0.055 : -0.020),
      vec2(WAVE_DISTORTION_2 && WAVE_LENS_LAYER ? 0.055 : 0.020));
    const warpedUV = clamp(WaterTSL.screenUV.add(offset),
      vec2(0.006), vec2(0.994));
    // Depth-aware UVs avoid sampling foreground objects across water edges.
    const safeUV = typeof WaterTSL.viewportSafeUV === "function"
      ? WaterTSL.viewportSafeUV(warpedUV) : warpedUV;
    const backdrop = WaterTSL.viewportSharedTexture(safeUV).rgb;
    // Water absorption is wavelength dependent. The ocean absorbs red
    // faster than green and blue, while weak in-scattering keeps the water
    // visibly cyan rather than a black cutout at greater optical depths.
    // "depth" is the existing seabed-depth attribute, not an extra scene
    // depth texture. Its approximation is most accurate in shallow water.
    const tint = mix(color(0x8cbac7), color(0xd8f4e8),
      shallow.mul(0.78).add(day.mul(0.16)));
    if (PHYSICAL_OPTICS_PHASE1) {
      const submergedCameraDepth = max(
        waterLevel.sub(cameraPosition.y), float(0));
      const opticalDepth = mix(depth, submergedCameraDepth, underwater);
      const waterPath = clamp(
        opticalDepth.div(max(ndv, float(0.40))), 0, 24,
      );
      const absorption = exp(vec3(-0.145, -0.063, -0.026)
        .mul(waterPath));
      const inScatter = color(0x287d99)
        .mul(float(1).sub(absorption)).mul(0.31);
      material.backdropNode = backdrop.mul(absorption).add(inScatter);
    } else {
      material.backdropNode = backdrop.mul(tint);
    }
    const aboveClarity = PHYSICAL_OPTICS_PHASE1
      ? clamp(float(0.28).add(shallow.mul(0.44)), 0.23, 0.72)
          .mul(float(1).sub(fresnel))
      : REFERENCE_GLASS_LOOK
        ? clamp(float(0.23).add(shallow.mul(0.42))
            .sub(fresnel.mul(0.13)), 0.18, 0.70)
        : clamp(float(0.22).add(shallow.mul(0.64))
            .add(float(1).sub(ndv).mul(-0.12)), 0.18, 0.88);
    // Looking upward underwater should reveal the actual sky behind the
    // FFT surface; grazing angles keep reflected cyan wave facets.
    // Water-to-air light transmission collapses below the critical angle
    // (cos theta ~= 0.661). Soften the edge to avoid flickering on mobile.
    const belowClarity = PHYSICAL_OPTICS_PHASE1
      ? clamp(float(0.84).mul(smoothstep(float(0.57),
          float(0.73), ndv)).mul(float(1).sub(fresnel)), 0.03, 0.82)
      : clamp(float(REFERENCE_GLASS_LOOK ? 0.80 : 0.90)
          .sub(fresnel.mul(REFERENCE_GLASS_LOOK ? 0.60 : 0.68)),
        0.16, REFERENCE_GLASS_LOOK ? 0.82 : 0.91);
    material.backdropAlphaNode = mix(aboveClarity, belowClarity,
      underwater).mul(float(1).sub(combinedFoam.mul(0.89)));
    // Conservative alpha fallback inside the same draw. If a mobile backend
    // cannot sample its backdrop after a RenderPipeline scene pass, the ocean
    // must still expose genuine sand / reef / sky behind the surface instead
    // of becoming an opaque cyan ceiling. The screen sample provides the
    // moving refraction where available; regular blending protects visibility.
    const realSceneClarity = mix(
      REFERENCE_GLASS_LOOK
        ? clamp(float(0.34).add(shallow.mul(0.28))
            .add(ndv.mul(0.04)), 0.30, 0.70)
        : clamp(float(0.38).add(shallow.mul(0.37))
            .add(ndv.mul(0.08)), 0.31, 0.82),
      REFERENCE_GLASS_LOOK
        ? clamp(float(0.77).sub(fresnel.mul(0.54)), 0.20, 0.81)
        : clamp(float(0.83).sub(fresnel.mul(0.54)), 0.20, 0.87),
      underwater,
    ).mul(float(1).sub(combinedFoam.mul(0.82)));
    // The backdrop samples the scene once; blending additionally at full
    // clarity would double-count transmitted light and wash the ocean out.
    // Preserve a modest genuine-alpha fallback for WebGPU compositor quirks.
    const baseOpacity = float(1).sub(realSceneClarity.mul(
      PHYSICAL_OPTICS_PHASE1 ? 0.34 : 0.55));
    // The last ~2m of water over sand must be optically thin, not a
    // continuous opaque turquoise wall. Keep aerated foam visible.
    const thinSheet = clamp(float(0.25)
      .add(float(1).sub(shoreTransmission).mul(0.38))
      .add(combinedFoam.mul(0.54)), 0.20, 0.98);
    const shoreSheet = float(1).sub(smoothstep(float(0.12), float(2.6), depth))
      .mul(float(1).sub(underwater));
    material.opacityNode = POOL_SHORE_OPTICS
      ? mix(baseOpacity, thinSheet, shoreSheet) : baseOpacity;
    material.transparent = true;
    material.depthWrite = false;
    material.forceSinglePass = true; // thin double-sided plane, never two transparent draws
    material.opacity = 1;
    handle.mesh.renderOrder = 10; // after opaque terrain/sky, before foam
    handle.fftViewportRefractionActive = true;
    material.transmissionNode = null;
  } else {
    // Supported fallback: alpha-blended real scene, but no warped background.
    // Crucially, the player can still see through the surface from both sides.
    const clear = mix(
      REFERENCE_GLASS_LOOK
        ? clamp(float(0.24).add(shallow.mul(0.37)), 0.24, 0.65)
        : clamp(float(0.29).add(shallow.mul(0.40)), 0.29, 0.72),
      REFERENCE_GLASS_LOOK
        ? clamp(float(0.77).sub(fresnel.mul(0.55)), 0.21, 0.80)
        : clamp(float(0.85).sub(fresnel.mul(0.60)), 0.22, 0.86),
      underwater
    ).mul(float(1).sub(combinedFoam.mul(0.80)));
    const baseOpacity = float(1).sub(PHYSICAL_OPTICS_PHASE1
      ? clear.mul(float(1).sub(fresnel)).mul(0.92) : clear);
    const thinSheet = clamp(float(0.25)
      .add(float(1).sub(shoreTransmission).mul(0.38))
      .add(combinedFoam.mul(0.54)), 0.20, 0.98);
    const shoreSheet = float(1).sub(smoothstep(float(0.12), float(2.6), depth))
      .mul(float(1).sub(underwater));
    material.opacityNode = POOL_SHORE_OPTICS
      ? mix(baseOpacity, thinSheet, shoreSheet) : baseOpacity;
    material.transparent = true;
    material.depthWrite = false;
    material.forceSinglePass = true; // thin double-sided plane, never two transparent draws
    material.opacity = 1;
    handle.mesh.renderOrder = 10;
    handle.fftViewportRefractionActive = false;
    material.transmissionNode = null;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.__riftWaterSceneOptics = {
      mode: handle.fftViewportRefractionActive
        ? "webgpu-viewport-refraction" : "alpha-transparency-fallback",
      noExtraSceneRender: true,
      referenceGlassLook: REFERENCE_GLASS_LOOK,
      physicalOpticsPhase1: PHYSICAL_OPTICS_PHASE1,
      phase2WaveMotion: PHASE2_WAVE_MOTION,
      phase3UnderwaterTransport: PHASE3_UNDERWATER_TRANSPORT,
      waveLensLayer: WAVE_LENS_LAYER,
      strongerWaveDistortion: WAVE_DISTORTION_2,
      reflectiveBreakingCrests: REFLECTIVE_CRESTS,
      shallowSurfRealismV2: SURF_REALISM_V2,
      gridFreeWaterHighlights: GRID_FREE_WATER_HIGHLIGHTS,
      poolShoreOptics: POOL_SHORE_OPTICS,
      disabledByQuery: typeof location !== "undefined" &&
        new URLSearchParams(location.search).get("riftRefraction") === "off",
    };
  }
  material.thicknessNode = mix(
    mix(originalThickness, float(0.075), shallow.mul(0.66)),
    float(0.045),
    translucency.mul(0.72),
  );

  material.needsUpdate = true;

  handle.fftLabImpactCenter = labImpactCenter;
  handle.fftLabImpactEnergy = labImpactEnergy;
  handle.fftLabImpactInvRadiusSq = labImpactInvRadiusSq;
  handle.fftV9Time = time;
  handle.fftV9SurfPhase = surfPhase;
  handle.fftV9SurfSet = surfSetStrength;
  handle.fftV9SurfPulse = surfPulse;
  handle.fftV9SurfFront = surfFront;
  handle.fftV9SurfStrength = surfStrength;
  handle.fftV9Storm = storm;
  handle.fftV9ShallowColor = shallowColor;
  handle.fftV9MidColor = midColor;
  handle.fftV9DeepColor = deepColor;
  handle.fftV9SkyColor = skyColor;
  handle.fftV9ReflectionStrength = reflectionStrength;
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
  if (handle.fftV9ReflectionStrength) {
    handle.fftV9ReflectionStrength.value =
      getEffectiveValue("reflectionEnabled") === false ? 0.0 : 1.0;
  }

  if (handle.fftV9SkyColor?.value) {
    if (sky?.isColor) handle.fftV9SkyColor.value.copy(sky);
    else handle.fftV9SkyColor.value.set(0xa9ddf6);
  }
  if (handle.fftV9SunColor?.value) {
    handle.fftV9SunColor.value
      .set(0xbad8ef)
      .lerp(new THREE.Color(0xfff6de), dayT);
  }
  if (handle.fftV9CrestColor?.value) {
    handle.fftV9CrestColor.value
      .set(0x5b9fb0)
      .lerp(new THREE.Color(0x71ead5), dayT);
  }

  // Make both real FFT bands more legible on mobile. Desktop additionally has
  // v8's genuine third 64x64 micro cascade; tune it here after the base update.
  // Phase A: preserve the original FFT's genuine 3D vertex displacement
  // (height + X/Z chop) and enhance its scale modestly on iPhone Low.
  // Long, gentle amplitude variation yields readable moving swell without
  // extra FFT cascades, mesh vertices, render passes or command encoders.
  const mobileLowSwell = TOUCH_DEVICE && getGraphicsTier() === "low";
  const broadBreath = mobileLowSwell
    ? Math.sin(elapsed * 0.24) * 0.8 + Math.sin(elapsed * 0.11 + 1.4) * 0.45
    : 0;
  if (handle.waveScale) handle.waveScale.value =
    (mobileLowSwell ? 27.0 : 25.2) + broadBreath + stormT * 6.4;
  if (handle.fftDetailHandle?.waveScale) {
    handle.fftDetailHandle.waveScale.value =
      (mobileLowSwell ? 25.7 : 24.4) + broadBreath * 0.28 + stormT * 7.0;
  }
  if (handle.fftMicroHandle?.waveScale) {
    handle.fftMicroHandle.waveScale.value = 12.4 + stormT * 4.0;
  }

  const physical = handle.fftPhysicalMaterial;
  if (physical) {
    physical.ior = WATER_IOR;
    physical.attenuationDistance = TOUCH_DEVICE ? 52 : 64;
    physical.attenuationColor.set(0xa3e7dd);
    // Backdrop or alpha compositing owns scene visibility; avoid mixing a
    // second built-in physical transmission render path into its color.
    physical.transmission = 0;
    physical.transparent = true;
    physical.depthWrite = false;
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