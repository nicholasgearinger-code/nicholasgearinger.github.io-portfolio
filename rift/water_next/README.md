# Rift Next Water (experimental, disabled)

Modular framework for rebuilding the ocean around one authoritative wave field.

- `wave_field.js`: shared displacement/normal/curvature/velocity/foam interface.
- `geometry.js`: reserved for camera-centered LOD rings.
- `optics.js`: shared water refractive index, Fresnel function and material adapter.
- `caustics.js`: curvature-driven illumination adapter.
- `foam.js`: whitecap + shoreline foam adapter.
- `index.js`: composition and lifecycle entry point.

**Current status:** Structural scaffolding, not a new visual renderer. No new compute passes or changed production gameplay. Adapters are intentional no-ops pending validated integration with the active FFT/shallow-water data. Do not enable for live rendering until wave data bindings and device testing are complete.

**Integration gates:** (1) expose authoritative FFT displacement and analytical slope; (2) implement LOD rings with stable boundaries; (3) integrate optics with existing reflection/refraction targets; (4) link caustics/foam to field values; (5) profile iPhone Low and verify 30+ fps.
