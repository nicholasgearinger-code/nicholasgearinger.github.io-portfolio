# Rift Cloud Model 3.1 — Reference-Shaped Volumetrics

Model 3 changes the cloud pipeline from **noise-first** to **shape-first**. Model 3.1 keeps that architecture and focuses on crown structure and lighting depth.

## Why

Model 2's Perlin-Worley field is good at realistic erosion and texture, but it is not a controllable authoring tool for the macro silhouette seen in the Sky Pro references. Model 3 therefore stores deliberate cauliflower towers, broken cumulus families, horizon banks and storm decks in a compact periodic 3D atlas.

## Runtime pipeline

1. `cloudArchetypes_reference_v2.js` defines the macro shapes as overlapping 3D ellipsoid/metaball lobes. The v2 set adds substantially more independent upper crowns, flatter bases, and a storm deck built from a low layer plus embedded convective cells.
2. `cloudReferenceVolumeAtlas_v2.js` bakes those shapes into one RGBA `Data3DTexture`:
   - R: towering cumulus
   - G: broken/medium cumulus
   - B: stratiform / storm deck
   - A: distant cumulus / horizon banks
3. `cloudInstanceDirector_reference_v2.js` computes dynamic channel weights and Model 3.1 crown/self-shadow controls from sun altitude, humidity, cloud coverage, convection and storm intensity.
4. `volumetricClouds_r185_model31.js` samples the reference atlas as the **macro density source**. Existing Perlin-Worley noise only modulates the interior, scallops the upper crown shell and erodes boundaries.
5. Directional optical depth samples the same authored atlas along the sun vector. A cheap local authored-core term adds interior depth without another texture fetch.
6. The existing r185 camera-centered temporal cloud pass, TAAU, weather state and shadow pipeline remain in use.

## Model 3.1 visual goals

- more distinct cauliflower domes instead of one smooth molded crown
- flatter/darker condensation bases
- brighter sun-facing crown tops
- cooler gray-blue interior self-shadowing
- better silver edges without whitening the entire cloud
- storm decks with layered cells rather than one rectangular wall

## Mobile cost

The mobile atlas is 64×44×64 RGBA8 (~704 KiB). Model 3.1 does not add a new full-screen pass and keeps the same view/light sample counts as Model 3.0. Crown breakup reuses the existing base-noise sample; the local self-shadow term is arithmetic-only.

## Reference fitting editor

Open `rift/cloud-reference-editor.html` during development. It now loads the v2 archetypes. Upload a reference capture, choose an archetype/lobe, and adjust its normalized center/radii while comparing the generated front silhouette over the reference image. `Copy JSON` exports the edited archetype for committing back into `cloudArchetypes_reference_v2.js`.

## Review / rollback

The branch defaults to Model 3.1. Add one of these query parameters to compare:

- `?cloudModel30=1` — previous Model 3.0
- `?cloudModel26=1` — previous camera-centered Model 2.6
- `?cloudModel25=1` — Model 2.5
- `?cloudModel24=1` — Model 2.4
- `?cloudModel22=1` — Model 2.2
- `?cloudFallback=1` — v1.7 fallback

## Review targets

- hero cumulus silhouette at midday
- visible small/medium crown hierarchy at the top of hero clouds
- flat base and darker underside without crushing all interior detail
- authored self-shadow following the same lobe structure as the silhouette
- distant bank scale near the horizon
- golden-hour warm edge color without whole-sky washout
- moonlit silver edge / dark interior balance
- storm-deck cell variation and FPS
- iPhone TAAU stability
