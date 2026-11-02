// Future whitecaps, ambient foam and shoreline wash share one wave source.
export function createFoamAdapter({ field, shoreSolver = null }) {
  if (!field?.source) throw new TypeError("wave field required");
  return { field, shoreSolver, update() {}, dispose() {} };
}
