// Fluid V8 M8.9.6 — controlled GLB pitcher-to-cup pour.
// M8.9.5 proved that the real jug can drain, but its 84 degree outlet no longer lines up
// with the M8.8.8 receiving-glass position. This revision keeps ordinary PBF water and
// moving geometric boundaries while aligning the cup, slowing the useful pour, and making
// the open-rim capture robust enough to retain water that genuinely enters the cup.
import {sim,dev,glass,pitcher,scene,spoutPath,pitcherPoint,cam,ssfr} from './v5-pitcher-fluid-physics-m872.js';

if(!sim?.dev||!dev||!glass||!pitcher||!scene)throw new Error('M8.9.6 controlled-pour runtime unavailable');

const phase=new URL(import.meta.url).searchParams.has('post')?'post':'pre';
const q=new URLSearchParams(location.search);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
const radians=d=>d*Math.PI/180;

// At 84 degrees the analytic/GLB-aligned outlet is almost below the pitcher pivot. The old
// M8.8.8 cup at x=.942 m was aimed at a much shallower 60 degree pour. Put the opening under
// the full M8.9.5 trajectory: the 70 degree main stream lands near its center and the final
// 84 degree drain remains safely inside the same real opening.
const cupX=clamp(Number(q.get('cupx'))||.635,.58,.72);
glass.cx=cupX;
glass.innerBottom=clamp(Number(q.get('cupinnerbottom'))||.132,.118,.145);
glass.innerTop=clamp(Number(q.get('cupinnertop'))||.148,.138,.158);
glass.outerBottom=Math.max(glass.innerBottom+.018,Number(q.get('cupouterbottom'))||.154);
glass.outerTop=Math.max(glass.innerTop+.018,Number(q.get('cupoutertop'))||.170);

if(phase==='pre'){
  // Install after the GLB shell adapter but before M8.8 builds its boundary pipeline. This
  // replacement owns the complete receiving-cup block, so the older M8.8.8 string patch
  // simply becomes a no-op while its proven pitcher, solver and energy-guard code remain.
  const baseCreateShaderModule=dev.createShaderModule.bind(dev);
  dev.createShaderModule=function(desc){
    if(!desc||desc.label!=='m880MovingBoundaryWGSL'||typeof desc.code!=='string')return baseCreateShaderModule(desc);
    let code=desc.code;
    code=code.replace(
`  let inside0=p0.y>base-pr*1.4 && p0.y<rim+pr*.6 && gr0<gi0+pr*.35;`,
`  let inside0=p0.y>base-pr*1.4 && p0.y<rim+pr*3.0 && gr0<gi0+pr*.48;`);
    code=code.replace(
`    entered=length(crossXZ-gc)<U.glass1.x-pr*.35;`,
`    entered=length(crossXZ-gc)<U.glass1.x+pr*.06;`);
    code=code.replace(
`  if(inside0||entered){
    if(p.y<base+pr){p.y=base+pr;}
    if(p.y<rim){
      q=p.xz-gc;gr=length(q);let gi=max(.008,glassInner(p.y)-pr);
      if(gr>gi){let d=safe2(q);p.x=gc.x+d.x*gi;p.z=gc.y+d.y*gi;}
    }
    // Above the rim there is deliberately no constraint, so genuine splash-out remains possible.
  }else{`,
`  if(inside0||entered){
    if(p.y<base+pr){p.y=base+pr;}
    // A short, open capture throat follows the physical inner wall above the rim. Centered
    // splash can rise naturally; only near-wall particles are guided below the lip instead
    // of being projected across it. Nothing outside the opening is teleported into the cup.
    if(p.y<rim+pr*3.0){
      q=p.xz-gc;gr=length(q);
      let gy=clamp(p.y,base,rim);
      let gi=max(.008,glassInner(gy)-pr*.88);
      let throat=max(.010,U.glass1.x-pr*.30);
      let cap=select(gi,throat,p.y>=rim);
      if(gr>cap){let d=safe2(q);p.x=gc.x+d.x*cap;p.z=gc.y+d.y*cap;gr=cap;}
      if(p.y>rim-pr*.12 && gr>cap*.70){p.y=min(p.y,rim-pr*.05);}
    }
  }else{`);
    if(code.includes('p0.y<rim+pr*.6 && gr0<gi0+pr*.35'))throw new Error('M8.9.6 cup capture patch did not apply');
    return baseCreateShaderModule({...desc,code});
  };
}

if(phase==='post'){
  const mainDeg=clamp(Number(q.get('pourmain'))||70,64,76);
  const drainDeg=clamp(Number(q.get('pourdrain'))||84,78,88);
  const mainAngle=-radians(mainDeg),drainAngle=-radians(drainDeg);

  // M8.8's motion function reads pitcher.maxAngle every solver substep. A controlled getter
  // gives it a 70 degree low-energy main pour, followed by a slow final tip to 84 degrees so
  // the real GLB reservoir drains without launching the stream past the cup.
  Object.defineProperty(pitcher,'maxAngle',{
    configurable:true,
    get(){
      const t=Number(scene.clock)||0;
      if(t<=6.75)return mainAngle;
      return mainAngle+(drainAngle-mainAngle)*smooth((t-6.75)/2.10);
    },
    set(){}
  });

  function tuneWater(){
    if(sim.params){
      sim.params.substeps=4;
      sim.params.iterations=6;
      sim.params.xsphC=.058;
      sim.params.sCorrK=.072;
      sim.params.surfaceTensionK=.0058;
    }
    if(ssfr){
      ssfr.splatRadius=1.30;
      ssfr.thicknessRadius=1.32;
      ssfr.bindCache=null;
    }
  }
  tuneWater();
  const baseStep=sim.step.bind(sim);
  sim.step=function(dt){const result=baseStep(dt);tuneWater();return result;};

  // Keep both vessels centered in the review camera after the cup moves inward.
  if(cam){cam.target=[.475,.645,.370];cam.dist=Math.min(Number(cam.dist)||1.72,1.68);}
  setTimeout(()=>{if(cam){cam.target=[.475,.645,.370];cam.dist=Math.min(Number(cam.dist)||1.68,1.68);}},1050);

  const host=document.getElementById('m880Hud');
  let line=null;
  if(host){
    line=document.createElement('div');line.id='m896ControlledPourStatus';
    line.style.cssText='margin-top:6px;padding-top:6px;border-top:1px solid rgba(112,225,235,.20);color:#9ff0d2';
    host.appendChild(line);
  }
  function sync(){
    const h=document.querySelector('#m880Hud b');if(h)h.textContent='M8.9.6 · CONTROLLED CUP POUR';
    const top=document.querySelector('.hud.card.title');if(top)top.textContent='FLUID V8 · M8.9.6';
    if(!line)return;
    const lip=pitcherPoint(spoutPath.at(-1));
    const deg=-pitcher.angle*180/Math.PI;
    const stage=scene.clock<5.7?'gentle turn':scene.clock<6.75?'centered main pour':scene.clock<9.2?'final reservoir drain':scene.clock<11.4?'slow return':'complete';
    line.textContent=`${stage} · pitcher ${deg.toFixed(0)}° · cup x ${glass.cx.toFixed(3)} m · opening ${(glass.innerTop*2*100).toFixed(0)} cm · lip ${lip[0].toFixed(3)}, ${lip[1].toFixed(3)} m`;
  }
  sync();setInterval(sync,250);

  window.__v5M896ControlledPour={
    online:true,backend:'two-stage-glb-gravity-pour-open-cup-capture',
    cupX:glass.cx,mainDeg,drainDeg,capture:'true-crossing-near-rim-guidance',
    get stage(){return scene.clock<5.7?'turn':scene.clock<6.75?'main':scene.clock<9.2?'drain':scene.clock<11.4?'return':'complete';}
  };
}

window.__fluidV5Version='8.9.6';
window.__fluidV5Build='M8.9.6 CONTROLLED GLB POUR / ALIGNED CUP / TWO-STAGE TILT / LOW-SPILL OPEN-RIM CAPTURE';
document.title='Fluid V8 · M8.9.6 Controlled Pitcher Pour';
console.info(`[Fluid V8 M8.9.6] ${phase}: aligned cup + two-stage low-spill GLB pour online.`);
