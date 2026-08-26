# Rift Cloud Model 4.0 — Reference-Reconstructed Sky

Model 4.0 changes the macro-cloud source from hand-authored lobes to the actual
sky reference images already stored in `rift/textures`.

## Runtime pipeline

1. `cloudReferenceReconstruction_v1.js` loads the day, dusk, storm and moonlit
   reference PNGs at startup at the atlas resolution rather than full display
   resolution.
2. Each image is segmented into a soft cloud silhouette using row-relative sky
   color, luminance/saturation deviation, local texture and optional alpha.
3. A 2D inside-distance field is calculated from each silhouette.
4. The silhouette + distance field is inflated into a rounded 3D density volume.
   Interior pixels become deeper cloud mass; edge pixels become a shallow shell.
5. The reconstructed families are packed into the existing RGBA `Data3DTexture`:
   - R: fair/day references
   - G: broken/golden-hour references
   - B: sunset/horizon-bank references
   - A: storm/night references
6. Model 3.6's Perlin-Worley field remains detail-only: edge erosion, cauliflower
   breakup, wisps and slow evolution. It no longer defines the main silhouette.
7. The existing Model 3.6 r185 raymarch, TAAU, self-shadowing, cloud shadows,
   solar corridor and cloud-aware GodraysNode path remain in place.

## In-place atlas upgrade

The `Data3DTexture` is created synchronously with Model 3.3's atlas bytes as a
safe fallback. Reference analysis then runs asynchronously and replaces only the
texture's byte buffer. The TSL shader keeps the same texture object, so no shader
recompile is needed when reconstruction finishes.

Mobile atlas: 64 x 46 x 64 RGBA8 (~736 KiB). The reconstruction works on the
small atlas resolution and yields between reference groups to avoid one long
first-frame task on iPhone.

## Reference-driven lighting calibration

The same startup analysis records:

- cloud highlight RGB
- cloud shadow RGB
- horizon RGB
- detected solar centroid / apparent radius when present

Model 4.0 uses those values conservatively to bias golden-hour sun color,
cloud ambient color, horizon color and visible solar-disc scale while keeping the
existing physical v15 sun/atmosphere model authoritative for radiance.

## Review / rollback

The review branch defaults to Model 4.0.

- default — Model 4.0 reference reconstruction
- `?cloudModel36=1` — Model 3.6
- `?cloudModel35=1` — Model 3.5
- `?cloudModel33=1` — Model 3.3
- `?cloudModel31=1` — Model 3.1
- `?cloudFallback=1` — v1.7 fallback

Useful runtime diagnostics:

- `globalThis.__riftReferenceReconstruction`
- `globalThis.__riftCloudModel40Debug`

## Review targets

- cloud silhouettes should resemble the texture references before procedural
  detail is considered
- day clouds should retain distinct blue gaps and readable individual masses
- dusk should produce broad layered banks with warm light and cool interiors
- storm should reconstruct a lower, denser shelf rather than a generic slab
- low Sun should spend time behind reconstructed cloud mass so silver lining and
  crepuscular rays occur naturally
- moving sideways should reveal real volume depth, not a billboard silhouette
- iPhone should preserve Model 3.6's steady-state raymarch cost after startup
