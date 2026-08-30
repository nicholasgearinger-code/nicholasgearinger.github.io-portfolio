// Fluid V5 M7.4.9 — restore the missing V4 pool reflection environment.
// M7.4.8 correctly restored the pool transmission, tiled liner, caustics and material values,
// but it did not reload the neutral quarry_cloudy HDR used by the original V4 clear-pool look.
// Without that cubemap, steep/grazing dam-break surfaces reflect the upstream saturated blue
// fallback sky and therefore appear like a second dark-blue water material.
//
// This module changes only the existing SSFR environment resource/bind group. It adds no
// per-frame render/compute pass and no feature queue.submit call.

const ssfr=window.__ssfr;
if(!ssfr?.env||!window.__v5M748PoolMaterial?.online||!window.__v5M739Unified?.online){
  throw new Error('M7.4.9 pool environment: M7.4.8 clear-pool runtime unavailable.');
}

const ROOT='https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/';
const HDR=ROOT+'env/quarry_cloudy_1k.hdr';

let loaded=false;
let error='';
try{
  await ssfr.env.load(HDR);
  ssfr.env.intensity=1.08;
  ssfr.env.yaw=0.0;
  ssfr.bindCache=null;
  loaded=true;
}catch(err){
  error=String(err?.message||err);
  console.warn('[Fluid V5 M7.4.9] V4 quarry HDR failed; fallback sky remains active.',err);
}

window.__v5M749PoolEnvironment={
  online:true,
  loaded,
  source:HDR,
  intensity:1.08,
  yaw:0.0,
  gpuPassesAdded:0,
  gpuSubmitsAddedPerFrame:0,
  error,
};
window.__fluidV5Version='7.4.9';
const title=document.querySelector('.hud.card.title');
if(title)title.textContent='FLUID V5 · M7.4.9';
document.title='Fluid V5 · M7.4.9 Clear Pool Reflection Fix';
console.info(`[Fluid V5 M7.4.9] V4 neutral pool HDR ${loaded?'restored':'FAILED'}; steep splash reflections now use the intended environment.`);
