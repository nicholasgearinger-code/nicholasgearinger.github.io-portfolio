// Fluid V4 lighter cyan water pass.
// Keep the PBF physics untouched; tune only environment, SSFR optics and pool lighting.

await import('./main.js');

const PIN = '58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0';
const ROOT = `https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@${PIN}/`;
const CW = await import(ROOT + 'src/ssfr_composite_wgsl.js');
const ssfr = window.__ssfr;

if (!ssfr?.dev || !ssfr?.format) {
  console.warn('[Fluid V4 lighting] SSFR handle unavailable; keeping previous optics.');
} else {
  // Keep the detailed Quarry Cloudy HDR reflections, but do not let the environment
  // make the water body read as dark navy at grazing angles.
  try {
    if (ssfr.env) {
      await ssfr.env.load(ROOT + 'env/quarry_cloudy_1k.hdr');
      ssfr.env.intensity = 1.08;
      ssfr.env.yaw = 0.0;
      ssfr.bindCache = null;
    }
  } catch (err) {
    console.warn('[Fluid V4 lighting] HDR environment failed; using fallback sky.', err);
  }

  let src = CW.compositePrelude + CW.compositeFS;

  // Lift only the reflected water lobe. The previous pass allowed dark parts of the HDR
  // panorama to dominate steep/grazing views, which produced the navy slab in side view.
  src = src.replace(
    '  let physical = envReflect(d);',
    '  let physical = envReflect(d) * 0.72 + vec3f(0.10, 0.18, 0.24);'
  );

  // Small swimming-pool mosaic tiles so the clearer water has a bright refractive target.
  const floorRe = /fn floorColor\(p: vec3f\) -> vec3f \{[\s\S]*?\n\}/;
  const poolFloor = `fn floorColor(p: vec3f) -> vec3f {
  let uv = p.xz * 8.0;
  let cell = floor(uv);
  let f = abs(fract(uv) - vec2f(0.5));
  let grout = 1.0 - smoothstep(0.455, 0.49, max(f.x, f.y));
  let alt = (cell.x + cell.y) - 2.0 * floor((cell.x + cell.y) * 0.5);
  let aquaA = vec3f(0.24, 0.60, 0.68);
  let aquaB = vec3f(0.36, 0.72, 0.77);
  var c = mix(aquaA, aquaB, vec3f(alt * 0.68));
  c = mix(c, vec3f(0.82, 0.94, 0.94), vec3f(grout * 0.82));
  return c;
}`;
  if (floorRe.test(src)) src = src.replace(floorRe, poolFloor);

  // Bright underwater receiver plus the sphere shadow.
  const floorNeedle = '      return mix(floorColor(p), far, vec3f(fade));';
  const floorPatch = `      var floorLit = floorColor(p);
      let sunFill = 1.02 + 0.30 * max(C.sunDir.y, 0.0);
      floorLit = floorLit * sunFill + vec3f(0.045, 0.065, 0.070);
      if (C.bodyCount > 0) {
        let centre = bdata[0u].xyz;
        let radius = max(bdata[1u].x, 1.0e-4);
        let oc = p - centre;
        let qb = dot(oc, C.sunDir);
        let qc = dot(oc, oc) - radius * radius;
        let disc = qb * qb - qc;
        if (disc > 0.0) {
          let root = sqrt(disc);
          let tFar = -qb + root;
          if (tFar > 0.0) {
            let edge = smoothstep(0.0, radius * radius * 0.22, disc);
            let shadow = mix(1.0, 0.54, edge);
            floorLit *= vec3f(shadow * 0.97, shadow * 0.99, shadow * 1.02);
          }
        }
      }
      return mix(floorLit, far, vec3f(fade));`;
  if (src.includes(floorNeedle)) src = src.replace(floorNeedle, floorPatch);

  // The stock SSFR model is absorption-only, so thick water naturally falls toward black.
  // Add a restrained cyan single-scattering approximation and substantially reduce optical
  // density. This keeps deep side views translucent and aqua instead of opaque/navy.
  const transNeedle = '  let trans = hitCol * exp(-C.absorb * thick);';
  const transPatch = `  let refrDx = dpdx(refrDir);
  let refrDy = dpdy(refrDir);
  let convergence = max(0.0, -(refrDx.x + refrDy.y));
  let causticDepth = smoothstep(0.020, 0.28, thick);
  let causticDown = smoothstep(0.10, 0.86, -refrDir.y);
  let focus = min(1.55, convergence * 30.0) * causticDepth * causticDown;
  hitCol *= vec3f(1.0 + focus * 0.36, 1.0 + focus * 0.34, 1.0 + focus * 0.27);
  hitCol += vec3f(1.00, 0.98, 0.90) * focus * 0.11;

  let attenuation = exp(-C.absorb * thick);
  let scatterAmount = 1.0 - exp(-thick * 0.55);
  let waterScatter = vec3f(0.055, 0.16, 0.20) * scatterAmount;
  let trans = hitCol * attenuation + waterScatter;`;
  if (src.includes(transNeedle)) src = src.replace(transNeedle, transPatch);

  const mod = ssfr.dev.createShaderModule({ code: src, label: 'fluidV4LightCyanWaterWGSL' });
  ssfr.pipeComposite = ssfr.dev.createRenderPipeline({
    label: 'fluidV4LightCyanWaterComposite',
    layout: 'auto',
    vertex: { module: mod, entryPoint: 'vs' },
    fragment: { module: mod, entryPoint: 'fs', targets: [{ format: ssfr.format }] },
    primitive: { topology: 'triangle-list' },
  });

  // Clearer than the previous reference-matched pass. The target is the user's lighter
  // cyan screenshot: high transmission, gentle body tint, and visible refracted scenery.
  ssfr.ior = 1.333;
  ssfr.absorption = 0.16;
  ssfr.transmit = [0.70, 0.88, 0.96];
  ssfr.thicknessScale = 0.13;
  ssfr.roughness = 0.035;
  ssfr.sunIntensity = 4.05;
  ssfr.sunElevation = 32.0;
  ssfr.sunAzimuth = 42.75;
  ssfr.exposure = 1.62;
  ssfr.groundReflection = 0.0;
  ssfr.bindCache = null;

  console.info('[Fluid V4 lighting] lighter cyan transmission, lifted HDR reflections and underwater scattering enabled.');
}
