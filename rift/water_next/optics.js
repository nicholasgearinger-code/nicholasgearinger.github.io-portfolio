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
  const sunDirection = uniform(new THREE.Vector3(0.2,0.9,0.3).normalize());
  const sunlight = uniform(1);
  // Two inexpensive moving ripple bands perturb the physically displaced
  // wave normal without adding FFT compute or texture fetches.
  const p = positionWorld;
  const phaseA = p.x.mul(0.62).add(p.z.mul(0.41)).add(waveTime.mul(1.18));
  const phaseB = p.x.mul(-1.09).add(p.z.mul(0.73)).sub(waveTime.mul(1.63));
  const rippleX = cos(phaseA).mul(0.045).sub(sin(phaseB).mul(0.024));
  const rippleZ = sin(phaseA).mul(0.035).add(cos(phaseB).mul(0.026));
  const normal = geometry.normalNode.add(vec3(rippleX, float(0), rippleZ)).normalize();
  const view = cameraPosition.sub(positionWorld).normalize();
  const facing = clamp(abs(dot(normal, view)), 0, 1);
  const r0 = float(Math.pow((WATER_IOR - 1) / (WATER_IOR + 1), 2));
  const reflectance = r0.add(float(1).sub(r0).mul(pow(float(1).sub(facing), float(5))));
  const underwater = float(1).sub(clamp(cameraHeight.sub(waterHeight).mul(4).add(0.5), 0, 1));
  const slope = vec2(normal.x, normal.z);
  const distortion = slope.mul(mix(float(0.009), float(0.026), underwater))
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
  const shallowTint = color(0x4faeb2);
  const waterBody = mix(deepTint, shallowTint, exp(depth.mul(-0.12)));
  const sceneBase = mix(waterBody, refracted, transmission.mul(refractionTexture ? 0.80 : 0.35));
  // Underwater glancing incidence strengthens internal reflection, while
  // overhead sunlight transmits through the local wave orientation.
  const underwaterReflect = mix(reflectance, clamp(float(1).sub(facing).mul(0.68), 0, 0.72), underwater);
  const opticsColor = mix(sceneBase, reflected, underwaterReflect.mul(0.75));
  const transmittedSun = pow(clamp(dot(normal, sunDirection), 0, 1), float(4))
    .mul(sunlight).mul(underwater).mul(0.21);
  const opticalColor = (reflectionTexture || refractionTexture
    ? opticsColor
    : mix(waterBody, sky, underwaterReflect.mul(0.55)))
    .add(color(0xb9e7ed).mul(transmittedSun));
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
      if (Number.isFinite(elapsed)) waveTime.value = elapsed;
      if (sunDir?.isVector3) sunDirection.value.copy(sunDir).normalize();
      if (Number.isFinite(dayAmount)) sunlight.value = Math.max(0, Math.min(1, dayAmount));
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
