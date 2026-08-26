# Rift Cloud Model 3 — Reference-Shaped Volumetrics

Model 3 changes the cloud pipeline from **noise-first** to **shape-first**.

## Runtime pipeline

1. `cloudArchetypes_reference_v2.js` defines the Model 3.1 authored macro shapes.
2. `volumetricClouds_r185_model31.js` adds crown breakup and reference-aware self-shadowing.
3. `volumetricClouds_r185_model32.js` retunes the existing 3.1 lighting controls for stronger warm/cool separation, silver lining, deeper humid interiors, darker bases, and subtle ocean/sky bounce without adding another sample.
4. `cloudArchetypes_reference_v3.js` expands each existing atlas channel with satellite puffs, additional broken-cumulus families, embedded storm cells, and flattened horizon banks.
5. `cloudReferenceVolumeAtlas_v3.js` bakes those families into the same single RGBA `Data3DTexture` used by the inherited Model 3 raymarch.
6. `cloudInstanceDirector_reference_v3.js` changes weights, scale, coverage, convection, and slow macro evolution from weather and sun state.
7. `volumetricClouds_r185_model33.js` is the current review default and combines the 3.2 lighting with the 3.3 structural atlas.

The existing r185 camera-centered cloud surface, TAAU, Perlin-Worley shell erosion, weather state, and cloud-shadow pipeline remain in place.

## Model 3.2 lighting goals

- brighter sun-facing crowns without whole-cloud clipping
- stronger silver lining and low-sun warmth
- cooler gray-blue interiors
- darker, humidity-aware condensation bases
- subtle ocean/sky bounce through the existing ambient term
- neutral/silver moonlit clouds

Model 3.2 adds **zero** 3D texture samples and no full-screen pass.

## Model 3.3 structural goals

- hero cumulus + nearby satellite puffs
- multiple broken-cumulus families in one periodic tile
- flattened distant/horizon banks
- storm shelf plus embedded convective towers
- more open blue gaps in fair weather
- stable, very slow macro evolution compatible with TAAU

The v3 atlas preserves the same single reference-atlas lookup per ray sample. Mobile atlas size is 64×46×64 RGBA8 (~736 KiB).

## Review / rollback

The review branch defaults to Model 3.3. Query switches:

- `?cloudModel32=1` — Model 3.2 lighting on the 3.1 atlas
- `?cloudModel31=1` — Model 3.1
- `?cloudModel30=1` — Model 3.0
- `?cloudModel26=1` — Model 2.6
- `?cloudModel25=1` — Model 2.5
- `?cloudModel24=1` — Model 2.4
- `?cloudModel22=1` — Model 2.2
- `?cloudFallback=1` — v1.7 fallback

## Review targets

- midday: multiple readable cumulus families rather than one dominant slab
- cloud interiors: clear crown / core / base separation
- sunset: localized warm edge color with cool interior shadows
- horizon: layered distant banks with atmospheric spacing
- storm: low shelf + embedded convective cells rather than one flat wall
- night: coherent moonlit silhouettes and restrained silver edges
- iPhone FPS / TAAU stability versus Model 3.1
