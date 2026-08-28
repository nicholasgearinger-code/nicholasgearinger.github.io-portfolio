// Fluid V4.3.2 floor-directed realtime caustics.
// Builds on the validated V4.3.1 high-contrast pass, but makes the receiver response
// physically prefer horizontal pool-floor surfaces. A higher sun angle can then place the
// strongest refracted-light network on the basin floor instead of overexposing side walls.

const v431Url = new URL('./pool-caustics-v4.js', import.meta.url);
const v43Url = new URL('./pool-caustics-v3.js', import.meta.url).href;
const lightingUrl = new URL('./lighting-tune.js', import.meta.url).href;
const angleUrl = new URL('./caustic-angle.js', import.meta.url).href;

const response = await fetch(v431Url, { cache: 'no-store' });
if (!response.ok) throw new Error(`Fluid V4.3.2: unable to load V4.3.1 source (${response.status}).`);
let source = await response.text();

// V4.3.1 normally resolves these relative to its own module URL. Because we validate the
// modified source through a Blob module, pin them back to the real branch URLs first.
source = source.replace(
  "const sourceUrl = new URL('./pool-caustics-v3.js', import.meta.url);",
  `const sourceUrl = ${JSON.stringify(v43Url)};`
);
source = source.replace(
  "const lightingUrl = new URL('./lighting-tune.js', import.meta.url).href;",
  `const lightingUrl = ${JSON.stringify(lightingUrl)};`
);

source = source.replaceAll('Fluid V4.3.1', 'Fluid V4.3.2');
source = source.replaceAll('fluidV431', 'fluidV432');

// In V4.3.1 every pool face retained a 38% receiver-light floor. That was useful for proving
// the caustic solver worked, but at shallow light angles it made the vertical walls dominate.
// Weight focused sunlight by the actual receiver normal: floor = 1.0, side walls ~= 0.14.
// This does not fake a floor texture; the focus value is still produced by live refracted rays.
const oldReceiver = `        let receiverLight = 0.38 + 0.62 * receiverCos;
        causticFocus = min(5.2, focused * deposit * incidence * receiverLight *
                           fresnelLoss * sunAbove * sunScale * unoccluded * 1.35);`;
const newReceiver = `        let floorPreference = clamp(0.14 + 0.86 * max(h0.n.y, 0.0), 0.14, 1.0);
        let receiverLight = (0.18 + 0.82 * receiverCos) * floorPreference;
        causticFocus = min(5.2, focused * deposit * incidence * receiverLight *
                           fresnelLoss * sunAbove * sunScale * unoccluded * 1.35);`;
if (!source.includes(oldReceiver)) throw new Error('Fluid V4.3.2: V4.3.1 receiver block changed.');
source = source.replace(oldReceiver, newReceiver);

source = source.replace(
  "if (stats && !stats.textContent.includes('ray-caustics')) stats.textContent += ' · ray-caustics · sun-linked · high-contrast';",
  "if (stats && !stats.textContent.includes('ray-caustics')) stats.textContent += ' · ray-caustics · floor-directed';"
);
source = source.replace(
  "console.info('[Fluid V4.3.2] high-contrast realtime refracted-sun caustics enabled.');",
  "console.info('[Fluid V4.3.2] floor-directed realtime refracted-sun caustics enabled.');"
);

const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}

// Install elevation + azimuth controls only after the normal lighting UI has bound itself.
await import(angleUrl);
