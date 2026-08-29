// Fluid V5 M6.7 waterfall render ownership.
// The tagged PBF parcels remain fully present in the physics solve, neighbour grid, density solve,
// collisions and impact response. This module only removes those solver-scale carrier parcels from
// the *generic pool SSFR splat* so the dedicated particle-density waterfall reconstruction is the
// sole visible surface for airborne waterfall water. Once a parcel loses the waterfall tag at pool
// contact it automatically returns to the normal pool SSFR path.

const sim=window.__sim,ssfr=window.__ssfr;
if(!sim?.dev||!ssfr?.dev)throw new Error('Fluid V5 M6.7 SSFR mask: runtime unavailable.');

const dev=ssfr.dev;
const TAG=window.__v5WaterfallTag||0x5746;
const UPSTREAM='https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/src/';
const SW=await import(UPSTREAM+'ssfr_wgsl.js');

const oldGuard=`if (S.skipBodies != 0u && phase[ii].x != 0u) {
    o.clip = vec4f(2.0, 2.0, 2.0, 1.0);
    return o;
  }`;
const tagHex='0x'+Number(TAG>>>0).toString(16)+'u';
const newGuard=`if ((S.skipBodies != 0u && phase[ii].x != 0u) || phase[ii].w == ${tagHex}) {
    o.clip = vec4f(2.0, 2.0, 2.0, 1.0);
    return o;
  }`;

if(!SW.splatPrelude.includes(oldGuard))throw new Error('Fluid V5 M6.7 SSFR mask: upstream splat guard signature changed.');
const prelude=SW.splatPrelude.replace(oldGuard,newGuard);

const makeModule=(src,label)=>dev.createShaderModule({code:prelude+src,label});
const depthMod=makeModule(SW.depthFS,'fluidV5M67SSFRDepthWGSL');
const thickMod=makeModule(SW.thickFS,'fluidV5M67SSFRThickWGSL');

for(const [label,mod] of [['depth',depthMod],['thickness',thickMod]]){
 if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error(`Fluid V5 M6.7 ${label} WGSL: `+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
 }
}

ssfr.pipeDepth=await dev.createRenderPipelineAsync({
 label:'fluidV5M67SSFRDepthMask',layout:'auto',
 vertex:{module:depthMod,entryPoint:'vs'},
 fragment:{module:depthMod,entryPoint:'fs',targets:[{format:'r32float'}]},
 primitive:{topology:'triangle-strip'},
 depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}
});

ssfr.pipeThick=await dev.createRenderPipelineAsync({
 label:'fluidV5M67SSFRThicknessMask',layout:'auto',
 vertex:{module:thickMod,entryPoint:'vs'},
 fragment:{module:thickMod,entryPoint:'fs',targets:[{
  format:'r16float',
  blend:{color:{srcFactor:'one',dstFactor:'one'},alpha:{srcFactor:'one',dstFactor:'one'}}
 }]},
 primitive:{topology:'triangle-strip'}
});

// Force bind groups to be rebuilt against the replacement pipeline layouts.
ssfr.bindCache=null;
window.__v5WaterfallSSFRM67={
 online:true,
 backend:'physics-carrier-hidden-from-generic-ssfr-m67',
 tag:TAG,
 physicsUntouched:true,
 genericSSFRMasked:true,
 densityRendererOwnsAirborneSurface:true
};
console.info('[Fluid V5 M6.7] waterfall PBF carrier remains physical but is hidden from generic pool SSFR.');
