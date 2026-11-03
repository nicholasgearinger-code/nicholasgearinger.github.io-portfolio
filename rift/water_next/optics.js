// Experimental scene-capture optics. Uses EXISTING Rift render targets.
// No new rendering passes, target allocations or production activation.
import * as THREE from "three";
import { float, color, uniform, dot, abs, clamp, pow, mix, vec2, vec4,
  texture, screenUV, cameraPosition, positionWorld, attribute, exp, sin, cos, vec3, smoothstep } from "three/tsl";
export const WATER_IOR = 1.333;
export function fresnelSchlick(cosTheta, ior = WATER_IOR) {
  const c = Math.max(0, Math.min(1, cosTheta));
  const r0 = Math.pow((ior - 1) / (ior + 1), 2);
  return r0 + (1 - r0) * Math.pow(1 - c, 5);
}
export function createOpticsAdapter({
  field, material, geometry, reflectionTexture = null,
  reflectionMatrix = null, refractionTexture = null
}) {
  if (!field?.source || !material || !geometry?.normalNode) {
    throw new TypeError("Wave field, material, and coupled geometry normal required");
  }
  const originalColor = material.colorNode ?? uniform(color(0x267b91));
  // The production FFT shader already renders broad sun and sky glints.
  // Compress just its brightest peaks before Experimental adds reflection
  // and foam, preventing stacked highlights from forming a white column.
  const highlightThreshold = float(0.65);
  const basePeaks = clamp(originalColor.sub(vec3(highlightThreshold)), 0, 12);
  const balancedBase = originalColor.sub(basePeaks.mul(0.68));
  const originalIOR = material.ior;
  const sky = uniform(new THREE.Color(0x8bc4e1));
  const cameraHeight = uniform(5);
  const waterHeight = uniform(field.source.waterY ?? 0);
  const waveTime = uniform(0);
  const rippleGain = uniform(1.7);
  const reflectionGain = uniform(1.8);
  const refractionGain = uniform(1.8);
  const sunlightGain = uniform(1.8);
  const foamGain = uniform(1.55);
  const clarityGain = uniform(1.45);
  const glitterGain = uniform(1.65);
  const undersideGain = uniform(1.45);
  const sunDirection = uniform(new THREE.Vector3(0.2,0.9,0.3).normalize());
  const sunlight = uniform(1);
  const nightAmbient = uniform(0.20);
  // Two inexpensive moving ripple bands perturb the physically displaced
  // wave normal without adding FFT compute or texture fetches.
  const p = positionWorld;
  const phaseA = p.x.mul(0.62).add(p.z.mul(0.41)).add(waveTime.mul(1.18));
  const phaseB = p.x.mul(-1.09).add(p.z.mul(0.73)).sub(waveTime.mul(1.63));
  const rippleX = cos(phaseA).mul(0.045).sub(sin(phaseB).mul(0.024));
  const rippleZ = sin(phaseA).mul(0.035).add(cos(phaseB).mul(0.026));
  const normal = geometry.normalNode.add(vec3(rippleX.mul(rippleGain), float(0), rippleZ.mul(rippleGain))).normalize();
  const view = cameraPosition.sub(positionWorld).normalize();
  const facing = clamp(abs(dot(normal, view)), 0, 1);
  const r0 = float(Math.pow((WATER_IOR - 1) / (WATER_IOR + 1), 2));
  const reflectance = r0.add(float(1).sub(r0).mul(pow(float(1).sub(facing), float(5))));
  const underwater = float(1).sub(clamp(cameraHeight.sub(waterHeight).mul(4).add(0.5), 0, 1));
  const slope = vec2(normal.x, normal.z);
  const distortion = slope.mul(mix(float(0.009), float(0.026), underwater)).mul(refractionGain)
    .mul(float(0.6).add(float(1).sub(facing).mul(0.4)));
  const skyApprox = mix(originalColor, sky, reflectance.mul(0.65));

  // The primary-camera refraction capture is screen aligned.
  const refracted = refractionTexture
    ? texture(refractionTexture, clamp(screenUV.add(distortion), vec2(0.002), vec2(0.998))).rgb
    : originalColor;

  // Mirrored-camera reflections need the water reflection projection matrix.
  // Uniform is updated by the caller whenever the reflection camera moves.
  const mirrorMatrix = reflectionMatrix ? uniform(reflectionMatrix.clone()) : null;
  const projected = mirrorMatrix
    ? mirrorMatrix.mul(vec4(positionWorld, 1))
    : null;
  const reflectedUV = projected
    ? projected.xy.div(projected.w.abs().max(float(0.0001)))
        .add(distortion.mul(0.5))
    : null;
  const reflected = reflectionTexture && reflectedUV
    ? texture(reflectionTexture, clamp(reflectedUV, vec2(0.002), vec2(0.998))).rgb
    : sky;
  // Beer–Lambert-inspired attenuation derived from existing seabed depth.
  // No depth texture, ray marching or additional render pass. Clear in the
  // shallows; progressively blue/teal in deeper water.
  const hasDepth = Boolean(geometry.mesh?.geometry?.getAttribute?.("fftDepthWorld"));
  const depth = hasDepth ? clamp(attribute("fftDepthWorld", "float"), 0, 45) : float(12);
  const transmission = exp(depth.mul(-0.055).div(clarityGain));
  const deepTint = color(0x07526e);
  const shallowTint = color(0x389ca9);
  // Wide transition prevents a near-white, hard-looking depth boundary.
  const shallowFactor = exp(depth.mul(-0.075).div(clarityGain));
  const waterBody = mix(deepTint, shallowTint, shallowFactor);
  // The active Water Pro v9 shader ALREADY contains the animated cloud-sky
  // transmission, total-internal-reflection approximation, FFT facet breakup
  // and underwater radiance. Previous Experimental code discarded all of it
  // by replacing the entire color with a flat tint. Keep that base shader,
  // then layer scene captures and small wave-dependent highlights on top.
  const underwaterReflect = mix(reflectance,
    clamp(float(1).sub(facing).mul(0.68), 0, 0.72), underwater);
  const capturedBody = mix(waterBody, refracted, transmission.mul(0.84));
  const captureColor = mix(capturedBody, reflected, underwaterReflect.mul(0.84));
  // Existing reflection and refraction captures are only valid from above
  // the surface; from below they show stale/incorrect projection. Preserve
  // the v9 underwater optics rather than mixing in those textures.
  const captureWeight = clamp(float(1).sub(underwater).mul(0.45).mul(reflectionGain), 0, 0.94);
  // When mobile capture textures are unavailable, wave-dependent color
  // transmission still makes the refraction slider visibly responsive.
  const fallbackTransmission = clamp(slope.x.abs().add(slope.y.abs()).mul(refractionGain).mul(0.85), 0, 0.65);
  const composedBase = (reflectionTexture || refractionTexture)
    ? mix(balancedBase, captureColor, captureWeight)
    : mix(balancedBase, waterBody, fallbackTransmission.mul(0.50));
  // Fallback sky Fresnel creates visible reflection response even where iOS
  // disables expensive scene capture render targets.
  // Stronger grazing reflection, but no extra capture on mobile. Sky
  // contribution remains Fresnel-driven and vanishes near normal incidence.
  // Preserve existing physically shaded cloud panorama from the production
  // water material. This sky term represents extra grazing reflection only;
  // it must not wash out the actual reflected cloud and wave structure.
  const grazing = pow(float(1).sub(facing), float(3));
  const reflectionWeight = clamp(reflectance.mul(reflectionGain)
    .mul(float(0.14).add(grazing.mul(0.44))), 0, 0.70);
  const reflectedBase = mix(composedBase, sky, reflectionWeight);
  // Fine animated normals steer subtle transmitted sun and sky glimmer.
  // The low amplitude avoids repeating diamond patterns and leaves the
  // FFT-derived broad shading to the original physically-based shader.
  // Water depth governs the *distance light travels to the player*, not
  // the terrain-depth vertex attribute used by the shoreline palette.
  // The moving FFT normal decides how strongly the surface admits sunlight;
  // Beer-Lambert attenuates that contribution with actual camera submersion.
  const submersionDepth = clamp(waterHeight.sub(cameraHeight), 0, 80);
  const daylightTransmission = exp(submersionDepth.mul(-0.065));
  const ambientTransmission = exp(submersionDepth.mul(-0.026));
  const facingSun = clamp(dot(normal, sunDirection), 0, 1);
  const refractiveFocus = pow(facingSun, float(5))
    .mul(float(0.55).add(float(1).sub(facing).mul(0.45)));
  const transmittedSun = refractiveFocus
    .mul(sunlight).mul(underwater).mul(daylightTransmission).mul(0.19).mul(sunlightGain);
  // Fine, low-contrast radiance variation is tied to the SAME optical
  // normal as refraction and sun focusing, rather than a separate texture.
  const rippleLight = clamp(rippleX.mul(0.48).add(rippleZ.mul(0.36)).add(0.1), 0, 0.2)
    .mul(underwater).mul(ambientTransmission).mul(0.19).mul(sunlightGain);
  const undersideAmbient = clamp(dot(normal, vec3(0,1,0)), 0, 1)
    .mul(underwater).mul(nightAmbient).mul(ambientTransmission).mul(0.09);
  // View-space Snell window of the animated FFT surface. Crucially,
  // retain the existing multi-band Water Pro underside shading: replacing
  // it with a solid sky mix destroys normal/reflection structure.
  // n points toward air; -view points from the camera below toward air.
  const outgoing = view.negate();
  const incidence = clamp(dot(normal, outgoing), 0, 1);
  // Underwater critical angle ~48.6 degrees from the local normal.
  const snellWindow = smoothstep(float(0.645), float(0.70), incidence);
  const internalReflection = float(1).sub(snellWindow);
  const refractedSkyLight = sky.mul(snellWindow)
    .mul(ambientTransmission).mul(0.12).mul(undersideGain);
  // The same FFT normal modulates transmitted sunlight and caustic
  // focusing, while the lower-angle underside retains dark reflection.
  const sunlightThroughSurface = pow(
    clamp(dot(normal, sunDirection), 0, 1), float(4)
  ).mul(snellWindow).mul(daylightTransmission).mul(sunlight)
    .mul(undersideGain).mul(0.32);
  // The production shader already samples the sky and models the wave
  // underside. Modulate that detailed signal with broad FFT-facing light
  // instead of replacing it with a uniform turquoise ceiling. The two
  // slow bands alter transmitted brightness, not the wave geometry.
  const facetLight = clamp(dot(normal, sunDirection), 0, 1);
  const broadTransmission = smoothstep(float(0.12), float(0.88),
    facetLight.mul(0.74).add(incidence.mul(0.26)));
  // Large light pools roll with the actual FFT normal, while fine ripples
  // only fracture the light. Avoid the previous nearly uniform turquoise
  // lift that made the whole underside resemble a flat blue ceiling.
  const waveIllumination = float(0.56)
    .add(sin(phaseA.mul(0.31)).mul(0.18))
    .add(cos(phaseB.mul(0.27)).mul(0.13));
  const lightShaftFootprint = broadTransmission.mul(waveIllumination)
    .mul(sunlight).mul(daylightTransmission).mul(undersideGain);
  const focusedTransmission = pow(
    clamp(dot(normal, sunDirection), 0, 1), float(9)
  ).mul(snellWindow).mul(sunlight).mul(daylightTransmission)
    .mul(undersideGain);
  // Darker outer Snell window. The sky and lower-frequency wave shading
  // from the production material remain underneath the added highlights.
  const lowAngleShade = internalReflection.mul(float(1).sub(incidence))
    .mul(underwater).mul(0.35);
  const undersideBase = balancedBase.mul(float(1).sub(lowAngleShade));
  const underwaterSurface = undersideBase
    .add(refractedSkyLight.mul(underwater))
    .add(color(0x4aa9b9).mul(lightShaftFootprint).mul(underwater).mul(0.20))
    .add(color(0x8bded8).mul(focusedTransmission).mul(underwater).mul(0.22))
    .add(color(0xb8eee1).mul(sunlightThroughSurface).mul(underwater).mul(0.72));
  // Brighter wave crest transmission and fractured solar glints track the
  // same displaced FFT normal, not a scrolling decorative reflection texture.
  const sunHalf = sunDirection.add(view).normalize();
  const sunFacet = clamp(dot(normal, sunHalf), 0, 1);
  const glitterBreakup = smoothstep(float(0.24), float(0.86),
    sin(phaseA.mul(2.71)).mul(sin(phaseB.mul(1.89))).abs());
  // Two specular lobes: broad moving reflection on the swell plus
  // fractured sharp sparkles on the tiny wave facets. Both use the same
  // normals and sun vector as the water surface; no fake static light strip.
  // Keep the native Water Pro specular path as the primary sun glint.
  // These small secondary lobes restore broken wave facets without
  // producing a second saturated stripe across the whole horizon.
  const broadSunReflection = pow(sunFacet, float(40))
    .mul(float(0.06).add(grazing.mul(0.15)))
    .mul(sunlight).mul(glitterGain)
    .mul(float(1).sub(underwater)).mul(0.12);
  const glints = pow(sunFacet, float(125)).mul(glitterBreakup)
    .mul(sunlight).mul(glitterGain).mul(float(1).sub(underwater))
    .mul(0.16);
  const crest = smoothstep(waterHeight.add(0.12), waterHeight.add(1.35),
    positionWorld.y);
  const backlit = float(1).sub(clamp(dot(normal, sunDirection), 0, 1));
  const crestGlow = crest.mul(backlit).mul(sunlight)
    .mul(float(1).sub(underwater)).mul(0.27);

  // Two-part breaking foam: slope/crest whitecaps offshore, with a
  // depth-limited, noise-broken band for the shallow surf. Existing shoreline
  // foam and FFT wave physics remain authoritative; this adds optical texture
  // to the surface, without another mesh or pass.
  const faceSlope = clamp(normal.x.abs().add(normal.z.abs()), 0, 1);
  // Whitecaps emerge only on elevated, sufficiently steep facets.
  // The smoothly varying thresholds avoid turning the whole ocean white.
  const risingCrest = smoothstep(waterHeight.add(0.10),
    waterHeight.add(0.90), positionWorld.y);
  const breakingSteepness = smoothstep(float(0.30), float(0.76), faceSlope);
  const slopeFoam = breakingSteepness.mul(risingCrest);
  const foamBreakup = smoothstep(float(0.23), float(0.81),
    sin(phaseA.mul(0.73).add(phaseB.mul(0.37)))
      .mul(cos(phaseB.mul(0.84))).abs());
  const shoreline = float(1).sub(smoothstep(float(1.4), float(9.5), depth));
  const movingShore = smoothstep(float(0.52), float(0.91),
    sin(phaseA.mul(0.48).add(phaseB.mul(0.22))).mul(0.5).add(0.5));
  // Three foam scales: dense breaking crown, detached flecks on its
  // downwind side, and a restrained shallow-water surf wash. The production
  // persistent shoreline solver remains in charge of actual swash.
  // Use the actual displaced crest height to avoid spraying equally
  // across calm shallow flats. Whitecap crowns stay attached to steep
  // wave tops and leave breakup gaps rather than continuous white stripes.
  const crestCrown = slopeFoam.mul(foamBreakup)
    .mul(float(0.36).add(breakingSteepness.mul(0.64)));
  const sprayFlecks = smoothstep(float(0.70), float(0.96),
    sin(phaseA.mul(1.62).sub(phaseB.mul(0.87))).abs())
    .mul(risingCrest).mul(breakingSteepness).mul(0.17);
  const shorelineFoam = shoreline.mul(movingShore).mul(0.09);
  const foamMask = clamp(crestCrown.add(sprayFlecks)
    .add(shorelineFoam).mul(foamGain)
    .mul(float(1).sub(underwater)), 0, 0.86);
  const surfaceColor = reflectedBase
    .add(color(0xffe5bd).mul(broadSunReflection))
    .add(color(0xffedc4).mul(glints))
    .add(color(0x6fe8d2).mul(crestGlow));
  const opticalColor = mix(mix(surfaceColor, underwaterSurface, underwater), color(0xe5f6ee), foamMask)
    .add(color(0xb9e7ed).mul(transmittedSun))
    .add(sky.mul(rippleLight))
    .add(color(0x75b5c3).mul(undersideAmbient));
  // Prevent additive contributions from exceeding physically plausible
  // display luminance on mobile without clipping already-dark water.
  const shoulder = clamp(opticalColor.sub(vec3(0.83)), 0, 8);
  const displayBalancedColor = opticalColor.sub(shoulder.mul(0.58));
  let active = false;
  return {
    field, material, reflectance, normalNode: geometry.normalNode,
    usesSceneReflection: Boolean(reflectionTexture && reflectionMatrix),
    usesSceneRefraction: Boolean(refractionTexture),
    get active() { return active; },
    apply() {
      if (active) return;
      material.colorNode = displayBalancedColor;
      material.ior = WATER_IOR;
      material.needsUpdate = true;
      active = true;
    },
    update({ cameraY, skyColor, waterY, elapsed, sunDir, dayAmount, reflectionMatrix: nextMatrix } = {}) {
      const tune = globalThis.__riftOceanTuning ?? {};
      const limit = (key, fallback) => Number.isFinite(Number(tune[key])) ? Math.max(0, Math.min(3, Number(tune[key]))) : fallback;
      rippleGain.value = limit("ripples", 1.7);
      reflectionGain.value = limit("reflection", 1.8);
      refractionGain.value = limit("refraction", 1.8);
      sunlightGain.value = limit("sunlight", 1.8);
      foamGain.value = limit("foam", 1.55);
      clarityGain.value = Math.max(0.35, limit("clarity", 1.45));
      glitterGain.value = limit("glitter", 1.65);
      undersideGain.value = limit("underside", 1.45);
      if (Number.isFinite(elapsed)) waveTime.value = elapsed;
      if (sunDir?.isVector3) sunDirection.value.copy(sunDir).normalize();
      if (Number.isFinite(dayAmount)) {
        sunlight.value = Math.max(0, Math.min(1, dayAmount));
        nightAmbient.value = 0.22 + 0.26 * sunlight.value;
      }
      if (Number.isFinite(cameraY)) cameraHeight.value = cameraY;
      if (Number.isFinite(waterY)) waterHeight.value = waterY;
      if (skyColor?.isColor) sky.value.copy(skyColor);
      if (mirrorMatrix && nextMatrix?.isMatrix4) mirrorMatrix.value.copy(nextMatrix);
    },
    restore() {
      if (!active) return;
      material.colorNode = originalColor;
      material.ior = originalIOR;
      material.needsUpdate = true;
      active = false;
    },
    dispose() { this.restore(); },
  };
}
