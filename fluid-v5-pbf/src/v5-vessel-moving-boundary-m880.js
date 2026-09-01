// Fluid V8 M8.8 — true moving-boundary vessel physics.
// The PBF solver owns the water. Pitcher and glass are analytic collision boundaries only.
// No pitcher/free/glass particle states, no emitter, no capture logic, no particle sleep.
// Boundary projection is injected after predict and after every PBF density correction so
// pressure/incompressibility and vessel contact converge together inside every substep.

import {
  sim,ui,cam,ssfr,faucet,dev,queue,glass,pitcher,profile,pitcherPoint,spoutPath,scene
} from './v5-pitcher-fluid-physics-m872.js';
import {encodeVisual} from './v5-pitcher-vessels-m872.js';

if(!sim?.dev||!ui||!cam||!ssfr||!faucet?.online||!window.__v5M739Unified?.online)
  throw new Error('M8.8 moving-boundary vessel: unified PBF runtime unavailable.');

const WG=256,MAX_SLOTS=32;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t)};

function tunePhysics(){
  if(!sim.params)return;
  sim.params.substeps=4;
  sim.params.iterations=6;
  sim.params.xsphC=.035;
  sim.params.sCorrK=.080;
  sim.params.surfaceTensionK=.015;
}
function tuneSurface(){
  if(!ssfr)return;
  ssfr.splatRadius=1.28;
  ssfr.filter=2;
  ssfr.filterIterations=3;
  ssfr.thicknessRadius=1.28;
  ssfr.thicknessFilterSize=4;
  ssfr.bindCache=null;
}

function profileRadius(y){
  if(y<=profile[0][0])return profile[0][1];
  if(y>=profile.at(-1)[0])return profile.at(-1)[1];
  for(let i=0;i<profile.length-1;i++){
    const [y0,r0]=profile[i],[y1,r1]=profile[i+1];
    if(y<=y1){const t=(y-y0)/(y1-y0);return r0+(r1-r0)*t;}
  }
  return profile.at(-1)[1];
}

function seedHydrostaticVolume(){
  const d=Math.max(.001,Number(sim.params?.spacing)||.019);
  const a=Math.cbrt(2)*d,dy=.5*a;
  const minY=profile[0][0]+d*.74,fillY=.100;
  const P=[],V=[];let layer=0;
  const limit=Math.min(sim.cap||6000,3600);
  outer:for(let y=minY;y<=fillY+1e-6;y+=dy,layer++){
    const R=Math.max(0,profileRadius(y)-d*.56),off=(layer&1)?a*.5:0,e=Math.ceil((R+a)/a);
    for(let ix=-e;ix<=e;ix++)for(let iz=-e;iz<=e;iz++){
      const x=ix*a+off,z=iz*a+off;
      if(x*x+z*z>R*R)continue;
      const p=pitcherPoint([x,y,z],0);
      P.push(p[0],p[1],p[2],1);V.push(0,0,0,0);
      if(P.length/4>=limit)break outer;
    }
  }
  const n=P.length/4,p4=new Float32Array(P),v4=new Float32Array(V),zero4=new Float32Array(n*4);
  for(const name of ['posA','posB','predA','predB'])queue.writeBuffer(sim.buf[name],0,p4);
  for(const name of ['velA','velB'])queue.writeBuffer(sim.buf[name],0,v4);
  for(const name of ['bodyA','bodyB','restA','restB'])if(sim.buf[name])queue.writeBuffer(sim.buf[name],0,zero4);
  if(sim.buf.density)queue.writeBuffer(sim.buf.density,0,new Float32Array(n).fill(Number(sim.params?.restDensity)||1000));
  sim.n=n;
  if(sim.scene){sim.scene.n=n;sim.scene.nFluid=n;sim.scene.nBody=0;}
  sim.timeBank=0;sim.simTime=0;sim.uploadParams?.(1/240);
  scene.seeded=n;
  return n;
}

pitcher.maxAngle=-1.18;
function angleAt(t){
  if(t<3.00)return 0;
  if(t<5.70)return pitcher.maxAngle*smooth((t-3.00)/2.70);
  if(t<9.20)return pitcher.maxAngle;
  if(t<11.40)return pitcher.maxAngle*(1-smooth((t-9.20)/2.20));
  return 0;
}
function stageAt(t){
  if(t<3.00)return 'HYDROSTATIC REST';
  if(t<5.70)return 'TURNING — GRAVITY SETS FREE SURFACE';
  if(t<9.20)return 'GRAVITY POUR';
  if(t<11.40)return 'RETURNING UPRIGHT';
  return 'POUR COMPLETE';
}

const boundaryWGSL=`
struct UData {
  pitch:vec4f,
  motion:vec4f,
  glass0:vec4f,
  glass1:vec4f,
  glass2:vec4f,
  info:vec4u,
}
@group(0) @binding(0) var<uniform> U:UData;
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> pred:array<vec4f>;

fn safe2(q:vec2f)->vec2f{let m=length(q);return select(vec2f(1.0,0.0),q/m,m>1.0e-7);}
fn toLocal(p:vec3f,a:f32)->vec3f{
  let q=p-U.pitch.xyz;let c=cos(a);let s=sin(a);
  return vec3f(c*q.x+s*q.y,-s*q.x+c*q.y,q.z);
}
fn toWorld(p:vec3f)->vec3f{
  let a=U.pitch.w;let c=cos(a);let s=sin(a);
  return U.pitch.xyz+vec3f(c*p.x-s*p.y,s*p.x+c*p.y,p.z);
}
fn bodyR(y:f32)->f32{
  if(y<=-.225){return .074;} if(y<-.190){return mix(.074,.105,(y+.225)/.035);}
  if(y<-.100){return mix(.105,.137,(y+.190)/.090);} if(y<.020){return mix(.137,.145,(y+.100)/.120);}
  if(y<.105){return mix(.145,.127,(y-.020)/.085);} if(y<.165){return mix(.127,.095,(y-.105)/.060);}
  if(y<.205){return mix(.095,.070,(y-.165)/.040);} return .070;
}
fn outerR(y:f32)->f32{
  if(y<=-.255){return .095;} if(y<-.220){return mix(.095,.125,(y+.255)/.035);}
  if(y<-.135){return mix(.125,.158,(y+.220)/.085);} if(y<-.020){return mix(.158,.166,(y+.135)/.115);}
  if(y<.095){return mix(.166,.147,(y+.020)/.115);} if(y<.165){return mix(.147,.118,(y-.095)/.070);}
  if(y<.225){return mix(.118,.090,(y-.165)/.060);} return .090;
}
fn spoutY(x:f32)->f32{
  if(x<=.060){return .145;} if(x<.105){return mix(.145,.165,(x-.060)/.045);}
  if(x<.155){return mix(.165,.192,(x-.105)/.050);} if(x<.205){return mix(.192,.198,(x-.155)/.050);}
  return mix(.198,.182,clamp((x-.205)/.045,0.0,1.0));
}
fn doorway(q:vec3f,pr:f32)->bool{
  return q.x>.035-pr && q.x<.275+pr && abs(q.z)<.078+pr*.25 && q.y>.112-pr*.35 && q.y<.235+pr;
}
fn spoutSpace(q:vec3f,pr:f32)->bool{
  if(q.x<.040-pr || q.x>.275+pr){return false;}
  let sy=spoutY(clamp(q.x,.060,.250));
  return abs(q.z)<.084+pr && q.y>sy-.060-pr && q.y<sy+.115+pr;
}
fn glassInner(y:f32)->f32{
  let t=clamp((y-U.glass2.x)/max(U.glass1.w-U.glass2.x,1.0e-5),0.0,1.0);
  return mix(U.glass0.w,U.glass1.x,t);
}
fn glassOuter(y:f32)->f32{
  let t=clamp((y-U.glass2.x)/max(U.glass1.w-U.glass2.x,1.0e-5),0.0,1.0);
  return mix(U.glass1.y,U.glass1.z,t);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.info.x){return;}
  let p0=pos[i].xyz;var p=pred[i].xyz;
  let pr=max(U.motion.z*.48,.0036);

  let l0=toLocal(p0,U.motion.x);var l=toLocal(p,U.pitch.w);
  let r0=length(l0.xz);
  let r0safe=max(.008,bodyR(clamp(l0.y,-.225,.205))-pr*.25);
  let wasBody=l0.y>-.225-pr*1.5 && l0.y<.205+pr*1.5 && r0<r0safe+pr*.8;
  let wasSpout=spoutSpace(l0,pr);

  if(wasBody||wasSpout){
    if(l.y<-.225+pr){l.y=-.225+pr;}

    // The pitcher mouth is physically OPEN. Only the side wall below the rim is solid.
    // The +X notch joins directly into the open spout trough.
    if(l.y<.205-pr*.05 && !doorway(l,pr)){
      let rr=length(l.xz);let safe=max(.010,bodyR(clamp(l.y,-.225,.205))-pr);
      if(rr>safe){let d=safe2(l.xz);l.x=d.x*safe;l.z=d.y*safe;}
    }

    if((doorway(l,pr)||wasSpout||spoutSpace(l,pr)) && l.x<.266+pr){
      let sx=clamp(l.x,.060,.250);let sy=spoutY(sx);
      let floor=sy-.034+pr*.62;let halfW=max(.034,.066-pr*.18);
      if(l.y<floor){l.y=floor;}
      if(l.y<sy+.052+pr*.25 && abs(l.z)>halfW){l.z=select(-halfW,halfW,l.z>=0.0);}
      if(l.x<.045-pr*.15){l.x=.045-pr*.15;}
    }
    p=toWorld(l);
  }else{
    if(l.y>-.255-pr && l.y<.225+pr && !doorway(l,pr)){
      let rr=length(l.xz);let rin=max(.008,bodyR(clamp(l.y,-.225,.205))-pr*.15);
      let rout=outerR(clamp(l.y,-.255,.225))+pr*.65;
      if(rr>rin&&rr<rout){let d=safe2(l.xz);l.x=d.x*rout;l.z=d.y*rout;p=toWorld(l);}
    }
  }

  let gc=vec2f(U.glass0.x,U.glass0.z);let base=U.glass2.x;let rim=U.glass1.w;
  let q0=p0.xz-gc;var q=p.xz-gc;let gr0=length(q0);var gr=length(q);
  let gi0=max(.008,glassInner(clamp(p0.y,base,rim))-pr);
  let inside0=p0.y>base-pr*1.4 && p0.y<rim+pr*.6 && gr0<gi0+pr*.35;

  var entered=false;
  if(p0.y>=rim-pr*.10 && p.y<rim+pr*.05 && p0.y>p.y){
    let t=clamp((p0.y-rim)/max(p0.y-p.y,1.0e-6),0.0,1.0);
    let crossXZ=p0.xz+(p.xz-p0.xz)*t;
    entered=length(crossXZ-gc)<U.glass1.x-pr*.35;
  }

  if(inside0||entered){
    if(p.y<base+pr){p.y=base+pr;}
    if(p.y<rim){
      q=p.xz-gc;gr=length(q);let gi=max(.008,glassInner(p.y)-pr);
      if(gr>gi){let d=safe2(q);p.x=gc.x+d.x*gi;p.z=gc.y+d.y*gi;}
    }
    // Above the rim there is deliberately no constraint, so genuine splash-out remains possible.
  }else{
    if(p.y>base-pr&&p.y<rim+pr){
      q=p.xz-gc;gr=length(q);let gi=max(.008,glassInner(clamp(p.y,base,rim))-pr);
      let go=glassOuter(clamp(p.y,base,rim))+pr*.70;
      if(gr>gi&&gr<go){let d=safe2(q);p.x=gc.x+d.x*go;p.z=gc.y+d.y*go;}
      if(gr0>glassOuter(clamp(p0.y,base,rim))+pr*.35 && gr<gi){let d=safe2(q);p.x=gc.x+d.x*go;p.z=gc.y+d.y*go;}
    }
    if(p0.y>rim+pr*.15 && p.y<rim+pr*.15){
      let dy=max(p0.y-p.y,1.0e-6);let t=clamp((p0.y-rim)/dy,0.0,1.0);
      let crossXZ=p0.xz+(p.xz-p0.xz)*t;let cr=length(crossXZ-gc);
      if(cr>U.glass1.x-pr*.15 && cr<U.glass1.z+pr*.75){p.y=rim+pr;}
    }
  }

  pred[i]=vec4f(p,1.0);
}`;

const mod=dev.createShaderModule({code:boundaryWGSL,label:'m880MovingBoundaryWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.8 moving-boundary WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'m880MovingBoundary',layout:'auto',compute:{module:mod,entryPoint:'main'}});
const slots=Array.from({length:MAX_SLOTS},(_,i)=>dev.createBuffer({label:`m880BoundaryU${i}`,size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));
const bindCache=new Map();
function bindFor(slot,posPar,predPar){
  const key=`${sim.gen||0}:${slot}:${posPar}:${predPar}`;
  let bg=bindCache.get(key);if(bg)return bg;
  const ps=posPar===0?'A':'B',qs=predPar===0?'A':'B';
  bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:slots[slot]}},
    {binding:1,resource:{buffer:sim.buf['pos'+ps]}},
    {binding:2,resource:{buffer:sim.buf['pred'+qs]}}
  ]});bindCache.set(key,bg);return bg;
}

let motionTime=0,activeSlot=0,slotCounter=0,boundaryPasses=0;
function prepareSlot(slot,dt){
  dt=clamp(Number(dt)||1/240,1/1000,.05);
  const prev=angleAt(motionTime),next=angleAt(motionTime+dt);
  motionTime+=dt;scene.clock=motionTime;scene.lastDt=dt;
  pitcher.prevAngle=prev;pitcher.angle=next;pitcher.omega=(next-prev)/dt;
  const F=new Float32Array(24),U=new Uint32Array(F.buffer);
  F[0]=pitcher.cx;F[1]=pitcher.cy;F[2]=pitcher.cz;F[3]=next;
  F[4]=prev;F[5]=dt;F[6]=Number(sim.params?.spacing)||.019;F[7]=pitcher.omega;
  F[8]=glass.cx;F[9]=glass.bottom;F[10]=glass.cz;F[11]=glass.innerBottom;
  F[12]=glass.innerTop;F[13]=glass.outerBottom;F[14]=glass.outerTop;F[15]=glass.rim;
  F[16]=glass.baseTop;U[20]=sim.n;
  queue.writeBuffer(slots[slot],0,F);
}
function encodeBoundary(enc,posPar,predPar,slot){
  if(!scene.active||!sim.n)return;
  const pass=enc.beginComputePass({label:'m880AnalyticVesselBoundary'});
  pass.setPipeline(pipe);pass.setBindGroup(0,bindFor(slot,posPar,predPar));pass.dispatchWorkgroups(Math.ceil(sim.n/WG));pass.end();
  boundaryPasses++;scene.collisionPasses=boundaryPasses;
}

// Keep the upstream PBF step intact. We only inject boundary projections at its natural stages.
const baseCreate=dev.createCommandEncoder.bind(dev),baseStep=sim.step.bind(sim);
let inStep=false,expectRender=false,solvePP=null;
dev.createCommandEncoder=function(desc){
  const phase=inStep?'sim':(expectRender?'render':'other');
  if(phase==='render')expectRender=false;
  const enc=baseCreate(desc);
  if(phase==='render'){
    let appended=false;
    return new Proxy(enc,{get(target,prop){
      if(prop==='finish')return(...args)=>{if(!appended){appended=true;try{encodeVisual(target)}catch(err){console.error('[M8.8 vessel render]',err);}}return target.finish(...args);};
      const v=Reflect.get(target,prop,target);return typeof v==='function'?v.bind(target):v;
    }});
  }
  if(phase!=='sim')return enc;
  return new Proxy(enc,{get(target,prop){
    if(prop==='beginComputePass')return(desc2)=>{
      const pass=target.beginComputePass(desc2);let sawPredict=false,sawDelta=false;
      return new Proxy(pass,{get(pt,pp){
        if(pp==='setPipeline')return(pipeline)=>{if(pipeline===sim.pipe.predict)sawPredict=true;if(pipeline===sim.pipe.delta)sawDelta=true;return pt.setPipeline(pipeline);};
        if(pp==='end')return()=>{
          pt.end();
          try{
            if(sawPredict){
              solvePP=null;activeSlot=slotCounter++%MAX_SLOTS;
              prepareSlot(activeSlot,Number(sim.uniF?.[3])||1/(60*Math.max(1,sim.params?.substeps||4)));
              encodeBoundary(target,sim.parity,sim.parity,activeSlot);
            }else if(sawDelta){
              if(solvePP===null)solvePP=sim.parity;
              const out=solvePP^1;encodeBoundary(target,sim.parity,out,activeSlot);solvePP=out;
            }
          }catch(err){console.error('[M8.8 boundary injection]',err);}
        };
        const v=Reflect.get(pt,pp,pt);return typeof v==='function'?v.bind(pt):v;
      }});
    };
    const v=Reflect.get(target,prop,target);return typeof v==='function'?v.bind(target):v;
  }});
};
sim.step=function(dt){inStep=true;try{return baseStep(dt)}finally{inStep=false;expectRender=true;}};

function frameCamera(){cam.az=-.57;cam.el=.25;cam.dist=1.72;cam.target=[.515,.650,.370];}
function hardReset(){
  scene.active=true;scene.started=false;scene.clock=0;scene.collisionPasses=0;scene.renderPasses=0;
  motionTime=0;slotCounter=0;boundaryPasses=0;solvePP=null;
  pitcher.angle=0;pitcher.prevAngle=0;pitcher.omega=0;
  ui.pouring=false;ui.pourLeft=0;ui.paused=false;
  tunePhysics();tuneSurface();seedHydrostaticVolume();frameCamera();scene.cycles++;scene.started=true;sync();
}
function startScene(){
  try{faucet.choose('pool')}catch(err){console.warn('[M8.8 faucet disable]',err)}
  requestAnimationFrame(()=>requestAnimationFrame(()=>hardReset()));
}

document.getElementById('m861Dock')?.style.setProperty('display','none','important');
document.getElementById('m872Hud')?.remove();document.getElementById('m873Hud')?.remove();document.getElementById('m880Hud')?.remove();
const hud=document.createElement('div');hud.id='m880Hud';hud.style.cssText='position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));z-index:40;width:min(340px,calc(100vw - 24px));padding:10px;border:1px solid rgba(112,225,235,.42);border-radius:13px;background:rgba(5,20,27,.88);backdrop-filter:blur(9px);font:9px/1.45 ui-monospace;color:#bfeaf0;pointer-events:auto';
hud.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><b style="color:#86f6ff;letter-spacing:.10em">M8.8 · MOVING-BOUNDARY PBF</b><button id="m880Again" style="border:1px solid rgba(241,173,67,.65);border-radius:9px;background:#201708;color:#ffd890;padding:7px 9px;font:800 8px ui-monospace">POUR AGAIN</button></div><div id="m880Status" style="margin-top:7px;white-space:pre-line"></div>';
document.body.appendChild(hud);hud.addEventListener('pointerdown',e=>e.stopPropagation());hud.addEventListener('click',e=>e.stopPropagation());document.getElementById('m880Again').onclick=e=>{e.preventDefault();hardReset()};
const status=document.getElementById('m880Status');
function sync(){
  if(!status)return;const deg=-pitcher.angle*180/Math.PI,lip=pitcherPoint(spoutPath.at(-1));
  status.textContent=`${stageAt(scene.clock)} · ${scene.clock.toFixed(1)} s\npitcher ${deg.toFixed(0)}° · wall ω ${Math.abs(pitcher.omega).toFixed(2)} rad/s\nPBF water ${sim.n.toLocaleString()} · ${sim.params?.substeps||0} substeps × ${sim.params?.iterations||0} density iterations\ngravity world-space · particle state machine OFF\nSDF boundary passes ${boundaryPasses.toLocaleString()} · spout lip ${lip[0].toFixed(2)}, ${lip[1].toFixed(2)} m\nglass open rim ${glass.rim.toFixed(2)} m · added submits 0`;
}
setInterval(sync,300);setTimeout(startScene,520);setTimeout(()=>{document.getElementById('m861Dock')?.style.setProperty('display','none','important');frameCamera();},950);

window.__v5M880MovingBoundary={online:true,backend:'pbf-analytic-moving-boundaries-per-iteration-m880',gpuSubmitsAdded:0,restart:hardReset,get angle(){return pitcher.angle},get clock(){return scene.clock},get seeded(){return scene.seeded},get boundaryPasses(){return boundaryPasses}};
window.__fluidV5Version='8.8';window.__fluidV5Build='M8.8 TRUE MOVING-BOUNDARY PBF / WORLD GRAVITY / OPEN SPOUT + OPEN GLASS / NO PARTICLE STATES';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.8';document.title='Fluid V8 · M8.8 True Moving-Boundary Pour';
console.info('[Fluid V8 M8.8] analytic moving vessel boundaries injected inside every PBF substep/iteration; no particle states; added submits 0.');
