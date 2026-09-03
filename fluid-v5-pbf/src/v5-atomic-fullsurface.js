// Fluid V5 M2.7: camera-independent full-surface atomic caustics.
// Uses the complete live PBF particle position + density-gradient normal buffers as photon sources,
// then keeps the already-validated mobile resolve path: atomic<u32> -> r32uint sampled texture.

const sim = window.__sim;
const ssfr = window.__ssfr;
const state = window.__v5State;
if (!sim?.dev || !ssfr?.dev || !state) throw new Error('Fluid V5 full-surface atomic: runtime handles unavailable.');

const dev = ssfr.dev;
const format = ssfr.format;
const quality = new URLSearchParams(location.search).get('quality') || 'medium';
const [CW, CH] = quality === 'low' ? [64, 48] : quality === 'high' ? [192, 112] : [128, 80];
const ROW_BYTES = CW * 4;
const groups = n => Math.max(1, Math.ceil(Math.max(0, n) / 256));

window.__v5AtomicStatus = {
  online:false, stage:'shader-project', backend:'particle-full', width:CW, height:CH, error:'',
};

function infoText(info) {
  return (info?.messages || []).filter(m => m.type === 'error')
    .map(m => `${m.lineNum || '?'}:${m.linePos || '?'} ${m.message}`).join(' | ');
}
async function checkedModule(code,label,stage){
  window.__v5AtomicStatus.stage=stage;
  const mod=dev.createShaderModule({code,label});
  if(typeof mod.getCompilationInfo==='function'){
    const info=await mod.getCompilationInfo();
    const text=infoText(info);
    if(text) throw new Error(`${label} WGSL: ${text}`);
  }
  return mod;
}
async function checkedCompute(module,label){
  window.__v5AtomicStatus.stage='pipeline-project';
  try{return await dev.createComputePipelineAsync({label,layout:'auto',compute:{module,entryPoint:'main'}});}
  catch(err){throw new Error(`${label}: ${err?.message||err}`);}
}
async function checkedRender(module,label){
  window.__v5AtomicStatus.stage='pipeline-overlay';
  try{return await dev.createRenderPipelineAsync({
    label,layout:'auto',vertex:{module,entryPoint:'vs'},
    fragment:{module,entryPoint:'fs',targets:[{format,blend:{
      color:{srcFactor:'src-alpha',dstFactor:'one',operation:'add'},
      alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},
    }}]},primitive:{topology:'triangle-list'},
  });}catch(err){throw new Error(`${label}: ${err?.message||err}`);}
}

const accum=dev.createBuffer({
  label:'fluidV5FullSurfaceAtomicAccum',size:CW*CH*4,
  usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST,
});
const densityTex=dev.createTexture({
  label:'fluidV5FullSurfaceAtomicTexture',size:[CW,CH,1],format:'r32uint',
  usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING,
});
const densityView=densityTex.createView();
const projectUni=dev.createBuffer({
  label:'fluidV5FullSurfaceAtomicTuning',size:32,
  usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,
});
const projectF=new Float32Array(8);
const projectU=new Uint32Array(projectF.buffer);

const projectWGSL=`
struct Comp {
 invViewProj:mat4x4f, invView:mat4x4f, eye:vec4f,
 boxMin:vec3f, proj00:f32, boxMax:vec3f, proj11:f32,
 absorb:vec3f, ior:f32, sunDir:vec3f, sunIntensity:f32,
 roughness:f32, exposure:f32, groundReflection:f32, thicknessScale:f32,
 bodyCount:i32, floorPlane:i32, debug:i32, hasEnvMap:i32,
 envIntensity:f32, envYaw:f32, mapScale:vec2f,
}
struct Tuning { dims:vec4u, values:vec4f }
@group(0) @binding(0) var<uniform> C:Comp;
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read> normalBuf:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> energy:array<atomic<u32>>;
@group(0) @binding(4) var<uniform> U:Tuning;

fn splat(ix:i32,iz:i32,w:f32){
 if(ix<0||iz<0||ix>=i32(U.dims.x)||iz>=i32(U.dims.y)){return;}
 atomicAdd(&energy[u32(iz)*U.dims.x+u32(ix)],u32(max(w,0.0)*1024.0));
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;
 if(i>=U.dims.z){return;}
 let p=pos[i].xyz;
 if(p.x<C.boxMin.x||p.z<C.boxMin.z||p.x>C.boxMax.x||p.z>C.boxMax.z){return;}
 // Ignore particles near the floor and very high ballistic particles. Surface normals are the
 // primary surface test; this height window only rejects obvious non-water receiver geometry.
 let waterH=C.boxMin.y+(C.boxMax.y-C.boxMin.y)*0.28;
 if(p.y<C.boxMin.y+0.035||p.y>waterH+0.42){return;}
 let rawN=normalBuf[i].xyz;
 let nl=length(rawN);
 if(nl<0.018){return;}
 var n=rawN/nl;
 if(n.y<0.0){n=-n;}
 if(n.y<0.075){return;}
 let sun=normalize(C.sunDir);
 let incidence=max(dot(n,sun),0.0);
 if(incidence<0.003){return;}
 let ray=refract(-sun,n,1.0/C.ior);
 if(dot(ray,ray)<1.0e-8||ray.y>=-0.004){return;}
 let t=(C.boxMin.y-p.y)/ray.y;
 if(t<=0.0){return;}
 let hit=p+ray*t;
 if(hit.x<C.boxMin.x||hit.z<C.boxMin.z||hit.x>C.boxMax.x||hit.z>C.boxMax.z){return;}
 let uv=(hit.xz-C.boxMin.xz)/max(C.boxMax.xz-C.boxMin.xz,vec2f(1.0e-4));
 let fx=clamp(uv.x,0.0,0.99999)*f32(U.dims.x);
 let fz=clamp(uv.y,0.0,0.99999)*f32(U.dims.y);
 let ix=i32(floor(fx));let iz=i32(floor(fz));
 let slope=1.0-clamp(n.y,0.0,1.0);
 // Normalize the much denser particle-source stream so bright focus stays below clipping.
 let w=U.values.x*(0.17+0.83*incidence)*(0.80+0.72*slope)*0.23;
 splat(ix,iz,w);
 splat(ix-1,iz,w*.38);splat(ix+1,iz,w*.38);splat(ix,iz-1,w*.38);splat(ix,iz+1,w*.38);
 splat(ix-1,iz-1,w*.15);splat(ix+1,iz-1,w*.15);splat(ix-1,iz+1,w*.15);splat(ix+1,iz+1,w*.15);
}`;

const projectMod=await checkedModule(projectWGSL,'fluidV5FullSurfaceAtomicProjectWGSL','shader-project');
const projectPipe=await checkedCompute(projectMod,'fluidV5FullSurfaceAtomicProject');
window.__v5AtomicStatus.stage='compute-ready';
let projectCache=null;
function projectBG(){
 const pos=sim.livePos?.();
 const normal=sim.buf?.normal;
 if(!pos||!normal)return null;
 const key=`${sim.gen}|${sim.parity}`;
 if(projectCache?.key===key)return projectCache.bg;
 const bg=dev.createBindGroup({layout:projectPipe.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:ssfr.compUni}},
  {binding:1,resource:{buffer:pos}},
  {binding:2,resource:{buffer:normal}},
  {binding:3,resource:{buffer:accum}},
  {binding:4,resource:{buffer:projectUni}},
 ]});
 projectCache={key,bg};return bg;
}

const overlayUni=dev.createBuffer({
 label:'fluidV5FullSurfaceAtomicOverlayUniform',size:16,
 usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,
});
const overlayF=new Float32Array(4);
const overlayWGSL=`
struct Comp {
 invViewProj:mat4x4f, invView:mat4x4f, eye:vec4f,
 boxMin:vec3f, proj00:f32, boxMax:vec3f, proj11:f32,
 absorb:vec3f, ior:f32, sunDir:vec3f, sunIntensity:f32,
 roughness:f32, exposure:f32, groundReflection:f32, thicknessScale:f32,
 bodyCount:i32, floorPlane:i32, debug:i32, hasEnvMap:i32,
 envIntensity:f32, envYaw:f32, mapScale:vec2f,
}
struct O { strength:f32, debug:f32, gain:f32, pad:f32 }
@group(0) @binding(0) var<uniform> C:Comp;
@group(0) @binding(1) var densityTex:texture_2d<u32>;
@group(0) @binding(2) var<uniform> U:O;
struct V{@builtin(position)pos:vec4f,@location(0)ndc:vec2f}
@vertex fn vs(@builtin(vertex_index)i:u32)->V{
 let p=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-1.0;var o:V;o.pos=vec4f(p,0.0,1.0);o.ndc=p;return o;
}
fn e(ix:i32,iz:i32)->f32{
 let d=vec2i(textureDimensions(densityTex));let x=clamp(ix,0,d.x-1);let z=clamp(iz,0,d.y-1);
 return f32(textureLoad(densityTex,vec2i(x,z),0).r)/1024.0;
}
fn sampleEnergy(uv:vec2f)->f32{
 let d=vec2f(textureDimensions(densityTex));let p=clamp(uv,vec2f(0.0),vec2f(0.99999))*d;
 let x=i32(floor(p.x));let z=i32(floor(p.y));
 var s=e(x,z)*4.0;
 s+=(e(x-1,z)+e(x+1,z)+e(x,z-1)+e(x,z+1))*2.0;
 s+=e(x-1,z-1)+e(x+1,z-1)+e(x-1,z+1)+e(x+1,z+1);
 return s/16.0;
}
fn light(v:f32)->vec3f{
 let focused=max(v-0.010,0.0);
 let c=1.0-exp(-focused*1.12*U.gain);
 let h=smoothstep(0.004,0.68,c);
 return vec3f(h,h*.955,h*.84);
}
@fragment fn fs(v:V)->@location(0)vec4f{
 let screenUV=vec2f(v.ndc.x*.5+.5,.5-v.ndc.y*.5);
 if(U.debug>.5){return vec4f(light(sampleEnergy(screenUV)),1.0);}
 let a=C.invViewProj*vec4f(v.ndc,-1.0,1.0);let b=C.invViewProj*vec4f(v.ndc,1.0,1.0);
 let ro=a.xyz/a.w;let rd=normalize(b.xyz/b.w-ro);
 if(rd.y>=-1.0e-5){return vec4f(0.0);}
 let t=(C.boxMin.y-ro.y)/rd.y;if(t<=0.0){return vec4f(0.0);}let p=ro+rd*t;
 if(p.x<C.boxMin.x||p.z<C.boxMin.z||p.x>C.boxMax.x||p.z>C.boxMax.z){return vec4f(0.0);}
 let uv=(p.xz-C.boxMin.xz)/max(C.boxMax.xz-C.boxMin.xz,vec2f(1.0e-4));
 let c=light(sampleEnergy(uv));let peak=max(max(c.r,c.g),c.b);
 let alpha=clamp(peak*U.strength*.23,0.0,.44);
 return vec4f(c*(.72+U.strength*.25),alpha);
}`;

const overlayMod=await checkedModule(overlayWGSL,'fluidV5FullSurfaceAtomicOverlayWGSL','shader-overlay');
const overlayPipe=await checkedRender(overlayMod,'fluidV5FullSurfaceAtomicOverlay');
window.__v5AtomicStatus.stage='overlay-ready';
let overlayCache=null;
function overlayBG(){
 if(overlayCache?.compUni===ssfr.compUni)return overlayCache.bg;
 const bg=dev.createBindGroup({layout:overlayPipe.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:ssfr.compUni}},
  {binding:1,resource:densityView},
  {binding:2,resource:{buffer:overlayUni}},
 ]});
 overlayCache={compUni:ssfr.compUni,bg};return bg;
}

function encodeAtomic(enc){
 if(state.projected<=.002&&window.__v5DebugMode!=='caustics'&&window.__v5DebugMode!=='atomic')return;
 const n=Math.max(0,sim.n|0);if(!n)return;
 projectU[0]=CW;projectU[1]=CH;projectU[2]=n;projectU[3]=0;
 projectF[4]=Math.min(2.4,Math.max(.18,ssfr.sunIntensity/4.5));
 projectF[5]=state.projected;projectF[6]=0;projectF[7]=0;
 dev.queue.writeBuffer(projectUni,0,projectF);
 enc.clearBuffer(accum);
 const bg=projectBG();if(!bg)return;
 const p=enc.beginComputePass();p.setPipeline(projectPipe);p.setBindGroup(0,bg);p.dispatchWorkgroups(groups(n));p.end();
 enc.copyBufferToTexture({buffer:accum,bytesPerRow:ROW_BYTES,rowsPerImage:CH},{texture:densityTex},{width:CW,height:CH,depthOrArrayLayers:1});
}
function encodeOverlay(enc,target){
 const raw=window.__v5DebugMode==='atomic';
 if(!raw&&state.projected<=.002)return;
 overlayF[0]=state.projected;overlayF[1]=raw?1:0;overlayF[2]=1;overlayF[3]=0;
 dev.queue.writeBuffer(overlayUni,0,overlayF);
 const p=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:raw?'clear':'load',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
 p.setPipeline(overlayPipe);p.setBindGroup(0,overlayBG());p.draw(3);p.end();
}

const baseRender=ssfr.render;
ssfr.render=function(...args){
 const out=baseRender.apply(this,args);const enc=args[0],target=args[1];
 try{encodeAtomic(enc);encodeOverlay(enc,target);}catch(err){
  window.__v5AtomicStatus.stage='frame-error';window.__v5AtomicStatus.error=String(err?.message||err);
  console.warn('[Fluid V5 full-surface atomic] frame skipped',err);
 }
 return out;
};
ssfr.bindCache=null;
window.__v5ProjectedCaustics={online:true,fallback:false,backend:'particle-full',texture:densityTex,view:densityView,width:CW,height:CH};
window.__v5AtomicStatus={online:true,stage:'online',backend:'particle-full',width:CW,height:CH,error:''};
console.info(`[Fluid V5 atomic] full-surface particle caustics online (${CW}x${CH}).`);
