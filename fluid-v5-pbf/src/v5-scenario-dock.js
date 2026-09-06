// Fluid Simulation Lab M9.0 — shared scenario navigation for the common-water lab
// and the isolated, validated M8.9.9 GLB gravity pour. This module adds DOM controls
// only: no GPU pipelines, command encoders, simulation forces, or queue submissions.

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const query=new URLSearchParams(location.search);
const valid=new Set(['pool','wave','rain','dam','drain','faucet','waterfall','paddle','whirlpool','fountain','pour']);
let active=valid.has(query.get('scenario'))?query.get('scenario'):'pool';

for(let i=0;i<160&&!window.__v5M830Scenes&&!window.__v5M899ProvenPour;i++)await sleep(50);

const scenarios=[
  ['pool','POOL','Calm basin · tap and drag'],
  ['wave','WAVE TANK','Physical wavemaker'],
  ['dam','DAM BREAK','Resting column release'],
  ['rain','RAIN','Distributed water impacts'],
  ['faucet','FAUCET','Connected inlet stream'],
  ['waterfall','WATERFALL','Gravity-fed falling sheet'],
  ['paddle','PADDLE','Driven surface waves'],
  ['whirlpool','WHIRLPOOL','Circular Rankine vortex'],
  ['fountain','FOUNTAIN','Mass-conserving jet'],
  ['drain','DRAIN','Volume-removing sink'],
  ['pour','GLB POUR','Measured jug · world gravity'],
];
const descriptions={
  pool:'Calm PBF pool. Tap the water for an impulse or drag across it to stir the live surface.',
  wave:'A physical wavemaker drives the pool. Open Settings → Scenes for wave type, height, frequency and boundary controls.',
  dam:'All water begins at rest in a compact column, then collapses and spreads under gravity.',
  rain:'Coherent falling water packets strike the pool and create live surface motion.',
  faucet:'A continuous inlet recycles existing water into a connected tap stream.',
  waterfall:'A broad gravity-fed flow falls into the receiving pool.',
  paddle:'A periodic physical drive pushes the water and builds travelling waves.',
  whirlpool:'A circular Rankine velocity profile creates a pressure-driven surface depression.',
  fountain:'A recirculating nozzle lifts existing pool water without adding mass.',
  drain:'A central sink removes volume while the surrounding water flows toward the intake.',
  pour:'Water starts at rest inside the measured GLB jug, then pours into the glass under world gravity only.',
};

// Each common-water scene gets a close, centered portrait-safe camera. GLB Pour
// keeps its separately calibrated vessel camera and is never touched here.
const cameraPresets={
  pool:{az:-.72,el:.43,dist:3.05,y:.66},
  wave:{az:-.92,el:.35,dist:3.02,y:.70},
  dam:{az:-.78,el:.40,dist:2.95,y:.69},
  rain:{az:-.70,el:.34,dist:3.18,y:.93},
  faucet:{az:-.66,el:.35,dist:3.12,y:.91},
  waterfall:{az:-.78,el:.34,dist:3.16,y:.88},
  paddle:{az:-.91,el:.37,dist:3.02,y:.70},
  whirlpool:{az:-.72,el:.62,dist:2.92,y:.64},
  fountain:{az:-.70,el:.38,dist:3.10,y:.85},
  drain:{az:-.72,el:.58,dist:2.92,y:.62},
};
let cameraMotion=0;
function frameCamera(name,immediate=false){
  const cam=window.__cam,preset=cameraPresets[name];if(!cam||!preset||name==='pour')return;
  const box=window.__sim?.params?.box||[1.9,2.5,1.25];
  const goal={az:preset.az,el:preset.el,dist:Math.max(preset.dist,box[0]*1.52),target:[box[0]*.5,preset.y,box[2]*.5]};
  const token=++cameraMotion;
  if(immediate){cam.az=goal.az;cam.el=goal.el;cam.dist=goal.dist;cam.target=[...goal.target];return;}
  const from={az:Number(cam.az)||goal.az,el:Number(cam.el)||goal.el,dist:Number(cam.dist)||goal.dist,target:[...(cam.target||goal.target)]};
  const started=performance.now(),duration=420;
  const tick=now=>{
    if(token!==cameraMotion)return;
    const u=Math.min(1,(now-started)/duration),t=1-Math.pow(1-u,3);
    cam.az=from.az+(goal.az-from.az)*t;cam.el=from.el+(goal.el-from.el)*t;cam.dist=from.dist+(goal.dist-from.dist)*t;
    cam.target=goal.target.map((value,i)=>(from.target[i]??value)+(value-(from.target[i]??value))*t);
    if(u<1)requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

document.getElementById('fluidScenarioStyle')?.remove();
const style=document.createElement('style');style.id='fluidScenarioStyle';style.textContent=`
#fluidScenarioDock{position:fixed;z-index:240;left:50%;bottom:max(12px,env(safe-area-inset-bottom));width:min(760px,calc(100vw - 24px));transform:translateX(-50%);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#dffcff;pointer-events:none}
#heartbeat{display:none!important}#m880Hud{bottom:max(82px,calc(env(safe-area-inset-bottom) + 70px))!important}
.fsdBar,.fsdDrawer{pointer-events:auto;background:linear-gradient(135deg,rgba(5,22,29,.96),rgba(5,18,30,.94));border:1px solid rgba(84,218,222,.48);box-shadow:0 14px 46px rgba(0,0,0,.38),inset 0 1px rgba(255,255,255,.035);backdrop-filter:blur(15px);-webkit-backdrop-filter:blur(15px)}
.fsdBar{min-height:56px;border-radius:17px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 9px 8px 15px}.fsdEyebrow{font:800 8px/1.2 ui-monospace;letter-spacing:.14em;color:#76edf7}.fsdActive{font:900 13px/1.25 ui-monospace;letter-spacing:.08em;color:#e7fdff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fsdToggle{appearance:none;border:1px solid rgba(91,229,238,.52);background:rgba(9,38,48,.88);color:#dffcff;border-radius:12px;min-height:39px;padding:0 13px;font:900 9px ui-monospace;letter-spacing:.08em}.fsdToggle[aria-expanded="true"]{border-color:#efad42;color:#ffd58a;background:rgba(74,51,15,.64)}
.fsdDrawer{position:absolute;left:0;right:0;bottom:66px;border-radius:18px;padding:14px;opacity:0;transform:translateY(12px) scale(.985);transform-origin:bottom center;pointer-events:none;transition:opacity .2s ease,transform .25s cubic-bezier(.2,.8,.2,1)}#fluidScenarioDock.open .fsdDrawer{opacity:1;transform:none;pointer-events:auto}.fsdHead{display:flex;gap:12px;justify-content:space-between;align-items:flex-start;margin-bottom:11px}.fsdTitle{font:900 12px/1.2 ui-monospace;letter-spacing:.13em;color:#86f6ff}.fsdHelp{font:8px/1.45 ui-monospace;color:#8eafb9;max-width:520px;margin-top:5px}.fsdClose{appearance:none;border:1px solid rgba(91,229,238,.32);background:#071820;color:#dffcff;border-radius:50%;width:34px;height:34px;font:900 17px ui-monospace;flex:0 0 auto}.fsdScenes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;max-height:238px;overflow:auto;-webkit-overflow-scrolling:touch}.fsdScene{appearance:none;min-height:58px;text-align:left;border:1px solid rgba(84,218,222,.25);background:rgba(5,25,34,.78);color:#dffcff;border-radius:11px;padding:9px;font-family:inherit}.fsdScene b{display:block;font:900 9px/1.2 ui-monospace;letter-spacing:.05em}.fsdScene small{display:block;font:7px/1.35 ui-monospace;color:#789aa7;margin-top:5px}.fsdScene.active{border-color:#f1ad43;background:linear-gradient(135deg,rgba(82,57,17,.68),rgba(21,43,47,.82));box-shadow:inset 0 0 18px rgba(241,173,67,.08)}.fsdScene.active b{color:#ffd890}.fsdActions{display:flex;gap:7px;margin-top:10px}.fsdAction{appearance:none;flex:1;min-height:38px;border:1px solid rgba(84,218,222,.28);background:#071820;color:#ccebf0;border-radius:10px;font:900 8px ui-monospace;letter-spacing:.06em}.fsdAction.primary{border-color:rgba(103,235,232,.56);color:#8fffd1}.fsdAction:active,.fsdScene:active,.fsdToggle:active{transform:scale(.975)}
@media(max-width:620px){#fluidScenarioDock{width:calc(100vw - 20px);bottom:max(9px,env(safe-area-inset-bottom))}.fsdDrawer{bottom:63px;padding:12px}.fsdScenes{grid-template-columns:repeat(2,minmax(0,1fr));max-height:min(43vh,330px)}.fsdScene{min-height:55px}.fsdHelp{font-size:7.5px}.fsdBar{min-height:53px}.fsdActive{font-size:11px}.fsdActions{display:grid;grid-template-columns:repeat(4,1fr)}.fsdAction{padding:0 5px}}
@media(prefers-reduced-motion:reduce){.fsdDrawer{transition:none}}
`;
document.head.appendChild(style);

const dock=document.createElement('section');dock.id='fluidScenarioDock';dock.className='open';dock.setAttribute('aria-label','Fluid simulation scenarios');dock.innerHTML=`
  <div class="fsdDrawer">
    <div class="fsdHead"><div><div class="fsdTitle">FLUID SIMULATION LAB</div><div class="fsdHelp"></div></div><button class="fsdClose" type="button" aria-label="Close scenarios">×</button></div>
    <div class="fsdScenes"></div>
    <div class="fsdActions"><button class="fsdAction fsdInteract primary" type="button">RIPPLE</button><button class="fsdAction fsdPause" type="button">PAUSE</button><button class="fsdAction fsdReset" type="button">RESET</button><button class="fsdAction fsdSettings" type="button">SETTINGS</button></div>
  </div>
  <div class="fsdBar"><div><div class="fsdEyebrow">FLUID V8 · LIVE SCENARIO</div><div class="fsdActive"></div></div><button class="fsdToggle" type="button" aria-expanded="true">SCENARIOS</button></div>`;
document.body.appendChild(dock);
dock.addEventListener('pointerdown',e=>e.stopPropagation());dock.addEventListener('click',e=>e.stopPropagation());

const sceneHost=dock.querySelector('.fsdScenes');
for(const [key,label,note] of scenarios){
  const button=document.createElement('button');button.type='button';button.className='fsdScene';button.dataset.scene=key;button.innerHTML=`<b>${label}</b><small>${note}</small>`;sceneHost.appendChild(button);
}
const labelFor=key=>scenarios.find(item=>item[0]===key)?.[1]||key.toUpperCase();
function sync(){
  // Reflect the actual common-water controller state. This prevents the dock from
  // claiming Waterfall is active if another initializer/controller selected Pool.
  const live=window.__v5M830Scenes?.active;
  if(active!=='pour'&&valid.has(live))active=live;
  dock.querySelector('.fsdActive').textContent=labelFor(active);
  dock.querySelector('.fsdHelp').textContent=descriptions[active]||'';
  dock.querySelectorAll('[data-scene]').forEach(button=>button.classList.toggle('active',button.dataset.scene===active));
  const isPour=active==='pour';dock.querySelector('.fsdInteract').textContent=isPour?'POUR':'RIPPLE';
  dock.querySelector('.fsdSettings').disabled=isPour;
  dock.querySelector('.fsdSettings').style.opacity=isPour?'.42':'1';
  dock.querySelector('.fsdPause').textContent=window.__ui?.paused?'RESUME':'PAUSE';
}
function navigate(name){
  // Crossing between the calibrated Pour runtime and the common lab must start
  // with a clean query. Carrying Pour's small box/camera/particle values into Pool
  // was what made the basin appear tiny and off-centre.
  const next=new URLSearchParams();next.set('scenario',name);next.set('lab','9002');
  location.assign(location.pathname+'?'+next.toString()+location.hash);
}
function choose(name){
  if(name==='pour'||active==='pour'||!window.__v5M830Scenes?.choose){navigate(name);return}
  window.__v5M830Scenes.choose(name);active=name;frameCamera(name);
  const next=new URLSearchParams(location.search);next.set('scenario',name);next.set('lab','9002');history.replaceState(null,'',location.pathname+'?'+next.toString()+location.hash);
  sync();dock.classList.remove('open');dock.querySelector('.fsdToggle').setAttribute('aria-expanded','false');
}
dock.querySelectorAll('[data-scene]').forEach(button=>button.onclick=()=>choose(button.dataset.scene));
function setOpen(open){dock.classList.toggle('open',open);dock.querySelector('.fsdToggle').setAttribute('aria-expanded',String(open))}
dock.querySelector('.fsdToggle').onclick=()=>setOpen(!dock.classList.contains('open'));
dock.querySelector('.fsdClose').onclick=()=>setOpen(false);
dock.querySelector('.fsdPause').onclick=()=>{document.getElementById('pauseV4')?.click();setTimeout(sync,40)};
dock.querySelector('.fsdReset').onclick=()=>{
  if(active==='pour')window.__v5M899ProvenPour?.reset?.();
  else if(window.__v5M830Scenes?.choose){window.__v5M830Scenes.choose(active);frameCamera(active);}
  else document.getElementById('resetV4')?.click();
  setOpen(false);
};
dock.querySelector('.fsdSettings').onclick=()=>{setOpen(false);document.querySelector('.m742SettingsBtn')?.click()};
dock.querySelector('.fsdInteract').onclick=()=>{
  if(active==='pour'){window.__v5M899ProvenPour?.start?.();setOpen(false);return}
  const canvas=document.getElementById('view'),sim=window.__sim;
  if(canvas&&sim?.applyRayImpulse&&window.__screenRay){
    const r=canvas.getBoundingClientRect(),ray=window.__screenRay(.50,.48,r.width/Math.max(1,r.height));
    const strength=5.4,imp=[ray.dir[0]*strength*.58,-Math.abs(ray.dir[1])*strength*1.28-1.25,ray.dir[2]*strength*.58];
    sim.applyRayImpulse(ray.origin,ray.dir,imp,Math.max(window.__ui?.forceRadius||.20,.20),Math.max(window.__ui?.forceLimit||8,8));
  }
  setOpen(false);
};

if(window.__v5M899ProvenPour)active='pour';
else if(window.__v5M830Scenes?.choose){
  active=valid.has(query.get('scenario'))?query.get('scenario'):'pool';
  window.__v5M830Scenes.choose(active);
}
sync();frameCamera(active,true);setInterval(sync,450);
window.__fluidScenarioDock={online:true,choose,frameCamera,get active(){return active},open:()=>setOpen(true)};
console.info('[Fluid Simulation Lab M9.0] shared scenario dock online; DOM controls only, added GPU work 0.');
