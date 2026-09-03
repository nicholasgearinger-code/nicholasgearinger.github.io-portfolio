// Fluid V5 M7.5.1 — legacy scene-fidelity restore on the M7.3.9 one-submit scheduler.
// M7.5.0 proved the unified scene pass was stable, but it intentionally changed the old scene
// semantics: Faucet/Waterfall/Fountain became one-shot rearrangements and Paddle/Whirlpool became
// broad fields. M7.5.1 restores the old continuous-source/localized-forcing character while
// keeping every feature command inside the already-shared frame command buffer.
//
// Source scenes use a rotating recycle ring of the existing PBF water instead of appendFluid().
// That preserves one-submit iOS safety and constant particle count while behaving like a hidden
// recirculating reservoir: each pulse takes a few pool particles and respawns them at the old
// source location/velocity. Gravity Pour is restored as a held elevated reservoir with a timed
// gate release instead of a launched block.

const sim=window.__sim, ui=window.__ui, scenes=window.__v5M743Scenes, wave=window.__v5M745WaveLab;
if(!sim?.dev||!ui||!scenes?.online||!wave?.online||!window.__v5M739Unified?.online)
  throw new Error('M7.5.1 legacy scenes: stable unified scene runtime unavailable.');
const dev=sim.dev;
const quality=new URLSearchParams(location.search).get('quality')||'low';

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

  // RAIN — rotating real-water droplets. The old M5.6 rain system visually decoupled tiny rain
  // from PBF mass; this hydrodynamic test keeps the impact character while remaining one pass.
  if(mode==1u && rank>=0){
    let r=u32(rank);
    let hx=hash11(r*3u+seed*17u+11u);
    let hy=hash11(r*3u+seed*29u+23u);
    let hz=hash11(r*3u+seed*41u+37u);
    p=vec4f(d*1.7+hx*(bx-d*3.4),by*(0.66+0.27*hy),d*1.7+hz*(bz-d*3.4),1.0);
    v=vec4f((hx-.5)*.08,-(1.65+.75*hy)*strength,(hz-.5)*.08,0.0);
    pred[i]=p;
  }

  // GRAVITY POUR — real elevated reservoir at rest. For a short hold interval the selected
  // reservoir particles are supported by a virtual shelf/gate. Release removes that support;
  // gravity and the normal PBF solve create the fall. No launch trajectory is prescribed.
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
      v=vec4f(0.0);
      pred[i]=p;
    }
    if(i<reservoirCount && t<releaseTime){
      v=vec4f(0.0);
      // Keep the elevated reservoir stable until the virtual gate opens.
      p.y=max(p.y,by*.695);
      p.x=min(p.x,bx*.615);
      pred[i]=p;
    }
  }

  // FAUCET — restored M4.6 character: narrow continuous jet from the left, slightly downward.
  if(mode==3u && rank>=0){
    let r=u32(rank);
    let a=hash11(r*5u+seed*13u+3u);
    let b=hash11(r*7u+seed*19u+5u);
    let c=hash11(r*11u+seed*23u+9u);
    p=vec4f(bx*.14+(a-.5)*d*2.2,by*.79+(b-.5)*d,bz*.50+(c-.5)*d*3.2,1.0);
    v=vec4f((.72+(a-.5)*.10)*strength,-(.28+b*.15)*strength,(c-.5)*.12*strength,0.0);
    pred[i]=p;
  }

  // WATERFALL — restored wall-fed sheet source. Pulses are distributed across Z so SSFR joins
  // them into a coherent falling sheet instead of the M7.5.0 one-shot elevated block.
  if(mode==4u && rank>=0){
    let r=u32(rank);
    let den=max(count-1u,1u);
    let lane=f32(r)/f32(den);
    let a=hash11(r*5u+seed*31u+7u);
    let b=hash11(r*7u+seed*37u+11u);
    p=vec4f(bx*.10+(a-.5)*d,by*.82+(b-.5)*d,bz*(.18+.64*lane)+(a-.5)*d*.8,1.0);
    v=vec4f(.48*strength,-(1.05+b*.22)*strength,(a-.5)*.04*strength,0.0);
    pred[i]=p;
  }

  // PADDLE — localized oscillating impulse near the left wall, matching the old M4.6 placement
  // rather than modifying a broad fraction of the entire tank.
  if(mode==5u){
    let phase=sin(t*4.2);
    let centre=vec3f(bx*.08,surface*.95,bz*.50);
    let dx=(p.x-centre.x)/max(bx*.20,d*5.0);
    let dz=(p.z-centre.z)/max(bz*.32,d*6.0);
    let dy=(p.y-centre.y)/max(surface*.85,d*8.0);
    let r2=dx*dx+dz*dz+dy*dy*.16;
    let w=pow(max(0.0,1.0-r2),2.0);
    if(w>0.0){
      v.x+=.22*phase*w*strength;
      v.y+=.035*phase*w*strength;
      v.z+=.018*sin(t*2.1)*w*strength;
    }
  }

  // WHIRLPOOL — four moving localized tangential impulse zones on the old ring geometry.
  if(mode==6u){
    let centre=vec2f(bx*.50,bz*.50);
    let R=min(bx,bz)*.24;
    let rr=max(d*4.0,R*.62);
    for(var k:u32=0u;k<4u;k=k+1u){
      let a=t*.45+f32(k)*1.57079633;
      let c=centre+vec2f(cos(a),sin(a))*R;
      let q=p.xz-c;
      let w=pow(max(0.0,1.0-length(q)/rr),2.0);
      if(w>0.0){
        let tang=vec2f(-sin(a),cos(a));
        v.x+=tang.x*.13*w*strength;
        v.z+=tang.y*.13*w*strength;
        v.y-=.025*w*strength;
      }
    }
  }

  // FOUNTAIN — restored discrete bottom-centre source pulses. These become genuine ballistic/PBF
  // arcs after leaving the nozzle instead of being continuously accelerated throughout a column.
  if(mode==7u && rank>=0){
    let r=u32(rank);
    let a=hash11(r*5u+seed*17u)*6.2831853;
    let h=hash11(r*7u+seed*29u+3u);
    let rad=d*(.4+h*1.4);
    p=vec4f(bx*.5+cos(a)*rad,by*.16,bz*.5+sin(a)*rad,1.0);
    v=vec4f(cos(a)*.12*strength,(1.25+h*.34)*strength,sin(a)*.12*strength,0.0);
    pred[i]=p;
  }

  // DRAIN — retained as a local suction/vortex stress test. No particles are deleted.
  if(mode==8u){
    let centre=vec2f(bx*.50,bz*.50);
    let q=p.xz-centre;
    let r=length(q);
    let R=min(bx,bz)*.32;
    let w=1.0-smoothstep(R*.10,R,r);
    let wet=1.0-smoothstep(surface*1.02,surface*1.28,p.y);
    let dir=safe2(q);
    let tang=vec2f(-dir.y,dir.x);
    v.x+=(-dir.x*.040+tang.x*.020)*strength*w*wet;
    v.z+=(-dir.y*.040+tang.y*.020)*strength*w*wet;
    let core=1.0-smoothstep(0.0,R*.25,r);
    v.y-=strength*(.014*w+.030*core)*wet;
  }

  pos[i]=p;
  vel[i]=v;
}`;

const mod=dev.createShaderModule({code:shader,label:'fluidV5M751LegacyScenesWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M7.5.1 scene WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M751LegacyScenes',layout:'auto',compute:{module:mod,entryPoint:'main'}});
const uni=dev.createBuffer({label:'fluidV5M751SceneUniform',size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(24), U32=new Uint32Array(F.buffer);

const MODE={none:0,rain:1,pour:2,faucet:3,waterfall:4,paddle:5,whirlpool:6,fountain:7,drain:8};
const LABEL={rain:'RAIN',pour:'GRAVITY POUR',faucet:'FAUCET',waterfall:'WATERFALL',paddle:'PADDLE',whirlpool:'WHIRLPOOL',fountain:'FOUNTAIN',drain:'DRAIN'};
const SOURCE=new Set(['rain','faucet','waterfall','fountain']);
let active='none',fresh=false,inStep=false,lastDt=1/60,time=0,passCount=0,seed=1;
let strength=1.0,amount=.34,frequency=.67,releaseTime=1.15;
let sourceCursor=0,lastPulse=-1e9,pulses=0,recycled=0;
const baseStep=sim.step.bind(sim),baseCreate=dev.createCommandEncoder.bind(dev),baseSceneChoose=scenes.choose.bind(scenes);

function cadence(name){
  if(name==='rain')return quality==='high'?0.038:quality==='medium'?0.050:0.068;
  if(name==='waterfall')return quality==='high'?0.050:quality==='medium'?0.066:0.082;
  return 0.090;
}
function pulseSize(name){
  const m=.72+.80*amount;
  if(name==='rain')return Math.max(1,Math.round((quality==='high'?5:quality==='medium'?3:2)*m));
  if(name==='waterfall')return Math.max(6,Math.round((quality==='high'?18:quality==='medium'?14:10)*m));
  if(name==='faucet')return Math.max(3,Math.round(6*m));
  if(name==='fountain')return Math.max(3,Math.round(5*m));
  return 0;
}
function preparePulse(n){
  if(!SOURCE.has(active))return{start:0,count:0};
  const c=cadence(active);
  if(!fresh && time-lastPulse<c)return{start:0,count:0};
  lastPulse=time;
  const count=Math.min(n,pulseSize(active));
  const start=sourceCursor%n;
  sourceCursor=(sourceCursor+count)%n;
  pulses++;recycled+=count;
  return{start,count};
}
function encodeScene(enc){
  if(active==='none')return false;
  if(wave.enabled){active='none';fresh=false;syncUI();return false;}
  const b=sim.params.box,d=sim.params.spacing||.04,n=Math.max(1,sim.scene?.nFluid||sim.n||1);
  time+=Math.min(.05,Math.max(.001,lastDt));
  const pulse=preparePulse(n);
  F.fill(0);
  F[0]=b[0];F[1]=b[1];F[2]=b[2];F[3]=d;
  F[4]=time;F[5]=strength;F[6]=amount;F[7]=b[1]*.37;
  F[8]=frequency;F[9]=releaseTime;F[10]=0;F[11]=0;
  U32[12]=n;U32[13]=MODE[active]||0;U32[14]=pulse.start;U32[15]=pulse.count;
  U32[16]=fresh?1:0;U32[17]=seed;U32[18]=pulses;U32[19]=0;
  F[20]=0;F[21]=0;F[22]=0;F[23]=0;
  dev.queue.writeBuffer(uni,0,F);
  const pos=sim.livePos?.(),vel=sim.liveVel?.();
  const pred=sim.buf?.[sim.parity===0?'predA':'predB'];
  if(!pos||!vel||!pred)return false;
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},
    {binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:pred}},
  ]});
  const pass=enc.beginComputePass({label:'fluidV5M751LegacyScenePass'});
  pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(n/256));pass.end();
  passCount++;fresh=false;return true;
}

dev.createCommandEncoder=function(desc){
  const enc=baseCreate(desc);
  if(inStep&&active!=='none'){
    try{encodeScene(enc)}catch(err){console.error('[M7.5.1 legacy scene pass]',err);active='none';fresh=false;syncUI();}
  }
  return enc;
};
sim.step=function(dt){lastDt=Number.isFinite(dt)?dt:lastDt;inStep=true;try{return baseStep(dt)}finally{inStep=false}};

function disable(){active='none';fresh=false;syncUI();}
function choose(name){
  if(!(name in MODE)||name==='none')return;
  wave.disable();
  baseSceneChoose('pool');
  active=name;fresh=true;time=0;seed++;sourceCursor=(seed*97)%Math.max(1,sim.scene?.nFluid||sim.n||1);lastPulse=-1e9;pulses=0;recycled=0;
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
  if(status)status.textContent=`ACTIVE ${active==='none'?'POOL / WAVE LAB':LABEL[active]}\nlegacy-fidelity scene passes ${passCount} · feature queue submits 0\nsource pulses ${pulses} · recycled water ${recycled.toLocaleString()}\nstrength ${strength.toFixed(2)} · source flow ${amount.toFixed(2)} · pour gate ${releaseTime.toFixed(2)} s`;
}
if(scenePage){
  scenePage.querySelectorAll('.m742Locked').forEach(n=>n.remove());
  const sec=document.createElement('div');sec.className='m742Section';
  sec.innerHTML='<div class="m742SectionTitle">RESTORED SCENE BEHAVIOR · M7.5.1</div><div class="m742Note">Continuous source scenes are continuous again. Faucet, Waterfall and Fountain recycle a rotating handful of real PBF particles through their old source geometry; Paddle and Whirlpool use localized forcing; Gravity Pour is held at rest behind a timed virtual gate before gravity release. Still one GPU submission per frame.</div>';
  const grid=document.createElement('div');grid.className='m742Grid';
  for(const [name,label] of [['rain','RAIN'],['pour','GRAVITY POUR'],['faucet','FAUCET'],['waterfall','WATERFALL'],['paddle','PADDLE'],['whirlpool','WHIRLPOOL'],['fountain','FOUNTAIN'],['drain','DRAIN']]){
    const b=document.createElement('button');b.className='m742Btn';b.dataset.scene=name;b.textContent=label;
    b.onclick=e=>{e.preventDefault();e.stopPropagation();choose(name)};buttons.push(b);grid.appendChild(b);
  }
  sec.appendChild(grid);
  slider(sec,'FORCE / SPEED',.45,1.55,.05,strength,v=>strength=v);
  slider(sec,'SOURCE FLOW',.10,.70,.02,amount,v=>amount=v);
  slider(sec,'PADDLE FREQ',.20,1.40,.05,frequency,v=>frequency=v,v=>`${Number(v).toFixed(2)} Hz`);
  slider(sec,'POUR GATE',.45,2.20,.05,releaseTime,v=>releaseTime=v,v=>`${Number(v).toFixed(2)} s`);
  scenePage.appendChild(sec);status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';scenePage.appendChild(status);
  for(const b of scenePage.querySelectorAll('button')){
    const t=(b.textContent||'').trim();if(t==='POOL'||t==='DAM BREAK')b.addEventListener('click',disable,{capture:true});
  }
  syncUI();
}

window.__v5M751PhysicalScenes={online:true,backend:'legacy-fidelity-recycle-pass-m751',gpuPassesAddedWhenActive:1,gpuSubmitsAdded:0,choose,disable,get active(){return active},get passCount(){return passCount},get pulses(){return pulses},get recycled(){return recycled},get strength(){return strength},get amount(){return amount}};
window.__fluidV5Version='7.5.1';window.__fluidV5Build='M7.5.1 LEGACY SCENE FIDELITY / M7.3.9 ONE-SUBMIT CORE';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V5 · M7.5.1';
document.title='Fluid V5 · M7.5.1 Restored Scene Behavior';
console.info('[Fluid V5 M7.5.1] legacy scene behavior restored with recycled PBF sources; zero added queue submits.');
