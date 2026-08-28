// Fluid V4.3.1 high-contrast realtime caustics.
// Keep the validated V4.3 solver intact, but widen its receiver kernel and add a robust
// refracted-sun angular convergence term so focused light remains visible on mobile.
// This is still driven entirely by the live SSFR water surface + real sun direction.

const sourceUrl = new URL('./pool-caustics-v3.js', import.meta.url);
const lightingUrl = new URL('./lighting-tune.js', import.meta.url).href;
const response = await fetch(sourceUrl, { cache: 'no-store' });
if (!response.ok) throw new Error(`Fluid V4.3.1: unable to load V4.3 source (${response.status}).`);
let source = await response.text();

source = source.replace(
  "await import('./lighting-tune.js');",
  `await import(${JSON.stringify(lightingUrl)});`
);
source = source.replaceAll('Fluid V4.3', 'Fluid V4.3.1');
source = source.replaceAll('fluidV43RealtimeCaustics', 'fluidV431RealtimeCaustics');

const oldFocus = `      let sx = causticSurfaceAt(sourcePixel + vec2i(1, 0), lim);
      let sy = causticSurfaceAt(sourcePixel - vec2i(0, 1), lim);
      if (h0.t < 1.0e29 && sx.valid > 0.5 && sy.valid > 0.5) {
        var rayX = refract(sunIn, sx.n, 1.0 / C.ior);
        var rayY = refract(sunIn, sy.n, 1.0 / C.ior);
        if (dot(rayX, rayX) < 1.0e-8) { rayX = sunIn; }
        if (dot(rayY, rayY) < 1.0e-8) { rayY = sunIn; }
        let hx = tracePool(sx.p + rayX * 1.0e-3, rayX);
        let hy = tracePool(sy.p + rayY * 1.0e-3, rayY);

        if (hx.t < 1.0e29 && hy.t < 1.0e29 &&
            dot(h0.n, hx.n) > 0.90 && dot(h0.n, hy.n) > 0.90) {
          let surfaceArea = max(length(cross(sx.p - s0.p, sy.p - s0.p)), 1.0e-7);
          let receiverArea = max(length(cross(hx.p - h0.p, hy.p - h0.p)), 1.0e-7);
          let concentration = clamp(surfaceArea / receiverArea, 0.0, 8.0);
          let focused = max(concentration - 0.92, 0.0);

          // Deposit onto the actual visible receiver. The correction above normally makes this
          // error tiny; the soft kernel keeps the solver stable at silhouettes and splash edges.
          let miss = h0.p - receiverP;
          let deposit = exp(-dot(miss, miss) * 18.0);
          let incidence = max(dot(s0.n, C.sunDir), 0.0);
          let fresnelLoss = 1.0 - fresnelFull(incidence, 1.0, C.ior);
          let receiverCos = max(dot(h0.n, -ray0), 0.0);

          // Analytic rigid-sphere occlusion: caustics disappear inside the ball's real shadow.
          var unoccluded = 1.0;
          if (C.bodyCount > 0) {
            let centre = bdata[0u].xyz;
            let radius = max(bdata[1u].x, 1.0e-4);
            let oc = receiverP - centre;
            let qb = dot(oc, C.sunDir);
            let qc = dot(oc, oc) - radius * radius;
            let disc = qb * qb - qc;
            if (disc > 0.0 && (-qb + sqrt(disc)) > 0.0) { unoccluded = 0.08; }
          }

          let sunScale = clamp(C.sunIntensity / 4.5, 0.0, 1.8);
          causticFocus = min(3.4, focused * deposit * incidence * receiverCos *
                            fresnelLoss * sunAbove * sunScale * unoccluded);
          causticTransmission = exp(-C.absorb * max(h0.t, 0.0));
        }
      }`;

const newFocus = `      // Sample a slightly wider water footprint than V4.3. One-pixel finite differences were
      // too noisy at mobile SSFR resolution and caused most valid caustic energy to be rejected.
      let sx = causticSurfaceAt(sourcePixel + vec2i(2, 0), lim);
      let sy = causticSurfaceAt(sourcePixel + vec2i(0, 2), lim);
      if (h0.t < 1.0e29 && sx.valid > 0.5 && sy.valid > 0.5) {
        var rayX = refract(sunIn, sx.n, 1.0 / C.ior);
        var rayY = refract(sunIn, sy.n, 1.0 / C.ior);
        if (dot(rayX, rayX) < 1.0e-8) { rayX = sunIn; }
        if (dot(rayY, rayY) < 1.0e-8) { rayY = sunIn; }
        let hx = tracePool(sx.p + rayX * 1.0e-3, rayX);
        let hy = tracePool(sy.p + rayY * 1.0e-3, rayY);

        // Angular convergence is a robust light-focusing signal even when one neighbouring
        // refracted ray lands on a different pool face. Negative directional divergence means
        // neighbouring sunlight rays are bending toward each other.
        let dxSurf = sx.p - s0.p;
        let dySurf = sy.p - s0.p;
        let lenX = max(length(dxSurf), 1.0e-4);
        let lenY = max(length(dySurf), 1.0e-4);
        let angularDiv = dot(rayX - ray0, dxSurf / lenX) / lenX +
                         dot(rayY - ray0, dySurf / lenY) / lenY;
        let angularCompression = max(-angularDiv, 0.0);
        let angularFocus = smoothstep(0.010, 0.24, angularCompression) * 1.85 +
                           min(1.35, angularCompression * 0.48);

        // Keep the true receiver-area Jacobian when all three rays reach the same pool face.
        // This produces the sharpest physically focused streaks, while angularFocus fills the
        // gaps that previously made the effect nearly invisible on mobile.
        var receiverFocus = 0.0;
        if (hx.t < 1.0e29 && hy.t < 1.0e29 &&
            dot(h0.n, hx.n) > 0.62 && dot(h0.n, hy.n) > 0.62) {
          let surfaceArea = max(length(cross(dxSurf, dySurf)), 1.0e-7);
          let receiverArea = max(length(cross(hx.p - h0.p, hy.p - h0.p)), 1.0e-7);
          let concentration = clamp(surfaceArea / receiverArea, 0.0, 10.0);
          receiverFocus = max(concentration - 0.60, 0.0);
        }
        let focused = max(receiverFocus, angularFocus);

        // A wider receiver kernel survives the coarse mobile SSFR grid while still moving with
        // the solved refracted ray landing point rather than with screen coordinates.
        let miss = h0.p - receiverP;
        let deposit = exp(-dot(miss, miss) * 4.2);
        let incidence = max(dot(s0.n, C.sunDir), 0.0);
        let fresnelLoss = 1.0 - fresnelFull(incidence, 1.0, C.ior);
        let receiverCos = max(dot(h0.n, -ray0), 0.0);

        // Analytic rigid-sphere occlusion: caustics fade inside the ball's real sunlight shadow.
        var unoccluded = 1.0;
        if (C.bodyCount > 0) {
          let centre = bdata[0u].xyz;
          let radius = max(bdata[1u].x, 1.0e-4);
          let oc = receiverP - centre;
          let qb = dot(oc, C.sunDir);
          let qc = dot(oc, oc) - radius * radius;
          let disc = qb * qb - qc;
          if (disc > 0.0 && (-qb + sqrt(disc)) > 0.0) { unoccluded = 0.06; }
        }

        let sunScale = clamp(C.sunIntensity / 3.2, 0.0, 2.35);
        let receiverLight = 0.38 + 0.62 * receiverCos;
        causticFocus = min(5.2, focused * deposit * incidence * receiverLight *
                           fresnelLoss * sunAbove * sunScale * unoccluded * 1.35);
        causticTransmission = exp(-C.absorb * max(h0.t, 0.0));
      }`;

if (!source.includes(oldFocus)) throw new Error('Fluid V4.3.1: V4.3 focus block changed.');
source = source.replace(oldFocus, newFocus);

const oldLighting = `  let causticGain = 0.28 + 1.22 * clamp(C.groundReflection, 0.0, 2.0);
  let focusedEnergy = causticFocus * causticGain;
  // A small redistribution dip between focused regions stops the effect reading like emissive
  // paint while preserving enough ambient pool light for mobile displays.
  let redistribution = 0.94 + min(1.55, focusedEnergy * 0.46);
  hitCol *= vec3f(redistribution * 1.025, redistribution * 1.012, redistribution);
  hitCol += vec3f(1.0, 0.97, 0.86) * causticTransmission * focusedEnergy * 0.19;`;

const newLighting = `  let causticGain = 0.62 + 1.62 * clamp(C.groundReflection, 0.0, 2.0);
  let focusedEnergy = causticFocus * causticGain;
  // Preserve contrast headroom: unfocused underwater tiles are slightly darker, while genuine
  // refracted-light convergence can climb well above the ambient receiver illumination.
  let redistribution = 0.82 + min(2.35, focusedEnergy * 0.72);
  hitCol *= vec3f(redistribution * 1.025, redistribution * 1.012, redistribution);
  hitCol += vec3f(1.0, 0.97, 0.84) * causticTransmission * focusedEnergy * 0.42;`;

if (!source.includes(oldLighting)) throw new Error('Fluid V4.3.1: V4.3 lighting block changed.');
source = source.replace(oldLighting, newLighting);
source = source.replace(
  "if (stats && !stats.textContent.includes('ray-caustics')) stats.textContent += ' · ray-caustics · sun-linked';",
  "if (stats && !stats.textContent.includes('ray-caustics')) stats.textContent += ' · ray-caustics · sun-linked · high-contrast';"
);
source = source.replace(
  "console.info('[Fluid V4.3.1] realtime receiver-space refracted-sun caustics enabled.');",
  "console.info('[Fluid V4.3.1] high-contrast realtime refracted-sun caustics enabled.');"
);

const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
