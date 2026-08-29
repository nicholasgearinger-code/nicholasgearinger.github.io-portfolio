// Fluid V5 M5.9 refractive whitewater optics.
// Loads the M4.1 spray/foam/bubble simulation but makes airborne spray substantially finer and
// more numerous, then applies the refractive M5.4 shading. The PBF solver mass is untouched.

const sourceUrl='https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/97dc07a5164520c388d9cd4543de6bd45fec86ed/fluid-v5-pbf/src/v5-whitewater-m41.js';
const r=await fetch(sourceUrl,{cache:'no-store'});if(!r.ok)throw new Error(`Fluid V5 M5.9 whitewater source unavailable (${r.status}).`);let src=await r.text();

// Smaller spray sprites, slightly longer along velocity. Foam and bubbles stay readable but are
// reduced too, so secondary water no longer competes with the real pool surface at solver scale.
const sizeOld='var px=mix(2.1,3.8,step(.5,kind));if(kind>1.5){px=3.0;}';
const sizeNew='var px=mix(1.15,2.55,step(.5,kind));if(kind>1.5){px=1.85;}';
if(!src.includes(sizeOld))throw new Error('Fluid V5 M5.9 whitewater size signature changed.');
src=src.replace(sizeOld,sizeNew);
src=src.replace('dir*q.y*base.y*2.6','dir*q.y*base.y*3.25');
// Preserve roughly the same visual spray volume by allowing a few more much-smaller droplets.
src=src.replace('* .010*strength','* .010*strength'); // no-op guard for alternate formatting
src=src.replace('*.010*strength','*.013*strength');

const old=`@fragment fn fs(v:V)->@location(0)vec4f{let r=length(v.uv);if(r>1){discard;}let edge=1.0-smoothstep(.50,1.0,r);if(v.kind>1.5){let ring=smoothstep(.76,.48,r)*smoothstep(.18,.42,r);return vec4f(vec3f(.54,.90,1.0),ring*v.alpha*.42);}let foam=step(.5,v.kind);let col=mix(vec3f(.78,.94,1.0),vec3f(.96,1.0,.98),vec3f(foam));let a=edge*v.alpha*mix(.78,.58,foam);return vec4f(col,a);}`;
const neu=`@fragment fn fs(v:V)->@location(0)vec4f{let r=length(v.uv);if(r>1){discard;}if(v.kind>1.5){let ring=smoothstep(.82,.54,r)*smoothstep(.16,.39,r);let inner=(1.0-smoothstep(.32,.78,r))*.07;return vec4f(vec3f(.45,.88,1.0)*ring+vec3f(.12,.34,.46)*inner,(ring*.38+inner)*v.alpha);}if(v.kind>.5){let edge=1.0-smoothstep(.48,1.0,r);let grain=.90+.10*cos((v.uv.x+v.uv.y)*18.0);return vec4f(vec3f(.97,1.0,.985)*grain,edge*v.alpha*.56);}let z=sqrt(max(0.0,1.0-r*r));let fres=.0204+(1.0-.0204)*pow(1.0-z,5.0);let rim=smoothstep(.42,1.0,r);let centre=1.0-smoothstep(.0,.92,r);let base=vec3f(.26,.69,.90)*(.22+.22*centre);let spectral=vec3f(1.04,1.0,.97)*rim*.24;let col=base+spectral+vec3f(.76,.94,1.0)*fres*1.35;let a=v.alpha*(.10*centre+.48*rim+.42*fres);return vec4f(col,a);}`;
if(!src.includes(old))throw new Error('Fluid V5 M5.9 whitewater render signature changed.');src=src.replace(old,neu);src=src.replaceAll('M4.1','M5.9').replaceAll('spray-foam-bubble-m41','fine-refractive-whitewater-m59').replaceAll('fluidV5M41','fluidV5M59');
const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));try{await import(blob)}finally{URL.revokeObjectURL(blob)}
if(window.__v5WhitewaterM41){window.__v5WhitewaterM54=window.__v5WhitewaterM41;window.__v5WhitewaterM54.backend='fine-refractive-whitewater-m59';}
console.info('[Fluid V5 M5.9] fine refractive spray / foam / bubble optics online.');
