// Fluid V5 M3.4.6 smooth true-night-pool loader.
// Reuses the validated M3.4.4 broad-flood path, but removes its quantized six-band volume fill,
// lowers the lit receiver to the actual water zone, and smoothly blends all six submerged fixtures.

const sourceUrl='https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/4da9bfef1f375cb122e7edca09df4b5a6606db30/fluid-v5-pbf/src/v5-night-pool-m34.js';
const response=await fetch(sourceUrl,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M3.4.6 night base unavailable (${response.status}).`);
let src=await response.text();
const patch=(a,b,label)=>{if(!src.includes(a))throw new Error(`Fluid V5 M3.4.6 night patch: ${label} signature changed.`);src=src.replace(a,b);};

// The M3.4.4 wrapper inserts a receiver waterline at 40% of the box. Bring that down near the
// actual shallow pool level so the flood lights stop climbing the full-height walls.
src=src.replaceAll('let waterTop=lo.y+(hi.y-lo.y)*.40;','let waterTop=lo.y+(hi.y-lo.y)*.30;');

// The underlying M3.4 shader has a separate beam waterline at 39%. Inject an extra patch into the
// M3.4.4 wrapper immediately after its WebKit uniform renames.
patch(
  "src = src.replaceAll('N.extra', 'N.tune');",
  "src = src.replaceAll('N.extra', 'N.tune');\nsrc = src.replaceAll('let waterTop=lo.y+(hi.y-lo.y)*.39;', 'let waterTop=lo.y+(hi.y-lo.y)*.30;');",
  'beam waterline injection'
);

// Replace the discrete Z-zone selector that produced six vertical rainbow bands. Three overlapping
// longitudinal weights are blended on each wall, then left/right colors are smoothly mixed across X.
patch(
  'let zone=clamp(floor((h.p.z-lo.z)/max(hi.z-lo.z,1e-4)*6.0),0.0,5.0);let fillCol=fixtureColor(zone);',
  'let tx=clamp((h.p.x-lo.x)/max(hi.x-lo.x,1e-4),0.0,1.0);let tz=clamp((h.p.z-lo.z)/max(hi.z-lo.z,1e-4),0.0,1.0);let w0=exp(-pow((tz-.17)/.26,2.0));let w1=exp(-pow((tz-.50)/.26,2.0));let w2=exp(-pow((tz-.83)/.26,2.0));let ws=max(w0+w1+w2,1e-4);let left=(fixtureColor(0.0)*w0+fixtureColor(1.0)*w1+fixtureColor(2.0)*w2)/ws;let right=(fixtureColor(3.0)*w0+fixtureColor(4.0)*w1+fixtureColor(5.0)*w2)/ws;let fillCol=mix(left,right,vec3f(smoothstep(.12,.88,tx)));',
  'smooth six-fixture volume blend'
);

// Keep the broad water glow, but reduce the artificial global fill now that all six lights overlap.
src=src.replaceAll('(.075+.105*submerged)','(.035+.060*submerged)');

// M3.4.6 diagnostics/versioning.
src=src.replaceAll('six-fixture-flood-m344','six-fixture-smooth-m346');
src=src.replaceAll('M3.4.4','M3.4.6');
src=src.replaceAll('5.1.4.4-m344','5.1.4.6-m346');
src=src.replaceAll('broad-flood six-fixture night lighting and water-volume fill enabled.','smooth six-fixture underwater flood blending enabled.');

window.__v5DedicatedNightPool=false;
const blobUrl=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{
  await import(blobUrl);
  window.__v5DedicatedNightPool=true;
}finally{
  URL.revokeObjectURL(blobUrl);
}
if(window.__v5NightPoolStatus){
  window.__v5NightPoolStatus.backend='six-fixture-smooth-m346';
  window.__v5NightPoolStatus.fixtures=6;
}
setTimeout(()=>{
  const brand=document.querySelector('.hud.card.title');
  if(brand)brand.textContent='FLUID V5 · M3.4.6';
  document.title='Fluid V5 · M3.4.6 LINEAR HDR + SMOOTH NIGHT';
  window.__fluidV5Version='5.1.4.6-m346';
},1080);
console.info('[Fluid V5 M3.4.6] smooth six-fixture Night renderer enabled; quantized color bands removed.');
