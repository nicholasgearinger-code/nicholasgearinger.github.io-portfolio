// Experimental scene-capture optics. Uses EXISTING Rift render targets.
// No new rendering passes, target allocations or production activation.
import * as THREE from "three";
import { float, color, uniform, dot, abs, clamp, pow, mix, vec2, vec4,
  texture, screenUV, cameraPosition, positionWorld } from "three/tsl";
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
  const normal = geometry.normalNode.normalize();
  const view = cameraPosition.sub(positionWorld).normalize();
  const facing = clamp(abs(dot(normal, view)), 0, 1);
  const r0 = float(Math.pow((WATER_IOR - 1) / (WATER_IOR + 1), 2));
  const reflectance = r0.add(float(1).sub(r0).mul(pow(float(1).sub(facing), float(5))));
  const underwater = float(1).sub(clamp(cameraHeight.sub(waterHeight).mul(4).add(0.5), 0, 1));
  const slope = vec2(normal.x, normal.z);
  const distortion = slope.mul(0.035);
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
  const reflected = reflectionTexture
    ? texture(reflectionTexture, clamp(reflectedUV ?? screenUV, vec2(0.002), vec2(0.998))).rgb
    : sky;
  const sceneBase = mix(originalColor, refracted, refractionTexture ? float(0.68) : float(0));
  const opticsColor = mix(sceneBase, reflected, reflectance.mul(0.82));
  const opticalColor = mix(skyApprox, opticsColor,
    reflectionTexture || refractionTexture ? float(1) : float(0));
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
    update({ cameraY, skyColor, waterY, reflectionMatrix: nextMatrix } = {}) {
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
