// Fluid V5 M8.1 — common incompressible-water refinement.
// One solver for every scene. No scene-specific forces live here.
// Compared with M8.0, the velocity projection now measures an SPH-style local
// compression/divergence and applies a pressure-like neighbour correction before
// global vorticity confinement. Everything is encoded into the existing unified
// GPU command buffer: no additional queue.submit() call is created.

const sim=window.__sim, ui=window.__ui;
if(!sim?.dev||!ui||!window.__v5M739Unified?.online)
  throw new Error('M8.1 fluid core: unified PBF runtime unavailable.');
const dev=sim.dev;

const water={
  divergence:0.34,
  divIterations:1,
  vorticity:0.20,
  maxCorrection:0.18,
  maxSpeed:9.0,
  xsph:0.012,
  tension:0.16,
  scorr:0.045,
  substeps:3,
  iterations:5,
};
function applyWaterModel(){
  const p=sim.params;if(!p)return;
  p.xsphC=water.xsph;
  p.surfaceTensionK=water.tension;
  p.sCorrK=water.scorr;
  p.substeps=Math.max(1,Math.round(water.substeps));
  p.iterations=Math.max(1,Math.round(water.iterations));
}
applyWaterModel();

const shader=`
struct CoreU {
  box:vec4f,       // xyz box, w support radius
  fluid:vec4f,     // dt, divergence gain, vorticity, max correction
  tuning:vec4f,    // max speed, time, spare, spare
  grid:vec4u,      // xyz grid dims, w particle count
}
@group(0) @binding(0) var<uniform> U:CoreU;
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
@group(0) @binding(3) var<storage,read> cellStart:array<u32>;
@group(0) @binding(4) var<storage,read_write> divState:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> omegaBuf:array<vec4f>;

fn cellOf(p:vec3f)->vec3i{
  let h=max(U.box.w,1.0e-5);
  return clamp(vec3i(floor(p/h)),vec3i(0),vec3i(U.grid.xyz)-vec3i(1));
}
fn cellIndex(c:vec3i)->u32{return u32((c.z*i32(U.grid.y)+c.y)*i32(U.grid.x)+c.x);}
fn clampLen(v:vec3f,m:f32)->vec3f{
  let l=length(v);return select(v,v*(m/max(l,1.0e-8)),l>m);
}
fn gradMag(r:f32,h:f32)->f32{
  let q=max(0.0,1.0-r/max(h,1.0e-5));
  return q*q/max(h,1.0e-5);
}

// Positive divState.x means local COMPRESSION. Expansion at a free surface is not
// forced back inward; this is important for splashes and ballistic sheets.
@compute @workgroup_size(256)
fn measure(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.grid.w){return;}
  let pi=pos[i].xyz;let vi=vel[i].xyz;let h=max(U.box.w,1.0e-5);let c=cellOf(pi);
  var compression=0.0;var diag=0.0;var curl=vec3f(0.0);var neighbours=0.0;
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
          let r=sqrt(r2);let dir=q/r;let g=gradMag(r,h);let rel=vel[j].xyz-vi;
          compression+=max(0.0,-dot(rel,dir))*g;
          diag+=g*g;
          curl+=cross(rel,dir*g);
          neighbours+=1.0;
        }
      }
    }
  }
  let invDiag=1.0/max(diag,1.0e-5);
  divState[i]=vec4f(compression,invDiag,neighbours,0.0);
  omegaBuf[i]=vec4f(curl,length(curl));
}

// Jacobi-like velocity projection. Dense liquid receives the full correction;
// low-neighbour free-surface particles are progressively released so spray does not
// get pulled into artificial clumps.
@compute @workgroup_size(256)
fn project(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.grid.w){return;}
  let pi=pos[i].xyz;let h=max(U.box.w,1.0e-5);let c=cellOf(pi);
  let si=divState[i];let surfaceI=smoothstep(5.0,15.0,si.z);
  let ki=si.x*si.y*U.fluid.y*surfaceI;
  var dv=vec3f(0.0);
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
          let r=sqrt(r2);let dir=q/r;let g=gradMag(r,h);let sj=divState[j];
          let surfaceJ=smoothstep(5.0,15.0,sj.z);
          let kj=sj.x*sj.y*U.fluid.y*surfaceJ;
          dv-=(ki+kj)*0.5*g*dir;
        }
      }
    }
  }
  dv=clampLen(dv,max(U.fluid.w,0.001));
  vel[i]=vec4f(clampLen(vel[i].xyz+dv,max(U.tuning.x,0.5)),0.0);
}

// Vorticity confinement is global and scene-agnostic. It only restores rotational
// energy that numerical viscosity/projection removes; it does not create a whirlpool.
@compute @workgroup_size(256)
fn vorticityPass(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.grid.w){return;}
  let pi=pos[i].xyz;let h=max(U.box.w,1.0e-5);let c=cellOf(pi);
  let wi=omegaBuf[i].xyz;let mi=omegaBuf[i].w;var grad=vec3f(0.0);var ws=0.0;
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
          let r=sqrt(r2);let dir=q/r;let g=gradMag(r,h);
          grad+=(omegaBuf[j].w-mi)*dir*g;ws+=g;
        }
      }
    }
  }
  if(ws>1.0e-6){grad/=ws;}
  let gl=length(grad);
  var dv=vec3f(0.0);
  if(gl>1.0e-5&&mi>1.0e-5){dv=U.fluid.x*U.fluid.z*cross(grad/gl,wi);}
  dv=clampLen(dv,max(U.fluid.w*0.75,0.001));
  vel[i]=vec4f(clampLen(vel[i].xyz+dv,max(U.tuning.x,0.5)),0.0);
}
`;

const mod=dev.createShaderModule({code:shader,label:'fluidV5M810CoreWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.1 core WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const measurePipe=await dev.createComputePipelineAsync({label:'fluidV5M810Measure',layout:'auto',compute:{module:mod,entryPoint:'measure'}});
const projectPipe=await dev.createComputePipelineAsync({label:'fluidV5M810Project',layout:'auto',compute:{module:mod,entryPoint:'project'}});
const vortPipe=await dev.createComputePipelineAsync({label:'fluidV5M810Vorticity',layout:'auto',compute:{module:mod,entryPoint:'vorticityPass'}});
const uni=dev.createBuffer({label:'fluidV5M810Uniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const cap=Math.max(sim.cap||sim.n||1,sim.n||1);
const divState=dev.createBuffer({label:'fluidV5M810Divergence',size:Math.max(16,cap*16),usage:GPUBufferUsage.STORAGE});
const omegaBuf=dev.createBuffer({label:'fluidV5M810Omega',size:Math.max(16,cap*16),usage:GPUBufferUsage.STORAGE});
const F=new Float32Array(16),U32=new Uint32Array(F.buffer);
let passes=0,frames=0,inStep=false;

function encodeCore(enc){
  if(!sim.n||!sim.buf?.cellStart)return false;applyWaterModel();
  const b=sim.params.box,h=sim.h||sim.params.spacing*2;
  const dt=Math.min(1/30,Math.max(1/300,sim.lastAdvanced||1/60));
  F.fill(0);F[0]=b[0];F[1]=b[1];F[2]=b[2];F[3]=h;
  F[4]=dt;F[5]=water.divergence;F[6]=water.vorticity;F[7]=water.maxCorrection;
  F[8]=water.maxSpeed;F[9]=performance.now()*.001;
  U32[12]=sim.gridDim?.[0]||1;U32[13]=sim.gridDim?.[1]||1;U32[14]=sim.gridDim?.[2]||1;U32[15]=sim.n;
  dev.queue.writeBuffer(uni,0,F);
  const pos=sim.livePos?.(),vel=sim.liveVel?.();if(!pos||!vel)return false;
  const entries=[{binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:sim.buf.cellStart}},{binding:4,resource:{buffer:divState}},{binding:5,resource:{buffer:omegaBuf}}];
  const bgM=dev.createBindGroup({layout:measurePipe.getBindGroupLayout(0),entries});
  const bgP=dev.createBindGroup({layout:projectPipe.getBindGroupLayout(0),entries});
  const bgV=dev.createBindGroup({layout:vortPipe.getBindGroupLayout(0),entries});
  const work=Math.ceil(sim.n/256);let p;
  const its=Math.max(1,Math.min(2,Math.round(water.divIterations)));
  for(let k=0;k<its;k++){
    p=enc.beginComputePass({label:'fluidV5M810MeasurePass'});p.setPipeline(measurePipe);p.setBindGroup(0,bgM);p.dispatchWorkgroups(work);p.end();
    p=enc.beginComputePass({label:'fluidV5M810ProjectPass'});p.setPipeline(projectPipe);p.setBindGroup(0,bgP);p.dispatchWorkgroups(work);p.end();passes+=2;
  }
  p=enc.beginComputePass({label:'fluidV5M810VorticityPass'});p.setPipeline(vortPipe);p.setBindGroup(0,bgV);p.dispatchWorkgroups(work);p.end();passes++;frames++;return true;
}

const prevCreate=dev.createCommandEncoder.bind(dev);
dev.createCommandEncoder=function(desc){
  const enc=prevCreate(desc);if(!inStep)return enc;let appended=false;
  return new Proxy(enc,{get(target,prop){
    if(prop==='finish')return(...args)=>{if(!appended){appended=true;try{encodeCore(target)}catch(err){console.error('[M8.1 core]',err);}}return target.finish(...args)};
    const value=Reflect.get(target,prop,target);return typeof value==='function'?value.bind(target):value;
  }});
};
const prevStep=sim.step.bind(sim);sim.step=function(frameDt){inStep=true;try{return prevStep(frameDt)}finally{inStep=false}};

const tabbar=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');let page=null,status=null;
if(tabbar&&host){const tabs=[...tabbar.children],idx=tabs.findIndex(b=>b.dataset.key==='physics');if(idx>=0)page=host.children[idx]||null;}
function row(parent,label,key,min,max,step,fmt=v=>Number(v).toFixed(3)){
  const r=document.createElement('div');r.className='m742Row';const l=document.createElement('label');l.textContent=label;
  const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=water[key];const val=document.createElement('div');val.className='m742Val';
  const sync=()=>{input.value=water[key];val.textContent=fmt(water[key])};sync();input.oninput=e=>{e.stopPropagation();water[key]=Number(input.value);applyWaterModel();sync();updateStatus()};r.append(l,input,val);parent.appendChild(r);
}
function updateStatus(){if(status)status.textContent=`M8.1 COMMON WATER\nSPH-style compression projection ${water.divergence.toFixed(2)} · projection iterations ${Math.round(water.divIterations)}\nvorticity ${water.vorticity.toFixed(2)} · XSPH ${water.xsph.toFixed(3)} · tension ${water.tension.toFixed(2)}\nPBF density iterations ${Math.round(water.iterations)} · substeps ${Math.round(water.substeps)}\nM8.1 passes ${passes.toLocaleString()} · frames ${frames.toLocaleString()} · extra queue submits 0`;}
if(page){
  page.innerHTML='<div class="m742Intro">One water model for every experiment. M8.1 projects local compressive velocity before globally restoring rotational energy.</div>';
  const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">INCOMPRESSIBLE WATER · M8.1</div>';
  row(sec,'DIVERGENCE','divergence',0,.65,.01,v=>Number(v).toFixed(2));row(sec,'DIV ITER','divIterations',1,2,1,v=>String(Math.round(v)));row(sec,'VORTICITY','vorticity',0,.5,.01,v=>Number(v).toFixed(2));row(sec,'XSPH VISC','xsph',0,.05,.001,v=>Number(v).toFixed(3));row(sec,'TENSION','tension',0,.4,.01,v=>Number(v).toFixed(2));row(sec,'S-CORR','scorr',0,.12,.005,v=>Number(v).toFixed(3));row(sec,'SUBSTEPS','substeps',2,5,1,v=>String(Math.round(v)));row(sec,'DENSITY ITER','iterations',3,7,1,v=>String(Math.round(v)));
  const note=document.createElement('div');note.className='m742Note';note.textContent='Free-surface expansion is left unconstrained; only local compression is projected. This helps splashes remain free while dense water behaves less compressibly.';sec.appendChild(note);page.appendChild(sec);status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';page.appendChild(status);setInterval(updateStatus,500);updateStatus();
}

window.__v5M810FluidCore={online:true,backend:'compression-divergence-projection-vorticity-m810',gpuSubmitsAdded:0,water,get passes(){return passes},get frames(){return frames}};
window.__fluidV5Version='8.1.0';
console.info('[Fluid V5 M8.1] common compression projection + global vorticity online; no scene-specific fluid equations.');