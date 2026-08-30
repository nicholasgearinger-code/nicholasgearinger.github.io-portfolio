// Fluid V5 M7.4.3 — first scene restore on the proven M7.3.9 unified scheduler.
// Adds NO queue.submit calls. Pool and Dam Break are seeded inside the SAME GPUCommandEncoder
// already used by the next PBF + SSFR frame. Continuous/source scenes remain locked for now.

const sim=window.__sim, ui=window.__ui;
if(!sim?.dev||!ui||!window.__v5M739Unified?.online) throw new Error('M7.4.3 scenes: unified M7.3.9 runtime unavailable.');
const dev=sim.dev;

// --- scene seed compute ----------------------------------------------------
const shader=`
struct Seed {
  box:vec3f,
  spacing:f32,
  dims:vec3u,
  nFluid:u32,
  margin:f32,
  jitter:f32,
  mode:u32,
  pad:u32,
}
@group(0) @binding(0) var<uniform> U:Seed;
@group(0) @binding(1) var<storage,read_write> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> pred:array<vec4f>;
fn hash11(x:u32)->f32 {
  var h=x*747796405u+2891336453u;
  h=((h>>((h>>28u)+4u))^h)*277803737u;
  h=(h>>22u)^h;
  return f32(h & 0x00ffffffu)/16777215.0;
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.nFluid){return;}
  let nx=max(U.dims.x,1u), nz=max(U.dims.z,1u), layer=nx*nz;
  let ix=i%nx, iz=(i/nx)%nz, iy=i/layer;
  let jx=(hash11(i*3u+1u)-.5)*U.jitter;
  let jy=(hash11(i*3u+2u)-.5)*U.jitter;
  let jz=(hash11(i*3u+3u)-.5)*U.jitter;
  var p=vec3f(U.margin+(f32(ix)+.5)*U.spacing+jx,
              U.margin+(f32(iy)+.5)*U.spacing+jy,
              U.margin+(f32(iz)+.5)*U.spacing+jz);
  // mode 1 = compact side block (dam-break initial condition).
  if(U.mode==1u){ p.x=U.margin+(f32(ix)+.5)*U.spacing+jx; }
  pos[i]=vec4f(p,1); pred[i]=vec4f(p,1); vel[i]=vec4f(0);
}`;
const mod=dev.createShaderModule({code:shader,label:'fluidV5M743SceneSeedWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length) throw new Error('M7.4.3 scene seed WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M743SceneSeed',layout:'auto',compute:{module:mod,entryPoint:'main'}});
const uni=dev.createBuffer({label:'fluidV5M743SceneSeedUniform',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(12), U32=new Uint32Array(F.buffer);

let active='baseline';
let pending=null;
let seedCount=0;
let inStep=false;
const baseStep=sim.step.bind(sim);
const baseCreate=dev.createCommandEncoder.bind(dev);

function layoutFor(name){
  const b=sim.params.box,d=sim.params.spacing,margin=d;
  const n=Math.max(1,sim.scene?.nFluid||sim.n||1);
  const usableZ=Math.max(d,b[2]-2*margin);
  const nz=Math.max(1,Math.floor(usableZ/d));
  if(name==='pool'){
    const nx=Math.max(1,Math.floor(Math.max(d,b[0]-2*margin)/d));
    const layers=Math.max(1,Math.ceil(n/(nx*nz)));
    return {nx,nz,layers,mode:0};
  }
  // Compact block on the left, preserving all primary-water particles.
  const width=Math.max(d*5,(b[0]-2*margin)*.35);
  const nx=Math.max(1,Math.floor(width/d));
  const layers=Math.max(1,Math.ceil(n/(nx*nz)));
  return {nx,nz,layers,mode:1};
}
function encodeSeed(enc,name){
  const b=sim.params.box,d=sim.params.spacing,n=Math.max(1,sim.scene?.nFluid||sim.n||1);
  const L=layoutFor(name),margin=d;
  F[0]=b[0];F[1]=b[1];F[2]=b[2];F[3]=d;
  U32[4]=L.nx;U32[5]=L.layers;U32[6]=L.nz;U32[7]=n;
  F[8]=margin;F[9]=d*.055;U32[10]=L.mode;U32[11]=0;
  dev.queue.writeBuffer(uni,0,F);
  const pos=sim.livePos?.(),vel=sim.liveVel?.();
  const pred=sim.buf?.[sim.parity===0?'predA':'predB'];
  if(!pos||!vel||!pred) return false;
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uni}}, {binding:1,resource:{buffer:pos}},
    {binding:2,resource:{buffer:vel}}, {binding:3,resource:{buffer:pred}},
  ]});
  const pass=enc.beginComputePass({label:'fluidV5M743SceneSeedPass'});
  pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(n/256));pass.end();
  seedCount++;sim.bindCache=null;return true;
}

// Wrap ONLY encoder creation. During sim.step the underlying M7.3.9 wrapper has already
// returned its shared compute+render encoder, so the scene seed is prepended to that same buffer.
dev.createCommandEncoder=function(desc){
  const enc=baseCreate(desc);
  if(inStep&&pending){
    const next=pending;pending=null;
    try{ if(encodeSeed(enc,next)){active=next;syncUI();} }
    catch(err){console.error('[M7.4.3 scene seed]',err);}
  }
  return enc;
};
sim.step=function(dt){inStep=true;try{return baseStep(dt)}finally{inStep=false}};

function choose(name){
  if(name!=='pool'&&name!=='dam')return;
  pending=name;
  // Make sure the solver advances so the queued seed is consumed even if the user paused it.
  if(ui.paused) ui.paused=false;
  syncUI();
}

// --- inject only the Scenes page into the already-proven M7.4.2 UI ---------
const tabbar=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
let scenePage=null;
if(tabbar&&host){
  const tabs=[...tabbar.children];const idx=tabs.findIndex(b=>b.dataset.key==='scenes');
  if(idx>=0)scenePage=host.children[idx]||null;
}
let poolBtn=null,damBtn=null,status=null;
function syncUI(){
  poolBtn?.classList.toggle('active',active==='pool'||pending==='pool');
  damBtn?.classList.toggle('active',active==='dam'||pending==='dam');
  if(status)status.textContent=`ACTIVE ${active.toUpperCase()}${pending?` · QUEUED ${pending.toUpperCase()}`:''}\nscene seed passes ${seedCount} · extra queue submits 0`;
}
if(scenePage){
  scenePage.innerHTML='<div class="m742Intro">First scene restore: only static initial conditions. Both are encoded into the existing unified GPU frame; no extra queue submission is created.</div>';
  const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">SAFE STATIC SCENES</div>';
  const grid=document.createElement('div');grid.className='m742Grid';
  poolBtn=document.createElement('button');poolBtn.className='m742Btn';poolBtn.textContent='POOL';poolBtn.onclick=e=>{e.preventDefault();e.stopPropagation();choose('pool')};
  damBtn=document.createElement('button');damBtn.className='m742Btn';damBtn.textContent='DAM BREAK';damBtn.onclick=e=>{e.preventDefault();e.stopPropagation();choose('dam')};
  grid.append(poolBtn,damBtn);sec.appendChild(grid);scenePage.appendChild(sec);
  const lock=document.createElement('div');lock.className='m742Status m742Locked';lock.style.marginTop='10px';lock.textContent='NEXT, ONE AT A TIME\nWAVE TANK · RAIN · POUR · DRAIN · FAUCET · WATERFALL · PADDLE · WHIRLPOOL · FOUNTAIN\n\nThese remain locked because they require continuous particle injection or forcing.';scenePage.appendChild(lock);
  status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';scenePage.appendChild(status);syncUI();
}

window.__v5M743Scenes={online:true,backend:'unified-static-scene-seed-m743',choose,get active(){return active},get pending(){return pending},get seedCount(){return seedCount}};
console.info('[Fluid V5 M7.4.3] Pool/Dam static scene controller online; zero extra queue submits.');
