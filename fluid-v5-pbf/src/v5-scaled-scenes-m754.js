// Fluid V5 M7.5.4 — scale fountain + whirlpool to the CURRENT deep pool instead of replaying M4.6 constants.
// The old M4.6 fountain launched from y=0.16*box with only ~1.25..1.59 m/s vertical speed.
// In the current pool that nozzle is far below the free surface, so the jet cannot physically emerge.
// This build estimates the actual pool surface, emits a connected real-particle jet just below it,
// and drives a whole-body angular velocity field so PBF damping cannot erase the whirlpool.
// All vortex work is encoded into the existing M7.3.9 unified command buffer; feature submits = 0.

const sim=window.__sim,ui=window.__ui,scenes=window.__v5M743Scenes,wave=window.__v5M745WaveLab,modern=window.__v5M752PhysicalScenes;
if(!sim?.dev||!sim?.appendFluid||!ui||!scenes?.online||!wave?.online||!modern?.online||!window.__v5M739Unified?.online)
  throw new Error('M7.5.4 scaled scenes: unified runtime unavailable.');
const dev=sim.dev;
const baseN=Math.max(1,sim.scene?.nFluid||sim.n||1);
const quality=new URLSearchParams(location.search).get('quality')||'low';
let active='none',added=0,passes=0,start=performance.now(),readyAt=0,lastSource=0,seed=0x75412345;
let fountainHeight=.58,fountainFlow=1.0,vortexOmega=4.1,vortexGain=1.0;
const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};

function poolSurface(){
  const b=sim.params.box,d=sim.params.spacing||.044;
  const nx=Math.max(1,Math.floor(Math.max(d,b[0]-2*d)/d));
  const nz=Math.max(1,Math.floor(Math.max(d,b[2]-2*d)/d));
  const layers=Math.max(1,Math.ceil(baseN/(nx*nz)));
  return Math.min(b[1]-2*d,(layers+1)*d);
}
function restoreCount(){if(sim.n!==baseN){sim.n=baseN;sim.uploadParams?.(1/240);sim.bindCache=null;}added=0;}
function budget(){return Math.max(0,Math.min(4200,(sim.cap||sim.n)-sim.n-32));}
function appendCloud(p,v){const room=budget(),n=Math.min(room,p.length/3|0);if(n<=0)return 0;const a=sim.appendFluid(p.slice(0,n*3),v.slice(0,n*3));added+=a;return a;}
function fountainLaunch(){
  const d=sim.params.spacing||.044,s=poolSurface(),g=Math.max(1,sim.params.gravity||9.81);
  const nozzleY=Math.max(2*d,s-1.25*d),peak=Math.min(sim.params.box[1]-2*d,s+fountainHeight);
  return {surface:s,nozzleY,speed:Math.sqrt(Math.max(.05,2*g*(peak-nozzleY)))*1.06};
}
function emitFountain(now){
  const room=budget();if(room<=0)return;
  const b=sim.params.box,d=sim.params.spacing||.044,J=fountainLaunch();
  const dt=Math.min(.05,Math.max(.001,(now-lastSource)*.001));lastSource=now;
  // Emit enough vertical layers to keep layer spacing below the PBF particle spacing.
  const layerStep=d*.76;
  const layers=Math.max(1,Math.min(5,Math.ceil(J.speed*dt/layerStep)));
  const p=[],v=[];
  for(let l=0;l<layers;l++){
    const y=J.nozzleY+l*layerStep*.92;
    // 5-point connected nozzle cross-section: center + four neighbours.
    const ring=[[0,0],[.56,0],[-.56,0],[0,.56],[0,-.56]];
    for(const q of ring){
      const jx=(rnd()-.5)*d*.08,jz=(rnd()-.5)*d*.08;
      p.push(b[0]*.50+q[0]*d+jx,y,b[2]*.50+q[1]*d+jz);
      const side=.055;
      v.push(q[0]*side+(rnd()-.5)*.018,J.speed*(.965+rnd()*.07),q[1]*side+(rnd()-.5)*.018);
    }
  }
  appendCloud(p,v);
}

const vortexWGSL=`
struct VortexU { box:vec4f, motion:vec4f, data:vec4u }
@group(0) @binding(0) var<uniform> U:VortexU;
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
fn safeDir(v:vec2f)->vec2f { let m=length(v); return select(vec2f(0.0),v/m,m>1.0e-6); }
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;let n=U.data.x;if(i>=n){return;}
  let p=pos[i].xyz;var v=vel[i].xyz;
  let b=U.box.xyz;let d=max(U.box.w,.001);let surface=U.motion.x;
  let omega=U.motion.y;let gain=U.motion.z;let t=U.motion.w;
  let centre=vec2f(b.x*.5,b.z*.5);let q=p.xz-centre;let r=length(q);
  let R=min(b.x,b.z)*.46;if(r>=R){return;}
  let dir=safeDir(q);let tang=vec2f(-dir.y,dir.x);let rn=clamp(r/max(R,1.0e-5),0.0,1.0);
  let wet=1.0-smoothstep(surface+d,surface+4.0*d,p.y);
  let depth=.30+.70*smoothstep(d*2.0,max(surface,d*4.0),p.y);
  let ramp=smoothstep(0.0,1.15,t);
  let spinSpeed=omega*r*(.72+.28*rn);
  let inward=.105*gain*(1.0-rn);
  let goalXZ=tang*spinSpeed-dir*inward;
  let blend=clamp((.070+.105*(1.0-rn))*gain*wet*depth*ramp,0.0,.32);
  v.x=mix(v.x,goalXZ.x,blend);v.z=mix(v.z,goalXZ.y,blend);
  // A bounded downward-core target helps the rotating pressure field open a visible free-surface funnel.
  let core=1.0-smoothstep(d*1.4,R*.17,r);
  let collar=smoothstep(R*.20,R*.34,r)*(1.0-smoothstep(R*.34,R*.58,r));
  let downGoal=-.58*gain*ramp;
  v.y=mix(v.y,downGoal,.085*core*wet*ramp);
  v.y=mix(v.y,.045*gain*ramp,.012*collar*wet*ramp);
  vel[i]=vec4f(v,0.0);
}`;
const mod=dev.createShaderModule({code:vortexWGSL,label:'fluidV5M754ScaledVortexWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M7.5.4 vortex WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M754ScaledVortex',layout:'auto',compute:{module:mod,entryPoint:'main'}});
const uni=dev.createBuffer({label:'fluidV5M754ScaledVortexUniform',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(12),I=new Uint32Array(F.buffer);
let inStep=false;const baseStep=sim.step.bind(sim),baseCreate=dev.createCommandEncoder.bind(dev);
function encodeVortex(enc){
  if(active!=='whirlpool')return false;
  const b=sim.params.box,d=sim.params.spacing||.044,s=poolSurface(),t=(performance.now()-start)*.001;
  F.fill(0);F[0]=b[0];F[1]=b[1];F[2]=b[2];F[3]=d;F[4]=s;F[5]=vortexOmega;F[6]=vortexGain;F[7]=t;I[8]=Math.max(1,sim.n||1);
  dev.queue.writeBuffer(uni,0,F);
  const pos=sim.livePos?.(),vel=sim.liveVel?.();if(!pos||!vel)return false;
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:vel}}]});
  const pass=enc.beginComputePass({label:'fluidV5M754ScaledVortexPass'});pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(sim.n/256));pass.end();passes++;return true;
}
dev.createCommandEncoder=function(desc){const enc=baseCreate(desc);if(inStep&&active==='whirlpool'){try{encodeVortex(enc)}catch(err){console.error('[M7.5.4 vortex]',err)}}return enc;};
sim.step=function(dt){inStep=true;try{return baseStep(dt)}finally{inStep=false;}};

function disable(){if(active==='none')return;active='none';restoreCount();syncUI();}
function choose(name){
  if(name!=='fountain'&&name!=='whirlpool')return;
  modern.disable();wave.disable();restoreCount();scenes.choose('pool');
  active=name;added=0;passes=0;start=performance.now();readyAt=start+220;lastSource=start;seed=(seed+0x9e3779b9)>>>0;
  if(ui.paused)ui.paused=false;syncUI();
}
function sourceLoop(now){
  requestAnimationFrame(sourceLoop);if(document.hidden||ui.paused||active!=='fountain'||now<readyAt)return;
  if(wave.enabled){disable();return;}const minGap=quality==='high'?12:quality==='medium'?14:16;if(now-lastSource<minGap)return;emitFountain(now);
}
requestAnimationFrame(sourceLoop);

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
  if(!status)return;const J=fountainLaunch();
  status.textContent=`M7.5.4 ${active==='none'?'STANDBY':active.toUpperCase()}\ncurrent pool surface ≈ ${J.surface.toFixed(3)} m · old nozzle 0.400 m · corrected nozzle ${J.nozzleY.toFixed(3)} m\nfountain launch ${J.speed.toFixed(2)} m/s · appended ${added.toLocaleString()} · budget ${budget().toLocaleString()}\nvortex ω ${vortexOmega.toFixed(2)} rad/s · gain ${vortexGain.toFixed(2)} · unified passes ${passes} · feature submits 0`;
}
if(scenePage){
  fBtn=rewire('fountain',()=>choose('fountain'));wBtn=rewire('whirlpool',()=>choose('whirlpool'));
  scenePage.addEventListener('click',e=>{const b=e.target.closest?.('button');if(!b)return;const n=b.dataset?.scene;if(n!=='fountain'&&n!=='whirlpool'&&active!=='none')disable();},true);
  const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">CURRENT-POOL PHYSICS · M7.5.4</div><div class="m742Note">Fountain is now scaled from the measured pool surface instead of the obsolete M4.6 depth. Whirlpool drives sustained whole-body angular momentum so XSPH/PBF damping cannot erase the rotation before a funnel develops.</div>';
  slider(sec,'FOUNTAIN PEAK',.30,.90,.05,fountainHeight,v=>fountainHeight=v,v=>`${Number(v).toFixed(2)} m`);
  slider(sec,'VORTEX OMEGA',2.2,6.0,.1,vortexOmega,v=>vortexOmega=v,v=>`${Number(v).toFixed(1)} rad/s`);
  slider(sec,'VORTEX GAIN',.65,1.55,.05,vortexGain,v=>vortexGain=v);
  status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';sec.appendChild(status);scenePage.appendChild(sec);setInterval(syncUI,350);syncUI();
}
const auto=new URLSearchParams(location.search).get('scene');if(auto==='fountain'||auto==='whirlpool')setTimeout(()=>choose(auto),320);
window.__v5M754ScaledScenes={online:true,backend:'current-depth-connected-fountain-global-vortex-m754',gpuSubmitsAdded:0,choose,disable,get active(){return active},get added(){return added},get passes(){return passes},get surface(){return poolSurface()},get jetSpeed(){return fountainLaunch().speed},get vortexOmega(){return vortexOmega}};
window.__fluidV5Version='7.5.4';window.__fluidV5Build='M7.5.4 CURRENT-POOL FOUNTAIN + WHIRLPOOL / M7.3.9 ONE-SUBMIT CORE';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V5 · M7.5.4';document.title='Fluid V5 · M7.5.4 Current-Pool Physics';
console.info('[Fluid V5 M7.5.4] scaled connected fountain + sustained global vortex online; feature submits 0.');