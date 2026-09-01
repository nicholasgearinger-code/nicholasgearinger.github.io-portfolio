// Fluid V8 M8.7.0.1 — WebKit WGSL compatibility for the M8.7 glass collider.
// WGSL multi-component swizzles (for example v.xz) are values, not assignable references.
// Patch only the M8.7 glass shader at createShaderModule time, then restore the native method
// after the pitcher scene has finished creating its compute pipeline.

const sim=window.__sim;
if(!sim?.dev)throw new Error('M8.7.0.1 WGSL compat: GPU device unavailable.');
const dev=sim.dev;
const nativeCreateShaderModule=dev.createShaderModule.bind(dev);
let patched=0,restored=false;

function patchGlassWGSL(code){
  let out=String(code);
  const edits=[
    ["v.xz*=.86;","v=vec3f(v.x*.86,v.y,v.z*.86);"],
    ["let vr=dot(v.xz,dir);v.xz-=dir*vr*.55;","let vr=dot(v.xz,dir);let nv=v.xz-dir*vr*.55;v=vec3f(nv.x,v.y,nv.y);"],
    ["if(inside){p.xz=centre+dir*(inner-pad);let vr=dot(v.xz,dir);if(vr>0.0){v.xz-=dir*vr*1.22;}}","if(inside){let pxz=centre+dir*(inner-pad);p=vec3f(pxz.x,p.y,pxz.y);let vr=dot(v.xz,dir);if(vr>0.0){let nv=v.xz-dir*vr*1.22;v=vec3f(nv.x,v.y,nv.y);}}"],
    ["else{p.xz=centre+dir*(outer+pad);let vr=dot(v.xz,dir);if(vr<0.0){v.xz-=dir*vr*1.22;}}","else{let pxz=centre+dir*(outer+pad);p=vec3f(pxz.x,p.y,pxz.y);let vr=dot(v.xz,dir);if(vr<0.0){let nv=v.xz-dir*vr*1.22;v=vec3f(nv.x,v.y,nv.y);}}"],
    ["v.xz*=.94;","v=vec3f(v.x*.94,v.y,v.z*.94);"],
  ];
  let hits=0;
  for(const [from,to] of edits){
    if(out.includes(from)){out=out.replace(from,to);hits++;}
  }
  if(hits!==edits.length)throw new Error(`M8.7.0.1 WGSL compat: expected ${edits.length} swizzle edits, found ${hits}.`);
  if(/\.[xyzw]{2,}\s*(?:[+\-*\/])?=/.test(out))throw new Error('M8.7.0.1 WGSL compat: assignable multi-component swizzle remains.');
  return out;
}

function createShaderModuleCompat(desc){
  if(desc?.label==='m870GlassCollisionWGSL'&&typeof desc.code==='string'){
    patched++;
    return nativeCreateShaderModule({...desc,code:patchGlassWGSL(desc.code)});
  }
  return nativeCreateShaderModule(desc);
}

try{
  Object.defineProperty(dev,'createShaderModule',{configurable:true,writable:true,value:createShaderModuleCompat});
}catch(err){
  throw new Error('M8.7.0.1 WGSL compat could not patch createShaderModule: '+String(err?.message||err));
}

function restore(){
  if(restored)return;
  restored=true;
  try{Object.defineProperty(dev,'createShaderModule',{configurable:true,writable:true,value:nativeCreateShaderModule});}
  catch(err){console.warn('[M8.7.0.1 WGSL compat restore]',err);}
}

window.__v5M870WGSLCompat={online:true,backend:'webkit-no-swizzle-lvalue-m8701',restore,get patched(){return patched},get restored(){return restored}};
console.info('[Fluid V8 M8.7.0.1] WebKit-safe glass WGSL swizzle patch armed.');