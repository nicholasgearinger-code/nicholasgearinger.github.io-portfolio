// Fluid V5 M6.1 deterministic inlet-buffer circulation.
// The M6 Houdini-style renderer remains authoritative for appearance. This module solves the
// remaining continuity problem: waterfall particles are recycled in evenly staggered time buckets
// based on their stable phase.y IDs, not on a fragile contact plane. The same fixed PBF mass is
// reused forever; each parcel still participates in the real PBF solve between inlet visits.

const sim=window.__sim,ssfr=window.__ssfr,state=window.__v5State;
if(!sim?.dev||!ssfr?.dev||!state)throw new Error('Fluid V5 M6.1 inlet buffer: runtime unavailable.');
const dev=sim.dev,TAG=window.__v5WaterfallTag||0x5746;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const active=()=>String(state.scenario||'').startsWith('waterfall-m58');
const BUCKETS=16; // wide enough for smooth flow, long enough that 20 FPS Safari cannot skip blindly.

function slabSurfaceY(){
 const b=sim.params.box,d=sim.params.spacing,margin=d;
 const nx=Math.max(1,Math.floor((b[0]-2*margin)/d));
 const nz=Math.max(1,Math.floor((b[2]-2*margin)/d));
 const baseFluid=Math.max(1,Number(sim.scene?.nFluid)||Math.max(1,sim.n-(sim.nBodyParts||0)-(window.__v5WaterfallM57?.target||0)));
 const layers=Math.max(1,Math.ceil(baseFluid/(nx*nz)));
 return clamp(margin+layers*d,d*2,b[1]-d*2);
}
function geom(){
 const b=sim.params.box,d=sim.params.spacing,flow=clamp(Number(state.waterfallFlow)||1,.45,1.55);
 const surface=slabSurfaceY();
 const topY=clamp(surface+Math.min(.79,b[1]*.315),surface+d*6,b[1]-d*2.5);
 const nozzleX=Math.max(d*1.65,b[0]*.038);
 const vx=.23+.085*flow,vy=-.055-.030*flow,g=Math.max(1,Number(sim.params.gravity)||9.81);
 const h=Math.max(0,topY-surface);
 const fallT=(vy+Math.sqrt(Math.max(0,vy*vy+2*g*h)))/g;
 const width=Math.min(b[2]*.92,Math.max(d*14,b[2]*clamp(Number(state.waterfallWidth)||.78,.48,.92)));
 return {b,d,flow,surface,topY,nozzleX,vx,vy,g,fallT,width,centreZ:b[2]*.50};
}

const uni=dev.createBuffer({label:'fluidV5M61BufferUniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(16),U=new Uint32Array(F.buffer);
const wgsl=`
struct Cfg{geo0:vec4f,geo1:vec4f,phase:vec4u,meta:vec4u}
@group(0)@binding(0)var<uniform>C:Cfg;
@group(0)@binding(1)var<storage,read_write>P:array<vec4f>;
@group(0)@binding(2)var<storage,read_write>V:array<vec4f>;
@group(0)@binding(3)var<storage,read_write>body:array<vec4u>;
fn hash1(x0:u32)->f32{var x=x0;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return f32(x)/4294967295.0;}
fn due(bucket:u32,prev:u32,cur:u32)->bool{
 if(prev==cur){return false;}
 if(prev<cur){return bucket>prev&&bucket<=cur;}
 return bucket>prev||bucket<=cur;
}
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){
 let i=gid.x;if(i>=C.phase.x){return;}
 var ph=body[i];if(ph.w!=C.phase.y){return;}
 if(C.meta.y==0u){body[i]=vec4u(ph.x,ph.y,0u,0u);return;}
 let id=select(i+1u,ph.y,ph.y!=0u);
 let bucket=id%C.meta.x;
 if(!due(bucket,C.phase.z,C.phase.w)){return;}
 // If the older contact watchdog already returned this parcel to the inlet, do not reset it twice.
 let p=P[i].xyz;
 if(p.y>C.geo0.x-C.geo1.y*1.45&&p.x<C.geo0.z+C.geo1.y*.85){return;}
 let epoch=C.meta.z;
 let s=id^(epoch*747796405u)^(bucket*2891336453u);
 let h0=hash1(s+17u);let h1=hash1(s+101u);let h2=hash1(s+313u);let h3=hash1(s+911u);
 let lane=(f32(bucket)+h0)/f32(max(C.meta.x,1u));
 // Preserve a wide sheet while avoiding synchronized rows. Stable ID jitter is sub-spacing only.
 let z=C.geo0.w+(h1-.5)*C.geo1.x*.985;
 let x=C.geo0.z+(h2-.5)*C.geo1.y*.10;
 let y=C.geo0.x-C.geo1.y*(.10+1.35*fract(h3+lane*.73));
 P[i]=vec4f(x,y,z,1.0);
 V[i]=vec4f(C.geo1.z+(h3-.5)*.010,C.geo1.w-h0*.018,(h2-.5)*.020,0.0);
 body[i]=vec4u(ph.x,id,0u,ph.w);
}`;
const mod=dev.createShaderModule({code:wgsl,label:'fluidV5M61BufferWGSL'});
if(typeof mod.getCompilationInfo==='function'){
 const info=await mod.getCompilationInfo();
 const errors=(info.messages||[]).filter(m=>m.type==='error');
 if(errors.length)throw new Error('Fluid V5 M6.1 inlet buffer WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M61InletBuffer',layout:'auto',compute:{module:mod,entryPoint:'main'}});

let prevBucket=-1,wasActive=false,epochs=0,pumps=0,lastCycleMs=0;
function dispatch(enc,on,now){
 if(!enc||!sim.n)return;
 const g=geom();
 // One full inlet cycle is deliberately a little longer than the ballistic fall, giving each PBF
 // parcel time to hit the pool and transfer momentum before the explicit buffer reuses it.
 const cycleMs=Math.max(520,(g.fallT+.24)*1000);
 const bucketMs=cycleMs/BUCKETS;
 const cur=Math.floor(now/bucketMs)%BUCKETS;
 let prev=prevBucket;
 if(prev<0)prev=(cur+BUCKETS-1)%BUCKETS;
 if(on&&cur===prev&&!(!wasActive))return;
 F[0]=g.topY;F[1]=g.surface;F[2]=g.nozzleX;F[3]=g.centreZ;
 F[4]=g.width;F[5]=g.d;F[6]=g.vx;F[7]=g.vy;
 U[8]=sim.n;U[9]=TAG;U[10]=prev>>>0;U[11]=cur>>>0;
 U[12]=BUCKETS;U[13]=on?1:0;U[14]=(epochs>>>0);U[15]=0;
 dev.queue.writeBuffer(uni,0,F);
 const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:uni}},
  {binding:1,resource:{buffer:sim.livePos()}},
  {binding:2,resource:{buffer:sim.liveVel()}},
  {binding:3,resource:{buffer:sim.liveBody()}},
 ]});
 const cp=enc.beginComputePass();cp.setPipeline(pipe);cp.setBindGroup(0,bg);cp.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/256)));cp.end();
 if(on){if(cur<prev)epochs++;prevBucket=cur;pumps++;lastCycleMs=cycleMs;}
 else{prevBucket=-1;}
 const S=window.__v5WaterfallBufferM61;if(S){S.active=on;S.bucket=cur;S.prev=prev;S.pumps=pumps;S.epochs=epochs;S.cycleMs=cycleMs;S.surfaceY=g.surface;}
}

// Execute the inlet-buffer pass inside the visible render encoder. This deliberately does not rely
// on sim.step monkey-patching; even if another physics module wraps/replaces step(), the waterfall
// reservoir is re-armed whenever the simulation is being rendered.
const baseRender=ssfr.render;
ssfr.render=function(...args){
 const enc=args[0],on=active(),now=performance.now();
 if(enc){
  if(on)dispatch(enc,true,now);
  else if(wasActive)dispatch(enc,false,now);
 }
 wasActive=on;
 return baseRender.apply(this,args);
};

// Replace the observed M6.0.1 brand node rather than fighting its MutationObserver. The old observer
// remains attached to the detached node, while this build marker accurately identifies M6.1.
const oldBrand=document.querySelector('.hud.card.title');
if(oldBrand){const b=oldBrand.cloneNode(true);b.textContent='FLUID V5 · M6.1';oldBrand.replaceWith(b);}
document.title='Fluid V5 · M6.1 BUFFERED HOUDINI WATERFALL';
window.__fluidV5Version='6.1.0-m61';
window.__fluidV5Build='M6.1 BUFFERED HOUDINI WATERFALL';
window.__v5WaterfallBufferM61={online:true,backend:'time-phased-inlet-buffer-m61',active:false,bucket:0,prev:0,pumps:0,epochs:0,cycleMs:0,surfaceY:0,buckets:BUCKETS};
console.info('[Fluid V5 M6.1] deterministic time-phased PBF waterfall inlet buffer online.');
