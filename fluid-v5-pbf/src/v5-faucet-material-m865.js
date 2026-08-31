// Fluid V8 M8.6.5 — reference-bodied blue water on frozen M8.6.1 faucet physics.
// This deliberately moves away from the near-invisible M8.6.3/.4 tap-water tuning toward
// the user's reference: coherent blue body, broad glossy highlights, stronger refraction,
// smoother SSFR silhouette and meaningful optical thickness. Zero added GPU passes/submits.

const sim=window.__sim,ssfr=window.__ssfr;
const faucet=window.__v5M861Faucet||window.__v5M852Faucet;
const realism=window.__fluidV44Realism;
if(!sim||!ssfr||!faucet?.online||!window.__v5M746Realism?.online||!realism)
  throw new Error('M8.6.5 material: M8.6.1 + realism composite unavailable.');

const quality={minScale:.44,maxScale:.68,scale:.56,filterIterations:2};
let rafEMA=52,stable=0;

function applyMaterial(){
  // Reference-bodied water. These transmission coefficients intentionally attenuate red
  // much more than blue, while optical thickness is high enough for the basin to develop
  // a visible cyan-blue body. Thin jet edges remain translucent instead of opaque.
  ssfr.ior=1.333;
  ssfr.transmit=[.46,.72,.91];
  ssfr.absorption=.92;
  ssfr.roughness=.042;
  ssfr.exposure=1.02;
  ssfr.groundReflection=.16;

  // Broader, brighter daylight highlights like the reference rather than tiny razor glints.
  ssfr.sunIntensity=3.10;
  ssfr.sunElevation=45;
  ssfr.sunAzimuth=32;
  if(ssfr.env){
    ssfr.env.intensity=1.22;
    ssfr.env.yaw=.05;
  }

  // Let depth scattering supply body colour while keeping micro-normal noise controlled.
  realism.micro=.10;
  realism.dispersion=.045;
  realism.scattering=.24;
  realism.foam=.015;
  realism.shafts=.09;
  realism.shadow=0;
}

function applySurface(){
  ssfr.renderScale=quality.scale;
  // Larger depth splats close particle-sized pinholes and make the faucet read as one sheet.
  ssfr.splatRadius=1.42;
  ssfr.filter=2;
  ssfr.filterIterations=quality.filterIterations;
  ssfr.filterSigma=.76;
  ssfr.narrowDelta=8.8;
  ssfr.narrowMu=.92;
  ssfr.bilateralRange=1.85;
  ssfr.cleanupPass=true;
  ssfr.cleanupRadius=3;

  // Restore meaningful optical depth. M8.6.4 used 0.68 and therefore looked almost absent;
  // this stays below the upstream 3.0 default but is intentionally much closer to it.
  ssfr.thicknessRadius=1.05;
  ssfr.thicknessScale=2.35;
  ssfr.thicknessFilterSize=4;
  ssfr.thicknessHalfRes=true;
  ssfr.bindCache=null;
}

function apply(){applyMaterial();applySurface();}
apply();setTimeout(apply,220);setTimeout(apply,700);

// Reassert before and after the M8.6.1 step. M8.6.1 owns the physics but also has a legacy
// one-second visual governor; bracketing the step makes the M8.6.5 surface profile deterministic.
const previousStep=sim.step.bind(sim);
sim.step=function(dt){
  apply();
  const out=previousStep(dt);
  apply();
  return out;
};

// Mobile/iOS guardrail: preserve the material/optical thickness and scale only map resolution.
setInterval(()=>{
  if(faucet.active!=='faucet')return;
  const raf=Number(faucet.raf)||0;
  if(raf<=0){apply();return;}
  rafEMA=rafEMA*.72+raf*.28;
  stable++;
  if(stable>=2){
    stable=0;
    if(rafEMA>=58){quality.scale=Math.min(quality.maxScale,quality.scale+.015);quality.filterIterations=2;}
    else if(rafEMA>=51){quality.scale=Math.min(quality.maxScale,quality.scale+.010);quality.filterIterations=2;}
    else if(rafEMA<37){quality.scale=Math.max(quality.minScale,quality.scale-.025);quality.filterIterations=1;}
    else if(rafEMA<44){quality.scale=Math.max(quality.minScale,quality.scale-.015);quality.filterIterations=1;}
    else quality.filterIterations=2;
  }
  apply();
},1000);

const tabs=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
if(tabs&&host){
  const idx=[...tabs.children].findIndex(b=>b.dataset.key==='water');
  const page=idx>=0?host.children[idx]:null;
  if(page){
    document.getElementById('m865MaterialStatus')?.remove();
    const box=document.createElement('div');box.id='m865MaterialStatus';box.className='m742Section';
    box.innerHTML='<div class="m742SectionTitle">M8.6.5 · REFERENCE BODY WATER</div><div class="m742Note">Deliberately denser than M8.6.4: blue depth transmission, 2.35× optical thickness, broad glossy highlights, larger SSFR splats and two-pass smoothing to match the supplied reference more closely. Faucet physics remains M8.6.1.</div>';
    const st=document.createElement('div');st.className='m742Status';st.style.marginTop='10px';
    st.textContent='IOR 1.333 · transmit .46 / .72 / .91 · absorption .92\nroughness .042 · optical thickness 2.35 · SSFR radius 1.42\nfilter mode 2 × 2 · scatter .24 · foam .015\nzero added passes/submits';
    box.appendChild(st);page.appendChild(box);
  }
}

const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.6.5';
document.title='Fluid V8 · M8.6.5 Reference Body Water';
window.__v5M865Material={
  online:true,backend:'reference-bodied-blue-water-m865',gpuPassesAdded:0,gpuSubmitsAdded:0,
  quality,get scale(){return quality.scale},get rafEMA(){return rafEMA}
};
window.__fluidV5Version='8.6.5';
window.__fluidV5Build='M8.6.5 REFERENCE BODY WATER / M8.6.1 PHYSICS FROZEN / REALISM COMPOSITE';
console.info('[Fluid V8 M8.6.5] reference-bodied blue water online; physics unchanged.');
