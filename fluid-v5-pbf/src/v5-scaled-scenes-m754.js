// Fluid V5 M7.5.5 — finer fountain reconstruction + circular Rankine whirlpool.
// Fountain is now mass-conserving: it pumps the existing PBF water through a narrow near-surface nozzle
// instead of continuously appending new fluid to a closed tank. This prevents the pool from overfilling
// and exploding into oversized disconnected blobs. During fountain mode SSFR splats are reduced slightly
// so isolated spray reads finer, while the underlying solver particle spacing remains unchanged.
// Whirlpool now uses a Rankine velocity profile: solid-body rotation in the core, potential-vortex falloff
// outside the core, with radial motion damped instead of artificial inward/downward forcing. The circular
// pressure gradient is therefore responsible for the free-surface depression. One unified GPU submit/frame.

const sim=window.__sim,ui=window.__ui,scenes=window.__v5M743Scenes,wave=window.__v5M745WaveLab,modern=window.__v5M752PhysicalScenes,ssfr=window.__ssfr;
if(!sim?.dev||!ui||!scenes?.online||!wave?.online||!modern?.online||!window.__v5M739Unified?.online)
  throw new Error('M7.5.5 refined scenes: unified runtime unavailable.');
const dev=sim.dev;
const baseN=Math.max(1,sim.scene?.nFluid||sim.n||1);
const baseSplat=ssfr?.splatRadius??1.0;
let active='none',passes=0,start=performance.now();
let fountainHeight=.28,fountainGain=1.0,vortexOmega=6.8,vortexGain=1.0,vortexCore=.25;

function poolSurface(){
  const b=sim.params.box,d=sim.params.spacing||.044;
  const nx=Math.max(1,Math.floor(Math.max(d,b[0]-2*d)/d));
  const nz=Math.max(1,Math.floor(Math.max(d,b[2]-2*d)/d));
  const layers=Math.max(1,Math.ceil(baseN/(nx*nz)));
  return Math.min(b[1]-2*d,(layers+1)*d);
}
function jetSpeed(){
  const g=Math.max(1,sim.params.gravity||9.81);
  return Math.sqrt(Math.max(.02,2*g*fountainHeight));
}
function restoreCount(){
  if(sim.n!==baseN){sim.n=baseN;sim.uploadParams?.(1/240);sim.bindCache=null;}
}
function applyRenderDetail(){
  if(!ssfr)return;
  // This only changes the reconstructed splat radius, not the physical PBF particle size.
  ssfr.splatRadius=active==='fountain'?Math.min(baseSplat,.76):baseSplat;
  ssfr.bindCache=null;
}

const effectWGSL=`
struct EffectU {
  box:vec4f,
  motion:vec4f,
  params:vec4f,
  info:vec4u,
}
@group(0) @binding(0) var<uniform> U:EffectU;
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
fn safeDir(q:vec2f)->vec2f {
  let m=length(q);
  return select(vec2f(0.0),q/m,m>1.0e-6);
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;
  let n=U.info.x;
  if(i>=n){return;}
  let mode=U.info.y;
  let p=pos[i].xyz;
  var v=vel[i].xyz;
  let b=U.box.xyz;
  let d=max(U.box.w,.001);
  let surface=U.motion.x;
  let drive=U.motion.y;
  let gain=U.motion.z;
  let t=U.motion.w;
  let centre=vec2f(b.x*.5,b.z*.5);
  let q=p.xz-centre;
  let r=length(q);
  let dir=safeDir(q);
  let tang=vec2f(-dir.y,dir.x);
  let ramp=smoothstep(0.0,1.5,t);

  // MODE 1: recirculating fountain pump. Existing water is accelerated through a narrow
  // near-surface nozzle; surrounding water feeds inward. No particles are created.
  if(mode==1u){
    let nozzleR=max(1.20*d,min(b.x,b.z)*.038);
    let feedR=max(4.8*d,nozzleR*3.8);
    let column=1.0-smoothstep(nozzleR*.58,nozzleR,r);
    let feed=(1.0-smoothstep(nozzleR,feedR,r))*(1.0-column);
    let nozzleBottom=max(2.0*d,surface-max(.20,5.0*d));
    let topWeight=smoothstep(nozzleBottom,surface+.25*d,p.y);
    let exitMask=1.0-smoothstep(surface+.40*d,surface+1.65*d,p.y);
    let wet=1.0-smoothstep(surface+2.0*d,surface+5.0*d,p.y);
    let pump=column*topWeight*exitMask*wet*ramp;
    let blend=clamp((.12+.16*topWeight)*gain*pump,0.0,.34);
    v.y=mix(v.y,drive,blend);
    // Gentle submerged lift keeps the nozzle supplied without forcing the entire pool upward.
    let stem=column*(1.0-topWeight)*wet*ramp;
    v.y=mix(v.y,drive*.22,.025*gain*stem);
    // Physically plausible intake around the nozzle: small radial convergence below the surface.
    let intake=feed*(1.0-smoothstep(surface-.10,surface+.08,p.y))*wet*ramp;
    v.x-=dir.x*.055*gain*intake;
    v.z-=dir.y*.055*gain*intake;
  }

  // MODE 2: circular Rankine vortex. Forced-vortex core (v_theta = omega r), then
  // potential-vortex falloff (v_theta = omega rc^2 / r). No artificial downward core.
  if(mode==2u){
    let R=min(b.x,b.z)*.46;
    if(r<R){
      let coreR=max(2.5*d,R*U.params.x);
      let omega=drive;
      let vtCore=omega*r;
      let vtOuter=omega*coreR*coreR/max(r,coreR);
      let vt=select(vtOuter,vtCore,r<=coreR);
      let wallFade=1.0-smoothstep(R*.88,R,r);
      let wet=1.0-smoothstep(surface+1.4*d,surface+4.0*d,p.y);
      let depth=.40+.60*smoothstep(2.0*d,max(surface,5.0*d),p.y);
      let blend=clamp((.070+.080*(1.0-r/R))*gain*wallFade*wet*depth*ramp,0.0,.24);
      var vr=dot(v.xz,dir);
      var vv=dot(v.xz,tang);
      vv=mix(vv,vt,blend);
      // Remove non-circular slosh gradually while preserving the pressure-driven vertical response.
      vr*=1.0-clamp(.45*blend,0.0,.12);
      v.x=dir.x*vr+tang.x*vv;
      v.z=dir.y*vr+tang.y*vv;
      v.y*=1.0-clamp(.10*blend,0.0,.025);
    }
  }
  vel[i]=vec4f(v,0.0);
}`;

const mod=dev.createShaderModule({code:effectWGSL,label:'fluidV5M755FountainRankineWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M7.5.5 effect WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M755FountainRankine',layout:'auto',compute:{module:mod,entryPoint:'main'}});
const uni=dev.createBuffer({label:'fluidV5M755EffectUniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(16),I=new Uint32Array(F.buffer);
let inStep=false;
const baseStep=sim.step.bind(sim),baseCreate=dev.createCommandEncoder.bind(dev);
function encodeEffect(enc){
  if(active!=='fountain'&&active!=='whirlpool')return false;
  const b=sim.params.box,d=sim.params.spacing||.044,s=poolSurface(),t=(performance.now()-start)*.001;
  F.fill(0);
  F[0]=b[0];F[1]=b[1];F[2]=b[2];F[3]=d;
  F[4]=s;F[5]=active==='fountain'?jetSpeed():vortexOmega;F[6]=active==='fountain'?fountainGain:vortexGain;F[7]=t;
  F[8]=vortexCore;F[9]=0;F[10]=0;F[11]=0;
  I[12]=Math.max(1,sim.n||1);I[13]=active==='fountain'?1:2;I[14]=0;I[15]=0;
  dev.queue.writeBuffer(uni,0,F);
  const pos=sim.livePos?.(),vel=sim.liveVel?.();if(!pos||!vel)return false;
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:vel}}
  ]});
  const pass=enc.beginComputePass({label:'fluidV5M755EffectPass'});
  pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(sim.n/256));pass.end();passes++;return true;
}
dev.createCommandEncoder=function(desc){
  const enc=baseCreate(desc);
  if(inStep&&(active==='fountain'||active==='whirlpool')){
    try{encodeEffect(enc)}catch(err){console.error('[M7.5.5 effect]',err)}
  }
  return enc;
};
sim.step=function(dt){inStep=true;try{return baseStep(dt)}finally{inStep=false;}};

function disable(){
  if(active==='none')return;
  active='none';restoreCount();applyRenderDetail();syncUI();
}
function choose(name){
  if(name!=='fountain'&&name!=='whirlpool')return;
  modern.disable();wave.disable();restoreCount();scenes.choose('pool');
  active=name;passes=0;start=performance.now();
  if(ui.paused)ui.paused=false;
  applyRenderDetail();syncUI();
}

const tabbar=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');let scenePage=null,status=null,fBtn=null,wBtn=null;
if(tabbar&&host){const tabs=[...tabbar.children],idx=tabs.findIndex(b=>b.dataset.key==='scenes');if(idx>=0)scenePage=host.children[idx]||null;}
function slider(parent,label,min,max,step,value,onchange,fmt=v=>Number(v).toFixed(2)){
  const row=document.createElement('div');row.className='m742Row';const l=document.createElement('label');l.textContent=label;
  const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;
  const val=document.createElement('div');val.className='m742Val';val.textContent=fmt(value);
  input.oninput=e=>{e.stopPropagation();const n=Number(input.value);onchange(n);val.textContent=fmt(n);syncUI()};row.append(l,input,val);parent.appendChild(row);return input;
}
function rewire(name,handler){
  const old=scenePage?.querySelector(`button[data-scene="${name}"]`);if(!old)return null;
  const b=old.cloneNode(true);b.onclick=e=>{e.preventDefault();e.stopPropagation();handler()};old.replaceWith(b);return b;
}
function syncUI(){
  fBtn?.classList.toggle('active',active==='fountain');wBtn?.classList.toggle('active',active==='whirlpool');
  if(!status)return;
  status.textContent=`M7.5.5 ${active==='none'?'STANDBY':active.toUpperCase()}\nphysical spacing ${(sim.params.spacing||.044).toFixed(4)} m · SSFR splat ${(ssfr?.splatRadius??1).toFixed(2)}\nfountain peak ${fountainHeight.toFixed(2)} m · jet ${jetSpeed().toFixed(2)} m/s · mass added 0\nRankine vortex ω ${vortexOmega.toFixed(1)} rad/s · core ${(vortexCore*100).toFixed(0)}% radius · passes ${passes} · feature submits 0`;
}
if(scenePage){
  fBtn=rewire('fountain',()=>choose('fountain'));wBtn=rewire('whirlpool',()=>choose('whirlpool'));
  scenePage.addEventListener('click',e=>{const b=e.target.closest?.('button');if(!b)return;const n=b.dataset?.scene;if(n!=='fountain'&&n!=='whirlpool'&&active!=='none')disable();},true);
  const sec=document.createElement('div');sec.className='m742Section';
  sec.innerHTML='<div class="m742SectionTitle">FINE FOUNTAIN + CIRCULAR VORTEX · M7.5.5</div><div class="m742Note">Fountain now recirculates the existing pool instead of adding mass, which removes the overfill/spray explosion. Whirlpool uses a circular Rankine vortex: solid-body core plus 1/r outer swirl. The surface depression comes from centrifugal pressure, not an artificial downward funnel force. LOW still uses 4.4 cm physical particle spacing; the smaller fountain droplets use a tighter SSFR reconstruction only.</div>';
  slider(sec,'FOUNTAIN PEAK',.12,.55,.02,fountainHeight,v=>fountainHeight=v,v=>`${Number(v).toFixed(2)} m`);
  slider(sec,'FOUNTAIN GAIN',.55,1.60,.05,fountainGain,v=>fountainGain=v);
  slider(sec,'VORTEX OMEGA',3.0,10.0,.2,vortexOmega,v=>vortexOmega=v,v=>`${Number(v).toFixed(1)} rad/s`);
  slider(sec,'VORTEX CORE',.14,.38,.01,vortexCore,v=>vortexCore=v,v=>`${Math.round(Number(v)*100)}%`);
  slider(sec,'VORTEX DRIVE',.60,1.65,.05,vortexGain,v=>vortexGain=v);
  status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';sec.appendChild(status);scenePage.appendChild(sec);setInterval(syncUI,350);syncUI();
}
const auto=new URLSearchParams(location.search).get('scene');if(auto==='fountain'||auto==='whirlpool')setTimeout(()=>choose(auto),340);
window.__v5M754ScaledScenes={
  online:true,backend:'mass-conserving-fountain-rankine-vortex-m755',gpuSubmitsAdded:0,choose,disable,
  get active(){return active},get added(){return 0},get passes(){return passes},get surface(){return poolSurface()},
  get jetSpeed(){return jetSpeed()},get vortexOmega(){return vortexOmega},get vortexCore(){return vortexCore}
};
window.__fluidV5Version='7.5.5';window.__fluidV5Build='M7.5.5 FINE FOUNTAIN + CIRCULAR RANKINE VORTEX / M7.3.9 ONE-SUBMIT CORE';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V5 · M7.5.5';document.title='Fluid V5 · M7.5.5 Fine Fountain + Rankine Vortex';
console.info('[Fluid V5 M7.5.5] mass-conserving fountain + circular Rankine vortex online; feature submits 0.');