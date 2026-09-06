// Fluid V8 M8.3.1 — finite gravity reservoirs for Faucet and Waterfall.
// Unlike the legacy source scenes, this module never injects overlapping packets.
// It seeds one coherent PBF volume at rest and constrains it inside an elevated
// reservoir with an open outlet. World gravity alone establishes the stream.

const sim=window.__sim,ui=window.__ui;
const scenes=window.__v5M743Scenes;
const legacy=window.__v5M752PhysicalScenes;
if(!sim?.dev||!ui||!scenes?.online||!legacy?.online)
  throw new Error('M8.3 gravity sources: required solver/scenes unavailable.');

const dev=sim.dev;
const fullN=Math.max(1,sim.scene?.nFluid||sim.n||1);
let active='none',pendingSeed=false,inStep=false,seeds=0,boundaryPasses=0;

const boundaryWGSL=`
struct SourceU { boxSpacing:vec4f, info:vec4u }
@group(0) @binding(0) var<uniform> U:SourceU;
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> pred:array<vec4f>;

fn clampDisk(q:vec2f,c:vec2f,r:f32)->vec2f{
  let v=q-c;let l=length(v);
  if(l<=r){return q;}
  return c+v/max(l,1e-6)*r;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.info.x){return;}
  let b=U.boxSpacing.xyz;let d=U.boxSpacing.w;let pr=d*.48;
  let p0=pos[i].xyz;var p=pred[i].xyz;

  if(U.info.y==1u){
    // Faucet: hidden upper cistern plus a short round nozzle.
    let ctr=vec2f(b.x*.50,b.z*.50);
    let hx=b.x*.21;let hz=b.z*.32;
    let floorY=b.y*.86;let topY=b.y*.98;
    let outletR=d*2.45;let nozzleY=floorY-d*5.0;
    let inTank=p0.x>=ctr.x-hx-pr&&p0.x<=ctr.x+hx+pr&&
               p0.z>=ctr.y-hz-pr&&p0.z<=ctr.y+hz+pr&&
               p0.y>=floorY-pr&&p0.y<=topY+pr;
    let inNozzle=p0.y>=nozzleY-pr&&p0.y<floorY+pr&&
                 length(p0.xz-ctr)<=outletR+pr;
    if(inTank){
      p.x=clamp(p.x,ctr.x-hx+pr,ctr.x+hx-pr);
      p.z=clamp(p.z,ctr.y-hz+pr,ctr.y+hz-pr);
      p.y=min(p.y,topY-pr);
      let overHole=length(p.xz-ctr)<outletR-pr*.35;
      if(p.y<floorY+pr&&!overHole){p.y=floorY+pr;}
      if(p.y<floorY+pr&&overHole){
        let clampedXZ=clampDisk(p.xz,ctr,outletR-pr*.20);
        p.x=clampedXZ.x;p.z=clampedXZ.y;
      }
    }else if(inNozzle){
      let clampedXZ=clampDisk(p.xz,ctr,outletR-pr*.20);
      p.x=clampedXZ.x;p.z=clampedXZ.y;
    }
  }else if(U.info.y==2u){
    // Waterfall: a broad elevated trough draining through one continuous slot.
    let cx=b.x*.22;let cz=b.z*.50;
    let hx=b.x*.21;let hz=b.z*.37;
    let floorY=b.y*.82;let topY=b.y*.98;
    let slotX=d*1.35;let slotZ=hz-d*1.15;let chuteY=floorY-d*4.5;
    let inTank=p0.x>=cx-hx-pr&&p0.x<=cx+hx+pr&&
               p0.z>=cz-hz-pr&&p0.z<=cz+hz+pr&&
               p0.y>=floorY-pr&&p0.y<=topY+pr;
    let inChute=p0.y>=chuteY-pr&&p0.y<floorY+pr&&
                abs(p0.x-cx)<=slotX+pr&&abs(p0.z-cz)<=slotZ+pr;
    if(inTank){
      p.x=clamp(p.x,cx-hx+pr,cx+hx-pr);
      p.z=clamp(p.z,cz-hz+pr,cz+hz-pr);
      p.y=min(p.y,topY-pr);
      let overSlot=abs(p.x-cx)<slotX-pr*.20&&abs(p.z-cz)<slotZ-pr*.20;
      if(p.y<floorY+pr&&!overSlot){p.y=floorY+pr;}
      if(p.y<floorY+pr&&overSlot){
        p.x=clamp(p.x,cx-slotX+pr*.15,cx+slotX-pr*.15);
        p.z=clamp(p.z,cz-slotZ+pr*.15,cz+slotZ-pr*.15);
      }
    }else if(inChute){
      p.x=clamp(p.x,cx-slotX+pr*.15,cx+slotX-pr*.15);
      p.z=clamp(p.z,cz-slotZ+pr*.15,cz+slotZ-pr*.15);
    }
  }
  pred[i]=vec4f(p,1.0);
}`;

const shaderModule=dev.createShaderModule({code:boundaryWGSL,label:'fluidV8M831GravitySourceBoundaryWGSL'});
if(typeof shaderModule.getCompilationInfo==='function'){
  const info=await shaderModule.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.3 gravity source WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const boundaryPipe=await dev.createComputePipelineAsync({label:'fluidV8M831GravitySourceBoundary',layout:'auto',compute:{module:shaderModule,entryPoint:'main'}});
const boundaryUni=dev.createBuffer({label:'fluidV8M831GravitySourceUniform',size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const BF=new Float32Array(8),BU=new Uint32Array(BF.buffer);
const bindGroups=new Map();

function buffersFor(parity){
  return {
    pos:sim.buf?.[parity===0?'posA':'posB'],
    pred:sim.buf?.[parity===0?'predA':'predB'],
  };
}
function bindGroup(parity){
  const key=parity|0;if(bindGroups.has(key))return bindGroups.get(key);
  const b=buffersFor(key);if(!b.pos||!b.pred)return null;
  const bg=dev.createBindGroup({layout:boundaryPipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:boundaryUni}},
    {binding:1,resource:{buffer:b.pos}},
    {binding:2,resource:{buffer:b.pred}},
  ]});
  bindGroups.set(key,bg);return bg;
}
function uploadBoundary(){
  const b=sim.params.box,d=sim.params.spacing||.044;
  BF.fill(0);BF[0]=b[0];BF[1]=b[1];BF[2]=b[2];BF[3]=d;
  BU[4]=sim.n||fullN;BU[5]=active==='faucet'?1:active==='waterfall'?2:0;
  dev.queue.writeBuffer(boundaryUni,0,BF);
}
function encodeBoundary(enc,parity){
  if(active==='none')return;
  const bg=bindGroup(parity);if(!bg)return;
  const pass=enc.beginComputePass({label:'fluidV8M831GravitySourceBoundaryPass'});
  pass.setPipeline(boundaryPipe);pass.setBindGroup(0,bg);
  pass.dispatchWorkgroups(Math.ceil(Math.max(1,sim.n||fullN)/256));pass.end();
  boundaryPasses++;
}

function latticeSpec(bounds,d){
  const a=Math.cbrt(2)*d,dy=.5*a;
  const nx=Math.max(2,Math.floor((bounds.maxX-bounds.minX)/a)-1);
  const nz=Math.max(2,Math.floor((bounds.maxZ-bounds.minZ)/a)-1);
  const ny=Math.max(1,Math.floor((bounds.maxY-bounds.minY)/dy)-1);
  return {a,dy,nx,nz,ny,capacity:nx*nz*ny};
}
function fillBCC(out,start,count,bounds,d){
  const s=latticeSpec(bounds,d),layer=s.nx*s.nz;
  for(let j=0;j<count;j++){
    const iy=Math.floor(j/layer),r=j-iy*layer,iz=Math.floor(r/s.nx),ix=r-iz*s.nx;
    const off=(iy&1)*s.a*.5;
    const k=(start+j)*4;
    out[k]=bounds.minX+(ix+.55)*s.a+off;
    out[k+1]=bounds.minY+(iy+.65)*s.dy;
    out[k+2]=bounds.minZ+(iz+.55)*s.a+off;
    out[k+3]=1;
  }
  return s;
}
function zeroVelocity(buf){for(let i=3;i<buf.length;i+=4)buf[i]=0;}

function seedScenario(){
  const b=sim.params.box,d=sim.params.spacing||.044,n=fullN;
  const margin=d*.95;
  const upper=active==='faucet'
    ?{minX:b[0]*.29,maxX:b[0]*.71,minY:b[1]*.86,maxY:b[1]*.98,minZ:b[2]*.18,maxZ:b[2]*.82,fraction:.08}
    :{minX:Math.max(margin,b[0]*.01),maxX:b[0]*.43,minY:b[1]*.82,maxY:b[1]*.98,minZ:b[2]*.13,maxZ:b[2]*.87,fraction:.12};
  const upperSpec=latticeSpec(upper,d);
  const sourceN=Math.max(1,Math.min(Math.round(n*upper.fraction),Math.floor(upperSpec.capacity*.94)));
  const lowerN=n-sourceN;
  const lower={minX:margin,maxX:b[0]-margin,minY:margin,maxY:b[1]*.62,minZ:margin,maxZ:b[2]-margin};
  const P=new Float32Array(n*4),V=new Float32Array(n*4);
  fillBCC(P,0,lowerN,lower,d);fillBCC(P,lowerN,sourceN,upper,d);zeroVelocity(V);
  const names=['posA','posB','predA','predB'];
  for(const name of names){const target=sim.buf?.[name];if(target)dev.queue.writeBuffer(target,0,P);}
  for(const name of ['velA','velB']){const target=sim.buf?.[name];if(target)dev.queue.writeBuffer(target,0,V);}
  sim.n=n;if(sim.scene){sim.scene.n=n;sim.scene.nFluid=n;}
  sim.uploadParams?.(1/240);sim.bindCache=null;bindGroups.clear();seeds++;
}

const baseCreate=dev.createCommandEncoder.bind(dev),baseStep=sim.step.bind(sim);
dev.createCommandEncoder=function(desc){
  const enc=baseCreate(desc);
  if(!inStep||active==='none')return enc;
  let parity=sim.parity|0;
  return new Proxy(enc,{get(target,prop){
    if(prop==='beginComputePass')return function(passDesc){
      const pass=target.beginComputePass(passDesc);
      let pipeline=null;
      return new Proxy(pass,{get(passTarget,passProp){
        if(passProp==='setPipeline')return function(p){pipeline=p;return passTarget.setPipeline(p)};
        if(passProp==='end')return function(){
          const result=passTarget.end();
          if(pipeline===sim.pipe?.predict)encodeBoundary(target,parity);
          else if(pipeline===sim.pipe?.delta)encodeBoundary(target,parity);
          return result;
        };
        const value=passTarget[passProp];return typeof value==='function'?value.bind(passTarget):value;
      }});
    };
    const value=target[prop];return typeof value==='function'?value.bind(target):value;
  }});
};
sim.step=function(dt){
  if(active!=='none'){
    if(pendingSeed){pendingSeed=false;seedScenario();}
    uploadBoundary();
  }
  inStep=true;try{return baseStep(dt)}finally{inStep=false;}
};

function choose(name){
  if(name!=='faucet'&&name!=='waterfall')return false;
  try{legacy.disable?.()}catch{}
  scenes.choose('pool');active=name;pendingSeed=true;bindGroups.clear();
  if(ui.paused)ui.paused=false;
  return true;
}
function disable(){active='none';pendingSeed=false;bindGroups.clear();}

window.__v5M755GravitySources={
  online:true,backend:'finite-reservoir-world-gravity-m831',choose,disable,
  get active(){return active},get seeds(){return seeds},get boundaryPasses(){return boundaryPasses},
  get model(){return 'zero-velocity PBF reservoir + static outlet boundary + world gravity'},
};
console.info('[Fluid V8 M8.3.1] Faucet/Waterfall use finite at-rest reservoirs; no particle packets or launch acceleration.');
