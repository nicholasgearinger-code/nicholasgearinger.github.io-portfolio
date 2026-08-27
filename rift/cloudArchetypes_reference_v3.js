import {
  REFERENCE_CLOUD_CHANNELS,
  REFERENCE_CLOUD_ARCHETYPES as V2,
} from "./cloudArchetypes_reference_v2.js";

// Rift Cloud Model 3.3 reference archetypes.
//
// v3 keeps the proven 3.1 macro silhouettes, then bakes extra satellite families,
// secondary broken-cumulus groups, embedded storm towers and flattened horizon
// banks into the SAME four-channel atlas. This creates a multi-scale sky without
// adding another 3D texture lookup to the runtime raymarch.

function freezeLobe(l) {
  return Object.freeze({
    x: l.x,
    y: l.y,
    z: l.z,
    rx: l.rx,
    ry: l.ry,
    rz: l.rz,
    density: l.density,
    power: l.power,
  });
}

function transformLobes(lobes, {
  sx = 1,
  sy = 1,
  sz = 1,
  ox = 0,
  oy = 0,
  oz = 0,
  density = 1,
  powerOffset = 0,
} = {}) {
  return lobes.map((l) => freezeLobe({
    x: 0.5 + (l.x - 0.5) * sx + ox,
    y: Math.max(0.012, l.y * sy + oy),
    z: 0.5 + (l.z - 0.5) * sz + oz,
    rx: l.rx * sx,
    ry: l.ry * sy,
    rz: l.rz * sz,
    density: Math.min(1, (l.density ?? 1) * density),
    power: Math.max(0.7, (l.power ?? 1.65) + powerOffset),
  }));
}

function archetype(base, id, lobes, overrides = {}) {
  return Object.freeze({
    ...base,
    ...overrides,
    id,
    lobes: Object.freeze(lobes),
  });
}

const brokenA = V2.brokenCumulus.lobes.slice(0, 8);
const brokenB = V2.brokenCumulus.lobes.slice(8, 16);
const brokenC = V2.brokenCumulus.lobes.slice(16);
const stormCells = V2.stratiformDeck.lobes.filter((_, i) => i >= 10);
const heroUpper = V2.toweringCumulus.lobes.filter((l, i) => l.y > 0.19 && i % 2 === 0);

export const REFERENCE_CLOUD_ARCHETYPES = Object.freeze({
  toweringCumulus: archetype(
    V2.toweringCumulus,
    "towering-cumulus-reference-v3",
    [
      ...V2.toweringCumulus.lobes.map(freezeLobe),
      // Nearby satellite puffs make a hero cloud read as a family rather than a
      // single isolated blob. They are smaller and less dense than the hero.
      ...transformLobes(brokenA, {
        sx: 0.58, sy: 0.62, sz: 0.58,
        ox: 0.31, oy: 0.010, oz: -0.19,
        density: 0.78, powerOffset: 0.08,
      }),
      ...transformLobes(brokenB, {
        sx: 0.46, sy: 0.52, sz: 0.48,
        ox: -0.34, oy: 0.018, oz: 0.21,
        density: 0.70, powerOffset: 0.12,
      }),
    ],
    { baseSoftness: 0.030 },
  ),

  brokenCumulus: archetype(
    V2.brokenCumulus,
    "broken-cumulus-reference-v3",
    [
      ...V2.brokenCumulus.lobes.map(freezeLobe),
      // Additional offset families fill the mid-distance sky while preserving
      // open blue gaps between clusters.
      ...transformLobes(brokenA, {
        sx: 0.72, sy: 0.78, sz: 0.70,
        ox: 0.28, oy: 0.004, oz: 0.31,
        density: 0.72, powerOffset: 0.10,
      }),
      ...transformLobes(brokenC, {
        sx: 0.64, sy: 0.70, sz: 0.62,
        ox: -0.30, oy: 0.006, oz: -0.27,
        density: 0.68, powerOffset: 0.12,
      }),
    ],
    { baseSoftness: 0.028 },
  ),

  stratiformDeck: archetype(
    V2.stratiformDeck,
    "stratiform-storm-reference-v3",
    [
      ...V2.stratiformDeck.lobes.map(freezeLobe),
      // Embedded cells are deliberately offset and vertically stretched. This
      // breaks the storm wall into a low shelf with readable convection above it.
      ...transformLobes(stormCells, {
        sx: 0.72, sy: 1.08, sz: 0.72,
        ox: 0.24, oy: 0.055, oz: -0.18,
        density: 0.82, powerOffset: 0.06,
      }),
      ...transformLobes(heroUpper.slice(0, 9), {
        sx: 0.44, sy: 0.74, sz: 0.44,
        ox: -0.29, oy: 0.065, oz: 0.23,
        density: 0.58, powerOffset: 0.10,
      }),
    ],
    { baseSoftness: 0.022 },
  ),

  distantCumulus: archetype(
    V2.distantCumulus,
    "distant-cumulus-reference-v3",
    [
      ...V2.distantCumulus.lobes.map(freezeLobe),
      // Flattened copies of broken cumulus become scenic horizon banks. Their
      // low vertical scale keeps them from turning into another giant foreground mass.
      ...transformLobes(brokenA, {
        sx: 1.05, sy: 0.32, sz: 0.72,
        ox: 0.22, oy: -0.010, oz: 0.18,
        density: 0.64, powerOffset: -0.04,
      }),
      ...transformLobes(brokenB, {
        sx: 0.92, sy: 0.28, sz: 0.68,
        ox: -0.24, oy: -0.006, oz: -0.22,
        density: 0.60, powerOffset: -0.02,
      }),
    ],
    { baseSoftness: 0.024 },
  ),
});

export const REFERENCE_CLOUD_PRESETS = Object.freeze({
  // 3.3 lowers hero dominance and increases broken/distant families so the sky
  // reads as a population instead of one enormous repeated cloud.
  clearDay: Object.freeze([0.88, 0.76, 0.00, 0.48]),
  goldenHour: Object.freeze([0.34, 0.74, 0.02, 1.00]),
  moonlit: Object.freeze([0.22, 0.68, 0.10, 0.46]),
  overcast: Object.freeze([0.08, 0.31, 0.90, 0.24]),
  storm: Object.freeze([0.05, 0.20, 1.00, 0.09]),
});

export const REFERENCE_CLOUD_ARCHETYPE_LIST = Object.freeze(
  Object.values(REFERENCE_CLOUD_ARCHETYPES),
);

export { REFERENCE_CLOUD_CHANNELS };
