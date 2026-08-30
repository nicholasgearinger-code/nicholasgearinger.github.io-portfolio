// Fluid V5 M7.2 — definitive settings + performance controller.
// Owns one permanent settings modal. Existing simulation controls are MOVED into its pages,
// never cloned, so all established handlers/state bindings remain live. Legacy tab hosts are kept
// hidden as compatibility inboxes: late subsystem cards can still mount there and are harvested.

const panel=document.getElementById('settingsPanel');
if(!panel)throw new Error('Fluid V5 M7.2 settings: #settingsPanel unavailable.');
const settingsBtn=document.getElementById('settingsBtn');

// Remove UI chrome from the failed interim shells. We leave legacy control hosts themselves in the
// DOM because some late modules intentionally query #v5TabHost before appending their live card.
for(const id of ['v5Settings717Header','v5Settings716Header','v5SettingsHeader'])document.getElementById(id)?.remove();

document.getElementById('fluidV5SettingsM72Style')?.remove();
const style=document.createElement('style');
style.id='fluidV5SettingsM72Style';
style.textContent=`
#settingsPanel.settings{
 position:fixed!important;z-index:90!important;
 top:max(82px,calc(env(safe-area-inset-top) + 68px))!important;
 right:max(10px,env(safe-area-inset-right))!important;
 bottom:max(72px,calc(env(safe-area-inset-bottom) + 58px))!important;
 left:max(10px,env(safe-area-inset-left))!important;
 width:auto!important;max-width:590px!important;margin-left:auto!important;
 max-height:none!important;height:auto!important;padding:0!important;
 display:flex!important;flex-direction:column!important;overflow:hidden!important;
 border-radius:16px!important;touch-action:auto!important;
}
#settingsPanel.settings.hidden{opacity:0!important;pointer-events:none!important;transform:translateY(-5px)!important;}
#settingsPanel>.settingsTitle{display:none!important}
/* Nothing from the old one-column interface is allowed to render beside the definitive shell. */
#settingsPanel>:not(#v5Settings72Root):not(.settingsTitle){display:none!important}
#v5Settings72Root{display:flex!important;flex:1 1 auto;min-height:0;flex-direction:column;overflow:hidden;width:100%;height:100%}
#v5Settings72Header{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 12px 9px;background:rgba(5,20,27,.97);border-bottom:1px solid rgba(78,214,220,.18)}
.v5Settings72Title{font:800 11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.15em;color:#86f6ff}.v5Settings72Sub{margin-top:3px;font:7.5px/1.35 ui-monospace;color:#8fb0bd;letter-spacing:.04em}
#v5Settings72Close{appearance:none;width:34px;height:34px;flex:0 0 auto;border:1px solid rgba(78,214,220,.38);border-radius:999px;background:rgba(4,17,24,.92);color:#dffcff;font:900 16px ui-monospace;display:grid;place-items:center}
#v5Settings72Tabs{flex:0 0 auto;display:flex;gap:5px;padding:8px;overflow-x:auto;overflow-y:hidden;background:rgba(5,20,27,.93);border-bottom:1px solid rgba(78,214,220,.16);scrollbar-width:none;-webkit-overflow-scrolling:touch;touch-action:pan-x;overscroll-behavior-x:contain}
#v5Settings72Tabs::-webkit-scrollbar{display:none}.v5Settings72Tab{flex:0 0 auto;appearance:none;border:1px solid rgba(78,214,220,.30);border-radius:999px;background:rgba(4,17,24,.87);color:#9fc1cf;padding:8px 11px;font:800 8px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.05em;white-space:nowrap}.v5Settings72Tab.active{border-color:#f1ad43;color:#ffd890;background:rgba(77,54,17,.52)}
#v5Settings72Host{flex:1 1 auto;min-height:0;overflow:hidden;background:rgba(5,20,27,.82)}.v5Settings72Page{display:none;height:100%;min-height:0;overflow-y:auto;overflow-x:hidden;padding:10px 10px max(18px,calc(env(safe-area-inset-bottom) + 8px));-webkit-overflow-scrolling:touch;touch-action:pan-y;overscroll-behavior:contain}.v5Settings72Page.active{display:block}.v5Settings72Intro{margin:0 0 9px;padding:8px 9px;border:1px solid rgba(78,214,220,.15);border-radius:10px;background:rgba(4,17,24,.58);font:7.5px/1.45 ui-monospace;color:#8fb0bd}.v5Settings72Empty{padding:18px 10px;text-align:center;font:8px/1.5 ui-monospace;color:#6f909d;border:1px dashed rgba(78,214,220,.12);border-radius:10px}
.v5Settings72Page>*{max-width:100%!important;box-sizing:border-box!important}.v5Settings72Page .v5Lab,.v5Settings72Page .v4Tune,.v5Settings72Page .v44Lab,.v5Settings72Page .v4WaveTest{margin-top:7px!important;padding-top:7px!important}
/* The old tab system remains only as a hidden compatibility inbox for late-mounted cards. */
#v5Tabs,#v5TabHost{display:none!important}
#v5PerfDetailM72{font-size:8px!important;line-height:1.35!important;margin-top:2px;color:#9fc1cf;text-align:right;white-space:nowrap}
@media(min-width:700px){#settingsPanel.settings{left:auto!important;width:min(560px,calc(100vw - 24px))!important}}
`;
document.head.appendChild(style);

const defs=[
 ['general','GENERAL','Quality, workload and global simulation controls.'],
 ['scenes','SCENES','Choose the physical experiment and tune only that scene’s inputs.'],
 ['physics','PHYSICS','PBF/XPBD solver, rigid bodies, hydrodynamics, forces and drains.'],
 ['water','WATER','Primary liquid material, surface reconstruction, optics and absorption.'],
 ['lighting','LIGHT','Sun, HDR environment, exposure, caustics and pool illumination.'],
 ['realism','REALISM','Whitewater, spray, foam, ripples, scattering and secondary detail.'],
 ['camera','CAMERA','Camera movement, underwater camera and underwater medium.'],
 ['debug','DEBUG','Solver/backend telemetry, render views and developer diagnostics.']
];

const previousRoot=document.getElementById('v5Settings72Root');if(previousRoot)previousRoot.remove();
const root=document.createElement('div');root.id='v5Settings72Root';
const header=document.createElement('div');header.id='v5Settings72Header';
header.innerHTML='<div><div class="v5Settings72Title">FLUID V5 · SETTINGS</div><div class="v5Settings72Sub">Permanent control panel · one category at a time</div></div><button id="v5Settings72Close" type="button" aria-label="Close settings">×</button>';
const tabs=document.createElement('div');tabs.id='v5Settings72Tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Fluid settings categories');
const host=document.createElement('div');host.id='v5Settings72Host';
root.append(header,tabs,host);panel.prepend(root);
const pages={};
for(const [key,label,desc] of defs){
 const b=document.createElement('button');b.type='button';b.className='v5Settings72Tab';b.dataset.tab=key;b.textContent=label;b.setAttribute('role','tab');tabs.appendChild(b);
 const p=document.createElement('section');p.className='v5Settings72Page';p.dataset.page=key;p.hidden=true;
 const intro=document.createElement('div');intro.className='v5Settings72Intro';intro.textContent=desc;
 const empty=document.createElement('div');empty.className='v5Settings72Empty';empty.textContent='Waiting for live controls…';
 p.append(intro,empty);host.appendChild(p);pages[key]=p;
 b.onclick=e=>{e.preventDefault();e.stopPropagation();activate(key,true)};
}
function activate(key,focus=false){
 if(!pages[key])key='general';
 for(const b of tabs.children){const on=b.dataset.tab===key;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));if(on&&focus)b.scrollIntoView({block:'nearest',inline:'nearest'})}
 for(const [k,p] of Object.entries(pages)){const on=k===key;p.classList.toggle('active',on);p.hidden=!on}
 try{localStorage.setItem('fluidV5SettingsTabM72',key)}catch{}
}
let initial='general';try{const saved=localStorage.getItem('fluidV5SettingsTabM72');if(pages[saved])initial=saved}catch{}activate(initial);

const compatMap={quality:'general',general:'general',scenes:'scenes',physics:'physics',water:'water',light:'lighting',lighting:'lighting',realism:'realism',camera:'camera',developer:'debug',debug:'debug'};
const known={
 v5WorkloadM45:'general',
 v5ScenariosM46:'scenes',v5WeatherM562:'scenes',v5WaterfallM57:'scenes',v4WaveTest:'scenes',v5M71Panel:'scenes',
 v5PhysicsM40:'physics',v5M5Physics:'physics',
 v4LiveWaterTune:'water',v5SurfaceM42:'water',
 v5LightLab:'lighting',v5ProjectedCaustics:'lighting',
 v44RealismLab:'realism',v5WhitewaterM41:'realism',v5M5Detail:'realism',
 v5M5Status:'debug',v5M4Status:'debug',v5DevHudToggle:'debug',v5M2DevHud:'debug'
};
function classify(node){
 const s=`${node.id||''} ${node.className||''} ${node.textContent||''}`.toLowerCase();
 if(/scene|scenario|wave|rain|waterfall|faucet|fountain|whirlpool|paddle|gravity pour|dam break|pour/.test(s))return'scenes';
 if(/physics|solver|xpbd|rigid|hydro|drain|buoy|density|substep|iteration/.test(s))return'physics';
 if(/lighting|light |sun|hdr|exposure|caustic|ibl|environment/.test(s))return'lighting';
 if(/realism|spray|foam|whitewater|ripple|scatter|dispersion|wet line|microdrop|shaft|temporal/.test(s))return'realism';
 if(/camera|underwater|haze/.test(s))return'camera';
 if(/debug|developer|backend|status|diagnostic|view mode/.test(s))return'debug';
 if(/water|surface|optics|absorb|roughness|ior|reconstruct|tension/.test(s))return'water';
 return'general';
}
function adopt(node,key){
 if(!node||!pages[key]||node===root||root.contains(node))return false;
 pages[key].appendChild(node);return true;
}
function collectLab(){
 const lab=document.getElementById('v5Lab');if(!lab)return;
 let target='general';
 for(const n of [...lab.children]){
  if(n.id==='v5Milestone2'||n.classList?.contains('v5Top'))continue;
  if(n.classList?.contains('v5SectionTitle'))target=classify(n);
  adopt(n,target);
 }
}
function harvest(){
 // Quality exists before the advanced lab and must remain accessible even while other systems boot.
 adopt(panel.querySelector(':scope > .qualityRow'),'general');adopt(document.getElementById('qualityNote'),'general');
 // The established tab shell is treated as a compatibility inbox. Preserve panel category identity.
 const legacyHost=document.getElementById('v5TabHost');
 if(legacyHost){
  for(const p of legacyHost.querySelectorAll('[data-panel]')){
   const key=compatMap[p.dataset.panel]||'general';
   for(const child of [...p.children])if(!child.classList?.contains('v5TabIntro')&&!child.classList?.contains('v5SettingsIntro'))adopt(child,key);
  }
 }
 for(const [id,key] of Object.entries(known))adopt(document.getElementById(id),key);
 collectLab();
 adopt(document.getElementById('v5Secondary')?.closest('.v5Slider'),'realism');
 adopt(document.getElementById('v5DrainRate')?.closest('.v5Slider'),'physics');
 adopt(document.getElementById('v5UnderwaterHaze')?.closest('.v5Slider'),'camera');
 const m2=document.getElementById('v5Milestone2');if(m2)for(const g of m2.querySelectorAll('.v5Grid'))if(g.querySelector('[data-m2debug]'))adopt(g,'debug');
 // Anything an old module appended directly to settings is categorized instead of forming a stack.
 for(const node of [...panel.children]){
  if(node===root||node.classList?.contains('settingsTitle')||node.id==='v5Tabs'||node.id==='v5TabHost')continue;
  adopt(node,classify(node));
 }
 for(const p of Object.values(pages)){
  const empty=p.querySelector(':scope > .v5Settings72Empty');
  const hasLive=[...p.children].some(n=>!n.classList.contains('v5Settings72Intro')&&!n.classList.contains('v5Settings72Empty'));
  if(empty)empty.style.display=hasLive?'none':'block';
 }
}
harvest();
// Keep harvesting for the lifetime of the app. Advanced cards intentionally mount asynchronously.
setInterval(harvest,400);
const bodyObserver=new MutationObserver(()=>queueMicrotask(harvest));
bodyObserver.observe(document.body,{childList:true,subtree:true});

header.querySelector('#v5Settings72Close').onclick=e=>{e.preventDefault();e.stopPropagation();panel.classList.add('hidden')};
panel.addEventListener('pointerdown',e=>e.stopPropagation());panel.addEventListener('click',e=>e.stopPropagation());panel.addEventListener('touchmove',e=>e.stopPropagation(),{passive:true});
function enforceSettingsLauncher(){
 if(!settingsBtn)return;
 if(settingsBtn.textContent!=='SETTINGS')settingsBtn.textContent='SETTINGS';
 settingsBtn.setAttribute('aria-label','Open settings');settingsBtn.title='Settings';
 settingsBtn.onclick=e=>{e.preventDefault();e.stopPropagation();panel.classList.toggle('hidden')};
}
enforceSettingsLauncher();if(settingsBtn)new MutationObserver(enforceSettingsLauncher).observe(settingsBtn,{childList:true,characterData:true,subtree:true});setInterval(enforceSettingsLauncher,500);

// ---- Direct performance telemetry -------------------------------------------------------------
// The old HUD parses an upstream text string. M7.2 instead owns a replacement #v4fps node after
// the core has initialized, then measures actual requestAnimationFrame cadence itself.
async function installPerformanceHud(){
 const start=performance.now();
 while((!window.__sim||!window.__ui||!document.getElementById('v4fps'))&&performance.now()-start<30000)await new Promise(r=>setTimeout(r,50));
 const old=document.getElementById('v4fps');if(!old)return;
 const fpsNode=old.cloneNode(false);fpsNode.id='v4fps';fpsNode.textContent='-- FPS';old.replaceWith(fpsNode);
 let detail=document.getElementById('v5PerfDetailM72');if(detail)detail.remove();detail=document.createElement('div');detail.id='v5PerfDetailM72';detail.className='status';fpsNode.insertAdjacentElement('afterend',detail);
 let last=0,elapsed=0,frames=0,fps=0,frameMs=0;
 function tick(ts){
  if(last){const dt=ts-last;if(dt>0&&dt<1000){elapsed+=dt;frames++;}}
  last=ts;
  if(elapsed>=500&&frames){fps=frames*1000/elapsed;frameMs=elapsed/frames;elapsed=0;frames=0;
   const sim=window.__sim,ph=window.__v5PhysicsM40;const sub=Number(ph?.dynamic?.substeps??sim?.params?.substeps??0)||0;const iter=Number(ph?.dynamic?.iterations??sim?.params?.iterations??0)||0;const solverRate=fps*sub;
   fpsNode.textContent=`${fps.toFixed(1)} FPS`;
   detail.textContent=`${frameMs.toFixed(1)} ms · ${sub||'--'} sub · ${iter||'--'} iter · ~${solverRate?Math.round(solverRate):'--'} sub/s`;
   window.__v5PerfM72={online:true,fps,frameMs,substeps:sub,iterations:iter,solverSubstepsPerSecond:solverRate,source:'direct-rAF'};
  }
  requestAnimationFrame(tick);
 }
 requestAnimationFrame(tick);
}
installPerformanceHud();

window.__v5SettingsM72={online:true,version:'M7.2',pages:Object.keys(pages),activate,harvest};
console.info('[Fluid V5 M7.2] definitive settings controller + direct rAF performance telemetry online.');
