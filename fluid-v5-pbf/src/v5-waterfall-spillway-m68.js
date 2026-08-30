// Fluid V5 M6.8 high-head elevated-reservoir spillway.
// Ordinary PBF water fills a deep elevated basin, rises above a broad physical crest, accelerates
// over a short spillway ramp, separates from the unsupported lip, free-falls under gravity and
// impacts the lower pool. A hidden pump only returns deep lower-pool water to the rear basin.
// There is no prescribed waterfall trajectory, curtain mesh, ballistic guide or waterfall tag.

const sim=window.__sim,ui=window.__ui,state=window.__v5State,ssfr=window.__ssfr;
if(!sim?.dev||!ui||!state||!ssfr)throw new Error('Fluid V5 M6.8 spillway: runtime unavailable.');
const dev=sim.dev;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const quality=new URLSearchParams(location.search).get('quality')||'medium';
const ACTIVE='waterfall-m68';
const active=()=>state.scenario===ACTIVE;
const save=()=>{try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state));}catch{}};

// One-time migration so existing M6.8 localStorage does not keep the earlier small/weak settings.
const POWER_REV=3;
if(Number(state.waterfallM68PowerRev||0)<POWER_REV){
 state.waterfallSpillWidth=.985;
 state.waterfallSpillHeight=.82;
 state.waterfallFlow=1.90;
 state.waterfallM68PowerRev=POWER_REV;
}
if(!Number.isFinite(Number(state.waterfallSpillWidth)))state.waterfallSpillWidth=.985;
if(!Number.isFinite(Number(state.waterfallSpillHeight)))state.waterfallSpillHeight=.82;
if(!Number.isFinite(Number(state.waterfallFlow)))state.waterfallFlow=1.90;
state.waterfallSpillWidth=clamp(Number(state.waterfallSpillWidth),.82,.995);
state.waterfallSpillHeight=clamp(Number(state.waterfallSpillHeight),.72,.86);
state.waterfallFlow=clamp(Number(state.waterfallFlow),.75,3.0);
save();

const smooth01=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};

function geom(){
 const b=sim.params.box,d=sim.params.spacing;
 const widthFrac=clamp(Number(state.waterfallSpillWidth)||.985,.82,.995);
 const shelfFrac=clamp(Number(state.waterfallSpillHeight)||.82,.72,.86);
 const flow=clamp(Number(state.waterfallFlow)||1.90,.75,3.0);

 // A large upper basin gives the solver a real hydrostatic head instead of a thin source sheet.
 const lipX=b[0]*.58;
 const shelfY=b[1]*shelfFrac;
 const spillWidth=b[2]*widthFrac;
 const z0=(b[2]-spillWidth)*.5;
 const z1=z0+spillWidth;
 const basinDepth=Math.min(.50,b[1]*.20);
 const basinFloor=Math.max(d*3.2,shelfY-basinDepth);
 const rampStart=lipX*.72;
 const wallTop=b[1]-d*2.1;
 // Flow changes the maintained reservoir head, not the velocity of the falling sheet.
 const targetHead=clamp(.235+.058*flow,.28,.41);

 const lowerNx=Math.max(2,Math.floor((b[0]-3*d)/d));
 const lowerNz=Math.max(2,Math.floor((b[2]-3*d)/d));
 const upperNx=Math.max(3,Math.floor((lipX-3*d)/d));
 const upperNz=Math.max(3,Math.floor((z1-z0-3*d)/d));
 const nFluid=Math.max(1,Number(sim.scene?.nFluid)||Math.max(1,sim.n-(sim.nBodyParts||0)));
 const maxUpperLayers=Math.max(4,Math.floor((wallTop-basinFloor-d*1.15)/d));
 const targetUpperLayers=clamp(Math.ceil((shelfY+targetHead-basinFloor)/d),4,maxUpperLayers);
 const upperCap=Math.max(1,upperNx*upperNz*maxUpperLayers);
 const shareCap=quality==='low'?.57:quality==='high'?.67:.62;
 const desiredUpper=Math.min(Math.round(nFluid*shareCap),upperNx*upperNz*targetUpperLayers);
 const upperN=Math.min(desiredUpper,upperCap);
 const lowerN=Math.max(1,nFluid-upperN);
 const lowerLayers=Math.ceil(lowerN/(lowerNx*lowerNz));
 const lowerSurface=Math.min(shelfY-d*6,d*(.75+lowerLayers));
 const upperLayers=Math.ceil(upperN/(upperNx*upperNz));
 const upperSurface=Math.min(wallTop-d*.8,basinFloor+d*(.8+upperLayers));

 const intakeX=b[0]*.62;
 const intakeY=Math.max(d*2.4,lowerSurface*.68);
 const basePump=quality==='low'?135:quality==='high'?72:95;
 const pumpPeriod=clamp(Math.round(basePump/flow),28,220);
 return{b,d,lipX,shelfY,z0,z1,spillWidth,widthFrac,shelfFrac,flow,basinDepth,basinFloor,
  rampStart,wallTop,targetHead,lowerNx,lowerNz,upperNx,upperNz,nFluid,upperN,lowerN,
  lowerSurface,upperSurface,intakeX,intakeY,pumpPeriod};
}

function floorAt(g,x){
 const t=smooth01((x-g.rampStart)/Math.max(g.lipX-g.rampStart,1e-4));
 return g.basinFloor+(g.shelfY-g.basinFloor)*t;
}

// ---------- Static native PBF collision geometry ----------------------------------------------
function buildBoundary(){
 const g=geom(),d=g.d,h=sim.h,b=g.b;
 const pts=[];
 const seen=new Set();
 const qstep=d*.38;
 const add=(x,y,z)=>{
  x=clamp(x,0,b[0]);y=clamp(y,0,b[1]);z=clamp(z,0,b[2]);
  const key=`${Math.round(x/qstep)},${Math.round(y/qstep)},${Math.round(z/qstep)}`;
  if(seen.has(key))return;seen.add(key);pts.push(x,y,z);
 };
 const base=sim.scene?.boundary?.pts||[];
 for(let i=0;i<base.length;i+=3)add(base[i],base[i+1],base[i+2]);
 const step=d*.90;

 // Deep horizontal reservoir floor followed by a short smooth ramp up to the spill crest.
 for(let x=d;x<=g.lipX+step*.25;x+=step){
  const y=floorAt(g,x);
  for(let z=g.z0;z<=g.z1+step*.25;z+=step)add(x,y,z);
 }
 // Second skin prevents high-head particles tunnelling through the elevated terrain.
 for(let x=d;x<=g.lipX+step*.25;x+=step){
  const y=floorAt(g,x)-d*.58;
  for(let z=g.z0;z<=g.z1+step*.25;z+=step)add(x,y,z);
 }
 // Side retaining walls create one broad reservoir/channel that ends at the unsupported lip.
 for(const z of [g.z0,g.z1]){
  for(let x=d;x<=g.lipX+step*.25;x+=step){
   const fy=floorAt(g,x);
   for(let y=fy;y<=g.wallTop+step*.25;y+=step)add(x,y,z);
  }
 }
 // Tall physical cliff beneath the crest; there is deliberately no support beyond x=lipX.
 for(let y=d;y<=g.shelfY+step*.12;y+=step)
  for(let z=g.z0;z<=g.z1+step*.25;z+=step)add(g.lipX,y,z);

 const n=pts.length/3;
 const dim=sim.gridDim;
 const cellOf=(x,y,z)=>[
  Math.min(dim[0]-1,Math.max(0,Math.floor(x/h))),
  Math.min(dim[1]-1,Math.max(0,Math.floor(y/h))),
  Math.min(dim[2]-1,Math.max(0,Math.floor(z/h)))
 ];
 const keyOf=(a,c,e)=>(e*dim[1]+c)*dim[0]+a;
 const buckets=new Map();
 for(let i=0;i<n;i++){
  const [a,c,e]=cellOf(pts[i*3],pts[i*3+1],pts[i*3+2]),k=keyOf(a,c,e);
  let arr=buckets.get(k);if(!arr){arr=[];buckets.set(k,arr);}arr.push(i);
 }
 const coef=315/(64*Math.PI*Math.pow(h,9)),h2=h*h;
 const psi=new Float32Array(Math.max(1,n));
 for(let i=0;i<n;i++){
  const [a,c,e]=cellOf(pts[i*3],pts[i*3+1],pts[i*3+2]);let sum=0;
  for(let dz=-1;dz<=1;dz++){const zz=e+dz;if(zz<0||zz>=dim[2])continue;
   for(let dy=-1;dy<=1;dy++){const yy=c+dy;if(yy<0||yy>=dim[1])continue;
    for(let dx=-1;dx<=1;dx++){const xx=a+dx;if(xx<0||xx>=dim[0])continue;
     const arr=buckets.get(keyOf(xx,yy,zz));if(!arr)continue;
     for(const j of arr){
      const rx=pts[i*3]-pts[j*3],ry=pts[i*3+1]-pts[j*3+1],rz=pts[i*3+2]-pts[j*3+2];
      const r2=rx*rx+ry*ry+rz*rz;if(r2>=h2)continue;const t=h2-r2;sum+=t*t*t;
     }
    }
   }
  }
  sum*=coef;psi[i]=sum>0?sim.params.restDensity/sum:0;
 }
 return{pts,psi,count:n,g};
}

function installBoundary(){
 const bd=buildBoundary(),n=bd.count;
 const raw=new Float32Array(Math.max(1,n)*4);
 for(let i=0;i<n;i++){raw[i*4]=bd.pts[i*3];raw[i*4+1]=bd.pts[i*3+1];raw[i*4+2]=bd.pts[i*3+2];}
 const sorted=sim.sortBoundary(raw,bd.psi,n);
 const ST=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
 sim.buf.bpos?.destroy?.();sim.buf.bpsi?.destroy?.();sim.buf.bcellStart?.destroy?.();
 sim.buf.bpos=dev.createBuffer({label:'fluidV5M68BoundaryPos',size:Math.max(16,n*16),usage:ST});
 sim.buf.bpsi=dev.createBuffer({label:'fluidV5M68BoundaryPsi',size:Math.max(16,n*4),usage:ST});
 sim.buf.bcellStart=dev.createBuffer({label:'fluidV5M68BoundaryCellStart',size:Math.max(16,(sim.nCells+2)*4),usage:ST});
 dev.queue.writeBuffer(sim.buf.bpos,0,sorted.sortedPos);
 dev.queue.writeBuffer(sim.buf.bpsi,0,sorted.sortedPsi);
 dev.queue.writeBuffer(sim.buf.bcellStart,0,sorted.cellStart);
 sim.nBoundary=n;sim.scene.boundary={pts:bd.pts,psi:bd.psi,count:n};
 sim.uploadParams(1/240);sim.buildBindGroups();
 const S=window.__v5WaterfallM68;if(S){
  S.boundarySamples=n;S.lipX=bd.g.lipX;S.shelfY=bd.g.shelfY;
  S.dropHeight=bd.g.shelfY-bd.g.lowerSurface;S.spillWidth=bd.g.spillWidth;S.targetHead=bd.g.targetHead;
 }
}

// ---------- Seed one real upper reservoir plus the lower receiving pool -----------------------
const seedUni=dev.createBuffer({label:'fluidV5M68SeedUniform',size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const SF=new Float32Array(32),SU=new Uint32Array(SF.buffer);
const seedCounter=dev.createBuffer({label:'fluidV5M68SeedCounter',size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
const seedWGSL=`
struct Cfg {
 g0: vec4<f32>,
 g1: vec4<f32>,
 g2: vec4<f32>,
 dims: vec4<u32>,
 meta: vec4<u32>,
 tune: vec4<f32>,
 pad0: vec4<f32>,
 pad1: vec4<f32>,
}
@group(0) @binding(0) var<uniform> C: Cfg;
@group(0) @binding(1) var<storage,read_write> P: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> V: array<vec4<f32>>;
@group(0) @binding(3) var<storage,read> B: array<vec4<u32>>;
@group(0) @binding(4) var<storage,read_write> counter: atomic<u32>;
fn smooth01(x:f32)->f32{let t=clamp(x,0.0,1.0);return t*t*(3.0-2.0*t);}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;
 if(i>=C.meta.x||B[i].x!=0u){return;}
 let rank=atomicAdd(&counter,1u);
 let d=C.g0.w;
 var p=vec3<f32>(0.0);
 if(rank<C.meta.y){
  let nx=max(C.dims.x,1u);let nz=max(C.dims.y,1u);
  let ix=rank%nx;let q=rank/nx;let iz=q%nz;let iy=q/nz;
  let x=d*1.55+f32(ix)*d;
  let z=C.g1.z+d*1.55+f32(iz)*d;
  let rt=smooth01((x-C.g2.y)/max(C.g1.y-C.g2.y,0.0001));
  let floorY=mix(C.g2.x,C.g1.x,rt);
  p=vec3<f32>(x,floorY+d*(0.78+f32(iy)),z);
 }else{
  let r=rank-C.meta.y;let nx=max(C.dims.z,1u);let nz=max(C.dims.w,1u);
  let ix=r%nx;let q=r/nx;let iz=q%nz;let iy=q/nz;
  p=vec3<f32>(d*1.55+f32(ix)*d,d*(0.78+f32(iy)),d*1.55+f32(iz)*d);
 }
 P[i]=vec4<f32>(p,1.0);
 V[i]=vec4<f32>(0.0,0.0,0.0,0.0);
}`;
const seedMod=dev.createShaderModule({code:seedWGSL,label:'fluidV5M68SeedWGSL'});
if(typeof seedMod.getCompilationInfo==='function'){
 const info=await seedMod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');
 if(errors.length)throw new Error('Fluid V5 M6.8 seed WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const seedPipe=await dev.createComputePipelineAsync({label:'fluidV5M68Seed',layout:'auto',compute:{module:seedMod,entryPoint:'main'}});

function seedWater(){
 const g=geom();SF.fill(0);
 SF[0]=g.b[0];SF[1]=g.b[1];SF[2]=g.b[2];SF[3]=g.d;
 SF[4]=g.shelfY;SF[5]=g.lipX;SF[6]=g.z0;SF[7]=g.z1;
 SF[8]=g.basinFloor;SF[9]=g.rampStart;SF[10]=g.targetHead;SF[11]=0;
 SU[12]=g.upperNx;SU[13]=g.upperNz;SU[14]=g.lowerNx;SU[15]=g.lowerNz;
 SU[16]=sim.n;SU[17]=g.upperN;SU[18]=g.nFluid;SU[19]=0;
 dev.queue.writeBuffer(seedUni,0,SF);
 const enc=dev.createCommandEncoder({label:'fluidV5M68SeedEncoder'});enc.clearBuffer(seedCounter);
 const bg=dev.createBindGroup({layout:seedPipe.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:seedUni}},{binding:1,resource:{buffer:sim.livePos()}},
  {binding:2,resource:{buffer:sim.liveVel()}},{binding:3,resource:{buffer:sim.liveBody()}},
  {binding:4,resource:{buffer:seedCounter}}
 ]});
 const cp=enc.beginComputePass();cp.setPipeline(seedPipe);cp.setBindGroup(0,bg);cp.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/256)));cp.end();dev.queue.submit([enc.finish()]);
 sim.primeGrid();
 const S=window.__v5WaterfallM68;if(S){
  S.upperParticles=g.upperN;S.lowerParticles=g.lowerN;S.upperSurface=g.upperSurface;
  S.lowerSurface=g.lowerSurface;S.dropHeight=g.shelfY-g.lowerSurface;S.spillWidth=g.spillWidth;S.targetHead=g.targetHead;
 }
}

// ---------- Hidden lower-pool -> rear-reservoir recirculation ---------------------------------
const pumpUni=dev.createBuffer({label:'fluidV5M68PumpUniform',size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const PF=new Float32Array(20),PU=new Uint32Array(PF.buffer);
const pumpWGSL=`
struct Cfg {g0:vec4<f32>,g1:vec4<f32>,g2:vec4<f32>,meta:vec4<u32>,pad:vec4<f32>}
@group(0) @binding(0) var<uniform> C: Cfg;
@group(0) @binding(1) var<storage,read_write> P: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> V: array<vec4<f32>>;
@group(0) @binding(3) var<storage,read> B: array<vec4<u32>>;
fn hash1(x0:u32)->f32{var x=x0;x=x^(x>>16u);x=x*0x7feb352du;x=x^(x>>15u);x=x*0x846ca68bu;x=x^(x>>16u);return f32(x)/4294967295.0;}
fn smooth01(x:f32)->f32{let t=clamp(x,0.0,1.0);return t*t*(3.0-2.0*t);}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=C.meta.x||B[i].x!=0u){return;}
 let p=P[i].xyz;
 if(p.x<C.g1.x||p.y>C.g1.y||p.z<C.g0.z||p.z>C.g0.w){return;}
 let period=max(C.meta.y,1u);let s=i^(C.meta.z*747796405u);
 if((s+C.meta.z*1664525u)%period!=0u){return;}
 let h0=hash1(s+17u);let h1=hash1(s+101u);let h2=hash1(s+313u);let d=C.g1.z;
 let x=d*(1.8+h0*4.8);
 let rt=smooth01((x-C.g2.y)/max(C.g0.y-C.g2.y,0.0001));
 let floorY=mix(C.g2.x,C.g0.x,rt);
 let z=C.g0.z+d*1.8+h1*max(C.g0.w-C.g0.z-d*3.6,d);
 let y=floorY+d*(2.0+h2*8.5);
 P[i]=vec4<f32>(x,y,z,1.0);
 V[i]=vec4<f32>(0.022+h0*.020,0.0,(h1-.5)*.008,0.0);
}`;
const pumpMod=dev.createShaderModule({code:pumpWGSL,label:'fluidV5M68PumpWGSL'});
if(typeof pumpMod.getCompilationInfo==='function'){
 const info=await pumpMod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');
 if(errors.length)throw new Error('Fluid V5 M6.8 pump WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pumpPipe=await dev.createComputePipelineAsync({label:'fluidV5M68Recirculation',layout:'auto',compute:{module:pumpMod,entryPoint:'main'}});
let pumpFrame=1,pumpSubmits=0;
function recirculate(){
 if(!active()||ui.paused||!sim.n)return;
 const g=geom();
 // A slow natural pump surge changes reservoir head over several seconds; it never acts on the fall.
 const surge=.82+.36*(.5+.5*Math.sin(performance.now()*.00062));
 const dynamicPeriod=clamp(Math.round(g.pumpPeriod/surge),24,240);
 PF.fill(0);PF[0]=g.shelfY;PF[1]=g.lipX;PF[2]=g.z0;PF[3]=g.z1;
 PF[4]=g.intakeX;PF[5]=g.intakeY;PF[6]=g.d;PF[7]=g.upperSurface;
 PF[8]=g.basinFloor;PF[9]=g.rampStart;PF[10]=g.targetHead;PF[11]=0;
 PU[12]=sim.n;PU[13]=dynamicPeriod;PU[14]=pumpFrame++;PU[15]=1;
 dev.queue.writeBuffer(pumpUni,0,PF);
 const bg=dev.createBindGroup({layout:pumpPipe.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:pumpUni}},{binding:1,resource:{buffer:sim.livePos()}},
  {binding:2,resource:{buffer:sim.liveVel()}},{binding:3,resource:{buffer:sim.liveBody()}}
 ]});
 const enc=dev.createCommandEncoder({label:'fluidV5M68PumpEncoder'}),cp=enc.beginComputePass();
 cp.setPipeline(pumpPipe);cp.setBindGroup(0,bg);cp.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/256)));cp.end();
 dev.queue.submit([enc.finish()]);pumpSubmits++;
 const S=window.__v5WaterfallM68;if(S){S.pumpSubmits=pumpSubmits;S.pumpPeriod=dynamicPeriod;S.flow=g.flow;S.surge=surge;}
}

// ---------- Waterfall-only material / solver tuning -------------------------------------------
let savedPhysics=null,savedOptics=null,wasActive=false;
function tune(on){
 if(on&&!wasActive){
  savedPhysics={substeps:sim.params.substeps,iterations:sim.params.iterations,xsphC:sim.params.xsphC,
   sCorrK:sim.params.sCorrK,surfaceTensionK:sim.params.surfaceTensionK,xpbd:Number(state.xpbdDensity),whitewater:Number(state.whitewater)};
  savedOptics={transmit:Array.isArray(ssfr.transmit)?[...ssfr.transmit]:null,absorption:ssfr.absorption,
   roughness:ssfr.roughness,thicknessScale:ssfr.thicknessScale};
 }
 if(on){
  const wantSub=quality==='low'?3:quality==='high'?5:4;
  const wantIter=quality==='low'?5:quality==='high'?7:6;
  sim.params.substeps=Math.max(Number(sim.params.substeps)||2,wantSub);
  sim.params.iterations=Math.max(Number(sim.params.iterations)||4,wantIter);
  // Less surface tension prevents the high-head sheet from collapsing into beads/blobs.
  sim.params.xsphC=.034;
  sim.params.sCorrK=.070;
  sim.params.surfaceTensionK=.075;
  state.xpbdDensity=Math.max(Number(state.xpbdDensity)||0,.86);
  state.whitewater=Math.max(.20,Math.min(.46,Number(savedPhysics?.whitewater)||.30));
  ssfr.transmit=[.08,.70,.67];ssfr.absorption=.68;ssfr.roughness=.021;ssfr.thicknessScale=1.04;
 }else if(wasActive&&savedPhysics){
  sim.params.substeps=savedPhysics.substeps;sim.params.iterations=savedPhysics.iterations;
  sim.params.xsphC=savedPhysics.xsphC;sim.params.sCorrK=savedPhysics.sCorrK;
  sim.params.surfaceTensionK=savedPhysics.surfaceTensionK;
  if(Number.isFinite(savedPhysics.xpbd))state.xpbdDensity=savedPhysics.xpbd;
  if(Number.isFinite(savedPhysics.whitewater))state.whitewater=savedPhysics.whitewater;
  if(savedOptics){if(savedOptics.transmit)ssfr.transmit=[...savedOptics.transmit];ssfr.absorption=savedOptics.absorption;
   ssfr.roughness=savedOptics.roughness;ssfr.thicknessScale=savedOptics.thicknessScale;}
  savedPhysics=null;savedOptics=null;
 }
 wasActive=on;
}

function setupAfterReset(){
 if(!active())return;
 installBoundary();seedWater();tune(true);
 const S=window.__v5WaterfallM68;if(S){S.active=true;S.ready=true;S.error='';}
}
const baseReset=sim.reset.bind(sim);
sim.reset=function(params){
 const out=baseReset(params);
 try{setupAfterReset();}catch(err){const S=window.__v5WaterfallM68;if(S){S.ready=false;S.error=String(err?.message||err);}console.error('[Fluid V5 M6.8 setup]',err);}
 return out;
};
const baseStep=sim.step.bind(sim);
sim.step=function(frameDt){
 const on=active();tune(on);const out=baseStep(frameDt);
 if(on){try{recirculate();}catch(err){const S=window.__v5WaterfallM68;if(S){S.error=String(err?.message||err);}console.error('[Fluid V5 M6.8 pump]',err);}}
 const S=window.__v5WaterfallM68;if(S)S.active=on;return out;
};

// ---------- Scenario UI -----------------------------------------------------------------------
function stopWave(){const t=document.getElementById('v4WaveToggle');if(t?.classList.contains('active'))t.click();}
function resetScene(){const b=document.getElementById('reset')||document.getElementById('resetV4');if(b)b.click();else sim.reset(sim.params);}
function choose(){state.scenario=ACTIVE;ui.pouring=false;stopWave();save();resetScene();state.scenario=ACTIVE;save();sync();}
function waterfallButton(){return document.querySelector('[data-m46="waterfall"]')||document.querySelector('[data-m46="waterfall-m562"]')||[...document.querySelectorAll('#v5ScenariosM46 button')].find(b=>/WATERFALL/i.test(b.textContent||''));}
function installButton(){
 const old=waterfallButton();if(!old)return false;if(old.dataset.m68==='1')return true;
 const b=old.cloneNode(true);b.dataset.m46=ACTIVE;b.dataset.m68='1';b.textContent='WATERFALL';
 b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();choose();},{capture:true});
 old.replaceWith(b);return true;
}
installButton();
const panel=document.getElementById('settingsPanel');if(panel)new MutationObserver(()=>installButton()).observe(panel,{childList:true,subtree:true});

let rebuildTimer=0;
function scheduleGeometryRebuild(){clearTimeout(rebuildTimer);rebuildTimer=setTimeout(()=>{if(active())resetScene();},320);}
function sync(){
 const b=document.querySelector('[data-m68="1"]');if(b)b.classList.toggle('active',active());
 const g=geom(),S=window.__v5WaterfallM68;
 const el=document.getElementById('v5WaterfallM68Status');
 if(el)el.textContent=`${g.upperN.toLocaleString()} upper + ${g.lowerN.toLocaleString()} lower PBF · width ${g.spillWidth.toFixed(2)} m · drop ~${Math.max(0,g.shelfY-g.lowerSurface).toFixed(2)} m · head ${g.targetHead.toFixed(2)} m · pump ${S?.surge?S.surge.toFixed(2):'1.00'}×`;
 const w=document.getElementById('v5M68WidthVal');if(w)w.textContent=`${Math.round(g.widthFrac*100)}% · ${g.spillWidth.toFixed(2)} m`;
 const h=document.getElementById('v5M68HeightVal');if(h)h.textContent=`${Math.max(0,g.shelfY-g.lowerSurface).toFixed(2)} m drop`;
 const f=document.getElementById('v5M68FlowVal');if(f)f.textContent=`${g.flow.toFixed(2)}×`;
}
function mount(){
 const h=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');
 if(!h||document.getElementById('v5WaterfallM68'))return;
 const d=document.createElement('div');d.id='v5WaterfallM68';
 d.style.cssText='margin-top:10px;padding:9px;border:1px solid rgba(78,214,220,.18);border-radius:10px;background:rgba(4,17,24,.58)';
 d.innerHTML=`<div style="font:800 9px ui-monospace;color:#9dffc8;letter-spacing:.10em">HIGH-HEAD PHYSICAL SPILLWAY · M6.8</div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:5px">A deep elevated PBF reservoir now holds real hydraulic head behind a short spillway ramp. The broad sheet is created by pressure + gravity over collision geometry; the pump only returns lower-pool water to the rear basin and slowly surges so the real waterfall visibly breathes.</div><div class="v5Slider" style="margin-top:8px"><label>SPILL WIDTH</label><input id="v5M68Width" type="range" min="0.82" max="0.995" step="0.005"><div class="v5Val" id="v5M68WidthVal"></div></div><div class="v5Slider"><label>DROP HEIGHT</label><input id="v5M68Height" type="range" min="0.72" max="0.86" step="0.005"><div class="v5Val" id="v5M68HeightVal"></div></div><div class="v5Slider"><label>RESERVOIR FLOW</label><input id="v5M68Flow" type="range" min="0.75" max="3.00" step="0.05"><div class="v5Val" id="v5M68FlowVal"></div></div><div id="v5WaterfallM68Status" style="font:7.5px/1.45 ui-monospace;color:#9fc5d0;margin-top:6px"></div>`;
 h.appendChild(d);
 const width=d.querySelector('#v5M68Width'),height=d.querySelector('#v5M68Height'),flow=d.querySelector('#v5M68Flow');
 width.value=state.waterfallSpillWidth;height.value=state.waterfallSpillHeight;flow.value=state.waterfallFlow;
 width.addEventListener('input',e=>{state.waterfallSpillWidth=clamp(Number(e.target.value),.82,.995);save();sync();scheduleGeometryRebuild();});
 height.addEventListener('input',e=>{state.waterfallSpillHeight=clamp(Number(e.target.value),.72,.86);save();sync();scheduleGeometryRebuild();});
 flow.addEventListener('input',e=>{state.waterfallFlow=clamp(Number(e.target.value),.75,3.0);save();sync();});
 d.addEventListener('pointerdown',e=>e.stopPropagation());d.addEventListener('click',e=>e.stopPropagation());sync();
}
setInterval(()=>{installButton();mount();sync();},500);mount();sync();

window.__v5WaterfallM68={online:true,backend:'high-head-elevated-reservoir-spillway-m68',active:false,ready:false,error:'',boundarySamples:0,upperParticles:0,lowerParticles:0,upperSurface:0,lowerSurface:0,lipX:0,shelfY:0,dropHeight:0,spillWidth:0,targetHead:0,flow:state.waterfallFlow,surge:1,pumpPeriod:0,pumpSubmits:0,analyticCurtain:false,ballisticGuide:false,taggedCarrier:false,physicsTerrain:true,gravityDriven:true,recirculating:true,adjustable:true};
if(/^waterfall/.test(String(state.scenario||''))){state.scenario=ACTIVE;save();setTimeout(()=>{try{resetScene();}catch(err){console.error('[Fluid V5 M6.8 initial reset]',err);}},80);}
console.info('[Fluid V5 M6.8] high-head broad physical reservoir spillway online.');
