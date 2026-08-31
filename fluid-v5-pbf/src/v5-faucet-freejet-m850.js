// Fluid V8 M8.5 — physically coherent faucet free-jet validation.
//
// Goal: reproduce a real faucet column, not an emitter effect.
// This module deliberately uses the upstream Sim.appendFluid() inlet path instead of a
// custom GPU teleport shader. The native path initializes every solver buffer for new water.
//
// Boundary model:
//   * prescribed circular velocity inlet at the nozzle exit;
//   * complete packed particle layers only;
//   * layer cadence from axial mass transport, independent of render FPS;
//   * gravity is analytically integrated only over the fraction of the just-finished
//     simulation slice that existed before a layer was appended;
//   * free-jet radius over that tiny unsimulated interval follows incompressible continuity
//       A v = const  =>  R(t) = R0 * sqrt(v0 / v(t));
//   * after appendFluid(), particles are ordinary M8.2 water. No airborne alignment,
//     stream constraint, attraction, or scripted post-release motion is applied.

const sim=window.__sim, ui=window.__ui;
const scenes=window.__v5M830Scenes;
const core=window.__v5M820FluidCore;
if(!sim?.appendFluid||!ui||!scenes?.online||!core?.online)
  throw new Error('M8.5 faucet: native appendFluid / M8.2 runtime unavailable.');

const ssfr=window.__ssfr;
const fullN=Math.max(1,sim.scene?.nFluid||sim.n||1);
let active='pool';
let speed=.58;
let radiusScale=2.35;      // nozzle radius in particle spacings
let layerScale=.92;       // axial spacing / particle spacing
let extruded=0;
let nextLayer=0;
let layers=0;
let added=0;
let lastAdded=0;
let lastAdvance=0;
let status=null;

// Save the common-water values so leaving the faucet returns to the normal M8.2 model.
const water=core.water;
const savedWater={
  divergence:water.divergence,divIterations:water.divIterations,vorticity:water.vorticity,
  maxCorrection:water.maxCorrection,xsph:water.xsph,tension:water.tension,
  scorr:water.scorr,densityIterations:water.densityIterations,
};
const savedSplat=Number(ssfr?.splatRadius)||.76;

function faucetWaterModel(){
  // Water-like transport for a smooth free jet: strong incompressibility, modest viscosity,
  // reduced artificial vorticity and non-exaggerated surface tension. These parameters are
  // global fluid properties, not a post-release stream force.
  water.divergence=.56;
  water.divIterations=3;
  water.vorticity=.045;
  water.maxCorrection=.11;
  water.xsph=.024;
  water.tension=.080;
  water.scorr=.026;
  water.densityIterations=5;
  if(ssfr)ssfr.splatRadius=.90;
}
function restoreWaterModel(){
  Object.assign(water,savedWater);
  if(ssfr)ssfr.splatRadius=savedSplat;
}

function diskPoints(d){
  const R=radiusScale*d;
  const pts=[];
  // A circular lattice with ~5 particle diameters across at LOW quality.
  // Keep the lattice at one nominal spacing so the density solve starts near rest density.
  const extent=Math.ceil(radiusScale);
  for(let a=-extent;a<=extent;a++){
    for(let b=-extent;b<=extent;b++){
      const x=a*d,z=b*d;
      if(x*x+z*z<=R*R+1e-10)pts.push([x,z]);
    }
  }
  return pts;
}

function resetJet(){extruded=0;nextLayer=0;layers=0;added=0;lastAdded=0;lastAdvance=0;}

function appendFaucet(simDt){
  if(active!=='faucet'||simDt<=0)return 0;
  const p=sim.params,d=Number(p.spacing)||.044,b=p.box;
  const g=Math.max(0,Number(p.gravity)||9.81);
  const layerStep=Math.max(d*.82,d*layerScale);
  const cross=diskPoints(d);
  const room=Math.max(0,(sim.cap||sim.n)-sim.n);
  if(room<cross.length)return 0;

  const nozzle=[b[0]*.34,b[1]*.83,b[2]*.50];
  extruded+=speed*simDt;
  const pos=[],vel=[];
  let made=0;

  // Cap only protects against a background-tab time jump; ordinary flow is not frame-capped.
  while(nextLayer<=extruded+1e-9&&made<12&&pos.length/3+cross.length<=room){
    const behind=Math.max(0,extruded-nextLayer);
    const age=behind/Math.max(speed,1e-6);
    const vyMag=speed+g*age;
    const y=nozzle[1]-speed*age-.5*g*age*age;
    if(y<=d*.75)break;

    // Steady incompressible free jet: as gravity accelerates the column, its area narrows.
    const shrink=Math.sqrt(speed/Math.max(speed,vyMag));
    for(const q of cross){
      const x=nozzle[0]+q[0]*shrink;
      const z=nozzle[2]+q[1]*shrink;
      if(x<=d*.55||x>=b[0]-d*.55||z<=d*.55||z>=b[2]-d*.55)continue;
      pos.push(x,y,z);
      vel.push(0,-vyMag,0);
    }
    nextLayer+=layerStep;
    made++;layers++;
  }

  if(!pos.length)return 0;
  const n=sim.appendFluid(pos,vel);
  added+=n;lastAdded=n;
  return n;
}

const baseStep=sim.step.bind(sim);
sim.step=function(frameDt){
  const out=baseStep(frameDt);
  // appendFluid after the completed solver slice is the same ordering used by the upstream hose:
  // new particles render immediately, then enter the normal PBF grid on the next physics slice.
  const advanced=Math.max(0,Number(sim.lastAdvanced)||0);
  lastAdvance=advanced;
  lastAdded=0;
  if(active==='faucet'&&advanced>0){
    try{appendFaucet(advanced)}catch(err){console.error('[M8.5 faucet append]',err)}
  }
  return out;
};

function choose(name){
  if(name==='faucet'){
    scenes.choose('pool');
    active='faucet';resetJet();faucetWaterModel();
    if(ui.paused)ui.paused=false;
  }else{
    restoreWaterModel();resetJet();active=name;
    scenes.choose(name);
  }
  sync();
}

// Replace the M8.3 dock for this validation build. Other scenes remain available as controls,
// but only FAUCET uses the new M8.5 free-jet path.
document.getElementById('m850Style')?.remove();
const style=document.createElement('style');style.id='m850Style';style.textContent=`
#m830SceneDock{display:none!important}#m850Dock{padding:8px 9px 9px;border-bottom:1px solid rgba(78,214,220,.18);background:rgba(4,16,22,.92)}
.m850Head{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:6px}.m850Title{font:900 8px ui-monospace;color:#86f6ff;letter-spacing:.12em}.m850Note{font:7px ui-monospace;color:#799aa7;text-align:right}.m850Scroll{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}.m850Scroll::-webkit-scrollbar{display:none}.m850Btn{flex:0 0 auto;min-height:42px;min-width:86px;padding:7px 9px;border-radius:10px;border:1px solid rgba(78,214,220,.30);background:#071820;color:#dffcff;font:800 8px ui-monospace}.m850Btn.active{border-color:#f1ad43;color:#ffd890;background:rgba(77,54,17,.45)}
`;
document.head.appendChild(style);
const panel=document.getElementById('m742Panel'),tabs=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
if(!panel||!tabs||!host)throw new Error('M8.5 faucet dock: settings panel unavailable.');
document.getElementById('m850Dock')?.remove();
const dock=document.createElement('div');dock.id='m850Dock';dock.innerHTML='<div class="m850Head"><div class="m850Title">V8 FREE JET · M8.5</div><div class="m850Note">native inlet · Av constant · gravity</div></div><div class="m850Scroll"></div>';
panel.insertBefore(dock,tabs);
const scroll=dock.querySelector('.m850Scroll'),buttons={};
for(const [key,label] of [['pool','POOL'],['faucet','FAUCET FREE JET'],['waterfall','WATERFALL'],['fountain','FOUNTAIN'],['pour','POUR'],['dam','DAM BREAK']]){
  const b=document.createElement('button');b.type='button';b.className='m850Btn';b.textContent=label;
  b.onclick=e=>{e.preventDefault();e.stopPropagation();choose(key)};buttons[key]=b;scroll.appendChild(b);
}
function slider(parent,label,min,max,step,value,onchange,fmt=v=>Number(v).toFixed(2)){
  const row=document.createElement('div');row.className='m742Row';const l=document.createElement('label');l.textContent=label;
  const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;
  const val=document.createElement('div');val.className='m742Val';val.textContent=fmt(value);
  input.oninput=e=>{e.stopPropagation();const x=Number(input.value);onchange(x);val.textContent=fmt(x);sync()};row.append(l,input,val);parent.appendChild(row);return input;
}
const sceneTabs=[...tabs.children],sceneIdx=sceneTabs.findIndex(b=>b.dataset.key==='scenes'),scenePage=sceneIdx>=0?host.children[sceneIdx]:null;
if(scenePage){
  scenePage.innerHTML='<div class="m742Intro">M8.5 faucet validation uses the solver\'s native fluid-append boundary. The nozzle prescribes only the inlet velocity and mass flux. Gravity, density projection, viscosity and surface tension govern the free jet after entry.</div>';
  const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">FAUCET FREE JET</div><div class="m742Note">Target: a smooth vertical column that accelerates and narrows as it falls, like a real faucet. No post-release attraction/alignment is used.</div>';
  slider(sec,'EXIT SPEED',.30,1.00,.02,speed,v=>speed=v,v=>`${Number(v).toFixed(2)} m/s`);
  slider(sec,'NOZZLE RADIUS',1.80,2.70,.05,radiusScale,v=>{radiusScale=v;resetJet()},v=>`${Number(v).toFixed(2)} d`);
  slider(sec,'LAYER SPACING',.84,1.08,.02,layerScale,v=>{layerScale=v;resetJet()},v=>`${Number(v).toFixed(2)} d`);
  status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';sec.appendChild(status);scenePage.appendChild(sec);
}
function sync(){
  for(const [k,b] of Object.entries(buttons))b.classList.toggle('active',k===active);
  if(!status)return;
  const d=Number(sim.params?.spacing)||.044;
  const cross=diskPoints(d).length;
  const room=Math.max(0,(sim.cap||sim.n)-sim.n);
  status.textContent=`ACTIVE ${active.toUpperCase()}\nfree-jet cross-section ${cross} particles · diameter ~${(radiusScale*2).toFixed(1)}d\nexit ${speed.toFixed(2)} m/s · axial layer ${layerScale.toFixed(2)}d · last physics ${(lastAdvance*1000).toFixed(1)} ms\nlayers ${layers.toLocaleString()} · faucet water added ${added.toLocaleString()} · last +${lastAdded}\nactive ${sim.n.toLocaleString()} / cap ${(sim.cap||sim.n).toLocaleString()} · reserve ${room.toLocaleString()}\nM8.2 div ×${Math.round(water.divIterations)} · XSPH ${water.xsph.toFixed(3)} · tension ${water.tension.toFixed(3)} · vorticity ${water.vorticity.toFixed(3)}`;
}
setInterval(sync,350);

window.__v5M850Faucet={online:true,backend:'native-append-free-jet-m850',choose,get active(){return active},get layers(){return layers},get added(){return added},get speed(){return speed}};
window.__fluidV5Version='8.5.0';window.__fluidV5Build='M8.5 NATIVE FAUCET FREE JET / CONTINUITY + GRAVITY / M8.2 COMMON WATER';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.5';document.title='Fluid V8 · M8.5 Faucet Free Jet';
setTimeout(()=>choose('faucet'),350);sync();
console.info('[Fluid V8 M8.5] native appendFluid faucet free jet online.');
