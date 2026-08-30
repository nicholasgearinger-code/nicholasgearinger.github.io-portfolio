// Fluid V5 M7.1.6 — independent mobile settings shell.
// Loaded directly by index.html so a failure in any physics/bootstrap module cannot prevent the UI redesign.
// Existing live controls are moved (not cloned), preserving all listeners and state bindings.

const panel=document.getElementById('settingsPanel');
if(!panel) throw new Error('Fluid V5 M7.1.6 settings: #settingsPanel unavailable.');

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const style=document.createElement('style');
style.id='fluidV5SettingsM716Style';
style.textContent=`
#settingsPanel.settings{
 position:fixed!important;z-index:80!important;
 top:max(82px,calc(env(safe-area-inset-top) + 68px))!important;
 right:max(10px,env(safe-area-inset-right))!important;
 bottom:max(72px,calc(env(safe-area-inset-bottom) + 58px))!important;
 left:max(10px,env(safe-area-inset-left))!important;
 width:auto!important;max-width:540px!important;margin-left:auto!important;
 max-height:none!important;height:auto!important;padding:0!important;
 display:flex!important;flex-direction:column!important;overflow:hidden!important;
 border-radius:16px!important;touch-action:auto!important;
}
#settingsPanel.settings.hidden{display:none!important;}
#settingsPanel>.settingsTitle{display:none!important;}
#v5Settings716Header{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 11px 8px;background:rgba(5,20,27,.96);border-bottom:1px solid rgba(78,214,220,.18)}
.v5Settings716Title{font:800 11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;color:#86f6ff}.v5Settings716Sub{margin-top:3px;font:7.4px/1.35 ui-monospace;color:#8fb0bd;letter-spacing:.04em}
#v5Settings716Close{appearance:none;width:34px;height:34px;flex:0 0 auto;border:1px solid rgba(78,214,220,.38);border-radius:999px;background:rgba(4,17,24,.92);color:#dffcff;font:900 16px ui-monospace;display:grid;place-items:center}
#v5Settings716Tabs{flex:0 0 auto;display:flex;gap:5px;padding:8px;overflow-x:auto;overflow-y:hidden;background:rgba(5,20,27,.92);border-bottom:1px solid rgba(78,214,220,.16);scrollbar-width:none;-webkit-overflow-scrolling:touch;touch-action:pan-x;overscroll-behavior-x:contain}
#v5Settings716Tabs::-webkit-scrollbar{display:none}.v5Settings716Tab{flex:0 0 auto;appearance:none;border:1px solid rgba(78,214,220,.28);border-radius:999px;background:rgba(4,17,24,.86);color:#9fc1cf;padding:8px 10px;font:800 8px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.05em;white-space:nowrap}.v5Settings716Tab.active{border-color:#f1ad43;color:#ffd890;background:rgba(77,54,17,.52)}
#v5Settings716Host{flex:1 1 auto;min-height:0;overflow:hidden;background:rgba(5,20,27,.80)}.v5Settings716Page{display:none;height:100%;min-height:0;overflow-y:auto;overflow-x:hidden;padding:10px 10px max(18px,calc(env(safe-area-inset-bottom) + 8px));-webkit-overflow-scrolling:touch;touch-action:pan-y;overscroll-behavior:contain}.v5Settings716Page.active{display:block}.v5Settings716Intro{margin:0 0 9px;padding:8px 9px;border:1px solid rgba(78,214,220,.15);border-radius:10px;background:rgba(4,17,24,.58);font:7.5px/1.45 ui-monospace;color:#8fb0bd}
.v5Settings716Page>*{max-width:100%!important;box-sizing:border-box!important}.v5Settings716Page .v5Lab,.v5Settings716Page .v4Tune,.v5Settings716Page .v44Lab,.v5Settings716Page .v4WaveTest{margin-top:7px!important;padding-top:7px!important}
/* Hide any older tab chrome after its live controls are harvested. */
#v5Tabs,#v5TabHost{display:none!important}
@media(min-width:700px){#settingsPanel.settings{left:auto!important;width:min(520px,calc(100vw - 24px))!important}}
`;
document.getElementById(style.id)?.remove();document.head.appendChild(style);

const defs=[
 ['general','GENERAL','Quality, workload and global simulation controls.'],
 ['scenes','SCENES','Choose the physical experiment and tune scene-specific inputs.'],
 ['physics','PHYSICS','PBF/XPBD solver, rigid bodies, hydrodynamics, forces and drains.'],
 ['water','WATER','Primary liquid material, surface reconstruction, optics and absorption.'],
 ['lighting','LIGHT','Sun, HDR environment, exposure, caustics and pool lighting.'],
 ['realism','REALISM','Whitewater, spray, foam, ripples, scattering and secondary detail.'],
 ['camera','CAMERA','Camera movement, underwater camera and underwater medium.'],
 ['debug','DEBUG','Backend status, render views, diagnostics and developer controls.']
];

const oldHeader=document.getElementById('v5Settings716Header');if(oldHeader)oldHeader.remove();
const oldTabs716=document.getElementById('v5Settings716Tabs');if(oldTabs716)oldTabs716.remove();
const oldHost716=document.getElementById('v5Settings716Host');if(oldHost716)oldHost716.remove();

const header=document.createElement('div');header.id='v5Settings716Header';header.innerHTML='<div><div class="v5Settings716Title">FLUID V5 · SETTINGS</div><div class="v5Settings716Sub">All controls · one category at a time</div></div><button id="v5Settings716Close" type="button" aria-label="Close settings">×</button>';
const tabs=document.createElement('div');tabs.id='v5Settings716Tabs';tabs.setAttribute('role','tablist');
const host=document.createElement('div');host.id='v5Settings716Host';
const pages={};
for(const [key,label,desc] of defs){
 const b=document.createElement('button');b.type='button';b.className='v5Settings716Tab';b.dataset.tab=key;b.textContent=label;b.setAttribute('role','tab');b.onclick=e=>{e.preventDefault();e.stopPropagation();activate(key,true)};tabs.appendChild(b);
 const p=document.createElement('section');p.className='v5Settings716Page';p.dataset.page=key;p.hidden=true;const intro=document.createElement('div');intro.className='v5Settings716Intro';intro.textContent=desc;p.appendChild(intro);host.appendChild(p);pages[key]=p;
}
panel.prepend(host);panel.prepend(tabs);panel.prepend(header);

function activate(key,focus=false){
 if(!pages[key])key='general';
 for(const b of tabs.children){const on=b.dataset.tab===key;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));if(on&&focus)b.scrollIntoView({block:'nearest',inline:'nearest'});}
 for(const [k,p] of Object.entries(pages)){const on=k===key;p.classList.toggle('active',on);p.hidden=!on;}
 try{localStorage.setItem('fluidV5SettingsTabM716',key)}catch{}
}
const move=(node,key)=>{if(node&&pages[key]&&!pages[key].contains(node))pages[key].appendChild(node)};

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

const known={
 v5WorkloadM45:'general',
 v5ScenariosM46:'scenes',v5WeatherM562:'scenes',v5WaterfallM57:'scenes',v4WaveTest:'scenes',v5M71Panel:'scenes',
 v5PhysicsM40:'physics',v5M5Physics:'physics',
 v4LiveWaterTune:'water',v5SurfaceM42:'water',
 v5LightLab:'lighting',v5ProjectedCaustics:'lighting',
 v44RealismLab:'realism',v5WhitewaterM41:'realism',v5M5Detail:'realism',
 v5M5Status:'debug',v5M4Status:'debug',v5DevHudToggle:'debug',v5M2DevHud:'debug'
};

function harvestLegacyTabs(){
 const legacyHost=document.getElementById('v5TabHost');
 if(legacyHost){for(const p of [...legacyHost.querySelectorAll('[data-panel]')]){const map={quality:'general',scenes:'scenes',physics:'physics',water:'water',light:'lighting',lighting:'lighting',realism:'realism',camera:'camera',developer:'debug'};for(const child of [...p.children])if(!child.classList?.contains('v5TabIntro'))move(child,map[p.dataset.panel]||classify(child));}legacyHost.remove();}
 document.getElementById('v5Tabs')?.remove();
}

function harvestLab(){
 const lab=document.getElementById('v5Lab');if(!lab)return;
 const kids=[...lab.children];let target='general';
 for(const n of kids){
  if(n.id==='v5Milestone2')continue;
  if(n.classList?.contains('v5SectionTitle'))target=classify(n);
  if(!n.classList?.contains('v5Top'))move(n,target);
 }
}

function sweep(){
 harvestLegacyTabs();
 move(panel.querySelector('.qualityRow'),'general');move(document.getElementById('qualityNote'),'general');
 for(const [id,key] of Object.entries(known))move(document.getElementById(id),key);
 harvestLab();
 move(document.getElementById('v5Secondary')?.closest('.v5Slider'),'realism');
 move(document.getElementById('v5DrainRate')?.closest('.v5Slider'),'physics');
 move(document.getElementById('v5UnderwaterHaze')?.closest('.v5Slider'),'camera');
 const m2=document.getElementById('v5Milestone2');if(m2)for(const g of [...m2.querySelectorAll('.v5Grid')])if(g.querySelector('[data-m2debug]'))move(g,'debug');
 for(const node of [...panel.children]){if(node===header||node===tabs||node===host||node.classList?.contains('settingsTitle'))continue;move(node,classify(node));}
}

header.querySelector('#v5Settings716Close').onclick=e=>{e.preventDefault();e.stopPropagation();panel.classList.add('hidden')};
panel.addEventListener('pointerdown',e=>e.stopPropagation());panel.addEventListener('click',e=>e.stopPropagation());panel.addEventListener('touchmove',e=>e.stopPropagation(),{passive:true});
const settingsBtn=document.getElementById('settingsBtn');if(settingsBtn)settingsBtn.textContent='⚙ SETTINGS';

let initial='general';try{const saved=localStorage.getItem('fluidV5SettingsTabM716');if(pages[saved])initial=saved}catch{}
activate(initial);sweep();
const observer=new MutationObserver(()=>queueMicrotask(sweep));observer.observe(panel,{childList:true,subtree:false});
setInterval(sweep,450);

function stamp(){document.querySelector('.hud.card.title')?.replaceChildren(document.createTextNode('FLUID V5 · M7.1.6'));window.__fluidV5Version='7.1.6-ui';window.__fluidV5SettingsUI='M7.1.6 TABBED SETTINGS';}
stamp();setInterval(stamp,1200);
window.__v5SettingsTabsM716={online:true,version:'M7.1.6',activate,sweep,tabs:defs.map(d=>d[0])};
console.info('[Fluid V5 M7.1.6] independent tabbed settings shell online.');
