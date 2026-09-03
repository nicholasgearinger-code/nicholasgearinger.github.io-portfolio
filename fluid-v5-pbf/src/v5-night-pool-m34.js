// Fluid V5 M3.5 photometric night-pool loader.
// Reuses the validated M3.4.4 six-flood backend, but replaces the old global/striped fill with
// distance-weighted pools around the actual six fixtures. The fixtures still overlap enough to
// illuminate the water volume, while the surrounding receiver remains dark.

const sourceUrl='https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/4da9bfef1f375cb122e7edca09df4b5a6606db30/fluid-v5-pbf/src/v5-night-pool-m34.js';
const response=await fetch(sourceUrl,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M3.5 night base unavailable (${response.status}).`);
let src=await response.text();
const patch=(a,b,label)=>{if(!src.includes(a))throw new Error(`Fluid V5 M3.5 night patch: ${label} signature changed.`);src=src.replace(a,b);};

// Keep every pool fixture and volumetric beam below the physical shallow-water region.
src=src.replaceAll('let waterTop=lo.y+(hi.y-lo.y)*.40;','let waterTop=lo.y+(hi.y-lo.y)*.30;');
patch(
  "src = src.replaceAll('N.extra', 'N.tune');",
  "src = src.replaceAll('N.extra', 'N.tune');\nsrc = src.replaceAll('let waterTop=lo.y+(hi.y-lo.y)*.39;', 'let waterTop=lo.y+(hi.y-lo.y)*.30;');",
  'beam waterline injection'
);

// Replace M3.4.4's nearest Z band with six smooth radial influence fields in normalized pool X/Z.
// This produces localized light pools around each wall fixture rather than flat rainbow walls.
patch(
  'let zone=clamp(floor((h.p.z-lo.z)/max(hi.z-lo.z,1e-4)*6.0),0.0,5.0);let fillCol=fixtureColor(zone);',
  'let tx=clamp((h.p.x-lo.x)/max(hi.x-lo.x,1e-4),0.0,1.0);let tz=clamp((h.p.z-lo.z)/max(hi.z-lo.z,1e-4),0.0,1.0);let p2=vec2f(tx,tz);let d0=dot(p2-vec2f(.03,.17),p2-vec2f(.03,.17));let d1=dot(p2-vec2f(.03,.50),p2-vec2f(.03,.50));let d2=dot(p2-vec2f(.03,.83),p2-vec2f(.03,.83));let d3=dot(p2-vec2f(.97,.17),p2-vec2f(.97,.17));let d4=dot(p2-vec2f(.97,.50),p2-vec2f(.97,.50));let d5=dot(p2-vec2f(.97,.83),p2-vec2f(.97,.83));let w0=exp(-d0*5.6);let w1=exp(-d1*5.6);let w2=exp(-d2*5.6);let w3=exp(-d3*5.6);let w4=exp(-d4*5.6);let w5=exp(-d5*5.6);let fillWeight=w0+w1+w2+w3+w4+w5;let fillCol=(fixtureColor(0.0)*w0+fixtureColor(1.0)*w1+fixtureColor(2.0)*w2+fixtureColor(3.0)*w3+fixtureColor(4.0)*w4+fixtureColor(5.0)*w5)/max(fillWeight,1e-4);',
  'radial six-fixture fill'
);

// M3.4.4 had a broad global fill. Keep only a local in-scattering pedestal, scaled by proximity
// to the six fixtures, while leaving the direct receiver cones and lamp sprites bright.
src=src.replaceAll('(.075+.105*submerged)','(.018+.070*submerged)*clamp(fillWeight*.34,0.0,1.0)');

// Slightly compress the widest flood reach so opposite walls do not become uniformly pastel.
src=src.replaceAll('2.30','2.05');

// Keep direct lamps punchy while reducing giant soft halos around them.
src=src.replaceAll('halo*.34','halo*.22');

src=src.replaceAll('six-fixture-flood-m344','six-fixture-photometric-m35');
src=src.replaceAll('M3.4.4','M3.5');
src=src.replaceAll('5.1.4.4-m344','5.1.5-m35');
src=src.replaceAll('broad-flood six-fixture night lighting and water-volume fill enabled.','photometric six-fixture night pools and localized water-volume fill enabled.');

window.__v5DedicatedNightPool=false;
const blobUrl=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blobUrl);window.__v5DedicatedNightPool=true;}finally{URL.revokeObjectURL(blobUrl);}
if(window.__v5NightPoolStatus){window.__v5NightPoolStatus.backend='six-fixture-photometric-m35';window.__v5NightPoolStatus.fixtures=6;}
setTimeout(()=>{
  const brand=document.querySelector('.hud.card.title');if(brand)brand.textContent='FLUID V5 · M3.5';
  document.title='Fluid V5 · M3.5 TRUE HDR IBL';window.__fluidV5Version='5.1.5-m35';
},1080);
console.info('[Fluid V5 M3.5] localized six-fixture Night renderer enabled.');
