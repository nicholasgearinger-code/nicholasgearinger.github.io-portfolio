// Fluid V8 M8.5.10 — anisotropic faucet reconstruction on M8.5.9.
// Keep the proven M8.5.6 PBF/inlet physics. Improve only the existing upstream anisotropy
// calculation so a sparse accelerating free jet is reconstructed as a continuous elongated
// water column instead of a chain of round particle splats. No extra GPU pass/submission.

const sim=window.__sim,ssfr=window.__ssfr,mesh=window.__mesh,faucet=window.__v5M852Faucet;
const hd=window.__v5M859HDCoherent;
if(!sim||!ssfr||!mesh||!faucet?.online||!hd?.online)
  throw new Error('M8.5.10 anisotropy: M8.5.9 coherent HD runtime unavailable.');

const tune={
  ratio:5.6,
  stretch:2.45,
  minNeighbours:11,
  lambda:.78,
  radiusScale:2.0,
  ks:1.08,
  splat:1.20,
  thickness:1.23,
};

function preservePhysics(){
  if(!sim.params)return;
  sim.params.xsphC=.052;
  sim.params.sCorrK=.031;
  sim.params.surfaceTensionK=.074;
  sim.params.substeps=2;
  sim.params.iterations=3;
}

function apply(){
  preservePhysics();

  // The default upstream threshold is 25 neighbours. A narrow faucet jet often has fewer,
  // so it falls back to an isotropic sphere exactly where visible axial gaps appear.
  // Lowering only that threshold lets the existing covariance solve engage in the stream.
  mesh.anisoRatio=tune.ratio;
  mesh.anisoStretch=tune.stretch;
  mesh.anisoMinNeighbours=tune.minNeighbours;
  mesh.anisoLambda=tune.lambda;
  mesh.anisoRadiusScale=tune.radiusScale; // keep the same cell-search radius/cost
  mesh.anisoKs=tune.ks;

  // Keep overall radius conservative. Anisotropy supplies longitudinal overlap instead of
  // simply making every particle fatter in all directions.
  ssfr.splatRadius=tune.splat;
  ssfr.thicknessRadius=tune.thickness;
  ssfr.bindCache=null;
}

apply();
setTimeout(apply,250);
setInterval(()=>{if(faucet.active==='faucet')apply()},750);

window.__v5M8510Aniso={
  online:true,
  backend:'thin-jet-covariance-anisotropy-m8510',
  tune,
};
window.__fluidV5Version='8.5.10';
window.__fluidV5Build='M8.5.10 ANISOTROPIC COHERENT JET / M8.5.9 HD / M8.5.6 PBF';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.5.10';
document.title='Fluid V8 · M8.5.10 Anisotropic Stream';
console.info('[Fluid V8 M8.5.10] thin-jet anisotropic SSFR tuning online; zero added passes/submits.');
