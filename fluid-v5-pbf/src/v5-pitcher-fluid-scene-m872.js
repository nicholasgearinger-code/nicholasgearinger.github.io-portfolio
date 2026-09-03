// Fluid V8 M8.7.2 — scene orchestration for the true vessel-to-vessel pour.
import {sim,ui,cam,faucet,dev,glass,pitcher,scene,spoutPath,pitcherPoint,stageAt,advanceMotion,seedPitcher,encodeCollider} from './v5-pitcher-fluid-physics-m872.js';
import {encodeVisual} from './v5-pitcher-vessels-m872.js';

// Append moving-container collision after PBF and transparent vessels after SSFR, while retaining
// the proven M7.3.9 shared compute+render command-buffer path and M8.6.1 wrapper beneath us.
let inStep=false,expectRender=false;const baseCreate=dev.createCommandEncoder.bind(dev),baseStep=sim.step.bind(sim);
dev.createCommandEncoder=function(desc){
  const phase=inStep?'sim':(expectRender?'render':'other');if(phase==='render')expectRender=false;const enc=baseCreate(desc);let appended=false;if(phase==='other')return enc;
  // Pre-solve correction moves the old particle state with the new pitcher pose before the
  // normal predict/grid build. The finish hook repeats containment after PBF before rendering.
  if(phase==='sim'){try{encodeCollider(enc)}catch(err){console.error('[M8.7.2 pre-solve]',err);}}
  return new Proxy(enc,{get(target,prop){
    if(prop==='finish')return(...args)=>{if(!appended){appended=true;try{if(phase==='sim')encodeCollider(target);else encodeVisual(target);}catch(err){console.error(`[M8.7.2 ${phase}]`,err);}}return target.finish(...args);};
    const value=Reflect.get(target,prop,target);return typeof value==='function'?value.bind(target):value;
  }});
};
sim.step=function(dt){if(scene.started&&!ui.paused)advanceMotion(dt);inStep=true;try{return baseStep(dt)}finally{inStep=false;expectRender=true;}};

function frameCamera(){cam.az=-.57;cam.el=.25;cam.dist=1.72;cam.target=[.515,.650,.370];}
function hardReset(){
  scene.started=false;scene.clock=0;scene.collisionPasses=0;scene.renderPasses=0;scene.lastDt=1/60;pitcher.angle=0;pitcher.prevAngle=0;pitcher.omega=0;
  ui.pouring=false;ui.pourLeft=0;ui.paused=false;sim.timeBank=0;sim.simTime=0;seedPitcher();frameCamera();scene.cycles++;scene.started=true;sync();
}
function startScene(){try{faucet.choose('pool')}catch(err){console.warn('[M8.7.2 faucet disable]',err)}requestAnimationFrame(()=>requestAnimationFrame(()=>hardReset()));}

document.getElementById('m861Dock')?.style.setProperty('display','none','important');document.getElementById('m872Hud')?.remove();
const hud=document.createElement('div');hud.id='m872Hud';hud.style.cssText='position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));z-index:40;width:min(320px,calc(100vw - 24px));padding:10px;border:1px solid rgba(112,225,235,.42);border-radius:13px;background:rgba(5,20,27,.88);backdrop-filter:blur(9px);font:9px/1.45 ui-monospace;color:#bfeaf0;pointer-events:auto';
hud.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><b style="color:#86f6ff;letter-spacing:.10em">M8.7.2 · VESSEL FLUID</b><button id="m872Again" style="border:1px solid rgba(241,173,67,.65);border-radius:9px;background:#201708;color:#ffd890;padding:7px 9px;font:800 8px ui-monospace">POUR AGAIN</button></div><div id="m872Status" style="margin-top:7px;white-space:pre-line"></div>';
document.body.appendChild(hud);hud.addEventListener('pointerdown',e=>e.stopPropagation());hud.addEventListener('click',e=>e.stopPropagation());document.getElementById('m872Again').onclick=e=>{e.preventDefault();hardReset()};
const status=document.getElementById('m872Status');
function sync(){if(!status)return;const deg=-pitcher.angle*180/Math.PI,lip=pitcherPoint(spoutPath.at(-1));status.textContent=`${stageAt(scene.clock)} · ${scene.clock.toFixed(1)} s\npitcher ${deg.toFixed(0)}° · wall ω ${Math.abs(pitcher.omega).toFixed(2)} rad/s\nreal PBF water ${sim.n.toLocaleString()} · seeded inside pitcher ${scene.seeded.toLocaleString()}\nspout lip ${lip[0].toFixed(2)}, ${lip[1].toFixed(2)} m · glass open rim ${glass.rim.toFixed(2)} m\ncontainer passes ${scene.collisionPasses.toLocaleString()} · vessel renders ${scene.renderPasses.toLocaleString()} · added submits 0`;}
setInterval(sync,350);setTimeout(startScene,520);setTimeout(()=>{document.getElementById('m861Dock')?.style.setProperty('display','none','important');frameCamera();},950);

window.__v5M872Scene={online:true,backend:'true-pbf-pitcher-moving-wall-open-spout-glass-m872',gpuSubmitsAdded:0,restart:hardReset,get angle(){return pitcher.angle},get clock(){return scene.clock},get seeded(){return scene.seeded},get collisionPasses(){return scene.collisionPasses},glass:{...glass},pitcher:{cx:pitcher.cx,cy:pitcher.cy,cz:pitcher.cz,maxAngle:pitcher.maxAngle}};
window.__fluidV5Version='8.7.2';window.__fluidV5Build='M8.7.2 TRUE PITCHER FLUID / MOVING WALLS / OPEN SPOUT / RECEIVING GLASS / M8.6.7 WATER';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.7.2';document.title='Fluid V8 · M8.7.2 True Vessel Pour';
console.info('[Fluid V8 M8.7.2] true pitcher-contained PBF + animated moving vessel + open tumbler online; added submits 0.');
