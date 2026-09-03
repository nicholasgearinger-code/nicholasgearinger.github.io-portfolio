// Fluid V8 M8.8.1 — numerical energy guard for true moving-boundary PBF.
//
// M8.8 correctly moved vessel contact inside the PBF substeps, but a hard analytic
// position projection can become artificial kinetic energy when upstream velFromPos
// reconstructs v=(pred-pos)/dt. This module keeps the M8.8 geometry/physics intact and
// clamps only numerically impossible post-contact speeds after each completed PBF
// substep, before the next gravity/predict stage can amplify them.

const sim=window.__sim,ssfr=window.__ssfr,api=window.__v5M880MovingBoundary;
if(!sim?.dev||!api?.online)throw new Error('M8.8.1 energy guard: M8.8 moving-boundary runtime unavailable.');
const dev=sim.dev,queue=dev.queue;
const WG=256;

const wgsl=`
struct Guard { n:u32, hard:f32, soft:f32, damping:f32 }
@group(0) @binding(0) var<uniform> G:Guard;
@group(0) @binding(1) var<storage,read_write> vel:array<vec4f>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=G.n){return;}
  var v=vel[i].xyz;let s=length(v);
  if(s>G.soft){v*=G.damping;}
  let s2=length(v);
  if(s2>G.hard){v*=G.hard/s2;}
  vel[i]=vec4f(v,0.0);
}`;
const mod=dev.createShaderModule({code:wgsl,label:'m881EnergyGuardWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.8.1 guard WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'m881EnergyGuard',layout:'auto',compute:{module:mod,entryPoint:'main'}});
const uniforms=[0,1].map(i=>dev.createBuffer({label:`m881GuardU${i}`,size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));
let slot=0,passes=0,lastHard=0;
const bindCache=new Map();
function bindFor(par,s){
  const key=`${sim.gen||0}:${par}:${s}`;let bg=bindCache.get(key);if(bg)return bg;
  const name=par===0?'velA':'velB';
  bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uniforms[s]}},{binding:1,resource:{buffer:sim.buf[name]}}
  ]});bindCache.set(key,bg);return bg;
}
function encodeGuard(enc){
  if(!sim.n)return;
  const dt=Math.max(1/1000,Number(sim.uniF?.[3])||1/240);
  const spacing=Math.max(.001,Number(sim.params?.spacing)||.019);
  // About 0.55 particle spacing of travel per substep is a conservative liquid CFL limit.
  // In this scene it resolves to ~2.5 m/s, comfortably above the gravity-driven pour speed.
  const hard=Math.min(3.0,Math.max(1.5,spacing*.55/dt));
  const soft=hard*.72,damping=.965;
  const s=slot++&1,F=new Float32Array(4),U=new Uint32Array(F.buffer);
  U[0]=sim.n;F[1]=hard;F[2]=soft;F[3]=damping;lastHard=hard;
  queue.writeBuffer(uniforms[s],0,F);
  const pass=enc.beginComputePass({label:'m881PostSubstepEnergyGuard'});
  pass.setPipeline(pipe);pass.setBindGroup(0,bindFor(sim.parity&1,s));pass.dispatchWorkgroups(Math.ceil(sim.n/WG));pass.end();passes++;
}

// Wrap outside M8.8. Its encoder proxy still injects the vessel boundary; this outer
// layer only notices a substep's finalize pipeline and appends the guard immediately after it.
const baseCreate=dev.createCommandEncoder.bind(dev),baseStep=sim.step.bind(sim);
let inStep=false;
dev.createCommandEncoder=function(desc){
  const enc=baseCreate(desc);if(!inStep)return enc;
  return new Proxy(enc,{get(target,prop){
    if(prop==='beginComputePass')return(desc2)=>{
      const pass=target.beginComputePass(desc2);let sawFinalize=false;
      return new Proxy(pass,{get(pt,pp){
        if(pp==='setPipeline')return(pipeline)=>{if(pipeline===sim.pipe.finalize)sawFinalize=true;return pt.setPipeline(pipeline);};
        if(pp==='end')return()=>{const out=pt.end();if(sawFinalize){try{encodeGuard(target)}catch(err){console.error('[M8.8.1 energy guard]',err);}}return out;};
        const v=Reflect.get(pt,pp,pt);return typeof v==='function'?v.bind(pt):v;
      }});
    };
    const v=Reflect.get(target,prop,target);return typeof v==='function'?v.bind(target):v;
  }});
};
sim.step=function(dt){
  // Keep cohesion low and use neighbour viscosity rather than droplet-forming tension.
  if(sim.params){sim.params.xsphC=.045;sim.params.surfaceTensionK=.004;}
  inStep=true;try{return baseStep(dt)}finally{inStep=false;}
};
if(ssfr){ssfr.splatRadius=1.24;ssfr.thicknessRadius=1.26;ssfr.bindCache=null;}

const title=document.querySelector('#m880Hud b');if(title)title.textContent='M8.8.1 · ENERGY-SAFE MOVING BOUNDARY';
const extra=document.createElement('div');extra.id='m881GuardStatus';extra.style.cssText='margin-top:5px;color:#9fe9c7';
document.getElementById('m880Status')?.after(extra);
setInterval(()=>{if(extra)extra.textContent=`substep energy guard ${passes.toLocaleString()} · CFL vmax ${lastHard.toFixed(2)} m/s`;},300);

window.__v5M881EnergyGuard={online:true,backend:'post-substep-cfl-energy-guard-m881',gpuSubmitsAdded:0,get passes(){return passes},get maxSpeed(){return lastHard}};
window.__fluidV5Version='8.8.1';window.__fluidV5Build='M8.8.1 TRUE MOVING-BOUNDARY PBF / PER-SUBSTEP CFL ENERGY GUARD / LOW COHESION';
const top=document.querySelector('.hud.card.title');if(top)top.textContent='FLUID V8 · M8.8.1';document.title='Fluid V8 · M8.8.1 Energy-Safe Moving Boundary';
console.info('[Fluid V8 M8.8.1] post-substep CFL energy guard online; M8.8 boundary physics preserved; added submits 0.');
