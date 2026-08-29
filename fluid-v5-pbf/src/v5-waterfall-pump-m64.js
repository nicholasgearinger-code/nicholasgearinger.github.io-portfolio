// Fluid V5 M6.4 reservoir waterfall pump.
// Keeps the validated M6.3.1 post-step/source architecture, but lowers the inlet birth rate so the
// bulk waterfall can remain a coherent liquid sheet instead of becoming an airborne particle cloud.

const diag=document.createElement('div');
diag.id='v5WaterfallM64Diag';
diag.style.cssText='display:none;position:fixed;z-index:50;left:12px;right:12px;top:150px;max-width:760px;margin:auto;padding:8px 10px;border:1px solid rgba(255,118,118,.7);border-radius:10px;background:rgba(28,7,11,.94);color:#ffb0b0;font:8px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;pointer-events:none';
document.body.appendChild(diag);
function updateDiag(){
 const s=window.__v5WaterfallM62,g=window.__v5WaterfallGuideM64;
 if(s?.online===false&&s?.error){diag.style.display='block';diag.style.borderColor='rgba(255,118,118,.7)';diag.style.background='rgba(28,7,11,.94)';diag.style.color='#ffb0b0';diag.textContent='WATERFALL M6.4 ERROR · '+s.error;}
 else if(s?.online&&window.__v5State?.scenario==='waterfall-m62'){
  diag.style.display='block';diag.style.borderColor='rgba(78,214,220,.55)';diag.style.background='rgba(4,17,24,.90)';diag.style.color='#9dffc8';
  diag.textContent=`WATERFALL M6.4 PUMP ON · ${s.submits||0} submits · ~${s.estimatedSpawn||0}/frame${g?.online?' · GUIDE ON':''}`;
 }else{diag.style.display='none';}
}
setInterval(updateDiag,220);

const url=new URL('./v5-waterfall-pump-m62.js',import.meta.url);
const response=await fetch(url,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M6.4: unable to load reservoir pump source (${response.status}).`);
let src=await response.text();
src=src.replaceAll('M6.2.2','M6.4');
src=src.replaceAll('fluidV5M622','fluidV5M64');
src=src.replaceAll('m622','m64');
src=src.replaceAll('closed-loop-reservoir-pump-m64-separate-submit','closed-loop-reservoir-pump-m64-post-step');
src=src.replaceAll('separate GPU submit','post-step GPU submit');
// Current WGSL reserves `meta`.
src=src.replace('meta:vec4u','mdata:vec4u');
src=src.replaceAll('C.meta','C.mdata');
// M6.4: source about one coherent lattice row per frame on Medium rather than ~87 random parcels.
const oldPeriod="const basePeriod=quality==='low'?88:quality==='high'?46:62;\n const period=clamp(Math.round(basePeriod/flow),30,128);";
const newPeriod="const basePeriod=quality==='low'?205:quality==='high'?108:145;\n const period=clamp(Math.round(basePeriod/flow),64,256);";
if(!src.includes(oldPeriod))throw new Error('Fluid V5 M6.4: reservoir source-rate signature changed.');
src=src.replace(oldPeriod,newPeriod);
const oldBlock=`// Critical iOS/WebKit safety rule: do NOT record pump writes into the caller's SSFR encoder.\n// Submit a dedicated compute command buffer first, then let SSFR record reads into its own encoder.\nconst baseRender=ssfr.render;\nssfr.render=function(...args){\n const on=active();\n if(on||wasActive){\n  try{submitPump(on);}catch(err){const S=window.__v5WaterfallM62;if(S){S.online=false;S.error=String(err?.message||err);}console.error('[Fluid V5 M6.4 pump submit]',err);}\n }\n wasActive=on;\n return baseRender.apply(this,args);\n};`;
const newBlock=`// M6.4 queue ordering: PBF solve -> reservoir source -> guide -> rendering.\nconst baseStep=sim.step.bind(sim);\nsim.step=function(frameDt){\n const out=baseStep(frameDt);\n const on=active();\n if(on||wasActive){\n  try{submitPump(on);}catch(err){const S=window.__v5WaterfallM62;if(S){S.online=false;S.error=String(err?.message||err);}console.error('[Fluid V5 M6.4 pump submit]',err);}\n }\n wasActive=on;\n return out;\n};`;
if(!src.includes(oldBlock))throw new Error('Fluid V5 M6.4: M6.2.2 render-hook signature changed.');
src=src.replace(oldBlock,newBlock);
const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{
 await import(blob);
 if(window.__v5WaterfallM62){window.__v5WaterfallM62.backend='closed-loop-reservoir-pump-m64-post-step';window.__v5WaterfallM62.error='';}
}catch(err){
 window.__v5WaterfallM62={...(window.__v5WaterfallM62||{}),online:false,error:String(err?.message||err),backend:'closed-loop-reservoir-pump-m64-post-step'};
 updateDiag();throw err;
}finally{URL.revokeObjectURL(blob);}
console.info('[Fluid V5 M6.4] lower-rate reservoir waterfall pump online.');
