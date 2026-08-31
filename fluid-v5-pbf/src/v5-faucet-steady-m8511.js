// Fluid V8 M8.5.11 — steady-state coherent faucet.
//
// M8.5.2's inlet clamps the true axial layer step to >= 0.90d. A falling free jet
// accelerates under gravity, so that spacing stretches beyond the PBF support radius (h=2d)
// well before the stream reaches the basin. This module fixes the numerical sampling rather
// than adding attraction: every emitted layer is split into two 0.45d axial samples, and
// settled basin particles are recycled through the nozzle so the test can run indefinitely
// at constant particle count. Recycling is encoded pre-solve into the existing unified
// command buffer: no extra queue submit and the normal PBF grid is rebuilt afterward.

const sim=window.__sim, faucet=window.__v5M852Faucet, ssfr=window.__ssfr;
if(!sim?.dev||!sim?.appendFluid||!faucet?.online||!ssfr)
  throw new Error('M8.5.11 steady faucet: M8.5.9 faucet runtime unavailable.');

const dev=sim.dev;
const nativeAppend=sim.appendFluid.bind(sim);
const nativeCreate=dev.createCommandEncoder.bind(dev);
const previousStep=sim.step.bind(sim);

const MAX_EMIT=512;
let pending=0;
let expectSimEncoder=false;
let serial=1;
let recycledRequested=0;
let recyclePasses=0;
let denseLayers=0;

const emitPos=dev.createBuffer({
  label:'fluidV5M8511EmitPos',size:MAX_EMIT*16,
  usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST
});
const emitVel=dev.createBuffer({
  label:'fluidV5M8511EmitVel',size:MAX_EMIT*16,
  usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST
});
const counter=dev.createBuffer({
  label:'fluidV5M8511RecycleCounter',size:16,
  usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST
});
const uni=dev.createBuffer({
  label:'fluidV5M8511RecycleUniform',size:32,
  usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST
});
const UF=new Float32Array(8), UU=new Uint32Array(UF.buffer);

const WGSL=`
struct Meta {
  n:u32,
  emitN:u32,
  offset:u32,
  pad0:u32,
  recycleY:f32,
  maxSpeed:f32,
  pad1:f32,
  pad2:f32,
}
struct Counter { value:atomic<u32> }
@group(0) @binding(0) var<uniform> U:Meta;
@group(0) @binding(1) var<storage,read> srcPos:array<vec4f>;
@group(0) @binding(2) var<storage,read> srcVel:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> pos:array<vec4f>;
@group(0) @binding(4) var<storage,read_write> vel:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> pred:array<vec4f>;
@group(0) @binding(6) var<storage,read_write> C:Counter;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;
  if(i>=U.n||U.n==0u||U.emitN==0u){return;}
  let j=(i+U.offset)%U.n;
  let p=pos[j].xyz;
  let v=vel[j].xyz;
  // Pull only ordinary basin water into the hidden return loop. Fast jet/impact particles
  // are left untouched so the visible free jet remains governed by PBF after emission.
  if(p.y>=U.recycleY||length(v)>=U.maxSpeed){return;}
  let slot=atomicAdd(&C.value,1u);
  if(slot>=U.emitN){return;}
  let np=srcPos[slot];
  let nv=srcVel[slot];
  pos[j]=np;
  pred[j]=np;
  vel[j]=nv;
}`;

const mod=dev.createShaderModule({code:WGSL,label:'fluidV5M8511RecycleWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.5.11 recycle WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({
  label:'fluidV5M8511Recycle',layout:'auto',compute:{module:mod,entryPoint:'main'}
});

function densify(pos,vel){
  const d=Math.max(.001,Number(sim.params?.spacing)||.025);
  const half=.45*d; // split the emitter's real 0.90d floor into two support-safe samples
  const count=Math.min(pos.length/3|0,vel.length/3|0);
  const outN=Math.min(MAX_EMIT,count*2);
  const P=new Float32Array(outN*4),V=new Float32Array(outN*4);
  let o=0;
  for(let i=0;i<count&&o<outN;i++){
    const x=pos[i*3],y=pos[i*3+1],z=pos[i*3+2];
    const vx=vel[i*3],vy=vel[i*3+1],vz=vel[i*3+2];
    P[o*4]=x;P[o*4+1]=y;P[o*4+2]=z;P[o*4+3]=1;
    V[o*4]=vx;V[o*4+1]=vy;V[o*4+2]=vz;o++;
    if(o>=outN)break;
    // Mid-layer sample downstream. Same velocity avoids introducing an artificial axial
    // velocity gradient; gravity and PBF evolve both samples normally after this frame.
    P[o*4]=x;P[o*4+1]=Math.max(d*.70,y-half);P[o*4+2]=z;P[o*4+3]=1;
    V[o*4]=vx;V[o*4+1]=vy;V[o*4+2]=vz;o++;
  }
  return {P,V,n:o};
}

// Turn the faucet into a constant-mass loop. Pool/Dam still use the native append path.
sim.appendFluid=function(pos,vel){
  if(faucet.active!=='faucet')return nativeAppend(pos,vel);
  const dense=densify(pos,vel);
  if(dense.n<=0)return 0;
  dev.queue.writeBuffer(emitPos,0,dense.P,0,dense.n*4);
  dev.queue.writeBuffer(emitVel,0,dense.V,0,dense.n*4);
  pending=dense.n;
  recycledRequested+=dense.n;
  denseLayers+=dense.n;
  // Report the requested emission as accepted: the actual particles are moved from the
  // basin into the nozzle in the pre-solve GPU pass below rather than appended to sim.n.
  return dense.n;
};

function encodeRecycle(enc){
  if(pending<=0)return;
  const n=Math.max(1,sim.n|0);
  const b=sim.params?.box||[1.10,1.50,.74];
  serial=(serial+1)>>>0;
  UU[0]=n;UU[1]=pending;UU[2]=(Math.imul(serial,2654435761)>>>0)%n;UU[3]=0;
  // Lower 38% of the tank is the hidden return reservoir. A generous speed gate ensures
  // there are always enough candidates without stealing the falling jet or splash crown.
  UF[4]=Math.min(b[1]*.38,.58);
  UF[5]=2.4;UF[6]=0;UF[7]=0;
  dev.queue.writeBuffer(uni,0,UF);
  enc.clearBuffer(counter);
  const par=sim.parity===0?'A':'B';
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uni}},
    {binding:1,resource:{buffer:emitPos}},
    {binding:2,resource:{buffer:emitVel}},
    {binding:3,resource:{buffer:sim.buf['pos'+par]}},
    {binding:4,resource:{buffer:sim.buf['vel'+par]}},
    {binding:5,resource:{buffer:sim.buf['pred'+par]}},
    {binding:6,resource:{buffer:counter}},
  ]});
  const pass=enc.beginComputePass({label:'fluidV5M8511PreSolveRecycle'});
  pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(n/256));pass.end();
  pending=0;recyclePasses++;
}

// The unified scheduler is already installed. Wrap its encoder and add the recycle work only
// while a simulation step is in progress, so rendering continues to share the same submission.
dev.createCommandEncoder=function(desc){
  const enc=nativeCreate(desc);
  if(expectSimEncoder&&pending>0)encodeRecycle(enc);
  return enc;
};
sim.step=function(dt){
  expectSimEncoder=true;
  try{return previousStep(dt)}finally{expectSimEncoder=false;}
};

// Keep the proven M8.5.6 fluid parameters. The continuity fix is sampling + recirculation,
// not extra cohesion or a stronger surface-tension hack.
function preserve(){
  if(sim.params){
    sim.params.xsphC=.052;
    sim.params.sCorrK=.031;
    sim.params.surfaceTensionK=.074;
    sim.params.substeps=2;
    sim.params.iterations=3;
  }
  // Slightly broader reconstruction overlap, but leave the M8.5.9 adaptive HD scale alone.
  ssfr.splatRadius=1.23;
  ssfr.thicknessRadius=1.24;
  ssfr.bindCache=null;
}
preserve();setTimeout(preserve,300);setInterval(()=>{if(faucet.active==='faucet')preserve()},750);

window.__v5M8511Steady={
  online:true,backend:'half-step-axial-resampling-plus-pre-solve-recirculation-m8511',
  axialSample:.45,gpuSubmitsAdded:0,
  get recyclePasses(){return recyclePasses},
  get recycledRequested(){return recycledRequested},
  get pending(){return pending},
};
window.__fluidV5Version='8.5.11';
window.__fluidV5Build='M8.5.11 STEADY COHERENT JET / 0.45D AXIAL RESAMPLE / CONSTANT-MASS RECIRCULATION';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.5.11';
document.title='Fluid V8 · M8.5.11 Steady Coherent Faucet';
console.info('[Fluid V8 M8.5.11] half-spacing jet sampling + constant-mass pre-solve recirculation online; added submits 0.');
