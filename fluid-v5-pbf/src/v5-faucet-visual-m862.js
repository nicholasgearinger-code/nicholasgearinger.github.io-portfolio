// Fluid V8 M8.6.2 — visual refinement on the proven M8.6.1 faucet.
// Physics/inlet are intentionally untouched. This module owns only SSFR material,
// reconstruction and lighting parameters after M8.6.1 has completed each simulation step.
// It adds no simulation pass and no queue submit.

const sim=window.__sim,ssfr=window.__ssfr,faucet=window.__v5M861Faucet||window.__v5M852Faucet;
if(!sim||!ssfr||!faucet?.online)throw new Error('M8.6.2 visual: M8.6.1 faucet runtime unavailable.');

const quality={
  minScale:.38,
  maxScale:.54,
  scale:.40,
  filterIterations:1,
  targetFps:48,
};
let rafEMA=50,stable=0;

function applyMaterial(){
  // Clear tap-water material: physically plausible IOR with lower roughness and gentler
  // absorption than the default blue pool preset. Keep enough blue-green transmission to
  // read depth in the basin without turning the falling jet opaque.
  ssfr.ior=1.333;
  ssfr.absorption=.72;
  ssfr.transmit=[.58,.79,.92];
  ssfr.roughness=.024;
  ssfr.exposure=1.03;
  ssfr.groundReflection=.10;

  // Lighting remains inexpensive: reuse the loaded 1K environment and existing sun term.
  ssfr.sunIntensity=2.45;
  ssfr.sunElevation=42;
  ssfr.sunAzimuth=34;
  if(ssfr.env){ssfr.env.intensity=1.12;}
}

function applySurface(){
  ssfr.renderScale=quality.scale;
  ssfr.splatRadius=1.24;
  ssfr.filter=1;
  ssfr.filterIterations=quality.filterIterations;
  ssfr.filterSigma=.58;
  ssfr.narrowDelta=8.5;
  ssfr.narrowMu=.92;
  ssfr.bilateralRange=1.75;
  ssfr.cleanupPass=true;
  ssfr.cleanupRadius=3;
  ssfr.thicknessRadius=1.23;
  ssfr.thicknessScale=2.55;
  ssfr.thicknessFilterSize=6;
  ssfr.thicknessHalfRes=true;
  ssfr.bindCache=null;
}

function apply(){applyMaterial();applySurface();}
apply();
setTimeout(apply,250);
setTimeout(apply,700);

// M8.6.1 reapplies its own lightweight visual profile periodically. Reassert this visual
// layer after every simulation step so the successful inlet/PBF path remains untouched.
const previousStep=sim.step.bind(sim);
sim.step=function(dt){
  const out=previousStep(dt);
  apply();
  return out;
};

// Adaptive visual quality. At constrained mobile rates, preserve the successful 38-40%
// reconstruction instead of sacrificing simulation cadence. When headroom returns, raise
// surface resolution first, then enable a second smoothing iteration.
setInterval(()=>{
  if(faucet.active!=='faucet')return;
  const raf=Number(faucet.raf)||0;
  if(raf<=0){apply();return;}
  rafEMA=rafEMA*.72+raf*.28;
  stable++;
  if(stable>=2){
    stable=0;
    if(rafEMA>=57){
      quality.scale=Math.min(quality.maxScale,quality.scale+.02);
      quality.filterIterations=quality.scale>=.48?2:1;
    }else if(rafEMA>=50){
      quality.scale=Math.min(quality.maxScale,quality.scale+.01);
      quality.filterIterations=1;
    }else if(rafEMA<42){
      quality.scale=Math.max(quality.minScale,quality.scale-.02);
      quality.filterIterations=1;
    }else if(rafEMA<47){
      quality.filterIterations=1;
    }
  }
  apply();
},1000);

// Make the HUD describe the visual layer without disturbing M8.6.1's telemetry panel.
const title=document.querySelector('.hud.card.title');
if(title)title.textContent='FLUID V8 · M8.6.2';
document.title='Fluid V8 · M8.6.2 Visual Faucet';
window.__v5M862Visual={
  online:true,
  backend:'clear-water-adaptive-ssfr-m862',
  gpuSubmitsAdded:0,
  quality,
  get scale(){return quality.scale},
  get rafEMA(){return rafEMA},
};
window.__fluidV5Version='8.6.2';
window.__fluidV5Build='M8.6.2 VISUAL REFINEMENT / M8.6.1 BCC PHYSICS FROZEN / ADAPTIVE SSFR';
console.info('[Fluid V8 M8.6.2] clear-water adaptive SSFR visual layer online; M8.6.1 physics unchanged.');
