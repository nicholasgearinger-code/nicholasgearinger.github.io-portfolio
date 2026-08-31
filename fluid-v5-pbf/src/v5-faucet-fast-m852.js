// Fluid V8 M8.5.2 — high-resolution laminar faucet fast path.
//
// This is intentionally a faucet-only validation path. It removes the M8.2 post-solve
// divergence/vorticity overlay and the full scenario/render stack so mobile GPU time can be
// spent on finer PBF particles. New inlet particles are appended BEFORE Sim.step(), therefore
// they participate in the normal predict/grid/density/viscosity/tension solve immediately.
//
// The inlet uses a circular packed lattice and sub-frame emission timing. If a slow render
// frame spans multiple layer-emission times, each new layer begins slightly upstream inside a
// short virtual throat so one PBF step advances it to the position a continuously running
// nozzle would have reached. After the step starts there is no stream-specific force.

const sim=window.__sim,ui=window.__ui,scenes=window.__v5M743Scenes,ssfr=window.__ssfr;
if(!sim?.appendFluid||!ui||!scenes?.online||!ssfr)throw new Error('M8.5.2 faucet: base PBF/scene runtime unavailable.');

const baseN=Math.max(1,sim.scene?.nFluid||sim.n||1);
let active='faucet';
let speed=.68;
let radiusScale=2.05;
let layerScale=.96;
let phase=0;
let primed=false;
let layers=0,added=0,lastAdded=0;
let envStatus='not loaded';
let status=null;

// Faucet-only PBF profile. These are solver properties, not post-release stream shaping.
function applyPhysics(){
  const p=sim.params;
  p.substeps=2;
  p.iterations=3;
  p.xsphC=.046;
  p.sCorrK=.030;
  p.surfaceTensionK=.070;
}
function applyVisual(){
  ssfr.renderScale=.32;
  ssfr.splatRadius=1.05;
  ssfr.filter=1;
  ssfr.filterIterations=1;
  ssfr.filterSigma=.62;
  ssfr.thicknessRadius=Math.min(Number(ssfr.thicknessRadius)||1.82,1.20);
  ssfr.thicknessFilterSize=6;
  ssfr.bindCache=null;
}
applyPhysics();applyVisual();

// 2K is deliberate: the background/composite is still full canvas resolution, while the
// 2K HDR becomes a 512px cube face instead of M8.5.1's 1024px face. That cuts environment
// memory/cache pressure by about 4x while remaining twice the linear detail of the old 1K HDR.
const HDR2K='https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/quarry_cloudy_2k.hdr';
const HDR1K='https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/env/quarry_cloudy_1k.hdr';
(async()=>{
  try{envStatus=await ssfr.env.load(HDR2K);ssfr.env.intensity=1.02;ssfr.env.yaw=0;ssfr.bindCache=null;}
  catch(err){
    console.warn('[M8.5.2] 2K HDR failed; using 1K',err);
    try{envStatus=await ssfr.env.load(HDR1K);ssfr.env.intensity=1.02;ssfr.bindCache=null;}
    catch(err2){envStatus='environment unavailable';}
  }
})();

function disk(d){
  const R=radiusScale*d,e=Math.ceil(radiusScale),out=[];
  for(let ix=-e;ix<=e;ix++)for(let iz=-e;iz<=e;iz++){
    const x=ix*d,z=iz*d;if(x*x+z*z<=R*R+1e-10)out.push([x,z]);
  }
  return out;
}
function resetCount(){
  if(sim.n!==baseN){sim.n=baseN;sim.uploadParams?.(1/120);sim.bindCache=null;}
  phase=0;primed=false;layers=0;added=0;lastAdded=0;
}

function appendLayer(pos,vel,cross,cx,cy,cz,vy){
  const b=sim.params.box,d=sim.params.spacing;
  for(const q of cross){
    const x=cx+q[0],z=cz+q[1];
    if(x<=d*.55||x>=b[0]-d*.55||z<=d*.55||z>=b[2]-d*.55)continue;
    pos.push(x,cy,z);vel.push(0,vy,0);
  }
}

function inject(frameDt){
  if(active!=='faucet'||ui.paused)return 0;
  applyPhysics();applyVisual();
  const p=sim.params,d=Number(p.spacing)||.028,b=p.box,g=Math.max(0,Number(p.gravity)||9.81);
  const cross=disk(d),step=Math.max(d*.90,d*layerScale),room=Math.max(0,(sim.cap||sim.n)-sim.n);
  if(room<cross.length)return 0;

  // Keep the outlet several particle layers below the top boundary. This is the numerical
  // equivalent of a short filled nozzle throat and gives newly inserted layers neighbours
  // before they become a free surface.
  const outletY=b[1]-d*4.4,cx=b[0]*.50,cz=b[2]*.50;
  const pos=[],vel=[];

  // Prime the throat once with four correctly spaced layers. They are ordinary fluid from
  // the first solve onward; this is an initial inlet condition, not a continuing constraint.
  if(!primed){
    const prime=Math.min(4,Math.floor(room/Math.max(1,cross.length)));
    for(let k=0;k<prime;k++)appendLayer(pos,vel,cross,cx,outletY+k*step,cz,-speed);
    primed=true;layers+=prime;
  }

  // Continuous flux: one complete cross-section for every axial spacing travelled.
  // phase stores metres of nozzle travel left over from the previous rendered frame.
  const dt=Math.min(.05,Math.max(0,Number(frameDt)||0));
  const before=phase,travel=before+speed*dt;
  let count=Math.floor(travel/step);
  phase=travel-count*step;
  count=Math.min(count,8);

  // Determine each emission time inside this frame. Because insertion occurs before the PBF
  // step, start late-emitted layers farther upstream and with a compensating initial velocity;
  // after the full dt they match the ballistic age they should physically have.
  for(let k=0;k<count;k++){
    if((pos.length/3)+cross.length>room)break;
    const distanceToEvent=(k+1)*step-before;
    const tau=Math.min(dt,Math.max(0,distanceToEvent/Math.max(speed,1e-6)));
    const upstream=speed*tau+g*dt*tau-.5*g*tau*tau;
    const y=Math.min(b[1]-d*.70,outletY+upstream);
    const vy=-speed+g*tau;
    appendLayer(pos,vel,cross,cx,y,cz,vy);layers++;
  }

  if(!pos.length){lastAdded=0;return 0;}
  const n=sim.appendFluid(pos,vel);added+=n;lastAdded=n;return n;
}

// IMPORTANT: append BEFORE the solver. The previous M8.5 path appended after Sim.step(), so
// fresh layers missed that frame's grid and density solve and rendered as separate pancakes.
const baseStep=sim.step.bind(sim);
sim.step=function(frameDt){
  try{inject(frameDt)}catch(err){console.error('[M8.5.2 faucet inlet]',err)}
  return baseStep(frameDt);
};

function choose(name){
  if(name==='faucet'){
    resetCount();scenes.choose('pool');active='faucet';applyPhysics();applyVisual();
  }else if(name==='pool'){
    resetCount();active='pool';scenes.choose('pool');
  }else if(name==='dam'){
    resetCount();active='dam';scenes.choose('dam');
  }
  if(ui.paused)ui.paused=false;sync();
}

// Compact faucet-only scene dock.
document.getElementById('m852Style')?.remove();
const st=document.createElement('style');st.id='m852Style';st.textContent=`
#m852Dock{padding:8px 9px 9px;border-bottom:1px solid rgba(78,214,220,.18);background:rgba(4,16,22,.91)}
.m852Head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}.m852Title{font:900 8px ui-monospace;color:#86f6ff;letter-spacing:.12em}.m852Note{font:7px ui-monospace;color:#799aa7;text-align:right}.m852Row{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}.m852Row::-webkit-scrollbar{display:none}.m852Btn{flex:0 0 auto;min-height:42px;min-width:86px;padding:7px 9px;border-radius:10px;border:1px solid rgba(78,214,220,.30);background:#071820;color:#dffcff;font:800 8px ui-monospace}.m852Btn.active{border-color:#f1ad43;color:#ffd890;background:rgba(77,54,17,.45)}
`;document.head.appendChild(st);
const panel=document.getElementById('m742Panel'),tabs=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
if(panel&&tabs){
  const dock=document.createElement('div');dock.id='m852Dock';dock.innerHTML='<div class="m852Head"><div class="m852Title">LAMINAR FAUCET · M8.5.2</div><div class="m852Note">28mm PBF · pre-solve inlet · lite stack</div></div><div class="m852Row"></div>';
  panel.insertBefore(dock,tabs);const row=dock.querySelector('.m852Row');
  for(const [key,label] of [['faucet','FAUCET'],['pool','POOL'],['dam','DAM BREAK']]){const b=document.createElement('button');b.className='m852Btn';b.textContent=label;b.onclick=e=>{e.preventDefault();e.stopPropagation();choose(key)};b.dataset.scene=key;row.appendChild(b)}
}
const sceneIdx=tabs&&host?[...tabs.children].findIndex(b=>b.dataset.key==='scenes'):-1;
const page=sceneIdx>=0?host.children[sceneIdx]:null;
function slider(parent,label,min,max,step,value,onchange,fmt=v=>Number(v).toFixed(2)){
  const row=document.createElement('div');row.className='m742Row';const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;const val=document.createElement('div');val.className='m742Val';val.textContent=fmt(value);input.oninput=e=>{e.stopPropagation();const x=Number(input.value);onchange(x);val.textContent=fmt(x)};row.append(l,input,val);parent.appendChild(row);
}
if(page){page.innerHTML='<div class="m742Intro">M8.5.2 is a stripped faucet laboratory: finer particles, smaller receiving basin and native PBF only. New nozzle layers enter before the pressure solve, so they are part of the same density field immediately.</div>';const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">LAMINAR FREE JET</div><div class="m742Note">No post-release attraction, alignment, vorticity overlay, whitewater, spray or scenario forcing.</div>';slider(sec,'EXIT SPEED',.35,.95,.02,speed,v=>speed=v,v=>`${Number(v).toFixed(2)} m/s`);slider(sec,'NOZZLE RADIUS',1.65,2.50,.05,radiusScale,v=>{radiusScale=v;primed=false},v=>`${Number(v).toFixed(2)} d`);slider(sec,'AXIAL SPACING',.90,1.08,.02,layerScale,v=>{layerScale=v;phase=0},v=>`${Number(v).toFixed(2)} d`);status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';sec.appendChild(status);page.appendChild(sec)}

let raf=0,lastRaf=0,rafRate=0;requestAnimationFrame(function tick(){raf++;requestAnimationFrame(tick)});setInterval(()=>{rafRate=raf-lastRaf;lastRaf=raf;sync()},1000);
function sync(){
  document.querySelectorAll('.m852Btn').forEach(b=>b.classList.toggle('active',b.dataset.scene===active));
  if(!status)return;const d=Number(sim.params?.spacing)||0,cross=disk(d).length;
  status.textContent=`ACTIVE ${active.toUpperCase()} · actual RAF ${rafRate}/s\nactive ${sim.n.toLocaleString()} / cap ${(sim.cap||sim.n).toLocaleString()} · base ${baseN.toLocaleString()}\nparticle spacing ${(d*1000).toFixed(0)} mm · nozzle cross-section ${cross} particles · SSFR ${Math.round(ssfr.renderScale*100)}%\nPBF 2 substeps × 3 density iterations · XSPH ${sim.params.xsphC.toFixed(3)} · tension ${sim.params.surfaceTensionK.toFixed(3)}\nlayers ${layers.toLocaleString()} · added ${added.toLocaleString()} · last +${lastAdded}\nenvironment ${envStatus}`;
}

window.__v5M852Faucet={online:true,backend:'fine-pbf-pre-solve-laminar-inlet-m852',choose,get active(){return active},get raf(){return rafRate},get added(){return added}};
window.__fluidV5Version='8.5.2';window.__fluidV5Build='M8.5.2 FINE PBF LAMINAR FAUCET / PRE-SOLVE NATIVE INLET / LITE MOBILE STACK';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.5.2';document.title='Fluid V8 · M8.5.2 Laminar Faucet Fast Path';
setTimeout(()=>choose('faucet'),250);sync();
console.info('[Fluid V8 M8.5.2] fine-particle pre-solve faucet fast path online.');