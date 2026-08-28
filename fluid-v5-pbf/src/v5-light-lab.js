// Fluid V5 M3.5 atmosphere controller.
// Reuses the validated M3.3 time-of-day UI/receiver pass, keeps the WebKit WGSL fixes, hands
// Night to the dedicated submerged-light renderer, and permits a true zero-sun Night state.

const sourceUrl = 'https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/1e677b1526b684b1eb9cd044e640d322d5f2075a/fluid-v5-pbf/src/v5-light-lab.js';
const response = await fetch(sourceUrl, { cache: 'no-store' });
if (!response.ok) throw new Error(`Fluid V5 M3.5 atmosphere source unavailable (${response.status}).`);
let src = await response.text();
const presetUrl = new URL('./v5-light-presets.js', import.meta.url).href;
src = src.replace("from './v5-light-presets.js'", `from '${presetUrl}'`);

// WebKit WGSL: `meta` is reserved on the iPhone compiler used by this lab.
src = src.replace(
  'struct Light { meta:vec4f, color:vec4f, pos:vec4f, dir:vec4f, extra:vec4f, water:vec4f }',
  'struct Light { cfg:vec4f, color:vec4f, pos:vec4f, dir:vec4f, extra:vec4f, water:vec4f }'
);
src = src.replaceAll('L.meta', 'L.cfg');

// The dedicated Night renderer owns all submerged fixture lighting; do not stack M3.3's old pass.
const writeNeedle = '    dev.queue.writeBuffer(lightUni,0,LF);';
const writePatch = "    dev.queue.writeBuffer(lightUni,0,LF);\n    if(state.time==='night'&&window.__v5DedicatedNightPool){return out;}";
if (!src.includes(writeNeedle)) throw new Error('Fluid V5 M3.5 atmosphere: night handoff signature changed.');
src = src.replace(writeNeedle, writePatch);

// A black HDR Night must really have no solar source. M3.3 kept a 0.001 safety floor.
const sunNeedle = "  ssfr.sunIntensity=Math.max(.001,mood.sunIntensity*4.8);";
const sunPatch = "  ssfr.sunIntensity=state.time==='night'?0.0:Math.max(0.0,mood.sunIntensity*4.8);";
if (!src.includes(sunNeedle)) throw new Error('Fluid V5 M3.5 atmosphere: sun intensity signature changed.');
src = src.replace(sunNeedle, sunPatch);

src = src.replaceAll("backend:'time-of-day-m33'", "backend:'time-of-day-m35'");
src = src.replaceAll("version:'M3.3'", "version:'M3.5'");
src = src.replaceAll('Fluid V5 M3.3', 'Fluid V5 M3.5');
const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
try { await import(blobUrl); }
finally { URL.revokeObjectURL(blobUrl); }
if (window.__v5LightStatus) window.__v5LightStatus.backend = 'time-of-day-m35';
console.info('[Fluid V5 M3.5] true-HDR Day/Sunset controller enabled; black Night handed to submerged fixtures.');
