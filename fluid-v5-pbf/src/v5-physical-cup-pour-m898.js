// Fluid V8 M8.9.8 — user-triggered, physics-only pitcher-to-cup pour.
// Water remains an untouched hydrostatic PBF reservoir until POUR is pressed. From that
// point onward, gravity, momentum, density constraints, and vessel collisions own its path.
import {sim,glass,pitcher,scene,pitcherPoint,spoutPath,cam} from './v5-pitcher-fluid-physics-m872.js';

if(!sim?.dev||!glass||!pitcher||!scene)throw new Error('M8.9.8 physical-pour runtime unavailable');

const phase=new URL(import.meta.url).searchParams.has('post')?'post':'pre';
const q=new URLSearchParams(location.search);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

if(phase==='pre'){
  // M8.8 normally spends three simulated seconds settling while the pitcher is visibly
  // upright. Start at the first perceptible part of its motion curve, but keep the solver
  // frozen until the user explicitly begins the pour.
  window.__v5VesselMotionStartTime=clamp(Number(q.get('pourstart'))||3.42,3.18,3.75);
  window.__v5VesselFreezeSolver=true;
}

if(phase==='post'){
  const baseStep=sim.step.bind(sim);
  const api=window.__v5M880MovingBoundary;
  let state='rest';
  let lastCycle=scene.cycles;
  let button=null;

  function setButton(){
    if(!button)button=document.getElementById('m880Again');
    if(button)button.textContent=state==='rest'?'POUR':'RESET';
  }

  function holdReservoir(reason='rest'){
    state='rest';window.__v5VesselFreezeSolver=true;
    pitcher.angle=0;pitcher.prevAngle=0;pitcher.omega=0;scene.clock=0;
    try{window.__v5M895JugReservoir?.reseed?.(`M8.9.8 ${reason}`);}catch(err){console.error('[M8.9.8 reservoir]',err);}
    setButton();
  }

  function startPour(){
    state='pour';window.__v5VesselFreezeSolver=false;setButton();
  }

  sim.step=function(dt){
    if(scene.cycles!==lastCycle){lastCycle=scene.cycles;holdReservoir('restart');}
    if(state!=='pour'){
      window.__v5VesselFreezeSolver=true;
      pitcher.angle=0;pitcher.prevAngle=0;pitcher.omega=0;
      return baseStep(dt);
    }
    window.__v5VesselFreezeSolver=false;
    const result=baseStep(dt);
    if(scene.clock>=11.40){state='complete';window.__v5VesselFreezeSolver=true;setButton();}
    return result;
  };

  if(cam){cam.target=[.465,.625,.370];cam.dist=Math.min(Number(cam.dist)||1.68,1.60);}
  setTimeout(()=>{if(cam){cam.target=[.465,.625,.370];cam.dist=Math.min(Number(cam.dist)||1.60,1.60);}},1050);

  const style=document.createElement('style');style.id='m898PhysicalPourPresentation';
  style.textContent=`
    #heartbeat{display:none!important}
    #m880Hud{width:min(286px,calc(100vw - 24px))!important;padding:8px 9px!important;font-size:8px!important;background:rgba(5,20,27,.82)!important}
    #m880Status,#m881GuardStatus,#m892Material,#m892Shell,#m895ReservoirStatus,#m896ControlledPourStatus{display:none!important}
    #m898PhysicalPourStatus{margin-top:5px!important;padding-top:5px!important}
    @media (max-width:700px),(pointer:coarse){
      #m880Hud{left:max(12px,env(safe-area-inset-left))!important;right:auto!important;bottom:max(10px,env(safe-area-inset-bottom))!important;width:min(270px,calc(100vw - 24px))!important}
      .hud.card.perf{max-width:220px!important;min-width:0!important}
    }`;
  document.head.appendChild(style);

  const host=document.getElementById('m880Hud');
  let line=null;
  if(host){
    line=document.createElement('div');line.id='m898PhysicalPourStatus';
    line.style.cssText='color:#9ff0d2;border-top:1px solid rgba(112,225,235,.20)';
    host.appendChild(line);
  }

  button=document.getElementById('m880Again');
  if(button)button.onclick=e=>{
    e.preventDefault();e.stopPropagation();
    if(state==='rest')startPour();
    else{
      try{api?.restart?.();}catch(err){console.error('[M8.9.8 reset]',err);}
      lastCycle=scene.cycles;holdReservoir('manual reset');
    }
  };

  const forceLabels=()=>{
    const h=document.querySelector('#m880Hud b');if(h&&h.textContent!=='M8.9.8 · PHYSICS POUR')h.textContent='M8.9.8 · PHYSICS POUR';
    const top=document.querySelector('.hud.card.title');if(top&&top.textContent!=='FLUID V8 · M8.9.8')top.textContent='FLUID V8 · M8.9.8';
    if(document.title!=='Fluid V8 · M8.9.8 Physics-Only Cup Pour')document.title='Fluid V8 · M8.9.8 Physics-Only Cup Pour';
  };
  const labels=new MutationObserver(forceLabels);labels.observe(document.documentElement,{subtree:true,childList:true,characterData:true});

  function sync(){
    forceLabels();setButton();if(!line)return;
    if(state==='rest')line.textContent=`WATER AT REST IN PITCHER · ${sim.n.toLocaleString()} PBF · TAP POUR`;
    else if(state==='complete')line.textContent='POUR COMPLETE · PHYSICS FROZEN FOR INSPECTION';
    else{
      const lip=pitcherPoint(spoutPath.at(-1));
      const deg=-pitcher.angle*180/Math.PI;
      const stage=scene.clock<5.7?'TIPPING':scene.clock<9.2?'GRAVITY POUR':scene.clock<11.4?'RETURNING':'COMPLETE';
      line.textContent=`${stage} · ${deg.toFixed(0)}° · lip ${lip[0].toFixed(2)}, ${lip[1].toFixed(2)} m`;
    }
  }

  holdReservoir('module load');sync();setInterval(sync,120);

  window.__v5M898PhysicalPour={
    online:true,backend:'manual-release-hydrostatic-pbf-gravity-vessel-collisions',
    start:startPour,reset:()=>{api?.restart?.();holdReservoir('api reset');},
    get state(){return state;}
  };
}

window.__fluidV5Version='8.9.8';
window.__fluidV5Build='M8.9.8 INDEFINITE HYDROSTATIC REST / USER RELEASE / PHYSICS-ONLY TRAJECTORY / OPEN CUP';
document.title='Fluid V8 · M8.9.8 Physics-Only Cup Pour';
console.info(`[Fluid V8 M8.9.8] ${phase}: indefinite rest + physics-only cup pour online.`);
