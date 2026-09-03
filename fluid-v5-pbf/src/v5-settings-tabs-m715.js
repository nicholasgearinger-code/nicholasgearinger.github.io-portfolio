// Fluid V5 M7.1.5 settings UI redesign.
// Rebuilds the existing settings card as a resilient tabbed control panel without rewiring any
// simulation controls. Live DOM nodes are moved into category pages, so their existing event
// handlers/state stay intact. Loaded last so it also repairs a failed/partial older tab shell.

const panel=document.getElementById('settingsPanel');
if(!panel)throw new Error('Fluid V5 M7.1.5 settings: #settingsPanel unavailable.');

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<50;i++){
 if(document.getElementById('v5Lab')||document.getElementById('v4LiveWaterTune')||document.getElementById('v44RealismLab'))break;
 await sleep(50);
}

const STYLE_ID='fluidV5SettingsTabsM715Style';
if(!document.getElementById(STYLE_ID)){
 const style=document.createElement('style');
 style.id=STYLE_ID;
 style.textContent=`
 #settingsPanel.settings{
  position:fixed!important;
  z-index:50!important;
  top:max(92px,calc(env(safe-area-inset-top) + 80px))!important;
  right:max(12px,env(safe-area-inset-right))!important;
  bottom:max(14px,env(safe-area-inset-bottom))!important;
  left:auto!important;
  width:min(520px,calc(100vw - 24px))!important;
  max-height:none!important;
  height:auto!important;
  display:flex!important;
  flex-direction:column!important;
  overflow:hidden!important;
  padding:0!important;
  border-radius:16px!important;
  touch-action:auto!important;
 }
 #settingsPanel.settings.hidden{display:none!important;}
 #settingsPanel>.settingsTitle{display:none!important;}
 #v5SettingsHeader{
  flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:12px 12px 8px;border-bottom:1px solid rgba(78,214,220,.18);
  background:rgba(5,20,27,.92);
 }
 #v5SettingsHeader .v5SettingsHeading{font:800 11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em;color:#86f6ff;}
 #v5SettingsHeader .v5SettingsSub{margin-top:3px;font:7.3px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.05em;color:#86a8b5;}
 #v5SettingsClose{appearance:none;border:1px solid rgba(78,214,220,.34);background:rgba(4,17,24,.88);color:#dffcff;border-radius:999px;width:34px;height:34px;display:grid;place-items:center;font:900 15px ui-monospace;flex:0 0 auto;}
 #v5Tabs.v5SettingsTabBar{
  flex:0 0 auto;display:flex;gap:6px;overflow-x:auto;overflow-y:hidden;padding:8px 10px;
  background:rgba(5,20,27,.88);border-bottom:1px solid rgba(78,214,220,.16);
  overscroll-behavior-x:contain;scrollbar-width:none;-webkit-overflow-scrolling:touch;touch-action:pan-x;
 }
 #v5Tabs.v5SettingsTabBar::-webkit-scrollbar{display:none;}
 .v5SettingsTab{flex:0 0 auto;appearance:none;border:1px solid rgba(78,214,220,.28);background:rgba(4,17,24,.84);color:#9fc1cf;border-radius:999px;padding:8px 11px;font:800 8px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.055em;white-space:nowrap;}
 .v5SettingsTab.active{border-color:#f1ad43;color:#ffd890;background:rgba(77,54,17,.50);box-shadow:inset 0 0 0 1px rgba(241,173,67,.10);}
 #v5TabHost.v5SettingsPages{flex:1 1 auto;min-height:0;position:relative;overflow:hidden;background:rgba(5,20,27,.74);}
 .v5SettingsPage{display:none;height:100%;min-height:0;overflow-y:auto;overflow-x:hidden;padding:10px 11px max(18px,calc(env(safe-area-inset-bottom) + 10px));overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;}
 .v5SettingsPage.active{display:block;}
 .v5SettingsIntro{margin:0 0 9px;padding:8px 9px;border:1px solid rgba(78,214,220,.15);border-radius:10px;background:rgba(4,17,24,.55);font:7.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#8fb0bd;}
 .v5SettingsPage .v5Lab,.v5SettingsPage .v4Tune,.v5SettingsPage .v44Lab,.v5SettingsPage .v4WaveTest{margin-top:7px!important;padding-top:7px!important;}
 .v5SettingsPage .qualityRow{margin-top:2px!important;}
 .v5SettingsPage>*{max-width:100%;box-sizing:border-box;}
 @media(max-width:600px){
  #settingsPanel.settings{
   top:max(86px,calc(env(safe-area-inset-top) + 72px))!important;
   left:max(8px,env(safe-area-inset-left))!important;
   right:max(8px,env(safe-area-inset-right))!important;
   bottom:max(70px,calc(env(safe-area-inset-bottom) + 58px))!important;
   width:auto!important;
   border-radius:15px!important;
  }
  #v5SettingsHeader{padding:10px 10px 7px;}
  #v5SettingsHeader .v5SettingsHeading{font-size:10px;}
  #v5SettingsClose{width:32px;height:32px;}
  #v5Tabs.v5SettingsTabBar{padding:7px 8px;gap:5px;}
  .v5SettingsTab{font-size:7.5px;padding:7px 9px;}
  .v5SettingsPage{padding:9px 9px max(16px,calc(env(safe-area-inset-bottom) + 8px));}
 }
 `;
 document.head.appendChild(style);
}

// Preserve every live control before replacing any older tab shell.
const oldTabs=document.getElementById('v5Tabs');
const oldHost=document.getElementById('v5TabHost');
const legacyBuckets={};
if(oldHost){
 for(const p of oldHost.querySelectorAll('[data-panel]')){
  const key=p.dataset.panel;
  legacyBuckets[key]=[...p.children].filter(n=>!n.classList?.contains('v5TabIntro')&&!n.classList?.contains('v5SettingsIntro'));
 }
}
if(oldTabs)oldTabs.remove();
if(oldHost)oldHost.remove();

// Remove a previous M7.1.5 shell if this module is hot-reloaded.
document.getElementById('v5SettingsHeader')?.remove();
document.getElementById('v5TabHost')?.remove();

const defs=[
 ['general','GENERAL','Quality, workload, and global simulation settings.'],
 ['scenes','SCENES','Choose the physical experiment and scene-specific controls.'],
 ['physics','PHYSICS','PBF/XPBD solver, rigid-body interaction, hydrodynamics, drain, and mechanical controls.'],
 ['water','WATER','Primary liquid material, surface reconstruction, optics, absorption, and fluid appearance.'],
 ['lighting','LIGHT','Sun, HDR environment, exposure, pool illumination, projected caustics, and night lighting.'],
 ['realism','REALISM','Whitewater, spray, foam, micro-ripples, shafts, scattering, wet lines, and secondary detail.'],
 ['camera','CAMERA','Camera movement, underwater mode, and underwater-medium controls.'],
 ['developer','DEBUG','Backend status, diagnostics, render/debug views, particle data, and developer controls.'],
];

const header=document.createElement('div');header.id='v5SettingsHeader';
header.innerHTML='<div><div class="v5SettingsHeading">FLUID V5 · SETTINGS</div><div class="v5SettingsSub">One category at a time · live controls</div></div><button id="v5SettingsClose" type="button" aria-label="Close settings">×</button>';
const tabs=document.createElement('div');tabs.id='v5Tabs';tabs.className='v5SettingsTabBar';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Fluid settings categories');
const host=document.createElement('div');host.id='v5TabHost';host.className='v5SettingsPages';
const pages={};

function activate(key,focus=false){
 if(!pages[key])key='general';
 tabs.querySelectorAll('.v5SettingsTab').forEach(b=>{
  const on=b.dataset.tab===key;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;
  if(on&&focus){b.focus({preventScroll:true});b.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});}
 });
 Object.entries(pages).forEach(([k,p])=>{const on=k===key;p.classList.toggle('active',on);p.hidden=!on;});
 try{localStorage.setItem('fluidV5SettingsTabM715',key);}catch{}
}

for(const [key,label,desc] of defs){
 const b=document.createElement('button');b.type='button';b.className='v5SettingsTab';b.dataset.tab=key;b.id=`v5SettingsTab-${key}`;b.textContent=label;b.setAttribute('role','tab');b.setAttribute('aria-controls',`v5SettingsPage-${key}`);b.setAttribute('aria-selected','false');
 b.onclick=e=>{e.preventDefault();e.stopPropagation();activate(key,true);};tabs.appendChild(b);
 const page=document.createElement('div');page.className='v5SettingsPage';page.dataset.panel=key;page.id=`v5SettingsPage-${key}`;page.setAttribute('role','tabpanel');page.setAttribute('aria-labelledby',b.id);page.hidden=true;
 const intro=document.createElement('div');intro.className='v5SettingsIntro';intro.textContent=desc;page.appendChild(intro);host.appendChild(page);pages[key]=page;
}

panel.prepend(host);panel.prepend(tabs);panel.prepend(header);
panel.querySelector('.settingsTitle')?.setAttribute('aria-hidden','true');
header.querySelector('#v5SettingsClose').onclick=e=>{e.preventDefault();e.stopPropagation();panel.classList.add('hidden');};

const move=(node,key)=>{if(node&&pages[key]&&node!==pages[key]&&!pages[key].contains(node))pages[key].appendChild(node);};

// Import content from the older tab shell if it successfully mounted before this finalizer.
const legacyMap={quality:'general',scenes:'scenes',physics:'physics',water:'water',light:'lighting',lighting:'lighting',realism:'realism',camera:'camera',developer:'developer'};
for(const [key,nodes] of Object.entries(legacyBuckets))for(const n of nodes)move(n,legacyMap[key]||'general');

// Fixed top-level controls.
move(panel.querySelector('.qualityRow'),'general');
move(document.getElementById('qualityNote'),'general');

// Known subsystem cards. Appending moves the existing live node and preserves its listeners.
const idMap={
 v5WorkloadM45:'general',
 v5ScenariosM46:'scenes',v5WeatherM562:'scenes',v5WaterfallM57:'scenes',v4WaveTest:'scenes',v5M71Panel:'scenes',
 v5PhysicsM40:'physics',v5M5Physics:'physics',
 v4LiveWaterTune:'water',v5SurfaceM42:'water',
 v5LightLab:'lighting',v5ProjectedCaustics:'lighting',
 v44RealismLab:'realism',v5WhitewaterM41:'realism',v5M5Detail:'realism',
 v5M5Status:'developer',v5M4Status:'developer',v5DevHudToggle:'developer',v5M2DevHud:'developer'
};
for(const [id,key] of Object.entries(idMap))move(document.getElementById(id),key);

// Harvest legacy V5 lab sections when the old tab shell never mounted.
const lab=document.getElementById('v5Lab');
function collectSection(root,needle){
 if(!root)return[];const kids=[...root.children];const i=kids.findIndex(n=>n.classList?.contains('v5SectionTitle')&&String(n.textContent||'').toUpperCase().includes(needle));if(i<0)return[];
 const out=[];for(let j=i;j<kids.length;j++){const n=kids[j];if(j>i&&n.classList?.contains('v5SectionTitle'))break;if(n.id==='v5Milestone2')break;out.push(n);}return out;
}
collectSection(lab,'SCENARIO').forEach(n=>move(n,'scenes'));
collectSection(lab,'RIGID BODY').forEach(n=>move(n,'physics'));
collectSection(lab,'DEVELOPER VIEW').forEach(n=>move(n,'developer'));
const cameraFx=collectSection(lab,'CAMERA + GPU EFFECTS');
for(const n of cameraFx){
 if(n.classList?.contains('v5SectionTitle')){move(n,'camera');continue;}
 if(n.querySelector?.('#v5Projected')||n.id==='v5Projected')move(n,'lighting');
 else if(n.querySelector?.('#v5Spray')||n.id==='v5Spray')move(n,'realism');
 else move(n,'camera');
}

// M2 controls that are not in named subsystem cards.
const m2=document.getElementById('v5Milestone2');
move(document.getElementById('v5Secondary')?.closest('.v5Slider'),'realism');
move(document.getElementById('v5DrainRate')?.closest('.v5Slider'),'physics');
move(document.getElementById('v5UnderwaterHaze')?.closest('.v5Slider'),'camera');
if(m2){for(const g of m2.querySelectorAll('.v5Grid'))if(g.querySelector('[data-m2debug]'))move(g,'developer');}

// Hide emptied structural wrappers, but never hide a wrapper that still owns live controls.
if(lab&&![...lab.children].some(n=>n.offsetParent!==null&&!n.classList?.contains('v5Top')&&n.id!=='v5Milestone2'))lab.style.display='none';

function classify(node){
 const s=`${node.id||''} ${node.className||''} ${node.textContent||''}`.toLowerCase();
 if(/scene|scenario|wave|rain|waterfall|faucet|fountain|whirlpool|paddle|gravity pour|dam break/.test(s))return'scenes';
 if(/physics|solver|xpbd|rigid|hydro|drain|buoy|density/.test(s))return'physics';
 if(/lighting|light |sun|hdr|exposure|caustic|ibl|environment/.test(s))return'lighting';
 if(/realism|spray|foam|whitewater|ripple|scatter|dispersion|wet line|microdrop|shaft/.test(s))return'realism';
 if(/camera|underwater|haze/.test(s))return'camera';
 if(/debug|developer|backend|status|diagnostic/.test(s))return'developer';
 if(/water|surface|optics|absorb|roughness|ior|reconstruct/.test(s))return'water';
 return'general';
}

// Catch UI cards mounted asynchronously after this module. A stray child of the settings card is
// immediately categorized instead of becoming another tall stack outside the tabs.
function sweep(){
 for(const node of [...panel.children]){
  if(node===header||node===tabs||node===host||node.classList?.contains('settingsTitle'))continue;
  move(node,classify(node));
 }
 // Cards can also be appended directly to old/compatibility panel selectors by late modules.
 for(const [key,page] of Object.entries(pages)){
  for(const child of [...page.children]){
   if(child.classList?.contains('v5SettingsIntro'))continue;
   // If an obvious category mismatch arrived via a generic panel, move it once to the better page.
   const target=classify(child);if(target!==key&&target!=='general')move(child,target);
  }
 }
}

let initial='general';try{const saved=localStorage.getItem('fluidV5SettingsTabM715');if(pages[saved])initial=saved;}catch{}
activate(initial);
sweep();
const observer=new MutationObserver(()=>queueMicrotask(sweep));observer.observe(panel,{childList:true,subtree:false});
setInterval(sweep,700);

panel.addEventListener('pointerdown',e=>e.stopPropagation());
panel.addEventListener('click',e=>e.stopPropagation());
panel.addEventListener('touchmove',e=>e.stopPropagation(),{passive:true});

window.__v5SettingsTabsM715={online:true,version:'M7.1.5',tabs:defs.map(d=>d[0]),activate,sweep};
console.info('[Fluid V5 M7.1.5] tabbed settings redesign online: General / Scenes / Physics / Water / Light / Realism / Camera / Debug.');
