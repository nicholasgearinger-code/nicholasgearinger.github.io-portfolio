// Shape-first cloud archetypes for Rift Cloud Model 3.
//
// X/Z/Y and radii are normalized to one periodic reference-volume tile. These
// lobes describe MACRO cloud form only. The runtime shader keeps Perlin-Worley
// noise for boundary erosion, boiling detail and lighting variation, so the
// authored silhouette survives instead of being decided by noise.

export const REFERENCE_CLOUD_CHANNELS = Object.freeze({
  toweringCumulus: 0,
  brokenCumulus: 1,
  stratiformDeck: 2,
  distantCumulus: 3,
});

function lobe(x, y, z, rx, ry, rz, density = 1, power = 1.65) {
  return Object.freeze({ x, y, z, rx, ry, rz, density, power });
}

export const REFERENCE_CLOUD_ARCHETYPES = Object.freeze({
  toweringCumulus: Object.freeze({
    id: "towering-cumulus-reference",
    channel: REFERENCE_CLOUD_CHANNELS.toweringCumulus,
    baseFloor: 0.055,
    baseSoftness: 0.045,
    lobes: Object.freeze([
      lobe(0.20, 0.14, 0.30, 0.205, 0.105, 0.175, 0.92, 1.25),
      lobe(0.16, 0.22, 0.31, 0.145, 0.135, 0.125, 0.94, 1.45),
      lobe(0.25, 0.25, 0.29, 0.135, 0.145, 0.120, 0.96, 1.45),
      lobe(0.19, 0.36, 0.31, 0.115, 0.145, 0.105, 0.96, 1.55),
      lobe(0.27, 0.39, 0.29, 0.100, 0.155, 0.095, 0.92, 1.60),
      lobe(0.22, 0.52, 0.30, 0.090, 0.155, 0.085, 0.88, 1.68),
      lobe(0.16, 0.48, 0.32, 0.078, 0.120, 0.075, 0.78, 1.75),
      lobe(0.30, 0.52, 0.28, 0.072, 0.115, 0.070, 0.76, 1.78),
      lobe(0.23, 0.65, 0.30, 0.065, 0.110, 0.060, 0.69, 1.90),
      lobe(0.28, 0.69, 0.29, 0.050, 0.085, 0.050, 0.60, 2.00),
      lobe(0.73, 0.13, 0.72, 0.195, 0.100, 0.165, 0.88, 1.28),
      lobe(0.67, 0.21, 0.71, 0.130, 0.125, 0.115, 0.90, 1.48),
      lobe(0.76, 0.25, 0.73, 0.145, 0.140, 0.120, 0.94, 1.48),
      lobe(0.70, 0.37, 0.72, 0.110, 0.145, 0.100, 0.91, 1.58),
      lobe(0.80, 0.39, 0.73, 0.095, 0.130, 0.090, 0.84, 1.66),
      lobe(0.74, 0.51, 0.71, 0.082, 0.135, 0.078, 0.78, 1.76),
      lobe(0.68, 0.50, 0.74, 0.066, 0.105, 0.064, 0.66, 1.88),
      lobe(0.08, 0.105, 0.31, 0.120, 0.052, 0.135, 0.62, 1.20),
      lobe(0.36, 0.105, 0.29, 0.125, 0.050, 0.130, 0.60, 1.20),
      lobe(0.59, 0.100, 0.72, 0.105, 0.048, 0.120, 0.56, 1.18),
      lobe(0.88, 0.100, 0.72, 0.120, 0.048, 0.125, 0.58, 1.18),
    ]),
  }),

  brokenCumulus: Object.freeze({
    id: "broken-cumulus-reference",
    channel: REFERENCE_CLOUD_CHANNELS.brokenCumulus,
    baseFloor: 0.050,
    baseSoftness: 0.040,
    lobes: Object.freeze([
      lobe(0.10, 0.12, 0.72, 0.115, 0.060, 0.105, 0.84, 1.35),
      lobe(0.08, 0.19, 0.72, 0.070, 0.078, 0.065, 0.78, 1.55),
      lobe(0.15, 0.20, 0.70, 0.075, 0.080, 0.070, 0.80, 1.55),
      lobe(0.39, 0.11, 0.18, 0.125, 0.058, 0.110, 0.84, 1.32),
      lobe(0.35, 0.19, 0.18, 0.075, 0.085, 0.070, 0.80, 1.58),
      lobe(0.43, 0.18, 0.20, 0.080, 0.078, 0.072, 0.76, 1.62),
      lobe(0.53, 0.12, 0.52, 0.105, 0.055, 0.100, 0.82, 1.35),
      lobe(0.51, 0.20, 0.51, 0.067, 0.078, 0.064, 0.76, 1.62),
      lobe(0.58, 0.18, 0.53, 0.070, 0.070, 0.065, 0.72, 1.65),
      lobe(0.82, 0.11, 0.18, 0.130, 0.056, 0.112, 0.86, 1.32),
      lobe(0.78, 0.19, 0.19, 0.074, 0.082, 0.068, 0.80, 1.58),
      lobe(0.86, 0.20, 0.17, 0.070, 0.076, 0.064, 0.76, 1.62),
      lobe(0.89, 0.12, 0.52, 0.095, 0.050, 0.090, 0.74, 1.38),
      lobe(0.92, 0.18, 0.52, 0.055, 0.066, 0.055, 0.66, 1.68),
      lobe(0.26, 0.12, 0.88, 0.090, 0.048, 0.085, 0.70, 1.40),
      lobe(0.28, 0.18, 0.88, 0.055, 0.065, 0.052, 0.64, 1.70),
      lobe(0.64, 0.11, 0.90, 0.105, 0.050, 0.095, 0.76, 1.38),
      lobe(0.62, 0.19, 0.90, 0.062, 0.072, 0.058, 0.68, 1.66),
    ]),
  }),

  stratiformDeck: Object.freeze({
    id: "stratiform-storm-reference",
    channel: REFERENCE_CLOUD_CHANNELS.stratiformDeck,
    baseFloor: 0.028,
    baseSoftness: 0.030,
    lobes: Object.freeze([
      lobe(0.02, 0.12, 0.12, 0.260, 0.075, 0.250, 0.78, 1.16),
      lobe(0.28, 0.13, 0.15, 0.270, 0.082, 0.250, 0.84, 1.16),
      lobe(0.56, 0.12, 0.12, 0.280, 0.080, 0.260, 0.85, 1.16),
      lobe(0.84, 0.13, 0.17, 0.270, 0.085, 0.250, 0.82, 1.16),
      lobe(0.12, 0.13, 0.48, 0.280, 0.080, 0.260, 0.86, 1.15),
      lobe(0.42, 0.14, 0.50, 0.290, 0.090, 0.270, 0.90, 1.14),
      lobe(0.72, 0.13, 0.48, 0.290, 0.086, 0.270, 0.88, 1.15),
      lobe(0.98, 0.13, 0.52, 0.270, 0.082, 0.250, 0.84, 1.16),
      lobe(0.18, 0.13, 0.82, 0.285, 0.083, 0.265, 0.86, 1.15),
      lobe(0.48, 0.14, 0.84, 0.300, 0.090, 0.275, 0.92, 1.14),
      lobe(0.80, 0.13, 0.82, 0.290, 0.085, 0.265, 0.88, 1.15),
      lobe(0.18, 0.27, 0.42, 0.175, 0.125, 0.160, 0.70, 1.45),
      lobe(0.48, 0.31, 0.60, 0.205, 0.165, 0.180, 0.82, 1.42),
      lobe(0.72, 0.26, 0.26, 0.180, 0.130, 0.165, 0.72, 1.46),
      lobe(0.88, 0.34, 0.72, 0.155, 0.180, 0.145, 0.72, 1.50),
    ]),
  }),

  distantCumulus: Object.freeze({
    id: "distant-cumulus-reference",
    channel: REFERENCE_CLOUD_CHANNELS.distantCumulus,
    baseFloor: 0.045,
    baseSoftness: 0.035,
    lobes: Object.freeze([
      lobe(0.04, 0.095, 0.28, 0.070, 0.035, 0.060, 0.72, 1.40),
      lobe(0.05, 0.145, 0.28, 0.042, 0.050, 0.040, 0.64, 1.66),
      lobe(0.18, 0.090, 0.58, 0.080, 0.036, 0.070, 0.74, 1.40),
      lobe(0.20, 0.145, 0.58, 0.046, 0.052, 0.042, 0.66, 1.66),
      lobe(0.31, 0.090, 0.34, 0.068, 0.033, 0.060, 0.68, 1.44),
      lobe(0.45, 0.092, 0.73, 0.075, 0.035, 0.066, 0.72, 1.42),
      lobe(0.47, 0.145, 0.73, 0.044, 0.048, 0.040, 0.62, 1.68),
      lobe(0.58, 0.092, 0.38, 0.080, 0.036, 0.068, 0.72, 1.42),
      lobe(0.72, 0.090, 0.66, 0.070, 0.034, 0.062, 0.70, 1.44),
      lobe(0.75, 0.145, 0.66, 0.043, 0.050, 0.040, 0.62, 1.68),
      lobe(0.84, 0.090, 0.34, 0.075, 0.034, 0.065, 0.70, 1.42),
      lobe(0.96, 0.090, 0.80, 0.070, 0.033, 0.060, 0.68, 1.44),
      lobe(0.12, 0.072, 0.94, 0.150, 0.025, 0.065, 0.50, 1.20),
      lobe(0.42, 0.070, 0.96, 0.170, 0.025, 0.070, 0.52, 1.20),
      lobe(0.72, 0.072, 0.94, 0.155, 0.025, 0.068, 0.50, 1.20),
    ]),
  }),
});

export const REFERENCE_CLOUD_PRESETS = Object.freeze({
  clearDay: Object.freeze([1.00, 0.62, 0.00, 0.64]),
  goldenHour: Object.freeze([0.52, 0.82, 0.03, 0.92]),
  moonlit: Object.freeze([0.34, 0.78, 0.12, 0.48]),
  overcast: Object.freeze([0.12, 0.34, 0.94, 0.18]),
  storm: Object.freeze([0.08, 0.24, 1.00, 0.08]),
});

export const REFERENCE_CLOUD_ARCHETYPE_LIST = Object.freeze(
  Object.values(REFERENCE_CLOUD_ARCHETYPES),
);
