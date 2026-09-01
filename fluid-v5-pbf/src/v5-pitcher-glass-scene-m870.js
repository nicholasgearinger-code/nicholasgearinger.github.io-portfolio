// Fluid V8 M8.7.0 — Option A pitcher -> glass validation scene.
// Kinematic visual pitcher + static glass collider + finite BCC lip emitter.
// There is intentionally NO simulated water volume inside the pitcher yet: fluid is appended
// only at the lip using the solver's reserved pour capacity. The glass collision pass is
// appended after PBF and before SSFR rendering inside the existing M7.3.9 shared encoder.
// Added queue.submit calls: ZERO.

const sim=window.__sim,ui=window.__ui,cam=window.__cam,ssfr=window.__ssfr,scenes=window.__v5M743Scenes;
if(!sim?.dev||!ui||!cam||!ssfr||!scenes?.online||!window.__v5M739Unified?.online)
  throw new Error('M8.7 pitcher scene: unified PBF/SSFR runtime unavailable.');
if(typeof sim.appendFluid!=='function')throw new Error('M8.7 pitcher scene: appendFluid() unavailable.');
const dev=sim.dev;

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t)};
const norm3=v=>{const l=Math.hypot(v[0],v[1],v[2])||1;return[v[0]/l,v[1]/l,v[2]/l]};
const rotZ=(v,a)=>{const c=Math.cos(a),s=Math.sin(a);return[c*v[0]-s*v[1],s*v[0]+c*v[1],v[2]||0]};
const add3=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul3=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];

const rig={pivot:[.305,1.205,.370],lipLocal:[.220,.105,0],maxTilt:60*Math.PI/180,speed:1.15,radiusScale:2.28,idle:.62,tiltDuration:1.18,pourStart:1.62,holdAfter:.34,returnDuration:1.05};
const glass={cx:.635,cz:.370,innerR:.168,outerR:.184,baseY:.105,rimY:.695};
const initialConfiguredN=Math.max(1,sim.n|0),cap=Math.max(initialConfiguredN,sim.cap||initialConfiguredN);
const reservoirTotal=Math.min(4600,Math.max(2400,Math.floor(cap*.22)));
let reservoirLeft=reservoirTotal,emitted=0,elapsed=0,finishedAt=-1,phaseDistance=0,layerSerial=1;
let collisionPasses=0,appendEvents=0,collisionEnabled=true,lastDt=1/60,replaySerial=0,status=null,raf=0,lastRaf=0,rafRate=0;

function pose(){
  const tiltStart=rig.idle,tiltEnd=rig.idle+rig.tiltDuration;let tilt=0,phase='IDLE';
  if(elapsed<tiltStart){phase='IDLE';}
  else if(elapsed<tiltEnd){phase='TILTING';tilt=rig.maxTilt*smooth((elapsed-tiltStart)/rig.tiltDuration);}
  else if(reservoirLeft>0||finishedAt<0){phase='POURING';tilt=rig.maxTilt;}
  else if(elapsed<finishedAt+rig.holdAfter){phase='DRIP / HOLD';tilt=rig.maxTilt;}
  else if(elapsed<finishedAt+rig.holdAfter+rig.returnDuration){phase='RETURNING';tilt=rig.maxTilt*(1-smooth((elapsed-finishedAt-rig.holdAfter)/rig.returnDuration));}
  else phase='SETTLING';
  const a=-tilt,lip=add3(rig.pivot,rotZ(rig.lipLocal,a)),dir=norm3(rotZ([1,0,0],a));
  return{tilt,phase,lip,dir};
}
function bccPlane(d,parity,radiusMul){
  const a=Math.cbrt(2)*d,half=.5*a,R=radiusMul*d,off=parity?half:0,e=Math.ceil((R+half)/a)+1,out=[];
  for(let i=-e;i<=e;i++)for(let j=-e;j<=e;j++){const x=i*a+off,z=j*a+off;if(x*x+z*z<=R*R+1e-10)out.push([x,z]);}
  return out;
}
function prepareFiniteSource(dt){
  if(ui.paused)return 0;elapsed+=Math.min(.04,Math.max(0,Number(dt)||0));const P=pose();
  if(elapsed<rig.pourStart||reservoirLeft<=0){if(reservoirLeft<=0&&finishedAt<0)finishedAt=elapsed;return 0;}
  const d=Math.max(.001,Number(sim.params?.spacing)||.025),g=Math.max(0,Number(sim.params?.gravity)||9.81),axial=.5*Math.cbrt(2)*d;
  const taper=smooth(clamp((reservoirLeft/reservoirTotal)/.18,0,1)),speed=rig.speed*(.76+.24*taper),radiusMul=1.28+(rig.radiusScale-1.28)*taper;
  const stepDt=Math.min(.04,Math.max(.001,Number(dt)||1/60));phaseDistance+=speed*stepDt;let layers=Math.floor(phaseDistance/axial);
  if(layers<=0)return 0;layers=Math.min(layers,6);phaseDistance-=layers*axial;
  const outPos=[],outVel=[],u=norm3([-P.dir[1],P.dir[0],0]),w=[0,0,1];
  for(let k=0;k<layers&&outPos.length/3<reservoirLeft;k++){
    const parity=(layerSerial++)&1,cross=bccPlane(d,parity,radiusMul),behind=phaseDistance+k*axial,tau=behind/Math.max(speed,1e-6);
    const centre=[P.lip[0]+P.dir[0]*speed*tau,P.lip[1]+P.dir[1]*speed*tau-.5*g*tau*tau,P.lip[2]+P.dir[2]*speed*tau];
    const vv=[P.dir[0]*speed,P.dir[1]*speed-g*tau,P.dir[2]*speed];
    for(const q of cross){
      if(outPos.length/3>=reservoirLeft)break;
      const jitter=(Math.sin((layerSerial*31+outPos.length)*12.9898)*43758.5453%1)*d*.025;
      const p=add3(centre,add3(mul3(u,q[0]+jitter),mul3(w,q[1]-jitter)));
      if(p[0]<d||p[0]>sim.params.box[0]-d||p[1]<d||p[1]>sim.params.box[1]-d||p[2]<d||p[2]>sim.params.box[2]-d)continue;
      outPos.push(p[0],p[1],p[2]);outVel.push(vv[0],vv[1],vv[2]);
    }
  }
  if(!outPos.length)return 0;const added=sim.appendFluid(outPos,outVel);
  if(added>0){reservoirLeft=Math.max(0,reservoirLeft-added);emitted+=added;appendEvents++;}
  if(reservoirLeft<=0&&finishedAt<0)finishedAt=elapsed;return added;
}

const COLLISION_WGSL=`
struct UData { box:vec4f, radial:vec4f, vertical:vec4f, info:vec4u }
@group(0) @binding(0) var<uniform> U:UData;
@group(0) @binding(1) var<storage,read_write> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> pred:array<vec4f>;
fn safe2(v:vec2f)->vec2f{let l=length(v);return select(vec2f(1.0,0.0),v/max(l,1.0e-6),l>1.0e-6);}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.info.x){return;}var p=pos[i].xyz;var v=vel[i].xyz;
  let d=max(U.box.w,.001);let centre=U.radial.xy;let inner=U.radial.z;let outer=U.radial.w;
  let baseY=U.vertical.x;let rimY=U.vertical.y;let dt=max(U.vertical.z,1.0e-4);
  let prev=p-v*dt;let q=p.xz-centre;let r=length(q);let dir=safe2(q);let prevR=length(prev.xz-centre);let pad=max(d*.42,.006);
  if(r<inner-pad*.15 && p.y<baseY+pad){p.y=baseY+pad;if(v.y<0.0){v.y=-v.y*.16;}v.xz*=.86;}
  if(prev.y>rimY && p.y<=rimY+pad*.55 && r>inner-pad*.25 && r<outer+pad*.45){p.y=rimY+pad*.65;if(v.y<0.0){v.y=-v.y*.12;}let vr=dot(v.xz,dir);v.xz-=dir*vr*.55;}
  if(p.y>baseY+pad*.25 && p.y<rimY+pad*.35){
    let nearWall=r>inner-pad && r<outer+pad;let crossedOut=prevR<inner-pad*.15 && r>=inner-pad;let crossedIn=prevR>outer+pad*.15 && r<=outer+pad;
    if(nearWall||crossedOut||crossedIn){
      var inside=prevR<(inner+outer)*.5;if(crossedOut){inside=true;}if(crossedIn){inside=false;}
      if(inside){p.xz=centre+dir*(inner-pad);let vr=dot(v.xz,dir);if(vr>0.0){v.xz-=dir*vr*1.22;}}
      else{p.xz=centre+dir*(outer+pad);let vr=dot(v.xz,dir);if(vr<0.0){v.xz-=dir*vr*1.22;}}
      v.xz*=.94;
    }
  }
  pos[i]=vec4f(p,1.0);pred[i]=vec4f(p,1.0);vel[i]=vec4f(v,0.0);
}`;
const colMod=dev.createShaderModule({code:COLLISION_WGSL,label:'m870GlassCollisionWGSL'});
if(typeof colMod.getCompilationInfo==='function'){
  const info=await colMod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.7 glass WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const colPipe=await dev.createComputePipelineAsync({label:'m870GlassCollision',layout:'auto',compute:{module:colMod,entryPoint:'main'}});
const colUni=dev.createBuffer({label:'m870GlassCollisionUniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const CF=new Float32Array(16),CU=new Uint32Array(CF.buffer);
function encodeCollision(enc){
  if(!collisionEnabled||sim.n<=0)return false;const d=Math.max(.001,Number(sim.params.spacing)||.025),b=sim.params.box;
  CF.fill(0);CF[0]=b[0];CF[1]=b[1];CF[2]=b[2];CF[3]=d;CF[4]=glass.cx;CF[5]=glass.cz;CF[6]=glass.innerR;CF[7]=glass.outerR;CF[8]=glass.baseY;CF[9]=glass.rimY;CF[10]=Math.min(.04,Math.max(.001,lastDt));
  CU[12]=Math.max(0,sim.n|0);dev.queue.writeBuffer(colUni,0,CF);
  const pos=sim.livePos?.(),vel=sim.liveVel?.(),pred=sim.buf?.[sim.parity===0?'predA':'predB'];if(!pos||!vel||!pred)return false;
  const bg=dev.createBindGroup({layout:colPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:colUni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:pred}}]});
  const pass=enc.beginComputePass({label:'m870StaticGlassCollision'});pass.setPipeline(colPipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/256)));pass.end();collisionPasses++;sim.bindCache=null;return true;
}

const previousCreate=dev.createCommandEncoder.bind(dev),previousStep=sim.step.bind(sim);let expectSimEncoder=false,collisionAppended=false;
dev.createCommandEncoder=function(desc){
  const enc=previousCreate(desc);if(!expectSimEncoder)return enc;expectSimEncoder=false;
  return new Proxy(enc,{get(target,prop){
    if(prop==='finish')return(...args)=>{if(!collisionAppended){collisionAppended=true;try{encodeCollision(target)}catch(err){console.error('[M8.7 glass collision]',err);}}return target.finish(...args)};
    const value=Reflect.get(target,prop,target);return typeof value==='function'?value.bind(target):value;
  }});
};
sim.step=function(dt){lastDt=Number.isFinite(dt)?dt:lastDt;prepareFiniteSource(lastDt);collisionAppended=false;expectSimEncoder=true;try{return previousStep(dt)}finally{expectSimEncoder=false;}};

function clearFluid(){sim.n=0;sim.uploadParams?.(1/240);sim.bindCache=null;}
function frameCamera(){cam.az=-.70;cam.el=.34;cam.dist=2.18;cam.target=[.53,.78,.37];}
function replay(){replaySerial++;reservoirLeft=reservoirTotal;emitted=0;elapsed=0;finishedAt=-1;phaseDistance=0;layerSerial=1;collisionPasses=0;appendEvents=0;clearFluid();if(ui.paused)ui.paused=false;frameCamera();sync();}
frameCamera();

const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='m870Rig';svg.setAttribute('aria-hidden','true');svg.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:7;pointer-events:none;overflow:visible';document.body.appendChild(svg);
function S(tag,attrs={}){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);svg.appendChild(n);return n;}
const glassTop=S('polyline',{fill:'none',stroke:'rgba(205,244,255,.72)','stroke-width':'2'}),glassBottom=S('polyline',{fill:'none',stroke:'rgba(180,230,245,.44)','stroke-width':'1.5'}),glassSides=[0,1,2,3].map(()=>S('line',{stroke:'rgba(190,238,250,.52)','stroke-width':'1.4'}));
const pitcherBack=S('polygon',{fill:'rgba(207,228,235,.08)',stroke:'rgba(220,242,248,.38)','stroke-width':'1.2'}),pitcherFront=S('polygon',{fill:'rgba(224,239,244,.14)',stroke:'rgba(235,249,252,.72)','stroke-width':'1.8'}),pitcherConnect=[0,1,2,3,4,5].map(()=>S('line',{stroke:'rgba(220,242,248,.34)','stroke-width':'1.1'}));
const handle=S('polyline',{fill:'none',stroke:'rgba(235,249,252,.66)','stroke-width':'5','stroke-linecap':'round','stroke-linejoin':'round'}),lipMark=S('circle',{r:'3.2',fill:'#ffd890',stroke:'rgba(255,255,255,.75)','stroke-width':'1'});
const labelPitcher=S('text',{fill:'rgba(220,245,250,.72)','font-size':'10','font-family':'ui-monospace,monospace'}),labelGlass=S('text',{fill:'rgba(205,244,255,.72)','font-size':'10','font-family':'ui-monospace,monospace'});labelPitcher.textContent='KINEMATIC PITCHER';labelGlass.textContent='STATIC GLASS';
const proj=p=>window.__project?.(p)||null,ptsAttr=arr=>arr.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
function setLine(el,a,b){if(!a||!b){el.setAttribute('visibility','hidden');return}el.setAttribute('visibility','visible');el.setAttribute('x1',a.x);el.setAttribute('y1',a.y);el.setAttribute('x2',b.x);el.setAttribute('y2',b.y)}
function updateRig(){
  const P=pose(),theta=-P.tilt,top=[],bottom=[];
  for(let i=0;i<=28;i++){const a=i/28*Math.PI*2;top.push(proj([glass.cx+Math.cos(a)*glass.outerR,glass.rimY,glass.cz+Math.sin(a)*glass.outerR]));bottom.push(proj([glass.cx+Math.cos(a)*glass.outerR,glass.baseY,glass.cz+Math.sin(a)*glass.outerR]));}
  if(top.every(Boolean)&&bottom.every(Boolean)){glassTop.setAttribute('points',ptsAttr(top));glassBottom.setAttribute('points',ptsAttr(bottom));glassTop.setAttribute('visibility','visible');glassBottom.setAttribute('visibility','visible');}
  [0,Math.PI*.5,Math.PI,Math.PI*1.5].forEach((a,i)=>setLine(glassSides[i],proj([glass.cx+Math.cos(a)*glass.outerR,glass.baseY,glass.cz+Math.sin(a)*glass.outerR]),proj([glass.cx+Math.cos(a)*glass.outerR,glass.rimY,glass.cz+Math.sin(a)*glass.outerR])));
  const local=[[-.165,-.195],[.105,-.185],[.128,.070],[.220,.105],[.120,.155],[-.145,.202]],depth=.105,world=(q,z)=>{const r=rotZ([q[0],q[1],0],theta);return[rig.pivot[0]+r[0],rig.pivot[1]+r[1],rig.pivot[2]+z]};
  const front=local.map(q=>proj(world(q,-depth))),back=local.map(q=>proj(world(q,depth)));if(front.every(Boolean)){pitcherFront.setAttribute('points',ptsAttr(front));pitcherFront.setAttribute('visibility','visible')}if(back.every(Boolean)){pitcherBack.setAttribute('points',ptsAttr(back));pitcherBack.setAttribute('visibility','visible')}for(let i=0;i<pitcherConnect.length;i++)setLine(pitcherConnect[i],front[i],back[i]);
  const hlocal=[[-.155,.145],[-.245,.105],[-.255,-.105],[-.175,-.145]],hp=hlocal.map(q=>proj(world(q,depth*.35))).filter(Boolean);if(hp.length===hlocal.length){handle.setAttribute('points',ptsAttr(hp));handle.setAttribute('visibility','visible')}
  const lp=proj(P.lip);if(lp){lipMark.setAttribute('cx',lp.x);lipMark.setAttribute('cy',lp.y);lipMark.setAttribute('visibility','visible');labelPitcher.setAttribute('x',lp.x-92);labelPitcher.setAttribute('y',lp.y-18);labelPitcher.setAttribute('visibility','visible')}const gp=proj([glass.cx,glass.rimY,glass.cz]);if(gp){labelGlass.setAttribute('x',gp.x+24);labelGlass.setAttribute('y',gp.y+8);labelGlass.setAttribute('visibility','visible')}requestAnimationFrame(updateRig);
}
requestAnimationFrame(updateRig);

const panel=document.getElementById('m742Panel'),tabs=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
if(panel&&tabs){document.getElementById('m870Dock')?.remove();const dock=document.createElement('div');dock.id='m870Dock';dock.style.cssText='padding:8px 9px 9px;border-bottom:1px solid rgba(78,214,220,.18);background:rgba(4,16,22,.91)';dock.innerHTML='<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px"><b style="font:900 8px ui-monospace;color:#86f6ff;letter-spacing:.12em">PITCHER → GLASS · M8.7.0</b><span style="font:7px ui-monospace;color:#799aa7">finite source · Option A</span></div><div class="m870Btns" style="display:flex;gap:6px"></div>';panel.insertBefore(dock,tabs);const row=dock.querySelector('.m870Btns');
  const replayBtn=document.createElement('button');replayBtn.type='button';replayBtn.textContent='REPLAY POUR';replayBtn.style.cssText='min-height:42px;padding:7px 12px;border-radius:10px;border:1px solid #f1ad43;background:rgba(77,54,17,.45);color:#ffd890;font:800 8px ui-monospace';replayBtn.onclick=e=>{e.preventDefault();e.stopPropagation();replay()};
  const camBtn=document.createElement('button');camBtn.type='button';camBtn.textContent='FRAME SCENE';camBtn.style.cssText='min-height:42px;padding:7px 12px;border-radius:10px;border:1px solid rgba(78,214,220,.30);background:#071820;color:#dffcff;font:800 8px ui-monospace';camBtn.onclick=e=>{e.preventDefault();e.stopPropagation();frameCamera()};row.append(replayBtn,camBtn);
}
const idx=tabs&&host?[...tabs.children].findIndex(b=>b.dataset.key==='scenes'):-1,page=idx>=0?host.children[idx]:null;
if(page){page.innerHTML='<div class="m742Intro">M8.7.0 Option A: the pitcher is kinematic and visually tracked in 3D, but its interior is not simulated yet. Real PBF water is appended only at the moving lip from a finite reservoir, then captured by a static open-top glass collision shell.</div>';const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">PITCHER POUR VALIDATION</div><div class="m742Note">Watch for a continuous stream, clean entry through the rim, rising retained water and controlled splash. The particle count must stop growing when the finite reservoir reaches zero.</div>';status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';sec.appendChild(status);page.appendChild(sec);}
requestAnimationFrame(function countRaf(){raf++;requestAnimationFrame(countRaf)});setInterval(()=>{rafRate=raf-lastRaf;lastRaf=raf;sync()},1000);
function sync(){const P=pose();if(!status)return;const pct=100*reservoirLeft/reservoirTotal;status.textContent=`${P.phase} · tilt ${(P.tilt*180/Math.PI).toFixed(1)}° · RAF ${rafRate}/s\nreservoir ${reservoirLeft.toLocaleString()} / ${reservoirTotal.toLocaleString()} (${pct.toFixed(1)}%) · emitted ${emitted.toLocaleString()}\nactive fluid ${Math.max(0,sim.n|0).toLocaleString()} / cap ${cap.toLocaleString()} · append events ${appendEvents}\nlip (${P.lip.map(v=>v.toFixed(2)).join(', ')}) · speed ${rig.speed.toFixed(2)} m/s · BCC radius ${rig.radiusScale.toFixed(2)}d\nglass inner ${(glass.innerR*100).toFixed(1)} cm · height ${((glass.rimY-glass.baseY)*100).toFixed(1)} cm · collision passes ${collisionPasses.toLocaleString()}\nfeature queue submits 0 · replay ${replaySerial}`;}

clearFluid();replay();
window.__v5M870Pitcher={online:true,backend:'kinematic-pitcher-finite-bcc-static-glass-m870',gpuSubmitsAdded:0,replay,frameCamera,get active(){return 'pitcher'},get raf(){return rafRate},get reservoirLeft(){return reservoirLeft},get reservoirTotal(){return reservoirTotal},get emitted(){return emitted},get phase(){return pose().phase},get collisionPasses(){return collisionPasses}};
window.__v5M852Faucet=window.__v5M870Pitcher;
window.__v5M830Scenes={online:true,get active(){return 'pitcher'}};
window.__fluidV5Version='8.7.0';window.__fluidV5Build='M8.7.0 KINEMATIC PITCHER / FINITE BCC LIP SOURCE / STATIC GLASS / ONE SUBMIT';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.7.0';document.title='Fluid V8 · M8.7.0 Pitcher Pour';
console.info('[Fluid V8 M8.7.0] Option A pitcher -> glass online; finite append source + static glass; added submits 0.');
