// Fluid V5 M8.0 — common water-physics foundation.
// This module deliberately contains NO scene-specific equations. Every scene continues to use
// the same PBF density solver, boundary particles, gravity, surface tension and viscosity.
// M8.0 adds two global velocity-level corrections at the end of the existing unified physics
// command buffer: (1) radial/divergence damping and (2) vorticity confinement. Both operate on
// the same neighbor grid already produced by PBF. No extra queue.submit() call is created.
//
// This is a DFSPH-inspired FOUNDATION, not a claim of a complete DFSPH implementation yet.
// The immediate goal is to stop compensating for solver energy/compressibility errors with
// per-scene force fields, then validate Pool and Dam Break before rebuilding open boundaries.

const sim=window.__sim, ui=window.__ui;
if(!sim?.dev||!ui||!window.__v5M739Unified?.online)
  throw new Error('M8.0 fluid core: unified PBF runtime unavailable.');
const dev=sim.dev;

// One physical water model for every scene.
const water={
  projection:0.18,       // velocity-level radial/divergence correction
  vorticity:0.24,        // energy returned to rotational motion
  maxCorrection:0.22,    // m/s added by M8 per visible frame
  maxSpeed:10.0,         // numerical safety ceiling, not a scene control
  xsph:0.014,            // global kinematic viscosity/smoothing
  tension:0.18,          // global surface tension coefficient used by upstream solver
  scorr:0.055,           // global tensile-instability correction
  substeps:3,
  iterations:4,
};

function applyWaterModel(){
  const p=sim.params;
  if(!p)return;
  p.xsphC=water.xsph;
  p.surfaceTensionK=water.tension;
  p.sCorrK=water.scorr;
  p.substeps=Math.max(1,Math.round(water.substeps));
  p.iterations=Math.max(1,Math.round(water.iterations));
}
applyWaterModel();

const shader=`
struct CoreU {
  box:vec4f,       // xyz box size, w smoothing radius h
  fluid:vec4f,     // dt, projection, vorticity, maxCorrection
  tuning:vec4f,    // maxSpeed, time, spare, spare
  grid:vec4u,      // xyz grid dimensions, w particle count
}
@group(0) @binding(0) var<uniform> U:CoreU;
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
@group(0) @binding(3) var<storage,read> cellStart:array<u32>;
@group(0) @binding(4) var<storage,read_write> radial:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> omegaBuf:array<vec4f>;

fn cellOf(p:vec3f)->vec3i{
  let h=max(U.box.w,1.0e-5);
  let c=vec3i(floor(p/h));
  return clamp(c,vec3i(0),vec3i(U.grid.xyz)-vec3i(1));
}
fn cellIndex(c:vec3i)->u32{
  return u32((c.z*i32(U.grid.y)+c.y)*i32(U.grid.x)+c.x);
}
fn clampLen(v:vec3f,m:f32)->vec3f{
  let l=length(v);
  return select(v,v*(m/max(l,1.0e-8)),l>m);
}

// Measure local radial velocity mismatch and curl from the SAME PBF neighbor field.
@compute @workgroup_size(256)
fn measure(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.grid.w){return;}
  let pi=pos[i].xyz;let vi=vel[i].xyz;let h=max(U.box.w,1.0e-5);
  let c=cellOf(pi);
  var dv=vec3f(0.0);var curl=vec3f(0.0);var ws=0.0;
  for(var dz=-1;dz<=1;dz++){
    let z=c.z+dz;if(z<0||z>=i32(U.grid.z)){continue;}
    for(var dy=-1;dy<=1;dy++){
      let y=c.y+dy;if(y<0||y>=i32(U.grid.y)){continue;}
      for(var dx=-1;dx<=1;dx++){
        let x=c.x+dx;if(x<0||x>=i32(U.grid.x)){continue;}
        let ci=cellIndex(vec3i(x,y,z));let b=cellStart[ci];let e=cellStart[ci+1u];
        for(var j=b;j<e;j++){
          if(j==i){continue;}
          let q=pos[j].xyz-pi;let r2=dot(q,q);
          if(r2<=1.0e-12||r2>=h*h){continue;}
          let r=sqrt(r2);let dir=q/r;let xw=1.0-r/h;let w=xw*xw;
          let rel=vel[j].xyz-vi;
          // Only the inter-particle normal component is corrected. Tangential/shear motion is
          // left alone so waves and vortices are not indiscriminately smoothed away.
          dv+=w*dot(rel,dir)*dir;
          curl+=w*cross(rel,dir)/max(r,h*.20);
          ws+=w;
        }
      }
    }
  }
  if(ws>1.0e-6){dv/=ws;curl/=ws;}
  radial[i]=vec4f(dv,ws);
  omegaBuf[i]=vec4f(curl,length(curl));
}

// Apply a bounded velocity projection and classic vorticity-confinement style energy return.
@compute @workgroup_size(256)
fn applyCore(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.grid.w){return;}
  let pi=pos[i].xyz;let h=max(U.box.w,1.0e-5);let c=cellOf(pi);
  let wi=omegaBuf[i].xyz;let mi=omegaBuf[i].w;
  var gradMag=vec3f(0.0);var ws=0.0;
  for(var dz=-1;dz<=1;dz++){
    let z=c.z+dz;if(z<0||z>=i32(U.grid.z)){continue;}
    for(var dy=-1;dy<=1;dy++){
      let y=c.y+dy;if(y<0||y>=i32(U.grid.y)){continue;}
      for(var dx=-1;dx<=1;dx++){
        let x=c.x+dx;if(x<0||x>=i32(U.grid.x)){continue;}
        let ci=cellIndex(vec3i(x,y,z));let b=cellStart[ci];let e=cellStart[ci+1u];
        for(var j=b;j<e;j++){
          if(j==i){continue;}
          let q=pos[j].xyz-pi;let r2=dot(q,q);
          if(r2<=1.0e-12||r2>=h*h){continue;}
          let r=sqrt(r2);let dir=q/r;let xw=1.0-r/h;let w=xw*xw;
          gradMag+=w*(omegaBuf[j].w-mi)*dir/max(h,1.0e-5);ws+=w;
        }
      }
    }
  }
  if(ws>1.0e-6){gradMag/=ws;}
  var dv=U.fluid.y*radial[i].xyz;
  let gm=length(gradMag);
  if(gm>1.0e-5&&mi>1.0e-5){
    let N=gradMag/gm;
    let confinement=U.fluid.z*cross(N,wi);
    dv+=U.fluid.x*confinement;
  }
  dv=clampLen(dv,max(U.fluid.w,0.001));
  var nv=vel[i].xyz+dv;
  nv=clampLen(nv,max(U.tuning.x,0.5));
  vel[i]=vec4f(nv,0.0);
}
`;

const mod=dev.createShaderModule({code:shader,label:'fluidV5M800CoreWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.0 core WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const measurePipe=await dev.createComputePipelineAsync({label:'fluidV5M800Measure',layout:'auto',compute:{module:mod,entryPoint:'measure'}});
const applyPipe=await dev.createComputePipelineAsync({label:'fluidV5M800Apply',layout:'auto',compute:{module:mod,entryPoint:'applyCore'}});
const uni=dev.createBuffer({label:'fluidV5M800Uniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const cap=Math.max(sim.cap||sim.n||1,sim.n||1);
const radial=dev.createBuffer({label:'fluidV5M800Radial',size:Math.max(16,cap*16),usage:GPUBufferUsage.STORAGE});
const omegaBuf=dev.createBuffer({label:'fluidV5M800Omega',size:Math.max(16,cap*16),usage:GPUBufferUsage.STORAGE});
const F=new Float32Array(16),U32=new Uint32Array(F.buffer);
let passes=0,frames=0,inStep=false;

function encodeCore(enc){
  if(!sim.n||!sim.buf?.cellStart)return false;
  applyWaterModel();
  const b=sim.params.box,h=sim.h||sim.params.spacing*2;
  const dt=Math.min(1/30,Math.max(1/300,sim.lastAdvanced||1/60));
  F.fill(0);F[0]=b[0];F[1]=b[1];F[2]=b[2];F[3]=h;
  F[4]=dt;F[5]=water.projection;F[6]=water.vorticity;F[7]=water.maxCorrection;
  F[8]=water.maxSpeed;F[9]=performance.now()*.001;
  U32[12]=sim.gridDim?.[0]||1;U32[13]=sim.gridDim?.[1]||1;U32[14]=sim.gridDim?.[2]||1;U32[15]=sim.n;
  dev.queue.writeBuffer(uni,0,F);
  const pos=sim.livePos?.(),vel=sim.liveVel?.();if(!pos||!vel)return false;
  const entries=[
    {binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},
    {binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:sim.buf.cellStart}},
    {binding:4,resource:{buffer:radial}},{binding:5,resource:{buffer:omegaBuf}},
  ];
  const bgM=dev.createBindGroup({layout:measurePipe.getBindGroupLayout(0),entries});
  const bgA=dev.createBindGroup({layout:applyPipe.getBindGroupLayout(0),entries});
  let p=enc.beginComputePass({label:'fluidV5M800MeasurePass'});p.setPipeline(measurePipe);p.setBindGroup(0,bgM);p.dispatchWorkgroups(Math.ceil(sim.n/256));p.end();
  p=enc.beginComputePass({label:'fluidV5M800ProjectionVorticityPass'});p.setPipeline(applyPipe);p.setBindGroup(0,bgA);p.dispatchWorkgroups(Math.ceil(sim.n/256));p.end();
  passes+=2;frames++;return true;
}

// M7.3.9 returns a proxy encoder whose finish() is intentionally held until rendering.
// Wrap that proxy and append M8's global physics passes immediately before the held finish,
// keeping simulation + M8 correction + rendering in ONE real GPUCommandBuffer.
const prevCreate=dev.createCommandEncoder.bind(dev);
dev.createCommandEncoder=function(desc){
  const enc=prevCreate(desc);
  if(!inStep)return enc;
  let appended=false;
  return new Proxy(enc,{
    get(target,prop){
      if(prop==='finish')return(...args)=>{
        if(!appended){appended=true;try{encodeCore(target)}catch(err){console.error('[M8.0 core]',err);}}
        return target.finish(...args);
      };
      const value=Reflect.get(target,prop,target);
      return typeof value==='function'?value.bind(target):value;
    }
  });
};
const prevStep=sim.step.bind(sim);
sim.step=function(frameDt){inStep=true;try{return prevStep(frameDt)}finally{inStep=false}};

// Replace the old generic PBF section with M8's single-water controls.
const tabbar=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
let physicsPage=null,status=null;
if(tabbar&&host){const tabs=[...tabbar.children],idx=tabs.findIndex(b=>b.dataset.key==='physics');if(idx>=0)physicsPage=host.children[idx]||null;}
function row(parent,label,key,min,max,step,fmt=v=>Number(v).toFixed(3)){
  const r=document.createElement('div');r.className='m742Row';const l=document.createElement('label');l.textContent=label;
  const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=water[key];
  const val=document.createElement('div');val.className='m742Val';
  const sync=()=>{input.value=water[key];val.textContent=fmt(water[key])};sync();
  input.oninput=e=>{e.stopPropagation();water[key]=Number(input.value);applyWaterModel();sync();updateStatus()};
  r.append(l,input,val);parent.appendChild(r);return input;
}
function updateStatus(){
  if(!status)return;
  status.textContent=`M8.0 COMMON WATER CORE\nall scenes share the same solver parameters\nPBF density iterations ${water.iterations} · substeps ${water.substeps}\nradial velocity projection ${water.projection.toFixed(3)} · vorticity confinement ${water.vorticity.toFixed(3)}\nXSPH ${water.xsph.toFixed(3)} · surface tension ${water.tension.toFixed(3)}\nM8 passes ${passes.toLocaleString()} · frames ${frames.toLocaleString()} · extra queue submits 0`;
}
if(physicsPage){
  physicsPage.innerHTML='<div class="m742Intro">M8.0 removes scene-specific water equations. These controls change the ONE water model used by Pool, Dam Break and every future inlet/outlet scene.</div>';
  const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">COMMON WATER MODEL · M8.0</div>';
  row(sec,'PROJECTION','projection',0,.38,.01,v=>Number(v).toFixed(2));
  row(sec,'VORTICITY','vorticity',0,.60,.02,v=>Number(v).toFixed(2));
  row(sec,'XSPH VISC','xsph',0,.08,.002,v=>Number(v).toFixed(3));
  row(sec,'TENSION','tension',0,.50,.01,v=>Number(v).toFixed(2));
  row(sec,'S-CORR','scorr',0,.16,.005,v=>Number(v).toFixed(3));
  row(sec,'SUBSTEPS','substeps',2,5,1,v=>String(Math.round(v)));
  row(sec,'DENSITY ITER','iterations',3,7,1,v=>String(Math.round(v)));
  const note=document.createElement('div');note.className='m742Note';note.textContent='PROJECTION damps local velocity divergence/compression along particle-neighbor normals. VORTICITY globally restores rotational energy lost to numerical damping. Neither setting knows which scene is active.';sec.appendChild(note);
  physicsPage.appendChild(sec);status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';physicsPage.appendChild(status);setInterval(updateStatus,500);updateStatus();
}

window.__v5M800FluidCore={online:true,backend:'global-pbf-velocity-projection-vorticity-m800',gpuPassesPerPhysicsFrame:2,gpuSubmitsAdded:0,water,get passes(){return passes},get frames(){return frames}};
window.__fluidV5Version='8.0.0';window.__fluidV5Build='M8.0 COMMON WATER PHYSICS / M7.3.9 ONE-SUBMIT SCHEDULER';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V5 · M8.0';document.title='Fluid V5 · M8.0 Common Water Physics';
console.info('[Fluid V5 M8.0] common water core online: global velocity projection + vorticity, zero added submits.');
