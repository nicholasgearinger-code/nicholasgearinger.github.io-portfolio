// Fluid V8 M8.3.6 — gravity-release Faucet and continuous Waterfall curtain.
//
// Both sources reuse ordinary pool particles, place them in rest-spaced inlet
// layers. Faucet begins at rest. Waterfall receives only its velocity at the lip;
// below that lip, vertical motion comes from the same world-gravity + PBF solve
// used by the successful GLB pour. Four stagger phases plus a light, spatially
// local sheet-drag model prevent low-frame-rate emission rows from separating.

const sim=window.__sim,ui=window.__ui;
const scenes=window.__v5M743Scenes;
const legacy=window.__v5M752PhysicalScenes;
if(!sim?.dev||!ui||!scenes?.online||!legacy?.online)
  throw new Error('M8.3.3 gravity release: required solver/scenes unavailable.');

const dev=sim.dev;
const MAX_SOURCE=256;
let active='none',inStep=false,lastDt=1/60,prime=true,carry=0,serial=1;
let sourceN=0,passes=0,recycled=0,emissions=0;

const sourcePos=dev.createBuffer({label:'fluidV8M833SourcePositions',size:MAX_SOURCE*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
const sourceVel=dev.createBuffer({label:'fluidV8M833SourceVelocities',size:MAX_SOURCE*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
const counter=dev.createBuffer({label:'fluidV8M833SourceCounter',size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
const uniform=dev.createBuffer({label:'fluidV8M833SourceUniform',size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(20),U=new Uint32Array(F.buffer),counterZero=new Uint32Array(4);

const sourceWGSL=`
struct SourceU {
  counts:vec4u,
  boxSpacing:vec4f,
  outlet:vec4f,
  shape:vec4f,
  tune:vec4f,
}
struct Counter { claim:atomic<u32>, emitted:atomic<u32>, pad0:u32, pad1:u32 }
@group(0) @binding(0) var<uniform> S:SourceU;
@group(0) @binding(1) var<storage,read> sourcePos:array<vec4f>;
@group(0) @binding(2) var<storage,read> sourceVel:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> pos:array<vec4f>;
@group(0) @binding(4) var<storage,read_write> vel:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> pred:array<vec4f>;
@group(0) @binding(6) var<storage,read_write> C:Counter;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;let n=S.counts.x;if(i>=n||n==0u){return;}
  let j=(i+S.counts.z)%n;let mode=S.counts.w;
  let d=S.boxSpacing.w;let centre=vec2f(S.outlet.x,S.outlet.z);
  let outletY=S.outlet.y;let guideTop=S.shape.y;let surface=S.shape.z;
  var p=pos[j];var v=vel[j];let q=p.xz-centre;

  // A numerical spout wall: it only removes sideways drift above the outlet.
  // It never sets vertical velocity, and has no influence after release.
  if(mode==1u && p.y>outletY && p.y<guideTop+d){
    let r=length(q);let radius=S.shape.x;
    if(r<radius*1.55){
      let radial=select(vec2f(0.0),q/max(r,1.0e-6),r>1.0e-6);
      let edge=smoothstep(radius*.58,radius*1.42,r);
      v.x=mix(v.x,-radial.x*S.tune.x,.16+.20*edge);
      v.z=mix(v.z,-radial.y*S.tune.x,.16+.20*edge);
    }
  }
  if(mode==2u && p.y>outletY && p.y<guideTop+d){
    let halfWidth=S.shape.x;
    if(abs(p.z-centre.y)<halfWidth+d && abs(p.x-centre.x)<d*2.2){
      v.x=mix(v.x,0.0,.32);
      let edge=smoothstep(halfWidth*.78,halfWidth+d,abs(p.z-centre.y));
      v.z=mix(v.z,-sign(p.z-centre.y)*S.tune.x,.10+.24*edge);
    }
  }
  // A broad real waterfall entrains air and reaches a terminal sheet speed. Without
  // that drag, rows released at 20 FPS accelerate away from the next rows and the
  // particle surface reconstructs separate floating slabs. This only acts in the
  // falling curtain, never in the pool, and still lets gravity accelerate the water.
  if(mode==2u && p.y>surface+d*.70 && p.y<=outletY){
    let inside=abs(p.z-centre.y)<S.shape.x+d && abs(p.x-centre.x)<d*2.8;
    if(inside){
      let fall=clamp((outletY-p.y)/max(outletY-surface,d),0.0,1.0);
      let terminal=mix(max(S.outlet.w,.1),S.tune.z,smoothstep(.05,.92,fall));
      if(v.y < -terminal){v.y=mix(v.y,-terminal,.70);}
      v.x=mix(v.x,(centre.x-p.x)*1.8,.16);
      v.z=mix(v.z,0.0,.08);
    }
  }
  vel[j]=vec4f(v.xyz,0.0);

  if(S.counts.y==0u){return;}
  // Recycle calm water from below the free surface. Dynamic atomic claiming avoids
  // stealing particles already in either falling stream and keeps total mass fixed.
  let inThroat=p.y>outletY-d && p.y<guideTop+d*1.5;
  let calmDonor=p.y<surface-d*1.25 && length(v.xyz)<S.tune.y && !inThroat;
  if(!calmDonor){return;}
  let slot=atomicAdd(&C.claim,1u);if(slot>=S.counts.y){return;}
  let np=sourcePos[slot];pos[j]=np;pred[j]=np;vel[j]=sourceVel[slot];
  atomicAdd(&C.emitted,1u);
}`;

const module=dev.createShaderModule({code:sourceWGSL,label:'fluidV8M833GravityReleaseWGSL'});
if(typeof module.getCompilationInfo==='function'){
  const info=await module.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.3.3 gravity release WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV8M833GravityRelease',layout:'auto',compute:{module,entryPoint:'main'}});

function poolSurface(){
  const b=sim.params.box,d=sim.params.spacing||.044,n=Math.max(1,sim.n||1);
  const nx=Math.max(1,Math.floor((b[0]-2*d)/d)),nz=Math.max(1,Math.floor((b[2]-2*d)/d));
  return Math.min(b[1]-2*d,d+Math.ceil(n/(nx*nz))*d);
}
function geometry(name){
  const b=sim.params.box,d=sim.params.spacing||.044,axial=d*1.04;
  if(name==='faucet'){
    const outletY=b[1]*.76,topY=outletY+axial*4.5;
    return {d,axial,cx:b[0]*.50,cz:b[2]*.50,outletY,topY,radius:d*1.72,mode:1,speed:0};
  }
  const outletY=b[1]*.74,topY=outletY+axial*7.5;
  // 1.55 m/s emits 1–2 rest-spaced layers per 20 FPS frame. That preserves
  // particle density as the free sheet accelerates instead of releasing one slab/frame.
  return {d,axial,cx:b[0]*.27,cz:b[2]*.50,outletY,topY,radius:b[2]*.245,mode:2,speed:1.55,terminal:1.82};
}
function appendPlane(P,V,start,g,y,downSpeed=g.speed||0){
  let n=start;
  if(g.mode===1){
    for(let ix=-1;ix<=1;ix++)for(let iz=-1;iz<=1;iz++){
      if(n>=MAX_SOURCE)return n;
      const k=n*4;P[k]=g.cx+ix*g.axial;P[k+1]=y;P[k+2]=g.cz+iz*g.axial;P[k+3]=1;
      V[k]=0;V[k+1]=0;V[k+2]=0;V[k+3]=0;n++;
    }
  }else{
    const lanes=Math.max(8,Math.floor((g.radius*2)/g.axial));
    for(let row=-1;row<=1;row+=2)for(let lane=0;lane<lanes;lane++){
      if(n>=MAX_SOURCE)return n;
      const z=g.cz-g.radius+(lane+.5)*(g.radius*2/lanes),k=n*4;
      // Adjacent lanes/depth rows occupy four streamwise phases. Every column
      // remains rest-spaced, but their projection fills the gaps between rows.
      const phase=(lane&1)+(row>0?2:0);
      P[k]=g.cx+row*g.axial*.52;P[k+1]=y+phase*g.axial*.25;P[k+2]=z;P[k+3]=1;
      V[k]=0;V[k+1]=-downSpeed;V[k+2]=0;V[k+3]=0;n++;
    }
  }
  return n;
}
function prepareSource(dt){
  sourceN=0;if(active==='none'||ui.paused)return;
  const g=geometry(active),P=new Float32Array(MAX_SOURCE*4),V=new Float32Array(MAX_SOURCE*4);
  if(prime){
    // Prefill a connected throat/curtain without overlapping any particle columns.
    const layers=g.mode===2?7:4;
    for(let layer=0;layer<layers;layer++)sourceN=appendPlane(P,V,sourceN,g,g.outletY+(layer+.55)*g.axial);
    prime=false;carry=0;
  }else if(g.mode===2){
    // Reconstruct the water released during the previous rendered frame as
    // ballistic micro-layers. At 20 FPS this is normally three layers, at 30 FPS
    // two, and at 60 FPS one. Their positions and velocities correspond to evenly
    // spaced sub-frame ages, so there is no frame-sized empty band in the sheet.
    const stepDt=Math.min(.05,Math.max(.001,Number.isFinite(dt)?dt:1/60));
    const gravity=Math.max(.1,Number(sim.params.gravity)||9.81);
    const travel=g.speed*stepDt+.5*gravity*stepDt*stepDt;
    const rows=Math.max(1,Math.min(4,Math.ceil(travel/(g.axial*.86))));
    for(let row=0;row<rows;row++){
      const age=stepDt*row/rows;
      const distance=g.speed*age+.5*gravity*age*age;
      const downSpeed=Math.min(g.terminal,g.speed+gravity*age);
      sourceN=appendPlane(P,V,sourceN,g,g.topY-distance,downSpeed);
    }
    emissions+=rows;carry=0;
  }else{
    const gravity=Math.max(.1,Number(sim.params.gravity)||9.81);
    const interval=Math.sqrt(2*g.axial/gravity);
    carry+=Math.min(.05,Math.max(.001,Number.isFinite(dt)?dt:1/60));
    if(carry>=interval){carry-=interval;sourceN=appendPlane(P,V,0,g,g.topY);emissions++;}
    carry=Math.min(carry,interval*.98);
  }
  if(sourceN>0){dev.queue.writeBuffer(sourcePos,0,P);dev.queue.writeBuffer(sourceVel,0,V);recycled+=sourceN;}
}
function encodeSource(enc){
  if(active==='none')return false;
  const n=Math.max(1,sim.n||1),b=sim.params.box,g=geometry(active),surface=poolSurface();
  F.fill(0);U[0]=n;U[1]=sourceN;U[2]=(Math.imul(serial++,2654435761)>>>0)%n;U[3]=g.mode;
  F[4]=b[0];F[5]=b[1];F[6]=b[2];F[7]=g.d;
  F[8]=g.cx;F[9]=g.outletY;F[10]=g.cz;F[11]=g.speed||0;
  F[12]=g.radius;F[13]=g.topY;F[14]=surface;F[15]=g.axial*2;
  F[16]=.10;F[17]=2.8;F[18]=g.terminal||0;F[19]=lastDt;
  dev.queue.writeBuffer(uniform,0,F);dev.queue.writeBuffer(counter,0,counterZero);
  const s=sim.parity===0?'A':'B';
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uniform}},{binding:1,resource:{buffer:sourcePos}},{binding:2,resource:{buffer:sourceVel}},
    {binding:3,resource:{buffer:sim.buf['pos'+s]}},{binding:4,resource:{buffer:sim.buf['vel'+s]}},
    {binding:5,resource:{buffer:sim.buf['pred'+s]}},{binding:6,resource:{buffer:counter}},
  ]});
  const pass=enc.beginComputePass({label:active==='faucet'?'fluidV8M833FaucetRelease':'fluidV8M833WaterfallRelease'});
  pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(n/256));pass.end();
  sourceN=0;passes++;sim.bindCache=null;return true;
}

const baseCreate=dev.createCommandEncoder.bind(dev),baseStep=sim.step.bind(sim);
dev.createCommandEncoder=function(desc){const enc=baseCreate(desc);if(inStep&&active!=='none')encodeSource(enc);return enc;};
sim.step=function(dt){lastDt=Number.isFinite(dt)?dt:lastDt;prepareSource(lastDt);inStep=true;try{return baseStep(dt)}finally{inStep=false;}};

function choose(name){
  if(name!=='faucet'&&name!=='waterfall')return false;
  try{legacy.disable?.()}catch{}
  scenes.choose('pool');active=name;prime=true;carry=0;sourceN=0;serial++;
  if(ui.paused)ui.paused=false;return true;
}
function disable(){active='none';prime=true;carry=0;sourceN=0;}

window.__v5M755GravitySources={
  online:true,backend:'ballistic-microlayer-sheet-m836',choose,disable,
  get active(){return active},get passes(){return passes},get recycled(){return recycled},get emissions(){return emissions},
  get model(){return 'frame-distance ballistic micro-layers + ordinary PBF + local sheet drag'},
};
console.info('[Fluid V8 M8.3.6] Waterfall uses frame-distance ballistic micro-layers + local terminal sheet drag; Faucet remains zero-launch.');
