// Fluid V8 M8.3.4 — conservative continuous faucet + waterfall flow.
//
// M8.3.3 proved that multiplying source slices per frame destabilizes the pool because
// too many active fluid particles are teleported into the emitter at once. M8.3.4 keeps
// the original low particle budget and makes continuity spatial instead:
//   • emission cadence is distance-based, not frame-based;
//   • faucet emits one compact 3x3 cross-section per spacing interval;
//   • waterfall emits one narrow full-width row per spacing interval;
//   • a mild airborne velocity-alignment field keeps each source coherent until impact.
// Existing particles are still recycled, so total fluid mass is conserved and there are
// zero additional queue submits.

const sim=window.__sim;
const modern=window.__v5M752PhysicalScenes;
const scenes=window.__v5M830Scenes;
if(!sim?.dev||!modern?.online||!scenes?.online) throw new Error('M8.3.4 source flow: scenario runtime unavailable.');
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
    let flowDir=normalize(vec3f(.78,-.34,0.0));
    let sideDir=vec3f(0.0,0.0,1.0);
    let upDir=normalize(vec3f(-flowDir.y,flowDir.x,0.0));
    let speed=(.63+.10*amount)*strength;
    let flowVel=flowDir*speed;

    if(rankVal>=0){
      let r=u32(rankVal);
      let crossN=max(U.shapeInfo.x,3u);
      let rowY=i32(r%crossN)-i32(crossN/2u);
      let rowZ=i32((r/crossN)%crossN)-i32(crossN/2u);
      let j0=hash11(r*17u+seedVal*31u+5u)-.5;
      let j1=hash11(r*23u+seedVal*43u+9u)-.5;
      let radiusStep=d*.40;
      let sourcePos=nozzle
        +upDir*(f32(rowY)*radiusStep+j0*d*.025)
        +sideDir*(f32(rowZ)*radiusStep+j1*d*.025);
      p=vec4f(sourcePos,1.0);
      v=vec4f(flowVel+sideDir*(j1*.012),0.0);
      pred[i]=p;
    }

    // Keep only the airborne near-nozzle stream aligned. This is deliberately mild:
    // pressure/gravity still control the jet once it approaches the pool.
    let rel=p.xyz-nozzle;
    let along=dot(rel,flowDir);
    let perp=rel-flowDir*along;
    let tubeR=length(perp);
    let airborne=select(0.0,1.0,p.y>surface+d*2.5);
    let inTube=(1.0-smoothstep(d*1.45,d*2.25,tubeR))*airborne
      *select(0.0,1.0,along>0.0 && along<bx*.48);
    if(inTube>0.0){
      let align=.10+.08*inTube;
      v.xyz=mix(v.xyz,flowVel,align);
      v.xyz-=perp*(1.35*dt*inTube);
    }
  }

  if(modeVal==2u){
    let laneN=max(U.shapeInfo.x,10u);
    let flowDir=normalize(vec3f(.30,-.96,0.0));
    let speed=(.67+.10*amount)*strength;
    let flowVel=flowDir*speed;
    let width=bz*.50;
    let z0=bz*.50-width*.50;
    let lipBase=vec3f(bx*.105,by*.825,bz*.50);

    if(rankVal>=0){
      let r=u32(rankVal);
      let laneId=r%laneN;
      let laneT=(f32(laneId)+.5)/f32(laneN);
      let j0=hash11(r*19u+seedVal*29u+7u)-.5;
      let z=z0+laneT*width+j0*d*.035;
      let sourcePos=vec3f(lipBase.x,lipBase.y,z);
      p=vec4f(sourcePos,1.0);
      v=vec4f(flowVel+vec3f(0.0,0.0,j0*.008),0.0);
      pred[i]=p;
    }

    // A thin alignment band preserves the falling curtain without turning it into a rigid wall.
    let rel=p.xyz-lipBase;
    let along=dot(rel,flowDir);
    let normal2=normalize(vec2f(-flowDir.y,flowDir.x));
    let planeDist=abs(dot(rel.xy,normal2));
    let withinWidth=select(0.0,1.0,p.z>z0-d && p.z<z0+width+d);
    let airborne=select(0.0,1.0,p.y>surface+d*2.0);
    let inSheet=(1.0-smoothstep(d*.65,d*1.35,planeDist))*withinWidth*airborne
      *select(0.0,1.0,along>0.0 && along<by*.72);
    if(inSheet>0.0){
      let align=.12+.08*inSheet;
      v.xy=mix(v.xy,flowVel.xy,align);
      v.z=mix(v.z,0.0,.16*inSheet);
    }
  }

  pos[i]=p;
  vel[i]=v;
}`;

const shaderMod=dev.createShaderModule({code:wgsl,label:'fluidV5M834ConservativeSourceWGSL'});
if(typeof shaderMod.getCompilationInfo==='function'){
  const info=await shaderMod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length) throw new Error('M8.3.4 source WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M834ConservativeSource',layout:'auto',compute:{module:shaderMod,entryPoint:'main'}});
const uni=dev.createBuffer({label:'fluidV5M834ConservativeSourceUniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(16), U32=new Uint32Array(F.buffer);

let inStep=false,lastDt=1/60,cursor=0,lastScene='none',seed=1;
let carryDistance=0,passes=0,recycled=0,emissions=0;
const baseStep=sim.step.bind(sim);
const baseCreate=dev.createCommandEncoder.bind(dev);

function activeSource(){
  const a=modern.active;
  return a==='faucet'||a==='waterfall'?a:'none';
}
function config(name,d,strength,amount){
  if(name==='faucet'){
    const crossN=3;
    const speed=(.63+.10*amount)*strength;
    return{mode:1,count:crossN*crossN,shapeN:crossN,speed,spacing:d*.72};
  }
  const laneN=quality==='high'?18:quality==='medium'?16:14;
  const speed=(.67+.10*amount)*strength;
  return{mode:2,count:laneN,shapeN:laneN,speed,spacing:d*.78};
}
function encodeSource(enc,name){
  const n=Math.max(1,sim.n||1);
  const b=sim.params.box,d=sim.params.spacing||.04;
  const dt=Math.min(.05,Math.max(.004,Number.isFinite(lastDt)?lastDt:1/60));
  const strength=Math.max(.45,Math.min(1.70,Number(modern.strength)||1));
  const amount=Math.max(.12,Math.min(.82,Number(modern.amount)||.38));
  const cfg=config(name,d,strength,amount);

  if(name!==lastScene){
    lastScene=name;carryDistance=cfg.spacing;seed=(seed+1)>>>0;
    cursor=(Math.floor(n*.271)+seed*83)%n;
  }
  carryDistance+=cfg.speed*dt;
  let rows=Math.floor(carryDistance/Math.max(cfg.spacing,.001));
  rows=Math.max(0,Math.min(rows,2));
  if(rows>0)carryDistance-=rows*cfg.spacing;

  // One row is enough to bridge the stream at normal mobile frame times. A second
  // row is allowed only after a genuine long frame, preventing source explosions.
  const count=Math.min(n,cfg.count*rows);
  const start=count>0?cursor%n:0;
  if(count>0){cursor=(cursor+count)%n;emissions+=rows;recycled+=count;seed=(seed+1)>>>0;}

  F.fill(0);
  F[0]=b[0];F[1]=b[1];F[2]=b[2];F[3]=d;
  F[4]=dt;F[5]=strength;F[6]=amount;F[7]=b[1]*.37;
  U32[8]=cfg.mode;U32[9]=n;U32[10]=start;U32[11]=count;
  U32[12]=cfg.shapeN;U32[13]=rows;U32[14]=0;U32[15]=seed;
  dev.queue.writeBuffer(uni,0,F);

  const pos=sim.livePos?.(),vel=sim.liveVel?.();
  const pred=sim.buf?.[sim.parity===0?'predA':'predB'];
  if(!pos||!vel||!pred)return false;
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},
    {binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:pred}},
  ]});
  const pass=enc.beginComputePass({label:name==='faucet'?'fluidV5M834Faucet':'fluidV5M834Waterfall'});
  pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(n/256));pass.end();
  passes++;return true;
}

dev.createCommandEncoder=function(desc){
  const enc=baseCreate(desc);
  if(inStep){
    const name=activeSource();
    if(name!=='none'){
      try{encodeSource(enc,name)}catch(err){console.error('[M8.3.4 source flow]',err)}
    }else{lastScene='none';carryDistance=0;}
  }
  return enc;
};
sim.step=function(dt){
  lastDt=Number.isFinite(dt)?dt:lastDt;
  inStep=true;
  try{return baseStep(dt)}finally{inStep=false;}
};

const note=document.querySelector('#m830SceneDock .m830Note');
if(note)note.textContent='conservative continuous sources · common water';
window.__v5M834SourceFlow={
  online:true,backend:'distance-cadence-aligned-source-m834',gpuPassesAddedWhenActive:1,gpuSubmitsAdded:0,
  get passes(){return passes},get recycled(){return recycled},get emissions(){return emissions},get scene(){return activeSource()}
};
window.__fluidV5Version='8.3.4';
window.__fluidV5Build='M8.3.4 CONSERVATIVE CONTINUOUS SOURCES / M8.2 COMMON WATER / ONE-SUBMIT CORE';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.3.4';
document.title='Fluid V8 · M8.3.4 Conservative Sources';
console.info('[Fluid V8 M8.3.4] conservative distance-based faucet + waterfall online; added submits 0.');
