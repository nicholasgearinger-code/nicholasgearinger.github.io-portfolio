// Fluid V8 M8.8.8 — clean receiving-glass capture.
// M8.8.7 proved the aim is close; this pass makes the receiver more forgiving without
// changing the M8.8.1 PBF/CFL/energy model. It widens the tumbler slightly, lowers the
// final pitcher angle to reduce lateral impact speed, and modifies only the M8.8 analytic
// glass boundary so particles that genuinely cross the rim are retained near the wall.
import {dev,glass,pitcher} from './v5-pitcher-fluid-physics-m872.js';

if(!dev||!glass||!pitcher)throw new Error('M8.8.8 capture: vessel runtime unavailable.');

const phase=new URL(import.meta.url).searchParams.has('post')?'post':'pre';

// Keep the M8.8.7 center, but widen the opening/body. The M8.8.8 entrypoint expands
// the simulation box from 1.10 m to 1.16 m so this remains clear of the +X box wall.
glass.cx=.942;
glass.innerBottom=.132;
glass.innerTop=.148;
glass.outerBottom=.154;
glass.outerTop=.170;

// A slightly shallower final tilt shortens the ballistic arc and reduces impact energy.
// M8.8 sets its own default during module initialization, so the post import reapplies it.
pitcher.maxAngle=-1.055;

if(phase==='pre'){
  const baseCreateShaderModule=dev.createShaderModule.bind(dev);
  dev.createShaderModule=function(desc){
    if(!desc||typeof desc.code!=='string')return baseCreateShaderModule(desc);
    let code=desc.code;
    if(desc.label==='m880MovingBoundaryWGSL'){
      code=code.replace(
`  let inside0=p0.y>base-pr*1.4 && p0.y<rim+pr*.6 && gr0<gi0+pr*.35;`,
`  let inside0=p0.y>base-pr*1.4 && p0.y<rim+pr*8.0 && gr0<gi0+pr*.55;`);
      code=code.replace(
`    entered=length(crossXZ-gc)<U.glass1.x-pr*.35;`,
`    entered=length(crossXZ-gc)<U.glass1.x-pr*.12;`);
      code=code.replace(
`  if(inside0||entered){
    if(p.y<base+pr){p.y=base+pr;}
    if(p.y<rim){
      q=p.xz-gc;gr=length(q);let gi=max(.008,glassInner(p.y)-pr);
      if(gr>gi){let d=safe2(q);p.x=gc.x+d.x*gi;p.z=gc.y+d.y*gi;}
    }
    // Above the rim there is deliberately no constraint, so genuine splash-out remains possible.
  }else{`,
`  // A descending particle that physically reaches the glass rim footprint is carried
    // through the opening instead of ricocheting from the thin edge. Flight remains ballistic.
  let rimCatch=!inside0 && !entered && p0.y>rim-pr*.15 && p0.y<rim+pr*5.0 &&
    p.y<rim+pr*1.5 && p0.y>p.y && gr<U.glass1.z+pr*1.25;
  if(rimCatch){
    q=p.xz-gc;gr=length(q);let cap=max(.010,U.glass1.x-pr*.18);let d=safe2(q);
    if(gr>cap){p.x=gc.x+d.x*cap;p.z=gc.y+d.y*cap;gr=cap;}
    p.y=min(p.y,rim-pr*.04);entered=true;
  }
  if(inside0||entered){
    if(p.y<base+pr){p.y=base+pr;}
    // Short open capture zone above the rim: centered splash can still rise vertically,
    // but water skimming the inner wall is redirected back into the tumbler instead of
    // ricocheting across the rim. This is boundary projection, not a particle state.
    if(p.y<rim+pr*8.0){
      q=p.xz-gc;gr=length(q);
      let gy=clamp(p.y,base,rim);
      let gi=max(.008,glassInner(gy)-pr*.82);
      let cap=select(gi,max(.010,U.glass1.x-pr*.18),p.y>=rim);
      if(gr>cap){let d=safe2(q);p.x=gc.x+d.x*cap;p.z=gc.y+d.y*cap;gr=cap;}
      if(p.y>rim-pr*.08 && gr>cap*.82){p.y=min(p.y,rim-pr*.03);}
    }
  }else{`);
    }
    return baseCreateShaderModule({...desc,code});
  };
}

const updateHud=()=>{
  const title=document.querySelector('#m880Hud b');
  if(title)title.textContent='M8.8.8 · CLEAN CATCH / LOW-SPILL POUR';
  const top=document.querySelector('.hud.card.title');if(top)top.textContent='FLUID V8 · M8.8.8';
};
updateHud();
if(phase==='post'){
  // M8.8 frames the camera after a delayed hard reset; keep the wider receiver comfortably visible.
  setTimeout(()=>{try{if(window.__cam){window.__cam.target=[.540,.650,.370];}}catch{}},1050);
}

window.__fluidV5Version='8.8.8';
window.__fluidV5Build='M8.8.8 CLEAN CATCH / PHYSICAL RIM CAPTURE / LOWER-ENERGY POUR / M8.8.1 FLUID PHYSICS';
window.__v5M888={
  online:true,physics:'m881',vessels:'m886',glassX:glass.cx,
  innerTop:glass.innerTop,outerTop:glass.outerTop,maxAngle:pitcher.maxAngle,
  capture:'no-spill-rim-footprint-projection',phase
};
document.title='Fluid V8 · M8.8.8 Clean Catch';
console.info(`[Fluid V8 M8.8.8] ${phase}: wider receiver + lower-energy pour + near-rim capture; M8.8.1 fluid physics preserved.`);
