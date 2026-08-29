// Fluid V5 M6.5 waterfall whitewater ownership.
// The broad waterfall body is actual PBF liquid. Keep the generic secondary whitewater system at a
// restrained level so the air stays clear around the coherent curtain; dense aeration and mist are
// concentrated at the physical plunge instead of filling the whole fall with large spray blobs.
const state=window.__v5State;
if(!state)throw new Error('Fluid V5 M6.5 whitewater gate: state unavailable.');
let saved=null,activeLast=false;
function tick(){
 const on=state.scenario==='waterfall-m62';
 if(on&&!activeLast){saved=Number.isFinite(Number(state.whitewater))?Number(state.whitewater):.86;}
 if(on){
  const source=saved!==null?saved:(Number(state.whitewater)||0);
  // Retain real impact-derived spray / foam / bubbles, but suppress the airborne particle cloud.
  state.whitewater=source>0?Math.min(.30,Math.max(.08,source*.30)):0;
 }else if(activeLast){
  if(saved!==null)state.whitewater=saved;
  saved=null;
 }
 activeLast=on;
 const S=window.__v5WaterfallWhitewaterM65;
 if(S){S.active=on;S.genericStrength=Number(state.whitewater)||0;S.savedStrength=saved!==null?saved:(Number(state.whitewater)||0);S.physicallyDriven=on;S.nativeWaterfall=on;S.plungeBiased=on;}
}
setInterval(tick,45);tick();
window.__v5WaterfallWhitewaterM65={online:true,backend:'plunge-biased-pbf-whitewater-m65',active:false,genericStrength:Number(state.whitewater)||0,savedStrength:Number(state.whitewater)||0,physicallyDriven:false,nativeWaterfall:false,plungeBiased:false};
console.info('[Fluid V5 M6.5] restrained PBF whitewater leaves a clean curtain and emphasizes the plunge.');
