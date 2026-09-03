// Fluid V5 M7.4.0 settings safety layer.
// Reuses the native tabbed M7.3 controller, but only exposes controls that are backed by modules
// compatible with the one-command-buffer iOS architecture.

await import('./v5-settings-controller-m73.js');
const state=window.__v5State,ssfr=window.__ssfr;
const root=document.getElementById('v5M73Root');
if(!root)throw new Error('M7.4 settings: tabbed controller unavailable.');

function brand(){
  document.title='Fluid V5 · M7.4 Unified Features';
  const b=document.querySelector('.hud.card.title');if(b)b.textContent='FLUID V5 · M7.4';
  const h=document.querySelector('#loading h2');if(h)h.textContent='FLUID V5 · M7.4';
  const t=root.querySelector('.m73Title');if(t)t.textContent='FLUID V5 · SETTINGS';
  const s=root.querySelector('.m73Sub');if(s)s.textContent='Unified iOS frame · live controls · one GPU submit per frame';
  window.__fluidV5Version='7.4.0';window.__fluidV5Build='M7.4 UNIFIED FEATURE RESTORE';
}
brand();setInterval(brand,900);

const note=(text,color='#8fb0bd')=>{const d=document.createElement('div');d.className='m73Status';d.style.marginTop='9px';d.style.color=color;d.textContent=text;return d};
function lockSwitch(prefix,why){
  for(const row of root.querySelectorAll('.m73SwitchLine')){
    const l=row.querySelector('.m73SwitchLabel');if(!l||!l.textContent.trim().startsWith(prefix))continue;
    const b=row.querySelector('.m73Toggle');if(b){b.disabled=true;b.textContent='LOCKED';b.classList.remove('active');b.classList.add('off');b.style.opacity='.55';b.title=why;}
    const sm=l.querySelector('small');if(sm)sm.textContent=why;
  }
}
lockSwitch('GPU VORTICITY','Locked in M7.4 until this pass is encoded into the unified frame.');
lockSwitch('BODY HYDRO','Locked in M7.4 until rigid hydro is encoded into the unified frame.');
lockSwitch('TEMPORAL HISTORY','Legacy V4.4 Blob shader is disabled on iOS; Surface 2.0 temporal is available under REALISM.');
lockSwitch('REALISM SHADER FX','Legacy runtime-Blob shader path is disabled; M7.4 uses stable V4.3 physical optics.');
lockSwitch('VOLUMETRIC SHAFTS','Held for the next unified-pass restore.');
if(state){state.vorticity=0;state.hydroDrag=0;state.xpbdDensity=0;}

// Physics page: leave adaptive PBF available, but lock sliders whose compute modules are absent.
for(const row of root.querySelectorAll('.m73Page[data-page="physics"] .m73Row')){
  const label=row.querySelector('label')?.textContent?.trim();
  if(label==='VORTICITY'||label==='BODY HYDRO'){
    const r=row.querySelector('input');if(r){r.disabled=true;r.style.opacity='.38';}
    row.title='Pending unified compute-pass port';
  }
}
const physicsPage=root.querySelector('.m73Page[data-page="physics"]');
physicsPage?.append(note('CORE PBF ACTIVE · adaptive substeps/iterations remain live. Vorticity, XPBD post-density and rigid hydro are deliberately locked because their old implementations issued additional GPU command buffers.','#9dffc8'));

// Gravity Pour's old seed/spillway path still submits independently. Keep the button visible so the
// feature is not lost, but prevent accidentally reintroducing the iOS stall until it is ported.
for(const b of root.querySelectorAll('.m73Page[data-page="scenes"] .m73Btn')){
  if(b.textContent.trim()==='GRAVITY POUR'){
    b.disabled=true;b.textContent='GRAVITY POUR · PORTING';b.style.opacity='.52';
    b.title='Will return after its seed/gate compute is moved into the M7.4 unified frame.';
  }
}
root.querySelector('.m73Page[data-page="scenes"]')?.append(note('Pool, Wave Tank, Rain, Pour, Dam Break, Drain, Faucet, Waterfall, Paddle, Whirlpool and Fountain are restored. Gravity Pour remains visible but locked until its GPU seed/gate pass is unified.'));

// Replace the old V4.4-only REALISM content with controls that are truly live in this build.
const realismPage=root.querySelector('.m73Page[data-page="realism"]');
if(realismPage){
  [...realismPage.querySelectorAll('.m73Section')].forEach(x=>x.remove());
  const sec=document.createElement('div');sec.className='m73Section';sec.innerHTML='<div class="m73SectionTitle">UNIFIED REALISM</div>';
  const mkSlider=(label,min,max,step,get,set,fmt=v=>Number(v).toFixed(2))=>{
    const row=document.createElement('div');row.className='m73Row';
    const l=document.createElement('label');l.textContent=label;const r=document.createElement('input');r.type='range';r.min=min;r.max=max;r.step=step;
    const val=document.createElement('div');val.className='m73Val';const sync=()=>{r.value=String(get());val.textContent=fmt(get())};
    r.oninput=e=>{e.stopPropagation();set(Number(r.value));sync()};row.append(l,r,val);sec.append(row);sync();
  };
  mkSlider('WHITEWATER',0,1.2,.04,()=>Number(state?.whitewater||0),v=>{if(state)state.whitewater=v});
  mkSlider('SURF TEMP',0,1,.05,()=>Number(state?.surfaceTemporal||0),v=>{if(state)state.surfaceTemporal=v});
  mkSlider('SMOOTHING',1,4,1,()=>Number(ssfr?.filterIterations||1),v=>{if(ssfr)ssfr.filterIterations=Math.round(v)},v=>String(Math.round(v)));
  mkSlider('ROUGHNESS',.015,.16,.005,()=>Number(ssfr?.roughness||.05),v=>{if(ssfr)ssfr.roughness=v});
  mkSlider('ABSORB',.15,1.2,.02,()=>Number(ssfr?.absorption||.5),v=>{if(ssfr)ssfr.absorption=v});
  realismPage.append(sec);
  realismPage.append(note('ACTIVE NOW: anisotropic Surface 2.0, physical SSFR optics/caustics, propagating ripples and unified whitewater. Advanced V4.4 dispersion/wet-line/scattering and volumetric shafts will return as static unified passes—no runtime Blob modules.','#9dffc8'));
}

// Rewire performance presets so none of them can turn locked compute systems back on.
const general=root.querySelector('.m73Page[data-page="general"]');
if(general){
  const buttons=[...general.querySelectorAll('.m73Btn')];
  const byText=t=>buttons.find(b=>b.textContent.trim()===t);
  const white=()=>[...root.querySelectorAll('.m73SwitchLine')].find(r=>r.querySelector('.m73SwitchLabel')?.textContent.startsWith('WHITEWATER'))?.querySelector('.m73Toggle');
  const smooth=()=>[...root.querySelectorAll('.m73SwitchLine')].find(r=>r.querySelector('.m73SwitchLabel')?.textContent.startsWith('SURFACE SMOOTHING'))?.querySelector('.m73Toggle');
  const setBtn=(b,fn)=>{if(!b)return;b.onclick=e=>{e.preventDefault();e.stopPropagation();fn()}};
  setBtn(byText('FAST'),()=>{if(white()?.classList.contains('active'))white().click();if(smooth()?.classList.contains('active'))smooth().click();if(state)state.whitewater=0;if(ssfr)ssfr.filterIterations=1;});
  setBtn(byText('BALANCED'),()=>{if(!white()?.classList.contains('active'))white()?.click();if(!smooth()?.classList.contains('active'))smooth()?.click();if(state)state.whitewater=Math.max(.22,Number(state.whitewater)||0);if(ssfr)ssfr.filterIterations=Math.max(2,ssfr.filterIterations||2);});
  setBtn(byText('FULL'),()=>{if(!white()?.classList.contains('active'))white()?.click();if(!smooth()?.classList.contains('active'))smooth()?.click();if(state)state.whitewater=.62;if(ssfr)ssfr.filterIterations=3;});
  general.append(note('M7.4 profiles only change unified-safe work. Locked multi-submit systems stay OFF even in FULL.'));
}

window.__v5SettingsM740={online:true,backend:'native-tabs-unified-safe-m740'};
console.info('[Fluid V5 M7.4] tabbed settings restored with unsafe passes locked.');
