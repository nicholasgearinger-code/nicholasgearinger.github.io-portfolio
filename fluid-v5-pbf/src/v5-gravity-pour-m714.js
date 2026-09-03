// Fluid V5 M7.1.4 gravity-pour hotfix.
// Fixes the M7.1.3 GPU seed-uniform packing bug that prevented any primary water from moving
// into the elevated reservoir. The WGSL Cfg layout is g0,g1,g2,dims,meta,pad0,pad1, so dims must
// begin at u32 word 12 and meta at word 16. M7.1.3 accidentally wrote them at 8 and 12, leaving
// C.meta.x == 0; every seed shader invocation therefore returned immediately.

const sourceUrl='https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/6761c9b192f97b3323d8e0c98f4417ddda867557/fluid-v5-pbf/src/v5-gravity-pour-m71.js';
const response=await fetch(sourceUrl,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M7.1.4: unable to load M7.1.3 gravity source (${response.status}).`);
let src=await response.text();

const bad=`SU[8]=g.upperNx;SU[9]=g.upperNz;SU[10]=g.lowerNx;SU[11]=g.lowerNz;SU[12]=sim.n;SU[13]=g.upperN;SU[14]=g.nFluid;SU[15]=0;`;
const good=`// Cfg word layout: g0=0..3, g1=4..7, g2=8..11, dims=12..15, meta=16..19.\n SU[12]=g.upperNx;SU[13]=g.upperNz;SU[14]=g.lowerNx;SU[15]=g.lowerNz;\n SU[16]=sim.n;SU[17]=g.upperN;SU[18]=g.nFluid;SU[19]=0;`;
if(!src.includes(bad))throw new Error('Fluid V5 M7.1.4: seed-uniform packing signature changed.');
src=src.replace(bad,good);

src=src.replaceAll('M7.1.3','M7.1.4').replaceAll('M713','M714');
const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blob);}finally{URL.revokeObjectURL(blob);}

if(window.__v5GravityPourM71){
 window.__v5GravityPourM71.backend='physical-gated-pour-m714-seed-layout-fixed';
 window.__v5GravityPourM71.seedUniformLayoutFixed=true;
 window.__v5GravityPourM71.seedDimsWord=12;
 window.__v5GravityPourM71.seedMetaWord=16;
}
console.info('[Fluid V5 M7.1.4] gravity-pour seed uniform layout fixed; elevated primary water can now be seeded.');
