// Fluid V5 M5.8.2 continuous fixed-mass waterfall.
// Reuse the validated M5.8.1 tagged SSFR exclusion + thin-sheet renderer, then add a second,
// contact-aware recycle pass. M5.8.1 waited for particle centres to fall almost through the free
// surface before returning them to the lip; PBF density constraints can arrest/rebound them above
// that plane. M5.8.2 recycles after a genuine surface-contact solve, predicted-impact overshoot, or
// near-surface rebound, so the same bounded mass circulates indefinitely.

const baseUrl='https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/5ed701b737ef39093c403e9933746a19685b0a28/fluid-v5-pbf/src/v5-waterfall-surface-m572.js';
const response=await fetch(baseUrl,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M5.8.2 base surface unavailable (${response.status}).`);
const baseSrc=await response.text();
const blobUrl=URL.createObjectURL(new Blob([baseSrc],{type:'text/javascript'}));
try{await import(blobUrl);}finally{URL.revokeObjectURL(blobUrl);}

const sim=window.__sim,ssfr=window.__ssfr,state=window.__v5State;
if(!sim?.dev||!ssfr?.dev||!state)throw new Error('Fluid V5 M5.8.2 recycle rescue: runtime unavailable.');
const dev=sim.dev,TAG=window.__v5WaterfallTag||0x5746;
const active=()=>state.scenario==='waterfall-m58';

// 64-byte uniform: three vec4f blocks followed by one vec4u block.
// geo0 = topY, contactY, nozzleX, centreZ
// geo1 = width, spacing, vx, vy
// geo2 = impactX, impactMargin, reboundY, reserved
// meta = n, tag, frame, enabled
const uni=dev.createBuffer({label:'fluidV5M582RecycleUniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const UF=new Float32Array(16),UU=new Uint32Array(UF.buffer);
const wgsl=`
struct U{geo0:vec4f,geo1:vec4f,geo2:vec4f,meta:vec4u}
@group(0)@binding(0)var<uniform>C:U;
@group(0)@binding(1)var<storage,read_write>P:array<vec4f>;
@group(0)@binding(2)var<storage,read_write>V:array<vec4f>;
@group(0)@binding(3)var<storage,read_write>phase:array<vec4u>;
fn hash1(x0:u32)->f32{var x=x0;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return f32(x)/4294967295.0;}
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){
 let i=gid.x;if(i>=C.meta.x||C.meta.w==0u){return;}
 var ph=phase[i];if(ph.w!=C.meta.y){return;}
 let p=P[i].xyz;let v=V[i].xyz;
 let contact=p.y<=C.geo0.y;
 let overshoot=p.x>=C.geo2.x+C.geo2.y;
 let rebound=p.y<=C.geo2.z&&v.y>-.10;
 if(!(contact||overshoot||rebound)){return;}
 let base=select(i+1u,ph.y,ph.y!=0u);
 let cycle=ph.z+1u;
 let s=base^(cycle*2246822519u)^(C.meta.z*3266489917u);
 let h0=hash1(s+17u);let h1=hash1(s+101u);let h2=hash1(s+313u);let h3=hash1(s+911u);
 let z=C.geo0.w+(h0-.5)*C.geo1.x*.96;
 let x=C.geo0.z+(h1-.5)*C.geo1.y*.20;
 // A two-spacing vertical phase spread prevents a synchronized curtain pulse after recycling.
 let y=C.geo0.x-C.geo1.y*(.08+2.05*h2);
 let vz=(h3-.5)*.034;
 P[i]=vec4f(x,y,z,1.0);
 V[i]=vec4f(C.geo1.z+(h2-.5)*.018,C.geo1.w-h1*.030,vz,0.0);
 phase[i]=vec4u(ph.x,ph.y,cycle,ph.w);
}`;
const mod=dev.createShaderModule({code:wgsl,label:'fluidV5M582RecycleWGSL'});
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M582ContactRecycle',layout:'auto',compute:{module:mod,entryPoint:'main'}});
let frame=0;
const baseRender=ssfr.render;
ssfr.render=function(...args){
 const enc=args[0];
 if(enc&&sim.n>0&&active()){
  const b=sim.params.box,d=sim.params.spacing;
  const flow=Math.max(.45,Math.min(1.55,Number(state.waterfallFlow)||1));
  const water=b[1]*.28;
  const topY=water+Math.min(.79,b[1]*.315);
  const nozzleX=Math.max(d*1.65,b[0]*.038);
  const vx=.23+.085*flow,vy=-.055-.030*flow,g=Math.max(1,Number(sim.params.gravity)||9.81);
  const h=Math.max(0,topY-water);
  const t=(vy+Math.sqrt(Math.max(0,vy*vy+2*g*h)))/g;
  const impactX=nozzleX+vx*t;
  const width=Math.min(b[2]*.92,Math.max(d*14,b[2]*Math.max(.48,Math.min(.92,Number(state.waterfallWidth)||.78))));
  UF[0]=topY;
  // PBF contact occurs before a particle centre reaches the old +0.10d plane. 1.35d gives the
  // density solve one real interaction step, then reliably returns the parcel to the lip.
  UF[1]=water+d*1.35;
  UF[2]=nozzleX;UF[3]=b[2]*.50;
  UF[4]=width;UF[5]=d;UF[6]=vx;UF[7]=vy;
  UF[8]=impactX;UF[9]=d*.70;UF[10]=water+d*2.05;UF[11]=0;
  UU[12]=sim.n;UU[13]=TAG;UU[14]=(frame++>>>0);UU[15]=1;
  dev.queue.writeBuffer(uni,0,UF);
  const phase=sim.buf[sim.parity===0?'bodyA':'bodyB'];
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
   {binding:0,resource:{buffer:uni}},
   {binding:1,resource:{buffer:sim.livePos()}},
   {binding:2,resource:{buffer:sim.liveVel()}},
   {binding:3,resource:{buffer:phase}},
  ]});
  const cp=enc.beginComputePass();cp.setPipeline(pipe);cp.setBindGroup(0,bg);cp.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/256)));cp.end();
 }
 return baseRender.apply(this,args);
};

window.__v5WaterfallRecycleM582={online:true,backend:'contact-aware-fixed-mass-recycle-m582',tag:TAG};
if(window.__v5WaterfallSurfaceM572)window.__v5WaterfallSurfaceM572.backend='fixed-mass-sheet-plus-contact-recycle-m582';
setTimeout(()=>{
 const brand=document.querySelector('.hud.card.title');if(brand)brand.textContent='FLUID V5 · M5.8.2';
 document.title='Fluid V5 · M5.8.2 CONTINUOUS FIXED-MASS WATERFALL';
 window.__fluidV5Version='5.3.8.2-m582';
},1200);
console.info('[Fluid V5 M5.8.2] contact-aware continuous waterfall recycle online.');
