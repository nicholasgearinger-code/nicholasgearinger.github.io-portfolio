// Fluid V8 M8.3.1 — iOS/WebKit WGSL reserved-word compatibility shim.
// WebKit's current WGSL parser rejects `target` as an identifier. Some restored
// M7.5.x shaders predate that restriction. Rewrite the reserved identifier before
// shader compilation so the original physics code can run unchanged.

const sim=window.__sim;
if(!sim?.dev) throw new Error('M8.3.1 WGSL compatibility: GPU device unavailable.');
const dev=sim.dev;
const baseCreateShaderModule=dev.createShaderModule.bind(dev);
let patchedModules=0;

dev.createShaderModule=function(desc){
  if(desc?.code&&typeof desc.code==='string'&&/\btarget\b/.test(desc.code)){
    desc={...desc,code:desc.code.replace(/\btarget\b/g,'flowTarget')};
    patchedModules++;
    console.info('[Fluid V8 M8.3.1] patched WGSL reserved identifier in',desc.label||'shader');
  }
  return baseCreateShaderModule(desc);
};

window.__v5M831WGSLCompat={online:true,backend:'webkit-reserved-word-rewrite-m831',get patchedModules(){return patchedModules}};
console.info('[Fluid V8 M8.3.1] iOS/WebKit WGSL reserved-word compatibility online.');
