// Caustics must sample wave curvature from the shared field.
export function createCausticsAdapter({ field, terrainMaterial }) {
  if (!field?.source) throw new TypeError("wave field required");
  return { field, terrainMaterial: terrainMaterial ?? null, update() {}, dispose() {} };
}
