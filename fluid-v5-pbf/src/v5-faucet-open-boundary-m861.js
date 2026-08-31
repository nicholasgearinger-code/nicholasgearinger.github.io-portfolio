// Fluid V8 M8.6.1 — continuity-refined BCC open-boundary faucet.
//
// Builds directly on the successful M8.6 BCC inlet, but removes the remaining cadence
// discontinuities: alternating BCC cross-sections are radius-balanced to nearly equal
// particle counts, a ten-plane throat is prefilled before the visible jet is released,
// the source sits farther from the top wall, and the nozzle velocity boundary fades to
// zero over the final ~2d instead of ending abruptly. GPU telemetry copies the inlet
// assignment counter into a tiny readback ring inside the SAME command submission so we
// can verify requested vs emitted source samples without adding queue submits.

const sim=window.__sim,ui=window.__ui,scenes=window.__v5M743Scenes;
const ssfr=window.__ssfr,cam=window.__cam;
if(!sim?.dev||!ui||!scenes?.online||!ssfr||!cam)
  throw new Error('M8.6.1 faucet: base PBF/scene/SSFR runtime unavailable.');

const dev=sim.dev;
const nativeCreate=dev.createCommandEncoder.bind(dev);
const baseStep=sim.step.bind(sim);

let active='faucet';
let speed=1.34;
let radiusScale=2.55;
let phase=0;
let layerSerial=0;
let primeRemaining=10;
let expectSimEncoder=false;
let pendingN=0;
let inletPasses=0;
let requestedTotal=0;
let raf=0,lastRaf=0,rafRate=0;
let status=null;
let envStatus='loading';
let lastRequested=0,lastEmitted=0,partialEvents=0,telemetrySamples=0;
let readAfterStep=-1;

const THROAT_PLANES=10;
const MAX_SOURCE=192;
const sourcePos=dev.createBuffer({label:'m861SourcePos',size:MAX_SOURCE*16,
  usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
const sourceVel=dev.createBuffer({label:'m861SourceVel',size:MAX_SOURCE*16,
  usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
const counter=dev.createBuffer({label:'m861SourceCounter',size:16,
  usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
const uni=dev.createBuffer({label:'m861InletUniform',size:64,
  usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const UF=new Float32Array(16),UU=new Uint32Array(UF.buffer);
const readbacks=[0,1,2].map(i=>({
  buf:dev.createBuffer({label:`m861Telemetry${i}`,size:16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),
  busy:false,requested:0
}));

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
  releaseLen:f32,
  guideTop:f32,
  pad1:f32,
}
struct Counter { claim:atomic<u32>, emitted:atomic<u32>, pad0:u32, pad1:u32 }
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

  // Filled numerical nozzle. Guidance is strongest in the upper throat and smoothly
  // falls to zero as particles approach outletY; below outletY the jet is ordinary PBF.
  if(p.y>U.outletY && p.y<U.guideTop && r<U.nozzleR*1.44){
    let fade=clamp((p.y-U.outletY)/max(U.releaseLen,1.0e-5),0.0,1.0);
    let guide=smoothstep(0.0,1.0,fade);
    let radial=select(vec2f(0.0),q/max(r,1.0e-6),r>1.0e-6);
    let wall=max(0.0,r-U.nozzleR*.84)/max(U.nozzleR*.34,1.0e-5);
    let vxz=vec2f(v.x,v.z);
    let guidedXZ=vxz*(1.0-.80*guide)-radial*(U.radialGain*wall*guide);
    let guidedY=mix(v.y,-U.speed,.70*guide);
    v=vec3f(guidedXZ.x,guidedY,guidedXZ.y);
    vel[j]=vec4f(v,0.0);
  }

  if(U.sourceN==0u){return;}
  // Broad lower-basin donor reservoir. BCC source positions are non-overlapping, so it is
  // safer to guarantee complete planes than to over-filter donors by tiny velocity changes.
  if(p.y>=U.recycleY || length(v)>=U.donorSpeed || r<U.nozzleR*1.55){return;}
  let slot=atomicAdd(&C.claim,1u);
  if(slot>=U.sourceN){return;}
  let np=sourcePos[slot];
  let nv=sourceVel[slot];
  pos[j]=np;
  pred[j]=np;
  vel[j]=nv;
  atomicAdd(&C.emitted,1u);
}`;

const mod=dev.createShaderModule({code:WGSL,label:'m861OpenBoundaryWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.6.1 inlet WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'m861OpenBoundary',layout:'auto',compute:{module:mod,entryPoint:'main'}});

function geometry(d){
  const axial=.5*Math.cbrt(2)*d;
  const topY=sim.params.box[1]-d*4.0;
  const outletY=topY-THROAT_PLANES*axial;
  return {axial,topY,outletY};
}

function bccPlane(d,parity){
  const a=Math.cbrt(2)*d,half=.5*a;
  // Finite circular BCC planes otherwise alternate 9/12 particles around this radius.
  // A tiny parity radius compensation gives ~13/12 instead: much steadier mass flux.
  const R=radiusScale*d*(parity?.94:1.02);
  const off=parity?half:0;
  const e=Math.ceil((R+half)/a)+1,out=[];
  for(let ix=-e;ix<=e;ix++)for(let iz=-e;iz<=e;iz++){
    const x=ix*a+off,z=iz*a+off;
    if(x*x+z*z<=R*R+1e-10)out.push([x,z]);
  }
  return out;
}

function writeSource(P,V,n){
  if(n<=0){pendingN=0;return;}
  dev.queue.writeBuffer(sourcePos,0,P);
  dev.queue.writeBuffer(sourceVel,0,V);
  pendingN=n;requestedTotal+=n;
}

function prepareSource(frameDt){
  if(active!=='faucet'||ui.paused){pendingN=0;return;}
  const p=sim.params,d=Math.max(.001,Number(p.spacing)||.025),b=p.box,g=Math.max(0,Number(p.gravity)||9.81);
  const {axial,topY,outletY}=geometry(d);
  const cx=b[0]*.5,cz=b[2]*.5;
  const P=new Float32Array(MAX_SOURCE*4),V=new Float32Array(MAX_SOURCE*4);
  let n=0;

  // First faucet frame: build a genuinely filled ten-plane throat before relying on flux.
  if(primeRemaining>0){
    const planes=Math.min(primeRemaining,THROAT_PLANES);
    for(let k=0;k<planes&&n<MAX_SOURCE;k++){
      const parity=(layerSerial++)&1;
      const cross=bccPlane(d,parity);
      const y=outletY+(k+.55)*axial;
      for(const q of cross){
        if(n>=MAX_SOURCE)break;
        P[n*4]=cx+q[0];P[n*4+1]=y;P[n*4+2]=cz+q[1];P[n*4+3]=1;
        V[n*4]=0;V[n*4+1]=-speed;V[n*4+2]=0;V[n*4+3]=0;n++;
      }
    }
    primeRemaining-=planes;
    writeSource(P,V,n);
    return;
  }

  const dt=Math.min(.04,Math.max(0,Number(frameDt)||0));
  const before=phase,travel=before+speed*dt;
  let layers=Math.floor(travel/axial);
  phase=travel-layers*axial;
  layers=Math.min(layers,6);
  if(layers<=0){pendingN=0;return;}

  // Spawn farther from the top wall than M8.6.0. Sub-frame compensation can move a plane
  // upstream, but the 4d source clearance prevents multiple planes clamping onto one height.
  for(let k=0;k<layers&&n<MAX_SOURCE;k++){
    const parity=(layerSerial++)&1;
    const cross=bccPlane(d,parity);
    const eventDist=(k+1)*axial-before;
    const tau=Math.min(dt,Math.max(0,eventDist/Math.max(speed,1e-6)));
    const upstream=speed*tau+g*dt*tau-.5*g*tau*tau;
    const y=Math.min(b[1]-d*1.25,topY+upstream);
    const vy=-speed+g*tau;
    for(const q of cross){
      if(n>=MAX_SOURCE)break;
      const x=cx+q[0],z=cz+q[1];
      if(x<=d*.6||x>=b[0]-d*.6||z<=d*.6||z>=b[2]-d*.6)continue;
      P[n*4]=x;P[n*4+1]=y;P[n*4+2]=z;P[n*4+3]=1;
      V[n*4]=0;V[n*4+1]=vy;V[n*4+2]=0;V[n*4+3]=0;n++;
    }
  }
  writeSource(P,V,n);
}

function queueTelemetry(enc,sourceN){
  if(sourceN<=0 || inletPasses%12!==0)return;
  const idx=readbacks.findIndex(r=>!r.busy);
  if(idx<0)return;
  const rb=readbacks[idx];
  rb.busy=true;rb.requested=sourceN;
  enc.copyBufferToBuffer(counter,0,rb.buf,0,8);
  readAfterStep=idx;
}
async function readTelemetry(idx){
  const rb=readbacks[idx];
  try{
    await rb.buf.mapAsync(GPUMapMode.READ);
    const a=new Uint32Array(rb.buf.getMappedRange());
    const emitted=Math.min(rb.requested,a[1]||0);
    lastRequested=rb.requested;lastEmitted=emitted;telemetrySamples++;
    if(emitted<rb.requested)partialEvents++;
    rb.buf.unmap();
  }catch(err){
    try{rb.buf.unmap()}catch{}
    console.warn('[M8.6.1 telemetry]',err);
  }finally{rb.busy=false;sync();}
}

function encodeInlet(enc){
  const sourceN=pendingN;
  const n=Math.max(1,sim.n|0),p=sim.params,d=Math.max(.001,Number(p.spacing)||.025),b=p.box;
  const {axial,topY,outletY}=geometry(d);
  const R=radiusScale*d;
  const offset=(Math.imul((layerSerial+31)>>>0,2654435761)>>>0)%n;
  UU[0]=n;UU[1]=sourceN;UU[2]=offset;UU[3]=0;
  UF[4]=b[0]*.5;UF[5]=b[2]*.5;UF[6]=outletY;UF[7]=topY;
  UF[8]=R;UF[9]=Math.min(b[1]*.50,.72);UF[10]=speed;UF[11]=3.0;
  UF[12]=speed*.28;UF[13]=Math.max(2*d,3*axial);UF[14]=b[1]-d*.9;UF[15]=0;
  dev.queue.writeBuffer(uni,0,UF);
  enc.clearBuffer(counter);
  const s=sim.parity===0?'A':'B';
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:sourcePos}},
    {binding:2,resource:{buffer:sourceVel}},{binding:3,resource:{buffer:sim.buf['pos'+s]}},
    {binding:4,resource:{buffer:sim.buf['vel'+s]}},{binding:5,resource:{buffer:sim.buf['pred'+s]}},
    {binding:6,resource:{buffer:counter}},
  ]});
  const pass=enc.beginComputePass({label:'m861InletAndSmoothThroat'});
  pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(n/256));pass.end();
  queueTelemetry(enc,sourceN);
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
  let out;
  try{out=baseStep(dt)}finally{expectSimEncoder=false;}
  if(readAfterStep>=0){const idx=readAfterStep;readAfterStep=-1;readTelemetry(idx);}
  return out;
};

function applyPhysics(){
  if(!sim.params)return;
  sim.params.substeps=2;
  sim.params.iterations=3;
  sim.params.xsphC=.052;
  sim.params.sCorrK=.031;
  sim.params.surfaceTensionK=.074;
}
const visual={min:.38,max:.50,scale:.40};
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
  try{envStatus=await ssfr.env.load(HDR1K);ssfr.env.intensity=1.02;ssfr.env.yaw=0;ssfr.bindCache=null;}
  catch(err){envStatus='environment unavailable';console.warn('[M8.6.1] HDR load failed',err);}
})();

requestAnimationFrame(function tick(){raf++;requestAnimationFrame(tick)});
setInterval(()=>{
  rafRate=raf-lastRaf;lastRaf=raf;
  if(rafRate>=58&&visual.scale<visual.max)visual.scale=Math.min(visual.max,visual.scale+.01);
  else if(rafRate<47&&visual.scale>visual.min)visual.scale=Math.max(visual.min,visual.scale-.01);
  applyVisual();sync();
},1000);

function choose(name){
  if(name==='faucet'){
    active='faucet';phase=0;layerSerial=0;primeRemaining=THROAT_PLANES;
    lastRequested=0;lastEmitted=0;partialEvents=0;telemetrySamples=0;
    scenes.choose('pool');applyPhysics();applyVisual();frameCamera();
  }else if(name==='pool'){
    active='pool';pendingN=0;scenes.choose('pool');
  }else if(name==='dam'){
    active='dam';pendingN=0;scenes.choose('dam');
  }
  if(ui.paused)ui.paused=false;sync();
}

const panel=document.getElementById('m742Panel'),tabs=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
if(panel&&tabs){
  document.getElementById('m861Dock')?.remove();
  const dock=document.createElement('div');dock.id='m861Dock';dock.style.cssText='padding:8px 9px 9px;border-bottom:1px solid rgba(78,214,220,.18);background:rgba(4,16,22,.91)';
  dock.innerHTML='<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px"><b style="font:900 8px ui-monospace;color:#86f6ff;letter-spacing:.12em">BCC CONTINUITY FAUCET · M8.6.1</b><span style="font:7px ui-monospace;color:#799aa7">filled throat · telemetry</span></div><div class="m861Btns" style="display:flex;gap:6px"></div>';
  panel.insertBefore(dock,tabs);const row=dock.querySelector('.m861Btns');
  for(const [key,label] of [['faucet','FAUCET'],['pool','POOL'],['dam','DAM BREAK']]){
    const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.scene=key;
    b.style.cssText='min-height:42px;padding:7px 12px;border-radius:10px;border:1px solid rgba(78,214,220,.30);background:#071820;color:#dffcff;font:800 8px ui-monospace';
    b.onclick=e=>{e.preventDefault();e.stopPropagation();choose(key)};row.appendChild(b);
  }
}
const sceneIdx=tabs&&host?[...tabs.children].findIndex(b=>b.dataset.key==='scenes'):-1;
const page=sceneIdx>=0?host.children[sceneIdx]:null;
if(page){
  page.innerHTML='<div class="m742Intro">M8.6.1 keeps the BCC open-boundary jet and fixes its cadence: balanced alternating planes, a prefilled 10-plane throat, 4d top-wall clearance and a smooth 2d outlet release.</div>';
  const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">CONTINUITY DIAGNOSTICS</div><div class="m742Note">REQUESTED / EMITTED must remain equal. A mismatch proves a donor-plane hole; equal counts with a visible break means the free jet itself is losing PBF support.</div>';
  const make=(label,min,max,step,value,fn,fmt)=>{const r=document.createElement('div');r.className='m742Row';const l=document.createElement('label');l.textContent=label;const i=document.createElement('input');i.type='range';i.min=min;i.max=max;i.step=step;i.value=value;const v=document.createElement('div');v.className='m742Val';const show=()=>v.textContent=fmt(Number(i.value));show();i.oninput=e=>{e.stopPropagation();fn(Number(i.value));show()};r.append(l,i,v);sec.appendChild(r)};
  make('EXIT SPEED',1.20,1.55,.05,speed,x=>speed=x,x=>`${x.toFixed(2)} m/s`);
  make('NOZZLE RADIUS',2.45,2.75,.05,radiusScale,x=>radiusScale=x,x=>`${x.toFixed(2)} d`);
  status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';sec.appendChild(status);page.appendChild(sec);
}
function sync(){
  document.querySelectorAll('.m861Btns button').forEach(b=>b.style.borderColor=b.dataset.scene===active?'#f1ad43':'rgba(78,214,220,.30)');
  if(!status)return;
  const d=Number(sim.params?.spacing)||.025,{axial}=geometry(d);
  const c0=bccPlane(d,0).length,c1=bccPlane(d,1).length;
  const ok=lastRequested>0&&lastRequested===lastEmitted?'OK':lastRequested>0?'MISS':'WAIT';
  status.textContent=`ACTIVE ${active.toUpperCase()} · RAF ${rafRate}/s\nactive ${sim.n.toLocaleString()} / cap ${(sim.cap||sim.n).toLocaleString()} · constant mass\nBCC axial ${(axial/d).toFixed(2)}d (${(axial*1000).toFixed(1)} mm) · planes ${c0}/${c1} particles\nexit ${speed.toFixed(2)} m/s · throat ${THROAT_PLANES} planes · smooth release ${Math.max(2*d,3*axial).toFixed(3)} m\nREQUESTED / EMITTED ${lastRequested} / ${lastEmitted} · ${ok} · misses ${partialEvents}/${telemetrySamples}\ninlet passes ${inletPasses.toLocaleString()} · source ${requestedTotal.toLocaleString()} · SSFR ${Math.round(visual.scale*100)}%\nenvironment ${envStatus}`;
}

window.__v5M852Faucet={online:true,backend:'bcc-continuity-m861',choose,get active(){return active},get raf(){return rafRate}};
window.__v5M861Faucet={
  online:true,backend:'balanced-bcc-prefilled-smooth-open-boundary-m861',choose,
  get active(){return active},get raf(){return rafRate},get passes(){return inletPasses},
  get requested(){return lastRequested},get emitted(){return lastEmitted},get partialEvents(){return partialEvents}
};
window.__fluidV5Version='8.6.1';
window.__fluidV5Build='M8.6.1 BALANCED BCC / PREFILLED THROAT / SMOOTH RELEASE / INLET TELEMETRY';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.6.1';
document.title='Fluid V8 · M8.6.1 BCC Continuity Faucet';
setTimeout(()=>choose('faucet'),220);sync();
console.info('[Fluid V8 M8.6.1] balanced BCC + prefilled throat + smooth outlet + telemetry online; added submits 0.');
