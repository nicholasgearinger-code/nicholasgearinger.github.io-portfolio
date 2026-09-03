// Fluid V5 M8.2.1 — top scene test dock + first one-at-a-time M8 scenario.
// Scene controls are promoted to the top of the settings panel. Only Pool, Dam Break,
// and Gravity Pour are enabled. Gravity Pour is an INITIAL CONDITION only: no custom
// per-frame force is added. The common M8.2 water solver decides what the released water does.
// The one-shot seed pass is encoded into the existing unified GPU command buffer.

const sim=window.__sim,ui=window.__ui;
const baseScenes=window.__v5M743Scenes;
if(!sim?.dev||!ui||!baseScenes?.online||!window.__v5M820FluidCore?.online)
  throw new Error('M8.2.1 scene dock: M8.2 common-water runtime unavailable.');
const dev=sim.dev;

// ---------------------------------------------------------------------------
// Gravity-pour seed: part of the SAME water body rests in the pool; the remainder
// starts as an elevated reservoir at zero velocity. After seeding, ONLY gravity +
// the common PBF/M8.2 density/divergence/vorticity model act on the particles.
// ---------------------------------------------------------------------------
const shader=`
struct PourU {
  boxSpacing:vec4f,      // xyz box, spacing
  counts:vec4u,          // total, lowerCount, lowerNx, lowerNz
  dims:vec4u,            // lowerLayers, upperNx, upperNz, upperLayers
  place:vec4f,           // margin, jitter, upperX0, upperZ0
  heights:vec4f,         // upperY0, spare...
}
@group(0) @binding(0) var<uniform> U:PourU;
@group(0) @binding(1) var<storage,read_write> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> pred:array<vec4f>;
fn hash11(x:u32)->f32{
  var h=x*747796405u+2891336453u;
  h=((h>>((h>>28u)+4u))^h)*277803737u;
  h=(h>>22u)^h;
  return f32(h & 0x00ffffffu)/16777215.0;
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.counts.x){return;}
  let d=U.boxSpacing.w;let margin=U.place.x;let jit=U.place.y;
  let jx=(hash11(i*3u+1u)-.5)*jit;
  let jy=(hash11(i*3u+2u)-.5)*jit;
  let jz=(hash11(i*3u+3u)-.5)*jit;
  var p=vec3f(0.0);
  if(i<U.counts.y){
    let j=i;let nx=max(U.counts.z,1u);let nz=max(U.counts.w,1u);let layer=nx*nz;
    let ix=j%nx;let iz=(j/nx)%nz;let iy=j/layer;
    p=vec3f(margin+(f32(ix)+.5)*d+jx,
            margin+(f32(iy)+.5)*d+jy,
            margin+(f32(iz)+.5)*d+jz);
  }else{
    let j=i-U.counts.y;let nx=max(U.dims.y,1u);let nz=max(U.dims.z,1u);let layer=nx*nz;
    let ix=j%nx;let iz=(j/nx)%nz;let iy=j/layer;
    p=vec3f(U.place.z+(f32(ix)+.5)*d+jx,
            U.heights.x+(f32(iy)+.5)*d+jy,
            U.place.w+(f32(iz)+.5)*d+jz);
  }
  p=clamp(p,vec3f(margin),U.boxSpacing.xyz-vec3f(margin));
  pos[i]=vec4f(p,1.0);pred[i]=vec4f(p,1.0);vel[i]=vec4f(0.0);
}`;
const mod=dev.createShaderModule({code:shader,label:'fluidV5M821GravityPourWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.2.1 gravity pour WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M821GravityPour',layout:'auto',compute:{module:mod,entryPoint:'main'}});
const uni=dev.createBuffer({label:'fluidV5M821GravityPourUniform',size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(20),U32=new Uint32Array(F.buffer);
let pendingPour=false,pourSeeds=0,current='pool',inStep=false;
const baseCreate=dev.createCommandEncoder.bind(dev);
const baseStep=sim.step.bind(sim);

function encodePour(enc){
  const b=sim.params.box,d=sim.params.spacing,n=Math.max(1,sim.scene?.nFluid||sim.n||1),margin=d;
  const lowerN=Math.max(1,Math.floor(n*.62)),upperN=n-lowerN;
  const lowerNx=Math.max(1,Math.floor(Math.max(d,b[0]-2*margin)/d));
  const lowerNz=Math.max(1,Math.floor(Math.max(d,b[2]-2*margin)/d));
  const lowerLayers=Math.max(1,Math.ceil(lowerN/(lowerNx*lowerNz)));
  const upperWidth=Math.max(d*6,(b[0]-2*margin)*.48),upperDepth=Math.max(d*6,(b[2]-2*margin)*.44);
  const upperNx=Math.max(4,Math.floor(upperWidth/d)),upperNz=Math.max(4,Math.floor(upperDepth/d));
  const upperLayers=Math.max(1,Math.ceil(upperN/(upperNx*upperNz)));
  const upperHeight=upperLayers*d;
  const lowerTop=margin+lowerLayers*d;
  const maxUpperY=Math.max(margin,b[1]-margin-upperHeight);
  const upperY=Math.min(maxUpperY,Math.max(lowerTop+d*7,b[1]*.64));
  const upperX=Math.max(margin,(b[0]-upperNx*d)*.5);
  const upperZ=Math.max(margin,(b[2]-upperNz*d)*.5);
  F.fill(0);F[0]=b[0];F[1]=b[1];F[2]=b[2];F[3]=d;
  U32[4]=n;U32[5]=lowerN;U32[6]=lowerNx;U32[7]=lowerNz;
  U32[8]=lowerLayers;U32[9]=upperNx;U32[10]=upperNz;U32[11]=upperLayers;
  F[12]=margin;F[13]=d*.05;F[14]=upperX;F[15]=upperZ;F[16]=upperY;
  dev.queue.writeBuffer(uni,0,F);
  const pos=sim.livePos?.(),vel=sim.liveVel?.(),pred=sim.buf?.[sim.parity===0?'predA':'predB'];
  if(!pos||!vel||!pred)return false;
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},
    {binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:pred}},
  ]});
  const pass=enc.beginComputePass({label:'fluidV5M821GravityPourSeed'});
  pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(n/256));pass.end();
  sim.bindCache=null;pourSeeds++;return true;
}

dev.createCommandEncoder=function(desc){
  const enc=baseCreate(desc);
  if(inStep&&pendingPour){pendingPour=false;try{if(encodePour(enc)){current='pour';sync();}}catch(err){console.error('[M8.2.1 pour seed]',err);}}
  return enc;
};
sim.step=function(dt){inStep=true;try{return baseStep(dt)}finally{inStep=false}};

function choose(name){
  if(name==='pool'||name==='dam'){
    current=name;baseScenes.choose(name);if(ui.paused)ui.paused=false;sync();return;
  }
  if(name==='pour'){
    current='pour';pendingPour=true;if(ui.paused)ui.paused=false;sync();return;
  }
}

// ---------------------------------------------------------------------------
// Top scene dock. The test scenarios are always visible above the category tabs.
// We expose only one new M8 scenario at a time so each boundary/initial-condition
// experiment can be validated before the next one is enabled.
// ---------------------------------------------------------------------------
const panel=document.getElementById('m742Panel'),tabs=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
if(!panel||!tabs||!host)throw new Error('M8.2.1 scene dock: settings panel unavailable.');
document.getElementById('m821SceneStyle')?.remove();
const style=document.createElement('style');style.id='m821SceneStyle';style.textContent=`
#m821SceneDock{padding:8px 9px 9px;border-bottom:1px solid rgba(78,214,220,.18);background:rgba(4,16,22,.86)}
.m821SceneHead{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}.m821SceneTitle{font:900 8px ui-monospace;color:#86f6ff;letter-spacing:.12em}.m821SceneNote{font:7px ui-monospace;color:#799aa7}
.m821SceneScroll{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:1px}.m821SceneScroll::-webkit-scrollbar{display:none}
.m821SceneBtn{flex:0 0 auto;min-height:44px;min-width:92px;padding:7px 10px;border-radius:10px;border:1px solid rgba(78,214,220,.30);background:#071820;color:#dffcff;font:800 8px ui-monospace;letter-spacing:.02em}
.m821SceneBtn.active{border-color:#f1ad43;color:#ffd890;background:rgba(77,54,17,.45)}.m821SceneBtn.locked{opacity:.42;border-style:dashed;color:#8caeba}
`;
document.head.appendChild(style);
const old=document.getElementById('m821SceneDock');old?.remove();
const dock=document.createElement('div');dock.id='m821SceneDock';dock.innerHTML='<div class="m821SceneHead"><div class="m821SceneTitle">SCENE TESTS · TOP DOCK</div><div class="m821SceneNote">one new scenario at a time</div></div><div class="m821SceneScroll"></div>';
panel.insertBefore(dock,tabs);
const scroller=dock.querySelector('.m821SceneScroll'),buttons={};
for(const [key,label,enabled] of [
  ['pool','POOL',true],['dam','DAM BREAK',true],['pour','GRAVITY POUR',true],
  ['wave','WAVE TANK',false],['rain','RAIN',false],['faucet','FAUCET',false],
  ['waterfall','WATERFALL',false],['whirlpool','WHIRLPOOL',false],['drain','DRAIN',false],['fountain','FOUNTAIN',false]
]){
  const b=document.createElement('button');b.type='button';b.className='m821SceneBtn'+(enabled?'':' locked');b.textContent=enabled?label:`🔒 ${label}`;b.disabled=!enabled;
  if(enabled)b.onclick=e=>{e.preventDefault();e.stopPropagation();choose(key)};scroller.appendChild(b);buttons[key]=b;
}
let status=null;
const sceneTabs=[...tabs.children],sceneIdx=sceneTabs.findIndex(b=>b.dataset.key==='scenes'),scenePage=sceneIdx>=0?host.children[sceneIdx]:null;
if(scenePage){
  scenePage.innerHTML='<div class="m742Intro">Scene buttons now stay at the TOP of Settings. We will enable one new physical experiment at a time. GRAVITY POUR is only an elevated zero-velocity initial condition; the common M8.2 water solver handles the fall and impact.</div>';
  const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">CURRENT VALIDATION</div>';
  status=document.createElement('div');status.className='m742Status';sec.appendChild(status);scenePage.appendChild(sec);
  const note=document.createElement('div');note.className='m742Note';note.textContent='Next unlock only after the current test behaves correctly: Wave Tank → Rain → Faucet → Waterfall → Whirlpool → Drain → Fountain.';scenePage.appendChild(note);
}
function sync(){
  for(const [k,b] of Object.entries(buttons))b.classList.toggle('active',k===current);
  if(status)status.textContent=`ACTIVE ${current.toUpperCase()}${pendingPour?' · QUEUED':''}\nGravity-pour seed passes ${pourSeeds} · scene-specific continuous forces 0 · added queue submits 0`;
}
setInterval(()=>{if(current!=='pour'&&(baseScenes.active==='pool'||baseScenes.active==='dam'))current=baseScenes.active;sync()},350);sync();

window.__v5M821Scenes={online:true,backend:'top-dock-one-at-a-time-scenes-m821',choose,get active(){return current},get pending(){return pendingPour},get pourSeeds(){return pourSeeds},gpuSubmitsAdded:0};
window.__fluidV5Version='8.2.1';
console.info('[Fluid V5 M8.2.1] top scene dock + gravity-pour initial-condition test online; zero added queue submits.');
