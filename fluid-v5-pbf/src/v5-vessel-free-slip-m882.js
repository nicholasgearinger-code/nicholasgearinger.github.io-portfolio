// Fluid V8 M8.8.2 — free-slip moving-spout velocity response.
//
// M8.8 solves vessel geometry inside PBF and M8.8.1 prevents catastrophic numerical energy.
// This layer fixes the remaining long ballistic arc without prescribing a pour trajectory:
// after each PBF finalize, particles actually touching the open spout floor/rails receive a
// zero-restitution free-slip contact response relative to the moving wall. The wall can stop
// penetration but cannot catapult water away from itself. Tangential flow remains untouched,
// and particles past the physical lip receive no correction at all.

import {sim,dev,queue,pitcher} from './v5-pitcher-fluid-physics-m872.js';
const api=window.__v5M880MovingBoundary;
if(!sim?.dev||!api?.online)throw new Error('M8.8.2 free-slip: M8.8 moving-boundary runtime unavailable.');
const WG=256;

// A slightly gentler maximum tilt still clears the real spout while reducing wall-induced slosh.
pitcher.maxAngle=-1.05;

const wgsl=`
struct UData{pitch:vec4f,motion:vec4f,info:vec4u}
@group(0) @binding(0) var<uniform> U:UData;
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;

fn toLocalP(p:vec3f)->vec3f{
  let d=p-U.pitch.xyz;let c=cos(U.pitch.w);let s=sin(U.pitch.w);
  return vec3f(c*d.x+s*d.y,-s*d.x+c*d.y,d.z);
}
fn toLocalV(v:vec3f)->vec3f{
  let c=cos(U.pitch.w);let s=sin(U.pitch.w);
  return vec3f(c*v.x+s*v.y,-s*v.x+c*v.y,v.z);
}
fn toWorldV(v:vec3f)->vec3f{
  let c=cos(U.pitch.w);let s=sin(U.pitch.w);
  return vec3f(c*v.x-s*v.y,s*v.x+c*v.y,v.z);
}
fn spoutY(x:f32)->f32{
  if(x<=.060){return .145;}if(x<.105){return mix(.145,.165,(x-.060)/.045);}
  if(x<.155){return mix(.165,.192,(x-.105)/.050);}if(x<.205){return mix(.192,.198,(x-.155)/.050);}
  return mix(.198,.182,clamp((x-.205)/.045,0.0,1.0));
}
fn spoutSlope(x:f32)->f32{
  if(x<.105){return (.165-.145)/.045;}
  if(x<.155){return (.192-.165)/.050;}
  if(x<.205){return (.198-.192)/.050;}
  return (.182-.198)/.045;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.info.x){return;}
  let p=pos[i].xyz;let q=toLocalP(p);let pr=max(U.motion.y*.48,.0036);
  // No contact response past the physical lip. From there gravity owns the trajectory.
  if(q.x<.045-pr||q.x>.248+pr*.15||abs(q.z)>.095+pr){return;}
  let sx=clamp(q.x,.060,.248);let sy=spoutY(sx);let halfW=max(.034,.066-pr*.18);
  let nearFloor=q.y<sy-.034+pr*1.75 && q.y>sy-.080-pr;
  let nearRail=abs(q.z)>halfW-pr*1.55 && abs(q.z)<halfW+pr*1.75 && q.y<sy+.058+pr;
  if(!nearFloor&&!nearRail){return;}

  let r=p-U.pitch.xyz;let omega=U.motion.x;
  let wallW=vec3f(-omega*r.y,omega*r.x,0.0);
  var rel=toLocalV(vel[i].xyz-wallW);

  // Floor: n points from the solid into the fluid. Zero restitution means contact can remove
  // penetration but cannot create a large separating kick. A tiny allowed separation keeps
  // particles numerically clear of the wall without turning the spout into a launcher.
  if(nearFloor){
    let m=spoutSlope(sx);let n=normalize(vec3f(-m,1.0,0.0));let vn=dot(rel,n);
    if(vn<0.0){rel-=n*vn;}else if(vn>.12){rel-=n*(vn-.12);}
  }
  if(nearRail){
    let sg=select(-1.0,1.0,q.z>=0.0);let n=vec3f(0.0,0.0,-sg);let vn=dot(rel,n);
    if(vn<0.0){rel-=n*vn;}else if(vn>.10){rel-=n*(vn-.10);}
  }
  vel[i]=vec4f(wallW+toWorldV(rel),0.0);
}`;

const mod=dev.createShaderModule({code:wgsl,label:'m882FreeSlipWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.8.2 free-slip WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'m882FreeSlip',layout:'auto',compute:{module:mod,entryPoint:'main'}});
const ubufs=[0,1].map(i=>dev.createBuffer({label:`m882SlipU${i}`,size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));
let uslot=0,passes=0;const cache=new Map();
function bindFor(par,s){const key=`${sim.gen||0}:${par}:${s}`;let bg=cache.get(key);if(bg)return bg;const n=par===0?'A':'B';bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubufs[s]}},{binding:1,resource:{buffer:sim.buf['pos'+n]}},{binding:2,resource:{buffer:sim.buf['vel'+n]}}]});cache.set(key,bg);return bg;}
function encodeSlip(enc){
  if(!sim.n)return;const s=uslot++&1,F=new Float32Array(12),U=new Uint32Array(F.buffer);
  F[0]=pitcher.cx;F[1]=pitcher.cy;F[2]=pitcher.cz;F[3]=pitcher.angle;
  F[4]=pitcher.omega;F[5]=Number(sim.params?.spacing)||.019;F[6]=Number(sim.uniF?.[3])||1/240;U[8]=sim.n;
  queue.writeBuffer(ubufs[s],0,F);
  const pass=enc.beginComputePass({label:'m882FreeSlipSpoutContact'});pass.setPipeline(pipe);pass.setBindGroup(0,bindFor(sim.parity&1,s));pass.dispatchWorkgroups(Math.ceil(sim.n/WG));pass.end();passes++;
}

// Load this before M8.8.1. Then the order at each substep is:
// PBF finalize -> free-slip contact repair -> CFL energy guard.
const baseCreate=dev.createCommandEncoder.bind(dev),baseStep=sim.step.bind(sim);let inStep=false;
dev.createCommandEncoder=function(desc){
  const enc=baseCreate(desc);if(!inStep)return enc;
  return new Proxy(enc,{get(target,prop){
    if(prop==='beginComputePass')return(desc2)=>{const pass=target.beginComputePass(desc2);let sawFinalize=false;return new Proxy(pass,{get(pt,pp){
      if(pp==='setPipeline')return(pipeline)=>{if(pipeline===sim.pipe.finalize)sawFinalize=true;return pt.setPipeline(pipeline);};
      if(pp==='end')return()=>{const out=pt.end();if(sawFinalize){try{encodeSlip(target)}catch(err){console.error('[M8.8.2 free-slip]',err);}}return out;};
      const v=Reflect.get(pt,pp,pt);return typeof v==='function'?v.bind(pt):v;
    }});};
    const v=Reflect.get(target,prop,target);return typeof v==='function'?v.bind(target):v;
  }});
};
sim.step=function(dt){
  // Lower cohesion/viscosity than M8.8.1 so the detached sheet can neck into a natural stream.
  if(sim.params){sim.params.xsphC=.036;sim.params.surfaceTensionK=.002;}
  inStep=true;try{return baseStep(dt)}finally{inStep=false;}
};

window.__v5M882FreeSlip={online:true,backend:'zero-restitution-free-slip-spout-contact-m882',gpuSubmitsAdded:0,get passes(){return passes}};
window.__fluidV5Version='8.8.2';window.__fluidV5Build='M8.8.2 TRUE MOVING-BOUNDARY PBF / FREE-SLIP SPOUT CONTACT / CFL ENERGY GUARD';
console.info('[Fluid V8 M8.8.2] free-slip spout velocity response online; no trajectory forcing; added submits 0.');
