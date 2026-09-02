// Fluid V8 M8.9.9 — proven analytic containment with the high-poly GLB as visual skin only.
// This deliberately restores M8.8.8's matching seed/boundary pair. No radius, water seed,
// or collision decision is derived from the decorative mesh.
import {sim,glass,pitcher,scene,pitcherPoint,spoutPath,cam} from './v5-pitcher-fluid-physics-m872.js';

if(!sim?.dev||!glass||!pitcher||!scene)throw new Error('M8.9.9 proven-pour runtime unavailable');
const phase=new URL(import.meta.url).searchParams.has('post')?'post':'pre';

if(phase==='pre'){
  // Begin at the exact upright start of the old motion curve. PBF and vessel collision
  // keep running while only the pitcher motion clock is held, matching the proven warm-up.
  window.__v5VesselMotionStartTime=3.0;
  window.__v5VesselHoldMotion=true;
  window.__v5VesselFreezeSolver=false;
}

if(phase==='post'){
  const baseStep=sim.step.bind(sim),api=window.__v5M880MovingBoundary;
  let state='rest',lastCycle=scene.cycles,button=document.getElementById('m880Again');

  // Restore the exact proven M8.8.8 receiver and low-energy tilt.
  pitcher.maxAngle=-1.055;
  glass.cx=.942;glass.innerBottom=.132;glass.innerTop=.148;glass.outerBottom=.154;glass.outerTop=.170;

  function setButton(){if(!button)button=document.getElementById('m880Again');if(button)button.textContent=state==='rest'?'POUR':'RESET';}
  function hold(){
    state='rest';window.__v5VesselHoldMotion=true;window.__v5VesselFreezeSolver=false;
    pitcher.angle=0;pitcher.prevAngle=0;pitcher.omega=0;scene.clock=3;setButton();
  }
  function pour(){state='pour';window.__v5VesselHoldMotion=false;window.__v5VesselFreezeSolver=false;setButton();}

  sim.step=function(dt){
    if(scene.cycles!==lastCycle){lastCycle=scene.cycles;hold();}
    window.__v5VesselHoldMotion=state!=='pour';
    window.__v5VesselFreezeSolver=false;
    const result=baseStep(dt);
    if(state==='pour'&&scene.clock>=11.40){state='complete';window.__v5VesselHoldMotion=true;setButton();}
    return result;
  };

  if(button)button.onclick=e=>{
    e.preventDefault();e.stopPropagation();
    if(state==='rest')pour();
    else{api?.restart?.();lastCycle=scene.cycles;hold();}
  };

  if(cam){cam.target=[.540,.650,.370];cam.dist=Math.min(Number(cam.dist)||1.72,1.68);}
  setTimeout(()=>{if(cam){cam.target=[.540,.650,.370];cam.dist=Math.min(Number(cam.dist)||1.68,1.68);}},1050);

  const style=document.createElement('style');style.id='m899ProvenPourPresentation';style.textContent=`
    #heartbeat{display:none!important}
    #m880Hud{width:min(292px,calc(100vw - 24px))!important;padding:8px 9px!important;font-size:8px!important;background:rgba(5,20,27,.84)!important}
    #m880Status,#m881GuardStatus,#m888Status,#m890Status{display:none!important}
    #m899ProvenPourStatus{margin-top:5px!important;padding-top:5px!important}
    @media (max-width:700px),(pointer:coarse){#m880Hud{left:max(12px,env(safe-area-inset-left))!important;right:auto!important;bottom:max(10px,env(safe-area-inset-bottom))!important;width:min(274px,calc(100vw - 24px))!important}.hud.card.perf{max-width:220px!important;min-width:0!important}}`;
  document.head.appendChild(style);

  const host=document.getElementById('m880Hud');let line=null;
  if(host){line=document.createElement('div');line.id='m899ProvenPourStatus';line.style.cssText='color:#9ff0d2;border-top:1px solid rgba(112,225,235,.20)';host.appendChild(line);}

  const forceLabels=()=>{
    const h=document.querySelector('#m880Hud b');if(h&&h.textContent!=='M8.9.9 · PROVEN CONTAINMENT')h.textContent='M8.9.9 · PROVEN CONTAINMENT';
    const top=document.querySelector('.hud.card.title');if(top&&top.textContent!=='FLUID V8 · M8.9.9')top.textContent='FLUID V8 · M8.9.9';
    if(document.title!=='Fluid V8 · M8.9.9 Proven Containment')document.title='Fluid V8 · M8.9.9 Proven Containment';
  };
  const labels=new MutationObserver(forceLabels);labels.observe(document.documentElement,{subtree:true,childList:true,characterData:true});

  function sync(){
    forceLabels();setButton();if(!line)return;
    if(state==='rest')line.textContent=`WATER LOCKED IN PROVEN PITCHER · ${sim.n.toLocaleString()} PBF · TAP POUR`;
    else if(state==='complete')line.textContent='POUR COMPLETE · PHYSICS FROZEN FOR INSPECTION';
    else{
      const lip=pitcherPoint(spoutPath.at(-1)),deg=-pitcher.angle*180/Math.PI;
      const stage=scene.clock<5.7?'TIPPING':scene.clock<9.2?'GRAVITY POUR':scene.clock<11.4?'RETURNING':'COMPLETE';
      line.textContent=`${stage} · ${deg.toFixed(0)}° · ANALYTIC WALL + GLB SKIN · lip ${lip[0].toFixed(2)}, ${lip[1].toFixed(2)}`;
    }
  }
  hold();sync();setInterval(sync,120);

  window.__v5M899ProvenPour={online:true,physics:'m888-analytic-warm',visual:'m890-glb-only',start:pour,reset:()=>{api?.restart?.();hold();},get state(){return state;}};
}

window.__fluidV5Version='8.9.9';
window.__fluidV5Build='M8.9.9 PROVEN M8.8.8 WARM PBF CONTAINMENT / FORWARD GLB VISUAL / MANUAL MOTION RELEASE';
document.title='Fluid V8 · M8.9.9 Proven Containment';
console.info(`[Fluid V8 M8.9.9] ${phase}: proven analytic water containment + GLB visual skin online.`);
