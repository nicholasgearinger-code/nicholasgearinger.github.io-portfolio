// -----------------------------------------------------------------------------
// SWAP POINT: graphics quality tiers. Every module that has a
// count/resolution/detail knob (terrain segments, grass count, particle
// counts, shadow map size, decoration geometry detail, etc.) reads its
// value from here directly rather than hardcoding a number — this is the
// single place that changes when a tier is picked, not a parameter that
// has to be threaded through every function call. "medium" is roughly
// where the game already sat before this system existed; "high" pushes
// genuinely past that (more polygons/detail, not just the same look at a
// higher cap) and "low" scales hard down for weak devices.
// -----------------------------------------------------------------------------

const STORAGE_KEY = "riftGraphicsSettings";

const TIERS = {
  low: {
    label: "Low",
    terrainSegments: 70,
    decorationDetail: 0,       // subdivision level passed to IcosahedronGeometry/OctahedronGeometry — 0 is their coarsest form
    grassMultiplier: 0.22,
    particleMultiplier: 0.35,
    cloudMultiplier: 0.5,
    wildlifeMultiplier: 0.4,
    auroraStrips: 4,
    sunBeams: 3,
    shootingStarPoolSize: 1,
    silhouetteMultiplier: 0.6,
    shadowsEnabled: false,
    shadowMapSize: 512,
    pixelRatioCap: 1,
  },
  medium: {
    label: "Medium",
    terrainSegments: 140,
    decorationDetail: 0,
    grassMultiplier: 1,
    particleMultiplier: 1,
    cloudMultiplier: 1,
    wildlifeMultiplier: 1,
    auroraStrips: 10,
    sunBeams: 6,
    shootingStarPoolSize: 3,
    silhouetteMultiplier: 1,
    shadowsEnabled: true,
    shadowMapSize: 1536,
    pixelRatioCap: 1.75,
  },
  high: {
    label: "High",
    terrainSegments: 220,
    decorationDetail: 1,       // real jump: roughly 4x the triangles per shape at detail=1 vs detail=0
    grassMultiplier: 1.6,
    particleMultiplier: 1.5,
    cloudMultiplier: 1.4,
    wildlifeMultiplier: 1.4,
    auroraStrips: 16,
    sunBeams: 9,
    shootingStarPoolSize: 5,
    silhouetteMultiplier: 1.5,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    pixelRatioCap: 2,
  },
};

let currentTier = "medium";
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && TIERS[saved]) currentTier = saved;
} catch (_) { /* localStorage unavailable — default tier stands */ }

function getGraphicsSettings() {
  return TIERS[currentTier];
}

function getGraphicsTier() {
  return currentTier;
}

function setGraphicsTier(tier) {
  if (!TIERS[tier] || tier === currentTier) return false;
  currentTier = tier;
  try { localStorage.setItem(STORAGE_KEY, tier); } catch (_) { /* best effort */ }
  return true;
}

function listGraphicsTiers() {
  return Object.keys(TIERS).map((id) => ({ id, label: TIERS[id].label }));
}

export { getGraphicsSettings, getGraphicsTier, setGraphicsTier, listGraphicsTiers };
