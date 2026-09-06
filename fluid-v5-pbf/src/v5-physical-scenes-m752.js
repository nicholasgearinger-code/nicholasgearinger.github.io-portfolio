// Fluid V5 M7.5.3 — gravity-release faucet/waterfall + free-surface vortex + real drain.
// Builds on M7.5.2 while preserving the M7.3.9 one-submit iOS scheduler.
// Faucet and waterfall now release coherent PBF packets with only a small inlet velocity;
// after crossing the outlet, world gravity and the same pressure solver used by Pour own motion.
// Whirlpool drives a stable tangential/radial target field so centrifugal pressure can form a funnel.
// Drain combines a sink/vortex field with gradual active-particle removal; a post-solve rotation
// shuffles particle ordering so removal is distributed through the body instead of clipping one side.

const sim=window.__sim, ui=window.__ui, scenes=window.__v5M743Scenes, wave=window.__v5M745WaveLab;
if(!sim?.dev||!ui||!scenes?.online||!wave?.online||!window.__v5M739Unified?.online)
  throw new Error('M7.5.3 scenes: stable unified scene runtime unavailable.');
const dev=sim.dev;
const quality=new URLSearchParams(location.search).get('quality')||'low';
const fullN=Math.max(1,sim.n||sim.scene?.nFluid||1);
const minDrainN=Math.max(48,Math.round(fullN*.003));

const shader=`
struct SceneU {
  box:vec4f,
  control:vec4f,
  motion:vec4f,
  source:vec4u,
  flags:vec4u,
  extra:vec4f,
}
@group(0) @binding(0) var<uniform> U:SceneU;
@group(0) @binding(1) var<storage,read_write> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> pred:array<vec4f>;

fn hash11(x:u32)->f32 {
  var h=x*747796405u+2891336453u;
  h=((h>>((h>>28u)+4u))^h)*277803737u;
  h=(h>>22u)^h;
  return f32(h & 0x00ffffffu)/16777215.0;
}
fn safe2(v:vec2f)->vec2f { return v/max(length(v),1.0e-5); }
fn pulseRank(i:u32,n:u32,start:u32,count:u32)->i32 {
  if(count==0u||n==0u){return -1;}
  let r=(i+n-(start%n))%n;
  if(r<count){return i32(r);}return -1;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;
  let n=U.source.x;
  if(i>=n){return;}
  let mode=U.source.y;
  let start=U.source.z;
  let count=U.source.w;
  let fresh=U.flags.x;
  let seed=U.flags.y;
  let d=max(U.box.w,0.001);
  let bx=U.box.x; let by=U.box.y; let bz=U.box.z;
  let t=U.control.x;
  let strength=U.control.y;
  let amount=U.control.z;
  let surface=U.control.w;
  let freq=U.motion.x;
  let releaseTime=U.motion.y;
  var p=pos[i];
  var v=vel[i];
  let rank=pulseRank(i,n,start,count);

  if(mode==1u && rank>=0){
    let r=u32(rank);
    let hx=hash11(r*3u+seed*17u+11u);
    let hy=hash11(r*3u+seed*29u+23u);
    let hz=hash11(r*3u+seed*41u+37u);
    p=vec4f(d*1.7+hx*(bx-d*3.4),by*(0.66+0.27*hy),d*1.7+hz*(bz-d*3.4),1.0);
    v=vec4f((hx-.5)*.08,-(1.65+.75*hy)*strength,(hz-.5)*.08,0.0);
    pred[i]=p;
  }

  if(mode==2u){
    let reservoirCount=u32(clamp(f32(n)*amount*1.55,1.0,f32(n)*.70));
    if(fresh!=0u && i<reservoirCount){
      let nx=max(4u,u32(floor((bx*.54)/d)));
      let nz=max(5u,u32(floor((bz*.82)/d)));
      let layer=nx*nz;
      let ix=i%nx; let iz=(i/nx)%nz; let iy=i/layer;
      let jx=(hash11(i*5u+seed+7u)-.5)*d*.07;
      let jz=(hash11(i*7u+seed+19u)-.5)*d*.07;
      p=vec4f(bx*.055+(f32(ix)+.5)*d+jx,by*.70+(f32(iy)+.5)*d,bz*.09+(f32(iz)+.5)*d+jz,1.0);
      p.y=min(p.y,by*.91);
      v=vec4f(0.0); pred[i]=p;
    }
    if(i<reservoirCount && t<releaseTime){
      v=vec4f(0.0); p.y=max(p.y,by*.695); p.x=min(p.x,bx*.615); pred[i]=p;
    }
  }

  // Circular inlet packets. A small downward boundary velocity establishes flow; once released,
  // the particles receive no scripted acceleration and fall under the shared world gravity/PBF.
  if(mode==3u && rank>=0){
    let r=u32(rank);
    let total=max(count,1u);
    let phase=2.39996323*f32(r);
    let radial=d*1.18*sqrt((f32(r)+.5)/f32(total));
    let jitter=hash11(r*23u+seed*37u+5u)-.5;
    let nozzle=vec3f(bx*.50,by*.90,bz*.50);
    p=vec4f(nozzle.x+cos(phase)*radial,
            nozzle.y+jitter*d*.08,
            nozzle.z+sin(phase)*radial,1.0);
    let inlet=(.42+.16*amount)*strength;
    v=vec4f(jitter*.012*strength,-inlet,-jitter*.012*strength,0.0);
    pred[i]=p;
  }

  // A thin, broad release sheet. It is born almost at rest and immediately becomes ordinary
  // simulated water, so gravity stretches the sheet and collisions create the splash.
  if(mode==4u && rank>=0){
    let r=u32(rank);
    let den=max(count-1u,1u);
    let lane=f32(r)/f32(den);
    let a=hash11(r*5u+seed*31u+7u);
    let b=hash11(r*7u+seed*37u+11u);
    p=vec4f(bx*.22+(a-.5)*d*.72,by*.89+(b-.5)*d*.08,bz*(.13+.74*lane),1.0);
    let inlet=(.12+.08*amount)*strength;
    v=vec4f((a-.5)*.010*strength,-inlet,(b-.5)*.010*strength,0.0);
    pred[i]=p;
  }

  if(mode==5u){
    let phase=sin(t*6.2831853*freq);
    let centre=vec3f(bx*.08,surface*.95,bz*.50);
    let dx=(p.x-centre.x)/max(bx*.20,d*5.0);
    let dz=(p.z-centre.z)/max(bz*.32,d*6.0);
    let dy=(p.y-centre.y)/max(surface*.85,d*8.0);
    let r2=dx*dx+dz*dz+dy*dy*.16;
    let w=pow(max(0.0,1.0-r2),2.0);
    if(w>0.0){
      v.x+=.24*phase*w*strength;
      v.y+=.032*phase*w*strength;
      v.z+=.018*sin(t*3.1)*w*strength;
    }
  }

  // Full rotating body + inward transport + downward core: actual free-surface vortex.
  if(mode==6u){
    let centre=vec2f(bx*.50,bz*.50);
    let q=p.xz-centre;
    let r=length(q);
    let R=min(bx,bz)*.455;
    let dir=safe2(q);
    let tang=vec2f(-dir.y,dir.x);
    let rn=clamp(r/max(R,1.0e-4),0.0,1.0);
    let inside=1.0-smoothstep(R*.88,R,r);
    let wet=1.0-smoothstep(surface*1.05,surface*1.32,p.y);
    let depthWeight=.38+.62*smoothstep(surface*.22,surface*1.02,p.y);
    let ramp=smoothstep(0.0,2.4,t);
    let spin=strength*1.28*clamp(r/max(R*.42,1.0e-4),0.0,1.0);
    let inward=strength*(.08+.20*(1.0-rn));
    let targetVelocity=tang*spin-dir*inward;
    let blend=(.020+.070*(1.0-rn))*inside*wet*depthWeight*ramp;
    v.x=mix(v.x,targetVelocity.x,blend);
    v.z=mix(v.z,targetVelocity.y,blend);
    let core=1.0-smoothstep(0.0,R*.22,r);
    let collar=smoothstep(R*.20,R*.42,r)*(1.0-smoothstep(R*.42,R*.72,r));
    v.y-=core*strength*.050*wet*ramp;
    v.y+=collar*strength*.0035*wet*ramp;
  }

  if(mode==7u && rank>=0){
    let r=u32(rank);
    let a=hash11(r*5u+seed*17u)*6.2831853;
    let h=hash11(r*7u+seed*29u+3u);
    let rad=d*(.4+h*1.4);
    p=vec4f(bx*.5+cos(a)*rad,by*.16,bz*.5+sin(a)*rad,1.0);
    v=vec4f(cos(a)*.12*strength,(1.25+h*.34)*strength,sin(a)*.12*strength,0.0);
    pred[i]=p;
  }

  // Floor intake sink. JS-side active-count reduction makes the tank actually empty.
  if(mode==8u){
    let centre=vec2f(bx*.50,bz*.50);
    let q=p.xz-centre;
    let r=length(q);
    let R=min(bx,bz)*.39;
    let rn=clamp(r/max(R,1.0e-4),0.0,1.0);
    let w=1.0-smoothstep(R*.10,R,r);
    let wet=1.0-smoothstep(surface*1.03,surface*1.32,p.y);
    let dir=safe2(q);
    let tang=vec2f(-dir.y,dir.x);
    let ramp=smoothstep(0.0,1.2,t);
    let inward=strength*(.42+.52*(1.0-rn));
    let swirl=strength*(.10+.24*(1.0-rn));
    let targetVelocity=-dir*inward+tang*swirl;
    let blend=(.035+.075*(1.0-rn))*w*wet*ramp;
    v.x=mix(v.x,targetVelocity.x,blend);
    v.z=mix(v.z,targetVelocity.y,blend);
    let core=1.0-smoothstep(0.0,R*.20,r);
    let sinkTarget=-strength*(.78+rn*.08);
    v.y=mix(v.y,sinkTarget,.10*core*wet*ramp);
  }

  pos[i]=p;
  vel[i]=v;
}`;

const mod=dev.createShaderModule({code:shader,label:'fluidV5M753ScenesWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M7.5.3 scene WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M753Scenes',layout:'auto',compute:{module:mod,entryPoint:'main'}});
const uni=dev.createBuffer({label:'fluidV5M752SceneUniform',size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(24), U32=new Uint32Array(F.buffer);

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
  let j=(i+U.info.y)%n;
  outPos[j]=pos[i];outVel[j]=vel[i];outPred[j]=pred[i];
}`;
const shuffleMod=dev.createShaderModule({code:shuffleWGSL,label:'fluidV5M752DrainShuffleWGSL'});
if(typeof shuffleMod.getCompilationInfo==='function'){
  const info=await shuffleMod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M7.5.2 drain shuffle WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const shufflePipe=await dev.createComputePipelineAsync({label:'fluidV5M752DrainShuffle',layout:'auto',compute:{module:shuffleMod,entryPoint:'main'}});
const shuffleUni=dev.createBuffer({label:'fluidV5M752DrainShuffleUniform',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const shuffleU=new Uint32Array(4);
const scratchUsage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
const scratchBytes=Math.max(16,fullN*16);
const scratchPos=dev.createBuffer({label:'fluidV5M752DrainScratchPos',size:scratchBytes,usage:scratchUsage});
const scratchVel=dev.createBuffer({label:'fluidV5M752DrainScratchVel',size:scratchBytes,usage:scratchUsage});
const scratchPred=dev.createBuffer({label:'fluidV5M752DrainScratchPred',size:scratchBytes,usage:scratchUsage});

const MODE={none:0,rain:1,pour:2,faucet:3,waterfall:4,paddle:5,whirlpool:6,fountain:7,drain:8};
const LABEL={rain:'RAIN',pour:'GRAVITY POUR',faucet:'FAUCET',waterfall:'WATERFALL',paddle:'PADDLE',whirlpool:'WHIRLPOOL',fountain:'FOUNTAIN',drain:'DRAIN'};
const SOURCE=new Set(['rain','faucet','waterfall','fountain']);
let active='none',fresh=false,inStep=false,lastDt=1/60,time=0,passCount=0,seed=1;
let strength=1.0,amount=.38,frequency=.67,releaseTime=1.15,drainRate=.075;
let sourceCursor=0,lastPulse=-1e9,pulses=0,recycled=0,drained=0,drainCarry=0,shuffleSerial=0;
const baseStep=sim.step.bind(sim),baseCreate=dev.createCommandEncoder.bind(dev),baseSceneChoose=scenes.choose.bind(scenes);

function restoreFullCount(){
  if(sim.n!==fullN){
    sim.n=fullN;
    if(sim.scene){sim.scene.n=fullN;sim.scene.nFluid=fullN;}
    sim.uploadParams?.(1/240);
  }
  drained=0;drainCarry=0;
}
function advanceDrain(dt){
  if(active!=='drain'||ui.paused||sim.n<=minDrainN)return;
  const frame=Math.min(.05,Math.max(.001,Number.isFinite(dt)?dt:1/60));
  drainCarry+=fullN*drainRate*frame;
  const take=Math.floor(drainCarry);
  if(take<1)return;
  drainCarry-=take;
  sim.n=Math.max(minDrainN,sim.n-take);
  drained=fullN-sim.n;
}
function cadence(name){
  if(name==='faucet')return quality==='high'?.014:quality==='medium'?.019:.024;
  if(name==='rain')return quality==='high'?.038:quality==='medium'?.050:.068;
  if(name==='waterfall')return quality==='high'?.022:quality==='medium'?.028:.034;
  return .070;
}
function pulseSize(name){
  const m=.78+.72*amount;
  if(name==='rain')return Math.max(1,Math.round((quality==='high'?5:quality==='medium'?3:2)*m));
  if(name==='waterfall')return Math.max(16,Math.round((quality==='high'?32:quality==='medium'?27:22)*m));
  if(name==='faucet')return Math.max(10,Math.round((quality==='high'?19:quality==='medium'?16:13)*m));
  if(name==='fountain')return Math.max(4,Math.round(6*m));
  return 0;
}
function preparePulse(n){
  if(!SOURCE.has(active)||n<1)return{start:0,count:0};
  const c=cadence(active);
  if(!fresh&&time-lastPulse<c)return{start:0,count:0};
  lastPulse=time;
  const count=Math.min(n,pulseSize(active));
  const start=sourceCursor%n;
  sourceCursor=(sourceCursor+count)%n;
  pulses++;recycled+=count;
  return{start,count};
}
function encodeScene(enc){
  if(active==='none')return false;
  if(wave.enabled){restoreFullCount();active='none';fresh=false;syncUI();return false;}
  const b=sim.params.box,d=sim.params.spacing||.04,n=Math.max(1,sim.n||1);
  time+=Math.min(.05,Math.max(.001,lastDt));
  const pulse=preparePulse(n);
  F.fill(0);
  F[0]=b[0];F[1]=b[1];F[2]=b[2];F[3]=d;
  F[4]=time;F[5]=strength;F[6]=amount;F[7]=b[1]*.37;
  F[8]=frequency;F[9]=releaseTime;F[10]=drainRate;F[11]=0;
  U32[12]=n;U32[13]=MODE[active]||0;U32[14]=pulse.start;U32[15]=pulse.count;
  U32[16]=fresh?1:0;U32[17]=seed;U32[18]=pulses;U32[19]=0;
  F[20]=drained/fullN;F[21]=0;F[22]=0;F[23]=0;
  dev.queue.writeBuffer(uni,0,F);
  const pos=sim.livePos?.(),vel=sim.liveVel?.();
  const pred=sim.buf?.[sim.parity===0?'predA':'predB'];
  if(!pos||!vel||!pred)return false;
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},
    {binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:pred}},
  ]});
  const pass=enc.beginComputePass({label:'fluidV5M752ScenePass'});
  pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(n/256));pass.end();
  passCount++;fresh=false;return true;
}
function encodeDrainShuffle(enc){
  if(active!=='drain'||sim.nBodyParts>0||sim.n<2)return false;
  const n=sim.n;
  const pos=sim.livePos?.(),vel=sim.liveVel?.();
  const pred=sim.buf?.[sim.parity===0?'predA':'predB'];
  if(!pos||!vel||!pred)return false;
  shuffleSerial++;
  let offset=(Math.imul(shuffleSerial,2654435761)>>>0)%n;
  if(offset===0)offset=Math.max(1,Math.floor(n*.381966));
  shuffleU[0]=n;shuffleU[1]=offset;shuffleU[2]=0;shuffleU[3]=0;
  dev.queue.writeBuffer(shuffleUni,0,shuffleU);
  const bg=dev.createBindGroup({layout:shufflePipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:shuffleUni}},{binding:1,resource:{buffer:pos}},
    {binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:pred}},
    {binding:4,resource:{buffer:scratchPos}},{binding:5,resource:{buffer:scratchVel}},
    {binding:6,resource:{buffer:scratchPred}},
  ]});
  const pass=enc.beginComputePass({label:'fluidV5M752DrainShufflePass'});
  pass.setPipeline(shufflePipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(n/256));pass.end();
  const bytes=n*16;
  enc.copyBufferToBuffer(scratchPos,0,pos,0,bytes);
  enc.copyBufferToBuffer(scratchVel,0,vel,0,bytes);
  enc.copyBufferToBuffer(scratchPred,0,pred,0,bytes);
  sim.bindCache=null;
  return true;
}
function postSolveProxy(enc){
  return new Proxy(enc,{get(target,prop){
    if(prop==='finish')return(...args)=>{try{encodeDrainShuffle(target)}catch(err){console.error('[M7.5.2 drain shuffle]',err)}return target.finish(...args)};
    const value=Reflect.get(target,prop,target);return typeof value==='function'?value.bind(target):value;
  }});
}

dev.createCommandEncoder=function(desc){
  const enc=baseCreate(desc);
  if(inStep&&active!=='none'){
    try{encodeScene(enc)}catch(err){console.error('[M7.5.3 scene pass]',err);restoreFullCount();active='none';fresh=false;syncUI();}
    return active==='drain'?postSolveProxy(enc):enc;
  }
  return enc;
};
sim.step=function(dt){
  lastDt=Number.isFinite(dt)?dt:lastDt;
  advanceDrain(lastDt);
  inStep=true;try{return baseStep(dt)}finally{inStep=false;}
};

function disable(){restoreFullCount();active='none';fresh=false;syncUI();}
function choose(name){
  if(!(name in MODE)||name==='none')return;
  restoreFullCount();
  wave.disable();
  baseSceneChoose('pool');
  active=name;fresh=true;time=0;seed++;sourceCursor=(seed*97)%Math.max(1,fullN);lastPulse=-1e9;pulses=0;recycled=0;shuffleSerial=0;
  if(ui.paused)ui.paused=false;
  syncUI();
}
scenes.choose=function(name){disable();return baseSceneChoose(name)};

const tabbar=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');let scenePage=null;
if(tabbar&&host){const tabs=[...tabbar.children];const idx=tabs.findIndex(b=>b.dataset.key==='scenes');if(idx>=0)scenePage=host.children[idx]||null;}
let status=null;const buttons=[];
function slider(parent,label,min,max,step,value,onchange,format=v=>Number(v).toFixed(2)){
  const row=document.createElement('div');row.className='m742Row';
  const l=document.createElement('label');l.textContent=label;
  const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;
  const val=document.createElement('div');val.className='m742Val';val.textContent=format(value);
  input.oninput=e=>{e.stopPropagation();onchange(Number(input.value));val.textContent=format(Number(input.value));syncUI()};
  row.append(l,input,val);parent.appendChild(row);return input;
}
function syncUI(){
  for(const b of buttons)b.classList.toggle('active',b.dataset.scene===active);
  const remain=100*sim.n/fullN;
  if(status)status.textContent=`ACTIVE ${active==='none'?'POOL / WAVE LAB':LABEL[active]}\nscene passes ${passCount} · feature queue submits 0\nsource pulses ${pulses} · recycled water ${recycled.toLocaleString()}\nstrength ${strength.toFixed(2)} · source flow ${amount.toFixed(2)} · drain ${drainRate.toFixed(3)}/s\nwater remaining ${remain.toFixed(1)}% · drained ${drained.toLocaleString()}`;
}
if(scenePage){
  scenePage.querySelectorAll('.m742Locked').forEach(n=>n.remove());
  const sec=document.createElement('div');sec.className='m742Section';
  sec.innerHTML='<div class="m742SectionTitle">GRAVITY-RELEASE FLOW · M7.5.3</div><div class="m742Note">Faucet and Waterfall release coherent water at their outlets with only a small inlet velocity. After release, the shared PBF pressure solver, world gravity, and collisions determine the stream and splash—the same physical model used by Pour. All work stays inside the one-submit frame.</div>';
  const grid=document.createElement('div');grid.className='m742Grid';
  for(const [name,label] of [['rain','RAIN'],['pour','GRAVITY POUR'],['faucet','FAUCET'],['waterfall','WATERFALL'],['paddle','PADDLE'],['whirlpool','WHIRLPOOL'],['fountain','FOUNTAIN'],['drain','DRAIN']]){
    const b=document.createElement('button');b.className='m742Btn';b.dataset.scene=name;b.textContent=label;
    b.onclick=e=>{e.preventDefault();e.stopPropagation();choose(name)};buttons.push(b);grid.appendChild(b);
  }
  sec.appendChild(grid);
  slider(sec,'FORCE / SPEED',.45,1.70,.05,strength,v=>strength=v);
  slider(sec,'SOURCE FLOW',.12,.82,.02,amount,v=>amount=v);
  slider(sec,'PADDLE FREQ',.20,1.40,.05,frequency,v=>frequency=v,v=>`${Number(v).toFixed(2)} Hz`);
  slider(sec,'POUR GATE',.45,2.20,.05,releaseTime,v=>releaseTime=v,v=>`${Number(v).toFixed(2)} s`);
  slider(sec,'DRAIN RATE',.020,.160,.005,drainRate,v=>drainRate=v,v=>`${Number(v).toFixed(3)}/s`);
  scenePage.appendChild(sec);status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';scenePage.appendChild(status);
  for(const b of scenePage.querySelectorAll('button')){
    const t=(b.textContent||'').trim();if(t==='POOL'||t==='DAM BREAK')b.addEventListener('click',disable,{capture:true});
  }
  setInterval(syncUI,500);syncUI();
}

window.__v5M752PhysicalScenes={
  online:true,backend:'gravity-release-pbf-sources-m753',gpuPassesAddedWhenActive:1,gpuSubmitsAdded:0,
  choose,disable,get active(){return active},get passCount(){return passCount},get pulses(){return pulses},
  get recycled(){return recycled},get drained(){return drained},get remaining(){return sim.n/fullN},
  get strength(){return strength},get amount(){return amount},get drainRate(){return drainRate}
};
window.__fluidV5Version='7.5.3';window.__fluidV5Build='M7.5.3 GRAVITY-RELEASE FAUCET + WATERFALL / M7.3.9 ONE-SUBMIT CORE';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V5 · M7.5.2';
document.title='Fluid V5 · M7.5.2 Coherent Flow Scenes';
console.info('[Fluid V5 M7.5.3] gravity-release faucet/waterfall online; world gravity + PBF own motion after the inlet.');
