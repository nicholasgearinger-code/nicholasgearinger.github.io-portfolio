// Fluid V5 M8.2 — iterative divergence-pressure refinement + adaptive CFL.
// One global water model for every scene. No scene-specific forces live here.
// The divergence solve is Jacobi-like and repeated inside the existing shared GPU command buffer.
// A tiny max-speed reduction is copied into rotating readback buffers only after the unified
// frame is submitted, allowing the NEXT frame's substep count to follow a CFL-style limit.
// No extra queue.submit() call is created.

const sim=window.__sim,ui=window.__ui;
if(!sim?.dev||!ui||!window.__v5M739Unified?.online) throw new Error('M8.2 fluid core: unified runtime unavailable.');
const dev=sim.dev,queue=dev.queue;

const water={
  divergence:0.48,
  divIterations:2,
  vorticity:0.18,
  maxCorrection:0.16,
  maxSpeed:9.0,
  xsph:0.010,
  tension:0.15,
  scorr:0.040,
  densityIterations:5,
  adaptiveCFL:true,
  cflSafety:0.40,
  minSubsteps:2,
  maxSubsteps:6,
  substeps:3,
  measuredMaxSpeed:1.0,
  cflDt:1/120,
};
function applyWaterModel(){
  const p=sim.params;if(!p)return;
  p.xsphC=water.xsph;
  p.surfaceTensionK=water.tension;
  p.sCorrK=water.scorr;
  p.substeps=Math.max(1,Math.round(water.substeps));
  p.iterations=Math.max(1,Math.round(water.densityIterations));
}
function updateCFL(frameDt){
  if(!water.adaptiveCFL){applyWaterModel();return;}
  const spacing=Math.max(0.008,Number(sim.params?.spacing)||0.044);
  const vmax=Math.max(0.20,water.measuredMaxSpeed||0.20);
  water.cflDt=water.cflSafety*spacing/vmax;
  const safeFrame=Math.min(1/30,Math.max(1/240,Number(frameDt)||1/60));
  const target=Math.ceil(safeFrame/Math.max(1/600,water.cflDt));
  water.substeps=Math.max(water.minSubsteps,Math.min(water.maxSubsteps,target));
  applyWaterModel();
}
applyWaterModel();

const shader=`
struct CoreU{
  box:vec4f,
  fluid:vec4f,   // dt, divergence gain, vorticity, max correction
  tuning:vec4f,  // max speed, time, spacing, cfl safety
  grid:vec4u,
}
@group(0) @binding(0) var<uniform> U:CoreU;
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
@group(0) @binding(3) var<storage,read> cellStart:array<u32>;
@group(0) @binding(4) var<storage,read_write> divState:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> omegaBuf:array<vec4f>;
@group(0) @binding(6) var<storage,read_write> maxSpeedBits:array<atomic<u32>>;

fn cellOf(p:vec3f)->vec3i{
  let h=max(U.box.w,1.0e-5);
  return clamp(vec3i(floor(p/h)),vec3i(0),vec3i(U.grid.xyz)-vec3i(1));
}
fn cellIndex(c:vec3i)->u32{return u32((c.z*i32(U.grid.y)+c.y)*i32(U.grid.x)+c.x);}
fn clampLen(v:vec3f,m:f32)->vec3f{let l=length(v);return select(v,v*(m/max(l,1.0e-8)),l>m);}
fn gradMag(r:f32,h:f32)->f32{let q=max(0.0,1.0-r/max(h,1.0e-5));return q*q/max(h,1.0e-5);}

@compute @workgroup_size(256)
fn measureDiv(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.grid.w){return;}
  let pi=pos[i].xyz;let vi=vel[i].xyz;let h=max(U.box.w,1.0e-5);let c=cellOf(pi);
  var compression=0.0;var diag=0.0;var neighbours=0.0;
  for(var dz=-1;dz<=1;dz++){
    let z=c.z+dz;if(z<0||z>=i32(U.grid.z)){continue;}
    for(var dy=-1;dy<=1;dy++){
      let y=c.y+dy;if(y<0||y>=i32(U.grid.y)){continue;}
      for(var dx=-1;dx<=1;dx++){
        let x=c.x+dx;if(x<0||x>=i32(U.grid.x)){continue;}
        let ci=cellIndex(vec3i(x,y,z));let b=cellStart[ci];let e=cellStart[ci+1u];
        for(var j=b;j<e;j++){
          if(j==i){continue;}
          let q=pos[j].xyz-pi;let r2=dot(q,q);if(r2<=1.0e-12||r2>=h*h){continue;}
          let r=sqrt(r2);let dir=q/r;let g=gradMag(r,h);let rel=vel[j].xyz-vi;
          compression+=max(0.0,-dot(rel,dir))*g;
          diag+=g*g;neighbours+=1.0;
        }
      }
    }
  }
  let dense=smoothstep(5.0,15.0,neighbours);
  let factor=compression/max(diag,1.0e-5)*dense;
  divState[i]=vec4f(factor,compression,neighbours,0.0);
  atomicMax(&maxSpeedBits[0],bitcast<u32>(min(length(vi),U.tuning.x)));
}

@compute @workgroup_size(256)
fn solveDiv(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.grid.w){return;}
  let pi=pos[i].xyz;let h=max(U.box.w,1.0e-5);let c=cellOf(pi);let ki=divState[i].x;
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
          let q=pos[j].xyz-pi;let r2=dot(q,q);if(r2<=1.0e-12||r2>=h*h){continue;}
          let r=sqrt(r2);let dir=q/r;let g=gradMag(r,h);let kj=divState[j].x;
          dv-=(ki+kj)*0.5*g*dir;
        }
      }
    }
  }
  dv=clampLen(dv*U.fluid.y,max(U.fluid.w,0.001));
  vel[i]=vec4f(clampLen(vel[i].xyz+dv,max(U.tuning.x,0.5)),0.0);
}

@compute @workgroup_size(256)
fn measureVort(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.grid.w){return;}
  let pi=pos[i].xyz;let vi=vel[i].xyz;let h=max(U.box.w,1.0e-5);let c=cellOf(pi);var curl=vec3f(0.0);
  for(var dz=-1;dz<=1;dz++){
    let z=c.z+dz;if(z<0||z>=i32(U.grid.z)){continue;}
    for(var dy=-1;dy<=1;dy++){
      let y=c.y+dy;if(y<0||y>=i32(U.grid.y)){continue;}
      for(var dx=-1;dx<=1;dx++){
        let x=c.x+dx;if(x<0||x>=i32(U.grid.x)){continue;}
        let ci=cellIndex(vec3i(x,y,z));let b=cellStart[ci];let e=cellStart[ci+1u];
        for(var j=b;j<e;j++){
          if(j==i){continue;}
          let q=pos[j].xyz-pi;let r2=dot(q,q);if(r2<=1.0e-12||r2>=h*h){continue;}
          let r=sqrt(r2);let dir=q/r;let g=gradMag(r,h);curl+=cross(vel[j].xyz-vi,dir*g);
        }
      }
    }
  }
  omegaBuf[i]=vec4f(curl,length(curl));
  atomicMax(&maxSpeedBits[0],bitcast<u32>(min(length(vi),U.tuning.x)));
}

@compute @workgroup_size(256)
fn applyVort(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.grid.w){return;}
  let pi=pos[i].xyz;let h=max(U.box.w,1.0e-5);let c=cellOf(pi);let wi=omegaBuf[i].xyz;let mi=omegaBuf[i].w;
  var grad=vec3f(0.0);var ws=0.0;
  for(var dz=-1;dz<=1;dz++){
    let z=c.z+dz;if(z<0||z>=i32(U.grid.z)){continue;}
    for(var dy=-1;dy<=1;dy++){
      let y=c.y+dy;if(y<0||y>=i32(U.grid.y)){continue;}
      for(var dx=-1;dx<=1;dx++){
        let x=c.x+dx;if(x<0||x>=i32(U.grid.x)){continue;}
        let ci=cellIndex(vec3i(x,y,z));let b=cellStart[ci];let e=cellStart[ci+1u];
        for(var j=b;j<e;j++){
          if(j==i){continue;}
          let q=pos[j].xyz-pi;let r2=dot(q,q);if(r2<=1.0e-12||r2>=h*h){continue;}
          let r=sqrt(r2);let dir=q/r;let g=gradMag(r,h);grad+=(omegaBuf[j].w-mi)*dir*g;ws+=g;
        }
      }
    }
  }
  if(ws>1.0e-6){grad/=ws;}
  var dv=vec3f(0.0);let gl=length(grad);
  if(gl>1.0e-5&&mi>1.0e-5){dv=U.fluid.x*U.fluid.z*cross(grad/gl,wi);}
  dv=clampLen(dv,max(U.fluid.w*0.65,0.001));
  vel[i]=vec4f(clampLen(vel[i].xyz+dv,max(U.tuning.x,0.5)),0.0);
}
`;

const mod=dev.createShaderModule({code:shader,label:'fluidV5M820CoreWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.2 core WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const measureDivPipe=await dev.createComputePipelineAsync({label:'fluidV5M820MeasureDiv',layout:'auto',compute:{module:mod,entryPoint:'measureDiv'}});
const solveDivPipe=await dev.createComputePipelineAsync({label:'fluidV5M820SolveDiv',layout:'auto',compute:{module:mod,entryPoint:'solveDiv'}});
const measureVortPipe=await dev.createComputePipelineAsync({label:'fluidV5M820MeasureVort',layout:'auto',compute:{module:mod,entryPoint:'measureVort'}});
const applyVortPipe=await dev.createComputePipelineAsync({label:'fluidV5M820ApplyVort',layout:'auto',compute:{module:mod,entryPoint:'applyVort'}});
const uni=dev.createBuffer({label:'fluidV5M820Uniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const cap=Math.max(sim.cap||sim.n||1,sim.n||1);
const divState=dev.createBuffer({label:'fluidV5M820DivState',size:Math.max(16,cap*16),usage:GPUBufferUsage.STORAGE});
const omegaBuf=dev.createBuffer({label:'fluidV5M820Omega',size:Math.max(16,cap*16),usage:GPUBufferUsage.STORAGE});
const vmaxBuf=dev.createBuffer({label:'fluidV5M820MaxSpeed',size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
const readbacks=Array.from({length:3},(_,i)=>({buf:dev.createBuffer({label:`fluidV5M820SpeedRead${i}`,size:16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),busy:false}));
const pending=[];const F=new Float32Array(16),U32=new Uint32Array(F.buffer);
let passes=0,frames=0,inStep=false,lastFrameDt=1/60,speedEMA=1.0;

function bg(layout,entries){return dev.createBindGroup({layout,entries});}
function encodeCore(enc){
  if(!sim.n||!sim.buf?.cellStart)return false;applyWaterModel();
  const b=sim.params.box,h=sim.h||sim.params.spacing*2,dt=Math.min(1/30,Math.max(1/300,lastFrameDt/Math.max(1,water.substeps)));
  F.fill(0);F[0]=b[0];F[1]=b[1];F[2]=b[2];F[3]=h;F[4]=dt;F[5]=water.divergence;F[6]=water.vorticity;F[7]=water.maxCorrection;F[8]=water.maxSpeed;F[9]=performance.now()*.001;F[10]=Number(sim.params.spacing)||0.044;F[11]=water.cflSafety;U32[12]=sim.gridDim?.[0]||1;U32[13]=sim.gridDim?.[1]||1;U32[14]=sim.gridDim?.[2]||1;U32[15]=sim.n;dev.queue.writeBuffer(uni,0,F);
  const pos=sim.livePos?.(),vel=sim.liveVel?.();if(!pos||!vel)return false;
  enc.clearBuffer(vmaxBuf);
  const common=[{binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:sim.buf.cellStart}}];
  const bgMD=bg(measureDivPipe.getBindGroupLayout(0),[...common,{binding:4,resource:{buffer:divState}},{binding:6,resource:{buffer:vmaxBuf}}]);
  const bgSD=bg(solveDivPipe.getBindGroupLayout(0),[...common,{binding:4,resource:{buffer:divState}}]);
  const bgMV=bg(measureVortPipe.getBindGroupLayout(0),[...common,{binding:5,resource:{buffer:omegaBuf}},{binding:6,resource:{buffer:vmaxBuf}}]);
  const bgAV=bg(applyVortPipe.getBindGroupLayout(0),[...common,{binding:5,resource:{buffer:omegaBuf}}]);
  const work=Math.ceil(sim.n/256),its=Math.max(1,Math.min(4,Math.round(water.divIterations)));let p;
  for(let k=0;k<its;k++){
    p=enc.beginComputePass({label:'fluidV5M820MeasureDiv'});p.setPipeline(measureDivPipe);p.setBindGroup(0,bgMD);p.dispatchWorkgroups(work);p.end();
    p=enc.beginComputePass({label:'fluidV5M820SolveDiv'});p.setPipeline(solveDivPipe);p.setBindGroup(0,bgSD);p.dispatchWorkgroups(work);p.end();passes+=2;
  }
  p=enc.beginComputePass({label:'fluidV5M820MeasureVort'});p.setPipeline(measureVortPipe);p.setBindGroup(0,bgMV);p.dispatchWorkgroups(work);p.end();
  p=enc.beginComputePass({label:'fluidV5M820ApplyVort'});p.setPipeline(applyVortPipe);p.setBindGroup(0,bgAV);p.dispatchWorkgroups(work);p.end();passes+=2;frames++;
  if(frames%8===0){const slot=readbacks.find(x=>!x.busy);if(slot){slot.busy=true;enc.copyBufferToBuffer(vmaxBuf,0,slot.buf,0,4);pending.push(slot);}}
  return true;
}

const prevCreate=dev.createCommandEncoder.bind(dev);
dev.createCommandEncoder=function(desc){const enc=prevCreate(desc);if(!inStep)return enc;let appended=false;return new Proxy(enc,{get(target,prop){if(prop==='finish')return(...args)=>{if(!appended){appended=true;try{encodeCore(target)}catch(err){console.error('[M8.2 core]',err);}}return target.finish(...args)};const value=Reflect.get(target,prop,target);return typeof value==='function'?value.bind(target):value;}})};

const prevSubmit=queue.submit.bind(queue);const unified=window.__v5M739Unified;
try{Object.defineProperty(queue,'submit',{configurable:true,writable:true,value:function(list){const before=unified.submitted;const out=prevSubmit(list);if(unified.submitted>before&&pending.length){const batch=pending.splice(0);queue.onSubmittedWorkDone().then(async()=>{for(const slot of batch){try{await slot.buf.mapAsync(GPUMapMode.READ);const value=new DataView(slot.buf.getMappedRange()).getFloat32(0,true);slot.buf.unmap();if(Number.isFinite(value)&&value>=0){speedEMA=speedEMA*0.72+value*0.28;water.measuredMaxSpeed=speedEMA;}}catch(e){try{slot.buf.unmap()}catch{}}finally{slot.busy=false;}}}).catch(()=>{for(const slot of batch)slot.busy=false;});}return out;}});}catch(err){console.warn('[M8.2 CFL] submit telemetry hook unavailable',err);}

const prevStep=sim.step.bind(sim);sim.step=function(frameDt){lastFrameDt=Number(frameDt)||1/60;updateCFL(lastFrameDt);inStep=true;try{return prevStep(frameDt)}finally{inStep=false}};

const tabbar=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');let page=null,status=null;
if(tabbar&&host){const tabs=[...tabbar.children],idx=tabs.findIndex(b=>b.dataset.key==='physics');if(idx>=0)page=host.children[idx]||null;}
function row(parent,label,key,min,max,step,fmt=v=>Number(v).toFixed(2)){const r=document.createElement('div');r.className='m742Row';const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=water[key];const val=document.createElement('div');val.className='m742Val';const sync=()=>{input.value=water[key];val.textContent=fmt(water[key])};sync();input.oninput=e=>{e.stopPropagation();water[key]=Number(input.value);sync();updateCFL(lastFrameDt);updateStatus()};r.append(l,input,val);parent.appendChild(r);return input;}
function updateStatus(){if(status)status.textContent=`M8.2 COMMON WATER\niterative divergence solve ${water.divergence.toFixed(2)} × ${Math.round(water.divIterations)}\nvorticity ${water.vorticity.toFixed(2)} · XSPH ${water.xsph.toFixed(3)} · tension ${water.tension.toFixed(2)}\nCFL ${water.adaptiveCFL?'ON':'OFF'} · measured vmax ${water.measuredMaxSpeed.toFixed(2)} m/s · CFL dt ${(water.cflDt*1000).toFixed(1)} ms\nauto substeps ${Math.round(water.substeps)} · density iterations ${Math.round(water.densityIterations)}\nphysics passes ${passes.toLocaleString()} · frames ${frames.toLocaleString()} · added submits 0`;}
if(page){page.innerHTML='<div class="m742Intro">M8.2 repeats the velocity-divergence pressure projection until dense water is less compressible, then applies global vorticity. Adaptive CFL changes substeps from measured fluid speed, not from the active scene.</div>';const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">INCOMPRESSIBLE WATER · M8.2</div>';row(sec,'DIV PRESSURE','divergence',0,.85,.01);row(sec,'DIV ITER','divIterations',1,4,1,v=>String(Math.round(v)));row(sec,'VORTICITY','vorticity',0,.5,.01);row(sec,'XSPH VISC','xsph',0,.05,.001,v=>Number(v).toFixed(3));row(sec,'TENSION','tension',0,.45,.01);row(sec,'DENSITY ITER','densityIterations',3,8,1,v=>String(Math.round(v)));row(sec,'CFL SAFETY','cflSafety',.20,.55,.01);row(sec,'MAX SUBSTEPS','maxSubsteps',3,8,1,v=>String(Math.round(v)));const grid=document.createElement('div');grid.className='m742Grid';const cfl=document.createElement('button');cfl.className='m742Btn active';cfl.textContent='ADAPTIVE CFL: ON';cfl.onclick=()=>{water.adaptiveCFL=!water.adaptiveCFL;cfl.textContent=`ADAPTIVE CFL: ${water.adaptiveCFL?'ON':'OFF'}`;cfl.classList.toggle('active',water.adaptiveCFL);updateStatus()};grid.appendChild(cfl);sec.appendChild(grid);page.appendChild(sec);status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';page.appendChild(status);setInterval(updateStatus,500);updateStatus();}

window.__v5M820FluidCore={online:true,backend:'iterative-divergence-pressure-plus-adaptive-cfl-m820',gpuSubmitsAdded:0,water,get passes(){return passes},get frames(){return frames}};
window.__fluidV5Version='8.2.0';
console.info('[Fluid V5 M8.2] iterative divergence projection + post-submit CFL telemetry online; zero added queue submits.');
