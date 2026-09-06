// Fluid V5 / V8 M8.3 — full scenario restoration on the M8.2 common-water core.
// Reuses the proven M7.4.5/M7.5.x scene mechanics where they remain solver-safe,
// while replacing the old post-solve drain shuffle with a PRE-solve permutation so
// M8.2's divergence/vorticity pass always sees a freshly rebuilt, coherent cell grid.
// All feature work stays inside the existing unified GPUCommandEncoder: zero added submits.

const sim=window.__sim, ui=window.__ui;
const scenes=window.__v5M743Scenes;
const wave=window.__v5M745WaveLab;
const modern=window.__v5M752PhysicalScenes;
const scaled=window.__v5M754ScaledScenes;
const core=window.__v5M820FluidCore;
if(!sim?.dev||!ui||!scenes?.online||!wave?.online||!modern?.online||!scaled?.online||!core?.online)
  throw new Error('M8.3 scenes: required unified scene/runtime modules unavailable.');
const dev=sim.dev;
const fullN=Math.max(1,sim.scene?.nFluid||sim.n||1);

let active='pool', inStep=false, lastDt=1/60;
let pendingPour=false, pourSeeds=0, pourFraction=.38;
let drainActive=false, drainTime=0, drainCarry=0, drained=0, drainRate=.075, drainStrength=1.0;
let drainPasses=0, drainShuffles=0, serial=1;

function restoreFullCount(){
  if(sim.n!==fullN){
    sim.n=fullN;
    if(sim.scene){sim.scene.n=fullN;sim.scene.nFluid=fullN;}
    sim.uploadParams?.(1/240);
    sim.bindCache=null;
  }
  drained=0;drainCarry=0;
}
function stopCustom(){pendingPour=false;drainActive=false;drainTime=0;drainCarry=0;drained=0;}
function stopLegacy(){
  try{scaled.disable?.()}catch{}
  try{modern.disable?.()}catch{}
  try{wave.disable?.()}catch{}
}
function resetControllers(){stopCustom();stopLegacy();restoreFullCount();}

// ---------------------------------------------------------------------------
// M8 gravity-pour initial condition. The elevated reservoir begins at rest; after
// this one seed pass, only gravity + the common M8.2 water solver govern the fall.
// ---------------------------------------------------------------------------
const pourWGSL=`
struct PourU {
  boxSpacing:vec4f,
  counts:vec4u,
  dims:vec4u,
  place:vec4f,
  heights:vec4f,
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
const pourMod=dev.createShaderModule({code:pourWGSL,label:'fluidV5M830GravityPourWGSL'});
if(typeof pourMod.getCompilationInfo==='function'){
  const info=await pourMod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.3 gravity pour WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pourPipe=await dev.createComputePipelineAsync({label:'fluidV5M830GravityPour',layout:'auto',compute:{module:pourMod,entryPoint:'main'}});
const pourUni=dev.createBuffer({label:'fluidV5M830GravityPourUniform',size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const PF=new Float32Array(20), PU=new Uint32Array(PF.buffer);
function encodePour(enc){
  const b=sim.params.box,d=sim.params.spacing||.044,n=Math.max(1,sim.n||fullN),margin=d;
  const upperN=Math.max(1,Math.min(n-1,Math.round(n*pourFraction)));
  const lowerN=Math.max(1,n-upperN);
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
  const upperX=Math.max(margin,(b[0]-upperNx*d)*.5),upperZ=Math.max(margin,(b[2]-upperNz*d)*.5);
  PF.fill(0);PF[0]=b[0];PF[1]=b[1];PF[2]=b[2];PF[3]=d;
  PU[4]=n;PU[5]=lowerN;PU[6]=lowerNx;PU[7]=lowerNz;
  PU[8]=lowerLayers;PU[9]=upperNx;PU[10]=upperNz;PU[11]=upperLayers;
  PF[12]=margin;PF[13]=d*.05;PF[14]=upperX;PF[15]=upperZ;PF[16]=upperY;
  dev.queue.writeBuffer(pourUni,0,PF);
  const pos=sim.livePos?.(),vel=sim.liveVel?.(),pred=sim.buf?.[sim.parity===0?'predA':'predB'];
  if(!pos||!vel||!pred)return false;
  const bg=dev.createBindGroup({layout:pourPipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:pourUni}},{binding:1,resource:{buffer:pos}},
    {binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:pred}},
  ]});
  const pass=enc.beginComputePass({label:'fluidV5M830GravityPourSeed'});
  pass.setPipeline(pourPipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(n/256));pass.end();
  sim.bindCache=null;pourSeeds++;return true;
}

// ---------------------------------------------------------------------------
// M8-safe drain. Sink forcing occurs BEFORE the normal PBF step. A permutation of
// the active particle set is also done BEFORE PBF so the solver rebuilds cellStart
// afterward. This avoids the M7.5.2 post-solve shuffle / stale-grid hazard with M8.2.
// ---------------------------------------------------------------------------
const drainWGSL=`
struct DrainU { box:vec4f, control:vec4f, info:vec4u }
@group(0) @binding(0) var<uniform> U:DrainU;
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
fn safe2(v:vec2f)->vec2f{let l=length(v);return select(vec2f(0.0),v/l,l>1.0e-6);}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.info.x){return;}
  let p=pos[i].xyz;var v=vel[i].xyz;
  let bx=U.box.x;let by=U.box.y;let bz=U.box.z;let d=max(U.box.w,.001);
  let t=U.control.x;let strength=U.control.y;let surface=U.control.z;
  let centre=vec2f(bx*.50,bz*.50);let q=p.xz-centre;let r=length(q);
  let R=min(bx,bz)*.41;let rn=clamp(r/max(R,1.0e-5),0.0,1.0);
  let dir=safe2(q);let tang=vec2f(-dir.y,dir.x);
  let radial=1.0-smoothstep(R*.08,R,r);
  let wet=1.0-smoothstep(surface+2.0*d,surface+5.0*d,p.y);
  let floorBand=1.0-smoothstep(d*2.2,max(d*10.0,by*.28),p.y);
  let ramp=smoothstep(0.0,.75,t);
  let inward=strength*(.34+.55*(1.0-rn));
  let swirl=strength*(.08+.22*(1.0-rn));
  let targetVelocity=-dir*inward+tang*swirl;
  let blend=clamp((.032+.080*(1.0-rn))*radial*wet*ramp,0.0,.18);
  v.x=mix(v.x,targetVelocity.x,blend);v.z=mix(v.z,targetVelocity.y,blend);
  let core=1.0-smoothstep(0.0,R*.19,r);
  let down=clamp(.055+.16*floorBand,0.0,.22)*core*wet*ramp;
  v.y=mix(v.y,-strength*(.62+.28*(1.0-rn)),down);
  vel[i]=vec4f(v,0.0);
}`;
const drainMod=dev.createShaderModule({code:drainWGSL,label:'fluidV5M830DrainWGSL'});
if(typeof drainMod.getCompilationInfo==='function'){
  const info=await drainMod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.3 drain WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const drainPipe=await dev.createComputePipelineAsync({label:'fluidV5M830Drain',layout:'auto',compute:{module:drainMod,entryPoint:'main'}});
const drainUni=dev.createBuffer({label:'fluidV5M830DrainUniform',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const DF=new Float32Array(12), DU=new Uint32Array(DF.buffer);

const shuffleWGSL=`
struct S { info:vec4u }
@group(0) @binding(0) var<uniform> U:S;
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read> vel:array<vec4f>;
@group(0) @binding(3) var<storage,read> pred:array<vec4f>;
@group(0) @binding(4) var<storage,read_write> outPos:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> outVel:array<vec4f>;
@group(0) @binding(6) var<storage,read_write> outPred:array<vec4f>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;let n=U.info.x;if(i>=n||n==0u){return;}
  let j=(i+U.info.y)%n;outPos[j]=pos[i];outVel[j]=vel[i];outPred[j]=pred[i];
}`;
const shMod=dev.createShaderModule({code:shuffleWGSL,label:'fluidV5M830DrainShuffleWGSL'});
if(typeof shMod.getCompilationInfo==='function'){
  const info=await shMod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.3 drain shuffle WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const shPipe=await dev.createComputePipelineAsync({label:'fluidV5M830DrainShuffle',layout:'auto',compute:{module:shMod,entryPoint:'main'}});
const shUni=dev.createBuffer({label:'fluidV5M830DrainShuffleUniform',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const SU=new Uint32Array(4);
const scratchUsage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
const scratchBytes=Math.max(16,fullN*16);
const scratchPos=dev.createBuffer({label:'fluidV5M830DrainScratchPos',size:scratchBytes,usage:scratchUsage});
const scratchVel=dev.createBuffer({label:'fluidV5M830DrainScratchVel',size:scratchBytes,usage:scratchUsage});
const scratchPred=dev.createBuffer({label:'fluidV5M830DrainScratchPred',size:scratchBytes,usage:scratchUsage});

function poolSurface(){
  const b=sim.params.box,d=sim.params.spacing||.044;
  const nx=Math.max(1,Math.floor(Math.max(d,b[0]-2*d)/d));
  const nz=Math.max(1,Math.floor(Math.max(d,b[2]-2*d)/d));
  const layers=Math.max(1,Math.ceil(fullN/(nx*nz)));
  return Math.min(b[1]-2*d,(layers+1)*d);
}
function advanceDrain(dt){
  if(!drainActive||ui.paused)return;
  drainTime+=Math.min(.05,Math.max(.001,Number.isFinite(dt)?dt:1/60));
  if(drainTime<.55)return; // let the pool seed settle before deleting active water
  const minN=Math.max(64,Math.round(fullN*.003));
  if(sim.n<=minN)return;
  drainCarry+=fullN*drainRate*Math.min(.05,Math.max(.001,dt||1/60));
  const take=Math.floor(drainCarry);if(take<1)return;drainCarry-=take;
  sim.n=Math.max(minN,sim.n-take);drained=fullN-sim.n;sim.uploadParams?.(1/240);
}
function encodeDrain(enc){
  const n=Math.max(1,sim.n||1),b=sim.params.box,d=sim.params.spacing||.044;
  const pos=sim.livePos?.(),vel=sim.liveVel?.(),pred=sim.buf?.[sim.parity===0?'predA':'predB'];
  if(!pos||!vel||!pred)return false;
  // Shuffle first. Because this is pre-solve, the normal PBF grid build that follows
  // sees the new ordering and M8.2's later cellStart use remains valid.
  if(n>1){
    serial=(serial+1)>>>0;let offset=(Math.imul(serial,2654435761)>>>0)%n;
    if(offset===0)offset=Math.max(1,Math.floor(n*.381966));
    SU[0]=n;SU[1]=offset;SU[2]=0;SU[3]=0;dev.queue.writeBuffer(shUni,0,SU);
    const sbg=dev.createBindGroup({layout:shPipe.getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:shUni}},{binding:1,resource:{buffer:pos}},
      {binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:pred}},
      {binding:4,resource:{buffer:scratchPos}},{binding:5,resource:{buffer:scratchVel}},
      {binding:6,resource:{buffer:scratchPred}},
    ]});
    let p=enc.beginComputePass({label:'fluidV5M830DrainPreSolveShuffle'});
    p.setPipeline(shPipe);p.setBindGroup(0,sbg);p.dispatchWorkgroups(Math.ceil(n/256));p.end();
    const bytes=n*16;enc.copyBufferToBuffer(scratchPos,0,pos,0,bytes);enc.copyBufferToBuffer(scratchVel,0,vel,0,bytes);enc.copyBufferToBuffer(scratchPred,0,pred,0,bytes);drainShuffles++;
  }
  DF.fill(0);DF[0]=b[0];DF[1]=b[1];DF[2]=b[2];DF[3]=d;DF[4]=drainTime;DF[5]=drainStrength;DF[6]=poolSurface();DF[7]=drainRate;DU[8]=n;
  dev.queue.writeBuffer(drainUni,0,DF);
  const bg=dev.createBindGroup({layout:drainPipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:drainUni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:vel}}
  ]});
  const pass=enc.beginComputePass({label:'fluidV5M830DrainSink'});pass.setPipeline(drainPipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(n/256));pass.end();
  drainPasses++;sim.bindCache=null;return true;
}

// Add custom M8 initial-condition/drain work before the ordinary PBF frame.
const baseCreate=dev.createCommandEncoder.bind(dev), baseStep=sim.step.bind(sim);
dev.createCommandEncoder=function(desc){
  const enc=baseCreate(desc);
  if(inStep){
    if(pendingPour){pendingPour=false;try{encodePour(enc)}catch(err){console.error('[M8.3 pour seed]',err)}}
    if(drainActive){try{encodeDrain(enc)}catch(err){console.error('[M8.3 drain]',err);drainActive=false;}}
  }
  return enc;
};
sim.step=function(dt){lastDt=Number.isFinite(dt)?dt:lastDt;advanceDrain(lastDt);inStep=true;try{return baseStep(dt)}finally{inStep=false;}};

function choose(name){
  resetControllers();
  window.__v5M803Splash?.setScenario?.(name);
  if(name==='pool'||name==='dam'){
    active=name;scenes.choose(name);
  }else if(name==='wave'){
    active='wave';wave.enable('regular');
  }else if(['rain','faucet','waterfall','paddle'].includes(name)){
    active=name;modern.choose(name);
  }else if(name==='whirlpool'||name==='fountain'){
    active=name;scaled.choose(name);
  }else if(name==='pour'){
    active='pour';scenes.choose('pool');pendingPour=true;
  }else if(name==='drain'){
    active='drain';scenes.choose('pool');drainActive=true;drainTime=0;drainCarry=0;drained=0;serial++;
  }else return;
  if(ui.paused)ui.paused=false;
  sync();
}

// ---------------------------------------------------------------------------
// Unified scene dock. Old M7 controls are hidden so the unsafe legacy drain button
// cannot be triggered accidentally, but the legacy controllers remain available under
// the hood for proven Rain/Faucet/Waterfall/Paddle/Wave/Fountain/Whirlpool mechanics.
// ---------------------------------------------------------------------------
const panel=document.getElementById('m742Panel'),tabs=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
if(!panel||!tabs||!host)throw new Error('M8.3 scene dock: settings panel unavailable.');
const sceneTabs=[...tabs.children],sceneIdx=sceneTabs.findIndex(b=>b.dataset.key==='scenes'),scenePage=sceneIdx>=0?host.children[sceneIdx]:null;
if(scenePage)scenePage.innerHTML='';
document.getElementById('m830SceneStyle')?.remove();
const style=document.createElement('style');style.id='m830SceneStyle';style.textContent=`
#m830SceneDock{padding:8px 9px 9px;border-bottom:1px solid rgba(78,214,220,.18);background:rgba(4,16,22,.90)}
.m830Head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}.m830Title{font:900 8px ui-monospace;color:#86f6ff;letter-spacing:.12em}.m830Note{font:7px ui-monospace;color:#799aa7}
.m830Scroll{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:1px}.m830Scroll::-webkit-scrollbar{display:none}
.m830Btn{flex:0 0 auto;min-height:42px;min-width:86px;padding:7px 9px;border-radius:10px;border:1px solid rgba(78,214,220,.30);background:#071820;color:#dffcff;font:800 8px ui-monospace}
.m830Btn.active{border-color:#f1ad43;color:#ffd890;background:rgba(77,54,17,.45)}
`;
document.head.appendChild(style);
document.getElementById('m830SceneDock')?.remove();
const dock=document.createElement('div');dock.id='m830SceneDock';dock.innerHTML='<div class="m830Head"><div class="m830Title">V8 SCENARIOS · M8.3</div><div class="m830Note">common water · one submit</div></div><div class="m830Scroll"></div>';
panel.insertBefore(dock,tabs);
const scroller=dock.querySelector('.m830Scroll'),buttons={};
for(const [key,label] of [
  ['pool','POOL'],['wave','WAVE TANK'],['rain','RAIN'],['pour','GRAVITY POUR'],['dam','DAM BREAK'],
  ['drain','DRAIN'],['faucet','FAUCET'],['waterfall','WATERFALL'],['paddle','PADDLE'],['whirlpool','WHIRLPOOL'],['fountain','FOUNTAIN']
]){
  const b=document.createElement('button');b.type='button';b.className='m830Btn';b.textContent=label;
  b.onclick=e=>{e.preventDefault();e.stopPropagation();choose(key)};buttons[key]=b;scroller.appendChild(b);
}
let status=null;
function slider(parent,label,min,max,step,value,onchange,fmt=v=>Number(v).toFixed(2)){
  const row=document.createElement('div');row.className='m742Row';const l=document.createElement('label');l.textContent=label;
  const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;
  const val=document.createElement('div');val.className='m742Val';val.textContent=fmt(value);
  input.oninput=e=>{e.stopPropagation();const n=Number(input.value);onchange(n);val.textContent=fmt(n);sync()};row.append(l,input,val);parent.appendChild(row);return input;
}
if(scenePage){
  scenePage.innerHTML='<div class="m742Intro">M8.3 restores the complete scenario test set on the M8.2 common-water solver. Continuous source scenes reuse the last proven one-submit mechanics. Drain is rebuilt for M8 so particle permutation happens before the solver rebuilds its spatial grid.</div>';
  const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">SCENARIO VALIDATION</div><div class="m742Note">Expected behavior: Faucet = connected stream · Whirlpool = circular free-surface funnel · Drain = visible sink that actually lowers water volume · Fountain = mass-conserving recirculating jet.</div>';
  slider(sec,'DRAIN RATE',.020,.160,.005,drainRate,v=>drainRate=v,v=>`${Number(v).toFixed(3)}/s`);
  slider(sec,'DRAIN FORCE',.55,1.65,.05,drainStrength,v=>drainStrength=v);
  slider(sec,'POUR FRACTION',.18,.58,.02,pourFraction,v=>pourFraction=v,v=>`${Math.round(Number(v)*100)}%`);
  status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';sec.appendChild(status);scenePage.appendChild(sec);
}
function sync(){
  for(const [k,b] of Object.entries(buttons))b.classList.toggle('active',k===active);
  if(!status)return;
  const remain=100*Math.max(0,sim.n||0)/fullN;
  const legacy=`wave ${wave.enabled?'on':'off'} · source ${modern.active||'none'} · refined ${scaled.active||'none'}`;
  status.textContent=`ACTIVE ${active.toUpperCase()}\n${legacy}\nM8 pour seeds ${pourSeeds} · drain passes ${drainPasses} · pre-solve shuffles ${drainShuffles}\nwater remaining ${remain.toFixed(1)}% · drained ${drained.toLocaleString()} · added queue submits 0`;
}
setInterval(sync,400);sync();

const requested=new URLSearchParams(location.search).get('scene');
if(requested&&buttons[requested])setTimeout(()=>choose(requested),350);else setTimeout(()=>choose('pool'),220);
window.__v5M830Scenes={
  online:true,backend:'full-scenario-restore-m830',gpuSubmitsAdded:0,choose,
  get active(){return active},get pourSeeds(){return pourSeeds},get drainPasses(){return drainPasses},
  get drainShuffles(){return drainShuffles},get drained(){return drained},get remaining(){return Math.max(0,sim.n||0)/fullN}
};
window.__fluidV5Version='8.3.0';window.__fluidV5Build='M8.3 FULL SCENARIO RESTORE / M8.2 COMMON WATER / ONE-SUBMIT CORE';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.3';document.title='Fluid V8 · M8.3 Scenario Restore';
console.info('[Fluid V8 M8.3] full scenario set restored; M8-safe drain + gravity pour online; added submits 0.');
