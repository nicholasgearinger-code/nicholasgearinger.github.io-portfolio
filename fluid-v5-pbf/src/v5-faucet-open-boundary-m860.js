// Fluid V8 M8.6.0 — BCC open-boundary faucet.
//
// Clean replacement for the M8.5.x stacked-sheet inlet experiments. The nozzle uses a
// body-centred-cubic sampling lattice with the same approximate 3D particle number density
// as the solver's cubic d-spacing fluid, but alternating BCC planes are only ~0.63d apart.
// That gives the accelerating free jet substantially more axial sampling without overlapping
// particles or increasing their mass/density. A short numerical throat applies a plug-flow
// velocity boundary only while particles are inside the nozzle; below the outlet the water is
// ordinary unconstrained PBF. Calm pool particles are moved into newly opened BCC inlet slots
// pre-solve, keeping total mass and active particle count constant. One extra compute pass,
// zero extra queue submits.

const sim=window.__sim,ui=window.__ui,scenes=window.__v5M743Scenes;
const ssfr=window.__ssfr,cam=window.__cam;
if(!sim?.dev||!ui||!scenes?.online||!ssfr||!cam)
  throw new Error('M8.6 faucet: base PBF/scene/SSFR runtime unavailable.');

const dev=sim.dev;
const nativeCreate=dev.createCommandEncoder.bind(dev);
const baseStep=sim.step.bind(sim);

let active='faucet';
let speed=1.34;
let radiusScale=2.30;
let phase=0;
let layerSerial=0;
let expectSimEncoder=false;
let pendingN=0;
let inletPasses=0;
let requested=0;
let raf=0,lastRaf=0,rafRate=0;
let status=null;
let envStatus='loading';

const MAX_SOURCE=96;
const sourcePos=dev.createBuffer({label:'m860SourcePos',size:MAX_SOURCE*16,
  usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
const sourceVel=dev.createBuffer({label:'m860SourceVel',size:MAX_SOURCE*16,
  usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
const counter=dev.createBuffer({label:'m860SourceCounter',size:16,
  usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
const uni=dev.createBuffer({label:'m860InletUniform',size:64,
  usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const UF=new Float32Array(16),UU=new Uint32Array(UF.buffer);

const WGSL=`
struct UData {
  n:u32,
  sourceN:u32,
  offset:u32,
  pad0:u32,
  centre:vec2f,
  outletY:f32,
  topY:f32,
  nozzleR:f32,
  recycleY:f32,
  speed:f32,
  donorSpeed:f32,
  radialGain:f32,
  pad1:f32,
  pad2:f32,
  pad3:f32,
}
struct Counter { value:atomic<u32> }
@group(0) @binding(0) var<uniform> U:UData;
@group(0) @binding(1) var<storage,read> sourcePos:array<vec4f>;
@group(0) @binding(2) var<storage,read> sourceVel:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> pos:array<vec4f>;
@group(0) @binding(4) var<storage,read_write> vel:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> pred:array<vec4f>;
@group(0) @binding(6) var<storage,read_write> C:Counter;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;
  if(i>=U.n||U.n==0u){return;}
  let j=(i+U.offset)%U.n;
  let p=pos[j].xyz;
  var v=vel[j].xyz;
  let q=p.xz-U.centre;
  let r=length(q);

  // Numerical nozzle wall / plug-flow boundary. This acts ONLY inside the short throat.
  // Below outletY there is no stream-specific force or alignment.
  if(p.y>U.outletY && p.y<U.topY+0.055 && r<U.nozzleR*1.42){
    let radial=select(vec2f(0.0),q/max(r,1.0e-6),r>1.0e-6);
    let wall=max(0.0,r-U.nozzleR*.82)/max(U.nozzleR*.35,1.0e-5);
    let guidedXZ=vec2f(v.x,v.z)*.18-radial*(U.radialGain*wall);
    let guidedY=mix(v.y,-U.speed,.72);
    v=vec3f(guidedXZ.x,guidedY,guidedXZ.y);
    vel[j]=vec4f(v,0.0);
  }

  if(U.sourceN==0u){return;}
  // Hidden return loop: choose only calm lower-basin water, away from the impact core.
  if(p.y>=U.recycleY || length(v)>=U.donorSpeed || r<U.nozzleR*2.7){return;}
  let slot=atomicAdd(&C.value,1u);
  if(slot>=U.sourceN){return;}
  let np=sourcePos[slot];
  let nv=sourceVel[slot];
  pos[j]=np;
  pred[j]=np;
  vel[j]=nv;
}`;

const mod=dev.createShaderModule({code:WGSL,label:'m860OpenBoundaryWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.6 inlet WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'m860OpenBoundary',layout:'auto',compute:{module:mod,entryPoint:'main'}});

function bccPlane(d,parity){
  const a=Math.cbrt(2)*d,half=.5*a,R=radiusScale*d;
  const off=parity?half:0;
  const e=Math.ceil((R+half)/a)+1,out=[];
  for(let ix=-e;ix<=e;ix++)for(let iz=-e;iz<=e;iz++){
    const x=ix*a+off,z=iz*a+off;
    if(x*x+z*z<=R*R+1e-10)out.push([x,z]);
  }
  return out;
}

function prepareSource(frameDt){
  if(active!=='faucet'||ui.paused){pendingN=0;return;}
  const p=sim.params,d=Math.max(.001,Number(p.spacing)||.025),b=p.box;
  const step=.5*Math.cbrt(2)*d;
  const dt=Math.min(.04,Math.max(0,Number(frameDt)||0));
  const before=phase,travel=before+speed*dt;
  let layers=Math.floor(travel/step);
  phase=travel-layers*step;
  layers=Math.min(layers,5);
  if(layers<=0){pendingN=0;return;}

  const topY=b[1]-d*1.55;
  const cx=b[0]*.5,cz=b[2]*.5,g=Math.max(0,Number(p.gravity)||9.81);
  const P=new Float32Array(MAX_SOURCE*4),V=new Float32Array(MAX_SOURCE*4);
  let n=0;
  for(let k=0;k<layers&&n<MAX_SOURCE;k++){
    const parity=(layerSerial++)&1;
    const cross=bccPlane(d,parity);
    const eventDist=(k+1)*step-before;
    const tau=Math.min(dt,Math.max(0,eventDist/Math.max(speed,1e-6)));
    const upstream=speed*tau+g*dt*tau-.5*g*tau*tau;
    const y=Math.min(b[1]-d*.62,topY+upstream);
    const vy=-speed+g*tau;
    for(const q of cross){
      if(n>=MAX_SOURCE)break;
      const x=cx+q[0],z=cz+q[1];
      if(x<=d*.6||x>=b[0]-d*.6||z<=d*.6||z>=b[2]-d*.6)continue;
      P[n*4]=x;P[n*4+1]=y;P[n*4+2]=z;P[n*4+3]=1;
      V[n*4]=0;V[n*4+1]=vy;V[n*4+2]=0;V[n*4+3]=0;n++;
    }
  }
  if(n<=0){pendingN=0;return;}
  dev.queue.writeBuffer(sourcePos,0,P);
  dev.queue.writeBuffer(sourceVel,0,V);
  pendingN=n;requested+=n;
}

function encodeInlet(enc){
  const n=Math.max(1,sim.n|0),p=sim.params,d=Math.max(.001,Number(p.spacing)||.025),b=p.box;
  const topY=b[1]-d*1.55,outletY=b[1]-d*6.1,R=radiusScale*d;
  const offset=(Math.imul((layerSerial+17)>>>0,2654435761)>>>0)%n;
  UU[0]=n;UU[1]=pendingN;UU[2]=offset;UU[3]=0;
  UF[4]=b[0]*.5;UF[5]=b[2]*.5;UF[6]=outletY;UF[7]=topY;
  UF[8]=R;UF[9]=Math.min(b[1]*.34,.48);UF[10]=speed;UF[11]=1.10;
  UF[12]=speed*.30;UF[13]=0;UF[14]=0;UF[15]=0;
  dev.queue.writeBuffer(uni,0,UF);
  enc.clearBuffer(counter);
  const s=sim.parity===0?'A':'B';
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:sourcePos}},
    {binding:2,resource:{buffer:sourceVel}},{binding:3,resource:{buffer:sim.buf['pos'+s]}},
    {binding:4,resource:{buffer:sim.buf['vel'+s]}},{binding:5,resource:{buffer:sim.buf['pred'+s]}},
    {binding:6,resource:{buffer:counter}},
  ]});
  const pass=enc.beginComputePass({label:'m860InletAndThroat'});
  pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(n/256));pass.end();
  pendingN=0;inletPasses++;
}

dev.createCommandEncoder=function(desc){
  const enc=nativeCreate(desc);
  if(expectSimEncoder)encodeInlet(enc);
  return enc;
};
sim.step=function(dt){
  prepareSource(dt);
  expectSimEncoder=true;
  try{return baseStep(dt)}finally{expectSimEncoder=false;}
};

function applyPhysics(){
  if(!sim.params)return;
  sim.params.substeps=2;
  sim.params.iterations=3;
  sim.params.xsphC=.052;
  sim.params.sCorrK=.031;
  sim.params.surfaceTensionK=.074;
}
const visual={min:.40,max:.55,scale:.44};
function applyVisual(){
  ssfr.renderScale=visual.scale;
  ssfr.splatRadius=1.20;
  ssfr.filter=1;
  ssfr.filterIterations=1;
  ssfr.filterSigma=.62;
  ssfr.thicknessRadius=1.20;
  ssfr.thicknessFilterSize=6;
  ssfr.bindCache=null;
}
function frameCamera(){
  const b=sim.params?.box||[1.10,1.50,.74];
  cam.az=-.70;cam.el=.39;cam.dist=2.12;cam.target=[b[0]*.50,b[1]*.47,b[2]*.50];
}
applyPhysics();applyVisual();frameCamera();
setTimeout(()=>{applyPhysics();applyVisual();frameCamera()},400);

const HDR1K='https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/env/quarry_cloudy_1k.hdr';
(async()=>{
  try{
    envStatus=await ssfr.env.load(HDR1K);
    ssfr.env.intensity=1.02;ssfr.env.yaw=0;ssfr.bindCache=null;
  }catch(err){envStatus='environment unavailable';console.warn('[M8.6] HDR load failed',err);}
})();

requestAnimationFrame(function tick(){raf++;requestAnimationFrame(tick)});
setInterval(()=>{
  rafRate=raf-lastRaf;lastRaf=raf;
  if(rafRate>=58&&visual.scale<visual.max)visual.scale=Math.min(visual.max,visual.scale+.01);
  else if(rafRate<48&&visual.scale>visual.min)visual.scale=Math.max(visual.min,visual.scale-.02);
  applyVisual();sync();
},1000);

function choose(name){
  if(name==='faucet'){
    active='faucet';phase=0;layerSerial=0;scenes.choose('pool');
    applyPhysics();applyVisual();frameCamera();
  }else if(name==='pool'){
    active='pool';scenes.choose('pool');
  }else if(name==='dam'){
    active='dam';scenes.choose('dam');
  }
  if(ui.paused)ui.paused=false;sync();
}

const panel=document.getElementById('m742Panel'),tabs=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
if(panel&&tabs){
  document.getElementById('m860Dock')?.remove();
  const dock=document.createElement('div');dock.id='m860Dock';dock.style.cssText='padding:8px 9px 9px;border-bottom:1px solid rgba(78,214,220,.18);background:rgba(4,16,22,.91)';
  dock.innerHTML='<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px"><b style="font:900 8px ui-monospace;color:#86f6ff;letter-spacing:.12em">BCC OPEN-BOUNDARY FAUCET · M8.6</b><span style="font:7px ui-monospace;color:#799aa7">0.63d axial · one submit</span></div><div class="m860Btns" style="display:flex;gap:6px"></div>';
  panel.insertBefore(dock,tabs);const row=dock.querySelector('.m860Btns');
  for(const [key,label] of [['faucet','FAUCET'],['pool','POOL'],['dam','DAM BREAK']]){
    const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.scene=key;
    b.style.cssText='min-height:42px;padding:7px 12px;border-radius:10px;border:1px solid rgba(78,214,220,.30);background:#071820;color:#dffcff;font:800 8px ui-monospace';
    b.onclick=e=>{e.preventDefault();e.stopPropagation();choose(key)};row.appendChild(b);
  }
}
const sceneIdx=tabs&&host?[...tabs.children].findIndex(b=>b.dataset.key==='scenes'):-1;
const page=sceneIdx>=0?host.children[sceneIdx]:null;
if(page){
  page.innerHTML='<div class="m742Intro">M8.6 replaces stacked faucet sheets with a constant-density BCC inlet. The short throat has a nozzle velocity boundary; the free jet below it is ordinary PBF.</div>';
  const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">OPEN-BOUNDARY JET</div><div class="m742Note">BCC: a = ∛2·d, alternating planes = 0.63d. Same bulk number density as cubic fluid, much better axial sampling.</div>';
  const make=(label,min,max,step,value,fn,fmt)=>{const r=document.createElement('div');r.className='m742Row';const l=document.createElement('label');l.textContent=label;const i=document.createElement('input');i.type='range';i.min=min;i.max=max;i.step=step;i.value=value;const v=document.createElement('div');v.className='m742Val';const show=()=>v.textContent=fmt(Number(i.value));show();i.oninput=e=>{e.stopPropagation();fn(Number(i.value));show()};r.append(l,i,v);sec.appendChild(r)};
  make('EXIT SPEED',1.05,1.75,.05,speed,x=>speed=x,x=>`${x.toFixed(2)} m/s`);
  make('NOZZLE RADIUS',2.0,2.6,.05,radiusScale,x=>radiusScale=x,x=>`${x.toFixed(2)} d`);
  status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';sec.appendChild(status);page.appendChild(sec);
}
function sync(){
  document.querySelectorAll('.m860Btns button').forEach(b=>b.style.borderColor=b.dataset.scene===active?'#f1ad43':'rgba(78,214,220,.30)');
  if(!status)return;
  const d=Number(sim.params?.spacing)||.025;
  const a=Math.cbrt(2)*d,axial=.5*a;
  status.textContent=`ACTIVE ${active.toUpperCase()} · RAF ${rafRate}/s\nactive ${sim.n.toLocaleString()} / cap ${(sim.cap||sim.n).toLocaleString()} · constant mass\nspacing ${(d*1000).toFixed(0)} mm · BCC axial ${(axial/d).toFixed(2)}d (${(axial*1000).toFixed(1)} mm)\nexit ${speed.toFixed(2)} m/s · PBF 2×3 · XSPH .052 · tension .074\ninlet passes ${inletPasses.toLocaleString()} · source particles ${requested.toLocaleString()} · SSFR ${Math.round(visual.scale*100)}%\nenvironment ${envStatus}`;
}

window.__v5M852Faucet={online:true,backend:'bcc-open-boundary-m860',choose,get active(){return active},get raf(){return rafRate}};
window.__v5M860Faucet={online:true,backend:'bcc-open-boundary-m860',choose,get active(){return active},get raf(){return rafRate},get passes(){return inletPasses}};
window.__fluidV5Version='8.6.0';
window.__fluidV5Build='M8.6.0 BCC OPEN-BOUNDARY FAUCET / 0.63D AXIAL / CONSTANT MASS / ONE SUBMIT';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.6.0';
document.title='Fluid V8 · M8.6.0 BCC Faucet';
setTimeout(()=>choose('faucet'),220);sync();
console.info('[Fluid V8 M8.6.0] BCC open-boundary faucet online; 0.63d axial sampling; added submits 0.');
