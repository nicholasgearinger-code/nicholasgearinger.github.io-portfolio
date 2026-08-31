// Fluid V8 M8.4 — physical flow boundaries on the M8.2 common-water solver.
//
// This replaces the visual/source-emitter approach for the primary flowing-water tests:
//   FAUCET    = true inlet boundary. Previously inactive tail particles become water at Q=A*v.
//   WATERFALL = true lip inlet boundary using the same mass-flux accounting.
//   FOUNTAIN  = closed-loop pump: only particles that physically reach the floor intake are
//               transferred through a hidden return pipe to the nozzle.
//   POUR      = actual elevated fluid reservoir with a virtual container + gate. Once a
//               reservoir particle crosses the gate it becomes ordinary M8.2 water forever.
//
// No source pass ever steals arbitrary particles from the visible pool. No airborne alignment
// or scripted stream forcing is applied after an inlet crossing. All work is encoded into the
// existing GPUCommandEncoder and adds zero queue.submit calls.

const sim=window.__sim, ui=window.__ui;
const baseScenes=window.__v5M830Scenes;
if(!sim?.dev||!ui||!baseScenes?.online||!window.__v5M820FluidCore?.online)
  throw new Error('M8.4 flow boundaries: M8.2/M8.3 runtime unavailable.');
const dev=sim.dev;
const fullN=Math.max(1,sim.scene?.nFluid||sim.n||1);
const quality=new URLSearchParams(location.search).get('quality')||'low';

let modeName='pool';
let inStep=false,lastDt=1/60,sceneTime=0,warmup=0;
let fluxCarry=0,pendingStart=0,pendingCount=0,serial=1;
let reserveBase=fullN,reserveTotal=0,activatedTotal=0;
let flowPasses=0,seedPasses=0;
let currentRate=0,currentQ=0;
let faucetSpeed=.62,waterfallSpeed=.54,fountainSpeed=1.28,pumpStrength=1.0,pourTilt=2.6;
let pourBounds=null,pendingPourSeed=false;

function setCount(n){
  const next=Math.max(1,Math.min(fullN,Math.floor(n)));
  sim.n=next;
  if(sim.scene){sim.scene.n=next;sim.scene.nFluid=next;}
  sim.uploadParams?.(1/240);
  sim.bindCache=null;
}
function restoreFull(){setCount(fullN);reserveBase=fullN;reserveTotal=0;activatedTotal=0;fluxCarry=0;pendingCount=0;}

// ---------------------------------------------------------------------------
// Shared physical-flow pass.
// ---------------------------------------------------------------------------
const flowWGSL=`
struct FlowU {
  boxData:vec4f,
  flowData:vec4f,
  rangeData:vec4u,
  shapeData:vec4u,
  regionA:vec4f,
  regionB:vec4f,
}
@group(0) @binding(0) var<uniform> U:FlowU;
@group(0) @binding(1) var<storage,read_write> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> pred:array<vec4f>;
@group(0) @binding(4) var<storage,read_write> phaseState:array<u32>;

fn hash11(x:u32)->f32 {
  var h=x*747796405u+2891336453u;
  h=((h>>((h>>28u)+4u))^h)*277803737u;
  h=(h>>22u)^h;
  return f32(h & 0x00ffffffu)/16777215.0;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;
  let particleCount=U.rangeData.x;
  if(i>=particleCount){return;}
  let modeVal=U.rangeData.y;
  let startIdx=U.rangeData.z;
  let emitCount=U.rangeData.w;
  let bx=U.boxData.x;
  let by=U.boxData.y;
  let bz=U.boxData.z;
  let d=max(U.boxData.w,.001);

  // -----------------------------------------------------------------------
  // mode 1: Faucet inlet. Only newly activated reserve particles are touched.
  // -----------------------------------------------------------------------
  if(modeVal==1u){
    if(i<startIdx||i>=startIdx+emitCount){return;}
    let localIdx=i-startIdx;
    let speed=U.flowData.x;
    let radius=U.flowData.y;
    let sequence=U.shapeData.w;
    let nozzle=vec3f(bx*.115,by*.805,bz*.50);
    let flowDir=normalize(vec3f(.82,-.31,0.0));
    let sideDir=vec3f(0.0,0.0,1.0);
    let upDir=normalize(vec3f(-flowDir.y,flowDir.x,0.0));
    let slot=(localIdx+sequence*5u)%17u;
    let theta=6.28318530718*f32(slot)/17.0;
    let rr=radius*sqrt((f32(slot)+.45)/17.0);
    let j=(hash11(i*19u+sequence*37u+11u)-.5)*d*.025;
    let outlet=nozzle-flowDir*d*.28;
    let p3=outlet+upDir*(cos(theta)*rr)+sideDir*(sin(theta)*rr+j);
    let v3=flowDir*speed;
    let p4=vec4f(p3,1.0);
    pos[i]=p4;pred[i]=p4;vel[i]=vec4f(v3,0.0);phaseState[i]=0u;
    return;
  }

  // -----------------------------------------------------------------------
  // mode 2: Waterfall lip inlet. A thin sheet crosses the boundary; gravity
  // and the M8.2 pressure solve control everything after that crossing.
  // -----------------------------------------------------------------------
  if(modeVal==2u){
    if(i<startIdx||i>=startIdx+emitCount){return;}
    let localIdx=i-startIdx;
    let speed=U.flowData.x;
    let width=U.flowData.y;
    let thickness=U.flowData.z;
    let laneCount=max(U.shapeData.x,2u);
    let layerCount=max(U.shapeData.y,1u);
    let sequence=U.shapeData.w;
    let crossCount=max(laneCount*layerCount,1u);
    let slot=(localIdx+sequence*7u)%crossCount;
    let lane=slot%laneCount;
    let layer=(slot/laneCount)%layerCount;
    let laneT=(f32(lane)+.5)/f32(laneCount);
    let layerT=(f32(layer)+.5)/f32(layerCount)-.5;
    let flowDir=normalize(vec3f(.31,-.95,0.0));
    let normalDir=normalize(vec3f(-flowDir.y,flowDir.x,0.0));
    let lip=vec3f(bx*.105,by*.825,bz*.50);
    let j=(hash11(i*23u+sequence*29u+13u)-.5)*d*.018;
    let p3=lip-flowDir*d*.24
      +vec3f(0.0,0.0,(laneT-.5)*width+j)
      +normalDir*(layerT*thickness);
    let p4=vec4f(p3,1.0);
    pos[i]=p4;pred[i]=p4;vel[i]=vec4f(flowDir*speed,0.0);phaseState[i]=0u;
    return;
  }

  // -----------------------------------------------------------------------
  // mode 3: Fountain closed-loop pump. Only water physically entering the
  // floor throat is sent through the hidden return pipe to the nozzle.
  // -----------------------------------------------------------------------
  if(modeVal==3u){
    var p3=pos[i].xyz;
    var v3=vel[i].xyz;
    let dt=clamp(U.flowData.w,.003,.05);
    let jetSpeed=U.flowData.x;
    let suction=U.flowData.y;
    let centre=vec2f(bx*.50,bz*.50);
    let rel=vec2f(p3.x,p3.z)-centre;
    let r=length(rel);
    var dir2=vec2f(0.0);
    if(r>1.0e-5){dir2=rel/r;}
    let intakeR=min(bx,bz)*.155;
    let throatR=max(d*2.25,min(bx,bz)*.042);
    let floorBand=1.0-smoothstep(d*2.0,max(d*9.0,by*.18),p3.y);
    let radialBand=1.0-smoothstep(intakeR*.35,intakeR,r);
    let pull=radialBand*floorBand*suction;
    v3=v3+vec3f(-dir2.x*1.10*pull,-.72*pull,-dir2.y*1.10*pull)*dt;

    if(r<throatR && p3.y<d*3.0){
      let slot=(i+U.shapeData.w*11u)%13u;
      let theta=6.28318530718*f32(slot)/13.0;
      let rr=d*1.55*sqrt((f32(slot)+.4)/13.0);
      let nozzle=vec3f(bx*.50,d*5.2,bz*.50);
      p3=nozzle+vec3f(cos(theta)*rr,0.0,sin(theta)*rr);
      v3=vec3f(cos(theta)*.055*jetSpeed,jetSpeed,sin(theta)*.055*jetSpeed);
      phaseState[i]=0u;
    }
    let p4=vec4f(p3,1.0);
    pos[i]=p4;pred[i]=p4;vel[i]=vec4f(v3,0.0);
    return;
  }

  // -----------------------------------------------------------------------
  // mode 4: Pour reservoir boundary. state==1 means the particle is still
  // inside the virtual container. Crossing the gate flips it permanently to
  // ordinary water (state 0); it is never scripted again.
  // -----------------------------------------------------------------------
  if(modeVal==4u){
    if(phaseState[i]!=1u){return;}
    let dt=clamp(U.flowData.w,.003,.05);
    let elapsed=U.flowData.x;
    let tiltAccel=U.flowData.y;
    let x0=U.regionA.x;let x1=U.regionA.y;
    let z0=U.regionA.z;let z1=U.regionA.w;
    let y0=U.regionB.x;let y1=U.regionB.y;
    let gateTop=U.regionB.z;let gateHalf=U.regionB.w;
    let zc=(z0+z1)*.5;
    var px=pos[i].x;var py=pos[i].y;var pz=pos[i].z;
    var vx=vel[i].x;var vy=vel[i].y;var vz=vel[i].z;
    let gateRamp=smoothstep(.20,.68,elapsed);
    vx=vx+tiltAccel*gateRamp*dt;

    let inGateY=py<gateTop;
    let inGateZ=abs(pz-zc)<gateHalf;
    if(px>x1-d*.10 && inGateY && inGateZ && elapsed>.24){
      phaseState[i]=0u;
      vx=max(vx,.18+.12*gateRamp);
      let p4=vec4f(px,py,pz,1.0);
      pos[i]=p4;pred[i]=p4;vel[i]=vec4f(vx,vy,vz,0.0);
      return;
    }

    // Virtual container collision response. This is only applied while the
    // particle remains reservoir water; released particles bypass it forever.
    if(px<x0){px=x0+d*.18;vx=max(vx,0.0)*.12;}
    if(px>x1){px=x1-d*.18;vx=min(vx,0.0)*.12;}
    if(pz<z0){pz=z0+d*.18;vz=max(vz,0.0)*.12;}
    if(pz>z1){pz=z1-d*.18;vz=min(vz,0.0)*.12;}
    if(py<y0){py=y0+d*.18;vy=max(vy,0.0)*.10;}
    if(py>y1){py=y1-d*.18;vy=min(vy,0.0)*.10;}
    let p4=vec4f(px,py,pz,1.0);
    pos[i]=p4;pred[i]=p4;vel[i]=vec4f(vx,vy,vz,0.0);
  }
}`;
const flowMod=dev.createShaderModule({code:flowWGSL,label:'fluidV5M840FlowBoundariesWGSL'});
if(typeof flowMod.getCompilationInfo==='function'){
  const info=await flowMod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.4 flow WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const flowPipe=await dev.createComputePipelineAsync({label:'fluidV5M840FlowBoundaries',layout:'auto',compute:{module:flowMod,entryPoint:'main'}});
const flowUni=dev.createBuffer({label:'fluidV5M840FlowUniform',size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const FF=new Float32Array(24), FU=new Uint32Array(FF.buffer);
const phaseState=dev.createBuffer({label:'fluidV5M840FlowState',size:Math.max(16,fullN*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});

// ---------------------------------------------------------------------------
// Pour seed: lower pool + elevated reservoir. Reservoir membership is explicit
// in phaseState and therefore survives particle motion without index heuristics.
// ---------------------------------------------------------------------------
const seedWGSL=`
struct SeedU {
  boxData:vec4f,
  countData:vec4u,
  lowerDims:vec4u,
  upperDims:vec4u,
  upperPlace:vec4f,
}
@group(0) @binding(0) var<uniform> U:SeedU;
@group(0) @binding(1) var<storage,read_write> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> pred:array<vec4f>;
@group(0) @binding(4) var<storage,read_write> phaseState:array<u32>;
fn hash11(x:u32)->f32 {
  var h=x*747796405u+2891336453u;
  h=((h>>((h>>28u)+4u))^h)*277803737u;
  h=(h>>22u)^h;
  return f32(h & 0x00ffffffu)/16777215.0;
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;let n=U.countData.x;if(i>=n){return;}
  let poolCount=U.countData.y;let d=U.boxData.w;let margin=d;
  var p=vec3f(0.0);var stateVal=0u;
  if(i<poolCount){
    let nx=max(U.lowerDims.x,1u);let nz=max(U.lowerDims.y,1u);let layer=nx*nz;
    let ix=i%nx;let iz=(i/nx)%nz;let iy=i/layer;
    let jx=(hash11(i*3u+1u)-.5)*d*.045;
    let jy=(hash11(i*3u+2u)-.5)*d*.035;
    let jz=(hash11(i*3u+3u)-.5)*d*.045;
    p=vec3f(margin+(f32(ix)+.5)*d+jx,margin+(f32(iy)+.5)*d+jy,margin+(f32(iz)+.5)*d+jz);
  }else{
    let j=i-poolCount;let nx=max(U.upperDims.x,1u);let nz=max(U.upperDims.y,1u);let layer=nx*nz;
    let ix=j%nx;let iz=(j/nx)%nz;let iy=j/layer;
    let jx=(hash11(j*5u+7u)-.5)*d*.040;
    let jy=(hash11(j*7u+11u)-.5)*d*.030;
    let jz=(hash11(j*11u+13u)-.5)*d*.040;
    p=vec3f(U.upperPlace.x+(f32(ix)+.5)*d+jx,
            U.upperPlace.y+(f32(iy)+.5)*d+jy,
            U.upperPlace.z+(f32(iz)+.5)*d+jz);
    stateVal=1u;
  }
  p=clamp(p,vec3f(margin),U.boxData.xyz-vec3f(margin));
  let p4=vec4f(p,1.0);pos[i]=p4;pred[i]=p4;vel[i]=vec4f(0.0);phaseState[i]=stateVal;
}`;
const seedMod=dev.createShaderModule({code:seedWGSL,label:'fluidV5M840PourSeedWGSL'});
if(typeof seedMod.getCompilationInfo==='function'){
  const info=await seedMod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.4 pour seed WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const seedPipe=await dev.createComputePipelineAsync({label:'fluidV5M840PourSeed',layout:'auto',compute:{module:seedMod,entryPoint:'main'}});
const seedUni=dev.createBuffer({label:'fluidV5M840PourSeedUniform',size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const SF=new Float32Array(20), SU=new Uint32Array(SF.buffer);

function buffers(){
  const pos=sim.livePos?.(),vel=sim.liveVel?.();
  const pred=sim.buf?.[sim.parity===0?'predA':'predB'];
  return{pos,vel,pred};
}
function writeFlowUniform(modeVal,startIdx,emitCount){
  const b=sim.params.box,d=sim.params.spacing||.044,n=Math.max(1,sim.n||1);
  FF.fill(0);FF[0]=b[0];FF[1]=b[1];FF[2]=b[2];FF[3]=d;
  FU[8]=n;FU[9]=modeVal;FU[10]=startIdx;FU[11]=emitCount;
  FU[12]=0;FU[13]=0;FU[14]=fullN;FU[15]=serial;
  if(modeVal===1){
    FF[4]=faucetSpeed;FF[5]=d*1.72;FF[6]=0;FF[7]=lastDt;
  }else if(modeVal===2){
    const width=b[2]*.47,thickness=d*1.45;
    const lanes=Math.max(8,Math.floor(width/(d*.78)));const layers=2;
    FF[4]=waterfallSpeed;FF[5]=width;FF[6]=thickness;FF[7]=lastDt;
    FU[12]=lanes;FU[13]=layers;
  }else if(modeVal===3){
    FF[4]=fountainSpeed;FF[5]=pumpStrength;FF[6]=b[1]*.37;FF[7]=lastDt;
  }else if(modeVal===4){
    FF[4]=sceneTime;FF[5]=pourTilt;FF[6]=0;FF[7]=lastDt;
    if(pourBounds){
      FF[16]=pourBounds.x0;FF[17]=pourBounds.x1;FF[18]=pourBounds.z0;FF[19]=pourBounds.z1;
      FF[20]=pourBounds.y0;FF[21]=pourBounds.y1;FF[22]=pourBounds.gateTop;FF[23]=pourBounds.gateHalf;
    }
  }
  dev.queue.writeBuffer(flowUni,0,FF);
}
function encodeFlow(enc,modeVal,startIdx=0,emitCount=0){
  const B=buffers();if(!B.pos||!B.vel||!B.pred)return false;
  writeFlowUniform(modeVal,startIdx,emitCount);
  const bg=dev.createBindGroup({layout:flowPipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:flowUni}},{binding:1,resource:{buffer:B.pos}},
    {binding:2,resource:{buffer:B.vel}},{binding:3,resource:{buffer:B.pred}},
    {binding:4,resource:{buffer:phaseState}},
  ]});
  const pass=enc.beginComputePass({label:`fluidV5M840FlowMode${modeVal}`});
  pass.setPipeline(flowPipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(Math.max(1,sim.n)/256));pass.end();
  flowPasses++;return true;
}
function buildPourLayout(){
  const b=sim.params.box,d=sim.params.spacing||.044,margin=d;
  const poolCount=Math.max(64,Math.round(fullN*.72));
  const sourceCount=fullN-poolCount;
  const lowerNx=Math.max(1,Math.floor(Math.max(d,b[0]-2*margin)/d));
  const lowerNz=Math.max(1,Math.floor(Math.max(d,b[2]-2*margin)/d));
  const x0=b[0]*.08,x1=b[0]*.46,z0=b[2]*.12,z1=b[2]*.88;
  const upperNx=Math.max(4,Math.floor((x1-x0)/d));
  const upperNz=Math.max(5,Math.floor((z1-z0)/d));
  const upperLayers=Math.max(1,Math.ceil(sourceCount/(upperNx*upperNz)));
  const height=upperLayers*d;
  const y1=Math.min(b[1]-margin,b[1]*.91);
  const y0=Math.max(margin*2,Math.min(b[1]*.54,y1-height-d*.25));
  const gateTop=Math.min(y1-d,y0+Math.max(d*5,b[1]*.13));
  const gateHalf=(z1-z0)*.27;
  return{poolCount,sourceCount,lowerNx,lowerNz,upperNx,upperNz,upperLayers,x0,x1,z0,z1,y0,y1,gateTop,gateHalf};
}
function encodePourSeed(enc){
  const B=buffers();if(!B.pos||!B.vel||!B.pred)return false;
  const b=sim.params.box,d=sim.params.spacing||.044,L=buildPourLayout();pourBounds=L;
  SF.fill(0);SF[0]=b[0];SF[1]=b[1];SF[2]=b[2];SF[3]=d;
  SU[4]=fullN;SU[5]=L.poolCount;SU[6]=L.sourceCount;SU[7]=0;
  SU[8]=L.lowerNx;SU[9]=L.lowerNz;SU[10]=Math.ceil(L.poolCount/(L.lowerNx*L.lowerNz));SU[11]=0;
  SU[12]=L.upperNx;SU[13]=L.upperNz;SU[14]=L.upperLayers;SU[15]=0;
  SF[16]=L.x0;SF[17]=L.y0;SF[18]=L.z0;SF[19]=d*.04;
  dev.queue.writeBuffer(seedUni,0,SF);
  const bg=dev.createBindGroup({layout:seedPipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:seedUni}},{binding:1,resource:{buffer:B.pos}},
    {binding:2,resource:{buffer:B.vel}},{binding:3,resource:{buffer:B.pred}},
    {binding:4,resource:{buffer:phaseState}},
  ]});
  const pass=enc.beginComputePass({label:'fluidV5M840PourSeed'});pass.setPipeline(seedPipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(fullN/256));pass.end();
  seedPasses++;sim.bindCache=null;return true;
}

function sourceParameters(name){
  const b=sim.params.box,d=sim.params.spacing||.044;
  const particleVolume=Math.max(1.0e-8,d*d*d*.82);
  if(name==='faucet'){
    const radius=d*1.72;const area=Math.PI*radius*radius;const Q=area*faucetSpeed;
    return{Q,rate:Q/particleVolume,reserveFraction:.30,cap:24};
  }
  const width=b[2]*.47,thickness=d*1.45;const area=width*thickness;const Q=area*waterfallSpeed;
  return{Q,rate:Q/particleVolume,reserveFraction:.40,cap:28};
}
function scheduleInlet(dt){
  if(modeName!=='faucet'&&modeName!=='waterfall'){pendingCount=0;return;}
  if(warmup>0){warmup--;pendingCount=0;return;}
  const P=sourceParameters(modeName);currentQ=P.Q;currentRate=P.rate;
  const available=Math.max(0,fullN-(sim.n||0));
  if(available<=0){pendingCount=0;return;}
  fluxCarry+=P.rate*Math.min(.05,Math.max(.003,dt));
  let count=Math.min(available,P.cap,Math.floor(fluxCarry));
  if(count<1){pendingCount=0;return;}
  fluxCarry-=count;
  // Do not save a huge backlog after a tab stall; source pressure remains bounded.
  fluxCarry=Math.min(fluxCarry,P.cap*.75);
  pendingStart=sim.n;
  pendingCount=count;
  setCount(sim.n+count);
  activatedTotal+=count;serial=(serial+1)>>>0;
}

const baseCreate=dev.createCommandEncoder.bind(dev),baseStep=sim.step.bind(sim);
dev.createCommandEncoder=function(desc){
  const enc=baseCreate(desc);
  if(inStep){
    try{
      if(pendingPourSeed){pendingPourSeed=false;encodePourSeed(enc);}
      if(modeName==='faucet'&&pendingCount>0){encodeFlow(enc,1,pendingStart,pendingCount);pendingCount=0;}
      else if(modeName==='waterfall'&&pendingCount>0){encodeFlow(enc,2,pendingStart,pendingCount);pendingCount=0;}
      else if(modeName==='fountain'){encodeFlow(enc,3,0,0);}
      else if(modeName==='pour'){encodeFlow(enc,4,0,0);}
    }catch(err){console.error('[M8.4 flow boundary pass]',err);}
  }
  return enc;
};
sim.step=function(dt){
  lastDt=Math.min(.05,Math.max(.003,Number.isFinite(dt)?dt:lastDt));
  if(modeName==='faucet'||modeName==='waterfall')scheduleInlet(lastDt);
  if(modeName==='pour'||modeName==='fountain')sceneTime+=lastDt;
  inStep=true;try{return baseStep(dt)}finally{inStep=false;}
};

function preparePhysical(name){
  // Stop every M8.3/M7.x continuous controller first. Its pool reset is also the
  // canonical way to restore the common-water scene before installing a boundary.
  baseScenes.choose('pool');
  modeName=name;sceneTime=0;fluxCarry=0;pendingCount=0;serial=(serial+17)>>>0;
  currentRate=0;currentQ=0;activatedTotal=0;pourBounds=null;pendingPourSeed=false;
  if(name==='faucet'||name==='waterfall'){
    const P=sourceParameters(name);const baseN=Math.max(64,Math.round(fullN*(1-P.reserveFraction)));
    reserveBase=baseN;reserveTotal=fullN-baseN;setCount(baseN);warmup=1;
  }else if(name==='fountain'){
    restoreFull();warmup=1;
  }else if(name==='pour'){
    restoreFull();pendingPourSeed=true;warmup=0;
  }
  if(ui.paused)ui.paused=false;syncUI();
}
function choose(name){
  if(['faucet','waterfall','fountain','pour'].includes(name)){preparePhysical(name);return;}
  // Everything else stays on the proven M8.3 scenario path while M8.4 focuses on
  // physical flow boundaries. Drain remains intentionally on M8.3 until capture/
  // compaction is added in the next flow-boundary revision.
  restoreFull();modeName=name;sceneTime=0;warmup=0;pendingPourSeed=false;baseScenes.choose(name);syncUI();
}

// ---------------------------------------------------------------------------
// M8.4 validation dock.
// ---------------------------------------------------------------------------
document.getElementById('m840Style')?.remove();
const style=document.createElement('style');style.id='m840Style';style.textContent=`
#m830SceneDock{display:none!important}#m840Dock{padding:8px 9px 9px;border-bottom:1px solid rgba(78,214,220,.18);background:rgba(4,16,22,.92)}
.m840Head{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:6px}.m840Title{font:900 8px ui-monospace;color:#86f6ff;letter-spacing:.12em}.m840Note{font:7px ui-monospace;color:#799aa7;text-align:right}.m840Scroll{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:1px}.m840Scroll::-webkit-scrollbar{display:none}.m840Btn{flex:0 0 auto;min-height:42px;min-width:82px;padding:7px 9px;border-radius:10px;border:1px solid rgba(78,214,220,.30);background:#071820;color:#dffcff;font:800 8px ui-monospace}.m840Btn.active{border-color:#f1ad43;color:#ffd890;background:rgba(77,54,17,.45)}
`;
document.head.appendChild(style);
const panel=document.getElementById('m742Panel'),tabs=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
if(!panel||!tabs||!host)throw new Error('M8.4 flow dock: settings panel unavailable.');
document.getElementById('m840Dock')?.remove();
const dock=document.createElement('div');dock.id='m840Dock';dock.innerHTML='<div class="m840Head"><div class="m840Title">V8 FLOW BOUNDARIES · M8.4</div><div class="m840Note">Q=A·v · reserve/inlet · closed-loop pump</div></div><div class="m840Scroll"></div>';
panel.insertBefore(dock,tabs);
const scroll=dock.querySelector('.m840Scroll'),buttons={};
for(const [key,label] of [['pool','POOL'],['faucet','FAUCET'],['waterfall','WATERFALL'],['fountain','FOUNTAIN'],['pour','POUR'],['dam','DAM BREAK'],['rain','RAIN'],['wave','WAVE'],['paddle','PADDLE'],['whirlpool','WHIRLPOOL'],['drain','DRAIN*']]){
  const b=document.createElement('button');b.type='button';b.className='m840Btn';b.textContent=label;b.onclick=e=>{e.preventDefault();e.stopPropagation();choose(key)};buttons[key]=b;scroll.appendChild(b);
}
let status=null;
function slider(parent,label,min,max,step,value,onchange,fmt=v=>Number(v).toFixed(2)){
  const row=document.createElement('div');row.className='m742Row';const l=document.createElement('label');l.textContent=label;
  const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;
  const val=document.createElement('div');val.className='m742Val';val.textContent=fmt(value);
  input.oninput=e=>{e.stopPropagation();const x=Number(input.value);onchange(x);val.textContent=fmt(x);syncUI()};row.append(l,input,val);parent.appendChild(row);return input;
}
const sceneTabs=[...tabs.children],sceneIdx=sceneTabs.findIndex(b=>b.dataset.key==='scenes'),scenePage=sceneIdx>=0?host.children[sceneIdx]:null;
if(scenePage){
  scenePage.innerHTML='<div class="m742Intro">M8.4 replaces source animation with physical flow boundaries. Faucet and Waterfall activate inactive reserve particles according to mass flux Q=A·v. Fountain recirculates only water that reaches its intake. Pour uses an elevated reservoir and gate; released particles become ordinary M8.2 water.</div>';
  const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">PHYSICAL FLOW CONTROL</div><div class="m742Note">No arbitrary pool-particle teleporting. No airborne stream alignment. DRAIN* still uses the M8.3 validation implementation until GPU outlet compaction is added.</div>';
  slider(sec,'FAUCET SPEED',.35,1.00,.03,faucetSpeed,v=>faucetSpeed=v,v=>`${v.toFixed(2)} m/s`);
  slider(sec,'WATERFALL SPEED',.30,.90,.03,waterfallSpeed,v=>waterfallSpeed=v,v=>`${v.toFixed(2)} m/s`);
  slider(sec,'FOUNTAIN JET',.75,1.90,.05,fountainSpeed,v=>fountainSpeed=v,v=>`${v.toFixed(2)} m/s`);
  slider(sec,'PUMP SUCTION',.45,1.65,.05,pumpStrength,v=>pumpStrength=v);
  slider(sec,'POUR TILT',1.20,4.20,.10,pourTilt,v=>pourTilt=v,v=>`${v.toFixed(1)} m/s²`);
  status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';sec.appendChild(status);scenePage.appendChild(sec);
}
function syncUI(){
  for(const [k,b] of Object.entries(buttons))b.classList.toggle('active',k===modeName);
  if(!status)return;
  const reserveLeft=Math.max(0,fullN-(sim.n||0));
  const physical=['faucet','waterfall','fountain','pour'].includes(modeName);
  status.textContent=`ACTIVE ${modeName.toUpperCase()} · ${physical?'M8.4 PHYSICAL':'M8.3 VALIDATION'}\nactive water ${(sim.n||0).toLocaleString()} / ${fullN.toLocaleString()} · reserve ${reserveLeft.toLocaleString()}\nQ ${currentQ.toFixed(4)} m³/s · inlet ${currentRate.toFixed(0)} particles/s · activated ${activatedTotal.toLocaleString()}\nflow passes ${flowPasses} · pour seeds ${seedPasses} · added queue submits 0`;
}
setInterval(syncUI,350);syncUI();
const requested=new URLSearchParams(location.search).get('scene');
if(requested&&buttons[requested])setTimeout(()=>choose(requested),320);else setTimeout(()=>choose('pool'),220);

window.__v5M840Flow={
  online:true,backend:'physical-mass-flux-boundaries-m840',gpuSubmitsAdded:0,choose,
  get active(){return modeName},get fullN(){return fullN},get reserve(){return Math.max(0,fullN-(sim.n||0))},
  get flowPasses(){return flowPasses},get seedPasses(){return seedPasses},get currentRate(){return currentRate},get currentQ(){return currentQ}
};
window.__fluidV5Version='8.4.0';window.__fluidV5Build='M8.4 PHYSICAL FLOW BOUNDARIES / MASS FLUX / M8.2 COMMON WATER / ONE-SUBMIT CORE';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.4';document.title='Fluid V8 · M8.4 Physical Flow Boundaries';
console.info('[Fluid V8 M8.4] physical inlet/reservoir/return boundaries online; added submits 0.');
