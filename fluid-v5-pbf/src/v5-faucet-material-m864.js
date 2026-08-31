// Fluid V8 M8.6.4 — reference-matched clear/glassy water tuning on frozen M8.6.1 physics.
// Appearance-only update: clearer thin paths, smoother SSFR reconstruction, cleaner Fresnel/specular,
// restrained micro-normal noise, and lighter optical thickness. Zero extra GPU passes/submits.

const sim=window.__sim,ssfr=window.__ssfr;
const faucet=window.__v5M861Faucet||window.__v5M852Faucet;
const realism=window.__fluidV44Realism;
if(!sim||!ssfr||!faucet?.online||!window.__v5M746Realism?.online||!realism)
  throw new Error('M8.6.4 material: M8.6.1 + realism composite unavailable.');

const quality={minScale:.38,maxScale:.56,scale:.45,filterIterations:2};
let rafEMA=50,stable=0;

function applyMaterial(){
  // Clear tap/pool water: thin paths remain nearly colourless, while long paths acquire
  // a soft cyan-blue depth tint through transmission/absorption rather than a surface coating.
  ssfr.ior=1.333;
  ssfr.transmit=[.965,.987,.997];
  ssfr.absorption=.205;
  ssfr.roughness=.012;
  ssfr.exposure=1.015;
  ssfr.groundReflection=.070;

  // Crisp daylight highlight and a slightly stronger neutral environment reflection.
  ssfr.sunIntensity=2.28;
  ssfr.sunElevation=48;
  ssfr.sunAzimuth=30;
  if(ssfr.env){
    ssfr.env.intensity=1.13;
    ssfr.env.yaw=.07;
  }

  // Keep the surface alive without the high-frequency oily/noisy look. Whitewater is nearly
  // absent for the faucet reference; dispersion/scattering remain physically subtle.
  realism.micro=.085;
  realism.dispersion=.032;
  realism.scattering=.060;
  realism.foam=.010;
  realism.shafts=.055;
  realism.shadow=0;
}

function applySurface(){
  ssfr.renderScale=quality.scale;
  ssfr.splatRadius=1.13;
  ssfr.filter=1;
  ssfr.filterIterations=quality.filterIterations;
  ssfr.filterSigma=.45;
  ssfr.narrowDelta=10.2;
  ssfr.narrowMu=.91;
  ssfr.bilateralRange=1.34;
  ssfr.cleanupPass=true;
  ssfr.cleanupRadius=2;

  // Reduce the gel-like body thickness and tighten the thickness blur so the stream reads as
  // a continuous clear sheet with crisp edges instead of a soft translucent tube.
  ssfr.thicknessRadius=1.08;
  ssfr.thicknessScale=.68;
  ssfr.thicknessFilterSize=3;
  ssfr.thicknessHalfRes=true;
  ssfr.bindCache=null;
}

function apply(){applyMaterial();applySurface();}
apply();setTimeout(apply,220);setTimeout(apply,700);

// M8.6.1 restores its lightweight SSFR profile periodically. Reassert only appearance uniforms
// after each step; faucet/PBF inlet behavior stays frozen and bit-for-bit owned by M8.6.1.
const previousStep=sim.step.bind(sim);
sim.step=function(dt){
  const out=previousStep(dt);
  apply();
  return out;
};

// Mobile/iOS cadence protection. Preserve the reference material; only reconstruction resolution
// and the second smoothing iteration scale with available RAF headroom.
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
      quality.filterIterations=2;
    }else if(rafEMA>=50){
      quality.scale=Math.min(quality.maxScale,quality.scale+.010);
      quality.filterIterations=2;
    }else if(rafEMA<39){
      quality.scale=Math.max(quality.minScale,quality.scale-.020);
      quality.filterIterations=1;
    }else if(rafEMA<45){
      quality.scale=Math.max(quality.minScale,quality.scale-.010);
      quality.filterIterations=1;
    }else{
      quality.filterIterations=quality.scale>=.43?2:1;
    }
  }
  apply();
},1000);

// Compact validation readout in the Water tab.
const tabs=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
if(tabs&&host){
  const idx=[...tabs.children].findIndex(b=>b.dataset.key==='water');
  const page=idx>=0?host.children[idx]:null;
  if(page){
    document.getElementById('m864MaterialStatus')?.remove();
    const box=document.createElement('div');box.id='m864MaterialStatus';box.className='m742Section';
    box.innerHTML='<div class="m742SectionTitle">M8.6.4 · REFERENCE CLEAR WATER</div><div class="m742Note">Clearer thin-path transmission, lower roughness, tighter SSFR silhouette, reduced optical thickness, calmer micro normals and restrained foam/scattering. Physics remains frozen at M8.6.1.</div>';
    const st=document.createElement('div');st.className='m742Status';st.style.marginTop='10px';
    st.textContent='IOR 1.333 · transmit .965 / .987 / .997 · absorption .205\nroughness .012 · optical thickness .68 · SSFR radius 1.13\nmicro .085 · dispersion .032 · scatter .060 · foam .010\nzero added passes/submits';
    box.appendChild(st);page.appendChild(box);
  }
}

const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.6.4';
document.title='Fluid V8 · M8.6.4 Reference Clear Water';
window.__v5M864Material={
  online:true,backend:'reference-clear-glassy-water-m864',gpuPassesAdded:0,gpuSubmitsAdded:0,
  quality,get scale(){return quality.scale},get rafEMA(){return rafEMA}
};
window.__fluidV5Version='8.6.4';
window.__fluidV5Build='M8.6.4 REFERENCE CLEAR/GLASSY WATER / M8.6.1 PHYSICS FROZEN / REALISM COMPOSITE';
console.info('[Fluid V8 M8.6.4] reference clear/glassy water tuning online; physics unchanged.');
