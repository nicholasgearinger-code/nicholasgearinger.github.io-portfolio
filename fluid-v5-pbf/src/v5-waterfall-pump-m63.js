// Fluid V5 M6.3 waterfall pump wrapper.
// Reuses the validated M6.2.2 reservoir-pump shader, but moves submission out of SSFR rendering
// and runs it immediately after the PBF solver step. This gives WebGPU an unambiguous queue order:
// solve -> waterfall source -> render. A visible diagnostic badge reports the exact failure if any.

const diag=document.createElement('div');
diag.id='v5WaterfallM63Diag';
diag.style.cssText='display:none;position:fixed;z-index:50;left:12px;right:12px;top:150px;max-width:760px;margin:auto;padding:8px 10px;border:1px solid rgba(255,118,118,.7);border-radius:10px;background:rgba(28,7,11,.94);color:#ffb0b0;font:8px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;pointer-events:none';
document.body.appendChild(diag);
function updateDiag(){
 const s=window.__v5WaterfallM62;
 if(s?.online===false&&s?.error){diag.style.display='block';diag.textContent='WATERFALL M6.3 ERROR · '+s.error;}
 else if(s?.online&&window.__v5State?.scenario==='waterfall-m62'){diag.style.display='block';diag.style.borderColor='rgba(78,214,220,.55)';diag.style.background='rgba(4,17,24,.90)';diag.style.color='#9dffc8';diag.textContent=`WATERFALL M6.3 PUMP ON · ${s.submits||0} submits · ~${s.estimatedSpawn||0}/frame`;}
 else{diag.style.display='none';}
}
setInterval(updateDiag,220);

const url=new URL('./v5-waterfall-pump-m62.js',import.meta.url);
const response=await fetch(url,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M6.3: unable to load M6.2.2 pump source (${response.status}).`);
let src=await response.text();
src=src.replaceAll('M6.2.2','M6.3');
src=src.replaceAll('fluidV5M622','fluidV5M63');
src=src.replaceAll('m622','m63');
src=src.replaceAll('closed-loop-reservoir-pump-m63-separate-submit','closed-loop-reservoir-pump-m63-post-step');
src=src.replaceAll('separate GPU submit','post-step GPU submit');
const oldBlock=`// Critical iOS/WebKit safety rule: do NOT record pump writes into the caller's SSFR encoder.\n// Submit a dedicated compute command buffer first, then let SSFR record reads into its own encoder.\nconst baseRender=ssfr.render;\nssfr.render=function(...args){\n const on=active();\n if(on||wasActive){\n  try{submitPump(on);}catch(err){const S=window.__v5WaterfallM62;if(S){S.online=false;S.error=String(err?.message||err);}console.error('[Fluid V5 M6.3 pump submit]',err);}\n }\n wasActive=on;\n return baseRender.apply(this,args);\n};`;
const newBlock=`// M6.3 queue ordering: run only after the upstream PBF step has submitted its work.\n// Rendering begins later, so the waterfall source never submits from inside an active render path.\nconst baseStep=sim.step.bind(sim);\nsim.step=function(frameDt){\n const out=baseStep(frameDt);\n const on=active();\n if(on||wasActive){\n  try{submitPump(on);}catch(err){const S=window.__v5WaterfallM62;if(S){S.online=false;S.error=String(err?.message||err);}console.error('[Fluid V5 M6.3 pump submit]',err);}\n }\n wasActive=on;\n return out;\n};`;
if(!src.includes(oldBlock))throw new Error('Fluid V5 M6.3: M6.2.2 render-hook signature changed.');
src=src.replace(oldBlock,newBlock);
const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{
 await import(blob);
 if(window.__v5WaterfallM62){window.__v5WaterfallM62.backend='closed-loop-reservoir-pump-m63-post-step';window.__v5WaterfallM62.error='';}
}catch(err){
 window.__v5WaterfallM62={...(window.__v5WaterfallM62||{}),online:false,error:String(err?.message||err),backend:'closed-loop-reservoir-pump-m63-post-step'};
 updateDiag();
 throw err;
}finally{URL.revokeObjectURL(blob);}
console.info('[Fluid V5 M6.3] post-step reservoir waterfall pump online.');
