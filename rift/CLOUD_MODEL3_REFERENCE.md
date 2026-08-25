# Rift Cloud Model 3 — Reference-Shaped Volumetrics

Model 3 changes the cloud pipeline from **noise-first** to **shape-first**.

## Why

Model 2's Perlin-Worley field is good at realistic erosion and texture, but it is not a controllable authoring tool for the macro silhouette seen in the Sky Pro references. Model 3 therefore stores deliberate cauliflower towers, broken cumulus families, horizon banks and storm decks in a compact periodic 3D atlas.

## Runtime pipeline

1. `cloudArchetypes_reference_v1.js` defines the macro shapes as overlapping 3D ellipsoid/metaball lobes.
2. `cloudReferenceVolumeAtlas.js` bakes those shapes into one RGBA `Data3DTexture`:
   - R: towering cumulus
   - G: broken/medium cumulus
   - B: stratiform / storm deck
   - A: distant cumulus / horizon banks
3. `cloudInstanceDirector_reference_v1.js` computes dynamic channel weights from sun altitude, humidity, cloud coverage, convection and storm intensity.
4. `volumetricClouds_r185_model30.js` samples the reference atlas as the **macro density source**. Existing Perlin-Worley noise only modulates the interior and erodes the boundary.
5. The existing r185 camera-centered temporal cloud pass, TAAU, weather state and shadow pipeline remain in use.

## Mobile cost

The mobile atlas is 64×40×64 RGBA8 (~640 KiB) and adds one 3D texture sample per view step plus one per Sun-light step. The existing Model 2 base/detail textures and TAAU remain unchanged. No extra full-screen render pass is added.

## Reference fitting editor

Open `rift/cloud-reference-editor.html` during development. Upload a reference capture, choose an archetype/lobe, and adjust its normalized center/radii while comparing the generated front silhouette over the reference image. `Copy JSON` exports the edited archetype for committing back into `cloudArchetypes_reference_v1.js`.

## Review / rollback

The branch defaults to Model 3. Add one of these query parameters to compare:

- `?cloudModel26=1` — previous camera-centered Model 2.6
- `?cloudModel25=1` — Model 2.5
- `?cloudModel24=1` — Model 2.4
- `?cloudModel22=1` — Model 2.2
- `?cloudFallback=1` — v1.7 fallback

## Review targets

- hero cumulus silhouette at midday
- flat cloud bases and cauliflower crown breakup
- distant bank scale near the horizon
- golden-hour warm edge color without whole-sky washout
- moonlit silver edge / dark interior balance
- storm-deck continuity
- iPhone FPS and TAAU stability
