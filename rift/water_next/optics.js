// Experimental optical layer for the SAME combined FFT/shallow-water normal.
// No render targets/passes are allocated; enable only with experimental geometry.
import * as THREE from "three";
import { float, color, uniform, dot, abs, clamp, pow, mix,
  cameraPosition, positionWorld } from "three/tsl";
export const WATER_IOR = 1.333;
export function fresnelSchlick(cosTheta, ior = WATER_IOR) {
  const c = Math.max(0, Math.min(1, cosTheta));
  const r0 = Math.pow((ior - 1) / (ior + 1), 2);
  return r0 + (1 - r0) * Math.pow(1 - c, 5);
}
export function createOpticsAdapter({ field, material, geometry }) {
  if (!field?.source || !material || !geometry?.normalNode) {
    throw new TypeError("Wave field, material, and coupled geometry normal required");
  }
  const originalColor = material.colorNode ?? uniform(color(0x267b91));
  const originalRoughness = material.roughnessNode;
  const originalIOR = material.ior;
  const sky = uniform(new THREE.Color(0x8bc4e1));
  const cameraHeight = uniform(5);
  const waterHeight = uniform(field.source.waterY ?? 0);
  const normal = geometry.normalNode.normalize();
  const view = cameraPosition.sub(positionWorld).normalize();
  const facing = clamp(abs(dot(normal, view)), 0, 1);
  const r0 = float(Math.pow((WATER_IOR - 1) / (WATER_IOR + 1), 2));
  const reflectance = r0.add(float(1).sub(r0).mul(pow(float(1).sub(facing), float(5))));
  const underwater = float(1).sub(
    clamp(cameraHeight.sub(waterHeight).mul(4).add(0.5), 0, 1));
  // Soft above-water sky tint, and milder underwater response. A genuine
  // scene reflection/refraction capture will replace the tint in a later step.
  const reflectionAmount = mix(reflectance.mul(0.65), reflectance.mul(0.28), underwater);
  const opticalColor = mix(originalColor, sky, reflectionAmount);
  let active = false;
  return {
    field, material, reflectance, normalNode: geometry.normalNode,
    get active() { return active; },
    apply() {
      if (active) return;
      material.colorNode = opticalColor;
      material.ior = WATER_IOR;
      material.needsUpdate = true;
      active = true;
    },
    update({ cameraY, skyColor, waterY } = {}) {
      if (Number.isFinite(cameraY)) cameraHeight.value = cameraY;
      if (Number.isFinite(waterY)) waterHeight.value = waterY;
      if (skyColor?.isColor) sky.value.copy(skyColor);
    },
    restore() {
      if (!active) return;
      material.colorNode = originalColor;
      material.roughnessNode = originalRoughness ?? null;
      material.ior = originalIOR;
      material.needsUpdate = true;
      active = false;
    },
    dispose() { this.restore(); },
  };
}
