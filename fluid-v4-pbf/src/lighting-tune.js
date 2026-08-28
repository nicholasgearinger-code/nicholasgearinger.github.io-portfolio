// Fluid V4 reference-matched water lighting.
// Keep the PBF physics untouched; replace only the environment and SSFR composite look.

await import('./main.js');

const PIN = '58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0';
const ROOT = `https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@${PIN}/`;
const CW = await import(ROOT + 'src/ssfr_composite_wgsl.js');
const ssfr = window.__ssfr;

if (!ssfr?.dev || !ssfr?.format) {
  console.warn('[Fluid V4 lighting] SSFR handle unavailable; keeping previous optics.');
} else {
  // The upstream PBF reference the user approved uses Quarry Cloudy as an HDR panorama.
  // Load that same CC0 environment so the fluid reflects a real sky/environment instead
  // of the synthetic procedural blue sky used by our earlier V4 tests.
  try {
    if (ssfr.env) {
      await ssfr.env.load(ROOT + 'env/quarry_cloudy_1k.hdr');
      ssfr.env.intensity = 1.0;
      ssfr.env.yaw = 0.0;
      ssfr.bindCache = null;
    }
  } catch (err) {
    console.warn('[Fluid V4 lighting] HDR environment failed; using fallback sky.', err);
  }

  let src = CW.compositePrelude + CW.compositeFS;

  // Replace the giant grey checker with small swimming-pool mosaic tiles. These are
  // intentionally bright so refraction and moving caustics remain readable through
  // the deeper PBF volume.
  const floorRe = /fn floorColor\(p: vec3f\) -> vec3f \{[\s\S]*?\n\}/;
  const poolFloor = `fn floorColor(p: vec3f) -> vec3f {
  let uv = p.xz * 8.0;
  let cell = floor(uv);
  let f = abs(fract(uv) - vec2f(0.5));
  let grout = 1.0 - smoothstep(0.455, 0.49, max(f.x, f.y));
  let alt = (cell.x + cell.y) - 2.0 * floor((cell.x + cell.y) * 0.5);
  let aquaA = vec3f(0.18, 0.52, 0.61);
  let aquaB = vec3f(0.28, 0.66, 0.72);
  var c = mix(aquaA, aquaB, vec3f(alt * 0.72));
  c = mix(c, vec3f(0.78, 0.91, 0.91), vec3f(grout * 0.82));
  return c;
}`;
  if (floorRe.test(src)) src = src.replace(floorRe, poolFloor);

  // Bright underwater receiver plus the existing physically placed sphere shadow.
  const floorNeedle = '      return mix(floorColor(p), far, vec3f(fade));';
  const floorPatch = `      var floorLit = floorColor(p);
      let sunFill = 0.98 + 0.28 * max(C.sunDir.y, 0.0);
      floorLit = floorLit * sunFill + vec3f(0.035, 0.055, 0.058);
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
            let shadow = mix(1.0, 0.50, edge);
            floorLit *= vec3f(shadow * 0.96, shadow * 0.985, shadow * 1.02);
          }
        }
      }
      return mix(floorLit, far, vec3f(fade));`;
  if (src.includes(floorNeedle)) src = src.replace(floorNeedle, floorPatch);

  // Caustics remain tied to the reconstructed moving water normal field. Apply the
  // focusing mostly to transmitted underwater light, not to the surface reflection.
  const transNeedle = '  let trans = hitCol * exp(-C.absorb * thick);';
  const transPatch = `  let refrDx = dpdx(refrDir);
  let refrDy = dpdy(refrDir);
  let convergence = max(0.0, -(refrDx.x + refrDy.y));
  let causticDepth = smoothstep(0.025, 0.32, thick);
  let causticDown = smoothstep(0.10, 0.86, -refrDir.y);
  let focus = min(1.70, convergence * 32.0) * causticDepth * causticDown;
  hitCol *= vec3f(1.0 + focus * 0.42, 1.0 + focus * 0.39, 1.0 + focus * 0.30);
  hitCol += vec3f(1.00, 0.97, 0.88) * focus * 0.13;

  let trans = hitCol * exp(-C.absorb * thick);`;
  if (src.includes(transNeedle)) src = src.replace(transNeedle, transPatch);

  const mod = ssfr.dev.createShaderModule({ code: src, label: 'fluidV4ReferenceWaterWGSL' });
  ssfr.pipeComposite = ssfr.dev.createRenderPipeline({
    label: 'fluidV4ReferenceWaterComposite',
    layout: 'auto',
    vertex: { module: mod, entryPoint: 'vs' },
    fragment: { module: mod, entryPoint: 'fs', targets: [{ format: ssfr.format }] },
    primitive: { topology: 'triangle-list' },
  });

  // Match the approved Particles4All small-preset optics, but divide optical thickness
  // by roughly three because our physical pool is intentionally about 3x deeper.
  ssfr.ior = 1.333;
  ssfr.absorption = 0.425;
  ssfr.transmit = [0.34902, 0.705882, 0.894118];
  ssfr.thicknessScale = 0.19;
  ssfr.roughness = 0.048;
  ssfr.sunIntensity = 4.375;
  ssfr.sunElevation = 23.219;
  ssfr.sunAzimuth = 42.75;
  ssfr.exposure = 1.53;
  ssfr.groundReflection = 0.0;
  ssfr.bindCache = null;

  console.info('[Fluid V4 lighting] HDR reference lighting, clear 3x-depth optics, pool tiles and transmitted caustics enabled.');
}
