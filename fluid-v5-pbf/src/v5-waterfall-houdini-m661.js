// Fluid V5 M6.6.1 Safari-safe wrapper for the resampled waterfall renderer.
// Fixes three static M6.6 integration/compiler errors before compilation/use:
// 1) quality presets accidentally compared the URLSearchParams object instead of `quality`;
// 2) the mist uniform WGSL struct is 128 bytes, not 112 bytes;
// 3) the body fragment shader mutates alpha, so it must be declared with `var`, not `let`.

const diag=document.createElement('div');
diag.id='v5WaterfallM661Diag';
diag.style.cssText='display:none;position:fixed;z-index:51;left:12px;right:12px;top:150px;max-width:760px;margin:auto;padding:8px 10px;border:1px solid rgba(255,118,118,.7);border-radius:10px;background:rgba(28,7,11,.94);color:#ffb0b0;font:8px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;pointer-events:none';
document.body.appendChild(diag);

const url=new URL('./v5-waterfall-houdini-m66.js',import.meta.url);
const response=await fetch(url,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M6.6.1: unable to load M6.6 renderer (${response.status}).`);
let src=await response.text();
const fixes=[
 ["const COLS=q==='low'?16:q==='high'?30:22;","const COLS=quality==='low'?16:quality==='high'?30:22;"],
 ["const ROWS=q==='low'?30:q==='high'?58:44;","const ROWS=quality==='low'?30:quality==='high'?58:44;"],
 ["const MIST_CAP=q==='low'?140:q==='high'?520:300;","const MIST_CAP=quality==='low'?140:quality==='high'?520:300;"],
 ["size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST","size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST"],
 ["const MF=new Float32Array(28),MU=new Uint32Array(MF.buffer);","const MF=new Float32Array(32),MU=new Uint32Array(MF.buffer);"],
 ["let alpha=edge*density*C.style.z;","var alpha=edge*density*C.style.z;"],
];
for(const [a,b] of fixes){if(!src.includes(a))throw new Error(`Fluid V5 M6.6.1 renderer patch signature missing: ${a.slice(0,54)}`);src=src.replace(a,b);}
src=src.replaceAll('M6.6','M6.6.1');
src=src.replaceAll('fluidV5M66','fluidV5M661');
src=src.replaceAll('m66','m661');
src=src.replaceAll('resampled-ballistic-curtain-m661','resampled-ballistic-curtain-m661-safari');
const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{
 await import(blob);
 if(window.__v5WaterfallM60){window.__v5WaterfallM60.backend='resampled-ballistic-curtain-m661-safari';window.__v5WaterfallM60.error='';}
 if(window.__v5WaterfallM66){window.__v5WaterfallM66.backend='resampled-ballistic-curtain-m661-safari';window.__v5WaterfallM66.safariFixed=true;}
}catch(err){
 window.__v5WaterfallM60={...(window.__v5WaterfallM60||{}),online:false,error:String(err?.message||err),backend:'resampled-ballistic-curtain-m661-safari'};
 diag.style.display='block';diag.textContent='WATERFALL M6.6.1 RENDER ERROR · '+String(err?.message||err);
 throw err;
}finally{URL.revokeObjectURL(blob);}
console.info('[Fluid V5 M6.6.1] corrected resampled waterfall renderer online.');
