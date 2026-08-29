// Fluid V5 M5.4 refractive whitewater optics.
// Loads the M4.1 spray/foam/bubble simulation but upgrades only the render fragment: airborne
// spray gets a transparent water body, strong Fresnel rim and slight spectral edge separation;
// foam remains diffuse and bubbles retain their ring response. No extra GPU bindings are added.

const sourceUrl='https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/97dc07a5164520c388d9cd4543de6bd45fec86ed/fluid-v5-pbf/src/v5-whitewater-m41.js';
const r=await fetch(sourceUrl,{cache:'no-store'});if(!r.ok)throw new Error(`Fluid V5 M5.4 whitewater source unavailable (${r.status}).`);let src=await r.text();
const old=`@fragment fn fs(v:V)->@location(0)vec4f{let r=length(v.uv);if(r>1){discard;}let edge=1.0-smoothstep(.50,1.0,r);if(v.kind>1.5){let ring=smoothstep(.76,.48,r)*smoothstep(.18,.42,r);return vec4f(vec3f(.54,.90,1.0),ring*v.alpha*.42);}let foam=step(.5,v.kind);let col=mix(vec3f(.78,.94,1.0),vec3f(.96,1.0,.98),vec3f(foam));let a=edge*v.alpha*mix(.78,.58,foam);return vec4f(col,a);}`;
const neu=`@fragment fn fs(v:V)->@location(0)vec4f{let r=length(v.uv);if(r>1){discard;}if(v.kind>1.5){let ring=smoothstep(.82,.54,r)*smoothstep(.16,.39,r);let inner=(1.0-smoothstep(.32,.78,r))*.07;return vec4f(vec3f(.45,.88,1.0)*ring+vec3f(.12,.34,.46)*inner,(ring*.38+inner)*v.alpha);}if(v.kind>.5){let edge=1.0-smoothstep(.48,1.0,r);let grain=.90+.10*cos((v.uv.x+v.uv.y)*18.0);return vec4f(vec3f(.97,1.0,.985)*grain,edge*v.alpha*.56);}let z=sqrt(max(0.0,1.0-r*r));let fres=.0204+(1.0-.0204)*pow(1.0-z,5.0);let rim=smoothstep(.42,1.0,r);let centre=1.0-smoothstep(.0,.92,r);let base=vec3f(.26,.69,.90)*(.22+.22*centre);let spectral=vec3f(1.04,1.0,.97)*rim*.24;let col=base+spectral+vec3f(.76,.94,1.0)*fres*1.35;let a=v.alpha*(.10*centre+.48*rim+.42*fres);return vec4f(col,a);}`;
if(!src.includes(old))throw new Error('Fluid V5 M5.4 whitewater render signature changed.');src=src.replace(old,neu);src=src.replaceAll('M4.1','M5.4').replaceAll('spray-foam-bubble-m41','refractive-whitewater-m54').replaceAll('fluidV5M41','fluidV5M54');
const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));try{await import(blob)}finally{URL.revokeObjectURL(blob)}
if(window.__v5WhitewaterM41){window.__v5WhitewaterM54=window.__v5WhitewaterM41;window.__v5WhitewaterM54.backend='refractive-whitewater-m54';}
console.info('[Fluid V5 M5.4] refractive spray / foam / bubble optics online.');
