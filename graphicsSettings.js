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
//
// IMPORTANT ART-STYLE RULE: decorationDetail (subdivision level for
// Icosahedron/Octahedron geometry) applies to organic shapes — tree
// foliage, flowers — where rounding out with more polygons genuinely
// looks better. Rocks and crystals are deliberately excluded from this in
// decorations.js and stay at their sharpest/blockiest form (detail=0) at
// every tier, on purpose — smoothing a rock or crystal fights the
// established low-poly art style and wastes polygon budget on something
// that looks worse rounded, not better. If a future decoration is
// mineral/rock in nature, keep its detail fixed at 0 regardless of tier.
// -----------------------------------------------------------------------------

const STORAGE_KEY = "riftGraphicsSettings";

const TIERS = {
  low: {
    label: "Low",
    terrainSegments: 50,
    liquidSegments: 14,        // lava/water plane subdivision — was hardcoded at 40 regardless of tier before this
    skyDomeSegments: [16, 8],  // [widthSegments, heightSegments]
    grassBladeSegments: 3,     // radial segments per blade — 3 is the coarsest a cone can be
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
    liquidSegments: 40,
    skyDomeSegments: [32, 16],
    grassBladeSegments: 3,
    decorationDetail: 1,
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
    terrainSegments: 320,      // pushed further than before — rocks/crystals no longer burn budget on unnecessary smoothing (see decorations.js), so the ground itself gets more of it
    liquidSegments: 110,
    skyDomeSegments: [48, 24],
    grassBladeSegments: 5,
    decorationDetail: 2,       // real jump: roughly 4x the triangles per shape per +1 step on Icosahedron/Octahedron, so 2 vs 0 is a dramatic difference, not a subtle one
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

// No saved preference yet means this is a first visit — default touch
// devices to "low" instead of "medium" (a phone's GPU generally can't
// absorb Medium's shadow pass painlessly the way a laptop/desktop can),
// so the out-of-box experience on mobile is actually smooth rather than
// technically-available-but-choppy. Anyone can still bump it up via the
// settings panel; this only decides the untouched default.
function detectDefaultTier() {
  const isTouch = typeof window !== "undefined" && ("ontouchstart" in window || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0));
  return isTouch ? "low" : "medium";
}

let currentTier = detectDefaultTier();
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && TIERS[saved]) currentTier = saved;
} catch (_) { /* localStorage unavailable — detected default stands */ }

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
