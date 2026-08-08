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
    terrainSegments: 40,       // pushed down — bare minimum, genuinely fast on weak devices
    liquidSegments: 10,
    skyDomeSegments: [28, 14], // was [12, 6] — visibly faceted (flat polygon "corners" showing through the gradient) at that resolution. The sky dome is a single unlit BackSide MeshBasicMaterial sphere with no lighting/shadow cost, so this is essentially free even on Low — nothing like terrain/liquid segment counts, which actually cost real per-frame work.
    grassBladeSegments: 3,     // radial segments per blade — 3 is the coarsest a cone can be, already floor
    decorationDetail: 0,       // subdivision level passed to IcosahedronGeometry/OctahedronGeometry — 0 is their coarsest form, already floor
    grassMultiplier: 0.12,
    particleMultiplier: 0.2,
    cloudMultiplier: 0.3,
    wildlifeMultiplier: 0.25,
    auroraStrips: 2,
    sunBeams: 2,
    shootingStarPoolSize: 1,
    silhouetteMultiplier: 0.4,
    shadowsEnabled: false,
    shadowMapSize: 256,
    pixelRatioCap: 1,
    // Real contact-shadow ambient occlusion (main.js's SSAOPass) — a
    // genuine extra render pass every frame (scene depth+normals, then
    // AO blur/compose), same category of cost this project already
    // fought hard to control in the reflection/refraction throttling
    // work (see medium's own liquidSegments comment below). Off entirely
    // on Low, same split as shadowsEnabled.
    ssaoEnabled: false,
    // Coral Shallows' water reflection/refraction (main.js) are each a
    // FULL extra scene render (terrain, decorations, wildlife — the
    // reduced render-TARGET resolution only saves fragment/pixel cost,
    // not the vertex/geometry throughput of rendering the whole scene a
    // second and third time) — previously fired every single frame
    // completely independent of graphics tier, the single largest
    // unmitigated cost in the whole project by the time this was added.
    // This value: only actually re-render reflection/refraction every
    // Nth frame, reusing the previous frame's texture in between — a
    // reflection genuinely doesn't need to update at full framerate to
    // look right, and Low tier (the weakest devices) gets the most
    // relief here since it needs it most.
    reflectionUpdateInterval: 4, // was 3 — pushed further per explicit "optimize low for maximum performance"; reflection/refraction remain the single largest unmitigated per-frame cost (two full extra scene renders), so this tier should lean hardest on not refreshing them every frame
    // Per explicit "optimize low for maximum performance" — two things
    // added this session that were never actually tier-gated until now:
    // (1) seaLifeMultiplier scales coral/fish counts (main.js) — 220
    // coral pieces + 16 fish is a real, substantial addition of live
    // meshes to the scene that Low was silently paying full price for.
    // (2) oceanEffectsEnabled skips the water's entire caustic/foam/
    // sun-glitter onBeforeCompile shader pass (liquid.js) — a genuinely
    // plain, fast material on Low instead of a heavily customized
    // per-pixel fragment shader, rather than just tuning that shader's
    // own intensity down.
    seaLifeMultiplier: 0.3,
    oceanEffectsEnabled: false,
  },
  medium: {
    label: "Medium",
    terrainSegments: 300,      // boosted from 190 per explicit request — also now genuinely useful rather than just cosmetic headroom, since the new sand ripple vertex displacement (main.js) needs real segment density to resolve smoothly rather than looking faceted/jagged (a ~2.6-unit ripple wavelength needs more than ~1 segment per unit to read as a smooth wave, not a stepped one)
    liquidSegments: 90,        // boosted from 55 per explicit request to test whether mesh resolution was capping how visible the wave/domain-warp detail could read — real cost warning: combined with the now much heavier per-vertex wave math (10 Gerstner components + domain warp, up from 4 plain terms) AND three full scene renders per frame (main + reflection + refraction) already added this session, this is a genuinely compounding performance change, not an isolated one. Watch the FPS counter.
    skyDomeSegments: [32, 16],
    grassBladeSegments: 4,
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
    reflectionUpdateInterval: 2,
    ssaoEnabled: true,
    // Per explicit "optimize medium for most efficiency while providing
    // ALL effects" — oceanEffectsEnabled stays true (the water's real
    // caustic/foam/sun-glitter shader work, same as before) since
    // dropping it would violate "all effects." seaLifeMultiplier is the
    // efficiency lever instead: a moderately-scaled reef (still visually
    // rich, not the full High-tier density) rather than paying for 220
    // individual coral meshes at the same tier that's supposed to be the
    // efficient middle ground.
    seaLifeMultiplier: 0.75,
    oceanEffectsEnabled: true,
  },
  high: {
    label: "High",
    terrainSegments: 600,      // pushed to the highest practical detail — the real ceiling this tier is meant to represent, not just "a bit more than Medium"
    liquidSegments: 260,       // was 200 — pushed further per explicit "optimize high for best fidelity, highest detail" (the water's per-vertex wave math is the main thing segment count actually improves the look of)
    skyDomeSegments: [64, 32],
    grassBladeSegments: 7,
    decorationDetail: 3,       // linear growth in practice (decorations.js uses it as sphereSeg=6+detail*4, capSeg=8+detail*4, and a >=2 threshold — not a direct exponential Icosahedron/Octahedron subdivision parameter, since rocks/crystals are hardcoded to stay at 0 regardless of this value per the art-style rule above)
    grassMultiplier: 2.2,
    particleMultiplier: 2,
    cloudMultiplier: 1.8,
    wildlifeMultiplier: 1.8,
    auroraStrips: 22,
    sunBeams: 12,
    shootingStarPoolSize: 7,
    silhouetteMultiplier: 2,
    shadowsEnabled: true,
    shadowMapSize: 2048, // was 4096 — that's 4x the GPU fill/bandwidth cost of 2048 for a resolution difference very unlikely to be visible on an actual mobile screen; the extra detail was mostly wasted
    pixelRatioCap: 3,
    reflectionUpdateInterval: 1, // no throttle — High is the quality-focused tier, update every frame
    ssaoEnabled: true,
    // Per explicit "optimize high for best fidelity, highest detail" —
    // above the current baseline (1.0), not just matching it, since this
    // tier is meant to be the genuine ceiling. oceanEffectsEnabled stays
    // true (same reasoning as Medium — this tier should have every
    // effect at its best, not fewer).
    seaLifeMultiplier: 1.3,
    oceanEffectsEnabled: true,
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
