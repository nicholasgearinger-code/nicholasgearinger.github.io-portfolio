// Fluid V5 M2.3: mobile-safe buffer-direct atomic caustics.
// Refracted sunlight is accumulated with atomic<u32> in compute, then sampled directly from
// the storage buffer in the fullscreen overlay. This intentionally avoids storage textures and
// a second resolve compute pipeline, which makes the path substantially simpler for mobile WebGPU.

const sim = window.__sim;
const ssfr = window.__ssfr;
const state = window.__v5State;
if (!sim?.dev || !ssfr?.dev || !state) throw new Error('Fluid V5 atomic buffer: runtime handles unavailable.');

const dev = ssfr.dev;
const format = ssfr.format;
const quality = new URLSearchParams(location.search).get('quality') || 'medium';
const [CW, CH] = quality === 'low' ? [88, 56] : quality === 'high' ? [160, 104] : [128, 80];
const groups = n => Math.max(1, Math.ceil(Math.max(0, n) / 256));

window.__v5AtomicStatus = { online:false, stage:'initializing', backend:'buffer-direct', width:CW, height:CH, error:'' };

const accum = dev.createBuffer({
  label:'fluidV5AtomicBufferAccum',
  size:CW * CH * 4,
  usage:GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const projectUni = dev.createBuffer({
  label:'fluidV5AtomicBufferProjectUniform',
  size:64,
  usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const pf = new Float32Array(16);
const pu = new Uint32Array(pf.buffer);

const projectWGSL = `
struct UData {
  boxFloor : vec4f,
  sunPower : vec4f,
  optics : vec4f,
  meta : vec4u,
}
@group(0) @binding(0) var<uniform> U : UData;
@group(0) @binding(1) var<storage,read> pos : array<vec4f>;
@group(0) @binding(2) var<storage,read> normalBuf : array<vec4f>;
@group(0) @binding(3) var<storage,read> phase : array<vec4u>;
@group(0) @binding(4) var<storage,read_write> energy : array<atomic<u32>>;

fn splat(ix:i32, iz:i32, w:f32) {
  if (ix < 0 || iz < 0 || ix >= i32(U.meta.y) || iz >= i32(U.meta.z)) { return; }
  atomicAdd(&energy[u32(iz) * U.meta.y + u32(ix)], u32(max(w,0.0) * 1024.0));
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u) {
  let i = gid.x;
  if (i >= U.meta.x || phase[i].x != 0u) { return; }
  let p = pos[i].xyz;
  if (p.x < 0.0 || p.z < 0.0 || p.x > U.boxFloor.x || p.z > U.boxFloor.z || p.y < U.optics.y) { return; }

  let rawN = normalBuf[i].xyz;
  let nl = length(rawN);
  if (nl < 0.0012) { return; }
  var n = rawN / nl;
  if (n.y < 0.0) { n = -n; }
  if (n.y < 0.10) { return; }

  let sun = normalize(U.sunPower.xyz);
  let incidence = max(dot(n,sun),0.0);
  if (incidence < 0.005) { return; }
  let r = refract(-sun,n,1.0/U.optics.x);
  if (dot(r,r) < 1.0e-8 || r.y >= -0.008) { return; }

  let t = (U.boxFloor.w - p.y) / r.y;
  if (t <= 0.0) { return; }
  let hit = p + r*t;
  if (hit.x < 0.0 || hit.z < 0.0 || hit.x > U.boxFloor.x || hit.z > U.boxFloor.z) { return; }

  let fx = clamp(hit.x / max(U.boxFloor.x,1.0e-4),0.0,0.99999) * f32(U.meta.y);
  let fz = clamp(hit.z / max(U.boxFloor.z,1.0e-4),0.0,0.99999) * f32(U.meta.z);
  let ix = i32(floor(fx));
  let iz = i32(floor(fz));

  let slope = 1.0 - clamp(n.y,0.0,1.0);
  let w = U.sunPower.w * (0.35 + incidence*0.65) * (0.86 + slope*0.48);
  splat(ix,iz,w);
  splat(ix-1,iz,w*0.34); splat(ix+1,iz,w*0.34);
  splat(ix,iz-1,w*0.34); splat(ix,iz+1,w*0.34);
  splat(ix-1,iz-1,w*0.12); splat(ix+1,iz-1,w*0.12);
  splat(ix-1,iz+1,w*0.12); splat(ix+1,iz+1,w*0.12);
}`;

const pmod = dev.createShaderModule({code:projectWGSL,label:'fluidV5AtomicBufferProjectWGSL'});
const projectPipe = await dev.createComputePipelineAsync({
  label:'fluidV5AtomicBufferProject', layout:'auto', compute:{module:pmod,entryPoint:'main'},
});
window.__v5AtomicStatus.stage = 'compute-ready';

let projectCache = null;
function projectBG() {
  const key = `${sim.gen}|${sim.parity}`;
  if (projectCache?.key === key) return projectCache.bg;
  const bg = dev.createBindGroup({layout:projectPipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:projectUni}},
    {binding:1,resource:{buffer:sim.livePos()}},
    {binding:2,resource:{buffer:sim.buf.normal}},
    {binding:3,resource:{buffer:sim.liveBody()}},
    {binding:4,resource:{buffer:accum}},
  ]});
  projectCache = {key,bg};
  return bg;
}

const overlayUni = dev.createBuffer({
  label:'fluidV5AtomicBufferOverlayUniform', size:32,
  usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const of = new Float32Array(8);
const ou = new Uint32Array(of.buffer);

const overlayWGSL = `
struct Comp {
 invViewProj:mat4x4f, invView:mat4x4f, eye:vec4f,
 boxMin:vec3f,proj00:f32,boxMax:vec3f,proj11:f32,absorb:vec3f,ior:f32,
 sunDir:vec3f,sunIntensity:f32,roughness:f32,exposure:f32,groundReflection:f32,thicknessScale:f32,
 bodyCount:i32,floorPlane:i32,debug:i32,hasEnvMap:i32,envIntensity:f32,envYaw:f32,mapScale:vec2f,
}
struct O { strength:f32, debug:f32, gain:f32, pad:f32, dims:vec4u }
@group(0) @binding(0) var<uniform> C:Comp;
@group(0) @binding(1) var<storage,read> energy:array<u32>;
@group(0) @binding(2) var<uniform> U:O;
struct V { @builtin(position) pos:vec4f, @location(0) ndc:vec2f }

@vertex fn vs(@builtin(vertex_index)i:u32)->V {
  let p=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-1.0;
  var o:V; o.pos=vec4f(p,0,1); o.ndc=p; return o;
}

fn e(ix:i32,iz:i32)->f32 {
  let x=clamp(ix,0,i32(U.dims.x)-1);
  let z=clamp(iz,0,i32(U.dims.y)-1);
  return f32(energy[u32(z)*U.dims.x+u32(x)]) / 1024.0;
}

fn sampleEnergy(uv:vec2f)->f32 {
  let p=clamp(uv,vec2f(0.0),vec2f(0.99999))*vec2f(f32(U.dims.x),f32(U.dims.y));
  let x=i32(floor(p.x)); let z=i32(floor(p.y));
  var s=e(x,z)*4.0;
  s+=(e(x-1,z)+e(x+1,z)+e(x,z-1)+e(x,z+1))*2.0;
  s+=(e(x-1,z-1)+e(x+1,z-1)+e(x-1,z+1)+e(x+1,z+1));
  return s/16.0;
}

fn causticColor(v:f32)->vec3f {
  let focused=max(v-0.028,0.0);
  let c=1.0-exp(-focused*0.72*U.gain);
  let h=smoothstep(0.012,0.58,c);
  return vec3f(h,h*0.95,h*0.82);
}

@fragment fn fs(v:V)->@location(0)vec4f {
  let screenUV=vec2f(v.ndc.x*0.5+0.5,0.5-v.ndc.y*0.5);
  if (U.debug>0.5) {
    let c=causticColor(sampleEnergy(screenUV));
    return vec4f(c,1.0);
  }

  let nh=C.invViewProj*vec4f(v.ndc,-1,1);
  let fh=C.invViewProj*vec4f(v.ndc,1,1);
  let ro=nh.xyz/nh.w;
  let rd=normalize(fh.xyz/fh.w-ro);
  if (rd.y>=-1.0e-5) { return vec4f(0); }
  let t=(C.boxMin.y-ro.y)/rd.y;
  if (t<=0.0) { return vec4f(0); }
  let p=ro+rd*t;
  if (p.x<C.boxMin.x || p.z<C.boxMin.z || p.x>C.boxMax.x || p.z>C.boxMax.z) { return vec4f(0); }

  let uv=(p.xz-C.boxMin.xz)/max(C.boxMax.xz-C.boxMin.xz,vec2f(1.0e-4));
  let c=causticColor(sampleEnergy(uv));
  let peak=max(max(c.r,c.g),c.b);
  let a=clamp(peak*U.strength*0.32,0.0,0.56);
  return vec4f(c*(0.84+U.strength*0.30),a);
}`;

const omod=dev.createShaderModule({code:overlayWGSL,label:'fluidV5AtomicBufferOverlayWGSL'});
const overlayPipe=await dev.createRenderPipelineAsync({
  label:'fluidV5AtomicBufferOverlay',layout:'auto',
  vertex:{module:omod,entryPoint:'vs'},
  fragment:{module:omod,entryPoint:'fs',targets:[{format,blend:{
    color:{srcFactor:'src-alpha',dstFactor:'one',operation:'add'},
    alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},
  }}]},
  primitive:{topology:'triangle-list'},
});
window.__v5AtomicStatus.stage = 'overlay-ready';

let overlayCache=null;
function overlayBG(){
  if(overlayCache?.compUni===ssfr.compUni)return overlayCache.bg;
  const bg=dev.createBindGroup({layout:overlayPipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:ssfr.compUni}},
    {binding:1,resource:{buffer:accum}},
    {binding:2,resource:{buffer:overlayUni}},
  ]});
  overlayCache={compUni:ssfr.compUni,bg};return bg;
}

function encodeAtomic(enc){
  if(state.projected<=0.002 && window.__v5DebugMode!=='caustics' && window.__v5DebugMode!=='atomic')return;
  const b=sim.params.box;
  const el=ssfr.sunElevation*Math.PI/180, az=ssfr.sunAzimuth*Math.PI/180;
  const sun=[Math.cos(el)*Math.sin(az),Math.sin(el),Math.cos(el)*Math.cos(az)];
  pf[0]=b[0];pf[1]=b[1];pf[2]=b[2];pf[3]=0;
  pf[4]=sun[0];pf[5]=sun[1];pf[6]=sun[2];pf[7]=Math.min(2.2,Math.max(0.18,ssfr.sunIntensity/4.5));
  pf[8]=ssfr.ior;pf[9]=b[1]*0.28*0.58;pf[10]=state.projected;pf[11]=0;
  pu[12]=sim.n;pu[13]=CW;pu[14]=CH;pu[15]=0;
  dev.queue.writeBuffer(projectUni,0,pf);
  enc.clearBuffer(accum);
  const p=enc.beginComputePass();p.setPipeline(projectPipe);p.setBindGroup(0,projectBG());p.dispatchWorkgroups(groups(sim.n));p.end();
}

function encodeOverlay(enc,target){
  const debug=window.__v5DebugMode==='caustics'||window.__v5DebugMode==='atomic';
  if(!debug&&state.projected<=0.002)return;
  of[0]=state.projected;of[1]=debug?1:0;of[2]=1.0;of[3]=0;
  ou[4]=CW;ou[5]=CH;ou[6]=0;ou[7]=0;
  dev.queue.writeBuffer(overlayUni,0,of);
  const pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:debug?'clear':'load',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
  pass.setPipeline(overlayPipe);pass.setBindGroup(0,overlayBG());pass.draw(3);pass.end();
}

const baseRender=ssfr.render;
ssfr.render=function(...args){
  const out=baseRender.apply(this,args);
  const enc=args[0],target=args[1];
  try{encodeAtomic(enc);encodeOverlay(enc,target);}catch(err){
    window.__v5AtomicStatus.error=String(err?.message||err);
    console.warn('[Fluid V5 atomic buffer] frame skipped',err);
  }
  return out;
};
ssfr.bindCache=null;
window.__v5ProjectedCaustics={online:true,fallback:true,backend:'buffer-direct',buffer:accum,width:CW,height:CH};
window.__v5AtomicStatus={online:true,stage:'online',backend:'buffer-direct',width:CW,height:CH,error:''};
console.info(`[Fluid V5 atomic] buffer-direct atomic caustics online (${CW}x${CH}).`);
