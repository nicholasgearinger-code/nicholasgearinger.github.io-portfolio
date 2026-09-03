// Fluid V8 M8.5.4 — coherent laminar faucet free jet.
// Faucet-only fast path: native PBF, pre-solve inlet, close-packed alternating layers.
// No post-release stream force is applied. Cohesion comes from denser inlet sampling,
// realistic exit velocity, XSPH viscosity and the solver's surface tension.

const sim=window.__sim,ui=window.__ui,scenes=window.__v5M743Scenes,ssfr=window.__ssfr,cam=window.__cam;
if(!sim?.appendFluid||!ui||!scenes?.online||!ssfr||!cam)throw new Error('M8.5.4 faucet: base PBF runtime unavailable.');

const baseN=Math.max(1,sim.scene?.nFluid||sim.n||1);
let active='faucet';
let speed=1.35;
let radiusScale=2.25;
let layerScale=.82;
let phaseDistance=0;
let latticePhase=0;
let primed=false;
let layers=0,added=0,lastAdded=0;
let raf=0,lastRaf=0,rafRate=60;
let status=null;

function applyPhysics(){
  const p=sim.params;
  p.substeps=2;
  p.iterations=3;
  p.xsphC=.058;
  p.sCorrK=.034;
  p.surfaceTensionK=.115;
}
function applyVisual(){
  // Let SSFR bridge the Lagrangian stretching of a free jet without hiding bulk motion.
  ssfr.splatRadius=1.28;
  ssfr.filter=1;
  ssfr.filterIterations=1;
  ssfr.filterSigma=.60;
  ssfr.thicknessRadius=Math.max(Number(ssfr.thicknessRadius)||1.2,1.34);
  ssfr.thicknessFilterSize=6;
  ssfr.bindCache=null;
}
applyPhysics();applyVisual();

// Close camera for the compact high-resolution basin. This corrects the old V4 fixed camera.
cam.az=-.72;cam.el=.43;cam.dist=2.05;cam.target=[sim.params.box[0]*.50,sim.params.box[1]*.48,sim.params.box[2]*.50];

function crossSection(d,phase){
  const R=radiusScale*d;
  const shift=phase?d*.50:0;
  const e=Math.ceil(radiusScale+1),out=[];
  for(let ix=-e;ix<=e;ix++)for(let iz=-e;iz<=e;iz++){
    const x=ix*d+shift,z=iz*d+shift;
    if(x*x+z*z<=R*R+1e-10)out.push([x,z]);
  }
  return out;
}
function resetCount(){
  if(sim.n!==baseN){sim.n=baseN;sim.uploadParams?.(1/120);sim.bindCache=null;}
  phaseDistance=0;latticePhase=0;primed=false;layers=0;added=0;lastAdded=0;
}
function appendLayer(pos,vel,cross,cx,y,cz,vy){
  const b=sim.params.box,d=Number(sim.params.spacing)||.0225;
  for(const q of cross){
    const x=cx+q[0],z=cz+q[1];
    if(x<=d*.55||x>=b[0]-d*.55||z<=d*.55||z>=b[2]-d*.55)continue;
    pos.push(x,y,z);vel.push(0,vy,0);
  }
}

function inject(frameDt){
  if(active!=='faucet'||ui.paused)return 0;
  applyPhysics();applyVisual();
  const p=sim.params,d=Number(p.spacing)||.0225,b=p.box,g=Math.max(0,Number(p.gravity)||9.81);
  const step=Math.max(d*.78,d*layerScale),room=Math.max(0,(sim.cap||sim.n)-sim.n);
  const c0=crossSection(d,0),c1=crossSection(d,1),maxCross=Math.max(c0.length,c1.length);
  if(room<maxCross)return 0;

  const outletY=b[1]-d*5.0,cx=b[0]*.50,cz=b[2]*.50;
  const pos=[],vel=[];

  // Fill a short numerical throat with alternating close-packed layers once.
  if(!primed){
    const prime=Math.min(7,Math.floor(room/Math.max(1,maxCross)));
    for(let k=0;k<prime;k++){
      const ph=latticePhase++&1,cross=ph?c1:c0;
      appendLayer(pos,vel,cross,cx,outletY+k*step,cz,-speed);
      layers++;
    }
    primed=true;
  }

  const dt=Math.min(.05,Math.max(0,Number(frameDt)||0));
  const before=phaseDistance,travel=before+speed*dt;
  let count=Math.floor(travel/step);
  phaseDistance=travel-count*step;
  count=Math.min(count,12);

  for(let k=0;k<count;k++){
    const ph=latticePhase++&1,cross=ph?c1:c0;
    if((pos.length/3)+cross.length>room)break;
    const distanceToEvent=(k+1)*step-before;
    const eventTime=Math.min(dt,Math.max(0,distanceToEvent/Math.max(speed,1e-6)));

    // Insert at frame start so after a full PBF step the layer matches one that really entered
    // at eventTime. The previous M8.5.2 expression had an extra +g*dt*t term that separated layers.
    const upstream=Math.max(0,speed*eventTime-.5*g*eventTime*eventTime);
    const y=Math.min(b[1]-d*.70,outletY+upstream);
    const vy=-speed+g*eventTime;
    appendLayer(pos,vel,cross,cx,y,cz,vy);
    layers++;
  }

  if(!pos.length){lastAdded=0;return 0;}
  const n=sim.appendFluid(pos,vel);added+=n;lastAdded=n;return n;
}

// Pre-solve insertion: new water is in the same neighbour/density solve immediately.
const baseStep=sim.step.bind(sim);
sim.step=function(frameDt){
  try{inject(frameDt)}catch(err){console.error('[M8.5.4 coherent inlet]',err)}
  return baseStep(frameDt);
};

function choose(name){
  if(name==='faucet'){resetCount();scenes.choose('pool');active='faucet';applyPhysics();applyVisual();}
  else if(name==='pool'){resetCount();active='pool';scenes.choose('pool');}
  else if(name==='dam'){resetCount();active='dam';scenes.choose('dam');}
  if(ui.paused)ui.paused=false;sync();
}

// Adaptive surface budget: spend excess 60 FPS headroom but protect a ~45 FPS floor.
requestAnimationFrame(function tick(){raf++;requestAnimationFrame(tick)});
setInterval(()=>{
  rafRate=raf-lastRaf;lastRaf=raf;
  let s=Number(ssfr.renderScale)||.44;
  if(rafRate>=54)s=Math.min(.52,s+.02);
  else if(rafRate>=49)s=Math.min(.50,s+.01);
  else if(rafRate<42)s=Math.max(.38,s-.03);
  else if(rafRate<45)s=Math.max(.40,s-.015);
  ssfr.renderScale=s;ssfr.bindCache=null;
  const fps=document.getElementById('v4fps');if(fps)fps.textContent=`${rafRate} FPS`;
  sync();
},1000);

// Compact controls.
const panel=document.getElementById('m742Panel'),tabs=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
if(panel&&tabs){
  const dock=document.createElement('div');dock.id='m854Dock';dock.style.cssText='padding:8px 9px 9px;border-bottom:1px solid rgba(78,214,220,.18);background:rgba(4,16,22,.91)';
  dock.innerHTML='<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px"><b style="font:900 8px ui-monospace;color:#86f6ff;letter-spacing:.12em">COHERENT FREE JET · M8.5.4</b><span style="font:7px ui-monospace;color:#799aa7">close-packed inlet · target 45+ FPS</span></div><div id="m854Btns" style="display:flex;gap:6px"></div>';
  panel.insertBefore(dock,tabs);const row=dock.querySelector('#m854Btns');
  for(const [key,label] of [['faucet','FAUCET'],['pool','POOL'],['dam','DAM BREAK']]){const b=document.createElement('button');b.className='m742Btn';b.textContent=label;b.dataset.scene=key;b.onclick=e=>{e.preventDefault();e.stopPropagation();choose(key)};row.appendChild(b)}
}
const idx=tabs&&host?[...tabs.children].findIndex(b=>b.dataset.key==='scenes'):-1;
const page=idx>=0?host.children[idx]:null;
function slider(parent,label,min,max,step,value,onchange,fmt=v=>Number(v).toFixed(2)){
  const r=document.createElement('div');r.className='m742Row';const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;const val=document.createElement('div');val.className='m742Val';val.textContent=fmt(value);input.oninput=e=>{e.stopPropagation();const x=Number(input.value);onchange(x);val.textContent=fmt(x)};r.append(l,input,val);parent.appendChild(r);
}
if(page){
  page.innerHTML='<div class="m742Intro">M8.5.4 increases faucet momentum and uses alternating close-packed layers so the inlet behaves like one continuous volume of water rather than independent discs.</div>';
  const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">COHERENT LAMINAR JET</div><div class="m742Note">No post-release attraction or alignment. Once a layer enters the PBF solve it is ordinary water.</div>';
  slider(sec,'EXIT SPEED',.85,1.75,.05,speed,v=>speed=v,v=>`${Number(v).toFixed(2)} m/s`);
  slider(sec,'NOZZLE RADIUS',1.8,2.8,.05,radiusScale,v=>{radiusScale=v;primed=false},v=>`${Number(v).toFixed(2)} d`);
  slider(sec,'LAYER SPACING',.78,1.00,.02,layerScale,v=>{layerScale=v;phaseDistance=0},v=>`${Number(v).toFixed(2)} d`);
  status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';sec.appendChild(status);page.appendChild(sec);
}
function sync(){
  document.querySelectorAll('#m854Btns [data-scene]').forEach(b=>b.classList.toggle('active',b.dataset.scene===active));
  if(!status)return;const d=Number(sim.params.spacing)||.0225,c0=crossSection(d,0).length,c1=crossSection(d,1).length;
  status.textContent=`ACTIVE ${active.toUpperCase()} · RAF ${rafRate}/s\nactive ${sim.n.toLocaleString()} / cap ${(sim.cap||sim.n).toLocaleString()} · base ${baseN.toLocaleString()}\nspacing ${(d*1000).toFixed(1)} mm · nozzle ${c0}/${c1} particles · layer ${layerScale.toFixed(2)}d\nexit ${speed.toFixed(2)} m/s · SSFR ${Math.round((ssfr.renderScale||0)*100)}% · XSPH ${sim.params.xsphC.toFixed(3)} · tension ${sim.params.surfaceTensionK.toFixed(3)}\nlayers ${layers.toLocaleString()} · added ${added.toLocaleString()} · last +${lastAdded}`;
}

window.__v5M854Faucet={online:true,backend:'close-packed-pre-solve-freejet-m854',choose,get active(){return active},get raf(){return rafRate},get added(){return added}};
window.__fluidV5Version='8.5.4';window.__fluidV5Build='M8.5.4 COHERENT FREE JET / CLOSE-PACKED INLET / HIGH-FAST PBF';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.5.4';document.title='Fluid V8 · M8.5.4 Coherent Faucet';
setTimeout(()=>choose('faucet'),250);sync();
console.info('[Fluid V8 M8.5.4] coherent close-packed faucet inlet online.');