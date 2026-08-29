// Fluid V5 M6.6.1 Safari wrapper for the layered waterfall renderer.
// M6.6 now contains canonical Safari/WebKit-safe WGSL directly, so this wrapper only loads the
// source, relabels the runtime as M6.6.1, and keeps the visible diagnostic path for mobile testing.

const diag=document.createElement('div');
diag.id='v5WaterfallM661Diag';
diag.style.cssText='display:none;position:fixed;z-index:51;left:12px;right:12px;top:150px;max-width:760px;margin:auto;padding:8px 10px;border:1px solid rgba(255,118,118,.7);border-radius:10px;background:rgba(28,7,11,.94);color:#ffb0b0;font:8px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;pointer-events:none';
document.body.appendChild(diag);

const url=new URL('./v5-waterfall-houdini-m66.js',import.meta.url);
const response=await fetch(url,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M6.6.1: unable to load M6.6 renderer (${response.status}).`);
let src=await response.text();

// Keep the stable M6.6 source file while exposing the mobile test build as M6.6.1.
src=src.replaceAll('M6.6','M6.6.1');
src=src.replaceAll('fluidV5M66','fluidV5M661');
src=src.replaceAll('layered-vertical-curtain-m66','layered-vertical-curtain-m661-safari');
src=src.replaceAll('m66','m661');

const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{
 await import(blob);
 if(window.__v5WaterfallM60){
  window.__v5WaterfallM60.backend='layered-vertical-curtain-m661-safari';
  window.__v5WaterfallM60.error='';
 }
 const S=window.__v5WaterfallM661||window.__v5WaterfallM66;
 if(S){
  S.backend='layered-vertical-curtain-m661-safari';
  S.safariFixed=true;
  S.layered=true;
 }
}catch(err){
 window.__v5WaterfallM60={...(window.__v5WaterfallM60||{}),online:false,error:String(err?.message||err),backend:'layered-vertical-curtain-m661-safari'};
 diag.style.display='block';
 diag.textContent='WATERFALL M6.6.1 RENDER ERROR · '+String(err?.message||err);
 throw err;
}finally{
 URL.revokeObjectURL(blob);
}
console.info('[Fluid V5 M6.6.1] layered vertical waterfall curtain + broad plunge mist online.');
