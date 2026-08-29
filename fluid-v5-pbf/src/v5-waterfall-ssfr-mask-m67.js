// Fluid V5 M6.7 waterfall render ownership + macro-blob cleanup.
// The tagged PBF parcels remain fully present in the physics solve, neighbour grid, density solve,
// collisions and impact response. This module only removes solver-scale airborne parcels from the
// *generic pool SSFR splat* so the dedicated particle-density waterfall reconstruction owns the
// visible waterfall body. M5.9 microdrops remain render-only and are also kept out of generic SSFR.

const sim=window.__sim,ssfr=window.__ssfr,state=window.__v5State;
if(!sim?.dev||!ssfr?.dev||!state)throw new Error('Fluid V5 M6.7 SSFR mask: runtime unavailable.');

const dev=ssfr.dev;
const TAG=window.__v5WaterfallTag||0x5746;
const DROP_TAG=0x4452; // M5.9 "DR" microdrop tag.
const UPSTREAM='https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/src/';
const SW=await import(UPSTREAM+'ssfr_wgsl.js');

const oldGuard=`if (S.skipBodies != 0u && phase[ii].x != 0u) {
    o.clip = vec4f(2.0, 2.0, 2.0, 1.0);
    return o;
  }`;
const tagHex='0x'+Number(TAG>>>0).toString(16)+'u';
const dropHex='0x'+Number(DROP_TAG>>>0).toString(16)+'u';
const newGuard=`if ((S.skipBodies != 0u && phase[ii].x != 0u) ||
      phase[ii].w == ${tagHex} || phase[ii].w == ${dropHex} ||
      (S.pad0 > 0.0 && smoothPos[ii].y > S.pad0)) {
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

function slabSurfaceY(){
 const b=sim.params.box,d=sim.params.spacing,margin=d;
 const nx=Math.max(1,Math.floor((b[0]-2*margin)/d));
 const nz=Math.max(1,Math.floor((b[2]-2*margin)/d));
 const baseFluid=Math.max(1,Number(sim.scene?.nFluid)||Math.max(1,sim.n-(sim.nBodyParts||0)));
 const layers=Math.max(1,Math.ceil(baseFluid/(nx*nz)));
 return Math.min(b[1]-d*2,Math.max(d*2,margin+layers*d));
}

// Splat.pad0 was unused upstream. In Waterfall mode it now carries a render-only airborne cutoff.
// This catches any carrier parcel whose temporary tag was lost before impact and prevents it from
// becoming a giant SSFR ellipsoid in the sky. Physics buffers and particle positions are untouched.
const baseWriteSplat=ssfr.writeSplat.bind(ssfr);
ssfr.writeSplat=function(slot,...args){
 const out=baseWriteSplat(slot,...args);
 const on=state.scenario==='waterfall-m62';
 this.sF[55]=on?slabSurfaceY()+sim.params.spacing*1.15:0;
 this.dev.queue.writeBuffer(this.splatUni[slot],0,this.sF);
 return out;
};

// Force bind groups to be rebuilt against the replacement pipeline layouts.
ssfr.bindCache=null;
window.__v5WaterfallSSFRM67={
 online:true,
 backend:'waterfall-airborne-macro-cull-m67',
 tag:TAG,
 dropTag:DROP_TAG,
 physicsUntouched:true,
 genericSSFRMasked:true,
 microdropMacroSplatMasked:true,
 airborneMacroCull:true,
 densityRendererOwnsAirborneSurface:true
};
console.info('[Fluid V5 M6.7] tagged waterfall + microdrop macro splats hidden; airborne generic SSFR culled in Waterfall mode.');
