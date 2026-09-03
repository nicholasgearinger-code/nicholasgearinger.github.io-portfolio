// Fluid V5 M7.1.7 — modal restyle for the proven live tab shell.
// Do not rebuild or move controls. The existing v5-tabs UI already owns the live DOM and handlers;
// this module only restyles it into a phone-friendly settings modal and keeps the launcher labeled SETTINGS.

const panel=document.getElementById('settingsPanel');
if(!panel)throw new Error('Fluid V5 M7.1.7 settings: #settingsPanel unavailable.');

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let tabs=null,host=null;
for(let i=0;i<160;i++){
 tabs=document.getElementById('v5Tabs');
 host=document.getElementById('v5TabHost');
 if(tabs&&host&&host.querySelector('[data-panel]'))break;
 await sleep(50);
}

const style=document.createElement('style');
style.id='fluidV5SettingsModalM717Style';
style.textContent=`
#settingsPanel.settings{
 position:fixed!important;z-index:80!important;
 top:max(82px,calc(env(safe-area-inset-top) + 68px))!important;
 right:max(10px,env(safe-area-inset-right))!important;
 bottom:max(72px,calc(env(safe-area-inset-bottom) + 58px))!important;
 left:max(10px,env(safe-area-inset-left))!important;
 width:auto!important;max-width:560px!important;margin-left:auto!important;
 max-height:none!important;height:auto!important;padding:0!important;
 display:flex!important;flex-direction:column!important;overflow:hidden!important;
 border-radius:16px!important;touch-action:auto!important;
}
#settingsPanel.settings.hidden{opacity:0!important;pointer-events:none!important;transform:translateY(-5px)!important;}
#settingsPanel>.settingsTitle{display:none!important;}
#v5Settings717Header{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 11px 8px;background:rgba(5,20,27,.96);border-bottom:1px solid rgba(78,214,220,.18)}
.v5Settings717Title{font:800 11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;color:#86f6ff}.v5Settings717Sub{margin-top:3px;font:7.4px/1.35 ui-monospace;color:#8fb0bd;letter-spacing:.04em}
#v5Settings717Close{appearance:none;width:34px;height:34px;flex:0 0 auto;border:1px solid rgba(78,214,220,.38);border-radius:999px;background:rgba(4,17,24,.92);color:#dffcff;font:900 16px ui-monospace;display:grid;place-items:center}
#v5Tabs{flex:0 0 auto!important;display:flex!important;gap:5px!important;padding:8px!important;overflow-x:auto!important;overflow-y:hidden!important;background:rgba(5,20,27,.92)!important;border-bottom:1px solid rgba(78,214,220,.16)!important;scrollbar-width:none!important;-webkit-overflow-scrolling:touch!important;touch-action:pan-x!important;overscroll-behavior-x:contain!important}
#v5Tabs::-webkit-scrollbar{display:none!important}
#v5Tabs .v5Tab{flex:0 0 auto!important;padding:8px 10px!important;font-size:8px!important;white-space:nowrap!important}
#v5TabHost{flex:1 1 auto!important;min-height:0!important;display:block!important;overflow:hidden!important;background:rgba(5,20,27,.80)!important}
#v5TabHost .v5TabPanel{height:100%!important;min-height:0!important;max-height:none!important;overflow-y:auto!important;overflow-x:hidden!important;padding:10px 10px max(18px,calc(env(safe-area-inset-bottom) + 8px))!important;-webkit-overflow-scrolling:touch!important;touch-action:pan-y!important;overscroll-behavior:contain!important}
#v5TabHost .v5TabPanel:not(.active){display:none!important}
#v5TabHost .v5TabPanel.active{display:block!important}
#v5TabHost .v5TabPanel>*{max-width:100%!important;box-sizing:border-box!important}
@media(min-width:700px){#settingsPanel.settings{left:auto!important;width:min(540px,calc(100vw - 24px))!important}}
`;
document.getElementById(style.id)?.remove();document.head.appendChild(style);

document.getElementById('v5Settings717Header')?.remove();
const header=document.createElement('div');header.id='v5Settings717Header';
header.innerHTML='<div><div class="v5Settings717Title">FLUID V5 · SETTINGS</div><div class="v5Settings717Sub">Live controls · one category at a time</div></div><button id="v5Settings717Close" type="button" aria-label="Close settings">×</button>';
panel.prepend(header);
header.querySelector('#v5Settings717Close').onclick=e=>{e.preventDefault();e.stopPropagation();panel.classList.add('hidden')};

function enforceLauncher(){
 const b=document.getElementById('settingsBtn');
 if(!b)return;
 if(b.textContent!=='SETTINGS')b.textContent='SETTINGS';
 b.setAttribute('aria-label','Open settings');
 b.title='Settings';
}
function stamp(){
 const t=document.querySelector('.hud.card.title');if(t&&t.textContent!=='FLUID V5 · M7.1.7')t.textContent='FLUID V5 · M7.1.7';
 window.__fluidV5SettingsUI='M7.1.7 LIVE TABBED MODAL';
}
enforceLauncher();stamp();
const launcherObserver=new MutationObserver(()=>enforceLauncher());
const sb=document.getElementById('settingsBtn');if(sb)launcherObserver.observe(sb,{childList:true,characterData:true,subtree:true});
setInterval(()=>{enforceLauncher();stamp();},350);

// If the established tab shell did not mount, report that explicitly rather than presenting an empty modal.
if(!(tabs&&host&&host.querySelector('[data-panel]'))){
 const fail=document.createElement('div');
 fail.style.cssText='padding:16px;color:#ffb5b5;font:9px/1.5 ui-monospace';
 fail.textContent='SETTINGS UI ERROR · live tab shell did not mount. Simulation controls were left untouched.';
 panel.appendChild(fail);
 console.error('[Fluid V5 M7.1.7] established v5Tabs/v5TabHost shell unavailable.');
}else{
 console.info('[Fluid V5 M7.1.7] existing live tab shell restyled as mobile settings modal.');
}
window.__v5SettingsModalM717={online:true,version:'M7.1.7',tabsFound:!!tabs,hostFound:!!host,livePanels:host?.querySelectorAll('[data-panel]').length||0};
