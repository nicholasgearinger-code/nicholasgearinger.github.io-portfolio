// Fluid V8 M8.3.3 — frame-rate-aware continuous faucet + waterfall source reconstruction.
// The legacy M7.5.2 source pass emitted one thin packet per rendered frame. On mobile at
// ~20 FPS the packet could travel more than one particle spacing before the next packet,
// causing SSFR to reconstruct beads/drops instead of a connected jet/sheet.
//
// This pass remains mass-conserving: it recycles existing fluid particles, but emits a
// short source-aligned column each frame whose length is derived from dt and flow speed.
// Faucet = dense 3x3 column. Waterfall = full-width, two-particle-thick flowing sheet.
// It is encoded into the existing command encoder and adds zero queue submits.

const sim=window.__sim;
const modern=window.__v5M752PhysicalScenes;
const scenes=window.__v5M830Scenes;
if(!sim?.dev||!modern?.online||!scenes?.online) throw new Error('M8.3.3 source flow: scenario runtime unavailable.');
const dev=sim.dev;
const quality=new URLSearchParams(location.search).get('quality')||'low';

const wgsl=`
struct FlowU {
  boxData:vec4f,
  flowData:vec4f,
  flowInfo:vec4u,
  shapeInfo:vec4u,
}
@group(0) @binding(0) var<uniform> U:FlowU;
@group(0) @binding(1) var<storage,read_write> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> pred:array<vec4f>;

fn hash11(x:u32)->f32 {
  var h=x*747796405u+2891336453u;
  h=((h>>((h>>28u)+4u))^h)*277803737u;
  h=(h>>22u)^h;
  return f32(h & 0x00ffffffu)/16777215.0;
}
fn pulseRank(i:u32,n:u32,startVal:u32,countVal:u32)->i32 {
  if(countVal==0u||n==0u){return -1;}
  let r=(i+n-(startVal%n))%n;
  if(r<countVal){return i32(r);}
  return -1;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;
  let n=U.flowInfo.y;
  if(i>=n){return;}
  let modeVal=U.flowInfo.x;
  let rankVal=pulseRank(i,n,U.flowInfo.z,U.flowInfo.w);
  if(rankVal<0){return;}

  let r=u32(rankVal);
  let bx=U.boxData.x;
  let by=U.boxData.y;
  let bz=U.boxData.z;
  let d=max(U.boxData.w,0.001);
  let strength=U.flowData.z;
  let amount=U.flowData.w;
  let slices=max(U.shapeInfo.x,1u);
  let seedVal=U.shapeInfo.w;

  // Faucet: 3x3 cross-section, with enough longitudinal slices to bridge the
  // distance the stream travels between rendered frames.
  if(modeVal==1u){
    let crossN=max(U.shapeInfo.y,3u);
    let perSlice=crossN*crossN;
    let sliceId=min(r/perSlice,slices-1u);
    let planeId=r%perSlice;
    let rowY=i32(planeId%crossN)-i32(crossN/2u);
    let rowZ=i32((planeId/crossN)%crossN)-i32(crossN/2u);
    let j0=hash11(r*13u+seedVal*31u+7u)-.5;
    let j1=hash11(r*19u+seedVal*43u+11u)-.5;

    let flowDir=normalize(vec3f(1.0,-.54,0.0));
    let sideDir=vec3f(0.0,0.0,1.0);
    let upDir=normalize(vec3f(-flowDir.y,flowDir.x,0.0));
    let nozzle=vec3f(bx*.115,by*.805,bz*.50);
    let along=f32(sliceId)*d*.34;
    let radiusStep=d*.50;
    let sourcePos=nozzle+flowDir*along
      +upDir*(f32(rowY)*radiusStep+j0*d*.055)
      +sideDir*(f32(rowZ)*radiusStep+j1*d*.055);
    let speed=(1.00+.20*amount)*strength;
    let flowVel=flowDir*speed+sideDir*(j1*d*.35);
    let p4=vec4f(sourcePos,1.0);
    pos[i]=p4;
    pred[i]=p4;
    vel[i]=vec4f(flowVel,0.0);
  }

  // Waterfall: a continuous curtain. Lanes span the spill width, two rows give
  // the sheet thickness, and dt-sized longitudinal slices keep the falling water
  // connected even when the device renders at 20 FPS.
  if(modeVal==2u){
    let laneN=max(U.shapeInfo.y,8u);
    let thickN=max(U.shapeInfo.z,1u);
    let perSlice=laneN*thickN;
    let sliceId=min(r/perSlice,slices-1u);
    let planeId=r%perSlice;
    let laneId=planeId%laneN;
    let thickId=(planeId/laneN)%thickN;
    let laneT=(f32(laneId)+.5)/f32(laneN);
    let thickOffset=f32(thickId)-.5*f32(thickN-1u);
    let j0=hash11(r*17u+seedVal*29u+13u)-.5;
    let j1=hash11(r*23u+seedVal*37u+17u)-.5;

    let flowDir=normalize(vec3f(.46,-1.08,0.0));
    let widthDir=vec3f(0.0,0.0,1.0);
    let thickDir=normalize(vec3f(-flowDir.y,flowDir.x,0.0));
    let lip=vec3f(bx*.10,by*.82,bz*(.18+.64*laneT));
    let along=f32(sliceId)*d*.34;
    let sourcePos=lip+flowDir*along
      +thickDir*(thickOffset*d*.52+j0*d*.040)
      +widthDir*(j1*d*.055);
    let speed=(1.14+.14*amount)*strength;
    let flowVel=flowDir*speed+widthDir*(j1*.025*strength);
    let p4=vec4f(sourcePos,1.0);
    pos[i]=p4;
    pred[i]=p4;
    vel[i]=vec4f(flowVel,0.0);
  }
}`;

const shaderMod=dev.createShaderModule({code:wgsl,label:'fluidV5M833ContinuousSourceWGSL'});
if(typeof shaderMod.getCompilationInfo==='function'){
  const info=await shaderMod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length) throw new Error('M8.3.3 source WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M833ContinuousSource',layout:'auto',compute:{module:shaderMod,entryPoint:'main'}});
const uni=dev.createBuffer({label:'fluidV5M833ContinuousSourceUniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(16), U32=new Uint32Array(F.buffer);

let inStep=false,lastDt=1/60,cursor=0,lastScene='none',seed=1,passes=0,recycled=0;
const baseStep=sim.step.bind(sim);
const baseCreate=dev.createCommandEncoder.bind(dev);

function currentScene(){
  const a=modern.active;
  return a==='faucet'||a==='waterfall'?a:'none';
}
function sourceShape(name,d,dt,strength){
  const amount=Math.max(.12,Math.min(.82,Number(modern.amount)||.38));
  if(name==='faucet'){
    const speed=(1.00+.20*amount)*strength;
    const travel=speed*dt;
    const slices=Math.max(4,Math.min(9,Math.ceil(travel/Math.max(d*.34,.001))+2));
    const crossN=quality==='high'?4:3;
    return{mode:1,slices,crossN,thickN:1,count:slices*crossN*crossN,amount};
  }
  const speed=(1.14+.14*amount)*strength;
  const travel=speed*dt;
  const slices=Math.max(4,Math.min(9,Math.ceil(travel/Math.max(d*.34,.001))+2));
  const laneN=quality==='high'?22:quality==='medium'?18:14;
  const thickN=2;
  return{mode:2,slices,crossN:laneN,thickN,count:slices*laneN*thickN,amount};
}
function encodeContinuousSource(enc,name){
  const n=Math.max(1,sim.n||1);
  const b=sim.params.box,d=sim.params.spacing||.04;
  const dt=Math.min(.05,Math.max(.008,Number.isFinite(lastDt)?lastDt:1/60));
  const strength=Math.max(.45,Math.min(1.70,Number(modern.strength)||1));
  const shape=sourceShape(name,d,dt,strength);
  const count=Math.min(n,shape.count);
  if(count<1)return false;
  if(name!==lastScene){
    lastScene=name;seed=(seed+1)>>>0;cursor=(Math.floor(n*.371)+seed*131)%n;
  }
  const start=cursor%n;
  cursor=(cursor+count)%n;

  F.fill(0);
  F[0]=b[0];F[1]=b[1];F[2]=b[2];F[3]=d;
  F[4]=performance.now()*.001;F[5]=dt;F[6]=strength;F[7]=shape.amount;
  U32[8]=shape.mode;U32[9]=n;U32[10]=start;U32[11]=count;
  U32[12]=shape.slices;U32[13]=shape.crossN;U32[14]=shape.thickN;U32[15]=seed;
  dev.queue.writeBuffer(uni,0,F);

  const pos=sim.livePos?.(),vel=sim.liveVel?.();
  const pred=sim.buf?.[sim.parity===0?'predA':'predB'];
  if(!pos||!vel||!pred)return false;
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},
    {binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:pred}},
  ]});
  const pass=enc.beginComputePass({label:name==='faucet'?'fluidV5M833FaucetStream':'fluidV5M833WaterfallSheet'});
  pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(n/256));pass.end();
  passes++;recycled+=count;return true;
}

dev.createCommandEncoder=function(desc){
  const enc=baseCreate(desc);
  if(inStep){
    const name=currentScene();
    if(name!=='none'){
      try{encodeContinuousSource(enc,name)}catch(err){console.error('[M8.3.3 continuous source]',err)}
    }else lastScene='none';
  }
  return enc;
};
sim.step=function(dt){
  lastDt=Number.isFinite(dt)?dt:lastDt;
  inStep=true;
  try{return baseStep(dt)}finally{inStep=false;}
};

const note=document.querySelector('#m830SceneDock .m830Note');
if(note)note.textContent='continuous sources · common water · one submit';
window.__v5M833SourceFlow={
  online:true,backend:'dt-overlap-continuous-source-m833',gpuPassesAddedWhenActive:1,gpuSubmitsAdded:0,
  get passes(){return passes},get recycled(){return recycled},get scene(){return currentScene()}
};
window.__fluidV5Version='8.3.3';
window.__fluidV5Build='M8.3.3 CONTINUOUS FAUCET + WATERFALL / M8.2 COMMON WATER / ONE-SUBMIT CORE';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.3.3';
document.title='Fluid V8 · M8.3.3 Continuous Sources';
console.info('[Fluid V8 M8.3.3] frame-rate-aware faucet stream + waterfall sheet online; added submits 0.');