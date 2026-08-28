// Fluid V5 M3.4.1 iOS WGSL hotfix loader.
// Load the exact M3.3 atmosphere source that M3.4 was built on, then rename the uniform member
// `meta`, which WebKit's WGSL compiler treats as a reserved word. The relative preset import is
// converted to an absolute module URL before the patched source is evaluated.

const sourceUrl = 'https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/1e677b1526b684b1eb9cd044e640d322d5f2075a/fluid-v5-pbf/src/v5-light-lab.js';
const response = await fetch(sourceUrl, { cache: 'no-store' });
if (!response.ok) throw new Error(`Fluid V5 M3.4.1 atmosphere source unavailable (${response.status}).`);
let src = await response.text();
const presetUrl = new URL('./v5-light-presets.js', import.meta.url).href;
src = src.replace("from './v5-light-presets.js'", `from '${presetUrl}'`);
src = src.replace(
  'struct Light { meta:vec4f, color:vec4f, pos:vec4f, dir:vec4f, extra:vec4f, water:vec4f }',
  'struct Light { cfg:vec4f, color:vec4f, pos:vec4f, dir:vec4f, extra:vec4f, water:vec4f }'
);
src = src.replaceAll('L.meta', 'L.cfg');
src = src.replaceAll("backend:'time-of-day-m33'", "backend:'time-of-day-m341'");
src = src.replaceAll('Fluid V5 M3.3', 'Fluid V5 M3.4.1');
const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
if (window.__v5LightStatus) window.__v5LightStatus.backend = 'time-of-day-m341';
console.info('[Fluid V5 M3.4.1] iOS-safe atmosphere shader enabled.');
