// Fluid V5 M6.5 waterfall whitewater ownership.
// The native waterfall body is solved PBF liquid. This module only controls the existing secondary
// whitewater model, whose spawn signals come from real PBF impact velocity, surface normals and depth.
const state=window.__v5State;
if(!state)throw new Error('Fluid V5 M6.5 whitewater gate: state unavailable.');
let saved=null,activeLast=false;
function tick(){
 const on=state.scenario==='waterfall-m62';
 if(on&&!activeLast){saved=Number.isFinite(Number(state.whitewater))?Number(state.whitewater):.86;}
 if(on){
  const source=saved!==null?saved:(Number(state.whitewater)||0);
  // Native PBF impact is now much denser, so allow more physically-triggered spray/foam/bubbles.
  state.whitewater=source>0?Math.min(.62,Math.max(.22,source*.62)):0;
 }else if(activeLast){
  if(saved!==null)state.whitewater=saved;
  saved=null;
 }
 activeLast=on;
 const S=window.__v5WaterfallWhitewaterM65;
 if(S){S.active=on;S.genericStrength=Number(state.whitewater)||0;S.savedStrength=saved!==null?saved:(Number(state.whitewater)||0);S.physicallyDriven=on;S.nativeWaterfall=on;}
}
setInterval(tick,45);tick();
window.__v5WaterfallWhitewaterM65={online:true,backend:'native-pbf-impact-whitewater-m65',active:false,genericStrength:Number(state.whitewater)||0,savedStrength:Number(state.whitewater)||0,physicallyDriven:false,nativeWaterfall:false};
console.info('[Fluid V5 M6.5] native PBF impact drives waterfall spray / foam / bubbles.');
