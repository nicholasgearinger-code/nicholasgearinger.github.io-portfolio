// Fluid V8 M8.6.6 — high-resolution SSFR reconstruction on frozen M8.6.1 faucet physics.
// Fixes the visible mobile pixelation from M8.6.5 by keeping the primary surface map high-res,
// forcing thickness to full resolution, tightening splats/filters, and retaining the reference blue body.
// Appearance/reconstruction only: zero added GPU passes/submits and no faucet/PBF changes.

const sim=window.__sim,ssfr=window.__ssfr;
const faucet=window.__v5M861Faucet||window.__v5M852Faucet;
const realism=window.__fluidV44Realism;
if(!sim||!ssfr||!faucet?.online||!window.__v5M746Realism?.online||!realism)
  throw new Error('M8.6.6 material: M8.6.1 + realism composite unavailable.');

// Resolution is now the priority. M8.6.5 started at 0.56 and could fall to 0.44,
// which is visibly blocky on high-DPI phones. Keep a much higher floor.
const quality={minScale:.62,maxScale:.90,scale:.78,filterIterations:2};
let rafEMA=52,stable=0;

function applyMaterial(){
  // Preserve the denser reference-water body from M8.6.5, with slightly cleaner transmission.
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

  // Keep normal breakup subtle so higher resolution produces smooth glassy sheets,
  // not higher-resolution noise.
  realism.micro=.075;
  realism.dispersion=.040;
  realism.scattering=.22;
  realism.foam=.012;
  realism.shafts=.085;
  realism.shadow=0;
}

function applySurface(){
  ssfr.renderScale=quality.scale;

  // Smaller than M8.6.5's 1.42: enough overlap for continuity without making the
  // silhouette look like enlarged square/round splats after upscaling.
  ssfr.splatRadius=1.28;
  ssfr.filter=2;
  ssfr.filterIterations=quality.filterIterations;
  ssfr.filterSigma=.60;
  ssfr.narrowDelta=9.6;
  ssfr.narrowMu=.96;
  ssfr.bilateralRange=1.42;
  ssfr.cleanupPass=true;
  ssfr.cleanupRadius=2;

  // Critical pixelation fix: full-resolution thickness. In the upstream renderer,
  // half-res is only entered when thicknessHalfRes=true AND filter size >=4.
  ssfr.thicknessRadius=1.06;
  ssfr.thicknessScale=2.20;
  ssfr.thicknessFilterSize=3;
  ssfr.thicknessHalfRes=false;
  ssfr.bindCache=null;
}

function apply(){applyMaterial();applySurface();}
apply();setTimeout(apply,180);setTimeout(apply,500);setTimeout(apply,1100);

// M8.6.1 owns physics and periodically reasserts its lightweight visual profile.
// Bracket every simulation step so M8.6.6 always wins the reconstruction state.
const previousStep=sim.step.bind(sim);
sim.step=function(dt){
  apply();
  const out=previousStep(dt);
  apply();
  return out;
};

// Mobile/iOS scaler: degrade resolution gradually, but never return to the visibly pixelated
// 0.44–0.56 range. Keep two filter iterations except under sustained severe pressure.
setInterval(()=>{
  if(faucet.active!=='faucet')return;
  const raf=Number(faucet.raf)||0;
  if(raf<=0){apply();return;}
  rafEMA=rafEMA*.72+raf*.28;
  stable++;
  if(stable>=2){
    stable=0;
    if(rafEMA>=58){
      quality.scale=Math.min(quality.maxScale,quality.scale+.020);
      quality.filterIterations=2;
    }else if(rafEMA>=52){
      quality.scale=Math.min(quality.maxScale,quality.scale+.010);
      quality.filterIterations=2;
    }else if(rafEMA<36){
      quality.scale=Math.max(quality.minScale,quality.scale-.025);
      quality.filterIterations=1;
    }else if(rafEMA<43){
      quality.scale=Math.max(quality.minScale,quality.scale-.015);
      quality.filterIterations=2;
    }else{
      quality.filterIterations=2;
    }
  }
  apply();
},1000);

const tabs=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
if(tabs&&host){
  const idx=[...tabs.children].findIndex(b=>b.dataset.key==='water');
  const page=idx>=0?host.children[idx]:null;
  if(page){
    document.getElementById('m866MaterialStatus')?.remove();
    const box=document.createElement('div');box.id='m866MaterialStatus';box.className='m742Section';
    box.innerHTML='<div class="m742SectionTitle">M8.6.6 · HIGH-RES WATER</div><div class="m742Note">Pixelation fix: 78% starting SSFR resolution, 62% minimum mobile floor, full-resolution thickness, tighter splats and bilateral smoothing. The blue reference-water body remains; faucet physics is still M8.6.1.</div>';
    const st=document.createElement('div');st.className='m742Status';st.style.marginTop='10px';
    st.textContent='SSFR 78% start · 62–90% adaptive · full-res thickness\nfilter mode 2 × 2 · radius 1.28 · thickness 2.20\nIOR 1.333 · roughness .036 · scatter .22\nzero added passes/submits';
    box.appendChild(st);page.appendChild(box);
  }
}

const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.6.6';
document.title='Fluid V8 · M8.6.6 High-Resolution Water';
window.__v5M866Material={
  online:true,backend:'high-resolution-full-thickness-ssfr-m866',gpuPassesAdded:0,gpuSubmitsAdded:0,
  quality,get scale(){return quality.scale},get rafEMA(){return rafEMA}
};
window.__fluidV5Version='8.6.6';
window.__fluidV5Build='M8.6.6 HIGH-RES FULL-THICKNESS SSFR / M8.6.1 PHYSICS FROZEN / REFERENCE BODY WATER';
console.info('[Fluid V8 M8.6.6] high-resolution full-thickness SSFR online; physics unchanged.');
