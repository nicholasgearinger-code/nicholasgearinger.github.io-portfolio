// Fluid V8 M8.6.3 — physically clearer tap-water material on frozen M8.6.1 physics.
// Uses the existing M7.4.6 realism composite shader: no extra render pass, no extra queue submit.
// This module changes only material/reconstruction/light uniforms and restrained realism controls.

const sim=window.__sim,ssfr=window.__ssfr;
const faucet=window.__v5M861Faucet||window.__v5M852Faucet;
const realism=window.__fluidV44Realism;
if(!sim||!ssfr||!faucet?.online||!window.__v5M746Realism?.online||!realism)
  throw new Error('M8.6.3 material: M8.6.1 + realism composite unavailable.');

const quality={minScale:.36,maxScale:.50,scale:.39,filterIterations:1};
let rafEMA=48,stable=0;

function applyMaterial(){
  // Thin tap water should be almost colourless. Cyan should appear mainly through long
  // optical paths in the basin, not as a blue coating on the falling jet.
  ssfr.ior=1.333;
  ssfr.transmit=[.92,.972,.995];
  ssfr.absorption=.30;
  ssfr.roughness=.018;
  ssfr.exposure=1.00;
  ssfr.groundReflection=.055;

  // Neutral daylight / HDR balance. Keep the highlight crisp without bleaching the jet.
  ssfr.sunIntensity=2.10;
  ssfr.sunElevation=47;
  ssfr.sunAzimuth=31;
  if(ssfr.env){
    ssfr.env.intensity=1.07;
    ssfr.env.yaw=.08;
  }

  // Restrained realism: enough micro-normal breakup to avoid a plastic cylinder, while
  // keeping the faucet stream smooth. Dispersion/scatter are intentionally subtle.
  realism.micro=.14;
  realism.dispersion=.055;
  realism.scattering=.105;
  realism.foam=.025;
  realism.shafts=.075;
  realism.shadow=0;
}

function applySurface(){
  ssfr.renderScale=quality.scale;
  ssfr.splatRadius=1.22;
  ssfr.filter=1;
  ssfr.filterIterations=quality.filterIterations;
  ssfr.filterSigma=.54;
  ssfr.narrowDelta=9.4;
  ssfr.narrowMu=.88;
  ssfr.bilateralRange=1.55;
  ssfr.cleanupPass=true;
  ssfr.cleanupRadius=2;

  // M8.6.2 used a very heavy optical-thickness scale (2.55), which made the water read
  // like translucent gel. Bring thickness back near the earlier clear-pool calibration.
  ssfr.thicknessRadius=1.18;
  ssfr.thicknessScale=.84;
  ssfr.thicknessFilterSize=5;
  ssfr.thicknessHalfRes=true;
  ssfr.bindCache=null;
}

function apply(){applyMaterial();applySurface();}
apply();setTimeout(apply,220);setTimeout(apply,700);

// M8.6.1 periodically restores its lightweight reconstruction profile. Reassert the
// material layer after each physics step so the inlet/PBF behavior remains completely frozen.
const previousStep=sim.step.bind(sim);
sim.step=function(dt){
  const out=previousStep(dt);
  apply();
  return out;
};

// Protect mobile cadence. Material realism stays enabled; only SSFR pixel density and the
// second smoothing iteration move with headroom.
setInterval(()=>{
  if(faucet.active!=='faucet')return;
  const raf=Number(faucet.raf)||0;
  if(raf<=0){apply();return;}
  rafEMA=rafEMA*.72+raf*.28;
  stable++;
  if(stable>=2){
    stable=0;
    if(rafEMA>=57){
      quality.scale=Math.min(quality.maxScale,quality.scale+.015);
      quality.filterIterations=quality.scale>=.46?2:1;
    }else if(rafEMA>=50){
      quality.scale=Math.min(quality.maxScale,quality.scale+.01);
      quality.filterIterations=1;
    }else if(rafEMA<40){
      quality.scale=Math.max(quality.minScale,quality.scale-.02);
      quality.filterIterations=1;
    }else if(rafEMA<46){
      quality.scale=Math.max(quality.minScale,quality.scale-.01);
      quality.filterIterations=1;
    }
  }
  apply();
},1000);

// Add a compact material readout to the Water tab if available.
const tabs=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
if(tabs&&host){
  const idx=[...tabs.children].findIndex(b=>b.dataset.key==='water');
  const page=idx>=0?host.children[idx]:null;
  if(page){
    document.getElementById('m863MaterialStatus')?.remove();
    const box=document.createElement('div');box.id='m863MaterialStatus';box.className='m742Section';
    box.innerHTML='<div class="m742SectionTitle">M8.6.3 · CLEAR TAP WATER</div><div class="m742Note">Nearly colourless thin-path transmission, low roughness, restrained micro-normal detail, subtle dispersion/scattering and clear-pool optical thickness. Physics remains M8.6.1.</div>';
    const st=document.createElement('div');st.className='m742Status';st.style.marginTop='10px';
    st.textContent='IOR 1.333 · transmit .92 / .97 / 1.00 · absorption .30\nroughness .018 · optical thickness .84\nmicro .14 · dispersion .06 · scatter .11 · zero added passes/submits';
    box.appendChild(st);page.appendChild(box);
  }
}

const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.6.3';
document.title='Fluid V8 · M8.6.3 Clear Tap Water';
window.__v5M863Material={
  online:true,backend:'realism-composite-clear-tap-material-m863',gpuPassesAdded:0,gpuSubmitsAdded:0,
  quality,get scale(){return quality.scale},get rafEMA(){return rafEMA}
};
window.__fluidV5Version='8.6.3';
window.__fluidV5Build='M8.6.3 CLEAR TAP WATER MATERIAL / M8.6.1 PHYSICS FROZEN / REALISM COMPOSITE';
console.info('[Fluid V8 M8.6.3] clear tap-water material + restrained realism composite online; physics unchanged.');
