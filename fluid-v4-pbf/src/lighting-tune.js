// Fluid V4 lighting refinement layered on top of the proven PBF integration.
// Loads after main.js, then rebuilds only the SSFR composite shader.

await import('./main.js');

const UPSTREAM = 'https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/src/';
const CW = await import(UPSTREAM + 'ssfr_composite_wgsl.js');
const ssfr = window.__ssfr;

if (!ssfr?.dev || !ssfr?.format) {
  console.warn('[Fluid V4 lighting] SSFR handle unavailable; keeping previous optics.');
} else {
  let src = CW.compositePrelude + CW.compositeFS;

  // Make the refracted pool floor brighter and more neutral-aqua instead of charcoal grey.
  src = src.replace(
    '  let base = vec3f(0.30, 0.305, 0.315);',
    '  let base = vec3f(0.40, 0.54, 0.57);'
  );
  src = src.replace(
    '  var c = mix(base, vec3f(0.50, 0.51, 0.52), vec3f(line * 0.8));',
    '  var c = mix(base, vec3f(0.76, 0.88, 0.90), vec3f(line * 0.72));'
  );
  src = src.replace(
    '  c *= mix(0.88, 1.10, chk);',
    '  c *= mix(0.95, 1.045, chk);'
  );

  // Brighter underwater receiver + soft sphere shadow. The floor still receives the
  // dynamic caustic modulation later through the refracted ray path.
  const floorNeedle = '      return mix(floorColor(p), far, vec3f(fade));';
  const floorPatch = `      var floorLit = floorColor(p);\n      let sunFill = 0.88 + 0.22 * max(C.sunDir.y, 0.0);\n      floorLit = floorLit * sunFill + vec3f(0.028, 0.045, 0.050);\n      if (C.bodyCount > 0) {\n        let centre = bdata[0u].xyz;\n        let radius = max(bdata[1u].x, 1.0e-4);\n        let oc = p - centre;\n        let qb = dot(oc, C.sunDir);\n        let qc = dot(oc, oc) - radius * radius;\n        let disc = qb * qb - qc;\n        if (disc > 0.0) {\n          let root = sqrt(disc);\n          let tFar = -qb + root;\n          if (tFar > 0.0) {\n            let edge = smoothstep(0.0, radius * radius * 0.24, disc);\n            let shadow = mix(1.0, 0.54, edge);\n            floorLit *= vec3f(shadow * 0.96, shadow * 0.985, shadow * 1.02);\n          }\n        }\n      }\n      return mix(floorLit, far, vec3f(fade));`;
  if (src.includes(floorNeedle)) src = src.replace(floorNeedle, floorPatch);

  // Keep caustics on the transmitted scene, but make them tighter and less likely to turn
  // the water surface into white blotches. They still come from live refracted-ray convergence.
  const transNeedle = '  let trans = hitCol * exp(-C.absorb * thick);';
  const transPatch = `  let refrDx = dpdx(refrDir);\n  let refrDy = dpdy(refrDir);\n  let convergence = max(0.0, -(refrDx.x + refrDy.y));\n  let causticDepth = smoothstep(0.055, 0.60, thick);\n  let causticDown = smoothstep(0.12, 0.82, -refrDir.y);\n  let focus = min(1.35, convergence * 28.0) * causticDepth * causticDown;\n  hitCol *= vec3f(1.0 + focus * 0.34, 1.0 + focus * 0.31, 1.0 + focus * 0.22);\n  hitCol += vec3f(1.00, 0.96, 0.86) * focus * 0.16;\n\n  let trans = hitCol * exp(-C.absorb * thick);`;
  if (src.includes(transNeedle)) src = src.replace(transNeedle, transPatch);

  const mod = ssfr.dev.createShaderModule({ code: src, label: 'fluidV4ClearWaterWGSL' });
  ssfr.pipeComposite = ssfr.dev.createRenderPipeline({
    label: 'fluidV4ClearWaterComposite',
    layout: 'auto',
    vertex: { module: mod, entryPoint: 'vs' },
    fragment: { module: mod, entryPoint: 'fs', targets: [{ format: ssfr.format }] },
    primitive: { topology: 'triangle-list' },
  });
  ssfr.bindCache = null;

  // Clear swimming-pool water: much lower absorption than the previous deep-blue test.
  ssfr.ior = 1.333;
  ssfr.absorption = 0.26;
  ssfr.transmit = [0.62, 0.84, 0.94];
  ssfr.thicknessScale = 0.58;
  ssfr.roughness = 0.024;
  ssfr.sunIntensity = 3.55;
  ssfr.sunElevation = 54.0;
  ssfr.sunAzimuth = 34.0;
  ssfr.exposure = 1.08;
  ssfr.groundReflection = 0.0;

  console.info('[Fluid V4 lighting] clear-water absorption, brighter pool floor, refined caustics and softer reflections enabled.');
}
