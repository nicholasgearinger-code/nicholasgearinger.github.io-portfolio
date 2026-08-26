// Model 4.1 review loader hotfix / godray visibility tuning.
//
// The pinned Model 4 runtime remains the tested integration point. This wrapper
// fixes the ordered-loader issues discovered on iPhone, then retunes the existing
// r185 GodraysNode + cloud-alpha radial path so cloud openings can produce visible
// crepuscular shafts instead of only acting as a weak mask on terrain godrays.

const moduleUrl = import.meta.url;
const pinnedLoaderUrl =
  "https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/fb9f117130e09650a3330baa0a0c4123ebe1b7dd/rift/main_game.js";

const response = await fetch(pinnedLoaderUrl, { cache: "no-store" });
if (!response.ok) {
  throw new Error(`[rift-model41-hotfix] Failed to load pinned Model 4 runtime loader: HTTP ${response.status}`);
}

let source = await response.text();

function replaceExactly(sourceText, from, to, label, expectedCount = 1) {
  const count = sourceText.split(from).length - 1;
  if (count !== expectedCount) {
    throw new Error(`[rift-model41-hotfix] Expected ${expectedCount} ${label} fragment(s), found ${count}`);
  }
  return sourceText.split(from).join(to);
}

function replaceFirst(sourceText, from, to, label) {
  const index = sourceText.indexOf(from);
  if (index < 0) {
    throw new Error(`[rift-model41-hotfix] Missing ${label} fragment`);
  }
  return sourceText.slice(0, index) + to + sourceText.slice(index + from.length);
}

// The rain/underwater layer lowers the lens glint before the later godray edit.
source = replaceExactly(
  source,
  "sunGlintColor.mul(0.9).mul(lensIntensityUniform)",
  "sunGlintColor.mul(0.35).mul(lensIntensityUniform)",
  "Model 3.5b lens/glint godray",
  2,
);

// GodraysNode must receive the real DirectionalLight before the TSL graph is
// constructed. The stable game configures this light later, so instantiate the
// same object early and remove only the later duplicate declaration.
const godraySetupEditTail = `    "r185 Water Pro WebGPU SSR + Model 3.5b godrays setup",
  ],`;
source = replaceFirst(
  source,
  godraySetupEditTail,
  `${godraySetupEditTail}
  [
    "const postProcessing = new THREE.RenderPipeline(renderer);",
    "const sun = new THREE.DirectionalLight(0xffffff, 1.1 /* Model 4.1 early sun for GodraysNode */);\\nconst postProcessing = new THREE.RenderPipeline(renderer);",
    "Model 4.1 preinitialize sun before godray graph",
  ],
  [
    "const sun = new THREE.DirectionalLight(0xffffff, 1.1);",
    "// Model 4.1: sun already instantiated before post-processing; configure the same light below.",
    "Model 4.1 remove duplicate late sun declaration",
  ],`,
  "godray sun initialization ordering edits",
);

// ---------------------------------------------------------------------------
// Model 4.1 godray visibility pass.
// Mobile remains low resolution, but the previous 14-step / 0.28-scale path was
// too faint to survive the phone's final composite. A small quality increase and
// lower attenuation make the shafts readable without turning this into a costly
// full-resolution volumetric pass.
// ---------------------------------------------------------------------------
source = replaceFirst(
  source,
  `riftGodraysPass.raymarchSteps.value = isTouchDevice ? 14 : (riftSSRTier === "high" ? 44 : 30);`,
  `riftGodraysPass.raymarchSteps.value = isTouchDevice ? 18 : (riftSSRTier === "high" ? 48 : 34);`,
  "mobile godray raymarch steps",
);
source = replaceFirst(
  source,
  `riftGodraysPass.resolutionScale = isTouchDevice ? 0.28 : (riftSSRTier === "high" ? 0.50 : 0.40);`,
  `riftGodraysPass.resolutionScale = isTouchDevice ? 0.33 : (riftSSRTier === "high" ? 0.54 : 0.44);`,
  "godray resolution scale",
);
source = replaceFirst(
  source,
  `riftGodraysPass.density.value = 0.16;`,
  `riftGodraysPass.density.value = 0.235;`,
  "godray base density",
);
source = replaceFirst(
  source,
  `riftGodraysPass.maxDensity.value = isTouchDevice ? 0.30 : 0.44;`,
  `riftGodraysPass.maxDensity.value = isTouchDevice ? 0.46 : 0.58;`,
  "godray max density",
);
source = replaceFirst(
  source,
  `riftGodraysPass.distanceAttenuation.value = 2.0;`,
  `riftGodraysPass.distanceAttenuation.value = 1.28;`,
  "godray distance attenuation",
);
source = replaceFirst(
  source,
  `const riftCloudShaftSamples = isTouchDevice ? 3 : 5;`,
  `const riftCloudShaftSamples = isTouchDevice ? 4 : 6;`,
  "cloud shaft sample count",
);

// In 3.5b the cloud mask was essentially clear-path transmission, so a full
// cloud sheet or a full clear sky both lacked the strong *transition* needed to
// form recognizable rays. Favor mixed clear/opaque paths: that is where real
// crepuscular shafts appear around cloud gaps.
source = replaceFirst(
  source,
  `  const pathTransmission = pathClear.div(float(riftCloudShaftSamples));
  const sunReach = float(1).sub(smoothstep(float(0.16), float(1.05), rayLength));
  return localClear
    .mul(pathTransmission)
    .mul(float(0.42).add(sunReach.mul(float(0.58))));`,
  `  const pathTransmission = pathClear.div(float(riftCloudShaftSamples));
  const mixedPath = smoothstep(float(0.06), float(0.48), pathTransmission)
    .mul(float(1).sub(smoothstep(float(0.62), float(0.98), pathTransmission)));
  const sunReach = float(1).sub(smoothstep(float(0.14), float(1.08), rayLength));
  return localClear
    .mul(float(0.08).add(mixedPath.mul(float(0.92))))
    .mul(float(0.34).add(sunReach.mul(float(0.66))));`,
  "cloud shaft mixed-transmission mask",
);

// Add a restrained cloud-only radial scattering term. The native GodraysNode
// still contributes physical scene-shadow shafts, while this term supplies the
// missing ray energy from the actual current-frame cloud transmittance field.
source = replaceFirst(
  source,
  `  const riftRayEnergy = riftRaySample
    .mul(riftGodrayStrength)
    .mul(riftCloudShaftMask(distortedUV));
  const riftGodrayAdd = riftGodrayColor.mul(riftRayEnergy);`,
  `  const riftCloudRayMask = riftCloudShaftMask(distortedUV);
  const riftNativeRayEnergy = riftRaySample
    .mul(riftGodrayStrength)
    .mul(riftCloudRayMask);
  const riftCloudOnlyRayEnergy = riftCloudRayMask
    .mul(riftGodrayStrength)
    .mul(float(0.26));
  const riftRayEnergy = riftNativeRayEnergy.add(riftCloudOnlyRayEnergy);
  const riftGodrayAdd = riftGodrayColor.mul(riftRayEnergy);`,
  "lens cloud-generated ray energy",
);
source = replaceFirst(
  source,
  `  const rayEnergy = raySample
    .mul(riftGodrayStrength)
    .mul(riftCloudShaftMask(screenUV));
  return vec4(baseColor.rgb.add(riftGodrayColor.mul(rayEnergy)), baseColor.a);`,
  `  const cloudRayMask = riftCloudShaftMask(screenUV);
  const nativeRayEnergy = raySample
    .mul(riftGodrayStrength)
    .mul(cloudRayMask);
  const cloudOnlyRayEnergy = cloudRayMask
    .mul(riftGodrayStrength)
    .mul(float(0.26));
  const rayEnergy = nativeRayEnergy.add(cloudOnlyRayEnergy);
  return vec4(baseColor.rgb.add(riftGodrayColor.mul(rayEnergy)), baseColor.a);`,
  "unlensed cloud-generated ray energy",
);

// Give golden-hour shafts enough exposure to be visible on the current mobile
// tone map. Strength is still driven by daylight, Sun altitude, weather and the
// global broken-cloud transmittance signal.
source = replaceFirst(
  source,
  `    riftGodrayStrength.value = THREE.MathUtils.clamp(
      shaftStrength * (isTouchDevice ? 0.68 : 0.82),
      0,
      0.82
    );`,
  `    riftGodrayStrength.value = THREE.MathUtils.clamp(
      shaftStrength * (isTouchDevice ? 1.12 : 1.02),
      0,
      1.15
    );`,
  "golden-hour godray strength",
);

// A Blob module has a blob: import.meta.url. Re-anchor only the real top-level
// URLs; identical text also exists inside generated edit templates.
source = replaceFirst(
  source,
  `const tunedLoaderUrl = new URL(\n  "./main_game_underwater_base.js",\n  import.meta.url,\n);`,
  `const tunedLoaderUrl = new URL(\n  "./main_game_underwater_base.js",\n  ${JSON.stringify(moduleUrl)},\n);`,
  "tuned loader base URL",
);
source = replaceFirst(
  source,
  `const moduleBaseUrl = new URL("./", import.meta.url);`,
  `const moduleBaseUrl = new URL("./", ${JSON.stringify(moduleUrl)});`,
  "module base URL",
);

source += "\n//# sourceURL=rift/main_game_model41_hotfix.runtime.js\n";

const blob = new Blob([source], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
