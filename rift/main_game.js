// Rift storm rain/lens tuning loader.
//
// The full game source is preserved byte-for-byte in main_game_rain_base.js.
// This loader applies only narrowly-scoped presentation tuning at startup so
// the large, stable runtime does not need to be manually rewritten.

const baseModuleUrl = new URL("./main_game_rain_base.js", import.meta.url);
const moduleBaseUrl = new URL("./", import.meta.url);

function replaceExactlyOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`[rift-rain-tune] Missing source fragment: ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`[rift-rain-tune] Source fragment is not unique: ${label}`);
  }
  return source.slice(0, first) + to + source.slice(first + from.length);
}

const response = await fetch(baseModuleUrl, { cache: "reload" });
if (!response.ok) throw new Error(`[rift-rain-tune] Failed to load base game: HTTP ${response.status}`);
let source = await response.text();

const edits = [
  ["const RAIN_PARTICLE_COUNT = Math.round(3000 * getGraphicsSettings().particleMultiplier);", "const RAIN_PARTICLE_COUNT = Math.min(9000, Math.round(5200 * getGraphicsSettings().particleMultiplier));", "rain particle count"],
  ["const RAIN_RADIUS = 55;", "const RAIN_RADIUS = 42;", "rain radius"],
  ["const RAIN_FALL_SPEED = 22;", "const RAIN_FALL_SPEED = 28;", "rain fall speed"],
  ["material.scaleNode = vec2(0.025, 0.55);", "material.scaleNode = vec2(0.018, 0.46);", "rain streak size"],
  ["handle.rainOpacity.value = isUnderwater ? 0 : clampNum(rainIntensity, 0, 1) * 0.6;", "handle.rainOpacity.value = isUnderwater ? 0 : clampNum(rainIntensity, 0, 1) * 0.46;", "rain streak opacity"],
  ["const ROWS_PER_LANE = 4;", "const ROWS_PER_LANE = 3;", "lens row density"],
  ["const coverageThreshold = mix(float(0.95), float(0.05), lensIntensityUniform);", "const coverageThreshold = mix(float(0.98), float(0.36), lensIntensityUniform);", "lens coverage"],
  ["const dropletPresent = smoothstep(coverageThreshold, coverageThreshold.add(0.02), hash(seed.add(71.0)));", "const dropletPresent = smoothstep(coverageThreshold, coverageThreshold.add(0.035), hash(seed.add(71.0)));", "lens coverage edge"],
  ["const dropletRadius = mix(float(0.09), float(0.48), pow(sizeRand, float(1.5)));", "const dropletRadius = mix(float(0.055), float(0.28), pow(sizeRand, float(1.65)));", "lens droplet radius"],
  ["const wiggleAmount = mix(float(0.06), float(0.16), hash(seed.add(151.0))).mul(dropletRadius.div(0.22));", "const wiggleAmount = mix(float(0.045), float(0.10), hash(seed.add(151.0))).mul(dropletRadius.div(0.17));", "lens path wobble"],
  ["const sizeFactor = dropletRadius.div(0.22);", "const sizeFactor = dropletRadius.div(0.17);", "lens size factor"],
  ["const distortAmount = inDroplet.mul(dropletPresent).mul(0.06).mul(sizeFactor).mul(lensIntensityUniform);", "const distortAmount = inDroplet.mul(dropletPresent).mul(0.024).mul(sizeFactor).mul(lensIntensityUniform);", "lens refraction"],
  ["const trailWidthNear = dropletRadius.mul(0.8);", "const trailWidthNear = dropletRadius.mul(0.58);", "lens near trail width"],
  ["const trailWidthFar = dropletRadius.mul(0.22);", "const trailWidthFar = dropletRadius.mul(0.13);", "lens far trail width"],
  ["const trailWidth = trailWidthTapered.mul(mix(float(0.65), float(1.35), bulgeNoise));", "const trailWidth = trailWidthTapered.mul(mix(float(0.75), float(1.18), bulgeNoise));", "lens trail bulge"],
  ["const trailDistort = trailMask.mul(0.015).mul(sizeFactor).mul(lensIntensityUniform);", "const trailDistort = trailMask.mul(0.006).mul(sizeFactor).mul(lensIntensityUniform);", "lens trail refraction"],
  ["const lit = mix(float(0.3), one, sunProximity);", "const lit = mix(float(0.16), one, sunProximity);", "lens ambient reflection"],
  ["const fresnelRim = smoothstep(float(0.7), float(1.0), rimT).mul(gated).mul(0.16).mul(lit);", "const fresnelRim = smoothstep(float(0.7), float(1.0), rimT).mul(gated).mul(0.085).mul(lit);", "lens fresnel rim"],
  ["const sunLitGlow = sunProximity.mul(gated).mul(0.35);", "const sunLitGlow = sunProximity.mul(gated).mul(0.14);", "lens sun glow"],
  ["lightBoost = lightBoost.add(highlight.mul(0.22)).add(fresnelRim).add(sunLitGlow).add(trailMask.mul(0.06).mul(one.add(sunProximity.mul(0.8))));", "lightBoost = lightBoost.add(highlight.mul(0.12)).add(fresnelRim).add(sunLitGlow).add(trailMask.mul(0.025).mul(one.add(sunProximity.mul(0.8))));", "lens total light boost"],
  ["const finalColor = sceneColor.rgb.add(vec3(lightBoost.mul(lensIntensityUniform))).add(sunGlintColor.mul(0.9).mul(lensIntensityUniform));", "const finalColor = sceneColor.rgb.add(vec3(lightBoost.mul(lensIntensityUniform))).add(sunGlintColor.mul(0.35).mul(lensIntensityUniform));", "lens glint strength"],
  ["weatherHandle.rainIntensity = Math.min(1, weatherHandle.rainIntensity + dt * 2);", "weatherHandle.rainIntensity = Math.min(1, weatherHandle.rainIntensity + dt * 0.2);", "forced storm ramp"],
  ["lensRainWetness = Math.min(rainTarget, lensRainWetness + dt / 3);", "lensRainWetness = Math.min(rainTarget, lensRainWetness + dt / 14);", "lens wet-up"],
  ["lensRainWetness = Math.max(rainTarget, lensRainWetness - dt / 35);", "lensRainWetness = Math.max(rainTarget, lensRainWetness - dt / 40);", "lens dry-down"],
];

for (const [from, to, label] of edits) source = replaceExactlyOnce(source, from, to, label);

source = source.replace(/(\bfrom\s*)(["'])(\.{1,2}\/[^"']+)\2/g, (_, prefix, quote, specifier) => `${prefix}${quote}${new URL(specifier, moduleBaseUrl).href}${quote}`);
source = source.replace(/(\bimport\s*)(["'])(\.{1,2}\/[^"']+)\2/g, (_, prefix, quote, specifier) => `${prefix}${quote}${new URL(specifier, moduleBaseUrl).href}${quote}`);
source = source.replaceAll("import.meta.url", JSON.stringify(moduleBaseUrl.href));
source += "\n//# sourceURL=rift/main_game_rain_tuned.runtime.js\n";

const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
