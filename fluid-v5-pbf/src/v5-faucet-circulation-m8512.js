// Fluid V8 M8.5.12 — conservative steady circulation faucet.
//
// Rollback from M8.5.11's over-dense half-layer experiment. Keep the proven M8.5.9 / M8.5.6
// PBF and SSFR path, emit ONLY the original M8.5.2 layers, and run them faster so gravity
// cannot stretch adjacent 0.90d layers beyond the PBF support radius before the jet reaches
// the pool. To avoid exhausting append capacity, an equal number of calm basin particles are
// moved to those exact nozzle samples in a pre-solve GPU pass. This is a hidden pump/return
// loop, not an extra attraction force. No particle duplication and no extra queue submit.

const sim=window.__sim, faucet=window.__v5M852Faucet, ssfr=window.__ssfr;
if(!sim?.dev||!sim?.appendFluid||!faucet?.online||!ssfr)
  throw new Error('M8.5.12 circulation: coherent faucet runtime unavailable.');

const dev=sim.dev;
const nativeAppend=sim.appendFluid.bind(sim);
const nativeCreate=dev.createCommandEncoder.bind(dev);
const previousStep=sim.step.bind(sim);

const MAX_EMIT=256;
let pending=0;
let expectSimEncoder=false;
let serial=1;
let requested=0;
let passes=0;

const emitPos=dev.createBuffer({
  label:'fluidV5M8512EmitPos',size:MAX_EMIT*16,
  usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST
});
const emitVel=dev.createBuffer({
  label:'fluidV5M8512EmitVel',size:MAX_EMIT*16,
  usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST
});
const counter=dev.createBuffer({
  label:'fluidV5M8512Counter',size:16,
  usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST
});
const uni=dev.createBuffer({
  label:'fluidV5M8512Uniform',size:32,
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
  centreX:f32,
  centreZ:f32,
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
  // Return only calm water from the lower basin. Avoid the impact core so freshly landed
  // jet particles are never immediately teleported back to the nozzle.
  let q=p.xz-vec2f(U.centreX,U.centreZ);
  if(p.y>=U.recycleY||length(v)>=U.maxSpeed||length(q)<0.11){return;}
  let slot=atomicAdd(&C.value,1u);
  if(slot>=U.emitN){return;}
  let np=srcPos[slot];
  let nv=srcVel[slot];
  pos[j]=np;
  pred[j]=np;
  vel[j]=nv;
}`;

const mod=dev.createShaderModule({code:WGSL,label:'fluidV5M8512CirculationWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.5.12 circulation WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({
  label:'fluidV5M8512Circulation',layout:'auto',compute:{module:mod,entryPoint:'main'}
});

function pack(pos,vel){
  const count=Math.min(MAX_EMIT,pos.length/3|0,vel.length/3|0);
  const P=new Float32Array(count*4),V=new Float32Array(count*4);
  for(let i=0;i<count;i++){
    P[i*4]=pos[i*3];P[i*4+1]=pos[i*3+1];P[i*4+2]=pos[i*3+2];P[i*4+3]=1;
    V[i*4]=vel[i*3];V[i*4+1]=vel[i*3+1];V[i*4+2]=vel[i*3+2];
  }
  return {P,V,count};
}

// Faucet emission becomes constant-mass circulation. Pool/Dam retain the native append path.
sim.appendFluid=function(pos,vel){
  if(faucet.active!=='faucet')return nativeAppend(pos,vel);
  const a=pack(pos,vel);
  if(a.count<=0)return 0;
  dev.queue.writeBuffer(emitPos,0,a.P);
  dev.queue.writeBuffer(emitVel,0,a.V);
  pending=a.count;
  requested+=a.count;
  return a.count;
};

function encode(enc){
  if(pending<=0)return;
  const n=Math.max(1,sim.n|0), b=sim.params?.box||[1.10,1.50,.74];
  serial=(serial+1)>>>0;
  UU[0]=n;UU[1]=pending;UU[2]=(Math.imul(serial,2654435761)>>>0)%n;UU[3]=0;
  UF[4]=Math.min(b[1]*.40,.62); // lower return reservoir
  UF[5]=1.55;                  // calm-particle gate
  UF[6]=b[0]*.5;UF[7]=b[2]*.5;
  dev.queue.writeBuffer(uni,0,UF);
  enc.clearBuffer(counter);
  const s=sim.parity===0?'A':'B';
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uni}},
    {binding:1,resource:{buffer:emitPos}},
    {binding:2,resource:{buffer:emitVel}},
    {binding:3,resource:{buffer:sim.buf['pos'+s]}},
    {binding:4,resource:{buffer:sim.buf['vel'+s]}},
    {binding:5,resource:{buffer:sim.buf['pred'+s]}},
    {binding:6,resource:{buffer:counter}},
  ]});
  const pass=enc.beginComputePass({label:'fluidV5M8512PreSolveCirculation'});
  pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(n/256));pass.end();
  pending=0;passes++;
}

dev.createCommandEncoder=function(desc){
  const enc=nativeCreate(desc);
  if(expectSimEncoder&&pending>0)encode(enc);
  return enc;
};
sim.step=function(dt){
  expectSimEncoder=true;
  try{return previousStep(dt)}finally{expectSimEncoder=false;}
};

function findRange(labelText){
  const labels=[...document.querySelectorAll('.m742Row label')];
  const label=labels.find(x=>x.textContent.trim()===labelText);
  return label?.parentElement?.querySelector('input[type="range"]')||null;
}
function setRange(input,value,min,max){
  if(!input)return false;
  if(min!=null)input.min=String(min);
  if(max!=null)input.max=String(max);
  input.value=String(value);
  input.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
}
function apply(){
  // For this ~0.7 m free fall, ~2.05 m/s keeps 0.90d source layers inside h≈2d
  // after gravitational stretching. This is ordinary faucet/nozzle velocity, not a force.
  setRange(findRange('EXIT SPEED'),2.05,.35,2.40);
  // Display the emitter's TRUE floor rather than pretending 0.86d bypasses the 0.90d clamp.
  setRange(findRange('AXIAL SPACING'),.90,.90,1.08);
  if(sim.params){
    sim.params.xsphC=.052;
    sim.params.sCorrK=.031;
    sim.params.surfaceTensionK=.074;
    sim.params.substeps=2;
    sim.params.iterations=3;
  }
  // Preserve M8.5.9 HD reconstruction; only a tiny overlap increase helps the faster jet.
  ssfr.splatRadius=1.23;
  ssfr.thicknessRadius=1.23;
  ssfr.bindCache=null;
}
setTimeout(apply,120);setTimeout(apply,500);setInterval(()=>{if(faucet.active==='faucet')apply()},1000);

window.__v5M8512Circulation={
  online:true,backend:'original-layer-2mps-pre-solve-pool-return-m8512',
  exitSpeed:2.05,axialSpacing:.90,gpuSubmitsAdded:0,
  get requested(){return requested},get passes(){return passes},get pending(){return pending}
};
window.__fluidV5Version='8.5.12';
window.__fluidV5Build='M8.5.12 STABLE CIRCULATION JET / 2.05MPS / ORIGINAL 0.90D LAYERS / M8.5.9 HD';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.5.12';
document.title='Fluid V8 · M8.5.12 Stable Circulation Faucet';
console.info('[Fluid V8 M8.5.12] original-layer constant-mass faucet at 2.05 m/s online; added submits 0.');
