// Experimental scene-capture optics. Uses EXISTING Rift render targets.
// No new rendering passes, target allocations or production activation.
import * as THREE from "three";
import { float, color, uniform, dot, abs, clamp, pow, mix, vec2, vec4,
  texture, screenUV, cameraPosition, positionWorld, attribute, exp, sin, cos, vec3 } from "three/tsl";
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
  const originalIOR = material.ior;
  const sky = uniform(new THREE.Color(0x8bc4e1));
  const cameraHeight = uniform(5);
  const waterHeight = uniform(field.source.waterY ?? 0);
  const waveTime = uniform(0);
  const rippleGain = uniform(1.7);
  const reflectionGain = uniform(1.8);
  const refractionGain = uniform(1.8);
  const sunlightGain = uniform(1.8);
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
  const transmission = exp(depth.mul(-0.055));
  const deepTint = color(0x07526e);
  const shallowTint = color(0x389ca9);
  // Wide transition prevents a near-white, hard-looking depth boundary.
  const shallowFactor = exp(depth.mul(-0.075));
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
    ? mix(originalColor, captureColor, captureWeight)
    : mix(originalColor, waterBody, fallbackTransmission);
  // Fallback sky Fresnel creates visible reflection response even where iOS
  // disables expensive scene capture render targets.
  const reflectedBase = mix(composedBase, sky, clamp(reflectance.mul(reflectionGain).mul(0.23), 0, 0.58));
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
  const opticalColor = reflectedBase
    .add(color(0xb9e7ed).mul(transmittedSun))
    .add(sky.mul(rippleLight))
    .add(color(0x75b5c3).mul(undersideAmbient));
  let active = false;
  return {
    field, material, reflectance, normalNode: geometry.normalNode,
    usesSceneReflection: Boolean(reflectionTexture && reflectionMatrix),
    usesSceneRefraction: Boolean(refractionTexture),
    get active() { return active; },
    apply() {
      if (active) return;
      material.colorNode = opticalColor;
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
