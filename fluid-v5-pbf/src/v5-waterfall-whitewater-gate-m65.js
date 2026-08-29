// Fluid V5 M6.5 waterfall whitewater ownership.
// The broad waterfall body is actual PBF liquid. Keep the generic PBF-derived whitewater system at a
// restrained level so the air stays clear around the coherent curtain; dense aeration and mist are
// concentrated at the physical plunge instead of filling the whole fall with large spray blobs.
const state=window.__v5State;
if(!state)throw new Error('Fluid V5 M6.5 whitewater gate: state unavailable.');
let saved=null,savedDrop=null,activeLast=false;
function tick(){
 const on=state.scenario==='waterfall-m62';
 if(on&&!activeLast){
  saved=Number.isFinite(Number(state.whitewater))?Number(state.whitewater):.86;
  savedDrop=Number.isFinite(Number(state.microDropSize))?Number(state.microDropSize):.62;
 }
 if(on){
  const source=saved!==null?saved:(Number(state.whitewater)||0);
  // Retain real impact-derived spray / foam / bubbles, but suppress the airborne particle cloud.
  state.whitewater=source>0?Math.min(.24,Math.max(.06,source*.24)):0;
  // M5.9 still owns genuinely detached spray, but keep those droplets small enough that they read
  // as mist/spray rather than solver-scale pieces of the waterfall body.
  const sourceDrop=savedDrop!==null?savedDrop:(Number(state.microDropSize)||.62);
  state.microDropSize=Math.min(.40,Math.max(.32,sourceDrop*.62));
 }else if(activeLast){
  if(saved!==null)state.whitewater=saved;
  if(savedDrop!==null)state.microDropSize=savedDrop;
  saved=null;savedDrop=null;
 }
 activeLast=on;
 const S=window.__v5WaterfallWhitewaterM65;
 if(S){
  S.active=on;
  S.genericStrength=Number(state.whitewater)||0;
  S.savedStrength=saved!==null?saved:(Number(state.whitewater)||0);
  S.microDropSize=Number(state.microDropSize)||0;
  S.savedDropSize=savedDrop!==null?savedDrop:(Number(state.microDropSize)||0);
  S.physicallyDriven=on;S.nativeWaterfall=on;S.plungeBiased=on;S.macroSpraySuppressed=on;
 }
}
setInterval(tick,45);tick();
window.__v5WaterfallWhitewaterM65={online:true,backend:'plunge-biased-fine-spray-m65',active:false,genericStrength:Number(state.whitewater)||0,savedStrength:Number(state.whitewater)||0,microDropSize:Number(state.microDropSize)||0,savedDropSize:Number(state.microDropSize)||0,physicallyDriven:false,nativeWaterfall:false,plungeBiased:false,macroSpraySuppressed:false};
console.info('[Fluid V5 M6.5] restrained PBF whitewater + fine microdrops leave a clean waterfall curtain and emphasize the plunge.');
