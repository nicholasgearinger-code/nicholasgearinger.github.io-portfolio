// Fluid V5 M6.9 secondary-water realism.
// Keeps the existing PBF-derived spray/foam/bubble emitter, but makes secondary water truly
// secondary: much smaller screen-space droplets, lower spawn probability, and softer opacity.
// Primary liquid mass and dynamics are untouched in every scene.

const sourceUrl='https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/97dc07a5164520c388d9cd4543de6bd45fec86ed/fluid-v5-pbf/src/v5-whitewater-m41.js';
const r=await fetch(sourceUrl,{cache:'no-store'});
if(!r.ok)throw new Error(`Fluid V5 M6.9 whitewater source unavailable (${r.status}).`);
let src=await r.text();

// Solver-scale splash particles were visually reading as golf-ball-sized blobs. Keep the physical
// spawn signal, but render the secondary phase as fine droplets/foam/bubbles instead.
const sizeOld='var px=mix(2.1,3.8,step(.5,kind));if(kind>1.5){px=3.0;}';
const sizeNew='var px=mix(.62,1.38,step(.5,kind));if(kind>1.5){px=1.05;}';
if(!src.includes(sizeOld))throw new Error('Fluid V5 M6.9 whitewater size signature changed.');
src=src.replace(sizeOld,sizeNew);
src=src.replace('dir*q.y*base.y*2.6','dir*q.y*base.y*3.55');

// Fewer droplets, generated only from stronger actual PBF ejection/impact events.
src=src.replace('*.010*strength','*.0052*strength');
src=src.replace('0.0,.095)','0.0,.045)');
src=src.replace('*.003+slope*.006+impact*.004','*.0022+slope*.0042+impact*.0032');
src=src.replace('0.0,.055)','0.0,.038)');
src=src.replace('*.0025*strength','*.0018*strength');
src=src.replace('0.0,.026)','0.0,.018)');

// Keep UI strength meaningful, but make the visual population less aggressive globally.
src=src.replace('strength=state.whitewater*(window.__v5AutoBudget?.secondaryScale??1)',
 'strength=state.whitewater*.72*(window.__v5AutoBudget?.secondaryScale??1)');

const old=`@fragment fn fs(v:V)->@location(0)vec4f{let r=length(v.uv);if(r>1){discard;}let edge=1.0-smoothstep(.50,1.0,r);if(v.kind>1.5){let ring=smoothstep(.76,.48,r)*smoothstep(.18,.42,r);return vec4f(vec3f(.54,.90,1.0),ring*v.alpha*.42);}let foam=step(.5,v.kind);let col=mix(vec3f(.78,.94,1.0),vec3f(.96,1.0,.98),vec3f(foam));let a=edge*v.alpha*mix(.78,.58,foam);return vec4f(col,a);}`;
const neu=`@fragment fn fs(v:V)->@location(0)vec4f{let r=length(v.uv);if(r>1){discard;}if(v.kind>1.5){let ring=smoothstep(.84,.55,r)*smoothstep(.15,.37,r);let inner=(1.0-smoothstep(.30,.76,r))*.045;return vec4f(vec3f(.40,.83,.96)*ring+vec3f(.10,.28,.39)*inner,(ring*.25+inner)*v.alpha);}if(v.kind>.5){let edge=1.0-smoothstep(.46,1.0,r);let grain=.91+.09*cos((v.uv.x+v.uv.y)*20.0);return vec4f(vec3f(.975,1.0,.99)*grain,edge*v.alpha*.38);}let z=sqrt(max(0.0,1.0-r*r));let fres=.0204+(1.0-.0204)*pow(1.0-z,5.0);let rim=smoothstep(.46,1.0,r);let centre=1.0-smoothstep(.0,.90,r);let base=vec3f(.20,.58,.78)*(.13+.15*centre);let col=base+vec3f(.80,.95,1.0)*(fres*.95+rim*.12);let a=v.alpha*(.045*centre+.24*rim+.26*fres);return vec4f(col,a);}`;
if(!src.includes(old))throw new Error('Fluid V5 M6.9 whitewater fragment signature changed.');
src=src.replace(old,neu);

src=src.replaceAll('M4.1','M6.9').replaceAll('spray-foam-bubble-m41','fine-physical-secondary-m69').replaceAll('fluidV5M41','fluidV5M69');
const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blob);}finally{URL.revokeObjectURL(blob);}
if(window.__v5WhitewaterM69){window.__v5WhitewaterM54=window.__v5WhitewaterM69;window.__v5WhitewaterM54.backend='fine-physical-secondary-m69';}
console.info('[Fluid V5 M6.9] globally finer PBF-triggered spray / foam / bubbles online.');
