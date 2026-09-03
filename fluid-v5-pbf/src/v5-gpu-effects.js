// Fluid V5 GPU extensions: projected photon-style floor caustics + live PBF spray/foam.
// Both are additive layers on top of the validated V4.4 renderer. If either pipeline is rejected,
// the V4.4 renderer remains usable and V5 reports the failure in the console/UI.

const sim = window.__sim;
const ssfr = window.__ssfr;
const state = window.__v5State;
if (!sim?.dev || !ssfr?.dev || !state) throw new Error('Fluid V5 GPU extensions: simulation handles unavailable.');
const dev = ssfr.dev;
const format = ssfr.format;
const quality = new URLSearchParams(location.search).get('quality') || 'medium';
const dims = quality === 'low' ? [88, 56] : quality === 'high' ? [160, 104] : [128, 80];
const [CW, CH] = dims;
const WG = 256;
const groups = n => Math.max(1, Math.ceil(n / WG));

// Preserve all V5 query state when a legacy quality button is used. The V4 handler rebuilds
// the URL from only `quality`, so intercept it in capture phase and perform the reload here.
for (const b of document.querySelectorAll('[data-quality]')) {
  b.addEventListener('click', e => {
    e.preventDefault();
    e.stopImmediatePropagation();
    try { localStorage.setItem('fluidV5AutoQualityV1', '0'); } catch {}
    state.autoQuality = false;
    const next = new URLSearchParams(location.search);
    next.set('quality', b.dataset.quality);
    next.set('v5', '1');
    next.set('qv', String(Date.now()));
    location.assign(location.pathname + '?' + next.toString() + location.hash);
  }, { capture: true });
}

// ---------------- Projected caustics ---------------------------------------
const accum = dev.createBuffer({
  label: 'fluidV5CausticAccum', size: CW * CH * 4,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const causticTex = dev.createTexture({
  label: 'fluidV5ProjectedCaustics', size: [CW, CH], format: 'rgba8unorm',
  usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
});
const causticView = causticTex.createView();
const causticSampler = dev.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const projectUni = dev.createBuffer({
  label: 'fluidV5ProjectUniform', size: 64,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const projectF = new Float32Array(16);
const projectU = new Uint32Array(projectF.buffer);

const projectWGSL = `
struct P {
  boxFloor : vec4f,
  sunPower : vec4f,
  optics   : vec4f,
  count    : vec4u,
}
@group(0) @binding(0) var<uniform> U:P;
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read> normalBuf:array<vec4f>;
@group(0) @binding(3) var<storage,read> phase:array<vec4u>;
@group(0) @binding(4) var<storage,read_write> energy:array<atomic<u32>>;

fn addPhoton(ix:i32, iz:i32, w:f32) {
  if (ix < 0 || iz < 0 || ix >= i32(U.count.y) || iz >= i32(U.count.z)) { return; }
  let idx = u32(iz) * U.count.y + u32(ix);
  atomicAdd(&energy[idx], u32(max(0.0, w) * 1024.0));
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u) {
  let i=gid.x;
  if (i>=U.count.x || phase[i].x!=0u) { return; }
  let p=pos[i].xyz;
  if (p.y < U.optics.y || p.x<=0.0 || p.z<=0.0 || p.x>=U.boxFloor.x || p.z>=U.boxFloor.z) { return; }
  let rawN=normalBuf[i].xyz;
  let nl=length(rawN);
  if (nl < U.optics.z) { return; }
  var n=rawN/nl;
  if (n.y<0.0) { n=-n; }
  if (n.y<0.16) { return; }
  let sun=normalize(U.sunPower.xyz);
  let incidence=max(dot(n,sun),0.0);
  if (incidence<=0.01) { return; }
  var r=refract(-sun,n,1.0/U.optics.x);
  if (dot(r,r)<1.0e-8 || r.y>=-0.015) { return; }
  let t=(U.boxFloor.w-p.y)/r.y;
  if (t<=0.0) { return; }
  let hit=p+r*t;
  if (hit.x<0.0 || hit.z<0.0 || hit.x>=U.boxFloor.x || hit.z>=U.boxFloor.z) { return; }
  let fx=hit.x/U.boxFloor.x*f32(U.count.y);
  let fz=hit.z/U.boxFloor.z*f32(U.count.z);
  let ix=i32(floor(fx)); let iz=i32(floor(fz));
  let slope=1.0-clamp(n.y,0.0,1.0);
  let w=(0.45+0.55*incidence)*(0.78+0.34*slope)*U.sunPower.w;
  addPhoton(ix,iz,w*1.00);
  addPhoton(ix-1,iz,w*0.34); addPhoton(ix+1,iz,w*0.34);
  addPhoton(ix,iz-1,w*0.34); addPhoton(ix,iz+1,w*0.34);
  addPhoton(ix-1,iz-1,w*0.12); addPhoton(ix+1,iz-1,w*0.12);
  addPhoton(ix-1,iz+1,w*0.12); addPhoton(ix+1,iz+1,w*0.12);
}`;

const resolveWGSL = `
struct P { boxFloor:vec4f, sunPower:vec4f, optics:vec4f, count:vec4u }
@group(0) @binding(0) var<uniform> U:P;
@group(0) @binding(1) var<storage,read_write> energy:array<atomic<u32>>;
@group(0) @binding(2) var outTex:texture_storage_2d<rgba8unorm,write>;
fn sampleAt(x:i32,y:i32)->f32{
  let xx=clamp(x,0,i32(U.count.y)-1); let yy=clamp(y,0,i32(U.count.z)-1);
  return f32(atomicLoad(&energy[u32(yy)*U.count.y+u32(xx)]))/1024.0;
}
@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid:vec3u){
  if(gid.x>=U.count.y||gid.y>=U.count.z){return;}
  let x=i32(gid.x);let y=i32(gid.y);
  var sum=sampleAt(x,y)*4.0;
  sum+=sampleAt(x-1,y)*2.0+sampleAt(x+1,y)*2.0+sampleAt(x,y-1)*2.0+sampleAt(x,y+1)*2.0;
  sum+=sampleAt(x-1,y-1)+sampleAt(x+1,y-1)+sampleAt(x-1,y+1)+sampleAt(x+1,y+1);
  let v=sum/16.0;
  let focus=max(v-0.08,0.0);
  let c=1.0-exp(-focus*0.72);
  let hot=smoothstep(0.03,0.62,c);
  textureStore(outTex,vec2i(x,y),vec4f(hot,hot*0.94,hot*0.78,1.0));
}`;

const pmod = dev.createShaderModule({code:projectWGSL,label:'fluidV5PhotonProjectWGSL'});
const rmod = dev.createShaderModule({code:resolveWGSL,label:'fluidV5PhotonResolveWGSL'});
const projectPipe = await dev.createComputePipelineAsync({label:'fluidV5PhotonProject',layout:'auto',compute:{module:pmod,entryPoint:'main'}});
const resolvePipe = await dev.createComputePipelineAsync({label:'fluidV5PhotonResolve',layout:'auto',compute:{module:rmod,entryPoint:'main'}});
let projectCache = null;
function projectBindGroups() {
  const key=`${sim.gen}|${sim.parity}`;
  if(projectCache?.key===key)return projectCache;
  projectCache={key,
    project:dev.createBindGroup({layout:projectPipe.getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:projectUni}},{binding:1,resource:{buffer:sim.livePos()}},
      {binding:2,resource:{buffer:sim.buf.normal}},{binding:3,resource:{buffer:sim.liveBody()}},
      {binding:4,resource:{buffer:accum}},]}),
    resolve:dev.createBindGroup({layout:resolvePipe.getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:projectUni}},{binding:1,resource:{buffer:accum}},{binding:2,resource:causticView},]}),
  };return projectCache;
}
function encodeProjectedCaustics(enc){
  if(state.projected<=0.002&&window.__v5DebugMode!=='caustics')return;
  const b=sim.params.box;
  const el=ssfr.sunElevation*Math.PI/180,az=ssfr.sunAzimuth*Math.PI/180;
  const sun=[Math.cos(el)*Math.sin(az),Math.sin(el),Math.cos(el)*Math.cos(az)];
  projectF[0]=b[0];projectF[1]=b[1];projectF[2]=b[2];projectF[3]=0.0;
  projectF[4]=sun[0];projectF[5]=sun[1];projectF[6]=sun[2];projectF[7]=Math.min(2.0,Math.max(0.15,ssfr.sunIntensity/4.5));
  projectF[8]=ssfr.ior;projectF[9]=b[1]*0.28*0.72;projectF[10]=0.002;projectF[11]=state.projected;
  projectU[12]=sim.n;projectU[13]=CW;projectU[14]=CH;projectU[15]=0;
  dev.queue.writeBuffer(projectUni,0,projectF);
  enc.clearBuffer(accum);
  const bg=projectBindGroups();
  {const pass=enc.beginComputePass();pass.setPipeline(projectPipe);pass.setBindGroup(0,bg.project);pass.dispatchWorkgroups(groups(sim.n));pass.end();}
  {const pass=enc.beginComputePass();pass.setPipeline(resolvePipe);pass.setBindGroup(0,bg.resolve);pass.dispatchWorkgroups(Math.ceil(CW/8),Math.ceil(CH/8));pass.end();}
}

// Add the projected map back through the camera/refraction path. No screen derivatives are used.
const overlayUni=dev.createBuffer({label:'fluidV5OverlayUniform',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const overlayF=new Float32Array(4);
const overlayWGSL=`
struct Comp {
 invViewProj:mat4x4f, invView:mat4x4f, eye:vec4f,
 boxMin:vec3f,proj00:f32,boxMax:vec3f,proj11:f32,absorb:vec3f,ior:f32,
 sunDir:vec3f,sunIntensity:f32,roughness:f32,exposure:f32,groundReflection:f32,thicknessScale:f32,
 bodyCount:i32,floorPlane:i32,debug:i32,hasEnvMap:i32,envIntensity:f32,envYaw:f32,mapScale:vec2f,
}
struct O{strength:f32,debug:f32,pad0:f32,pad1:f32}
@group(0) @binding(0)var<uniform>C:Comp;
@group(0) @binding(1)var caustic:texture_2d<f32>;
@group(0) @binding(2)var samp:sampler;
@group(0) @binding(3)var eyeZ:texture_2d<f32>;
@group(0) @binding(4)var<uniform>U:O;
struct V{@builtin(position)pos:vec4f,@location(0)ndc:vec2f}
@vertex fn vs(@builtin(vertex_index)i:u32)->V{let p=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-1.0;var o:V;o.pos=vec4f(p,0,1);o.ndc=p;return o;}
fn empty(z:f32)->bool{return z < -1.0e3;}
fn zAt(q:vec2i,lim:vec2i)->f32{if(q.x<0||q.y<0||q.x>=lim.x||q.y>=lim.y){return -1.0e4;}return textureLoad(eyeZ,q,0).r;}
fn vp(ndc:vec2f,z:f32)->vec3f{return vec3f(-ndc.x*z/C.proj00,-ndc.y*z/C.proj11,z);}
@fragment fn fs(v:V)->@location(0)vec4f{
 let uv=vec2f(v.ndc.x*.5+.5,.5-v.ndc.y*.5);
 if(U.debug>.5){let c=textureSampleLevel(caustic,samp,uv,0).rgb;return vec4f(c,1.0);}
 let nearH=C.invViewProj*vec4f(v.ndc,-1,1);let farH=C.invViewProj*vec4f(v.ndc,1,1);
 let ro=nearH.xyz/nearH.w;var rd=normalize(farH.xyz/farH.w-ro);
 let lim=vec2i(textureDimensions(eyeZ,0));let q=vec2i(v.pos.xy*C.mapScale);let z=zAt(q,lim);
 var origin=ro;var ray=rd;
 if(!empty(z)){
  let ndcStep=vec2f(2.0/f32(lim.x),2.0/f32(lim.y));
  let zx=zAt(q+vec2i(1,0),lim);let zy=zAt(q+vec2i(0,1),lim);
  if(!empty(zx)&&!empty(zy)){
   let pc=vp(v.ndc,z);let px=vp(v.ndc+vec2f(ndcStep.x,0),zx);let py=vp(v.ndc+vec2f(0,-ndcStep.y),zy);
   let iv=mat3x3f(C.invView[0].xyz,C.invView[1].xyz,C.invView[2].xyz);
   var n=normalize(iv*normalize(cross(px-pc,py-pc)));
   let wp=(C.invView*vec4f(pc,1)).xyz;if(dot(n,rd)>0){n=-n;}
   let rr=refract(rd,n,1.0/C.ior);if(dot(rr,rr)>1.0e-7){origin=wp+rr*1.0e-3;ray=rr;}
  }
 }
 if(ray.y>=-1.0e-4){return vec4f(0);}
 let t=(C.boxMin.y-origin.y)/ray.y;if(t<=0){return vec4f(0);}
 let p=origin+ray*t;if(p.x<C.boxMin.x||p.z<C.boxMin.z||p.x>C.boxMax.x||p.z>C.boxMax.z){return vec4f(0);}
 let cuv=(p.xz-C.boxMin.xz)/max(C.boxMax.xz-C.boxMin.xz,vec2f(1.0e-4));
 let c=textureSampleLevel(caustic,samp,cuv,0).rgb;
 let a=clamp(max(max(c.r,c.g),c.b)*U.strength*.38,0.0,.72);
 return vec4f(c*1.15,a);
}`;
const omod=dev.createShaderModule({code:overlayWGSL,label:'fluidV5CausticOverlayWGSL'});
const overlayPipe=await dev.createRenderPipelineAsync({label:'fluidV5CausticOverlay',layout:'auto',vertex:{module:omod,entryPoint:'vs'},fragment:{module:omod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
let overlayCache=null;
function overlayBG(){const key=`${ssfr.gen}|${sim.gen}`;if(overlayCache?.key===key)return overlayCache.bg;const bg=dev.createBindGroup({layout:overlayPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ssfr.compUni}},{binding:1,resource:causticView},{binding:2,resource:causticSampler},{binding:3,resource:ssfr.views.eyeZ[0]},{binding:4,resource:{buffer:overlayUni}}]});overlayCache={key,bg};return bg;}
function encodeOverlay(enc,target){const debug=window.__v5DebugMode==='caustics';if(!debug&&state.projected<=0.002)return;overlayF[0]=state.projected;overlayF[1]=debug?1:0;dev.queue.writeBuffer(overlayUni,0,overlayF);const pass=enc.beginRenderPass({colorAttachments:[{view:target,clearValue:{r:0,g:0,b:0,a:1},loadOp:debug?'clear':'load',storeOp:'store'}]});pass.setPipeline(overlayPipe);pass.setBindGroup(0,overlayBG());pass.draw(3);pass.end();}

// ---------------- Physical spray / foam -----------------------------------
const sprayUni=dev.createBuffer({label:'fluidV5SprayUniform',size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const sprayF=new Float32Array(24);
const sprayWGSL=`
struct S{vp:mat4x4f,screen:vec4f,misc:vec4f}
@group(0)@binding(0)var<uniform>U:S;
@group(0)@binding(1)var<storage,read>pos:array<vec4f>;
@group(0)@binding(2)var<storage,read>vel:array<vec4f>;
@group(0)@binding(3)var<storage,read>normalBuf:array<vec4f>;
@group(0)@binding(4)var<storage,read>phase:array<vec4u>;
struct V{@builtin(position)clip:vec4f,@location(0)local:vec2f,@location(1)energy:f32,@location(2)kind:f32}
fn corner(v:u32)->vec2f{let c=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));return c[v];}
@vertex fn vs(@builtin(vertex_index)vi:u32,@builtin(instance_index)inst:u32)->V{
 var o:V;o.clip=vec4f(3,3,1,1);o.local=vec2f(0);o.energy=0;o.kind=0;
 let stride=max(1u,u32(U.misc.z));let i=inst*stride;let n=u32(U.misc.y);if(i>=n||phase[i].x!=0u){return o;}
 let p=pos[i].xyz;let v=vel[i].xyz;let sp=length(v);let rn=normalBuf[i].xyz;let nl=length(rn);
 if(p.y<U.screen.z-.08||nl<.002){return o;}var nn=rn/nl;if(nn.y<0){nn=-nn;}
 let slope=1.0-clamp(nn.y,0.0,1.0);let spray=max(smoothstep(1.8,4.2,sp),smoothstep(.55,1.65,v.y));let foam=smoothstep(.28,.72,slope)*smoothstep(.55,2.4,sp);
 let e=max(spray,foam*.62)*U.screen.w;if(e<.025){return o;}
 let k=select(0.0,1.0,spray>foam*.72);let c=U.vp*vec4f(p,1);if(c.w<=0){return o;}let q=corner(vi);let px=(1.2+e*2.8)*(1.0+k*.35);c.xy+=q*vec2f(px*2.0/U.screen.x,px*2.0/U.screen.y)*c.w;
 o.clip=c;o.local=q;o.energy=e;o.kind=k;return o;
}
@fragment fn fs(v:V)->@location(0)vec4f{let r=length(v.local);if(r>1){discard;}let edge=1.0-smoothstep(.45,1.0,r);let a=clamp(v.energy*(.18+.30*v.kind)*edge,0,.68);let col=mix(vec3f(.76,.93,1.0),vec3f(.96,.995,1.0),vec3f(v.kind));return vec4f(col,a);}`;
const smod=dev.createShaderModule({code:sprayWGSL,label:'fluidV5SprayFoamWGSL'});
const sprayPipe=await dev.createRenderPipelineAsync({label:'fluidV5SprayFoam',layout:'auto',vertex:{module:smod,entryPoint:'vs'},fragment:{module:smod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
let sprayCache=null;
function sprayBG(){const key=`${sim.gen}|${sim.parity}`;if(sprayCache?.key===key)return sprayCache.bg;const bg=dev.createBindGroup({layout:sprayPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:sprayUni}},{binding:1,resource:{buffer:sim.livePos()}},{binding:2,resource:{buffer:sim.liveVel()}},{binding:3,resource:{buffer:sim.buf.normal}},{binding:4,resource:{buffer:sim.liveBody()}}]});sprayCache={key,bg};return bg;}
function matMul(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;}
function encodeSpray(enc,target,args){if(state.spray<=0.002||window.__v5DebugMode!=='final')return;const view=args[5],proj=args[6],w=args[10]||1,h=args[11]||1;const vp=matMul(proj,view);sprayF.set(vp,0);sprayF[16]=w;sprayF[17]=h;sprayF[18]=sim.params.box[1]*.28;sprayF[19]=state.spray;sprayF[20]=performance.now()*.001;sprayF[21]=sim.n;sprayF[22]=quality==='high'?1:2;sprayF[23]=sim.params.spacing;dev.queue.writeBuffer(sprayUni,0,sprayF);const stride=quality==='high'?1:2;const instances=Math.ceil(sim.n/stride);const pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(sprayPipe);pass.setBindGroup(0,sprayBG());pass.draw(6,instances);pass.end();}

// Wrap the already validated V4.4 temporal renderer, preserving it as fallback.
const baseRender=ssfr.render;
ssfr.render=function(...args){
  const enc=args[0],target=args[1];
  try{encodeProjectedCaustics(enc);}catch(err){console.warn('[Fluid V5] projected caustics skipped',err);}
  const out=baseRender.apply(this,args);
  try{encodeOverlay(enc,target);}catch(err){console.warn('[Fluid V5] caustic overlay skipped',err);}
  try{encodeSpray(enc,target,args);}catch(err){console.warn('[Fluid V5] spray/foam skipped',err);}
  return out;
};
ssfr.bindCache=null;
window.__v5ProjectedCaustics={texture:causticTex,view:causticView,width:CW,height:CH};
console.info(`[Fluid V5] projected caustics ${CW}x${CH} + live PBF spray/foam enabled.`);
