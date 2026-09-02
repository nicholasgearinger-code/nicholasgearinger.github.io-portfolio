// Fluid V8 M8.9.7 — motionless rest, visible pour start, and spout-to-glass stream guidance.
// The reservoir is a real PBF seed. During the short presentation hold the solver is not
// advanced at all; when it is released, the pitcher and water begin moving together.
import {sim,dev,glass,pitcher,scene,pitcherPoint,spoutPath,cam} from './v5-pitcher-fluid-physics-m872.js';

if(!sim?.dev||!dev||!glass||!pitcher||!scene)throw new Error('M8.9.7 rest-to-cup runtime unavailable');

const phase=new URL(import.meta.url).searchParams.has('post')?'post':'pre';
const q=new URLSearchParams(location.search);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

if(phase==='pre'){
  // Skip the old invisible three-second solver warmup. M8.9.7 supplies a genuine wall-clock
  // rest hold instead, then joins the motion curve once the pitcher angle is perceptible.
  window.__v5VesselMotionStartTime=clamp(Number(q.get('pourstart'))||3.42,3.18,3.75);
  window.__v5VesselFreezeSolver=true;

  const baseCreateShaderModule=dev.createShaderModule.bind(dev);
  dev.createShaderModule=function(desc){
    if(!desc||desc.label!=='m880MovingBoundaryWGSL'||typeof desc.code!=='string')return baseCreateShaderModule(desc);
    let code=desc.code;
    const anchor=`  let gc=vec2f(U.glass0.x,U.glass0.z);let base=U.glass2.x;let rim=U.glass1.w;
  let q0=p0.xz-gc;var q=p.xz-gc;let gr0=length(q0);var gr=length(q);`;
    const guided=`  let gc=vec2f(U.glass0.x,U.glass0.z);let base=U.glass2.x;let rim=U.glass1.w;

  // Once water has physically cleared the tilted spout, a narrow open corridor damps its
  // sideways scatter toward the glass opening. Vertical motion remains gravity-driven and
  // only particles already near the real lip-to-cup trajectory are affected.
  let ca=cos(U.pitch.w);let sa=sin(U.pitch.w);
  let lip=U.pitch.xyz+vec3f(ca*.250-sa*.182,sa*.250+ca*.182,0.0);
  if(U.pitch.w<-.78 && p.y<lip.y+pr*1.5 && p.y>rim-pr*1.4){
    let fall=clamp((lip.y-p.y)/max(lip.y-rim,.035),0.0,1.0);
    let center=mix(lip.xz,gc,fall);
    let drift=p.xz-center;let driftR=length(drift);
    let corridor=mix(.052,.082,fall);
    if(driftR<corridor){p.xz=mix(p.xz,center,mix(.08,.20,fall));}
  }

  let q0=p0.xz-gc;var q=p.xz-gc;let gr0=length(q0);var gr=length(q);`;
    if(!code.includes(anchor))throw new Error('M8.9.7 stream-guide shader anchor unavailable');
    code=code.replace(anchor,guided);
    return baseCreateShaderModule({...desc,code});
  };
}

if(phase==='post'){
  const restSeconds=clamp(Number(q.get('rest'))||1.55,.8,3.0);
  const baseStep=sim.step.bind(sim);
  let lastCycle=scene.cycles;
  let holdUntil=performance.now()+restSeconds*1000;
  let state='rest';

  function beginRest(reason){
    holdUntil=performance.now()+restSeconds*1000;state='rest';
    window.__v5VesselFreezeSolver=true;
    pitcher.angle=0;pitcher.prevAngle=0;pitcher.omega=0;scene.clock=0;
    try{window.__v5M895JugReservoir?.reseed?.(`M8.9.7 ${reason}`);}catch(err){console.error('[M8.9.7 rest seed]',err);}
  }

  sim.step=function(dt){
    if(scene.cycles!==lastCycle){lastCycle=scene.cycles;beginRest('restart');}
    if(performance.now()<holdUntil){
      window.__v5VesselFreezeSolver=true;
      pitcher.angle=0;pitcher.prevAngle=0;pitcher.omega=0;scene.clock=0;
      return baseStep(dt);
    }
    state='pour';window.__v5VesselFreezeSolver=false;
    return baseStep(dt);
  };

  // Make the vessels easier to read on a narrow phone without hiding the cup behind the HUD.
  if(cam){cam.target=[.465,.625,.370];cam.dist=Math.min(Number(cam.dist)||1.68,1.60);}
  setTimeout(()=>{if(cam){cam.target=[.465,.625,.370];cam.dist=Math.min(Number(cam.dist)||1.60,1.60);}},1050);

  const style=document.createElement('style');style.id='m897MobilePresentation';
  style.textContent=`
    #m880Hud{width:min(286px,calc(100vw - 24px))!important;padding:8px 9px!important;font-size:8px!important;background:rgba(5,20,27,.82)!important}
    #m880Status,#m892Material,#m892Shell,#m895ReservoirStatus,#m896ControlledPourStatus{display:none!important}
    #m897RestToCupStatus{margin-top:5px!important;padding-top:5px!important}
    @media (max-width:700px),(pointer:coarse){
      #m880Hud{left:max(12px,env(safe-area-inset-left))!important;right:auto!important;bottom:max(10px,env(safe-area-inset-bottom))!important;width:min(270px,calc(100vw - 24px))!important}
      .hud.card.perf{max-width:220px!important;min-width:0!important}
    }`;
  document.head.appendChild(style);

  const host=document.getElementById('m880Hud');
  let line=null;
  if(host){
    line=document.createElement('div');line.id='m897RestToCupStatus';
    line.style.cssText='color:#9ff0d2;border-top:1px solid rgba(112,225,235,.20)';
    host.appendChild(line);
  }

  const forceLabels=()=>{
    const h=document.querySelector('#m880Hud b');if(h&&h.textContent!=='M8.9.7 · REST → CUP')h.textContent='M8.9.7 · REST → CUP';
    const top=document.querySelector('.hud.card.title');if(top&&top.textContent!=='FLUID V8 · M8.9.7')top.textContent='FLUID V8 · M8.9.7';
    if(document.title!=='Fluid V8 · M8.9.7 Rest-to-Cup Pour')document.title='Fluid V8 · M8.9.7 Rest-to-Cup Pour';
  };
  const labels=new MutationObserver(forceLabels);labels.observe(document.documentElement,{subtree:true,childList:true,characterData:true});

  function sync(){
    forceLabels();if(!line)return;
    const remaining=Math.max(0,(holdUntil-performance.now())/1000);
    const lip=pitcherPoint(spoutPath.at(-1));
    const deg=-pitcher.angle*180/Math.PI;
    line.textContent=state==='rest'
      ?`WATER AT REST · POUR STARTS IN ${remaining.toFixed(1)} s`
      :`POURING INTO GLASS · ${deg.toFixed(0)}° · lip ${lip[0].toFixed(2)}, ${lip[1].toFixed(2)} m`;
  }
  sync();setInterval(sync,100);

  window.__v5M897RestToCup={
    online:true,backend:'solver-rest-lock-visible-motion-start-guided-open-stream',restSeconds,
    get state(){return state;},get remaining(){return Math.max(0,(holdUntil-performance.now())/1000);}
  };
}

window.__fluidV5Version='8.9.7';
window.__fluidV5Build='M8.9.7 MOTIONLESS REST / VISIBLE POUR START / SPOUT-TO-GLASS STREAM / COMPACT MOBILE HUD';
document.title='Fluid V8 · M8.9.7 Rest-to-Cup Pour';
console.info(`[Fluid V8 M8.9.7] ${phase}: motionless rest + directed open stream online.`);
