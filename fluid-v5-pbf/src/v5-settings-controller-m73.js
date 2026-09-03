// Fluid V5 M7.3 — native settings/performance controller.
// The settings UI no longer depends on legacy cards mounting. Every tab has first-class controls
// bound directly to the live engine/state, while older subsystem UIs remain hidden compatibility DOM.

const panel=document.getElementById('settingsPanel');
const settingsBtn=document.getElementById('settingsBtn');
if(!panel||!settingsBtn)throw new Error('Fluid V5 M7.3 settings: base settings DOM unavailable.');

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number(v)||0));
const qs=new URLSearchParams(location.search);
const currentQuality=['low','medium','high'].includes(qs.get('quality'))?qs.get('quality'):'medium';
const STATE_KEY='fluidV5LabStateV1';
const PERF_KEY='fluidV5PerfM73';
const REALISM_KEY='fluidV44RealismLabV1';

function state(){return window.__v5State||null}
function saveState(){const s=state();if(!s)return;try{localStorage.setItem(STATE_KEY,JSON.stringify(s))}catch{}}
function realism(){return window.__fluidV44Realism||null}
function saveRealism(){const r=realism();if(!r)return;try{localStorage.setItem(REALISM_KEY,JSON.stringify(r))}catch{}}
function engineInput(id){return document.getElementById(id)}
function setEngine(id,value){const el=engineInput(id);if(!el)return false;el.value=String(value);try{if(typeof el.oninput==='function')el.oninput();else el.dispatchEvent(new Event('input',{bubbles:true}))}catch{}return true}
function getEngine(id,fallback=0){const el=engineInput(id);const v=Number(el?.value);return Number.isFinite(v)?v:fallback}
function reloadQuality(next){if(!['low','medium','high'].includes(next)||next===currentQuality)return;const q=new URLSearchParams(location.search);q.set('quality',next);q.set('qv',String(Date.now()));location.assign(location.pathname+'?'+q.toString()+location.hash)}

let perfMemory={whitewater:.62,temporal:.24,volume:.30,vorticity:.72,hydro:.58,smoothing:3,realism:null};
try{Object.assign(perfMemory,JSON.parse(localStorage.getItem(PERF_KEY)||'null')||{})}catch{}
function savePerf(){try{localStorage.setItem(PERF_KEY,JSON.stringify(perfMemory))}catch{}}

// ----- definitive modal -----------------------------------------------------------------------
document.getElementById('fluidV5SettingsM73Style')?.remove();
const style=document.createElement('style');style.id='fluidV5SettingsM73Style';style.textContent=`
#settingsPanel.settings{position:fixed!important;z-index:100!important;top:max(82px,calc(env(safe-area-inset-top) + 68px))!important;right:max(10px,env(safe-area-inset-right))!important;bottom:max(72px,calc(env(safe-area-inset-bottom) + 58px))!important;left:max(10px,env(safe-area-inset-left))!important;width:auto!important;max-width:590px!important;margin-left:auto!important;height:auto!important;max-height:none!important;padding:0!important;overflow:hidden!important;display:flex!important;flex-direction:column!important;border-radius:16px!important;touch-action:auto!important}
#settingsPanel.settings.hidden{opacity:0!important;pointer-events:none!important;transform:translateY(-5px)!important}
#settingsPanel>:not(#v5M73Root):not(.settingsTitle){display:none!important}#settingsPanel>.settingsTitle{display:none!important}
#v5M73Root{display:flex!important;flex:1 1 auto;min-height:0;width:100%;height:100%;flex-direction:column;overflow:hidden}
#v5M73Header{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 12px 9px;background:rgba(5,20,27,.97);border-bottom:1px solid rgba(78,214,220,.18)}
.m73Title{font:800 11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.15em;color:#86f6ff}.m73Sub{margin-top:3px;font:7.5px/1.35 ui-monospace;color:#8fb0bd;letter-spacing:.04em}
#v5M73Close{appearance:none;width:34px;height:34px;flex:0 0 auto;border:1px solid rgba(78,214,220,.38);border-radius:999px;background:rgba(4,17,24,.92);color:#dffcff;font:900 16px ui-monospace;display:grid;place-items:center}
#v5M73Tabs{flex:0 0 auto;display:flex;gap:5px;padding:8px;overflow-x:auto;overflow-y:hidden;background:rgba(5,20,27,.93);border-bottom:1px solid rgba(78,214,220,.16);scrollbar-width:none;-webkit-overflow-scrolling:touch;touch-action:pan-x}#v5M73Tabs::-webkit-scrollbar{display:none}
.m73Tab{flex:0 0 auto;appearance:none;border:1px solid rgba(78,214,220,.30);border-radius:999px;background:rgba(4,17,24,.87);color:#9fc1cf;padding:8px 11px;font:800 8px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.05em;white-space:nowrap}.m73Tab.active{border-color:#f1ad43;color:#ffd890;background:rgba(77,54,17,.52)}
#v5M73Host{flex:1 1 auto;min-height:0;overflow:hidden;background:rgba(5,20,27,.82)}.m73Page{display:none;height:100%;overflow-y:auto;overflow-x:hidden;padding:10px 10px max(18px,calc(env(safe-area-inset-bottom) + 8px));-webkit-overflow-scrolling:touch;touch-action:pan-y;overscroll-behavior:contain}.m73Page.active{display:block}
.m73Intro{margin:0 0 10px;padding:8px 9px;border:1px solid rgba(78,214,220,.15);border-radius:10px;background:rgba(4,17,24,.58);font:7.5px/1.45 ui-monospace;color:#8fb0bd}.m73Section{margin-top:10px;padding-top:9px;border-top:1px solid rgba(78,214,220,.18)}.m73Section:first-of-type{margin-top:0;border-top:0;padding-top:0}.m73SectionTitle{font:800 9px ui-monospace;color:#86f6ff;letter-spacing:.11em;margin-bottom:7px}.m73Grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.m73Grid.two{grid-template-columns:repeat(2,1fr)}.m73Grid.four{grid-template-columns:repeat(4,1fr)}
.m73Btn,.m73Toggle{appearance:none;border:1px solid rgba(78,214,220,.34);background:rgba(4,17,24,.80);color:#dffcff;border-radius:9px;padding:9px 4px;font:800 8px ui-monospace;letter-spacing:.035em}.m73Btn.active,.m73Toggle.active{border-color:#f1ad43;color:#ffd890;background:rgba(77,54,17,.48)}.m73Toggle.off{color:#7897a4}.m73Row{display:grid;grid-template-columns:100px 1fr 48px;align-items:center;gap:7px;margin:8px 0}.m73Row label{font:7.5px ui-monospace;color:#b6d1dc}.m73Row input[type=range]{width:100%;accent-color:#69e8df}.m73Val{font:7.5px ui-monospace;text-align:right;color:#ffd890}.m73Note{font:7px/1.45 ui-monospace;color:#7897a4;margin-top:6px}.m73Status{padding:8px 9px;border:1px solid rgba(78,214,220,.14);border-radius:9px;background:rgba(4,17,24,.58);font:7.6px/1.5 ui-monospace;color:#9fc5d0;white-space:pre-line}.m73Perf{font:800 9px/1.55 ui-monospace;color:#9dffc8}.m73SwitchLine{display:grid;grid-template-columns:1fr 76px;gap:8px;align-items:center;margin:6px 0}.m73SwitchLabel{font:7.6px/1.35 ui-monospace;color:#b6d1dc}.m73SwitchLabel small{display:block;color:#7897a4;font-size:6.6px;margin-top:2px}
#v5Tabs,#v5TabHost{display:none!important}#v5PerfDetailM73{font-size:8px!important;line-height:1.35!important;margin-top:2px;color:#9fc1cf;text-align:right;white-space:nowrap}
@media(max-width:430px){.m73Grid.four{grid-template-columns:repeat(2,1fr)}.m73Row{grid-template-columns:86px 1fr 42px}.m73SwitchLine{grid-template-columns:1fr 70px}.m73Btn,.m73Toggle{font-size:7.5px}}
@media(min-width:700px){#settingsPanel.settings{left:auto!important;width:min(560px,calc(100vw - 24px))!important}}
`;
document.head.appendChild(style);

panel.querySelector('#v5M73Root')?.remove();
const root=document.createElement('div');root.id='v5M73Root';
const header=document.createElement('div');header.id='v5M73Header';header.innerHTML='<div><div class="m73Title">FLUID V5 · SETTINGS</div><div class="m73Sub">Quality, performance and simulation tuning</div></div><button id="v5M73Close" type="button" aria-label="Close settings">×</button>';
const tabbar=document.createElement('div');tabbar.id='v5M73Tabs';
const host=document.createElement('div');host.id='v5M73Host';root.append(header,tabbar,host);panel.prepend(root);
const defs=[['general','QUALITY','Quality and optional GPU workload.'],['scenes','SCENES','Choose the physical experiment.'],['physics','PHYSICS','PBF/XPBD dynamics and optional fluid-body effects.'],['water','WATER','Surface reconstruction and liquid optical material.'],['light','LIGHT','Exposure, sun, environment and caustic strength.'],['realism','REALISM','Secondary water and appearance effects.'],['camera','CAMERA','Camera reset, speed and underwater view.'],['debug','DEBUG','Render/debug modes and live engine telemetry.']];
const pages={};
function activate(key){if(!pages[key])key='general';for(const b of tabbar.children)b.classList.toggle('active',b.dataset.tab===key);for(const [k,p]of Object.entries(pages))p.classList.toggle('active',k===key);try{localStorage.setItem('fluidV5M73Tab',key)}catch{}}
for(const [key,label,desc]of defs){const b=document.createElement('button');b.type='button';b.className='m73Tab';b.dataset.tab=key;b.textContent=label;b.onclick=e=>{e.preventDefault();e.stopPropagation();activate(key)};tabbar.appendChild(b);const p=document.createElement('section');p.className='m73Page';p.dataset.page=key;p.innerHTML=`<div class="m73Intro">${desc}</div>`;host.appendChild(p);pages[key]=p}
let initial='general';try{const x=localStorage.getItem('fluidV5M73Tab');if(pages[x])initial=x}catch{}activate(initial);
header.querySelector('#v5M73Close').onclick=e=>{e.preventDefault();e.stopPropagation();panel.classList.add('hidden')};
panel.addEventListener('pointerdown',e=>e.stopPropagation());panel.addEventListener('click',e=>e.stopPropagation());panel.addEventListener('touchmove',e=>e.stopPropagation(),{passive:true});
function enforceLauncher(){settingsBtn.textContent='SETTINGS';settingsBtn.setAttribute('aria-label','Open settings');settingsBtn.title='Settings';settingsBtn.onclick=e=>{e.preventDefault();e.stopPropagation();panel.classList.toggle('hidden')}}
enforceLauncher();new MutationObserver(enforceLauncher).observe(settingsBtn,{childList:true,characterData:true,subtree:true});setInterval(enforceLauncher,1000);

function section(page,title){const s=document.createElement('div');s.className='m73Section';s.innerHTML=`<div class="m73SectionTitle">${title}</div>`;pages[page].appendChild(s);return s}
function button(label,onclick){const b=document.createElement('button');b.type='button';b.className='m73Btn';b.textContent=label;b.onclick=e=>{e.preventDefault();e.stopPropagation();onclick?.(b)};return b}
function toggle(parent,label,note,get,set){const row=document.createElement('div');row.className='m73SwitchLine';const l=document.createElement('div');l.className='m73SwitchLabel';l.innerHTML=`${label}<small>${note||''}</small>`;const b=document.createElement('button');b.type='button';b.className='m73Toggle';const sync=()=>{const on=!!get();b.textContent=on?'ON':'OFF';b.classList.toggle('active',on);b.classList.toggle('off',!on)};b.onclick=e=>{e.preventDefault();e.stopPropagation();set(!get());sync()};row.append(l,b);parent.appendChild(row);sync();return {row,b,sync}}
function slider(parent,label,min,max,step,get,set,fmt=v=>Number(v).toFixed(2)){const row=document.createElement('div');row.className='m73Row';const l=document.createElement('label');l.textContent=label;const r=document.createElement('input');r.type='range';r.min=min;r.max=max;r.step=step;const v=document.createElement('div');v.className='m73Val';const sync=()=>{const x=get();r.value=String(x);v.textContent=fmt(x)};r.oninput=e=>{e.stopPropagation();set(Number(r.value));sync()};row.append(l,r,v);parent.appendChild(row);sync();return{r,v,sync}}

// ----- GENERAL: quality + performance features ------------------------------------------------
const gQuality=section('general','QUALITY');const qgrid=document.createElement('div');qgrid.className='m73Grid';gQuality.appendChild(qgrid);
for(const [key,label]of[['low','LOW'],['medium','MED'],['high','HIGH']]){const b=button(label,()=>reloadQuality(key));b.classList.toggle('active',currentQuality===key);qgrid.appendChild(b)}
const qnote=document.createElement('div');qnote.className='m73Note';qnote.textContent='LOW ≈18K particles · MED ≈30K · HIGH ≈49K. Changing quality rebuilds the simulation so particle spacing and water volume stay consistent.';gQuality.appendChild(qnote);
const gPerf=section('general','PERFORMANCE FEATURES');
const perfStatus=document.createElement('div');perfStatus.className='m73Status m73Perf';gPerf.appendChild(perfStatus);
const getStateBool=k=>!!state()?.[k];
const saveAuto=v=>{const s=state();if(!s)return;s.autoQuality=!!v;saveState();try{localStorage.setItem('fluidV5AutoQualityV1',v?'1':'0')}catch{}};
const toggles=[];
toggles.push(toggle(gPerf,'AUTO QUALITY','Automatically steps quality down/up from sustained measured FPS.',()=>getStateBool('autoQuality'),saveAuto));
toggles.push(toggle(gPerf,'WHITEWATER / FOAM','Secondary spray/foam/bubble GPU pass. Physics mass is unchanged.',()=>Number(state()?.whitewater||0)>.002,v=>{const s=state();if(!s)return;if(v)s.whitewater=Math.max(.05,Number(perfMemory.whitewater)||.62);else{if(Number(s.whitewater)>0)perfMemory.whitewater=Number(s.whitewater);s.whitewater=0}saveState();savePerf()}));
toggles.push(toggle(gPerf,'TEMPORAL HISTORY','Extra full-screen temporal accumulation render pass.',()=>Number(realism()?.temporal||0)>.005,v=>{const r=realism();if(!r)return;if(v)r.temporal=Math.max(.05,Number(perfMemory.temporal)||.24);else{if(Number(r.temporal)>0)perfMemory.temporal=Number(r.temporal);r.temporal=0}saveRealism();savePerf()}));
toggles.push(toggle(gPerf,'REALISM SHADER FX','Micro ripples, dispersion, wet line, edge foam, shadow and scattering.',()=>{const r=realism();return !!r&&(r.micro+r.dispersion+r.wet+r.foam+r.shadow+r.scattering)>.02},v=>{const r=realism();if(!r)return;const keys=['micro','dispersion','wet','foam','shadow','scattering'];if(v){const mem=perfMemory.realism||{micro:.34,dispersion:.42,wet:.58,foam:.24,shadow:.82,scattering:.34};for(const k of keys)r[k]=Number(mem[k])||0}else{perfMemory.realism={};for(const k of keys){perfMemory.realism[k]=Number(r[k])||0;r[k]=0}}saveRealism();savePerf()}));
toggles.push(toggle(gPerf,'VOLUMETRIC SHAFTS','Volumetric caustic-light contribution.',()=>Number(realism()?.volume||0)>.005,v=>{const r=realism();if(!r)return;if(v)r.volume=Math.max(.05,Number(perfMemory.volume)||.30);else{if(Number(r.volume)>0)perfMemory.volume=Number(r.volume);r.volume=0}saveRealism();savePerf()}));
toggles.push(toggle(gPerf,'SURFACE SMOOTHING','SSFR filter iterations; OFF uses the minimum single pass.',()=>Number(window.__ssfr?.filterIterations||1)>1,v=>{const ss=window.__ssfr;if(!ss)return;if(v)ss.filterIterations=Math.max(2,Number(perfMemory.smoothing)||3);else{if(Number(ss.filterIterations)>1)perfMemory.smoothing=Number(ss.filterIterations);ss.filterIterations=1}const el=engineInput('ssfriters');if(el){el.value=String(ss.filterIterations);el.dispatchEvent(new Event('input',{bubbles:true}))}savePerf()}));
toggles.push(toggle(gPerf,'GPU VORTICITY','Extra two-pass vorticity confinement compute. Disable for speed.',()=>Number(state()?.vorticity||0)>.002,v=>{const s=state();if(!s)return;if(v)s.vorticity=Math.max(.05,Number(perfMemory.vorticity)||.72);else{if(Number(s.vorticity)>0)perfMemory.vorticity=Number(s.vorticity);s.vorticity=0}saveState();savePerf()}));
toggles.push(toggle(gPerf,'BODY HYDRO','Two-way rigid-body drag/wake compute when a body exists.',()=>Number(state()?.hydroDrag||0)>.002,v=>{const s=state();if(!s)return;if(v)s.hydroDrag=Math.max(.05,Number(perfMemory.hydro)||.58);else{if(Number(s.hydroDrag)>0)perfMemory.hydro=Number(s.hydroDrag);s.hydroDrag=0}saveState();savePerf()}));
const profiles=document.createElement('div');profiles.className='m73Grid';profiles.style.marginTop='9px';gPerf.appendChild(profiles);
function setFeature(label,on){const item=toggles.find(t=>t.row.querySelector('.m73SwitchLabel')?.textContent.startsWith(label));if(item&&!!item.b.classList.contains('active')!==on)item.b.click()}
profiles.append(button('FAST',()=>{setFeature('WHITEWATER',false);setFeature('TEMPORAL',false);setFeature('REALISM',false);setFeature('VOLUMETRIC',false);setFeature('SURFACE',false);setFeature('GPU VORTICITY',false);setFeature('BODY HYDRO',false)}),button('BALANCED',()=>{setFeature('WHITEWATER',true);setFeature('TEMPORAL',false);setFeature('REALISM',true);setFeature('VOLUMETRIC',false);setFeature('SURFACE',true);setFeature('GPU VORTICITY',true);setFeature('BODY HYDRO',true)}),button('FULL',()=>{for(const t of toggles.slice(1))if(!t.b.classList.contains('active'))t.b.click()}));

// ----- SCENES ----------------------------------------------------------------------------------
const sc=section('scenes','PHYSICAL EXPERIMENT');const scgrid=document.createElement('div');scgrid.className='m73Grid';sc.appendChild(scgrid);
const sceneDefs=[['pool','POOL'],['wave','WAVE TANK'],['rain','RAIN'],['pour','POUR'],['dam','DAM BREAK'],['drain','DRAIN'],['faucet','FAUCET'],['waterfall','WATERFALL'],['paddle','PADDLE'],['whirlpool','WHIRLPOOL'],['fountain','FOUNTAIN'],['gravity-pour-m71','GRAVITY POUR']];
const sceneBtns=[];
function chooseScene(name){
 const s=state();
 if(name==='gravity-pour-m71'&&typeof window.__v5GravityPourM71?.activate==='function'){window.__v5GravityPourM71.activate('M7.3 SETTINGS');return}
 const base=document.querySelector(`#v5Lab [data-scenario="${name}"]`);if(base){base.click();return}
 const adv=document.querySelector(`#v5ScenariosM46 [data-m46="${name}"]`);if(adv){adv.click();return}
 if(!s)return;s.scenario=name;saveState();if(window.__ui)window.__ui.pouring=false;
 if(name==='wave'){const w=document.getElementById('v4WaveToggle');if(w&&!w.classList.contains('active'))w.click()}else{const w=document.getElementById('v4WaveToggle');if(w?.classList.contains('active'))w.click()}
 document.getElementById('reset')?.click();
}
for(const [key,label]of sceneDefs){const b=button(label,()=>chooseScene(key));b.dataset.scene=key;scgrid.appendChild(b);sceneBtns.push(b)}
const scStatus=document.createElement('div');scStatus.className='m73Status';scStatus.style.marginTop='8px';sc.appendChild(scStatus);

// ----- PHYSICS ---------------------------------------------------------------------------------
const ph=section('physics','PBF / XPBD');
toggle(ph,'ADAPTIVE SOLVER','CFL/stress controller raises numerical work only when the water needs it.',()=>state()?.physicsAuto!==false,v=>{const s=state();if(!s)return;s.physicsAuto=!!v;saveState()});
slider(ph,'VORTICITY',0,1.5,.05,()=>Number(state()?.vorticity??.72),v=>{const s=state();if(!s)return;s.vorticity=v;if(v>0)perfMemory.vorticity=v;saveState();savePerf()});
slider(ph,'BODY HYDRO',0,1.25,.05,()=>Number(state()?.hydroDrag??.58),v=>{const s=state();if(!s)return;s.hydroDrag=v;if(v>0)perfMemory.hydro=v;saveState();savePerf()});
const phStatus=document.createElement('div');phStatus.className='m73Status';ph.appendChild(phStatus);

// ----- WATER -----------------------------------------------------------------------------------
const wa=section('water','LIQUID MATERIAL / SSFR');
slider(wa,'IOR',1.0,1.6,.005,()=>getEngine('ior',window.__ssfr?.ior??1.333),v=>{if(!setEngine('ior',v)&&window.__ssfr)window.__ssfr.ior=v},v=>Number(v).toFixed(3));
slider(wa,'ABSORPTION',0,.9,.01,()=>getEngine('absorption',window.__ssfr?.absorption??.425),v=>{if(!setEngine('absorption',v)&&window.__ssfr)window.__ssfr.absorption=v});
slider(wa,'ROUGHNESS',.008,.14,.002,()=>getEngine('roughness',window.__ssfr?.roughness??.048),v=>{if(!setEngine('roughness',v)&&window.__ssfr)window.__ssfr.roughness=v},v=>Number(v).toFixed(3));
slider(wa,'THICKNESS',.04,.55,.005,()=>getEngine('ssfrthick',window.__ssfr?.thicknessScale??.19),v=>{if(!setEngine('ssfrthick',v)&&window.__ssfr)window.__ssfr.thicknessScale=v},v=>Number(v).toFixed(3));
slider(wa,'SMOOTH PASSES',1,5,1,()=>Number(window.__ssfr?.filterIterations||getEngine('ssfriters',3)),v=>{if(window.__ssfr)window.__ssfr.filterIterations=Math.round(v);setEngine('ssfriters',Math.round(v));if(v>1)perfMemory.smoothing=Math.round(v);savePerf()},v=>String(Math.round(v)));

// ----- LIGHT -----------------------------------------------------------------------------------
const li=section('light','LIGHTING / ENVIRONMENT');
slider(li,'EXPOSURE',.8,2.2,.02,()=>getEngine('exposure',1.53),v=>setEngine('exposure',v));
slider(li,'SUN POWER',.5,7,.05,()=>getEngine('sunint',4.375),v=>setEngine('sunint',v));
slider(li,'SUN ANGLE',8,70,1,()=>getEngine('sunelev',23),v=>setEngine('sunelev',v),v=>`${Math.round(v)}°`);
slider(li,'SUN AZIMUTH',-180,180,2,()=>getEngine('sunazim',43),v=>setEngine('sunazim',v),v=>`${Math.round(v)}°`);
slider(li,'HDR ENV',.35,1.8,.02,()=>getEngine('envintensity',1),v=>setEngine('envintensity',v));
slider(li,'CAUSTICS',0,2,.02,()=>getEngine('groundrefl',1),v=>setEngine('groundrefl',v));

// ----- REALISM ---------------------------------------------------------------------------------
const re=section('realism','SECONDARY / REALISM');
slider(re,'WHITEWATER',0,1.5,.05,()=>Number(state()?.whitewater??.62),v=>{const s=state();if(!s)return;s.whitewater=v;if(v>0)perfMemory.whitewater=v;saveState();savePerf()});
slider(re,'MICRO RIPPLE',0,1.25,.02,()=>Number(realism()?.micro??.34),v=>{if(realism()){realism().micro=v;saveRealism()}});
slider(re,'LIGHT SHAFT',0,1.25,.02,()=>Number(realism()?.volume??.30),v=>{if(realism()){realism().volume=v;if(v>0)perfMemory.volume=v;saveRealism();savePerf()}});
slider(re,'DISPERSION',0,1.25,.02,()=>Number(realism()?.dispersion??.42),v=>{if(realism()){realism().dispersion=v;saveRealism()}});
slider(re,'EDGE FOAM',0,1.25,.02,()=>Number(realism()?.foam??.24),v=>{if(realism()){realism().foam=v;saveRealism()}});
slider(re,'SCATTER',0,1.25,.02,()=>Number(realism()?.scattering??.34),v=>{if(realism()){realism().scattering=v;saveRealism()}});
slider(re,'TEMPORAL',0,1.0,.02,()=>Number(realism()?.temporal??.24),v=>{if(realism()){realism().temporal=v;if(v>0)perfMemory.temporal=v;saveRealism();savePerf()}});

// ----- CAMERA ----------------------------------------------------------------------------------
const ca=section('camera','CAMERA');const cgrid=document.createElement('div');cgrid.className='m73Grid two';ca.appendChild(cgrid);
cgrid.append(button('RESET CAMERA',()=>document.getElementById('resetcam')?.click()),button('TOP / POOL VIEW',()=>{const c=window.__cam,s=window.__sim;if(!c||!s)return;c.az=-.72;c.el=.49;c.dist=4.15;c.target=[s.params.box[0]*.5,s.params.box[1]*.30,s.params.box[2]*.5]}));
slider(ca,'CAM SPEED',.1,3,.05,()=>getEngine('camspeed',1),v=>setEngine('camspeed',v));
toggle(ca,'UNDERWATER VIEW','Moves the camera into the pool without changing the fluid.',()=>!!state()?.underwater,v=>{const s=state(),c=window.__cam,sim=window.__sim;if(!s||!c||!sim)return;s.underwater=!!v;saveState();if(v){window.__m73SavedCam={az:c.az,el:c.el,dist:c.dist,target:[...c.target]};c.az=-.54;c.el=-.17;c.dist=Math.min(sim.params.box[0],sim.params.box[2])*.55;c.target=[sim.params.box[0]*.52,sim.params.box[1]*.17,sim.params.box[2]*.52]}else if(window.__m73SavedCam){Object.assign(c,{az:window.__m73SavedCam.az,el:window.__m73SavedCam.el,dist:window.__m73SavedCam.dist});c.target=[...window.__m73SavedCam.target]}});

// ----- DEBUG -----------------------------------------------------------------------------------
const de=section('debug','RENDER MODE');const dgrid=document.createElement('div');dgrid.className='m73Grid';de.appendChild(dgrid);
const debugModes=[['final','FINAL'],['particles','PARTICLES'],['surface','SURFACE'],['velocity','VELOCITY'],['normals','NORMALS'],['depth','DEPTH'],['thickness','THICKNESS']];const dbgBtns=[];
function setDebug(mode){const s=state(),ui=window.__ui,ss=window.__ssfr;if(!s||!ui||!ss)return;s.debug=mode;window.__v5DebugMode=mode;saveState();ss.debug=0;if(mode==='particles')ui.display=0;else if(mode==='surface')ui.display=1;else if(mode==='velocity'){ui.display=0;ui.speedMax=4}else{ui.display=3;if(mode==='normals')ss.debug=1;if(mode==='depth')ss.debug=2;if(mode==='thickness')ss.debug=3}}
for(const [key,label]of debugModes){const b=button(label,()=>setDebug(key));b.dataset.debug=key;dgrid.appendChild(b);dbgBtns.push(b)}
const dbgStatus=document.createElement('div');dbgStatus.className='m73Status';dbgStatus.style.marginTop='8px';de.appendChild(dbgStatus);

// ----- direct rAF performance measurement ------------------------------------------------------
async function installPerf(){const start=performance.now();while((!window.__sim||!document.getElementById('v4fps'))&&performance.now()-start<30000)await sleep(50);const old=document.getElementById('v4fps');if(!old)return;const n=old.cloneNode(false);n.id='v4fps';n.textContent='-- FPS';old.replaceWith(n);let d=document.getElementById('v5PerfDetailM73');d?.remove();d=document.createElement('div');d.id='v5PerfDetailM73';d.className='status';n.insertAdjacentElement('afterend',d);let last=0,ms=0,frames=0;function tick(ts){if(last){const dt=ts-last;if(dt>0&&dt<500){ms+=dt;frames++}}last=ts;if(ms>=600&&frames){const fps=frames*1000/ms,frameMs=ms/frames,sim=window.__sim;const sub=Number(sim?.lastSubsteps||sim?.params?.substeps||0),iter=Number(sim?.params?.iterations||0),rate=fps*sub;n.textContent=`${fps.toFixed(1)} FPS`;d.textContent=`${frameMs.toFixed(1)} ms · ${sub||'--'} sub · ${iter||'--'} iter · ~${rate?Math.round(rate):'--'} sub/s`;window.__v5PerfM73={online:true,fps,frameMs,substeps:sub,iterations:iter,substepsPerSecond:rate,source:'direct-rAF'};ms=0;frames=0}requestAnimationFrame(tick)}requestAnimationFrame(tick)}
installPerf();

function sync(){
 const s=state(),sim=window.__sim,p=window.__v5PerfM73,ss=window.__ssfr;
 for(const b of sceneBtns)b.classList.toggle('active',b.dataset.scene===s?.scenario);
 scStatus.textContent=`ACTIVE: ${String(s?.scenario||'loading').toUpperCase()}\nPrimary fluid: ${(sim?.scene?.nFluid||sim?.n||0).toLocaleString()} · total PBF: ${(sim?.n||0).toLocaleString()}`;
 const sub=Number(sim?.lastSubsteps||sim?.params?.substeps||0),it=Number(sim?.params?.iterations||0),speed=Number(sim?.stats?.maxSpeed||0),rho=Number(sim?.stats?.maxRho||0);
 phStatus.textContent=`Current solve: ${sub||'--'} substeps · ${it||'--'} iterations\nmax speed ${speed.toFixed(2)} m/s · max density ${rho.toFixed(3)}× rest`;
 const pressure=window.__v5Workload?.pressure;perfStatus.textContent=`${p?.fps?.toFixed?.(1)||'--'} FPS · ${p?.frameMs?.toFixed?.(1)||'--'} ms/frame\n${sub||'--'} sub · ${it||'--'} iter · ${p?.substepsPerSecond?Math.round(p.substepsPerSecond):'--'} solver substeps/s\n${currentQuality.toUpperCase()} · ${(sim?.n||0).toLocaleString()} PBF · SSFR ${ss?.renderScale?Math.round(ss.renderScale*100)+'%':'--'}${Number.isFinite(pressure)?' · load '+Math.round(pressure*100)+'%':''}`;
 for(const t of toggles)t.sync();for(const b of dbgBtns)b.classList.toggle('active',b.dataset.debug===(s?.debug||'final'));
 dbgStatus.textContent=`render=${s?.debug||'final'} · physics=${window.__v5PhysicsM40?.online?'online':'loading'} · surface=${window.__v5SurfaceM42?.online?'online':'loading'}\nwhitewater=${window.__v5WhitewaterM69?.online||window.__v5WhitewaterM41?.online?'online':'loading'} · microdrops=${window.__v5MicroDropsM69?.online||window.__v5MicroDropsM59?.online?'online':'loading'}`;
}
setInterval(sync,350);sync();

function stamp(){document.title='Fluid V5 · M7.3 Physical Water';const b=document.querySelector('.hud.card.title');if(b)b.textContent='FLUID V5 · M7.3';const l=document.querySelector('#loading h2');if(l)l.textContent='FLUID V5 · M7.3';window.__fluidV5Version='7.3';window.__fluidV5Build='M7.3 NATIVE SETTINGS + DIRECT PERFORMANCE'}
stamp();setInterval(stamp,1000);
window.__v5SettingsM73={online:true,version:'M7.3',activate,pages:Object.keys(pages)};
console.info('[Fluid V5 M7.3] native quality/performance/settings controller online.');
