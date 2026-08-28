// Fluid V5 M3.4.6 atmosphere loader.
// Day/Sunset retain the validated water-surface mood pass while the environment module supplies
// linear Radiance panorama lighting. Night hands all local lighting to the smooth six-fixture renderer.

const sourceUrl = 'https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/1e677b1526b684b1eb9cd044e640d322d5f2075a/fluid-v5-pbf/src/v5-light-lab.js';
const response = await fetch(sourceUrl, { cache: 'no-store' });
if (!response.ok) throw new Error(`Fluid V5 M3.4.6 atmosphere source unavailable (${response.status}).`);
let src = await response.text();
const presetUrl = new URL('./v5-light-presets.js', import.meta.url).href;
src = src.replace("from './v5-light-presets.js'", `from '${presetUrl}'`);

// WebKit WGSL: `meta` is reserved on the iPhone compiler used by this lab.
src = src.replace(
  'struct Light { meta:vec4f, color:vec4f, pos:vec4f, dir:vec4f, extra:vec4f, water:vec4f }',
  'struct Light { cfg:vec4f, color:vec4f, pos:vec4f, dir:vec4f, extra:vec4f, water:vec4f }'
);
src = src.replaceAll('L.meta', 'L.cfg');

// The dedicated Night renderer owns Night. Do not stack the inherited four-light overlay.
const writeNeedle = '    dev.queue.writeBuffer(lightUni,0,LF);';
const writePatch = "    dev.queue.writeBuffer(lightUni,0,LF);\n    if(state.time==='night'&&window.__v5DedicatedNightPool){return out;}";
if (!src.includes(writeNeedle)) throw new Error('Fluid V5 M3.4.6 atmosphere: night handoff signature changed.');
src = src.replace(writeNeedle, writePatch);

src = src.replaceAll("backend:'time-of-day-m33'", "backend:'time-of-day-m346'");
src = src.replaceAll("version:'M3.3'", "version:'M3.4.6'");
src = src.replaceAll('Fluid V5 M3.3', 'Fluid V5 M3.4.6');
const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
if (window.__v5LightStatus) window.__v5LightStatus.backend = 'time-of-day-m346';
console.info('[Fluid V5 M3.4.6] Day/Sunset atmosphere enabled; Night handed to smooth submerged fixtures.');
