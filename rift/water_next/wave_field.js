// Shared wave-field contract for the next-generation Rift water renderer.
// A field is a read-only view over one authoritative simulation, not a second solver.
export function createWaveField(source) {
  if (!source || typeof source !== "object") throw new TypeError("wave source required");
  return Object.freeze({
    source,
    get displacement() { return source.displacement ?? null; },
    get normal() { return source.normal ?? null; },
    get curvature() { return source.curvature ?? null; },
    get velocity() { return source.velocity ?? null; },
    get foam() { return source.foam ?? null; },
    get time() { return source.time ?? 0; },
  });
}
export function validateWaveField(field) {
  return Boolean(field && field.source && Number.isFinite(field.time));
}
