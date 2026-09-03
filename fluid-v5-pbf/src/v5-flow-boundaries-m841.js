// Fluid V8 M8.4.1 — packed physical flow boundaries.
//
// Fixes the first M8.4 boundary discretization:
//  • Faucet and waterfall activate COMPLETE packed fluid layers, never partial cross-sections.
//  • Layer cadence is based on physical travel distance, not rendered frames.
//  • Fountain intake is deliberately gentle and rate-limited before returning water to the nozzle.
//  • Pour uses a much smaller elevated reservoir and a pressure-fed side gate; no bulk tilt impulse.
//
// Newly released particles become ordinary M8.2 water immediately. No airborne alignment or
// post-release scripting is applied. All passes remain inside the existing command encoder.

const sim=window.__sim, ui=window.__ui;
const baseScenes=window.__v5M830Scenes;
if(!sim?.dev||!ui||!baseScenes?.online||!window.__v5M820FluidCore?.online)
  throw new Error('M8.4.1 flow boundaries: M8.2/M8.3 runtime unavailable.');
const dev=sim.dev;
const fullN=Math.max(1,sim.scene?.nFluid||sim.n||1);
const quality=new URLSearchParams(location.search).get('quality')||'low';

let active='pool',inStep=false,lastDt=1/60,sceneTime=0,warmup=0;
let distanceCarry=0,pendingStart=0,pendingCount=0,serial=1;
let reserveBase=fullN,reserveTotal=0,activated=0,flowPasses=0,seedPasses=0;
let faucetSpeed=.58,waterfallSpeed=.45,fountainSpeed=.86,pumpStrength=.24;
let pourBounds=null,pendingPourSeed=false;

function setCount(n){
  const next=Math.max(1,Math.min(fullN,Math.floor(n)));
  sim.n=next;
  if(sim.scene){sim.scene.n=next;sim.scene.nFluid=next;}
  sim.uploadParams?.(1/240);
  sim.bindCache=null;
}
function restoreFull(){setCount(fullN);reserveBase=fullN;reserveTotal=0;activated=0;distanceCarry=0;pendingCount=0;}
function buffers(){
  const pos=sim.livePos?.(),vel=sim.liveVel?.();
  const pred=sim.buf?.[sim.parity===0?'predA':'predB'];
  return{pos,vel,pred};
}

// ---------------------------------------------------------------------------
// Flow boundary pass.
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
  let n=U.rangeData.x;
  if(i>=n){return;}
  let modeVal=U.rangeData.y;
  let startIdx=U.rangeData.z;
  let emitCount=U.rangeData.w;
  let bx=U.boxData.x;let by=U.boxData.y;let bz=U.boxData.z;
  let d=max(U.boxData.w,.001);

  // Faucet: each activation is one complete 4x4 packed cross-section.
  if(modeVal==1u){
    if(i<startIdx||i>=startIdx+emitCount){return;}
    let localIdx=i-startIdx;
    let gx=localIdx%4u;
    let gy=(localIdx/4u)%4u;
    let speed=U.flowData.x;
    let flowDir=normalize(vec3f(.86,-.24,0.0));
    let sideDir=vec3f(0.0,0.0,1.0);
    let upDir=normalize(vec3f(-flowDir.y,flowDir.x,0.0));
    let nozzle=vec3f(bx*.115,by*.805,bz*.50);
    let stepR=d*.58;
    let ox=(f32(gx)-1.5)*stepR;
    let oy=(f32(gy)-1.5)*stepR;
    let jitter=(hash11(i*17u+U.shapeData.w*31u+7u)-.5)*d*.014;
    let p3=nozzle-flowDir*d*.22+upDir*ox+sideDir*(oy+jitter);
    let p4=vec4f(p3,1.0);
    pos[i]=p4;pred[i]=p4;vel[i]=vec4f(flowDir*speed,0.0);phaseState[i]=0u;
    return;
  }

  // Waterfall: each activation is one complete packed sheet layer.
  if(modeVal==2u){
    if(i<startIdx||i>=startIdx+emitCount){return;}
    let localIdx=i-startIdx;
    let lanes=max(U.shapeData.x,8u);
    let thick=max(U.shapeData.y,2u);
    let lane=localIdx%lanes;
    let layer=(localIdx/lanes)%thick;
    let speed=U.flowData.x;
    let flowDir=normalize(vec3f(.18,-.985,0.0));
    let normalDir=normalize(vec3f(-flowDir.y,flowDir.x,0.0));
    let widthStep=d*.72;
    let thicknessStep=d*.50;
    let zOffset=(f32(lane)-.5*f32(lanes-1u))*widthStep;
    let nOffset=(f32(layer)-.5*f32(thick-1u))*thicknessStep;
    let lip=vec3f(bx*.105,by*.825,bz*.50);
    let jitter=(hash11(i*19u+U.shapeData.w*37u+11u)-.5)*d*.010;
    let p3=lip-flowDir*d*.20+vec3f(0.0,0.0,zOffset+jitter)+normalDir*nOffset;
    let p4=vec4f(p3,1.0);
    pos[i]=p4;pred[i]=p4;vel[i]=vec4f(flowDir*speed,0.0);phaseState[i]=0u;
    return;
  }

  // Fountain: gentle intake + throttled hidden return. Only particles physically
  // inside the floor throat can be returned to the nozzle.
  if(modeVal==3u){
    var p3=pos[i].xyz;
    var v3=vel[i].xyz;
    let dt=clamp(U.flowData.w,.003,.05);
    let jetSpeed=U.flowData.x;
    let suction=U.flowData.y;
    let frameId=U.shapeData.w;
    let centre=vec2f(bx*.50,bz*.50);
    let q=vec2f(p3.x,p3.z)-centre;
    let r=length(q);
    var dir2=vec2f(0.0);
    if(r>1.0e-5){dir2=q/r;}
    let intakeR=max(d*3.2,min(bx,bz)*.10);
    let throatR=max(d*1.75,min(bx,bz)*.030);
    let floorBand=1.0-smoothstep(d*1.8,max(d*6.0,by*.11),p3.y);
    let radialBand=1.0-smoothstep(throatR,intakeR,r);
    let pull=radialBand*floorBand*suction;
    v3=v3+vec3f(-dir2.x*.46*pull,-.20*pull,-dir2.y*.46*pull)*dt;

    if(r<throatR && p3.y<d*2.0){
      // About one quarter of eligible intake particles are pumped per frame.
      // This prevents the entire intake volume from being teleported at once.
      let selector=(i+frameId*13u)%4u;
      if(selector==0u){
        let slot=(i+frameId*7u)%9u;
        let sx=i32(slot%3u)-1;
        let sz=i32((slot/3u)%3u)-1;
        let nozzle=vec3f(bx*.50,d*4.0,bz*.50);
        let pOut=nozzle+vec3f(f32(sx)*d*.44,0.0,f32(sz)*d*.44);
        p3=pOut;
        v3=vec3f(f32(sx)*.025*jetSpeed,jetSpeed,f32(sz)*.025*jetSpeed);
      }
    }
    let p4=vec4f(p3,1.0);
    pos[i]=p4;pred[i]=p4;vel[i]=vec4f(v3,0.0);
    return;
  }

  // Pour: pressure-fed elevated reservoir with a real side opening. State 1 means
  // the particle is still in the virtual container. Once it crosses the gate it
  // becomes ordinary water and this pass never touches it again.
  if(modeVal==4u){
    if(phaseState[i]!=1u){return;}
    let dt=clamp(U.flowData.w,.003,.05);
    let elapsed=U.flowData.x;
    let x0=U.regionA.x;let x1=U.regionA.y;
    let z0=U.regionA.z;let z1=U.regionA.w;
    let y0=U.regionB.x;let y1=U.regionB.y;
    let gateTop=U.regionB.z;let gateHalf=U.regionB.w;
    let zc=(z0+z1)*.5;
    var p3=pos[i].xyz;
    var v3=vel[i].xyz;
    let gateOpen=elapsed>.55 && p3.y<gateTop && abs(p3.z-zc)<gateHalf;

    // A very small near-gate pressure bias helps resolve the outlet at mobile
    // particle spacing; there is no bulk reservoir acceleration.
    if(gateOpen){
      let nearGate=smoothstep(x1-d*5.0,x1,p3.x);
      v3.x=v3.x+.11*nearGate*dt;
      if(p3.x>x1-d*.08){
        phaseState[i]=0u;
        v3.x=max(v3.x,.06);
        let released=vec4f(p3,1.0);
        pos[i]=released;pred[i]=released;vel[i]=vec4f(v3,0.0);
        return;
      }
    }

    if(p3.x<x0){p3.x=x0+d*.20;v3.x=max(v3.x,0.0)*.08;}
    if(!gateOpen && p3.x>x1){p3.x=x1-d*.20;v3.x=min(v3.x,0.0)*.08;}
    if(p3.z<z0){p3.z=z0+d*.20;v3.z=max(v3.z,0.0)*.08;}
    if(p3.z>z1){p3.z=z1-d*.20;v3.z=min(v3.z,0.0)*.08;}
    if(p3.y<y0){p3.y=y0+d*.20;v3.y=max(v3.y,0.0)*.06;}
    if(p3.y>y1){p3.y=y1-d*.20;v3.y=min(v3.y,0.0)*.06;}
    let p4=vec4f(p3,1.0);
    pos[i]=p4;pred[i]=p4;vel[i]=vec4f(v3,0.0);
  }
}`;

const flowMod=dev.createShaderModule({code:flowWGSL,label:'fluidV5M841FlowBoundariesWGSL'});
if(typeof flowMod.getCompilationInfo==='function'){
  const info=await flowMod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.4.1 flow WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const flowPipe=await dev.createComputePipelineAsync({label:'fluidV5M841FlowBoundaries',layout:'auto',compute:{module:flowMod,entryPoint:'main'}});
const flowUni=dev.createBuffer({label:'fluidV5M841FlowUniform',size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const FF=new Float32Array(24), FU=new Uint32Array(FF.buffer);
const phaseState=dev.createBuffer({label:'fluidV5M841PhaseState',size:Math.max(16,fullN*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});

// ---------------------------------------------------------------------------
// Pour initial condition: 88% lower pool, 12% elevated reservoir.
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
  var p3=vec3f(0.0);var stateVal=0u;
  if(i<poolCount){
    let nx=max(U.lowerDims.x,1u);let nz=max(U.lowerDims.y,1u);let layer=nx*nz;
    let ix=i%nx;let iz=(i/nx)%nz;let iy=i/layer;
    let jx=(hash11(i*3u+1u)-.5)*d*.035;
    let jy=(hash11(i*3u+2u)-.5)*d*.025;
    let jz=(hash11(i*3u+3u)-.5)*d*.035;
    p3=vec3f(margin+(f32(ix)+.5)*d+jx,margin+(f32(iy)+.5)*d+jy,margin+(f32(iz)+.5)*d+jz);
  }else{
    let j=i-poolCount;let nx=max(U.upperDims.x,1u);let nz=max(U.upperDims.y,1u);let layer=nx*nz;
    let ix=j%nx;let iz=(j/nx)%nz;let iy=j/layer;
    p3=vec3f(U.upperPlace.x+(f32(ix)+.5)*d,
             U.upperPlace.y+(f32(iy)+.5)*d,
             U.upperPlace.z+(f32(iz)+.5)*d);
    stateVal=1u;
  }
  p3=clamp(p3,vec3f(margin),U.boxData.xyz-vec3f(margin));
  let p4=vec4f(p3,1.0);pos[i]=p4;pred[i]=p4;vel[i]=vec4f(0.0);phaseState[i]=stateVal;
}`;
const seedMod=dev.createShaderModule({code:seedWGSL,label:'fluidV5M841PourSeedWGSL'});
if(typeof seedMod.getCompilationInfo==='function'){
  const info=await seedMod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.4.1 pour seed WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const seedPipe=await dev.createComputePipelineAsync({label:'fluidV5M841PourSeed',layout:'auto',compute:{module:seedMod,entryPoint:'main'}});
const seedUni=dev.createBuffer({label:'fluidV5M841PourSeedUniform',size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const SF=new Float32Array(20), SU=new Uint32Array(SF.buffer);

function sourceConfig(name){
  const d=sim.params.spacing||.044;
  if(name==='faucet')return{speed:faucetSpeed,layerCount:16,axialSpacing:d*.62,reserveFraction:.34,lanes:4,thick:4};
  const lanes=quality==='high'?16:quality==='medium'?14:12;
  const thick=3;
  return{speed:waterfallSpeed,layerCount:lanes*thick,axialSpacing:d*.52,reserveFraction:.42,lanes,thick};
}
function schedulePackedLayer(dt){
  if(active!=='faucet'&&active!=='waterfall'){pendingCount=0;return;}
  if(warmup>0){warmup--;pendingCount=0;return;}
  const cfg=sourceConfig(active),available=Math.max(0,fullN-(sim.n||0));
  if(available<cfg.layerCount){pendingCount=0;return;}
  distanceCarry+=cfg.speed*Math.min(.05,Math.max(.003,dt));
  if(distanceCarry<cfg.axialSpacing){pendingCount=0;return;}
  distanceCarry-=cfg.axialSpacing;
  distanceCarry=Math.min(distanceCarry,cfg.axialSpacing*.95);
  pendingStart=sim.n;pendingCount=cfg.layerCount;
  setCount(sim.n+pendingCount);activated+=pendingCount;serial=(serial+1)>>>0;
}
function writeFlow(modeVal,startIdx=0,emitCount=0){
  const b=sim.params.box,d=sim.params.spacing||.044,n=Math.max(1,sim.n||1);
  FF.fill(0);FF[0]=b[0];FF[1]=b[1];FF[2]=b[2];FF[3]=d;
  FU[8]=n;FU[9]=modeVal;FU[10]=startIdx;FU[11]=emitCount;
  FU[12]=0;FU[13]=0;FU[14]=fullN;FU[15]=serial;
  if(modeVal===1){FF[4]=faucetSpeed;FF[7]=lastDt;FU[12]=4;FU[13]=4;}
  else if(modeVal===2){const c=sourceConfig('waterfall');FF[4]=waterfallSpeed;FF[7]=lastDt;FU[12]=c.lanes;FU[13]=c.thick;}
  else if(modeVal===3){FF[4]=fountainSpeed;FF[5]=pumpStrength;FF[7]=lastDt;}
  else if(modeVal===4){
    FF[4]=sceneTime;FF[7]=lastDt;
    if(pourBounds){
      FF[16]=pourBounds.x0;FF[17]=pourBounds.x1;FF[18]=pourBounds.z0;FF[19]=pourBounds.z1;
      FF[20]=pourBounds.y0;FF[21]=pourBounds.y1;FF[22]=pourBounds.gateTop;FF[23]=pourBounds.gateHalf;
    }
  }
  dev.queue.writeBuffer(flowUni,0,FF);
}
function encodeFlow(enc,modeVal,startIdx=0,emitCount=0){
  const B=buffers();if(!B.pos||!B.vel||!B.pred)return false;
  writeFlow(modeVal,startIdx,emitCount);
  const bg=dev.createBindGroup({layout:flowPipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:flowUni}},{binding:1,resource:{buffer:B.pos}},
    {binding:2,resource:{buffer:B.vel}},{binding:3,resource:{buffer:B.pred}},
    {binding:4,resource:{buffer:phaseState}},
  ]});
  const p=enc.beginComputePass({label:`fluidV5M841Flow${modeVal}`});p.setPipeline(flowPipe);p.setBindGroup(0,bg);p.dispatchWorkgroups(Math.ceil(Math.max(1,sim.n)/256));p.end();flowPasses++;return true;
}
function buildPourLayout(){
  const b=sim.params.box,d=sim.params.spacing||.044,margin=d;
  const poolCount=Math.max(64,Math.round(fullN*.88)),sourceCount=fullN-poolCount;
  const lowerNx=Math.max(1,Math.floor(Math.max(d,b[0]-2*margin)/d));
  const lowerNz=Math.max(1,Math.floor(Math.max(d,b[2]-2*margin)/d));
  const x0=b[0]*.08,x1=b[0]*.34,z0=b[2]*.27,z1=b[2]*.73;
  const upperNx=Math.max(4,Math.floor((x1-x0)/d));
  const upperNz=Math.max(4,Math.floor((z1-z0)/d));
  const upperLayers=Math.max(1,Math.ceil(sourceCount/(upperNx*upperNz)));
  const height=upperLayers*d;
  const y1=Math.min(b[1]-margin,b[1]*.87);
  const y0=Math.max(b[1]*.49,y1-height-d*.35);
  const gateTop=Math.min(y1-d,y0+Math.max(d*5.5,b[1]*.11));
  const gateHalf=(z1-z0)*.20;
  return{poolCount,sourceCount,lowerNx,lowerNz,upperNx,upperNz,upperLayers,x0,x1,z0,z1,y0,y1,gateTop,gateHalf};
}
function encodePourSeed(enc){
  const B=buffers();if(!B.pos||!B.vel||!B.pred)return false;
  const b=sim.params.box,d=sim.params.spacing||.044,L=buildPourLayout();pourBounds=L;
  SF.fill(0);SF[0]=b[0];SF[1]=b[1];SF[2]=b[2];SF[3]=d;
  SU[4]=fullN;SU[5]=L.poolCount;SU[6]=L.sourceCount;SU[7]=0;
  SU[8]=L.lowerNx;SU[9]=L.lowerNz;SU[10]=Math.ceil(L.poolCount/(L.lowerNx*L.lowerNz));SU[11]=0;
  SU[12]=L.upperNx;SU[13]=L.upperNz;SU[14]=L.upperLayers;SU[15]=0;
  SF[16]=L.x0;SF[17]=L.y0;SF[18]=L.z0;SF[19]=0;
  dev.queue.writeBuffer(seedUni,0,SF);
  const bg=dev.createBindGroup({layout:seedPipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:seedUni}},{binding:1,resource:{buffer:B.pos}},
    {binding:2,resource:{buffer:B.vel}},{binding:3,resource:{buffer:B.pred}},
    {binding:4,resource:{buffer:phaseState}},
  ]});
  const p=enc.beginComputePass({label:'fluidV5M841PourSeed'});p.setPipeline(seedPipe);p.setBindGroup(0,bg);p.dispatchWorkgroups(Math.ceil(fullN/256));p.end();seedPasses++;sim.bindCache=null;return true;
}

const baseCreate=dev.createCommandEncoder.bind(dev),baseStep=sim.step.bind(sim);
dev.createCommandEncoder=function(desc){
  const enc=baseCreate(desc);
  if(inStep){
    try{
      if(pendingPourSeed){pendingPourSeed=false;encodePourSeed(enc);}
      if(active==='faucet'&&pendingCount){encodeFlow(enc,1,pendingStart,pendingCount);pendingCount=0;}
      else if(active==='waterfall'&&pendingCount){encodeFlow(enc,2,pendingStart,pendingCount);pendingCount=0;}
      else if(active==='fountain'){encodeFlow(enc,3);}
      else if(active==='pour'){encodeFlow(enc,4);}
    }catch(err){console.error('[M8.4.1 boundary pass]',err);}
  }
  return enc;
};
sim.step=function(dt){
  lastDt=Math.min(.05,Math.max(.003,Number.isFinite(dt)?dt:lastDt));
  if(active==='faucet'||active==='waterfall')schedulePackedLayer(lastDt);
  if(active==='fountain'||active==='pour'){sceneTime+=lastDt;serial=(serial+1)>>>0;}
  inStep=true;try{return baseStep(dt)}finally{inStep=false;}
};

function prepare(name){
  baseScenes.choose('pool');active=name;sceneTime=0;distanceCarry=0;pendingCount=0;serial=(serial+17)>>>0;activated=0;pourBounds=null;pendingPourSeed=false;
  if(name==='faucet'||name==='waterfall'){
    const c=sourceConfig(name),baseN=Math.max(64,Math.round(fullN*(1-c.reserveFraction)));
    reserveBase=baseN;reserveTotal=fullN-baseN;setCount(baseN);warmup=2;
  }else if(name==='fountain'){restoreFull();warmup=2;}
  else if(name==='pour'){restoreFull();pendingPourSeed=true;warmup=0;}
  if(ui.paused)ui.paused=false;sync();
}
function choose(name){
  if(['faucet','waterfall','fountain','pour'].includes(name)){prepare(name);return;}
  restoreFull();active=name;sceneTime=0;pendingPourSeed=false;baseScenes.choose(name);sync();
}

// Validation dock.
document.getElementById('m841Style')?.remove();
const style=document.createElement('style');style.id='m841Style';style.textContent=`#m830SceneDock{display:none!important}#m841Dock{padding:8px 9px 9px;border-bottom:1px solid rgba(78,214,220,.18);background:rgba(4,16,22,.92)}.m841Head{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:6px}.m841Title{font:900 8px ui-monospace;color:#86f6ff;letter-spacing:.12em}.m841Note{font:7px ui-monospace;color:#799aa7;text-align:right}.m841Scroll{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}.m841Scroll::-webkit-scrollbar{display:none}.m841Btn{flex:0 0 auto;min-height:42px;min-width:82px;padding:7px 9px;border-radius:10px;border:1px solid rgba(78,214,220,.30);background:#071820;color:#dffcff;font:800 8px ui-monospace}.m841Btn.active{border-color:#f1ad43;color:#ffd890;background:rgba(77,54,17,.45)}`;
document.head.appendChild(style);
const panel=document.getElementById('m742Panel'),tabs=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
if(!panel||!tabs||!host)throw new Error('M8.4.1 dock unavailable.');
const dock=document.createElement('div');dock.id='m841Dock';dock.innerHTML='<div class="m841Head"><div class="m841Title">V8 FLOW · M8.4.1</div><div class="m841Note">packed layers · throttled pump · pressure gate</div></div><div class="m841Scroll"></div>';panel.insertBefore(dock,tabs);
const scroll=dock.querySelector('.m841Scroll'),buttons={};
for(const [key,label] of [['pool','POOL'],['faucet','FAUCET'],['waterfall','WATERFALL'],['fountain','FOUNTAIN'],['pour','POUR'],['dam','DAM'],['rain','RAIN'],['wave','WAVE'],['paddle','PADDLE'],['whirlpool','WHIRLPOOL'],['drain','DRAIN*']]){
  const b=document.createElement('button');b.type='button';b.className='m841Btn';b.textContent=label;b.onclick=e=>{e.preventDefault();e.stopPropagation();choose(key)};buttons[key]=b;scroll.appendChild(b);
}
let status=null;
const sceneTabs=[...tabs.children],idx=sceneTabs.findIndex(b=>b.dataset.key==='scenes'),page=idx>=0?host.children[idx]:null;
if(page){page.innerHTML='<div class="m742Intro">M8.4.1 emits complete packed cross-sections only. Faucet uses 16 particles/layer; waterfall uses a 3-particle-thick sheet. Fountain intake is throttled. Pour is a small pressure-fed reservoir with a side gate.</div>';status=document.createElement('div');status.className='m742Status';page.appendChild(status);}
function sync(){
  for(const [k,b] of Object.entries(buttons))b.classList.toggle('active',k===active);
  if(status)status.textContent=`ACTIVE ${active.toUpperCase()}\nactive particles ${(sim.n||0).toLocaleString()} / ${fullN.toLocaleString()} · reserve ${Math.max(0,fullN-(sim.n||0)).toLocaleString()}\nactivated ${activated.toLocaleString()} · flow passes ${flowPasses.toLocaleString()} · pour seeds ${seedPasses}\nfaucet ${faucetSpeed.toFixed(2)} m/s · waterfall ${waterfallSpeed.toFixed(2)} m/s · fountain ${fountainSpeed.toFixed(2)} m/s\nadded queue submits 0`;
}
setInterval(sync,400);sync();
window.__v5M841Flow={online:true,backend:'packed-layer-flow-boundaries-m841',gpuSubmitsAdded:0,choose,get active(){return active},get flowPasses(){return flowPasses},get activated(){return activated}};
window.__fluidV5Version='8.4.1';window.__fluidV5Build='M8.4.1 PACKED PHYSICAL FLOW BOUNDARIES / M8.2 COMMON WATER / ONE-SUBMIT';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.4.1';document.title='Fluid V8 · M8.4.1 Packed Flow Boundaries';
console.info('[Fluid V8 M8.4.1] packed inlet layers, throttled fountain and pressure-fed pour online.');