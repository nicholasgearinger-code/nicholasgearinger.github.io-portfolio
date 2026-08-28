// Fluid V5 M3.4.1 iOS WGSL hotfix loader.
// M3.4's night renderer was rejected by WebKit because the uniform member `meta` is reserved.
// Load the exact M3.4 source, rename all potentially troublesome Night-uniform members, then run it.

const sourceUrl = 'https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/1e677b1526b684b1eb9cd044e640d322d5f2075a/fluid-v5-pbf/src/v5-night-pool-m34.js';
const response = await fetch(sourceUrl, { cache: 'no-store' });
if (!response.ok) throw new Error(`Fluid V5 M3.4.1 night source unavailable (${response.status}).`);
let src = await response.text();
src = src.replace(
  'struct Night { meta:vec4f, base:vec4f, accent:vec4f, extra:vec4f }',
  'struct Night { cfg:vec4f, colA:vec4f, colB:vec4f, tune:vec4f }'
);
src = src.replaceAll('N.meta', 'N.cfg');
src = src.replaceAll('N.base', 'N.colA');
src = src.replaceAll('N.accent', 'N.colB');
src = src.replaceAll('N.extra', 'N.tune');
src = src.replaceAll("backend:'six-fixture-m34'", "backend:'six-fixture-m341'");
src = src.replaceAll('fluidV5NightPoolM34', 'fluidV5NightPoolM341');
src = src.replaceAll('fluidV5TrueNightPoolM34', 'fluidV5TrueNightPoolM341');
src = src.replaceAll("lab.version='M3.4'", "lab.version='M3.4.1'");
src = src.replaceAll('Fluid V5 M3.4', 'Fluid V5 M3.4.1');
const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}
if (window.__v5NightPoolStatus) window.__v5NightPoolStatus.backend = 'six-fixture-m341';
setTimeout(() => {
  const brand = document.querySelector('.hud.card.title');
  if (brand) brand.textContent = 'FLUID V5 · M3.4.1';
  document.title = 'Fluid V5 · M3.4.1 TRUE NIGHT POOL';
  window.__fluidV5Version = '5.1.4.1-m341';
}, 1600);
console.info('[Fluid V5 M3.4.1] iOS-safe six-fixture night pool shader enabled.');
