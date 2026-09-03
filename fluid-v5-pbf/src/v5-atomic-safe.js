// Fluid V5 mobile-safe atomic caustic fallback.
// Loaded only when the original M1 GPU extension did not publish its projected-caustic texture.
// Keeps the atomic light projection independent from spray/foam so one rejected renderer cannot
// take the caustic system offline. The receiver overlay traces the complete pool floor.

const sim = window.__sim;
const ssfr = window.__ssfr;
const state = window.__v5State;
if (!sim?.dev || !ssfr?.dev || !state) throw new Error('Fluid V5 atomic fallback: runtime handles unavailable.');
if (window.__v5ProjectedCaustics?.online) {
  console.info('[Fluid V5 atomic] primary projected-caustic pass already online; fallback skipped.');
} else {
  const dev = ssfr.dev;
  const format = ssfr.format;
  const quality = new URLSearchParams(location.search).get('quality') || 'medium';
  const dims = quality === 'low' ? [88, 56] : quality === 'high' ? [160, 104] : [128, 80];
  const [CW, CH] = dims;
  const groups = n => Math.max(1, Math.ceil(Math.max(0, n) / 256));

  const accum = dev.createBuffer({
    label: 'fluidV5AtomicSafeAccum',
    size: CW * CH * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const tex = dev.createTexture({
    label: 'fluidV5AtomicSafeTexture',
    size: [CW, CH],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });
  const view = tex.createView();
  const sampler = dev.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const uni = dev.createBuffer({
    label: 'fluidV5AtomicSafeUniform',
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const uf = new Float32Array(16);
  const uu = new Uint32Array(uf.buffer);

  const projectWGSL = `
struct UData {
  boxFloor : vec4f,
  sunPower : vec4f,
  optics   : vec4f,
  meta     : vec4u,
}
@group(0) @binding(0) var<uniform> U : UData;
@group(0) @binding(1) var<storage, read> pos : array<vec4f>;
@group(0) @binding(2) var<storage, read> normalBuf : array<vec4f>;
@group(0) @binding(3) var<storage, read> phase : array<vec4u>;
@group(0) @binding(4) var<storage, read_write> energy : array<atomic<u32>>;

fn splat(ix:i32, iz:i32, w:f32) {
  if (ix < 0 || iz < 0 || ix >= i32(U.meta.y) || iz >= i32(U.meta.z)) { return; }
  atomicAdd(&energy[u32(iz) * U.meta.y + u32(ix)], u32(max(w, 0.0) * 1024.0));
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= U.meta.x || phase[i].x != 0u) { return; }
  let p = pos[i].xyz;
  if (p.x <= 0.0 || p.z <= 0.0 || p.x >= U.boxFloor.x || p.z >= U.boxFloor.z || p.y < U.optics.y) { return; }
  let rawN = normalBuf[i].xyz;
  let nl = length(rawN);
  if (nl < 0.0015) { return; }
  var n = rawN / nl;
  if (n.y < 0.0) { n = -n; }
  if (n.y < 0.14) { return; }
  let sun = normalize(U.sunPower.xyz);
  let incidence = max(dot(n, sun), 0.0);
  if (incidence < 0.01) { return; }
  let r = refract(-sun, n, 1.0 / U.optics.x);
  if (dot(r, r) < 1.0e-8 || r.y >= -0.01) { return; }
  let t = (U.boxFloor.w - p.y) / r.y;
  if (t <= 0.0) { return; }
  let hit = p + r * t;
  if (hit.x < 0.0 || hit.z < 0.0 || hit.x >= U.boxFloor.x || hit.z >= U.boxFloor.z) { return; }
  let fx = hit.x / U.boxFloor.x * f32(U.meta.y);
  let fz = hit.z / U.boxFloor.z * f32(U.meta.z);
  let ix = i32(floor(fx));
  let iz = i32(floor(fz));
  let slope = 1.0 - clamp(n.y, 0.0, 1.0);
  let w = U.sunPower.w * incidence * (0.82 + slope * 0.55);
  splat(ix, iz, w * 1.00);
  splat(ix-1, iz, w * 0.36); splat(ix+1, iz, w * 0.36);
  splat(ix, iz-1, w * 0.36); splat(ix, iz+1, w * 0.36);
  splat(ix-1, iz-1, w * 0.15); splat(ix+1, iz-1, w * 0.15);
  splat(ix-1, iz+1, w * 0.15); splat(ix+1, iz+1, w * 0.15);
}`;

  // Read the atomic buffer as ordinary u32 values in the resolve stage. This avoids requiring
  // atomicLoad in the second shader while retaining atomic accumulation in the projection pass.
  const resolveWGSL = `
struct UData { boxFloor:vec4f, sunPower:vec4f, optics:vec4f, meta:vec4u }
@group(0) @binding(0) var<uniform> U : UData;
@group(0) @binding(1) var<storage, read> energy : array<u32>;
@group(0) @binding(2) var outTex : texture_storage_2d<rgba8unorm, write>;
fn e(x:i32, y:i32) -> f32 {
  let xx = clamp(x, 0, i32(U.meta.y)-1);
  let yy = clamp(y, 0, i32(U.meta.z)-1);
  return f32(energy[u32(yy) * U.meta.y + u32(xx)]) / 1024.0;
}
@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (gid.x >= U.meta.y || gid.y >= U.meta.z) { return; }
  let x = i32(gid.x); let y = i32(gid.y);
  var sum = e(x,y) * 5.0;
  sum += (e(x-1,y)+e(x+1,y)+e(x,y-1)+e(x,y+1)) * 2.4;
  sum += (e(x-1,y-1)+e(x+1,y-1)+e(x-1,y+1)+e(x+1,y+1)) * 1.15;
  sum += (e(x-2,y)+e(x+2,y)+e(x,y-2)+e(x,y+2)) * 0.42;
  let density = sum / 20.0;
  let focused = max(density - 0.035, 0.0);
  let c = 1.0 - exp(-focused * 0.82);
  let hot = smoothstep(0.018, 0.58, c);
  textureStore(outTex, vec2i(x,y), vec4f(hot, hot*0.95, hot*0.82, 1.0));
}`;

  const pmod = dev.createShaderModule({ code: projectWGSL, label: 'fluidV5AtomicSafeProjectWGSL' });
  const rmod = dev.createShaderModule({ code: resolveWGSL, label: 'fluidV5AtomicSafeResolveWGSL' });
  const projectPipe = await dev.createComputePipelineAsync({
    label: 'fluidV5AtomicSafeProject', layout: 'auto', compute: { module: pmod, entryPoint: 'main' },
  });
  const resolvePipe = await dev.createComputePipelineAsync({
    label: 'fluidV5AtomicSafeResolve', layout: 'auto', compute: { module: rmod, entryPoint: 'main' },
  });

  let computeCache = null;
  function computeBG() {
    const key = `${sim.gen}|${sim.parity}`;
    if (computeCache?.key === key) return computeCache;
    computeCache = {
      key,
      project: dev.createBindGroup({ layout: projectPipe.getBindGroupLayout(0), entries: [
        { binding:0, resource:{ buffer:uni } },
        { binding:1, resource:{ buffer:sim.livePos() } },
        { binding:2, resource:{ buffer:sim.buf.normal } },
        { binding:3, resource:{ buffer:sim.liveBody() } },
        { binding:4, resource:{ buffer:accum } },
      ]}),
      resolve: dev.createBindGroup({ layout: resolvePipe.getBindGroupLayout(0), entries: [
        { binding:0, resource:{ buffer:uni } },
        { binding:1, resource:{ buffer:accum } },
        { binding:2, resource:view },
      ]}),
    };
    return computeCache;
  }

  function encodeAtomic(enc) {
    if (state.projected <= 0.002 && window.__v5DebugMode !== 'atomic' && window.__v5DebugMode !== 'caustics') return;
    const b = sim.params.box;
    const el = ssfr.sunElevation * Math.PI / 180;
    const az = ssfr.sunAzimuth * Math.PI / 180;
    const sun = [Math.cos(el)*Math.sin(az), Math.sin(el), Math.cos(el)*Math.cos(az)];
    uf[0]=b[0]; uf[1]=b[1]; uf[2]=b[2]; uf[3]=0.0;
    uf[4]=sun[0]; uf[5]=sun[1]; uf[6]=sun[2]; uf[7]=Math.min(2.2, Math.max(0.18, ssfr.sunIntensity/4.5));
    uf[8]=ssfr.ior; uf[9]=b[1]*0.28*0.62; uf[10]=state.projected; uf[11]=0;
    uu[12]=sim.n; uu[13]=CW; uu[14]=CH; uu[15]=0;
    dev.queue.writeBuffer(uni, 0, uf);
    enc.clearBuffer(accum);
    const bg = computeBG();
    { const p=enc.beginComputePass(); p.setPipeline(projectPipe); p.setBindGroup(0,bg.project); p.dispatchWorkgroups(groups(sim.n)); p.end(); }
    { const p=enc.beginComputePass(); p.setPipeline(resolvePipe); p.setBindGroup(0,bg.resolve); p.dispatchWorkgroups(Math.ceil(CW/8),Math.ceil(CH/8)); p.end(); }
  }

  const overlayUni = dev.createBuffer({
    label:'fluidV5AtomicSafeOverlayUniform', size:16,
    usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const of = new Float32Array(4);
  const overlayWGSL = `
struct Comp {
 invViewProj:mat4x4f, invView:mat4x4f, eye:vec4f,
 boxMin:vec3f,proj00:f32,boxMax:vec3f,proj11:f32,absorb:vec3f,ior:f32,
 sunDir:vec3f,sunIntensity:f32,roughness:f32,exposure:f32,groundReflection:f32,thicknessScale:f32,
 bodyCount:i32,floorPlane:i32,debug:i32,hasEnvMap:i32,envIntensity:f32,envYaw:f32,mapScale:vec2f,
}
struct O { strength:f32, debug:f32, pad0:f32, pad1:f32 }
@group(0) @binding(0) var<uniform> C : Comp;
@group(0) @binding(1) var caustic : texture_2d<f32>;
@group(0) @binding(2) var samp : sampler;
@group(0) @binding(3) var<uniform> U : O;
struct V { @builtin(position) pos:vec4f, @location(0) ndc:vec2f }
@vertex fn vs(@builtin(vertex_index) i:u32) -> V {
 let p=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-1.0;
 var o:V; o.pos=vec4f(p,0,1); o.ndc=p; return o;
}
fn insideXZ(p:vec3f)->bool{return p.x>=C.boxMin.x&&p.z>=C.boxMin.z&&p.x<=C.boxMax.x&&p.z<=C.boxMax.z;}
fn wallBlocks(ro:vec3f,rd:vec3f,tFloor:f32)->bool{
 let wallTop=C.boxMin.y+(C.boxMax.y-C.boxMin.y)*0.37;
 if(abs(rd.x)>1.0e-5){
  let t0=(C.boxMin.x-ro.x)/rd.x; let p0=ro+rd*t0;
  if(t0>0.0&&t0<tFloor&&p0.y>=C.boxMin.y&&p0.y<=wallTop&&p0.z>=C.boxMin.z&&p0.z<=C.boxMax.z){return true;}
  let t1=(C.boxMax.x-ro.x)/rd.x; let p1=ro+rd*t1;
  if(t1>0.0&&t1<tFloor&&p1.y>=C.boxMin.y&&p1.y<=wallTop&&p1.z>=C.boxMin.z&&p1.z<=C.boxMax.z){return true;}
 }
 if(abs(rd.z)>1.0e-5){
  let t0=(C.boxMin.z-ro.z)/rd.z; let p0=ro+rd*t0;
  if(t0>0.0&&t0<tFloor&&p0.y>=C.boxMin.y&&p0.y<=wallTop&&p0.x>=C.boxMin.x&&p0.x<=C.boxMax.x){return true;}
  let t1=(C.boxMax.z-ro.z)/rd.z; let p1=ro+rd*t1;
  if(t1>0.0&&t1<tFloor&&p1.y>=C.boxMin.y&&p1.y<=wallTop&&p1.x>=C.boxMin.x&&p1.x<=C.boxMax.x){return true;}
 }
 return false;
}
@fragment fn fs(v:V)->@location(0) vec4f {
 let uv=vec2f(v.ndc.x*0.5+0.5,0.5-v.ndc.y*0.5);
 if(U.debug>0.5){let c=textureSampleLevel(caustic,samp,uv,0).rgb;return vec4f(c,1.0);}
 let nh=C.invViewProj*vec4f(v.ndc,-1,1); let fh=C.invViewProj*vec4f(v.ndc,1,1);
 let ro=nh.xyz/nh.w; let rd=normalize(fh.xyz/fh.w-ro);
 if(rd.y>=-1.0e-5){return vec4f(0);}
 let t=(C.boxMin.y-ro.y)/rd.y;
 if(t<=0.0){return vec4f(0);}
 let p=ro+rd*t;
 if(!insideXZ(p)||wallBlocks(ro,rd,t)){return vec4f(0);}
 let cuv=(p.xz-C.boxMin.xz)/max(C.boxMax.xz-C.boxMin.xz,vec2f(1.0e-4));
 let c=textureSampleLevel(caustic,samp,cuv,0).rgb;
 let peak=max(max(c.r,c.g),c.b);
 let a=clamp(peak*U.strength*0.44,0.0,0.64);
 return vec4f(c*(0.92+U.strength*0.32),a);
}`;
  const omod = dev.createShaderModule({ code:overlayWGSL, label:'fluidV5AtomicSafeOverlayWGSL' });
  const overlayPipe = await dev.createRenderPipelineAsync({
    label:'fluidV5AtomicSafeOverlay', layout:'auto',
    vertex:{ module:omod, entryPoint:'vs' },
    fragment:{ module:omod, entryPoint:'fs', targets:[{ format, blend:{
      color:{ srcFactor:'src-alpha', dstFactor:'one', operation:'add' },
      alpha:{ srcFactor:'zero', dstFactor:'one', operation:'add' },
    }}]},
    primitive:{ topology:'triangle-list' },
  });
  let overlayBGCache = null;
  function overlayBG(){
    const key=ssfr.compUni;
    if(overlayBGCache?.key===key)return overlayBGCache.bg;
    const bg=dev.createBindGroup({layout:overlayPipe.getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:ssfr.compUni}},{binding:1,resource:view},{binding:2,resource:sampler},{binding:3,resource:{buffer:overlayUni}},
    ]});
    overlayBGCache={key,bg};return bg;
  }
  function encodeOverlay(enc,target){
    const debug=window.__v5DebugMode==='atomic';
    if(!debug&&state.projected<=0.002)return;
    of[0]=state.projected;of[1]=debug?1:0;dev.queue.writeBuffer(overlayUni,0,of);
    const pass=enc.beginRenderPass({colorAttachments:[{view:target,clearValue:{r:0,g:0,b:0,a:1},loadOp:debug?'clear':'load',storeOp:'store'}]});
    pass.setPipeline(overlayPipe);pass.setBindGroup(0,overlayBG());pass.draw(3);pass.end();
  }

  const baseRender=ssfr.render;
  ssfr.render=function(...args){
    const enc=args[0],target=args[1];
    try{encodeAtomic(enc);}catch(err){console.warn('[Fluid V5 atomic] projection skipped',err);}
    const out=baseRender.apply(this,args);
    try{encodeOverlay(enc,target);}catch(err){console.warn('[Fluid V5 atomic] overlay skipped',err);}
    return out;
  };
  ssfr.bindCache=null;
  window.__v5ProjectedCaustics={online:true,fallback:true,texture:tex,view,width:CW,height:CH};
  console.info(`[Fluid V5 atomic] mobile-safe full-pool atomic caustics online (${CW}x${CH}).`);
}
