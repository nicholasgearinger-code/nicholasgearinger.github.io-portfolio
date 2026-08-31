// Fluid V8 M8.6.7 — native-resolution SSFR reconstruction on frozen M8.6.1 faucet physics.
// Locks the water surface and thickness buffers at full resolution, removing all adaptive
// resolution scaling while preserving the M8.6.6 reference-water material and one-submit path.
// Appearance/reconstruction only: zero added GPU passes/submits and no faucet/PBF changes.

const sim=window.__sim,ssfr=window.__ssfr;
const faucet=window.__v5M861Faucet||window.__v5M852Faucet;
const realism=window.__fluidV44Realism;
if(!sim||!ssfr||!faucet?.online||!window.__v5M746Realism?.online||!realism)
  throw new Error('M8.6.7 material: M8.6.1 + realism composite unavailable.');

const quality={scale:1.0,filterIterations:2,locked:true};

function applyMaterial(){
  ssfr.ior=1.333;
  ssfr.transmit=[.50,.75,.92];
  ssfr.absorption=.88;
  ssfr.roughness=.036;
  ssfr.exposure=1.02;
  ssfr.groundReflection=.15;

  ssfr.sunIntensity=3.00;
  ssfr.sunElevation=45;
  ssfr.sunAzimuth=32;
  if(ssfr.env){
    ssfr.env.intensity=1.20;
    ssfr.env.yaw=.05;
  }

  realism.micro=.075;
  realism.dispersion=.040;
  realism.scattering=.22;
  realism.foam=.012;
  realism.shafts=.085;
  realism.shadow=0;
}

function applySurface(){
  // Native resolution. No adaptive scaler and no mobile fallback below 1.0x.
  ssfr.renderScale=1.0;

  // At native resolution we can tighten the splat footprint slightly while preserving
  // overlap, which gives smoother contours and finer refraction detail without blockiness.
  ssfr.splatRadius=1.24;
  ssfr.filter=2;
  ssfr.filterIterations=2;
  ssfr.filterSigma=.56;
  ssfr.narrowDelta=9.8;
  ssfr.narrowMu=.97;
  ssfr.bilateralRange=1.34;
  ssfr.cleanupPass=true;
  ssfr.cleanupRadius=2;

  // Thickness is also native resolution. Keeping filter size below 4 additionally prevents
  // the upstream half-resolution path even if another module toggles thicknessHalfRes later.
  ssfr.thicknessRadius=1.05;
  ssfr.thicknessScale=2.20;
  ssfr.thicknessFilterSize=3;
  ssfr.thicknessHalfRes=false;
  ssfr.bindCache=null;
}

function apply(){applyMaterial();applySurface();}
apply();setTimeout(apply,180);setTimeout(apply,500);setTimeout(apply,1100);

// M8.6.1 still owns faucet/PBF behavior and has its own legacy visual governor. Bracket every
// simulation step so the native-resolution M8.6.7 reconstruction always wins before rendering.
const previousStep=sim.step.bind(sim);
sim.step=function(dt){
  apply();
  const out=previousStep(dt);
  apply();
  return out;
};

// Reassert only; this is NOT an adaptive quality loop. Resolution remains fixed at 1.0x.
setInterval(apply,1000);

const tabs=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
if(tabs&&host){
  const idx=[...tabs.children].findIndex(b=>b.dataset.key==='water');
  const page=idx>=0?host.children[idx]:null;
  if(page){
    document.getElementById('m867MaterialStatus')?.remove();
    const box=document.createElement('div');box.id='m867MaterialStatus';box.className='m742Section';
    box.innerHTML='<div class="m742SectionTitle">M8.6.7 · NATIVE-RES WATER</div><div class="m742Note">SSFR surface and thickness are locked at 100% native resolution. Adaptive downscaling is removed completely; the reference blue-water material and M8.6.1 faucet physics are unchanged.</div>';
    const st=document.createElement('div');st.className='m742Status';st.style.marginTop='10px';
    st.textContent='SSFR 100% LOCKED · full-res thickness\nfilter mode 2 × 2 · radius 1.24 · thickness 2.20\nIOR 1.333 · roughness .036 · scatter .22\nresolution governor OFF · zero added passes/submits';
    box.appendChild(st);page.appendChild(box);
  }
}

const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.6.7';
document.title='Fluid V8 · M8.6.7 Native-Resolution Water';
window.__v5M867Material={
  online:true,backend:'native-resolution-full-thickness-ssfr-m867',gpuPassesAdded:0,gpuSubmitsAdded:0,
  quality,get scale(){return 1.0}
};
window.__fluidV5Version='8.6.7';
window.__fluidV5Build='M8.6.7 NATIVE-RES FULL-THICKNESS SSFR / M8.6.1 PHYSICS FROZEN / REFERENCE BODY WATER';
console.info('[Fluid V8 M8.6.7] native-resolution full-thickness SSFR locked at 1.0x; physics unchanged.');
