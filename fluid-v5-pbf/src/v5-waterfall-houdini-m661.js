// Fluid V5 M6.6.1 Safari wrapper for the particle-driven PBF density waterfall.
// Safari renders the same tagged PBF source through the dedicated density/aeration reconstruction,
// avoiding exposed solver-scale blobs while keeping waterfall motion and breakup PBF-driven.

const diag=document.createElement('div');
diag.id='v5WaterfallM661Diag';
diag.style.cssText='display:none;position:fixed;z-index:51;left:12px;right:12px;top:150px;max-width:760px;margin:auto;padding:8px 10px;border:1px solid rgba(255,118,118,.7);border-radius:10px;background:rgba(28,7,11,.94);color:#ffb0b0;font:8px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;pointer-events:none';
document.body.appendChild(diag);

try{
 await import('./v5-waterfall-houdini-m66.js');
 const base=window.__v5WaterfallM66||{};
 window.__v5WaterfallM661={...base,online:true,backend:'tagged-pbf-density-curtain-m661-safari',safariFixed:true,nativeBody:true,particleDrivenSurface:true,densitySurface:true,analyticCurtain:false};
 if(window.__v5WaterfallM60){window.__v5WaterfallM60.backend='tagged-pbf-density-curtain-m661-safari';window.__v5WaterfallM60.error='';}
}catch(err){
 window.__v5WaterfallM60={...(window.__v5WaterfallM60||{}),online:false,error:String(err?.message||err),backend:'tagged-pbf-density-curtain-m661-safari'};
 diag.style.display='block';diag.textContent='WATERFALL M6.6.1 RENDER ERROR · '+String(err?.message||err);throw err;
}
console.info('[Fluid V5 M6.6.1] Safari tagged-PBF density waterfall presentation online.');
