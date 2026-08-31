// Fluid V8 M8.5.6 — conservative free-jet coherence tune on M8.5.5.
// Preserve the successful 10.5K / 25 mm / 60 Hz profile and inlet flux. Only add a
// small amount of XSPH damping plus slightly broader SSFR overlap so the accelerating
// free jet can thin without visually/physically separating into beads.

const sim=window.__sim,ssfr=window.__ssfr,faucet=window.__v5M852Faucet,high=window.__v5M853High,gentle=window.__v5M855Gentle;
if(!sim||!ssfr||!faucet?.online||!high?.online||!gentle?.online)throw new Error('M8.5.6 tune: M8.5.5 faucet runtime unavailable.');

function apply(){
  // Mild velocity smoothing: enough to suppress transverse particle noise, well below the
  // M8.5.4 values that caused clumping/branching.
  if(sim.params){
    sim.params.xsphC=.052;
    sim.params.sCorrK=.031;
    sim.params.surfaceTensionK=.074;
    sim.params.substeps=2;
    sim.params.iterations=3;
  }

  // Increase only reconstruction overlap. This does not add a pass or change particle motion.
  // Keep the adaptive render scale from M8.5.3; only the kernel footprint becomes a little wider.
  if(high.profile){
    high.profile.splat=1.21;
    high.profile.filterSigma=.63;
    high.profile.thicknessRadius=1.21;
  }
  ssfr.splatRadius=1.21;
  ssfr.filterSigma=.63;
  ssfr.thicknessRadius=1.21;
  ssfr.bindCache=null;
}

apply();
setTimeout(apply,250);
setInterval(()=>{
  if(faucet.active==='faucet')apply();
},500);

window.__v5M856Cohesion={
  online:true,backend:'conservative-xsph-plus-ssfr-overlap-m856',
  xsph:.052,scorr:.031,tension:.074,splat:1.21,
};
window.__fluidV5Version='8.5.6';
window.__fluidV5Build='M8.5.6 CONSERVATIVE FREE-JET COHERENCE / M8.5.5 60HZ BASELINE';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.5.6';
document.title='Fluid V8 · M8.5.6 Coherent Faucet';
console.info('[Fluid V8 M8.5.6] conservative free-jet coherence tune online.');
