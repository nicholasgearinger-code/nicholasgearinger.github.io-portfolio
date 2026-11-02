// Shared optical parameters for above- and below-water materials.
export const WATER_IOR = 1.333;
export function fresnelSchlick(cosTheta, ior = WATER_IOR) {
  const c = Math.max(0, Math.min(1, cosTheta));
  const r0 = Math.pow((ior - 1) / (ior + 1), 2);
  return r0 + (1 - r0) * Math.pow(1 - c, 5);
}
export function createOpticsAdapter({ field, material }) {
  if (!field?.source || !material) throw new TypeError("wave field and material required");
  return { field, material, update() {}, dispose() {} };
}
