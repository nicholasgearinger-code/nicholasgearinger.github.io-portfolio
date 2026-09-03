// Fluid V8 M8.3.4 — safe low-budget continuous source flow.
// One source row maximum per rendered frame. Emission cadence is based on distance
// travelled so particle spacing remains stable across mobile frame rates. A gentle
// airborne alignment field keeps the faucet jet and waterfall curtain coherent.

const sim=window.__sim;
const modern=window.__v5M752PhysicalScenes;
const scenes=window.__v5M830Scenes;
if(!sim?.dev||!modern?.online||!scenes?.online) throw new Error('M8.3.4 safe source: runtime unavailable.');
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
fn sourceRank(i:u32,n:u32,startVal:u32,countVal:u32)->i32 {
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
  let rankVal=sourceRank(i,n,U.flowInfo.z,U.flowInfo.w);
  let bx=U.boxData.x;
  let by=U.boxData.y;
  let bz=U.boxData.z;
  let d=max(U.boxData.w,.001);
  let dt=clamp(U.flowData.x,.004,.05);
  let strength=U.flowData.y;
  let amount=U.flowData.z;
  let surface=U.flowData.w;
  let seedVal=U.shapeInfo.w;
  var p=pos[i];
  var v=vel[i];

  if(modeVal==1u){
    let nozzle=vec3f(bx*.115,by*.805,bz*.50);
    let flowDir=normalize(vec3f(.80,-.30,0.0));
    let sideDir=vec3f(0.0,0.0,1.0);
    let upDir=normalize(vec3f(-flowDir.y,flowDir.x,0.0));
    let speed=(.60+.08*amount)*strength;
    let flowVel=flowDir*speed;

    if(rankVal>=0){
      let r=u32(rankVal);
      let crossN=max(U.shapeInfo.x,3u);
      let rowY=i32(r%crossN)-i32(crossN/2u);
      let rowZ=i32((r/crossN)%crossN)-i32(crossN/2u);
      let j0=hash11(r*17u+seedVal*31u+5u)-.5;
      let j1=hash11(r*23u+seedVal*43u+9u)-.5;
      let stepR=d*.38;
      let sourcePos=nozzle
        +upDir*(f32(rowY)*stepR+j0*d*.018)
        +sideDir*(f32(rowZ)*stepR+j1*d*.018);
      p=vec4f(sourcePos,1.0);
      v=vec4f(flowVel+sideDir*(j1*.008),0.0);
      pred[i]=p;
    }

    let rel=p.xyz-nozzle;
    let along=dot(rel,flowDir);
    let perp=rel-flowDir*along;
    let tubeR=length(perp);
    let airborne=select(0.0,1.0,p.y>surface+d*2.8);
    let pathMask=select(0.0,1.0,along>0.0 && along<bx*.42);
    let tubeMask=(1.0-smoothstep(d*1.35,d*2.05,tubeR))*airborne*pathMask;
    if(tubeMask>0.0){
      v.xyz=mix(v.xyz,flowVel,.12*tubeMask);
      v.xyz-=perp*(.95*dt*tubeMask);
    }
  }

  if(modeVal==2u){
    let laneN=max(U.shapeInfo.x,10u);
    let flowDir=normalize(vec3f(.24,-.97,0.0));
    let speed=(.62+.08*amount)*strength;
    let flowVel=flowDir*speed;
    let width=bz*.46;
    let z0=bz*.50-width*.50;
    let lip=vec3f(bx*.105,by*.825,bz*.50);

    if(rankVal>=0){
      let r=u32(rankVal);
      let laneId=r%laneN;
      let laneT=(f32(laneId)+.5)/f32(laneN);
      let j0=hash11(r*19u+seedVal*29u+7u)-.5;
      let sourcePos=vec3f(lip.x,lip.y,z0+laneT*width+j0*d*.025);
      p=vec4f(sourcePos,1.0);
      v=vec4f(flowVel+vec3f(0.0,0.0,j0*.006),0.0);
      pred[i]=p;
    }

    let rel=p.xyz-lip;
    let along=dot(rel,flowDir);
    let planeNormal=normalize(vec2f(-flowDir.y,flowDir.x));
    let planeDist=abs(dot(rel.xy,planeNormal));
    let widthMask=select(0.0,1.0,p.z>z0-d*.7 && p.z<z0+width+d*.7);
    let airborne=select(0.0,1.0,p.y>surface+d*2.4);
    let pathMask=select(0.0,1.0,along>0.0 && along<by*.66);
    let sheetMask=(1.0-smoothstep(d*.55,d*1.15,planeDist))*widthMask*airborne*pathMask;
    if(sheetMask>0.0){
      v.xy=mix(v.xy,flowVel.xy,.14*sheetMask);
      v.z=mix(v.z,0.0,.12*sheetMask);
    }
  }

  pos[i]=p;
  vel[i]=v;
}`;

const shaderMod=dev.createShaderModule({code:wgsl,label:'fluidV5M834SafeSourceWGSL'});
if(typeof shaderMod.getCompilationInfo==='function'){
  const info=await shaderMod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length) throw new Error('M8.3.4 safe source WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M834SafeSource',layout:'auto',compute:{module:shaderMod,entryPoint:'main'}});
const uni=dev.createBuffer({label:'fluidV5M834SafeSourceUniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(16), U32=new Uint32Array(F.buffer);
let inStep=false,lastDt=1/60,lastScene='none',carry=0,cursor=0,seed=1,passes=0,recycled=0,emissions=0;
const baseStep=sim.step.bind(sim);
const baseCreate=dev.createCommandEncoder.bind(dev);

function activeSource(){
  const a=modern.active;
  return a==='faucet'||a==='waterfall'?a:'none';
}
function config(name,d,strength,amount){
  if(name==='faucet'){
    const shapeN=3;
    const speed=(.60+.08*amount)*strength;
    return{mode:1,shapeN,count:9,speed,spacing:d*.68};
  }
  const shapeN=quality==='high'?18:quality==='medium'?16:14;
  const speed=(.62+.08*amount)*strength;
  return{mode:2,shapeN,count:shapeN,speed,spacing:d*.72};
}
function encodeSource(enc,name){
  const n=Math.max(1,sim.n||1);
  const b=sim.params.box,d=sim.params.spacing||.04;
  const dt=Math.min(.05,Math.max(.004,Number.isFinite(lastDt)?lastDt:1/60));
  const strength=Math.max(.45,Math.min(1.70,Number(modern.strength)||1));
  const amount=Math.max(.12,Math.min(.82,Number(modern.amount)||.38));
  const cfg=config(name,d,strength,amount);
  if(name!==lastScene){
    lastScene=name;carry=cfg.spacing;seed=(seed+1)>>>0;
    cursor=(Math.floor(n*.271)+seed*83)%n;
  }
  carry+=cfg.speed*dt;
  const emit=carry>=cfg.spacing;
  if(emit)carry-=cfg.spacing;
  // Never accumulate an unlimited backlog after a stall/background event.
  carry=Math.min(carry,cfg.spacing*.98);
  const count=emit?Math.min(n,cfg.count):0;
  const start=count>0?cursor%n:0;
  if(count>0){cursor=(cursor+count)%n;seed=(seed+1)>>>0;emissions++;recycled+=count;}

  F.fill(0);
  F[0]=b[0];F[1]=b[1];F[2]=b[2];F[3]=d;
  F[4]=dt;F[5]=strength;F[6]=amount;F[7]=b[1]*.37;
  U32[8]=cfg.mode;U32[9]=n;U32[10]=start;U32[11]=count;
  U32[12]=cfg.shapeN;U32[13]=0;U32[14]=0;U32[15]=seed;
  dev.queue.writeBuffer(uni,0,F);
  const pos=sim.livePos?.(),vel=sim.liveVel?.();
  const pred=sim.buf?.[sim.parity===0?'predA':'predB'];
  if(!pos||!vel||!pred)return false;
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},
    {binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:pred}},
  ]});
  const pass=enc.beginComputePass({label:name==='faucet'?'fluidV5M834SafeFaucet':'fluidV5M834SafeWaterfall'});
  pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(n/256));pass.end();
  passes++;return true;
}

dev.createCommandEncoder=function(desc){
  const enc=baseCreate(desc);
  if(inStep){
    const name=activeSource();
    if(name!=='none'){
      try{encodeSource(enc,name)}catch(err){console.error('[M8.3.4 safe source]',err)}
    }else{lastScene='none';carry=0;}
  }
  return enc;
};
sim.step=function(dt){
  lastDt=Number.isFinite(dt)?dt:lastDt;
  inStep=true;
  try{return baseStep(dt)}finally{inStep=false;}
};

const note=document.querySelector('#m830SceneDock .m830Note');
if(note)note.textContent='low-budget continuous sources · common water';
window.__v5M834SourceFlow={online:true,backend:'safe-distance-cadence-m834',gpuPassesAddedWhenActive:1,gpuSubmitsAdded:0,
  get passes(){return passes},get recycled(){return recycled},get emissions(){return emissions},get scene(){return activeSource()}};
window.__fluidV5Version='8.3.4';
window.__fluidV5Build='M8.3.4 SAFE CONTINUOUS FAUCET + WATERFALL / M8.2 COMMON WATER / ONE-SUBMIT CORE';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.3.4';
document.title='Fluid V8 · M8.3.4 Safe Sources';
console.info('[Fluid V8 M8.3.4] safe low-budget faucet + waterfall online; added submits 0.');
