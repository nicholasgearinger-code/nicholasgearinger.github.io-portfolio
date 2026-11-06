# Rift Islands — Water Pro–style Ocean: Implementation Plan

Status: **design/implementation specification, not a claim that these patches are installed**.  
Target: mobile-first Coral Shallows renderer, particularly iPhone 12 Pro Max.  
Baseline: screenshot observations roughly 11–17 FPS in this game's existing mobile mode.  
Visual reference: Three.js Water Pro demo, specifically sea-surface wave facets, ship/waterline split view, tropical shallows, and breaking surf. This document describes the WATER only; it does not include a ship asset.

## Design decision

The fix is **not another increase in transparency, caustics brightness or screen UV distortion**.

Use the two existing genuine FFT displacement cascades for coherent large and medium 3D waves. Drive ONE unified surface normal from the displaced geometry plus a compact, anti-aliased capillary band. Let that normal consistently drive reflection, refraction, Fresnel, specular highlights, and breaking-crest detection. Keep foam rough and localized. Reuse the existing scene color/depth pipeline; do not add a second camera or render pass on mobile.

Make each stage an independent, reversible commit. Measure after each stage on the actual phone; syntax validation alone does not prove WebGPU compilation or visual correctness.

## Repository architecture confirmed on main

| File | Actual role | Target changes |
| --- | --- | --- |
| rift/liquid.js | Imports the production r185_v22 ocean under the oceanV19 variable; creates/updates FFT water | Integration/feature toggles only, avoid duplicate ocean creation |
| rift/gpu_fft_ocean_r185_v22.js | iOS/WebKit-safe sequential two-cascade FFT submission; tunes existing FFT bands last | Keep compute path stable; change only measured band envelopes |
| rift/gpu_fft_ocean_v9.js | Actual shared TSL water surface shading installed through older wrappers | Stages A/B: normal, glints, optical response, surface foam |
| rift/gpu_fft_ocean_v12.js through v19.js | Nested wrappers; v19 feeds foam solver, v18 feeds swash | Preserve call order and existing tuners |
| rift/shore_persistent_foam_v1.js | CPU foam simulation plus rolling breaker mesh and dynamic normal/aeration attributes | Stage D: peel/curl coherence and fragmented foam |
| rift/shore_foam_layers_v4.js | Thin shoreline wash/body/edge ribbons and wetness memory | Stage D: uneven swash and retreat |
| rift/main_game_rain_base.js | Active scene, seafloor MeshStandardNodeMaterial, underwater depth graph, camera water lens | Stages 0/C/D: isolate grid, depth-aware refraction, sand |
| rift/main_game_underwater_base.js and rift/main_game.js | Dynamically fetch/rewrite the final runtime module with source replacements | Keep replacement anchors valid; **verify generated game after edits** |
| rift/main.js / index.html | Launcher, touch controls, Drone Camera and Ocean Tuning UI | Optional diagnostics display; do not hide existing controls |

Important existing behavior:
- Native WebGPU and fallback WebGL2 may use different water optics. The current viewport-backdrop path is guarded by capability checks; alpha fallback must remain usable.
- riftPhysics1 is **OFF by default** after a shader regression. Do not reactivate the failed transmission/Beer–Lambert experiment globally.
- The previous iOS third micro FFT caused encoder failures; **do not turn it back on** to achieve small ripples.
- Dynamic runtime edits currently require exact source text. New code that replaces their anchors can break loading.
- Seafloor light uses an actual tiled grayscale texture (rift/textures/caustics_pattern.jpg), in addition to synthetic specular facets. The texture is cellular, so its repetition must be debugged separately from surface highlights.

## Stage 0 — Identify and permanently remove the repeating grid

Affected: rift/gpu_fft_ocean_v9.js, rift/main_game_rain_base.js. Do this BEFORE increasing reflection or wave detail.

Problem: screenshot shows many aligned, same-sized white ovals stretching across the shallows. That regularity is nonphysical. Several active effects can create it: the synthetic facet signal, high-frequency normal aliasing on a low-resolution surface, or repetitive seabed caustics. The existing riftGridFix reduces some of these but does not conclusively isolate the source.

Implement a new diagnostic selector (e.g. URL riftLightDebug=normal / no-facets / no-caustics / rough / baseline), with modes compiled as static branches in TSL, not an additional postprocessing pass:
1. Disable the synthetic facetMask/sparkleFlecks contribution while preserving PBR sun specular.
2. Disable terrain caustic emissive only, preserving surface highlights.
3. Set water roughness to a safe constant around 0.15 and fade optical short-wave normals with camera height.
4. Compare all three at matching drone height, sun position, and view direction.
5. Confirm which exact subsystem causes the repeated ovals before deleting its logic.

Patch rules:
- In gpu_fft_ocean_v9.js, near facetNoise/facetMask, avoid products of independent periodic sine bands as discrete sparkle masks. PBR microfacet response should carry glints; any optional breakup must be irregular, broadband, and filtered for distance.
- In gpu_fft_ocean_v9.js, near detailVisibility and material.roughnessNode, use camera-distance and projected wave-footprint filtering. The material roughness floor should rise with distance (candidate 0.07 near / 0.15–0.22 aerial) without turning the ocean matte.
- In main_game_rain_base.js, under active simpleTerrainMat.emissiveNode, suppress repeated caustic tiles in distant/aerial views and avoid per-texel hard thresholds. Keep underwater caustics responsive to sun/clouds.
- If the grid persists with both custom light effects disabled, examine the FFT mesh normal interpolation / presentation mesh sampling rather than adding more noise.

Acceptance: no stationary or moving rows of equidistant white circles in the drone top-down view; sunlight sparkle remains spatially irregular and responsive to wave orientation. Preserve riftGridFix=off for previous-visual comparison until validation.

## Stage A — Coherent REAL 3D wave structure

Affected: rift/gpu_fft_ocean_r185_v22.js, rift/gpu_fft_ocean_v9.js and, only if necessary, the underlying FFT geometry path in rift/gpu_fft_ocean_v4.js through v8.js.

A1. Separate existing long-swell and medium-wind envelopes:
- Preserve BOTH existing GPU FFT cascades, domains, and sampling/storage layout on iOS.
- Use lower-frequency, slowly varying swell energy and a separately changing wind-wave band; don't globally multiply the final mesh height by a huge scale.
- Evaluate the *actual* generated height/slope range on a phone before changing waveScale. Audit the multiple wrapper tuners (v9 and v22) for assignment order.
- No new FFT kernel or mobile micro FFT; spend budget on existing displaced vertices.

A2. One heightfield -> one geometric normal:
- Compute the surface derivative/normal from the displaced FFT geometry, not a separate unrelated color pattern.
- The existing worldNormal = cross(dFdx(positionWorld), dFdy(positionWorld)) is a starting point; verify orientation against the camera and reflected sun.
- If the mesh is too coarse, prefer camera-centered geometry LOD with a measured vertex budget and continuity at boundaries. Do not silently increase global subdivisions.

A3. Directional optical wavelets (not geometry):
- Retain two or three crossing wave phases with mathematically consistent X/Z gradients.
- Add a capillary layer to the **normal**, not to vertex displacement. Make direction/speed derive from the same chosen phase field.
- Filter wavelet normal amplitude based on projected footprint / camera distance. At drone height, far micro waves should merge into roughness instead of an aligned dot field.
- Use the same final water normal for custom sunlight, material.normalNode, reflection direction, and scene UV refraction.

Illustrative math, to convert into THREE/TSL node operations:

    h = h_fft_large + h_fft_medium
    slope = gradient(h) + a1 * k1 * cos(dot(k1,xz) - omega1*t)
                        + a2 * k2 * cos(dot(k2,xz) - omega2*t)
    N_world = normalize(vec3(-slope.x, 1.0, -slope.z))
    N_view = transformNormalByViewMatrix(N_world)

Here a_i and k_i are band-limited and should be scaled for the final mesh's world units. Avoid independently animating the normals in unrelated directions.

Initial art targets (TUNE, do not treat as fixed physical measurements):
- Large swell: slow broad rolls, no visible global breathing.
- Medium waves: distinct travelling wave faces, 0.2–0.7m apparent calm-water height where scene scale allows.
- Short-wave optical normals: modest directional slope, filtered at distance.
- At close range: individual crest/trough shading; at distance: visually continuous ocean, no stripes.

A/B: riftWaveGeometryA=off; leave existing riftWaves2=off supported.

## Stage B — Reflective, refractive, partially transmissive water

Primary: rift/gpu_fft_ocean_v9.js. Integration: rift/main_game_rain_base.js for the already available scene color/depth if required.

B1. One optical normal, not three competing ones:
- Feed N_view to MeshPhysicalNodeMaterial.normalNode.
- Above water, use N_world to calculate reflection ray and Schlick Fresnel.
- Below water, use the same displaced normal with an appropriate sign and total-internal-reflection transition; do not pretend a flat surface when the mesh is moving.
- Do not multiply the final diffuse color with a second independent glare lattice.

B2. Fresnel and roughness:
- Air/water IOR ~= 1.333, so normal-incidence R0 = ((1.333-1)/(1.333+1))^2 ~= 0.0204.
- Reflection increases dramatically at grazing incidence; transmission should decrease accordingly.
- Clear wave faces: candidate roughness 0.05–0.11 near camera.
- Foam and aerated water: candidate roughness 0.75–0.95.
- Blend roughness with foam coverage, not with sand depth alone.
- Filter very distant glints using footprint-aware roughness rather than adding white cards/dots.

B3. Real scene distortion:
- Reuse the r185 RenderPipeline scenePass output/depth and the existing viewport backdrop *only on backends where the sample is valid*.
- Refract according to the **difference between the moving normal and a flat surface**, transformed into camera-space UV; avoid world XZ being mistaken for screen XY.
- Compute offset from view angle, wave slope, shallow depth, and foam; enforce safe sample bounds and depth/disocclusion checks so foreground edges do not smear across the wave.
- Do NOT enable a zero-valued transmissionNode: Three.js's physical material treats a non-null node as a transmission path, as the prior regression demonstrated.
- Avoid double-transmission from both backdropAlphaNode and a second large blending-opacity decrease. Establish ownership of the scene color contribution.
- WebGL2 fallback should still show the seabed, though it cannot claim scene-aware refraction when unavailable.

Illustrative shading equations:

    F0 = pow((1.333 - 1.0) / (1.333 + 1.0), 2.0)
    F = F0 + (1.0 - F0) * pow(1.0 - saturate(dot(N,V)), 5.0)
    uvBend = clamp(projectToScreen(N - flatNormal) * strength, -limit, limit)
    refracted = sceneColor(screenUV + uvBend)
    waterBody = lerp(depthTintedTransmission, reflectedSky, F)
    finalWater = lerp(waterBody + restrainedSunSpec, matteFoam, foamMask)

These are explanatory formulas: convert to actual TSL node APIs and keep renderer-specific backdrop semantics correct. Never claim pixel-accurate physical optics if the underlying scene color/depth is not available.

B4. Sky reflection:
- Current code uses getRealisticCloudTexture() and a normal-derived reflectedUV. Preserve the shared lookup, but verify the sky texture's coordinate convention before treating its output as a true reflection.
- Blend sky and clouds based on reflected direction; put foam above reflection, and prevent milky uniform cyan at the horizon.
- Specular highlight should have a broad base and fine irregular sun glitter; not a periodic checkerboard.
- Preserve actual atmospheric daylight, cloud attenuation, and the Graphics > Reflections switch.

B5. Depth color and absorption:
- Shallow water: pale aqua with a bent seabed.
- Mid water: saturated turquoise/blue-green with reduced seabed visibility.
- Deeper water: blue body, not opaque paint and not completely colorless glass.
- A physically based attenuation option may be tested independently, but riftPhysics1 stays off by default until it compiles and looks right on mobile.

A/B: riftSurfaceOpticsB=off, separate from riftPhysics1.

## Stage C — Correct over/under waterline and underwater camera

Primary: rift/main_game_rain_base.js (createUnderwaterDepthGraph, cameraWaterUV, underwaterCameraSceneOutput); integration: rift/main_game.js dynamic replacement list.

C1. Surface crossing:
- Reconstruct view rays and water-surface intersection using the SAME two-band wave height, or a close mobile-safe coherent approximation.
- Ensure the resulting waterline is a deformed boundary with a smooth transition rather than a ruler-straight horizontal band.
- Above-water pixels: reflect/transmit based on external viewing angle.
- Underwater pixels: apply the water-to-air version of refraction and total internal reflection where appropriate.
- If full FFT storage reads per-screen pixel are too expensive on touch, use the existing procedural/mobile wave approximation tied to the exact current wave speed/direction. Do not reenable screen-wide FFT storage reads without profiling.

C2. Underwater view:
- Keep the already-installed underwater camera wobble; apply it to scene color and depth consistently.
- Only strongly refract rays that actually cross the moving surface. Rocks/sand/fish entirely underwater should not get a second incompatible surface warp.
- Beer–Lambert depth attenuation, scattering and wave-linked caustics should use the same sun orientation and waterline.
- Preserve the separate water-lens and rain-lens toggles; don't introduce an additional full-scene render or full-screen blur on iOS.

A/B: riftWaterlineC=off, plus existing riftCameraWater=off and riftUnderwater3=off.

## Stage D — Shoreline breaking waves, seafoam, swash, wet sand

Primary: rift/shore_persistent_foam_v1.js and rift/shore_foam_layers_v4.js; shader: rift/gpu_fft_ocean_v9.js; terrain: rift/main_game_rain_base.js.

D1. Break at correct depth, not everywhere:
- Use seafloor depth (the existing attribute used by gpu_fft_ocean_v9.js), crest height, steepness, and the existing breaker pulse.
- Example: breakingMask = shallowBand(depth) * crestGate * slopeGate * irregularAlongshoreGate.
- Do not use an always-on narrow white stripe along the entire beach.
- Aeration increases roughness and opacity; the green-blue face below the spilling lip stays glossy/translucent.

D2. Foam motion:
- Continue the persistent CPU foam buffer at its mobile cadence; carry foam forward with the breaking front and a decaying shoreward/backwash velocity.
- Break crest tips into disconnected sections with coherent alongshore modulation and holes; use the existing moving breaker mesh and riftBreakerAeration attribute.
- Only recompute moving breaker normals at its existing geometry update frequency; avoid adding a new CPU loop over the entire coast each frame.
- Foam should linger briefly then spread into lacy patches, without forming a uniform opaque carpet.

D3. Wash and wet sand:
- Reuse the existing wash/body/edge ribbon meshes and per-sample wetness memory.
- Let run-up tongues vary by local shoreline samples; backwash carries a thinner watery film.
- Match wet-sand darkening to those same shoreline events. The active terrain material is simpleTerrainMat; legacy onBeforeCompile material logic is not the target.
- Distinguish water film specular response from matte white foam.

A/B: riftSurf3=off, preserving existing riftSurf2=off for fallback.

## Stage E — iPhone performance budget and GPU safety

Target: approach **30 FPS** at stable low/medium settings, not a promise that it will reach 30 FPS. Current screenshots are commonly near 11–17 FPS; performance improvement must be measured on real devices.

Hard rules:
1. Keep the two-cascade, sequential WebKit FFT submit path in rift/gpu_fft_ocean_r185_v22.js intact.
2. Avoid the unsafe third mobile FFT, renderer.compute([...]) batches on WebKit, and extra manual scene renders.
3. Start with no new render passes, no extra material textures, and no increase in global ocean mesh subdivisions.
4. Reduce per-fragment periodic trig, especially distant water and mobile seafloor; prefer coherent shared bands and derived values.
5. Track CSS pixel ratio, canvas drawing resolution, shader complexity, FFT dispatch cost, terrain triangle count, cloud cost, and draw call count separately.
6. If high-frequency normals alias at distance, integrate them into effective roughness instead of increasing sampling density.
7. Compile and test the default mobile fallback AND the native WebGPU path; no GPU encoding/command-buffer failures.
8. When a feature costs noticeable FPS, revert or add distance/quality gating before proceeding to the next stage.

Suggested mobile render budget per frame at 30 FPS:
- Entire frame: <=33.3 ms.
- Water-related work should be a bounded fraction of that frame; establish measured baseline before assigning a strict millisecond budget.
- Test 2–3 minute sustained runs for FPS stability and memory/thermal regression.

## Exact rollout order and merge gates

0. **Diagnostics**: identify which component still makes the white oval grid. Preserve screenshots and profile baseline. Gate: root cause isolated.
1. **A — Surface waves**: two FFT bands + coherent optical slope, filter distant detail. Gate: visible moving wave faces without horizon gridding, same or better FPS.
2. **B — Reflections and refraction**: one normal drives specular, sky, refraction, foam masking. Gate: see actual moving slopes and bent seabed, not a transparent sheet or opaque cyan plane.
3. **C — Waterline**: improve boundary and camera optics. Gate: no waterline tears/sky leaks; foreground silhouettes remain plausible.
4. **D — Breaking surf**: local crest, aeration, persistent foam and swash. Gate: disconnected foam tongues and advancing/receding wet beach, not a continuous white stripe.
5. **E — Profiling**: performance cleanup, toggles and fallback. Gate: benchmark results documented; 30 FPS target reported honestly as reached or not reached.

Never combine all stages into a single high-risk shader replacement. Preserve gameplay, drone controls, account/site code, and save data.

## Concrete visual test matrix

Run both normal and new feature-off URLs after each stage. Hard-refresh/load a new GitHub Pages build before comparing.

| Camera and scene | Required result | Failure to catch |
| --- | --- | --- |
| Drone ~15m above reef, noon | Irregular specular breakup; visible seabed with mild wave distortion | Evenly spaced bright dots, moiré, fixed normal grid |
| Beach-level looking toward open ocean | Glossy sloped wave faces and sky Fresnel at grazing angles | Flat cyan sheet, black horizontal band |
| Looking straight down into shallow water | Moving light-bent sand texture, slight reflection, partial transparency | Invisible ocean or opaque painted surface |
| Half-submerged on sunny day | Wavy animated boundary, different air/water optics | Straight hard waterline or sky bleeding into sand |
| Underwater looking upward | Bright curved surface, sun shafts, smooth total-internal reflection | Flat ceiling, uniform milky turquoise |
| At the shoreline | Turquoise wave lip, patchy spilling foam, thin swash and wet sand | Solid white carpet, uniform contour stripe |
| Overcast / night | Glints and caustics diminish naturally | Daytime disco-light pattern in darkness |
| 2-minute mobile flight | No command encoder failure, no critical FPS degradation | Black frame, shader compilation error, 10 FPS regression |

Capture screenshots plus an FPS reading. A 28–30 FPS Water Pro reference on another scene/device is a **visual/performance reference**, not a guarantee that this game's other scene systems are equally cheap.

## Runtime integration and verification checklist

1. Fetch the current SHA of each target file from GitHub immediately before modifying it.
2. Edit the smallest owning file. Respect stage flags; don't turn on riftPhysics1.
3. Run JavaScript parse checks and inspect the final generated runtime module after applying main_game_underwater_base.js and main_game.js replacements (there were 67 active edits at this writing).
4. Inspect relevant Three.js r185 TSL signatures when changing material.normalNode/backdropNode/postprocessing; JavaScript syntax checks do not validate shader node types.
5. Confirm imports from liquid.js -> gpu_fft_ocean_r185_v22.js -> wrapper chain -> gpu_fft_ocean_v9.js; and v19 -> persistent foam, v18 -> swash.
6. Commit one testable stage at a time and include exact compare URL query parameters.
7. Check Pages deployment result. Do not assert the live game is changed until the corresponding deployment is green and the new content is actually served.
8. Inspect on-device WebGPU console/overlay, above-water and underwater screenshots, and sustained FPS.
9. Remove old experimental branches only after mobile visual + performance acceptance; until then keep safe rollback switches.

## Immediate next code patch

Start at Stage 0, NOT by increasing waveScale again. There is still a visibly regular reflection/caustic pattern in the user's drone screenshot despite riftGridFix. Add a debug selector to isolate the water's own PBR highlights versus the terrain caustic emission, then correct the confirmed source. Once the lattice is gone, Stage A can increase perceptual wave geometry without amplifying the same artifact.

**This file is the requested patch plan. It does not claim that Stages 0–E have already been implemented, compiled on iPhone, or deployed.**
