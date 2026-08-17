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
    // Bloom + anti-aliasing (main.js composer pipeline) — split from the
    // single bundled postFxEnabled per explicit "individually" follow-up.
    // Both bloomLevel='off'/aaMethod='off' for the same "maximum
    // performance" reasoning as everything else in this tier — each is a
    // real extra full-screen pass. toneMapping is a color-response
    // setting applied to the existing render, not an extra pass — no
    // meaningful cost difference between curves, so it stays on 'aces'
    // even on Low rather than being tied to the performance tier at all.
    bloomLevel: "off",
    aaMethod: "off",
    toneMapping: "aces",
    // Real per-pixel raymarched volumetric clouds (volumetricClouds.js) —
    // a genuine multi-step (24-40 iteration) loop run for every sky-facing
    // pixel, on top of everything else already in this post-processing
    // chain (the lens-rain shader). Off by default on Low, same
    // reasoning/category as shadowsEnabled/ssaoEnabled just above — this
    // is squarely a "real extra cost, not free" feature.
    volumetricCloudsEnabled: false,
  },
  medium: {
    label: "Medium",
    terrainSegments: 300,      // left as-is — this is vertex/geometry cost (paid once per frame regardless of screen resolution), not the fill-rate cost this rebalance targets, and the sand-ripple smoothness reasoning below is still valid; boosted from 190 per explicit request — also now genuinely useful rather than just cosmetic headroom, since the new sand ripple vertex displacement (main.js) needs real segment density to resolve smoothly rather than looking faceted/jagged (a ~2.6-unit ripple wavelength needs more than ~1 segment per unit to read as a smooth wave, not a stepped one)
    // Per "Medium caps at 10fps, make it better AND playable" — pulled
    // back from 90 to 65. This exact boost (55->90) was already flagged
    // in this file's own prior comment as an untested, compounding risk
    // stacked on top of much heavier per-vertex wave math (10 Gerstner
    // components + domain warp) AND three full scene renders/frame
    // (main+reflection+refraction) — that risk is now confirmed real.
    // 65 keeps meaningfully more wave detail than the original 55
    // baseline while cutting roughly 48% of the vertex/wave-math cost
    // versus 90 (segment count scales the grid on both axes, so cost
    // scales with segments^2: 65^2/90^2 β‰ˆ 0.52).
    liquidSegments: 65,
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
    // Trimmed 1536->1280 — shadow-map cost scales with texel area
    // (1280^2/1536^2 β‰ˆ 0.69, a real ~31% reduction in that pass's
    // bandwidth/fill cost), while 1280 is still well above Low's 256 and
    // shadows stay ON (per "still have all effects" philosophy) — this
    // is a resolution trim, not a feature cut.
    shadowMapSize: 1280,
    // The single biggest lever in this rebalance: pixelRatioCap directly
    // multiplies EVERY per-pixel cost this scene has (SSAO's full-screen
    // pass, the water's caustic/foam/sun-glitter fragment shader, the new
    // seafloor caustics, reflection/refraction sampling, general
    // shading) — fragment/fill-rate cost scales with pixelRatio^2, so
    // dropping 1.75->1.3 cuts that entire category of cost by roughly
    // (1.3/1.75)^2 β‰ˆ 45%. This is very likely why Medium was hitting
    // 10fps specifically — this scene is heavily fragment-shader-bound
    // (multiple full-screen and per-object custom shaders stacked), and
    // pixelRatioCap is the one setting that scales literally all of them
    // at once. 1.3 still renders sharper than native 1x on most phone
    // screens (device pixel ratios of 2-3 are typical), just not at the
    // near-full-native 1.75 this was set to before.
    pixelRatioCap: 1.3,
    // 2->3 — reflection+refraction are each a FULL extra scene render
    // (see Low tier's own comment above); at interval=2 Medium was
    // averaging 1 extra full scene render every frame (2 renders / 2
    // frames), same amortized cost as if it had NO throttle on a
    // half-complexity scene. interval=3 drops that average to 2/3 of a
    // render per frame, a real ~33% cut to this specific cost, and still
    // updates twice as often as Low's interval=4 — this keeps the
    // "efficiency lever, not a feature cut" philosophy the rest of this
    // tier already follows (reflection/refraction stay fully present,
    // just refreshed slightly less often — genuinely hard to notice on
    // gently rolling water, unlike dropping the effect entirely would be).
    reflectionUpdateInterval: 3,
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
    bloomLevel: "moderate",
    aaMethod: "smaa",
    toneMapping: "aces",
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
    bloomLevel: "strong",
    aaMethod: "smaa",
    toneMapping: "aces",
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

// Per-effect overrides, per explicit "toggle buttons to tune each effect
// on and off and adjust display resolution" request — a tier still picks
// the BASELINE for every setting, but any of these keys can be
// individually punched through on top of it (e.g. run on "medium" but
// force shadows off, or "high" but cap resolution down). null/undefined
// means "no override, use the tier's own value" — every key defaults to
// that so simply not touching a control changes nothing. Kept as a
// separate object rather than mutating TIERS directly so switching tiers
// doesn't silently clear the person's individual toggles, and so this
// state is easy to reset as a whole (resetOverrides).
const OVERRIDES_STORAGE_KEY = "riftGraphicsOverrides";
// Per "everything off and still 10fps" — grassMultiplier/particleMultiplier/
// cloudMultiplier/wildlifeMultiplier/seaLifeMultiplier were tier-scaled
// (FU233) but never individually overridable at all, unlike shadows/SSAO/
// ocean effects/etc. These are real, substantial per-frame mesh/instance
// counts (220 coral pieces, grass blade counts, particle counts) — with
// every existing toggle off, these five are very likely the actual
// remaining bottleneck, since nothing was previously able to touch them
// short of switching the whole tier.
// lensEffectEnabled added per "the lens FX button says enabled but it's
// off" — the real, confirmed bug: main.js's graphics panel button was
// built to control this key, but the key itself was never added here,
// so setOverride() was silently rejecting every click (its own key
// !== false check at the top returns false immediately for any
// unlisted key) — the button's displayed on/off state was always just
// the unregistered-key default, never actually reflecting or applying
// what the person clicked. Same pattern as causticsEnabled/foamEnabled/
// reflectionEnabled just above — whitelisted here without an explicit
// per-tier value, relying on the same undefined-defaults-to-on
// convention already established for those.
const OVERRIDABLE_KEYS = ["shadowsEnabled", "ssaoEnabled", "oceanEffectsEnabled", "reflectionEnabled", "causticsEnabled", "foamEnabled", "lensEffectEnabled", "volumetricCloudsEnabled", "bloomLevel", "aaMethod", "toneMapping", "pixelRatioCap", "grassMultiplier", "particleMultiplier", "cloudMultiplier", "wildlifeMultiplier", "seaLifeMultiplier"];
let overrides = {};
try {
  const saved = localStorage.getItem(OVERRIDES_STORAGE_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    // Only keep known keys — guards against a stale/corrupt saved blob
    // (an old version of this file, manual localStorage editing, etc.)
    // silently injecting an unexpected property downstream code doesn't
    // check for.
    for (const key of OVERRIDABLE_KEYS) if (key in parsed) overrides[key] = parsed[key];
  }
} catch (_) { /* localStorage unavailable or corrupt — no overrides stands */ }

function persistOverrides() {
  try { localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(overrides)); } catch (_) { /* best effort */ }
}

function getGraphicsSettings() {
  // Merge tier defaults with any active overrides — every existing call
  // site in the project (main.js, liquid.js, etc.) already reads settings
  // exclusively through this one function, so this merge is the ONLY
  // change needed for individual toggles to actually take effect
  // everywhere; nothing downstream needs to know overrides exist at all.
  return { ...TIERS[currentTier], ...overrides };
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

// Reads back the value actually in effect for one key right now (tier
// default, or the override if one is set) — lets UI code show correct
// on/off state without duplicating the merge logic itself.
function getEffectiveValue(key) {
  return key in overrides ? overrides[key] : TIERS[currentTier][key];
}

// value === null clears that specific override (falls back to the
// tier's own value again) rather than storing null as if it were a real
// setting — getGraphicsSettings's spread would otherwise happily merge
// in a literal null and break whatever reads that key expecting a
// boolean/number.
function setOverride(key, value) {
  if (!OVERRIDABLE_KEYS.includes(key)) return false;
  if (value === null) delete overrides[key];
  else overrides[key] = value;
  persistOverrides();
  return true;
}

function resetOverrides() {
  overrides = {};
  try { localStorage.removeItem(OVERRIDES_STORAGE_KEY); } catch (_) { /* best effort */ }
}

// Read-only lookup of a NAMED tier's raw values, regardless of which tier
// is currently active — lets UI code (the new Density dropdown) build its
// preset options from this project's real per-tier numbers instead of
// duplicating them as separate hardcoded constants that could drift out
// of sync with the tier objects above.
function getTierRawSettings(tierId) {
  return TIERS[tierId];
}

export { getGraphicsSettings, getGraphicsTier, setGraphicsTier, listGraphicsTiers, getEffectiveValue, setOverride, resetOverrides, getTierRawSettings };
