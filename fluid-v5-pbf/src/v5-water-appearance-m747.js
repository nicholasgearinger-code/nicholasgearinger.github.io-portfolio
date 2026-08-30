// Fluid V5 M7.4.7 — water-body optical appearance controls.
// This module changes ONLY existing SSFR material uniforms and M7.4.6 realism parameters.
// It creates no GPU passes, command encoders or queue submissions.

const ssfr=window.__ssfr;
const realism=window.__fluidV44Realism;
if(!ssfr||!realism||!window.__v5M746Realism?.online)
  throw new Error('M7.4.7 water appearance: M7.4.6 realism runtime unavailable.');

const looks={
  POOL:{
    transmit:[0.27,0.66,0.91], absorption:0.58, roughness:0.032, thickness:0.82,
    scattering:0.18, dispersion:0.10, foam:0.08, shafts:0.12, micro:0.22,
    note:'Clear chlorinated pool: high transmission, low turbidity, bright cyan/blue water.'
  },
  POND:{
    transmit:[0.34,0.55,0.24], absorption:1.18, roughness:0.075, thickness:1.02,
    scattering:0.62, dispersion:0.04, foam:0.05, shafts:0.10, micro:0.30,
    note:'Murky green pond: stronger green transmission plus high scattering/turbidity.'
  },
  OCEAN:{
    transmit:[0.08,0.38,0.78], absorption:1.42, roughness:0.048, thickness:1.16,
    scattering:0.34, dispersion:0.14, foam:0.18, shafts:0.26, micro:0.38,
    note:'Deep ocean blue: red/yellow light attenuates rapidly while blue penetrates farther.'
  },
  TROPICAL:{
    transmit:[0.20,0.74,0.96], absorption:0.74, roughness:0.040, thickness:0.90,
    scattering:0.24, dispersion:0.12, foam:0.12, shafts:0.22, micro:0.30,
    note:'Clear shallow tropical water: turquoise transmission with moderate sun scatter.'
  }
};

let active='POOL';
const state={
  tint:[...looks.POOL.transmit], absorption:looks.POOL.absorption,
  roughness:looks.POOL.roughness, thickness:looks.POOL.thickness,
  turbidity:looks.POOL.scattering
};

function clamp(v,a,b){return Math.min(b,Math.max(a,v))}
function applyState(){
  ssfr.transmit=[clamp(state.tint[0],0.01,1),clamp(state.tint[1],0.01,1),clamp(state.tint[2],0.01,1)];
  ssfr.absorption=clamp(state.absorption,0.05,2.5);
  ssfr.roughness=clamp(state.roughness,0.005,0.20);
  ssfr.thicknessScale=clamp(state.thickness,0.45,1.8);
  realism.scattering=clamp(state.turbidity,0,1.25);
}
function applyPreset(name){
  const p=looks[name];if(!p)return;
  active=name;
  state.tint=[...p.transmit];state.absorption=p.absorption;state.roughness=p.roughness;state.thickness=p.thickness;state.turbidity=p.scattering;
  realism.dispersion=p.dispersion;realism.foam=p.foam;realism.shafts=p.shafts;realism.micro=p.micro;
  applyState();sync(true);
}

const tabbar=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
let page=null;
if(tabbar&&host){const tabs=[...tabbar.children];const idx=tabs.findIndex(b=>b.dataset.key==='water');if(idx>=0)page=host.children[idx]||null;}
let status=null;const inputs={};
function row(parent,label,min,max,step,get,set){
  const r=document.createElement('div');r.className='m742Row';
  const l=document.createElement('label');l.textContent=label;
  const i=document.createElement('input');i.type='range';i.min=min;i.max=max;i.step=step;i.value=get();
  const v=document.createElement('div');v.className='m742Val';v.textContent=Number(get()).toFixed(2);
  i.oninput=e=>{e.stopPropagation();active='CUSTOM';set(Number(i.value));v.textContent=Number(get()).toFixed(2);applyState();sync()};
  r.append(l,i,v);parent.appendChild(r);return {i,v,get};
}
function sync(refresh=false){
  if(refresh){for(const k of Object.keys(inputs)){const x=inputs[k];x.i.value=x.get();x.v.textContent=Number(x.get()).toFixed(2)}}
  if(status){
    const note=looks[active]?.note||'Custom optical water material.';
    status.textContent=`WATER LOOK ${active} · zero extra GPU passes/submits\ntransmit RGB ${state.tint.map(v=>v.toFixed(2)).join(' / ')} · absorption ${state.absorption.toFixed(2)}\nroughness ${state.roughness.toFixed(3)} · optical depth ${state.thickness.toFixed(2)} · turbidity ${state.turbidity.toFixed(2)}\n${note}`;
  }
}

if(page){
  const sec=document.createElement('div');sec.className='m742Section';
  sec.innerHTML='<div class="m742SectionTitle">WATER BODY APPEARANCE · M7.4.7</div>';
  const grid=document.createElement('div');grid.className='m742Grid';
  for(const name of ['POOL','POND','OCEAN','TROPICAL']){
    const b=document.createElement('button');b.className='m742Btn';b.textContent=name;
    b.onclick=e=>{e.preventDefault();e.stopPropagation();applyPreset(name)};grid.appendChild(b);
  }
  sec.appendChild(grid);
  const note=document.createElement('div');note.className='m742Note';
  note.textContent='These presets change the actual SSFR transmission/absorption balance, surface roughness, optical path thickness and the existing M7.4.6 scattering controls. They are not a flat screen-space color filter.';
  sec.appendChild(note);
  inputs.r=row(sec,'TRANSMIT RED',0.01,1,.01,()=>state.tint[0],v=>state.tint[0]=v);
  inputs.g=row(sec,'TRANSMIT GREEN',0.01,1,.01,()=>state.tint[1],v=>state.tint[1]=v);
  inputs.b=row(sec,'TRANSMIT BLUE',0.01,1,.01,()=>state.tint[2],v=>state.tint[2]=v);
  inputs.a=row(sec,'ABSORPTION',0.05,2.5,.01,()=>state.absorption,v=>state.absorption=v);
  inputs.t=row(sec,'TURBIDITY / SCATTER',0,1.25,.01,()=>state.turbidity,v=>state.turbidity=v);
  inputs.ro=row(sec,'SURFACE ROUGHNESS',0.005,.20,.005,()=>state.roughness,v=>state.roughness=v);
  inputs.d=row(sec,'OPTICAL DEPTH',0.45,1.8,.01,()=>state.thickness,v=>state.thickness=v);
  page.appendChild(sec);status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';page.appendChild(status);
}

applyPreset('POOL');
window.__v5M747WaterLook={online:true,backend:'existing-ssfr-material-only',gpuPassesAdded:0,gpuSubmitsAdded:0,looks,state,get active(){return active},applyPreset};
window.__fluidV5Version='7.4.7';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V5 · M7.4.7';
document.title='Fluid V5 · M7.4.7 Water Bodies';
console.info('[Fluid V5 M7.4.7] water-body optical presets online; zero extra GPU passes/submits.');
