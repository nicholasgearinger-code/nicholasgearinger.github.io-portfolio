import * as THREE from "three";
import {
  Fn, uniform, color, float, vec2, vec3, texture,
  positionWorld, cameraPosition,
  attribute, dFdx, dFdy, cross, dot, pow, mix, clamp, smoothstep,
  sin, cos, abs, max,
} from "three/tsl";
import * as oceanV7 from "./gpu_fft_ocean_v7.js";
import * as oceanV8 from "./gpu_fft_ocean_v8.js";
import { getRealisticCloudTexture } from "./clouds_storm_base.js";
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
  // Share the exact cloud panorama already rendered by the sky dome.
  // The texture is globally cached by the cloud module and not owned here.
  const cloudSkyTexture = getRealisticCloudTexture();

  const sunColor = uniform(color(0xfff6de));
  const crestColor = uniform(color(0x71ead5));
  const foamColor = handle.fftFoamColor ?? uniform(color(0xfafcf8));

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

  // Preserve micro ripple normals above water, but use the displaced FFT
  // geometry itself underwater. Analytic sine micro normals were making
  // repetitive diamonds visible even after highlight patterns were removed.
  const opticalNormal = vec3(
    worldNormal.x.add(microX.mul(float(1).sub(underwater))),
    max(worldNormal.y, float(0.12)),
    worldNormal.z.add(microZ.mul(float(1).sub(underwater))),
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
    float(0.57).add(shallow.mul(0.22)).add(deep.mul(0.10)),
    0,
    0.88,
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

  // Option B / Part 3: shared shoreline timing. Both the pitching foam mesh
  // and the surface shader read the same authoritative surf cycle (v19 syncs
  // the uniforms after the persistent foam simulation). The existing depth
  // attribute supplies a cheap approximation of offshore distance: this is
  // shading synchronization, not a new FFT displacement simulation.
  const surfZone = float(1).sub(smoothstep(float(0.55), float(4.2), depth));
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
  const breakerEnergy = clamp(surfZone.mul(surfSetStrength)
    .mul(surfStrength)
    .mul(float(0.12).add(crestActivity.mul(0.65))
      .add(breakerSlope.mul(0.23)))
    .mul(float(0.70).add(storm.mul(0.42)))
    .mul(float(1).sub(underwater)), 0, 0.90);
  const brokenFoam = clamp(breakerEnergy
    .mul(float(0.40).add(capBreakup.mul(0.60)))
    .mul(float(0.25).add(steep.mul(0.50))
      .add(foamWake.mul(0.36))), 0, 0.68);
  // The cinematic breaking-wave reference has rolling whitecaps far beyond
  // the beach. Use existing FFT slope, crest height and breakup noise to add
  // scattered foam across the whole ocean, with NO additional sin(), texture
  // fetch, FFT cascade, geometry or draw call on iPhone.
  const openSeaFoam = clamp(steep.mul(capBreakup).mul(crestHeight)
    .mul(float(0.11).add(day.mul(0.20)))
    .mul(float(1).sub(surfZone.mul(0.55)))
    .mul(float(1).sub(underwater)), 0, 0.32);
  const combinedFoam = clamp(
    whitecap.add(openSeaFoam).add(brokenFoam.mul(0.82)), 0, 0.92);

  material.colorNode = Fn(() => {
    let body = mix(originalColor, depthColor, depthMix);
    body = mix(
      body,
      skyColor,
      clamp(fresnel.mul(float(0.045).add(day.mul(0.09))), 0, 0.13),
    );
    // Backlit shoaling wave faces gain a restrained green-blue translucency
    // before the breaking lip transitions into opaque, scattering whitewater.
    const lipGlow = breakerEnergy.mul(crestHeight).mul(backLight).mul(day)
      .mul(float(1).sub(brokenFoam));
    // Lit, sloping wave faces stay blue-green rather than only whitening
    // once they break. The animated FFT normal drives every highlight.
    const rollingFace = smoothstep(float(0.16), float(0.68), geometricSlope)
      .mul(crestHeight).mul(day).mul(float(1).sub(underwater));
    body = mix(body, shallowColor,
      clamp(lipGlow.mul(0.38).add(rollingFace.mul(float(0.08)
        .add(shallow.mul(0.16)))), 0, 0.30));
    body = mix(body, crestColor,
      clamp(translucency.add(lipGlow.mul(0.20)), 0, 0.34));
    body = mix(body, foamColor, combinedFoam.mul(0.90));
    // Underwater: diffuse transmitted skylight from the real displaced
    // FFT normal. Avoid screen-derivative curvature and thresholded bands,
    // which magnified the regular mesh sampling into diamond patterns.
    // Snell-inspired water-to-air transmission based on the REAL FFT
    // face normal. Use broad, low-contrast angular transitions only;
    // sharp thresholds revealed the periodic FFT sampling grid.
    const overheadView = smoothstep(float(0.14), float(0.91), ndv);
    // Shared, moderated FFT surface normal: transmitted sunlight, sky
    // refraction and reflected sky all follow the same displaced geometry.
    const sunFacing = clamp(dot(underwaterOpticalNormal, lightDir), 0, 1);
    const clearWater = clamp(shallow.mul(0.42).add(day.mul(0.20))
      .add(overheadView.mul(0.32)), 0, 1);
    // Approximate transmitted SKY radiance through a wave-normal-warped
    // underwater view. This uses the live skyColor uniform and real FFT
    // geometry: unlike a painted highlight, it changes with the sky cycle.
    // No extra scene capture or WebGPU pass is required.
    const skyWindow = clamp(overheadView.mul(0.62)
      .add(sunFacing.mul(0.22)).add(shallow.mul(0.10)), 0, 0.92);
    // Distort the cloud-bearing sky atlas with genuine FFT slope. This is
    // directional sky refraction, not a capture of the above-water scene.
    // Refraction follows the *relative* view and FFT face direction.
    // Use a smooth slope-dependent offset rather than independent periodic
    // waves, which previously produced tiled diamond artifacts.
    const slopeX = clamp(underwaterOpticalNormal.x, -0.65, 0.65);
    const slopeZ = clamp(underwaterOpticalNormal.z, -0.65, 0.65);
    // Water -> air refraction (Snell's law). Derive a real outgoing
    // direction from the FFT normal rather than shifting the sky by slope.
    // The cloud panorama remains an approximation of the exterior scene.
    const cosI = clamp(dot(underwaterOpticalNormal, viewDir), 0, 1);
    const eta = float(1.333);
    const sinT2 = eta.mul(eta).mul(float(1).sub(cosI.mul(cosI)));
    const cosT = float(1).sub(clamp(sinT2, 0, 1)).sqrt();
    const exitRay = underwaterOpticalNormal.mul(
      eta.mul(cosI).sub(cosT)
    ).sub(viewDir.mul(eta)).normalize();
    const skyUV = vec2(
      exitRay.x.mul(0.36).add(time.mul(0.003)),
      exitRay.z.mul(0.22).add(float(0.30))
    ).add(vec2(0.5, 0));
    const cloudSample = texture(cloudSkyTexture, skyUV);
    const skyRadiance = mix(skyColor, cloudSample.rgb,
      cloudSample.a.mul(0.52));
    const refractedSky = mix(color(0x267c96), skyRadiance, skyWindow);
    // Refracted illumination: projected sunlight is stronger where the
    // deformed FFT face bends toward the sun. Keep the lobe broad and
    // energy-limited; sharp thresholds previously exposed a diamond grid.
    const projectedSun = clamp(dot(underwaterOpticalNormal, lightDir), 0, 1);
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
      .add(color(0xfff3df).mul(sunFlux.mul(0.20)))
       .add(sunColor.mul(lightFocus.mul(0.10)));
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
    const angleReflection = mix(fresnelWaterAir, float(0.64), tir);
    // The reflection samples the same real cloud panorama with a distinct
    // slope-driven direction; at grazing angles it becomes more apparent.
    // Specular direction from the SAME wave normal as the transmitted ray.
    // This avoids the old independently tuned reflection slope offsets.
    const reflectedRay = underwaterOpticalNormal.mul(cosI.mul(2))
      .sub(viewDir).normalize();
    const reflectedUV = vec2(
      reflectedRay.x.mul(0.26).add(time.mul(0.002)),
      reflectedRay.z.mul(0.14).add(0.80)
    ).add(vec2(0.5, 0));
    const reflectedSample = texture(cloudSkyTexture, reflectedUV);
    const reflectedUnderwater = mix(color(0x19536b), skyColor, float(0.25))
      .add(reflectedSample.rgb.mul(reflectedSample.a).mul(0.18));
    const underside = mix(transmitted, reflectedUnderwater, angleReflection);
    // Soft fragmented refraction shimmer is strongest toward the surface.
    // This shares the exact FFT-driven transmission/reflection normal.
    const undersideShimmer = lightFocus.mul(float(0.065))
      .mul(float(1).sub(angleReflection));
    const illuminatedUnderside = underside.add(sunColor.mul(undersideShimmer));
    return mix(body.add(sunColor.mul(glitter.mul(0.24))), illuminatedUnderside,
      underwater.mul(float(0.97)));

  })();

  const microRoughness = mix(
    originalRoughness,
    float(0.082),
    microEnergy.mul(0.20),
  );
  material.roughnessNode = mix(microRoughness, float(0.62),
    combinedFoam.mul(0.90));
  // A restrained daylight volume-fill prevents the body from becoming a
  // black mirror on iOS when no scene refraction texture is supplied. It
  // follows the same depth palette and does not brighten night/underwater.
  const daylightFill = depthColor.mul(day)
    .mul(float(0.22).add(shallow.mul(0.12)))
    .mul(float(1).sub(underwater));
  material.emissiveNode = originalEmissive
    .add(daylightFill)
    .add(crestColor.mul(translucency.mul(0.012)))
    .add(sunColor.mul(glitter.mul(0.012)))
    .add(foamColor.mul(brokenFoam.mul(day).mul(0.016)));

  // MeshPhysicalNodeMaterial supports per-pixel transmission/thickness. Shallow
  // and back-lit crests become clearer, while foam suppresses transmission.
  const aboveTransmission = mix(
    originalTransmission,
    float(0.86),
    clamp(shallow.mul(0.46).add(translucency.mul(0.75)), 0, 0.72),
  ).mul(float(1).sub(combinedFoam.mul(0.94)));
  // WebKit/mobile uses the direct shaded surface. Physical transmission
  // without a dependable scene-color refraction path darkens the entire
  // ocean while leaving only the solar reflection visible. Keep physically
  // detailed transmission on desktop; the underwater view already has its
  // own explicit FFT normal/refraction shading in colorNode.
  material.transmissionNode = TOUCH_DEVICE
    ? float(0.0)
    : mix(aboveTransmission, float(0.94), underwater);
  material.thicknessNode = mix(
    mix(originalThickness, float(0.075), shallow.mul(0.66)),
    float(0.045),
    translucency.mul(0.72),
  );

  material.needsUpdate = true;

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
    physical.ior = 1.333;
    physical.attenuationDistance = TOUCH_DEVICE ? 52 : 64;
    physical.attenuationColor.set(0xa3e7dd);
    // Match the node-material transmission mode on mobile. It must not
    // compile a hidden high-transmission path when refraction is unavailable.
    if (TOUCH_DEVICE) physical.transmission = 0;
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