// Fluid V8 M8.5.7 — conservative quality bump on the proven M8.5.6 coherent faucet.
// Keep the successful M8.5.6 water/inlet physics unchanged. Spend available headroom only
// on reconstruction resolution: start the adaptive SSFR profile at 0.47 while preserving
// the M8.5.3 automatic fallback if RAF performance drops.

const sim=window.__sim, ssfr=window.__ssfr, faucet=window.__v5M852Faucet;
const high=window.__v5M853High, cohesion=window.__v5M856Cohesion;
if(!sim||!ssfr||!faucet?.online||!high?.online||!cohesion?.online)
  throw new Error('M8.5.7 quality: M8.5.6 coherent faucet runtime unavailable.');

function apply(){
  // Preserve the exact successful M8.5.6 coherence values.
  if(sim.params){
    sim.params.xsphC=.052;
    sim.params.sCorrK=.031;
    sim.params.surfaceTensionK=.074;
    sim.params.substeps=2;
    sim.params.iterations=3;
  }

  // Raise only render resolution. The existing M8.5.3 controller may still step downward
  // toward its original minimum when device RAF falls below target, protecting mobile FPS.
  if(high.profile){
    high.profile.scale=.47;
    high.profile.maxScale=.47;
  }
  ssfr.renderScale=.47;
  ssfr.bindCache=null;
}

apply();
setTimeout(apply,300);

window.__v5M857Quality={
  online:true,
  backend:'12k5-23mm-adaptive-ssfr-quality-m857',
  particles:12500,
  spacing:.023,
  initialRenderScale:.47,
  maxRenderScale:.47,
  xsph:.052,
  scorr:.031,
  tension:.074,
};
window.__fluidV5Version='8.5.7';
window.__fluidV5Build='M8.5.7 12.5K / 23MM QUALITY BUMP / M8.5.6 COHERENT FAUCET';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.5.7';
document.title='Fluid V8 · M8.5.7 Higher Resolution Faucet';
console.info('[Fluid V8 M8.5.7] 12.5K / 23 mm quality profile online; M8.5.6 physics preserved.');
