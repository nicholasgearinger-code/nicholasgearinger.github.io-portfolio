// Experimental scene-capture optics. Uses EXISTING Rift render targets.
// No new rendering passes, target allocations or production activation.
import * as THREE from "three";
import { getRealisticCloudTexture } from "../clouds_storm_base.js";
import { float, color, uniform, dot, abs, clamp, pow, mix, vec2, vec4,
  texture, screenUV, cameraPosition, positionWorld, attribute, exp, sin, cos, vec3, smoothstep } from "three/tsl";
export const WATER_IOR = 1.333;
export function fresnelSchlick(cosTheta, ior = WATER_IOR) {
  const c = Math.max(0, Math.min(1, cosTheta));
  const r0 = Math.pow((ior - 1) / (ior + 1), 2);
  return r0 + (1 - r0) * Math.pow(1 - c, 5);
}
// Ocean 3.0 — one optical response from one wave normal. Unlike the old
// layered shader this starts from the water-column body color and does NOT
// add another sun-glitter lobe on top of the MeshPhysicalMaterial's BRDF.
// The native water geometry, FFT compute and shoreline solver stay intact.
function createUnifiedSurfaceAdapter({
  field, material, geometry, reflectionTexture, reflectionMatrix, refractionTexture
}) {
  const priorColor = material.colorNode;
  const priorRoughness = material.roughnessNode;
  // The Experimental optical adapter previously replaced both of these
  // node graphs wholesale. On iPhone that silently hid Rift's Fluid Lab
  // shoreline: bilinearly solved foam, flow normals, local optical thickness
  // and water-column refraction from the existing GPU shallow-water solver.
  //
  // Preserve the full already-compiled production graph on mobile instead
  // of blending two large fragment graphs (which would hurt ~13 fps).
  // Offshore geometry, surf simulation and shared capture logic still run.
  // A/B fallback: ?riftExperimentalFluid=off restores the prior renderer.
  const preserveMobileFluidLab = Boolean(
    field.source?.fftLocalLabOpticsActive &&
    priorColor && priorRoughness &&
    typeof navigator !== "undefined" &&
    (/iPhone|iPad|iPod/i.test(navigator.userAgent || "") ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) &&
    (typeof location === "undefined" ||
      new URLSearchParams(location.search).get("riftExperimentalFluid") !== "off")
  );
  const priorIOR = material.ior;
  const priorTransmission = material.transmissionNode;
  const priorThickness = material.thicknessNode;
  const originalTransmissionScalar = Number.isFinite(material.transmission) ? material.transmission : 0.7;
  const originalThicknessScalar = Number.isFinite(material.thickness) ? material.thickness : 0.24;
  const time = uniform(0);
  const waterY = uniform(field.source.waterY ?? 0);
  const cameraYUniform = uniform(5);
  const skyColor = uniform(new THREE.Color(0x82c3dc));
  const sunDir = uniform(new THREE.Vector3(0.2, 0.9, 0.3).normalize());
  const day = uniform(1);
  const rippleGain = uniform(1);
  const reflectionGain = uniform(1);
  const refractionGain = uniform(1);
  const foamGain = uniform(1);
  const breakerGain = uniform(1);
  const clarityGain = uniform(1);
  const undersideGain = uniform(1);
  const sunlightGain = uniform(1);
  const cloudPanorama = getRealisticCloudTexture();
  // Before/after comparison without changing any saved graphics settings.
  // Water remains physically coupled to the same FFT surface normal.
  const daylightWaterFillEnabled = (() => {
    try { return new URLSearchParams(location.search).get("riftDebug") !== "oldwaterlight"; }
    catch (_) { return true; }
  })();

  const p = positionWorld;
  const phaseA = p.x.mul(0.88).add(p.z.mul(0.51)).add(time.mul(1.17));
  const phaseB = p.x.mul(-1.22).add(p.z.mul(0.67)).sub(time.mul(1.55));
  // These are detail normal perturbations, not independent wave motion:
  // large-scale orientation comes exclusively from the displaced mesh.
  const depthAvailable = Boolean(geometry.mesh?.geometry?.getAttribute?.("fftDepthWorld"));
  const seaDepth = depthAvailable
    ? clamp(attribute("fftDepthWorld", "float"), 0, 80) : float(18);
  // In very shallow water, wave energy dissipates against the bottom.
  // Retain real FFT displacement but soften the normal's sharpest slopes
  // to avoid the glittering wall / reflective seam at the shoreline.
  const shoreDamping = float(1).sub(
    smoothstep(float(0.25), float(5.5), seaDepth)
  );
  const smoothShoreNormal = mix(geometry.normalNode, vec3(0, 1, 0),
    shoreDamping.mul(0.24)).normalize();
  const microX = cos(phaseA).mul(0.025).add(sin(phaseB).mul(0.018));
  const microZ = sin(phaseA).mul(0.022).sub(cos(phaseB).mul(0.015));
  const n = smoothShoreNormal.add(vec3(
    microX.mul(rippleGain).mul(float(1).sub(shoreDamping.mul(0.46))),
    float(0),
    microZ.mul(rippleGain).mul(float(1).sub(shoreDamping.mul(0.46)))
  )).normalize();
  const view = cameraPosition.sub(p).normalize();
  const ndv = clamp(abs(dot(n, view)), 0, 1);
  const sun = sunDir.normalize();
  const ndl = clamp(dot(n, sun), 0, 1);
  const above = clamp(cameraYUniform.sub(waterY).mul(3).add(0.5), 0, 1);
  const submerged = float(1).sub(above);
  // The iPhone FFT presentation mesh has regular cell spacing. A sharply
  // varying underside normal can turn those cells into a bright oval grid.
  // Keep full wave normals above water; below use a broader optical normal
  // for sky transmission and internal reflection (geometry stays untouched).
  const oldUndersideNormal = mix(n, vec3(0, 1, 0),
    submerged.mul(0.50)).normalize();
  // Phase B/C ceiling: three wave scales, one coherent optical normal.
  // Low-frequency phase directions are deliberately oblique, not aligned
  // to the grid. Neither a tiling texture nor extra FFT fetches are used.
  const ceilingA = p.x.mul(0.37).add(p.z.mul(0.19)).sub(time.mul(0.43));
  const ceilingB = p.x.mul(-0.23).add(p.z.mul(0.41)).add(time.mul(0.36));
  const ceilingC = p.x.mul(0.91).sub(p.z.mul(0.76)).add(time.mul(0.79));
  const broadCeiling = vec3(
    sin(ceilingA).mul(0.066).add(cos(ceilingB).mul(0.048)),
    float(0),
    cos(ceilingA.mul(0.88)).mul(0.061).sub(sin(ceilingB).mul(0.044))
  );
  const smallCeiling = vec3(
    sin(ceilingC).mul(0.015),
    float(0),
    cos(ceilingC.mul(0.83)).mul(0.014)
  );
  const undersideNormal = oldUndersideNormal
    .add(broadCeiling).add(smallCeiling).normalize();
  const richCeilingEnabled = (() => {
    try { return new URLSearchParams(location.search).get("riftDebug") !== "oldceiling"; }
    catch (_) { return true; }
  })();
  // Independent optics A/B: ?riftDebug=oldskytransmission retains the
  // previous sky atlas sampling while leaving all other ceiling changes on.
  const refractedSkyEnabled = (() => {
    try { return new URLSearchParams(location.search).get("riftDebug") !== "oldskytransmission"; }
    catch (_) { return true; }
  })();
  const ceilingNormal = richCeilingEnabled ? undersideNormal : oldUndersideNormal;
  // From inside water, bend the view ray toward the air using Snell's law.
  // Water-to-air eta=1.333. Reject rays beyond the critical angle with a
  // smooth Snell window below, rather than sampling invalid exit directions.
  const undersideRay = view.negate();
  const undersideIncidence = clamp(dot(ceilingNormal, undersideRay), 0, 1);
  const etaWaterAir = float(1.333);
  const sinRefractedSq = etaWaterAir.mul(etaWaterAir)
    .mul(float(1).sub(undersideIncidence.mul(undersideIncidence)));
  const cosRefracted = float(1).sub(clamp(sinRefractedSq, 0, 1)).sqrt();
  const exitSkyRay = undersideRay.mul(etaWaterAir)
    .add(ceilingNormal.mul(cosRefracted.sub(etaWaterAir.mul(undersideIncidence))))
    .normalize();
  const snell = richCeilingEnabled
    ? smoothstep(float(0.607), float(0.745), undersideIncidence)
      .mul(0.78).add(
        smoothstep(float(0.52), float(0.87), undersideIncidence).mul(0.22)
      )
    : smoothstep(float(0.635), float(0.705), undersideIncidence);
  const tir = float(1).sub(snell);

  // Fresnel from the water/air interface; use ONE reflectance weighting.
  const f0 = float(Math.pow((WATER_IOR - 1) / (WATER_IOR + 1), 2));
  const fresnel = f0.add(float(1).sub(f0)
    .mul(pow(float(1).sub(ndv), float(5))));
  // Estimated water-column path accounts for slant angle and water depth.
  // Wavelength-dependent Beer-Lambert: red attenuates before green/blue.
  const waterPath = seaDepth.div(ndv.max(float(0.22)))
    .div(clarityGain.max(float(0.35)));
  const throughput = exp(vec3(-0.105, -0.047, -0.023).mul(waterPath));
  const shallowInfluence = exp(waterPath.mul(-0.060));
  const inScatter = mix(color(0x06506b), color(0x2a8d9c), shallowInfluence);
  // Physically motivated diffuse sky irradiance: the broad sky remains
  // bright when the sun direction changes. Avoid using sunFacing for this
  // term, or half the rolling water goes nearly black away from the Sun.
  // Daylight gating preserves night and does not wash out deep-water color.
  const skyDaylight = smoothstep(float(0.07), float(0.62), day);
  const skyIrradiance = skyColor.mul(0.24)
    .add(color(0x38b6c4).mul(0.16))
    .mul(skyDaylight);
  const skyWaterFill = daylightWaterFillEnabled
    ? skyIrradiance.mul(
        float(0.40).add(shallowInfluence.mul(0.44))
      ).mul(float(0.48).add(clamp(n.y, 0, 1).mul(0.52)))
    : vec3(0, 0, 0);
  // Wave normal bends capture coordinates; bounded UVs avoid screen-edge tears.
  const slant = float(1).sub(ndv);
  // Distortion comes from the SAME surface normal as the Fresnel term.
  // Scale it with optical path length: thin water near shore should not
  // bend the seabed as much as several metres of water farther offshore.
  const distortionDepth = smoothstep(float(0.15), float(7.5), seaDepth);
  const refractionOffset = vec2(n.x, n.z).mul(refractionGain)
    .mul(slant.mul(0.012).add(0.003))
    .mul(distortionDepth.mul(0.86).add(0.14));
  const refractedUV = clamp(screenUV.add(refractionOffset),
    vec2(0.003), vec2(0.997));
  // The WebGPU loader disables legacy offscreen capture renders on iOS
  // because they invalidate the command encoder. Never pretend a constant
  // pale color is the seabed. Without a capture, physically based material
  // transmission supplies real background visibility; this color node
  // supplies only the wavelength-filtered water-column scattering.
  const bottomRadiance = refractionTexture
    ? texture(refractionTexture, refractedUV).rgb
    : inScatter;
  const captureVisibility = refractionTexture ? float(1) : float(0);
  const transmitted = inScatter.mul(vec3(1).sub(throughput))
    .add(bottomRadiance.mul(throughput).mul(captureVisibility))
    .add(inScatter.mul(throughput).mul(float(1).sub(captureVisibility)).mul(0.43))
    .add(skyWaterFill.mul(float(1).sub(captureVisibility.mul(0.65))));

  // Reflect the viewer around the SAME moving optical normal. No other
  // sky-glint or faux specular strip is added to the surface albedo.
  const reflectionRay = n.mul(dot(n, view).mul(2)).sub(view).normalize();
  // One sky atlas read handles BOTH above-water reflected sky and
  // below-water refracted sky. The exit direction is only meaningful
  // inside the water-to-air transmission cone; outer angles use the
  // stable reflection ray as they approach total internal reflection.
  const ceilingSkyDir = mix(reflectionRay, exitSkyRay,
    clamp(snell.mul(1.22), 0, 1)).normalize();
  const sampledSkyDir = refractedSkyEnabled
    ? mix(reflectionRay, ceilingSkyDir, submerged).normalize()
    : reflectionRay;
  const panoramaUV = vec2(
    sampledSkyDir.x.mul(0.26).add(time.mul(0.002)),
    sampledSkyDir.z.mul(0.14).add(0.80)
  ).add(vec2(0.5, 0));
  const sample = texture(cloudPanorama, panoramaUV);
  // Keep directional cloud structure, but provide diffuse sky radiance
  // under cloud occlusion and on facets angled away from the direct sun.
  // The angular/cloud part remains wave-normal driven; no extra lookup.
  // The cloud atlas is not a true reflected underside capture. Sampling
  // its high-frequency detail through the coarse mobile FFT slopes made
  // repeating oval/diamond patches visible below the surface. Above water
  // keep the detailed sky; below transition to smooth sky radiance.
  // The old global 15% cloud transmission made the entire ceiling
  // featureless. Recover cloud detail ONLY inside the Snell window;
  // reflection/TIR regions retain a smooth sky to prevent FFT oval grids.
  const undersideSkyDetail = refractedSkyEnabled
    ? float(0.09).add(snell.mul(0.43))
    : float(0.15);
  const skyRadiance = mix(skyColor, sample.rgb,
    sample.a.mul(0.70).mul(mix(undersideSkyDetail, float(1), above)));
  const ambientSkyReflection = daylightWaterFillEnabled
    ? skyColor.mul(skyDaylight).mul(0.13)
    : vec3(0, 0, 0);
  const matrixUniform = reflectionMatrix ? uniform(reflectionMatrix.clone()) : null;
  const projection = matrixUniform ? matrixUniform.mul(vec4(p, 1)) : null;
  const captureUV = projection ? projection.xy
    .div(projection.w.abs().max(float(0.0001))) : null;
  const environment = reflectionTexture && captureUV
    ? texture(reflectionTexture,
      clamp(captureUV, vec2(0.002), vec2(0.998))).rgb
    : skyRadiance;
  // Exactly one Fresnel blend between transmitted and reflected light.
  // The shoulder reduces the stacked overexposed sun column on mobile.
  // Fresnel remains the sole reflection/transmission blend. Suppress
  // exaggerated shallow-water glare without eliminating realistic
  // grazing-angle reflection near the beach.
  const shallowReflectionDamping = float(1).sub(
    shoreDamping.mul(float(1).sub(slant)).mul(0.26)
  );
  const reflectionBlend = clamp(
    fresnel.mul(reflectionGain).mul(shallowReflectionDamping), 0.015, 0.91
  );
  // Preserve cloud shape but compress the high-luminance cloud/sun peaks.
  // Break reflection up with geometry normals rather than fake white bands.
  const reflectionRadiance = environment.add(ambientSkyReflection)
    .div(float(1).add(environment.mul(0.24)));
  const surface = mix(transmitted, reflectionRadiance, reflectionBlend);

  // Rising and compressed wave faces determine where breaking crowns start.
  // Thin fractured crests are lit by sun and then blended as surface foam.
  const slope = clamp(abs(n.x).add(abs(n.z)), 0, 1);
  const rising = smoothstep(waterY.add(0.12), waterY.add(1.05), p.y);
  const breaking = smoothstep(float(0.34), float(0.78), slope).mul(rising);
  const breakup = smoothstep(float(0.22), float(0.80),
    abs(sin(phaseA.mul(0.76)).mul(cos(phaseB.mul(0.91)))));
  const foam = clamp(breaking.mul(breakup)
    .mul(foamGain).mul(breakerGain), 0, 0.78);
  // Whitecaps are seen from above. Do not imprint their regular threshold
  // pattern onto the underside's transmission and roughness.
  const visibleFoam = foam.mul(above);
  const crestTransmission = rising.mul(float(1).sub(ndl))
    .mul(day).mul(sunlightGain).mul(0.12);
  const waterSurface = mix(surface.add(color(0x4dafa8).mul(crestTransmission)),
    color(0xe4f2eb), visibleFoam);
  // The same seabed-depth value controls both transmitted background and
  // absorption. Underwater rocks/sand are real scene objects, not a sky tint.
  const shallowTransmittance = float(1).sub(
    smoothstep(float(2), float(25), seaDepth));
  // The physical transmission path is what reveals *actual* sand, rocks,
  // and corals on WebGPU/mobile where old mirror/refraction captures are
  // disabled. Gently bias transparent shallow water toward clarity rather
  // than layering synthetic bottom colors over the scene.
  const physicalTransmission = mix(
    priorTransmission ?? float(originalTransmissionScalar),
    float(0.985), shallowTransmittance.mul(0.87)
  ).mul(float(1).sub(visibleFoam.mul(0.94)));
  // Effective thickness controls built-in refraction/attenuation: thin
  // shallow water, thicker deeper water. The refraction slider now also
  // influences this path even without any off-screen capture.
  const physicalThickness = mix(
    priorThickness ?? float(originalThicknessScalar),
    float(0.038), shallowTransmittance.mul(0.90)
  ).mul(float(0.70).add(refractionGain.mul(0.30)));

  // Phase B: a water-to-air Snell window seen from beneath the surface.
  // At n_water=1.333 the critical incidence is cos(theta_c)~0.661.
  // The FFT normal bends this boundary; small surface facets modulate it
  // instead of animating an unrelated blue overlay over the whole scene.
  const cameraDepth = clamp(waterY.sub(cameraYUniform), 0, 80);
  const nearSurface = exp(cameraDepth.mul(-0.048));
  const undersideThroughput = exp(vec3(-0.105, -0.047, -0.023)
    .mul(cameraDepth.div(clarityGain.max(float(0.35)))));
  // FFT-facing normal determines sky transmission. The fine waves only
  // fracture that image and its light bands, rather than increasing opacity.
  const waveFacet = clamp(
    ceilingNormal.y.mul(0.77).add(abs(ceilingNormal.x).mul(0.12))
      .add(abs(ceilingNormal.z).mul(0.11)), 0, 1);
  const transmissionDetail = smoothstep(float(0.36), float(0.94), waveFacet);
  // Sky and soft cloud structure are transmitted through the aperture,
  // modulated by a broad caustic-like field at the actual water surface.
  // Avoid thresholding the repeating triangle normals into isolated ovals.
  // Gently expand the broad ceiling shapes without letting the FFT cell
  // slope turn into bright spot thresholds. Continuous, world-space waves.
  const ceilingField = clamp(
    sin(ceilingA).mul(cos(ceilingB)).mul(0.30)
      .add(sin(ceilingC).mul(0.095))
      .add(waveFacet.mul(0.21)).add(0.50), 0, 1
  );
  // Continuous modulation, not the hard threshold that caused oval grids.
  const ceilingGlow = richCeilingEnabled
    ? float(0.80).add(ceilingField.mul(0.50))
    : float(1);
  const overheadColor = skyRadiance.mul(undersideThroughput)
    .add(color(0x0b6478).mul(vec3(1).sub(undersideThroughput)))
    .mul(ceilingGlow);
  // Outside the Snell cone, mostly see the water's dark internal reflection
  // plus a restrained reflected cloud contribution. No solid black cutoff.
  const internalReflection = mix(color(0x08475b),
    reflectionRadiance.mul(0.39).add(color(0x10556a)),
    clamp(tir.mul(nearSurface), 0, 0.46));
  // Preserve a trace of diffuse light beyond the Snell window; hard
  // zeroing transmitted sky created a flat horizontal dark/bright band.
  const skylightWindow = snell.mul(nearSurface)
    .mul(float(0.74).add(transmissionDetail.mul(0.23)))
    .add(float(0.055).mul(nearSurface).mul(skyDaylight));
  // Sun transmission is a wide, soft cone with moving bright wave facets;
  // avoid narrow white strips and the previous additive highlight stacking.
  const sunFacets = pow(clamp(dot(ceilingNormal, sun), 0, 1), float(4));
  const transmittedSun = sunFacets.mul(day).mul(sunlightGain)
    .mul(nearSurface).mul(snell).mul(undersideGain);
  const underside = mix(internalReflection, overheadColor, skylightWindow)
    .add(color(0x80cfc9).mul(transmittedSun)
      .mul(ceilingGlow).mul(0.24));
  const total = mix(underside, waterSurface, above);

  // Native physical BRDF handles the direct sunlight specular highlight.
  // Foam roughens the surface, and wave slopes affect roughness smoothly.
  const roughness = mix(
    mix(float(0.055), float(0.47), visibleFoam)
      .add(slope.mul(0.036)).add(shoreDamping.mul(0.045)),
    float(0.33), submerged
  );
  let active = false;
  return {
    field, material, reflectance: fresnel, normalNode: n,
    usesSceneReflection: Boolean(reflectionTexture && reflectionMatrix),
    usesSceneRefraction: Boolean(refractionTexture),
    get active() { return active; },
    apply() {
      if (active) return;
      material.colorNode = preserveMobileFluidLab ? priorColor : total;
      material.roughnessNode = preserveMobileFluidLab ? priorRoughness : roughness;
      material.transmissionNode = preserveMobileFluidLab
        ? priorTransmission : physicalTransmission;
      material.thicknessNode = preserveMobileFluidLab
        ? priorThickness : physicalThickness;
      if (preserveMobileFluidLab) {
        field.source.__riftExperimentalFluidPreserved = true;
      }
      material.ior = WATER_IOR;
      material.needsUpdate = true;
      active = true;
    },
    update({ cameraY, skyColor: nextSky, waterY: nextY, elapsed,
      sunDir: nextSun, dayAmount, reflectionMatrix: nextMatrix } = {}) {
      const tune = globalThis.__riftOceanTuning ?? {};
      const value = (key, fallback) => {
        const v = Number(tune[key]);
        return Number.isFinite(v) ? Math.max(0, Math.min(3, v)) : fallback;
      };
      if (Number.isFinite(elapsed)) time.value = elapsed;
      if (Number.isFinite(cameraY)) cameraYUniform.value = cameraY;
      if (Number.isFinite(nextY)) waterY.value = nextY;
      if (nextSky?.isColor) skyColor.value.copy(nextSky);
      if (nextSun?.isVector3) sunDir.value.copy(nextSun).normalize();
      if (Number.isFinite(dayAmount)) day.value = Math.max(0, Math.min(1, dayAmount));
      rippleGain.value = value("ripples", 1.7) / 1.7;
      reflectionGain.value = value("reflection", 1.8) / 1.8;
      refractionGain.value = value("refraction", 1.8) / 1.8;
      foamGain.value = value("foam", 1.55) / 1.55;
      breakerGain.value = value("breakers", 1.05) / 1.05;
      clarityGain.value = Math.max(0.35, value("clarity", 1.45) / 1.45);
      undersideGain.value = value("underside", 1.45) / 1.45;
      sunlightGain.value = value("sunlight", 1.8) / 1.8;
      if (matrixUniform && nextMatrix?.isMatrix4) matrixUniform.value.copy(nextMatrix);
    },
    restore() {
      if (!active) return;
      material.colorNode = priorColor;
      material.roughnessNode = priorRoughness;
      if (preserveMobileFluidLab) {
        field.source.__riftExperimentalFluidPreserved = false;
      }
      material.ior = priorIOR;
      material.transmissionNode = priorTransmission;
      material.thicknessNode = priorThickness;
      material.needsUpdate = true;
      active = false;
    },
    dispose() { this.restore(); },
  };
}

export function createOpticsAdapter({
  field, material, geometry, reflectionTexture = null,
  reflectionMatrix = null, refractionTexture = null
}) {
  if (!field?.source || !material || !geometry?.normalNode) {
    throw new TypeError("Wave field, material, and coupled geometry normal required");
  }
  // Opt-in unified material. Diagnostic rollback: ?riftDebug=stackedoptics
  // does not alter stored water mode or the production rendering path.
  const legacyStack = typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("riftDebug") === "stackedoptics";
  if (!legacyStack) return createUnifiedSurfaceAdapter({
    field, material, geometry, reflectionTexture, reflectionMatrix, refractionTexture
  });
  const originalColor = material.colorNode ?? uniform(color(0x267b91));
  // The production FFT shader already renders broad sun and sky glints.
  // Compress just its brightest peaks before Experimental adds reflection
  // and foam, preventing stacked highlights from forming a white column.
  const highlightThreshold = float(0.65);
  const basePeaks = clamp(originalColor.sub(vec3(highlightThreshold)), 0, 12);
  const balancedBase = originalColor.sub(basePeaks.mul(0.68));
  const originalIOR = material.ior;
  const sky = uniform(new THREE.Color(0x8bc4e1));
  // Share the cloud panorama already used by the sky dome / Water Pro base.
  // One existing texture lookup, no mirrored camera or second scene pass.
  const skyPanorama = getRealisticCloudTexture();
  const breakerGain = uniform(1.05);
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
  // Fallback reflection: reflect the current eye vector across the
  // displaced FFT normal, then query the SAME moving cloud panorama as the
  // production sky. Flat sky mixing previously looked like painted water.
  const reflectionRay = normal.mul(dot(normal, view).mul(2)).sub(view).normalize();
  const panoramaUV = vec2(
    reflectionRay.x.mul(0.26).add(waveTime.mul(0.002)),
    reflectionRay.z.mul(0.14).add(0.80)
  ).add(vec2(0.5, 0));
  const panoramaSample = texture(skyPanorama, panoramaUV);
  const skyReflection = mix(sky, panoramaSample.rgb, panoramaSample.a.mul(0.65));
  const reflected = reflectionTexture && reflectedUV
    ? texture(reflectionTexture, clamp(reflectedUV, vec2(0.002), vec2(0.998))).rgb
    : skyReflection;
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
  // This is a directional environment reflection. The existing v9 shader
  // remains underneath; keep the added lobe restrained to avoid solar
  // overexposure where both reflection models overlap.
  const reflectedBase = mix(composedBase, reflected, reflectionWeight.mul(0.72));
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
  const breakingSteepness = smoothstep(float(0.27), float(0.70), faceSlope);
  // At higher incidence the front face of the breaking wave turns white,
  // but not its entire back face. Use projected movement along the dominant
  // swell direction for a wave-aligned crown rather than scattered patches.
  const advancingFace = smoothstep(float(-0.13), float(0.38),
    normal.x.mul(-0.79).add(normal.z.mul(-0.61)));
  const slopeFoam = breakingSteepness.mul(risingCrest)
    .mul(float(0.40).add(advancingFace.mul(0.60)));
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
  // Breaker crowns with a slightly darker shoulder and torn white tips.
  // Still a surface/foam approximation, not actual overturning geometry.
  const crestCrown = slopeFoam.mul(foamBreakup)
    .mul(float(0.44).add(breakingSteepness.mul(0.56)))
    .mul(breakerGain);
  const sprayFlecks = smoothstep(float(0.70), float(0.96),
    sin(phaseA.mul(1.62).sub(phaseB.mul(0.87))).abs())
    .mul(risingCrest).mul(breakingSteepness).mul(0.17);
  const shorelineFoam = shoreline.mul(movingShore).mul(0.09);
  const foamMask = clamp(crestCrown.add(sprayFlecks)
    .add(shorelineFoam).mul(foamGain)
    .mul(float(1).sub(underwater)), 0, 0.86);
  const crestShoulder = risingCrest.mul(breakingSteepness)
    .mul(float(1).sub(foamBreakup)).mul(0.17);
  const surfaceColor = reflectedBase
    .add(color(0xffe5bd).mul(broadSunReflection))
    .add(color(0xffedc4).mul(glints))
    .add(color(0x6fe8d2).mul(crestGlow))
    .add(color(0x76c5c6).mul(crestShoulder));
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
      breakerGain.value = limit("breakers", 1.05);
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
